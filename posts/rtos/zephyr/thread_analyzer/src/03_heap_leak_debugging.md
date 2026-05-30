# 第 3 章：动态堆内存泄漏调试 (Heap Leak Debugging)

随着固件功能的复杂度不断提高，动态内存分配（Dynamic Memory Allocation）在处理网络报文、数据序列化（如 JSON/Protobuf 解析）以及动态任务生命周期管理中变得必不可少。然而，由于没有垃圾回收机制，C 语言环境下的 `malloc`/`free` 配对错误极易引发**内存泄漏（Memory Leak）**。在连续运行数天甚至数周的嵌入式系统上，即使每次仅泄漏几个字节，也终将导致系统因“内存耗尽”（OOM - Out of Memory）而崩溃。

本章将带您深入 Zephyr 的内存堆管理器，并手把手实现一个生产级的内存泄漏追踪器（Heap Tracker），最终通过实战案例演练排查全过程。

---

## 3.1 Zephyr 内存管理机制简介 (System Heap vs User Heaps)

Zephyr 提供了两种主要的堆内存管理方式：

1.  **系统堆（System Heap）**：
    由内核统一管理的全局内存池，主要通过大家熟知的 `k_malloc()` 和 `k_free()` 进行操作。系统堆的大小由 Kconfig 中的 `CONFIG_HEAPS_POOL_BYTES` 静态指定。如果启用了用户模式（User Mode），内核会通过内部的安全检查确保非特权线程无法破坏系统堆的内部链表结构。

2.  **自定义堆/用户堆（User Heaps）**：
    使用 `sys_heap`（底层数据结构）或 `k_heap`（带线程同步的包装器）API 创建的独立内存区。它允许开发者将特定的物理 RAM（例如外部低速 SPISRAM，或内部高速 DTCM）划分为专用的堆，从而实现物理隔离，防止某个模块的内存泄漏波及整个系统的运行。

---

## 3.2 启用堆运行时统计 (CONFIG_SYS_HEAP_RUNTIME_STATS)

在调试内存泄漏的第一步，我们需要知道“**内存是在何时开始减少的**”。Zephyr 内置了堆运行状态统计模块，只需开启以下 Kconfig：

```ini
# 启用系统堆的运行时统计功能
CONFIG_SYS_HEAP_RUNTIME_STATS=y
# 启用内核内存分配器
CONFIG_SYS_HEAP_ALLOCATOR=y
```

开启后，系统会追踪堆的以下关键指标（定义于 `<zephyr/sys/sys_heap.h>` 中的 `struct sys_heap_runtime_stats`）：
*   `allocated_bytes`：当前已被占用的内存字节数。
*   `free_bytes`：当前空闲的内存字节数。
*   `max_allocated_bytes`：历史最高占用的内存峰值。

### 3.2.1 编程式获取系统堆状态

我们可以编写一个周期性统计函数，来监控系统堆的健康度：

```c
#include <zephyr/kernel.h>
#include <zephyr/sys/sys_heap.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(heap_monitor, LOG_LEVEL_DBG);

/* 获取外部声明的系统堆指针（Zephyr 内部实现中定义） */
extern struct sys_heap _system_heap;

void log_system_heap_stats(void)
{
#if defined(CONFIG_SYS_HEAP_RUNTIME_STATS)
    struct sys_heap_runtime_stats stats;
    int ret;

    ret = sys_heap_runtime_stats_get(&_system_heap.heap, &stats);
    if (ret == 0) {
        LOG_INF("====== System Heap Status ======");
        LOG_INF("Free Memory     : %zu bytes", stats.free_bytes);
        LOG_INF("Allocated Memory: %zu bytes", stats.allocated_bytes);
        LOG_INF("Peak Allocated  : %zu bytes", stats.max_allocated_bytes);
        LOG_INF("================================");
    } else {
        LOG_ERR("Failed to retrieve heap stats (err: %d)", ret);
    }
#else
    LOG_WRN("CONFIG_SYS_HEAP_RUNTIME_STATS is disabled!");
#endif
}
```

