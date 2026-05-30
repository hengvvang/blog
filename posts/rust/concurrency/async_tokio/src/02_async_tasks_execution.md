# 异步任务执行与工作窃取调度机制

在多核处理器上实现高并发网络服务的关键在于：**如何将海量的异步任务高效、均匀地分发到多个 CPU 核心上，同时最小化线程间的锁竞争与上下文切换开销**。

Tokio 的多线程调度器（Multi-Thread Scheduler）采用了一种基于 **工作窃取（Work-Stealing）** 算法的无锁化设计。本章将深入探讨其内存布局、窃取算法细节、LIFO 缓冲槽优化以及协作式任务预算系统。

---

## 1. Tokio 调度器的内存布局

在多线程模式下，每一个 Worker 线程都拥有自己的局部调度上下文。为了消除全局锁的竞争，Tokio 将就绪队列设计成了**两级结构**：

```mermaid
graph TD
    subgraph "全局队列 (Global Queue)"
        GQ["双向链表 (Mutex-backed Inject Queue)"]
    end

    subgraph "Worker Thread A (Stealer)"
        direction TB
        LIFO_A["LIFO Slot (1 Task)"]
        subgraph "本地无锁环形队列 A (Capacity: 256)"
            Head_A["Head (Atomic U32)"]
            Tail_A["Tail (Atomic U32)"]
            Buffer_A["Array [Task; 256]"]
        end
    end

    subgraph "Worker Thread B (Victim)"
        direction TB
        LIFO_B["LIFO Slot (1 Task)"]
        subgraph "本地无锁环形队列 B (Capacity: 256)"
            Head_B["Head (Atomic U32)"]
            Tail_B["Tail (Atomic U32)"]
            Buffer_B["Array [Task; 256]"]
        end
    end

    %% 交互线
    WorkerThreadA["Worker Thread A 运行循环"]
    WorkerThreadB["Worker Thread B 运行循环"]
    
    WorkerThreadA -->|1. 优先读取| LIFO_A
    WorkerThreadA -->|2. Pop (FIFO)| Head_A
    WorkerThreadA -->|3. Steal (CAS 夺取半数)| Head_B
    WorkerThreadA -->|4. 兜底获取| GQ

    WorkerThreadB -->|Push (LIFO 槽满时放入尾部)| Tail_B
```

### 1.1 本地无锁环形队列 (Local Queue)
* **容量限制**：固定大小为 256 的环形数组（Ring Buffer）。
* **单生产者多消费者 (SPMC)**：
  * **主线程（Owner Thread）**：只有当前 Worker 线程会在队列尾部 `tail` 写入（Push）新任务，并在头部 `head` 读取（Pop）任务执行。由于只有单线程写入，`tail` 的修改不需要复杂的原子 CAS 操作，只需 `Release` 语义的 Store 即可。
  * **窃取者线程（Stealer Threads）**：当其他 Worker 线程没有任务时，会充当“窃取者”，从该队列的头部 `head` 批量“窃取”任务。由于可能有多个线程同时发起窃取，`head` 的修改必须使用原子 Compare-And-Swap (CAS) 操作。

### 1.2 全局队列 (Global Queue / Inject Queue)
* 当本地队列已满（256 个任务溢出），或者任务是由非 Worker 线程（如标准 OS 线程或通过阻塞线程池返回的任务）派发时，任务会被投递到全局队列中。
* 全局队列由互斥锁（Mutex）保护，是 Worker 线程的最后兜底任务来源。

---

## 2. 工作窃取（Work-Stealing）算法深度推演

当 Worker 线程 $A$ 的本地队列和 LIFO 槽全部为空时，它会启动工作窃取流程，设法获取任务以保持忙碌。其核心步骤与原子操作如下：

### 2.1 窃取步骤解析
1. **生成随机起点**：为了防止多个空闲 Worker 线程同时涌向同一个繁忙的线程造成严重的 CAS 竞争，窃取者会生成一个伪随机数，以此决定检查其他 Worker 线程的顺序。
2. **读取目标线程的 Head 与 Tail**：
   * 线程 $A$ 选定线程 $B$ 作为“牺牲者”（Victim）。
   * 线程 $A$ 通过原子操作（使用 `Acquire` 内存顺序）读取线程 $B$ 的 `head` 和 `tail` 索引值。
3. **计算窃取数量**：
   * 窃取数量 $N = \min(128, \frac{\text{tail} - \text{head}}{2})$。即尝试窃取对方队列中一半的任务，但一次最多不超过 128 个。
4. **执行原子 CAS 夺取**：
   * 线程 $A$ 尝试将线程 $B$ 的 `head` 原子地增加 $N$：
     $$\text{CAS}(B.\text{head}, \text{old\_head}, \text{old\_head} + N)$$
   * **若 CAS 成功**：说明在读取到尝试修改的期间，没有其他线程修改过 $B.\text{head}$。线程 $A$ 成功获得了这 $N$ 个任务的控制权，并将它们拷贝到自己的本地队列中。
   * **若 CAS 失败**：说明遭遇了竞争（其他窃取者先下手了，或者主线程 $B$ 自己消耗了任务）。线程 $A$ 将放弃本次尝试，重新生成随机数选择下一个目标。

---

## 3. LIFO Slot (后进先出缓存槽) 优化

