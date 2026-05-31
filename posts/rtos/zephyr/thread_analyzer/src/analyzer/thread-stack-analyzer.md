# 第一章：配置、启用与运行时栈水位线分析

实时操作系统（RTOS）在多任务调度中，每个线程都必须分配一个独立的物理栈空间。如何精确评估每个线程在最坏场景下的栈占用，是嵌入式系统开发的核心难题之一。Zephyr 提供的 **Thread Stack Analyzer（线程栈分析器）** 是在运行时（Runtime）诊断线程栈消耗的工业级利器。

本章将从底层物理内存布局、匹配算法、Kconfig 性能权衡、守护任务的 C 语言实现以及 Shell 数据分析等多个维度，对 Thread Stack Analyzer 进行全面且深入的剖析。

---

## 1.1 Thread Stack Analyzer 的物理机制与内存布局

Zephyr 的 Thread Stack Analyzer 并非依赖特殊的硬件 Trace 工具，而是使用一种轻量级的**软件字节模式匹配**算法。

在递减栈（Cortex-M 架构的典型特征，栈从高地址向低地址生长）中，其物理内存布局如下所示：

### 线程栈物理内存布局 (Stack Memory Layout)

```text
       SRAM 高地址 (High Address)
       +---------------------------------------------+ <--- 栈基地址 Stack Base (内存最高处)
       |                                             |
       |  线程初始化上下文 (Initial Thread Context)  | (包含 xPSR, PC, LR, R0-R3 等寄存器)
       |                                             |
       +---------------------------------------------+
       |                                             |
       |  当前活动栈帧 (Active Stack Frames)         | (局部变量、子函数栈帧、中断嵌套保存现场)
       |                                             |
       +---------------------------------------------+ <--- 当前栈指针 SP (PSP / Process Stack Pointer)
       |                                             |
       |  历史已污染区 (Dirty Stack Area)            | (已被调用过的函数写入，数据残留，已非 0xAA)
       |                                             |
       +---------------------------------------------+ <--- 历史最高水位线 Peak Watermark (扫描在此终止)
       |                                             |
       |  未被污染区 (Unused Stack Area)             | (自系统启动以来未被触碰，全部保持 0xAA 填充值)
       |                                             |
       +---------------------------------------------+
       |  软件安全哨兵区 (Sentinel / Canary Region)  | (大小通常为 4 字节，填充 0xDEADBEEF)
       +---------------------------------------------+ <--- 栈物理边界 Stack Limit (k_thread->stack_info.start)
       |  MPU 硬件警戒页 (MPU Guard Page)            | (硬件保护特有，通常对齐为 32B/64B/1KB 禁写区)
       +---------------------------------------------+
       SRAM 低地址 (Low Address)
```

### 估算逻辑与数学公式

1.  **栈空间预填充（Stack Initialization）**：
    在内核编译阶段，利用宏定义静态声明栈区时，或者在运行时动态创建线程时，内核会将整片栈内存（扣除物理警戒区）预先填充为特定的单字节字符，Zephyr 中默认为 `0xAA`。
    
2.  **水位扫描算法（Watermark Scanning）**：
    当分析器运行时，它以低地址向高地址的方向（即 `Stack Limit -> Stack Base`）逐字节读取栈内存。只要读取到的字节值等于 `0xAA`，就认为这块内存从未被当前线程作为栈空间使用；一旦遇到**第一个不等于 `0xAA`** 的字节，即意味着找到了历史运行中所触及的“最深地址”，该地址即为**历史最高水位线（Peak Watermark）**。

3.  **计算公式**：
    *   **栈物理总容量 ($S_{total}$)**：
        $$S_{total} = \text{Stack Base} - \text{Stack Limit}$$
    *   **未使用栈空间 ($S_{unused}$)**：
        $$S_{unused} = \text{Addr}_{first\_non\_0xAA} - \text{Stack Limit}$$
    *   **历史最高已用栈空间 ($S_{used}$)**：
        $$S_{used} = S_{total} - S_{unused}$$
    *   **已用栈比例 ($P_{usage}$)**：
        $$P_{usage} = \left( \frac{S_{used}}{S_{total}} \right) \times 100\%$$