如果 `Allocated Memory` 在系统空闲时持续上升，且从未回落到初始基线，那么可以判定系统存在**内存泄漏**。

---

## 3.3 生产级内存分配追踪器实现 (Heap Allocation Tracker)

仅仅知道发生了泄漏是远远不够的，我们必须精确定位到**哪一行代码分配了这块内存却忘记释放**。

在不支持现代动态工具（如 Valgrind）的微控制器上，最有效的方法是实现一个**轻量级的堆分配追踪器**。下面我们将实现一个基于哈希表的内存追踪器，它记录了每次内存分配的：
*   内存指针（Key）
*   分配大小（Size）
*   调用文件与行号（Caller File & Line）
*   分配时的系统 Tick 数（Timestamp）

### 3.3.1 追踪器核心代码实现

为了确保线程安全，我们使用内核互斥锁（`k_mutex`）对追踪器的哈希表进行保护。

```c
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(heap_tracker, LOG_LEVEL_DBG);

#define MAX_TRACKED_ALLOCATIONS 128  /* 最大同时追踪的分配块数量 */

struct alloc_record {
    void *ptr;               /* 分配出的内存指针 */
    size_t size;             /* 申请的大小 */
    const char *file;        /* 调用者文件名 */
    uint32_t line;           /* 调用者行号 */
    uint32_t tick;           /* 分配时的 Tick */
    bool active;             /* 记录是否有效 */
};

static struct alloc_record registry[MAX_TRACKED_ALLOCATIONS];
static struct k_mutex tracker_mutex;
static bool tracker_initialized = false;

/* 初始化追踪器 */
void heap_tracker_init(void)
{
    if (!tracker_initialized) {
        k_mutex_init(&tracker_mutex);
        memset(registry, 0, sizeof(registry));
        tracker_initialized = true;
    }
}

/* 记录分配行为 */
static void record_allocation(void *ptr, size_t size, const char *file, uint32_t line)
{
    if (ptr == NULL) return;

    k_mutex_lock(&tracker_mutex, K_FOREVER);
    
    int free_slot = -1;
    for (int i = 0; i < MAX_TRACKED_ALLOCATIONS; i++) {
        if (!registry[i].active) {
            free_slot = i;
            break;
        }
    }

    if (free_slot != -1) {
        registry[free_slot].ptr = ptr;
        registry[free_slot].size = size;
        registry[free_slot].file = file;
        registry[free_slot].line = line;
        registry[free_slot].tick = k_uptime_get_32();
        registry[free_slot].active = true;
    } else {
        LOG_ERR("Tracker registry is full! Increase MAX_TRACKED_ALLOCATIONS.");
    }

    k_mutex_unlock(&tracker_mutex);
}

/* 清除释放行为 */
static void record_free(void *ptr)
{
    if (ptr == NULL) return;

    k_mutex_lock(&tracker_mutex, K_FOREVER);

    bool found = false;
    for (int i = 0; i < MAX_TRACKED_ALLOCATIONS; i++) {
        if (registry[i].active && registry[i].ptr == ptr) {
            registry[i].active = false;
            registry[i].ptr = NULL;
            found = true;
            break;
        }
    }

    if (!found) {
        /* 
         * 警告：尝试释放一个未被追踪的指针。
         * 这可能是因为指针越界、重复释放（Double Free）或该内存是由非追踪 API 分配的。
         */
        LOG_WRN("Freeing untracked pointer: %p", ptr);
    }

    k_mutex_unlock(&tracker_mutex);
}

/* 包装分配接口 */
void *tracked_malloc(size_t size, const char *file, uint32_t line)
{
    heap_tracker_init();
    void *ptr = k_malloc(size);
    if (ptr != NULL) {
        record_allocation(ptr, size, file, line);
    }
    return ptr;
}

/* 包装释放接口 */
void tracked_free(void *ptr)
{
    heap_tracker_init();
    record_free(ptr);
    k_free(ptr);
}

/* 导出未释放的活跃分配报告 */
void heap_tracker_dump_leaks(void)
{
    heap_tracker_init();
    k_mutex_lock(&tracker_mutex, K_FOREVER);

    LOG_INF("========== ACTIVE HEAP ALLOCATIONS (POTENTIAL LEAKS) ==========");
    uint32_t leaked_count = 0;
    size_t total_leaked_bytes = 0;

    for (int i = 0; i < MAX_TRACKED_ALLOCATIONS; i++) {
        if (registry[i].active) {
            leaked_count++;
            total_leaked_bytes += registry[i].size;
            LOG_WRN("Leak #%d: Ptr: %p, Size: %5zu bytes, Alloc at [%s:%u] (uptime: %u ms)",
                    leaked_count,
                    registry[i].ptr,
                    registry[i].size,
                    registry[i].file,
                    registry[i].line,
                    registry[i].tick);
        }
    }

    if (leaked_count == 0) {
        LOG_INF("Congratulations! No active heap allocations found.");
    } else {
        LOG_ERR("Total Leaked Blocks: %u, Total Size: %zu bytes", leaked_count, total_leaked_bytes);
    }
    LOG_INF("===============================================================");

    k_mutex_unlock(&tracker_mutex);
}
```

