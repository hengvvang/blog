# 第 1 章：Zephyr 线程栈分析器 (Thread Stack Analyzer) 详解

在实时操作系统中，线程栈大小通常需要在开发阶段静态分配。分配过大，会导致宝贵的 RAM 资源浪费；分配过小，则会引发不可预测的系统崩溃。Zephyr 提供的 **Thread Stack Analyzer（线程栈分析器）** 是一个强大的诊断工具，用于在运行时检测和分析每个线程栈的使用状况。本章将详细剖析其底层原理、Kconfig 配置以及生产级的集成方式。

---

## 1.1 Thread Stack Analyzer 的底层工作原理

Zephyr 的 Thread Stack Analyzer 并不依赖复杂的硬件硬件追踪器，而是通过**软件模式匹配**来估算栈的使用深度。其核心逻辑可以概括为以下步骤：

1.  **栈空间填充（Stack Initialization）**：
    在系统启动、线程被创建时，内核会对其静态分配的栈物理空间进行初始化。除非显式关闭，否则整个栈空间（除了可能存在的溢出保护区）都会被预先填充为特定的字符模式。在 Zephyr 中，默认的填充图案是单字节的 `0xAA`。

2.  **最高水位线扫描（Watermark Scanning）**：
    栈的使用方向通常是由高地址向低地址增长（以 ARM Cortex-M 为代表的递减栈）。当栈分析器被触发时，它会从栈的最低地址（Stack Limit/End）开始，向高地址方向逐字节（或逐字）扫描，寻找第一个**不等于 `0xAA`** 的字节。
    
    这个边界点被定义为**历史最高水位线（Peak Stack Usage Watermark）**。它代表了线程自启动以来，栈指针（SP）曾经到达过的最深位置。

3.  **计算公式**：
    $$\text{栈总容量 (Stack Size)} = \text{栈底地址 (Stack Base)} - \text{栈顶限制 (Stack Limit)}$$
    $$\text{未使用栈大小 (Unused Stack)} = \text{扫描到的第一个非 0xAA 字节的地址} - \text{栈顶限制}$$
    $$\text{已用最大栈大小 (Max Used Stack)} = \text{栈总容量} - \text{未使用栈大小}$$

下图展示了在递减栈结构中，内存的布局以及栈分析器的扫描方向：

```mermaid
graph TD
    subgraph 内存高地址 (Stack Base)
        direction TB
        A["栈基址 Stack Base"]
    end

    subgraph 活动栈区域
        B["当前活跃的栈帧 (Active Stack Frames)"]
        C["当前栈指针 (Current SP)"]
        D["已释放但已被污染的栈空间 (Dirty Stack Space)"]
    end

    subgraph 水位线界限
        E["历史最高水位线 (Peak Watermark / 最深非 0xAA 边界)"]
    end

    subgraph 未使用污染区
        F["未被使用的栈空间 (Filled with 0xAA)"]
    end

    subgraph 内存低地址 (Stack Limit)
        G["栈物理结束边界 Stack Limit"]
        H["硬件 MPU 保护页 (Guard Page)"]
    end

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H

    %% 扫描方向说明
    style F fill:#d4edda,stroke:#28a745,stroke-width:2px
    style E fill:#fff3cd,stroke:#ffc107,stroke-width:2px
    
    classDef scan stroke-width:2px,stroke-dasharray: 5 5;
    
    click G href "https://docs.zephyrproject.org" "Zephyr Docs"
```

> [!IMPORTANT]
> 栈分析器估算的是“历史最高水位”，如果栈中局部变量恰好被赋值为 `0xAA`，可能会产生微小的估算误差。但在实际生产中，这种误差微乎其微，不影响我们对栈安全裕度的整体评估。

---

## 1.2 关键 Kconfig 配置项说明

启用 Thread Stack Analyzer 需要在项目的 `prj.conf` 中配置一系列关键的 Kconfig 符号。这些配置将直接影响编译出的固件体积以及运行时的 CPU/RAM 开销。

