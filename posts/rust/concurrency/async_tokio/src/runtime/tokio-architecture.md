# 第一章：Tokio 运行时架构与工作窃取调度器

在深入探索 Tokio 的任务调度系统与无锁队列之前，我们首先需要从系统级编程的宏观视角，解构 Tokio 运行时的核心架构设计。作为一个工业级的异步引擎，Tokio 不仅仅是一个“线程池”，它是由**事件驱动引擎（Reactor）**与**任务调度器（Executor）**深度融合而成的复杂系统。

---

## 1. Rust 异步契约与运行时的设计哲学

在 Rust 中，标准库（`std`）对异步的支持是极其“克制”的。它仅定义了最核心的接口：

```rust
// 标准库定义的 Future 接口
pub trait Future {
    type Output;
    // 采用 Poll（拉取式）模型，接收 Pin 包装的 &mut Self 以及 Context
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>;
}
```

与 Go 或 Erlang 等语言不同，Rust 采用了**基于 Poll（拉取式）**的惰性 Future 状态机模型。这种设计拥有以下几个核心特性：

* **惰性求值（Lazy Execution）**：在 Rust 中，创建一个 `Future` 并不会自动运行任何代码。它仅仅是编译器根据你的 `async` 块生成的一个实现了 `Future` trait 的匿名的状态机结构体。只有当它被显式地调用 `poll` 方法时，它才会向下执行一步。
* **无物理协程栈（Stackless）**：Rust 的异步任务不需要分配独立的学生栈，其执行状态（如局部变量、跨 `.await` 的挂起状态）全部保存在该 `Future` 结构体的成员变量中。这使得其内存占用极小（通常只有几十个字节），实现了真正的零开销抽象（Zero-cost Abstractions）。
* **协作式调度契约**：如果 `poll` 返回 `Poll::Pending`，说明当前资源未就绪，Future 必须记录传入的 `Context` 中的 `Waker`。当底层事件（如网络数据到达、定时器到期）发生时，由外部设备或底层驱动调用 `Waker::wake()`，重新通知调度器对该 Future 进行下一次 `poll`。

这个负责**驱动 Future 执行、提供事件监听、并管理线程生命周期**的外部实体，就是**异步运行时（Runtime）**。而 Tokio，就是这个异步契约的集大成实现者。

---

## 2. Tokio 架构拓扑与核心组件

Tokio 运行时在内部被划分为三个核心层次：**驱动层（Drivers / Reactor）**、**调度层（Scheduler / Executor）**和**接口层（Spawner / API）**。它们之间的逻辑拓扑关系如下图所示：

```mermaid
graph TB
    subgraph "接口层 (Spawner / API)"
        Spawn["tokio::spawn"]
        SpawnBlock["spawn_blocking"]
    end

    subgraph "调度层 (Scheduler / Executor)"
        GlobalQueue["全局就绪队列 (Global Queue - Mutex 保护)"]
        
        subgraph "Worker Thread 1"
            WQ1["本地队列 (Local Queue - SPMC 无锁)"]
            WS1["LIFO Slot (容量 1, 快速热缓存)"]
            Loop1["事件循环 (Event Loop)"]
        end

        subgraph "Worker Thread 2"
            WQ2["本地队列 (Local Queue - SPMC 无锁)"]
            WS2["LIFO Slot (容量 1, 快速热缓存)"]
            Loop2["事件循环 (Event Loop)"]
        end
    end

    subgraph "驱动层 (Drivers / Reactor)"
        IoDriver["I/O 驱动 (MIO: epoll / kqueue / IOCP)"]
        TimeDriver["时间驱动 (Hierarchical Timing Wheel)"]
        SignalDriver["信号驱动 (Signal Driver)"]
    end

    %% 关联关系
    Spawn -->|提交任务| GlobalQueue
    GlobalQueue <-->|调度与平衡| WQ1
    GlobalQueue <-->|调度与平衡| WQ2
    
    Loop1 -->|1. 轮询 LIFO 槽和本地队列| WQ1
    Loop2 -->|1. 轮询 LIFO 槽和本地队列| WQ2

    Loop1 -.->|2. 每 61 次 Tick 检查| GlobalQueue
    Loop2 -.->|2. 每 61 次 Tick 检查| GlobalQueue

    Loop1 -.->|3. 队列空时，轮询驱动层并阻塞等待| IoDriver
    Loop2 -.->|3. 队列空时，轮询驱动层并阻塞等待| TimeDriver
    
    IoDriver <-->|系统调用监听| Kernel["操作系统内核 (Kernel)"]
```