> [!WARNING]
> **算法局限性**：
> 如果线程在执行过程中，其声明的局部变量中恰好包含连续的大量 `0xAA` 数据（如 `uint8_t buffer[64]` 且被初始化为了全 `0xAA`），则在扫描时会将这部分本已使用的区域误判为未用，导致估算水位偏低。但在实际工程中，这种局部变量模式纯巧合的概率极低，估算偏差在容允范围内。

---

## 1.2 关键 Kconfig 配置项与开销评估

在 Zephyr 项目的配置文件 `prj.conf` 中，可通过组合不同的 Kconfig 配置项来开启该功能：

```ini
# 开启线程分析器核心组件
CONFIG_THREAD_ANALYZER=y

# 模式选择：使用系统的 Logger 框架异步或同步输出（推荐，支持日志过滤与分级）
CONFIG_THREAD_ANALYZER_USE_LOG=y

# 模式选择：若关闭 Logger 框架，可直接用 printk 串口阻塞打印（仅适合调试早期无 Logger 的系统）
# CONFIG_THREAD_ANALYZER_USE_PRINTK=y

# 开启后台自动扫描守护线程
CONFIG_THREAD_ANALYZER_AUTO=y
# 后台自动扫描的时间间隔（单位：秒）
CONFIG_THREAD_ANALYZER_AUTO_INTERVAL=10
# 自动扫描线程的专属栈大小（单位：字节）
CONFIG_THREAD_ANALYZER_AUTO_STACK_SIZE=1024

# 启用线程命名（极其重要！否则分析器输出中只能打印 0xXXXX 形式的线程 ID，排查困难）
CONFIG_THREAD_NAME=y

# 启用运行时状态统计（可提供线程 CPU 时间、上下文切换次数等辅助分析）
CONFIG_THREAD_RUNTIME_STATS=y
```

### 运行时开销评估（Overhead Matrix）

| 资源维度 | 静态开销 (编译期) | 动态开销 (运行期) | 引入的风险 |
| :--- | :--- | :--- | :--- |
| **Flash (代码体积)** | 约增加 1.5 KB - 3 KB 空间 | 无 | 占用程序存储空间，对极其受限的单片机需裁剪。 |
| **RAM (内存消耗)** | 无额外全局 RAM，除非开启后台线程（耗费 1024 字节栈 + TCB 约 128 字节） | 扫描时不分配临时堆空间，全部在栈上进行轻量级指针迭代 | 开启自动扫描时，守护线程会恒常占用一部分物理内存。 |
| **CPU (计算开销)** | 无 | 每次扫描需要逐字节遍历所有线程栈。例如 10 个线程，每个栈 2KB，则每次扫描需要执行 20,000 次内存比较操作 | 逐字节扫描会拉低 CPU 吞吐量。若在硬实时任务执行期间进行扫描，会导致高优先级任务出现抖动（Jitter）。 |

> [!TIP]
> **生产环境最佳实践**：
> 1. **研发测试阶段**：开启 `CONFIG_THREAD_ANALYZER_AUTO=y`，高频（如 5s）扫描，帮助发现绝大多数常规栈分配问题。
> 2. **量产验证阶段（Beta）**：关闭自动扫描，通过编写命令，或在网络模块空闲、CPU 处于 IDLE 任务时由后台低优先级任务手动触发 `thread_analyzer_run`，并将分析结果持久化至本地 Flash，作为异常日志的诊断依据。

---

## 1.3 生产级栈监控守护线程实现