```ini
# 启用线程分析核心库
CONFIG_THREAD_ANALYZER=y

# 选择输出通道（二选一或同时启用）
# 1. 使用系统日志输出分析结果（推荐，可控制日志等级与异步输出）
CONFIG_THREAD_ANALYZER_USE_LOG=y
# 2. 直接使用 printk 阻塞输出（适合简易调试或没有初始化 Logger 的早期阶段）
# CONFIG_THREAD_ANALYZER_USE_PRINTK=y

# 启用后台自动运行线程（可选）
CONFIG_THREAD_ANALYZER_AUTO=y
# 后台自动扫描的间隔时间（单位：秒）
CONFIG_THREAD_ANALYZER_AUTO_INTERVAL=10
# 后台扫描线程的栈大小（单位：字节）
CONFIG_THREAD_ANALYZER_AUTO_STACK_SIZE=1024

# 开启线程命名功能（强烈建议启用，否则在分析报告中只能显示线程的内存地址，极大增加排查难度）
CONFIG_THREAD_NAME=y
# 开启系统线程运行状态统计（可选，为分析器提供更多上下文）
CONFIG_THREAD_RUNTIME_STATS=y
```

### 开销评估 (Overhead Analysis)

*   **内存开销**：`CONFIG_THREAD_ANALYZER` 自身占用的 Flash 空间约为几百字节。若启用 `CONFIG_THREAD_ANALYZER_AUTO`，则会额外消耗一个静态线程的栈空间（如上文配置的 1024 字节）以及线程控制块（TCB）的 RAM 空间。
*   **CPU 开销**：运行一次分析需要遍历系统中所有活动线程的整个物理栈空间。如果栈容量较大（例如几十个线程，每个线程栈 2KB-8KB），逐字节扫描会消耗数毫秒至数十毫秒的 CPU 时间。因此，**在实时性要求极高的核心业务运行期间，应避免频繁或自动运行栈扫描**，或者将其设置为低优先级后台任务。

---

## 1.3 实时监控实现方法（API 与守护线程）

除了使用 Zephyr 提供的自动运行机制外，在生产级固件中，更推荐**手动调用 API 并结合自定义守护线程**进行栈状态监控。这样可以实现更灵活的报警机制，例如：当某线程的栈水位线超过 85% 时，主动通过物联网网关上报警告，或记录进非易失性存储器（Flash/EEPROM）。

### 1.3.1 核心 API 介绍

头文件：`<zephyr/debug/thread_analyzer.h>`

```c
/**
 * @brief 运行一次线程栈分析
 * 
 * @param cb 回调函数，每分析完一个线程都会调用该回调并传入分析数据
 * @param user_data 传递给回调函数的自定义用户指针
 */
void thread_analyzer_run(thread_analyzer_cb cb, void *user_data);
```

回调函数原型与信息结构体：
```c
struct thread_analyzer_info {
    const char *name;        /* 线程名称（若未启用 CONFIG_THREAD_NAME，则为 NULL） */
    const void *id;          /* 线程 ID（即 k_thread 指针） */
    size_t stack_size;       /* 静态分配的栈总大小 (bytes) */
    size_t stack_used;       /* 历史最高已用栈大小 (bytes) */
};

typedef void (*thread_analyzer_cb)(struct thread_analyzer_info *info, void *user_data);
```

### 1.3.2 生产级栈监控守护线程实现

以下是一个完整的生产级 C 代码实现，展示了如何构建一个低优先级的栈监控守护线程，在检测到高危险水位时打印警告并执行应急响应：