### 3.3.2 使用宏自动替换分配函数

为了对应用层代码透明，我们可以通过一个公共调试头文件（例如 `debug_malloc.h`），在 DEBUG 构建下使用宏重定向标准的 `k_malloc` 与 `k_free`：

```c
/* debug_malloc.h */
#ifndef DEBUG_MALLOC_H_
#define DEBUG_MALLOC_H_

#include <stddef.h>

void *tracked_malloc(size_t size, const char *file, uint32_t line);
void tracked_free(void *ptr);
void heap_tracker_dump_leaks(void);

#if defined(CONFIG_MY_HEAP_TRACKER_ENABLED)
    #define malloc(size)        tracked_malloc(size, __FILE__, __LINE__)
    #define free(ptr)           tracked_free(ptr)
    #define k_malloc(size)      tracked_malloc(size, __FILE__, __LINE__)
    #define k_free(ptr)         tracked_free(ptr)
#endif

#endif /* DEBUG_MALLOC_H_ */
```

> [!TIP]
> **GCC 链接器 `wrap` 选项**：
> 如果您不想在源文件中包含宏，也可以在编译选项中加入 `-Wl,--wrap=k_malloc` 和 `-Wl,--wrap=k_free`。这样，所有的 `k_malloc` 调用都会被重定向到链接器生成的 `__wrap_k_malloc` 函数中，从而实现对第三方预编译库的无侵入式监控。

---

## 3.4 内存泄漏实战排查案例

### 3.4.1 问题场景：网络数据包解析器故障

某设备在执行网络数据包解析时，出现间歇性 OOM 崩溃。该解析器线程在接收并解析 MQTT 载荷。代码简化如下：

```c
#include "debug_malloc.h"

struct packet {
    uint8_t type;
    uint32_t length;
    uint8_t *payload;
};

/* 模拟接收与解析数据包的线程 */
void packet_parser_task(void *p1, void *p2, void *p3)
{
    while (1) {
        /* 1. 模拟收到一个新数据包，为包结构体分配内存 */
        struct packet *pkt = k_malloc(sizeof(struct packet));
        if (!pkt) {
            LOG_ERR("OOM: Failed to allocate packet header");
            k_sleep(K_MSEC(1000));
            continue;
        }

        pkt->type = 0x05;
        pkt->length = 64;
        
        /* 2. 为载荷分配内存 */
        pkt->payload = k_malloc(pkt->length);
        if (!pkt->payload) {
            LOG_ERR("OOM: Failed to allocate payload buffer");
            k_free(pkt); // 释放头部
            continue;
        }

        // 填充模拟数据
        memset(pkt->payload, 0xAA, pkt->length);

        /* 3. 错误路径分支 */
        if (pkt->type == 0x05) {
            /* 
             * ⚠️ 业务逻辑错误：
             * 在特定数据包类型下直接跳出了处理流程，未释放载荷与头部！
             */
            LOG_WRN("Skip processing for type 0x05 packets");
            k_sleep(K_MSEC(2000));
            continue; 
        }

        /* 4. 正常释放路径 */
        k_free(pkt->payload);
        k_free(pkt);
        k_sleep(K_MSEC(2000));
    }
}
```