### 2.1 驱动层 (Drivers / Reactor)
驱动层是 Tokio 与操作系统内核交互的桥梁，也是整个运行时“反应堆（Reactor）”的核心。它主要包括：
* **I/O 驱动 (`IoDriver`)**：基于 [MIO](https://github.com/tokio-rs/mio) 库实现。MIO 对操作系统的高性能多路复用 API 进行了统一封装（Linux 下的 `epoll`，macOS/FreeBSD 下的 `kqueue`，Windows 下的 `IOCP`）。它负责监听文件描述符（FD）或套接字（Socket）的可读可写状态。
* **时间驱动 (`TimeDriver`)**：负责管理所有的异步定时任务（如 `tokio::time::sleep`）。其底层使用了**分级时间轮（Hierarchical Timing Wheel）**算法，能够在 $O(1)$ 的时间复杂度内高效地增删定时任务。
* **信号驱动 (`SignalDriver`)**：接收并处理操作系统的异步信号（如 `SIGINT`, `SIGTERM`）。

### 2.2 调度层 (Scheduler / Executor)
调度层是 Tokio 的“执行器（Executor）”。它负责从各种就绪队列中取出任务，并调用 Future 的 `poll` 方法。调度器支持两种完全不同的工作模式：
* **Current-Thread 调度器**：所有异步任务都在调用 `block_on` 的当前单线程上执行。
* **Multi-Thread (Work-Stealing) 调度器**：多线程工作窃取调度器，是 Tokio 在多核 CPU 下默认且推荐的高性能调度方案。它由多个 Worker 线程组成，每个线程维护自己的本地无锁队列，空闲线程能自动窃取其他线程的任务，实现负载均衡。

### 2.3 接口层 (Spawner)
向运行时派发任务的入口，例如 `tokio::spawn`。它会将用户定义的异步 Block 包装成一个包含状态控制元数据的 Task，并投递到调度器的就绪队列中。

---

## 3. MIO 与操作系统事件循环的底层打通

为了理清 I/O 驱动层是如何将操作系统的硬件中断或网络数据包到达，逐步转化为 Rust 异步 Task 的唤醒过程，我们需要梳理一条 **“从数据到达网卡，到 Future 被重新 poll”** 的完整调用链。

```
[网卡数据到达] ──> [触发 CPU 中断] ──> [内核标记 Socket 可读]
                                            │
                                            ▼
[Worker 线程调用 mio::Poll::poll (如 epoll_wait 阻塞等待)]
                                            │
                                            ▼ (获取就绪事件及 Token)
[Tokio 遍历就绪事件] ──> [通过 Token 查表找到 ScheduledIo]
                                            │
                                            ▼
[取出绑定的 Waker] ──> [调用 waker.wake()]
                                            │
                                            ▼
[Task 被压入对应 Worker 的本地就绪队列] ──> [Worker 线程重新 Poll 该 Task]
```

### 3.1 `ScheduledIo` 状态与 Token 注册
在 Tokio 中，每一个异步 I/O 资源（如 `TcpStream`）在创建时，都需要在 I/O 驱动中注册一个关联的 `ScheduledIo` 结构。
1. **非阻塞模式设置**：底层套接字（Socket）会被设置为非阻塞模式（Non-blocking）。
2. **注册至 MIO**：该套接字被注册到 `mio::Poll` 实例中，并分配一个唯一的 `Token`（通常是一个递增的整数索引）。
3. **分配关联资源**：这个 `Token` 在 `IoDriver` 内部直接对应着一个特定的 `ScheduledIo` 槽位，其中保存了该 I/O 资源关联的 `Waker`（包含了当前因为等待 I/O 而挂起的 Task 的控制块指针）。

### 3.2 唤醒机制的闭环
当网卡接收到数据并引发 CPU 中断后，内核会将该 Socket 标记为“可读”。
1. **轮询系统 API**：某个 Worker 线程在执行事件循环时，如果发现本地就绪队列已空，或者到达了特定 tick，它会调用 `mio::Poll::poll`，这是一个阻塞或带有超时的系统调用（如 Linux 下的 `epoll_wait`）。
2. **事件上报**：操作系统内核将就绪事件列表返回给 `mio`，其中包含之前注册的 `Token` 和事件类型（如可读 `READABLE`）。
3. **定位任务控制块**：Tokio 遍历这些事件，根据 `Token` 寻找到对应的 `ScheduledIo` 结构。
4. **触发唤醒**：从 `ScheduledIo` 中提取出之前暂存的 `Waker`（该 Waker 指向了因等待该 Socket 数据而被 Pending 的 Task ），并调用 `waker.wake()`。
5. **任务重新就绪**：`wake()` 的底层实现会将该 Task 的状态由等待标记为就绪，并重新插入到对应 Worker 线程的本地就绪队列中。
6. **下一次 Poll**：Worker 线程在下一轮循环中从本地队列中取出该 Task，对其执行 `poll`。此时底层 Socket 调用 `read()` 将成功获取到数据，Future 返回 `Poll::Ready(data)`。

---

## 4. 运行时的两种调度模式与手动配置

通常开发者习惯直接在 `main` 函数上打上 `#[tokio::main]` 属性宏。实际上，这会被编译器展开为通过 `tokio::runtime::Builder` 手动构建运行时的代码。为了深刻理解这两种调度模式，我们来看一下它们的底层手动构建与配置方式。

### 4.1 深入 `current_thread` 模式
单线程模式非常适合以下场景：
* I/O 密集度不高，但对低延迟、无线程切换开销有严苛要求的场景（如嵌入式设备、Edge 边缘计算）。
* 编写测试用例或无需利用多核 CPU 的轻量级守护进程。
* 避免跨线程传递数据时引入 `Send + Sync` 约束（可以使用非 `Send` 的 `Rc` 或 `RefCell`）。

```rust
use std::time::Duration;
use tokio::runtime::Builder;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 手动构建单线程（Current Thread）运行时
    let rt = Builder::new_current_thread()
        .enable_io()       // 启用 Mio 驱动以支持网络 IO
        .enable_time()     // 启用时间轮驱动以支持 sleep/timeout
        .thread_name("my-single-thread-worker") // 显式命名工作线程
        .build()?;

    // 在单线程上运行异步入口
    rt.block_on(async {
        println!("当前单线程运行时已启动。");
        // 挂起任务，等待时间轮驱动在 50ms 后唤醒
        tokio::time::sleep(Duration::from_millis(50)).await;
        println!("单线程定时器唤醒成功。");
    });

    Ok(())
}
```

### 4.2 深入 `multi_thread` 模式
多线程工作窃取模式是 Tokio 的核心威力所在。它会默认创建与 CPU 核心数相等的 Worker 线程，并通过负载均衡算法将任务分发到各个核心上。

```rust
use tokio::runtime::Builder;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let thread_counter = Arc::new(AtomicUsize::new(0));
    
    // 构建多线程工作窃取运行时
    let rt = Builder::new_multi_thread()
        .worker_threads(4) // 显式指定 4 个工作线程
        .enable_all()      // 同时启用 I/O、Timer 等所有驱动
        .thread_name_fn(move || {
            // 自定义线程命名逻辑，便于调试和监控
            let id = thread_counter.fetch_add(1, Ordering::SeqCst);
            format!("tokio-worker-pool-{}", id)
        })
        .thread_stack_size(3 * 1024 * 1024) // 设置工作线程的物理栈大小为 3MB
        .on_thread_start(|| {
            // 当工作线程启动时的回调，可用于绑定线程 CPU 亲和性或初始化本地日志
            println!("工作线程已启动。");
        })
        .on_thread_stop(|| {
            // 工作线程退出时的清理操作
            println!("工作线程已退出。");
        })
        .build()?;

    rt.block_on(async {
        // 在多线程运行时中派发任务
        let handle = tokio::spawn(async {
            let current_thread = std::thread::current();
            println!("异步任务正在线程上执行: {:?}", current_thread.name());
        });
        
        handle.await.unwrap();
    });

    Ok(())
}
```

---

## 5. 剖析底层事件循环（Event Loop）流程与饥饿防止

每一个 Worker 线程本质上都是在一个无限循环中运转，它的任务检索和调度逻辑非常严密。以下是 Worker 运行循环的伪代码结构：

```rust
fn run_worker_loop(local_queue: &mut LocalQueue, global_queue: &mut GlobalQueue) {
    let mut tick = 0;
    loop {
        tick += 1;
        let mut task = None;

        // 1. 协作式防止饥饿：每 61 次 tick，强制先检查全局队列
        // 这样可以确保由非 Worker 线程提交或溢出到全局队列的任务不会被饿死
        if tick % 61 == 0 {
            task = global_queue.pop();
        }

        // 2. 如果全局队列没取到，或者不是第 61 次 tick，先从 LIFO Slot (缓存槽) 中读取
        // LIFO Slot 保存着刚刚被当前任务唤醒的任务，具有极佳的 CPU L1/L2 缓存局部性
        if task.is_none() {
            task = local_queue.pop_lifo_slot();
        }

        // 3. 从本地无锁队列（Local Queue）中获取就绪任务
        if task.is_none() {
            task = local_queue.pop_local();
        }

        // 4. 如果本地队列也空了，尝试从全局队列批量获取，或者去其他 Worker 线程“窃取”任务
        if task.is_none() {
            task = try_steal_or_global(local_queue, global_queue);
        }

        // 5. 如果调度队列全部为空，说明当前系统没有就绪的任务：
        //    此时线程会充当 "Driver Poller"，负责调用操作系统多路复用 API 阻塞监听 I/O 事件。
        if task.is_none() {
            // 调用 epoll_wait / kqueue / GetQueuedCompletionStatus 等待底层 IO 事件
            // 一旦有事件就绪，会唤醒对应的 Waker 并将其 Task 重新注入就绪队列
            poll_drivers_and_inject_events();
            continue;
        }

        // 6. 执行任务（调用 Future::poll）
        if let Some(active_task) = task {
            execute_task(active_task);
        }
    }
}
```

### 为什么选择 61 这一数值？
在这个事件循环中，**第 61 次 tick 检查全局队列**的设计至关重要。
* 如果 Worker 线程只关注自己的本地就绪队列，那么在高并发的本地任务循环中（例如一个任务不断产生新任务放入本地队列），全局队列中新产生的任务以及其他线程分发过来的任务将会被无限期挂起（饥饿）。
* **选择 61 的深意**：61 是一个素数，且大小适中。在计算机科学中，如果使用偶数或合数作为周期，很容易与应用层某些周期性的任务调度（如每 2 次、每 4 次 tick 触发的行为）产生步调一致的共振，从而导致周期性的负载倾斜。素数能够打破绝大多数周期性任务的共振，使得对全局队列的负载平衡检查显得更加随机与均匀。