为了在量产前的固件中融入栈安全的防御监控，下面的 C 代码演示了如何创建一个极低优先级的守护线程，利用 `thread_analyzer_run` API 周期性检查系统任务，并在水位越过 85% 危险阈值时触发报警：

```c
#include <zephyr/kernel.h>
#include <zephyr/debug/thread_analyzer.h>
#include <zephyr/logging/log.h>

/* 注册本模块日志，设置默认等级为 Info */
LOG_MODULE_REGISTER(stack_monitor, LOG_LEVEL_INF);

/* 扫描周期：每 10 秒扫描一次 */
#define STACK_SCAN_INTERVAL_MS   K_MSEC(10000)
/* 报警阈值百分比：85% */
#define ALARM_THRESHOLD_PCT      85

/* 汇总上下文结构体，用于单次扫描的数据归档 */
struct monitor_summary {
    uint32_t active_threads_count;
    uint32_t danger_threads_count;
};

/**
 * @brief 栈分析器回调函数
 * 
 * 对于系统中遍历到的每一个线程，内核都会调用一次此回调
 * 
 * @param info 线程栈状态结构体指针
 * @param user_data 传递给回调的用户自定义指针
 */
static void thread_scan_callback(struct thread_analyzer_info *info, void *user_data)
{
    struct monitor_summary *summary = (struct monitor_summary *)user_data;
    summary->active_threads_count++;

    /* 安全防范：防止栈物理大小为 0 时引发除零错误 */
    if (info->stack_size == 0) {
        LOG_WRN("Thread ID %p has zero stack size registered.", info->id);
        return;
    }

    /* 计算历史最高栈使用率（百分比） */
    uint32_t usage_pct = (info->stack_used * 100) / info->stack_size;
    const char *thread_name = info->name ? info->name : "unnamed";

    if (usage_pct >= ALARM_THRESHOLD_PCT) {
        summary->danger_threads_count++;
        /* 触发警告级日志，提供足够丰富的错误现场 */
        LOG_WRN("⚠️  [STACK OVERLIMIT WARNING] Thread '%s' (%p) stack high water mark exceeded!",
                thread_name, info->id);
        LOG_WRN("   Used/Total: %zu/%zu bytes (%u%%), Remaining: %zu bytes",
                info->stack_used, info->stack_size, usage_pct,
                info->stack_size - info->stack_used);
        
        /* 
         * 在实际工业现场，此处可执行应急手段：
         * 1. 触发非易失性闪存 (NVS) 写入，保存故障日志
         * 2. 如果是可降级任务，动态降低该线程的调度优先级
         * 3. 发送 MQTT 告警报文通知上位机
         */
    } else {
        /* 正常水位，以 Debug/Info 级别记录，便于日常追踪 */
        LOG_DBG("Thread '%s' (%p) -> Usage: %zu/%zu (%u%%)",
                thread_name, info->id, info->stack_used, info->stack_size, usage_pct);
    }
}

/**
 * @brief 栈监控守护线程入口函数
 */
static void stack_monitor_thread_entry(void *p1, void *p2, void *p3)
{
    ARG_UNUSED(p1);
    ARG_UNUSED(p2);
    ARG_UNUSED(p3);

    LOG_INF("Zephyr Stack Monitor Daemon successfully initialized.");

    while (1) {
        struct monitor_summary summary = {0};

        LOG_DBG("Triggering manual stack scan...");
        
        /* 
         * 调用内核 API 启动扫描。
         * 此函数是同步的，会依次执行回调，在此期间将阻塞此监控线程。
         */
        thread_analyzer_run(thread_scan_callback, &summary);

        if (summary.danger_threads_count > 0) {
            LOG_WRN("Scan complete. Warned threads: %u/%u", 
                    summary.danger_threads_count, summary.active_threads_count);
        } else {
            LOG_INF("Scan complete. All %u threads are running within safe watermarks.", 
                    summary.active_threads_count);
        }

        /* 挂起指定时间，交出 CPU 拥有权，防止低优先级任务饥饿 */
        k_sleep(STACK_SCAN_INTERVAL_MS);
    }
}

/* 
 * 静态定义监控线程：
 * 栈大小设置为 1536 字节。
 * 优先级必须设置为最低应用程序优先级 (K_LOWEST_APPLICATION_THREAD_PRIO)，
 * 保证绝不抢占任何高强度的实时计算业务。
 */
K_THREAD_DEFINE(stack_monitor_tid, 1536,
                stack_monitor_thread_entry, NULL, NULL, NULL,
                K_LOWEST_APPLICATION_THREAD_PRIO, 0, 0);
```