### 3.4.2 排查步骤与定位

1.  **运行监控**：
    启动设备后，观察堆监控日志，发现系统剩余内存（`Free Memory`）每过 2 秒就会减少 72 字节（`sizeof(struct packet)` (8字节) + `64`字节载荷 = 72字节）。

2.  **触发泄漏转储（Leak Dump）**：
    在设备运行 20 秒后，我们通过 Shell 或定时器调用 `heap_tracker_dump_leaks()`。终端输出如下：

```text
[00:00:20.100,000] <inf> heap_tracker: ========== ACTIVE HEAP ALLOCATIONS (POTENTIAL LEAKS) ==========
[00:00:20.102,000] <wrn> heap_tracker: Leak #1: Ptr: 0x20005a10, Size:     8 bytes, Alloc at [packet_parser.c:16] (uptime: 2000 ms)
[00:00:20.105,000] <wrn> heap_tracker: Leak #2: Ptr: 0x20005a20, Size:    64 bytes, Alloc at [packet_parser.c:24] (uptime: 2002 ms)
[00:00:20.108,000] <wrn> heap_tracker: Leak #3: Ptr: 0x20005a80, Size:     8 bytes, Alloc at [packet_parser.c:16] (uptime: 4000 ms)
[00:00:20.111,000] <wrn> heap_tracker: Leak #4: Ptr: 0x20005a90, Size:    64 bytes, Alloc at [packet_parser.c:24] (uptime: 4003 ms)
[00:00:20.114,000] <wrn> heap_tracker: Leak #5: Ptr: 0x20005af0, Size:     8 bytes, Alloc at [packet_parser.c:16] (uptime: 6000 ms)
[00:00:20.117,000] <wrn> heap_tracker: Leak #6: Ptr: 0x20005b00, Size:    64 bytes, Alloc at [packet_parser.c:24] (uptime: 6002 ms)
[00:00:20.120,000] <err> heap_tracker: Total Leaked Blocks: 6, Total Size: 216 bytes
[00:00:20.122,000] <inf> heap_tracker: ---------------------------------------------------------------
```

3.  **精准定位**：
    从 Dump 日志中，我们可以一目了然地看到：
    *   在 `packet_parser.c` 第 16 行（即 `k_malloc(sizeof(struct packet))`）分配的 8 字节块没有被释放。
    *   在 `packet_parser.c` 第 24 行（即 `k_malloc(pkt->length)`）分配的 64 字节块也没有被释放。
    *   两个泄漏块是成对出现的，且时间间隔极有规律。

4.  **漏洞修复**：
    回到源码，检查 `packet_parser.c` 中第 16 行与第 24 行之后的代码路径。可以迅速锁定 `if (pkt->type == 0x05)` 这一异常跳出分支。
    将该分支修改为先调用释放逻辑，再执行 `continue`：
    ```c
    if (pkt->type == 0x05) {
        LOG_WRN("Skip processing for type 0x05 packets");
        k_free(pkt->payload);
        k_free(pkt);
        k_sleep(K_MSEC(2000));
        continue; 
    }
    ```

5.  **回归验证**：
    重新编译运行，再次查看 `heap_tracker_dump_leaks()`，系统输出 `Congratulations! No active heap allocations found.`。内存消耗曲线归于平缓，泄漏彻底解决。