```c
#include <zephyr/kernel.h>
#include <zephyr/debug/thread_analyzer.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(stack_monitor, CONFIG_STACK_MONITOR_LOG_LEVEL);

#define MONITOR_INTERVAL_MS   K_MSEC(15000)   /* 每 15 秒扫描一次 */
#define WARNING_THRESHOLD_PCT 85              /* 报警水位阈值：85% */

/* 自定义上下文，用于在回调中统计异常线程数量 */
struct monitor_summary {
    uint32_t total_threads;
    uint32_t warned_threads;
};

/* 栈分析回调函数 */
static void stack_analysis_callback(struct thread_analyzer_info *info, void *user_data)
{
    struct monitor_summary *summary = (struct monitor_summary *)user_data;
    summary->total_threads++;

    /* 计算水位百分比 */
    uint32_t usage_pct = (info->stack_used * 100) / info->stack_size;
    
    /* 格式化线程名称 */
    const char *th_name = info->name ? info->name : "unnamed_thread";

    if (usage_pct >= WARNING_THRESHOLD_PCT) {
        summary->warned_threads++;
        LOG_WRN("⚠️  [STACK OVERFLOW RISK] Thread '%s' (ID: %p) is highly active! "
                "Stack Used: %u / %u bytes (%u%%)",
                th_name, info->id, (uint32_t)info->stack_used, 
                (uint32_t)info->stack_size, usage_pct);
        
        /* 
         * 此处可以加入自定义的应急响应逻辑，例如：
         * 1. 保存当前调用栈到 EEPROM
         * 2. 降低该线程优先级
         * 3. 发送异常日志至远程云端
         */
    } else {
        LOG_INF("Thread '%s' (ID: %p) -> Stack Used: %u / %u bytes (%u%%)",
                th_name, info->id, (uint32_t)info->stack_used, 
                (uint32_t)info->stack_size, usage_pct);
    }
}

/* 监控器线程入口函数 */
static void stack_monitor_thread_entry(void *p1, void *p2, void *p3)
{
    ARG_UNUSED(p1);
    ARG_UNUSED(p2);
    ARG_UNUSED(p3);

    LOG_INF("Stack usage monitor daemon started.");

    while (1) {
        struct monitor_summary summary = {0};

        LOG_INF("--- Starting thread stack diagnostic scan ---");
        
        /* 运行扫描 */
        thread_analyzer_run(stack_analysis_callback, &summary);

        LOG_INF("Scan finished. Total threads: %u, Warnings: %u", 
                summary.total_threads, summary.warned_threads);
        
        /* 进入低功耗挂起状态，不占用正常业务的 CPU 资源 */
        k_sleep(MONITOR_INTERVAL_MS);
    }
}

/* 定义监控器线程参数，使用低优先级 (K_LOWEST_APPLICATION_THREAD_PRIO) */
K_THREAD_DEFINE(stack_monitor_tid, 1536,
                stack_monitor_thread_entry, NULL, NULL, NULL,
                K_LOWEST_APPLICATION_THREAD_PRIO, 0, 0);
```

---

## 1.4 Shell 命令行交互与数据解读

当系统启用了 Zephyr Shell 工具链（`CONFIG_SHELL=y`）并集成了栈分析器 Shell 命令（`CONFIG_THREAD_ANALYSIS_SHELL=y` 或 `CONFIG_THREAD_ANALYZER_SHELL=y`），开发者可以在串口终端进行实时交互。

### 1.4.1 常用 Shell 命令

在命令行提示符下，输入以下命令可手动触发一次栈分析报告：

```bash
uart:~$ thread analyze
```

### 1.4.2 输出数据解读

执行该命令后，Shell 会打印出类似如下的表格结构：

```text
Thread analyze:
 0x20000a68 sys_workq            : unused    688 usage  336 / 1024 (32%)
 0x20001bc4 logging              : unused    512 usage  512 / 1024 (50%)
 0x200021f8 main                 : unused   1420 usage  628 / 2048 (30%)
 0x200030c0 idle                 : unused    256 usage   64 /  320 (20%)
 0x20003e40 stack_monitor        : unused   1112 usage  424 / 1536 (27%)
 0x20004f28 shell_uart           : unused    980 usage 1068 / 2048 (52%)
```

**字段解读说明**：

1.  **首列地址 (`0x2000xxxx`)**：对应线程句柄 `k_thread` 在 RAM 中的首地址。当遇到 `HardFault` 等内核级 Panic 时，配合此地址可以轻易在 GDB 中定位到底是哪一个线程发生了问题。
2.  **线程名称 (`sys_workq`, `main`, etc.)**：显示静态创建或动态修改的线程友好名称。如果为 `unnamed`，说明需要在代码中调用 `k_thread_name_set()` 进行显式命名。
3.  **unused**：该线程栈中，从未被写入过（即依然保持为 `0xAA`）的剩余空间大小（字节数）。
4.  **usage**：已使用字节数 / 栈总容量字节数。
5.  **百分比**：高水位线占栈总大小的比例。
    *   **< 50%**：属于“过度配置”（Over-provisioned）。在物理内存吃紧的设备上，可以考虑减小该线程栈的大小，优化出宝贵的 RAM。
    *   **50% - 80%**：健康状态。保留了足够的安全余量，足以应对突发的深层嵌套函数调用或中断嵌套。
    *   **> 85%**：高风险状态。在面临高频中断（ISR 嵌套）、深度调用链或特定长字符串处理时，随时可能突破栈边界，应优先考虑为其扩容。