在高并发的异步场景中，经常会出现“任务 $A$ 在唤醒任务 $B$ 后，任务 $A$ 立即进入等待”的模式（例如通过通道发送数据，或者唤醒另一个就绪任务）。

如果按照常规逻辑将任务 $B$ 放入本地环形队列的尾部，它需要等待排在它前面的 200 多个任务全部被 `poll` 完，这会带来两个严重的性能惩罚：
1. **CPU 缓存失效（Cache Miss）**：任务 $B$ 关联的内存数据在 CPU 的 L1/L2 缓存中是“热”的，但如果延迟数百毫秒才执行，数据将被挤出缓存。
2. **极大的调度延迟**。

### 3.1 什么是 LIFO Slot？
Tokio 为每个 Worker 线程提供了一个**容量为 1 的 LIFO Slot**：
* 当一个 Task 唤醒另一个 Task 时，被唤醒的 Task 会**直接抢占**当前 Worker 线程的 LIFO Slot，而不需要排队进入本地队列。
* Worker 线程在每次事件循环开始时，**最优先**检查并执行 LIFO Slot 中的任务。
* 如果在新的 Task 准备抢占时，LIFO Slot 中已经存在一个任务，那么原有的任务会被“降级”挤进本地环形队列中排队。

通过这种极简的设计，Tokio 实现了近乎完美的主动局部缓存命中率，使微秒级的流水线任务能够无缝在同一个 CPU 核心上高速流转。

---

## 4. 协作式调度与任务预算系统（Task Budget）

在 Rust 的非抢占式（Cooperative）异步模型中，一个 Future 只要不返回 `Poll::Pending`，它就会牢牢霸占当前工作线程。这就引入了一个致命的隐患：**热循环（Hot Loops）导致其他任务饿死**。

例如，一个异步 Loop 持续从本地高速 Loopback Socket 读取数据，由于网速极快且缓冲区永远有数据，该 Future 每次被 `poll` 时都会返回 `Poll::Ready(data)`。如果没有限制，这个任务将永远霸占该工作线程，导致同线程下的其他 I/O 任务或定时器完全瘫痪。

### 4.1 任务预算（Task Budget）的工作原理
从 Tokio 1.0 开始，引入了**协作式任务预算限制**：
* 每一个异步 Task 在被调度执行时，都会被分配一个**“预算（Budget）”**，默认值通常为 **128 次操作**。
* 所有 Tokio 提供的异步资源（如 `tokio::net::TcpStream`、`tokio::sync::mpsc` 等）在调用 `poll_read`、`poll_write` 或 `poll_recv` 时，都会自动递减当前 Task 的预算值。
* **当预算归零（0）时**：即使底层的 OS socket 此时实际上有可读数据，该异步资源也会强行返回 `Poll::Pending`，并自动调用 `Waker::wake_by_ref()` 将自己重新标记为就绪状态。
* 这样，当前 Task 会主动释放 CPU 所有权，退回就绪队列排队，让同线程的其他任务得以运行。

### 4.2 观察任务调度与预算行为的实例

下面我们通过一段精心设计的 Rust 代码，来直观展现协作式调度与任务调度的行为。

```rust
use tokio::task;
use std::time::Duration;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    println!("=== 启动 Tokio 协作式调度演示 ===");

    // 1. 创建一个热循环任务：模拟一个不断自循环、不释放 CPU 的计算任务
    let task_hot = tokio::spawn(async {
        let mut counter: u64 = 0;
        println!("热循环任务已启动。");
        loop {
            counter += 1;
            
            // 为了模拟任务调度，我们使用 tokio::task::yield_now()。
            // yield_now 会消耗当前 Task 的 budget，并在 budget 归零时触发真正的线程切换。
            task::yield_now().await;

            if counter % 1_000_000 == 0 {
                println!("热循环任务：已循环 {} 次", counter);
                if counter >= 3_000_000 {
                    break;
                }
            }
        }
        println!("热循环任务执行结束。");
    });

    // 2. 创建一个定时观测任务：用于测试热循环是否会阻碍其他任务运行
    let task_observer = tokio::spawn(async {
        println!("观测任务已启动。");
        for i in 1..=5 {
            tokio::time::sleep(Duration::from_millis(150)).await;
            println!("观测任务：心跳探测点 {}/5", i);
        }
        println!("观测任务执行结束。");
    });

    // 等待两任务完成
    let _ = tokio::join!(task_hot, task_observer);
    println!("=== 演示结束 ===");
}
```

### 4.3 为什么不要在异步 Task 中运行纯 CPU 阻塞代码？
需要特别强调的是，**Task Budget 机制只能约束那些调用了 Tokio 官方异步 I/O/同步原语的 Future**。
如果你在 `async` 块中编写了如下的代码：

```rust
// 致命的反面教材
tokio::spawn(async {
    loop {
        // 纯 CPU 计算，没有 await 任何 Tokio 资源，也没有调用 yield_now()
        do_heavy_fibonacci(); 
    }
});
```

因为这段代码没有与 Tokio 的驱动层交互，Budget 根本无法递减。这个 Task 将无限期霸占当前 Worker 线程，将多线程调度器事实退化为单线程，造成严重的延迟抖动。

对于这类 CPU 密集型任务，必须使用 `tokio::task::spawn_blocking` 将其指派给专门的阻塞线程池（Blocking Thread Pool），或者通过 `std::thread::spawn` 创建原生线程运行。