---

## 1.4 Shell 终端控制与分析报告解读

当设备使能了命令行 Shell 框架（`CONFIG_SHELL=y`）并引入了线程分析 Shell 模块后，开发人员可在调试串口（或 USB VCP）键入指令实现即时查询。

### 1.4.1 配置使能 Shell
```ini
CONFIG_SHELL=y
# 使能 thread analyze 命令
CONFIG_THREAD_ANALYZER_SHELL=y
```

### 1.4.2 控制台命令及输入
```bash
uart:~$ thread analyze
```

### 1.4.3 报告输出及数据深度剖析
系统响应后会输出如下结构化表格：

```text
Thread analyze:
 0x20000ba0 main                 : unused   1456 usage   592 /  2048 (28%)
 0x20001c20 logging              : unused    480 usage   544 /  1024 (53%)
 0x200028e0 sys_workq            : unused    820 usage   204 /  1024 (19%)
 0x20003f00 stack_monitor        : unused   1056 usage   480 /  1536 (31%)
 0x20005a78 uart_rx_thread       : unused    180 usage  1868 /  2048 (91%) ⚠️ Danger!
 0x20006de0 idle                 : unused    256 usage    64 /   320 (20%)
```

#### 各字段核心诊断意义：

1.  **线程 ID（第一列，如 `0x20005a78`）**：
    该值即为线程控制块 `struct k_thread` 在 RAM 上的首物理地址。如果系统在后续运行中由于某种原因死机且 GDB 挂接成功，通过该物理地址能够瞬间匹配到出错线程的控制块及其对应的 CPU 寄存器上下文。
2.  **线程名称（第二列）**：
    显示通过 `k_thread_name_set()` 或静态初始化定义的名称。若该列显示为 `unnamed`，通常建议在系统初始化时补充起名逻辑，提高日志可读性。
3.  **unused（第三列，例如 `180` 字节）**：
    栈中从未被污染（即仍然是 `0xAA`）的**绝对剩余安全深度**。
4.  **usage（第四列，如 `1868 / 2048`）**：
    历史最高已用物理空间 / 静态分配栈物理总空间。
5.  **百分比（第五列）**：
    反映了栈面临溢出的紧急程度：
    *   **$P_{usage} < 40\%$ (过度配置)**：
        说明栈分配过大，存在严重的 RAM 浪费。如果设备在执行压力测试（如多协议栈并发、高频网络请求）后仍保持在 40% 以下，可将该栈大小削减 30%-50%，回收到全局内存池。
    *   **$40\% \le P_{usage} \le 80\%$ (安全运行区间)**：
        配置非常理想，既保留了充足的安全余量应对突发的软中断嵌套，又无冗余浪费。
    *   **$P_{usage} > 85\%$ (高危警戒状态)**：
        栈几乎被耗尽（例如上述 `uart_rx_thread` 仅剩 180 字节）。此时，一旦 UART 接收到长指令触发更深层次的 C 标准库字符串解析（如 `sscanf`/`printf` 内部临时申请的栈缓冲），或突然发生高优先级中断导致现场入栈，栈将瞬间越过 `0x20005a78` 物理边界，造成系统崩溃。
        **必须立刻通过 `K_THREAD_STACK_DEFINE` 增加该线程的栈容量。**
