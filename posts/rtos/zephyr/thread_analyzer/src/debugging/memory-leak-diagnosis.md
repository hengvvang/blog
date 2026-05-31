# 第三章：系统堆内存泄漏诊断与定位流程

动态内存分配（Dynamic Memory Allocation）是编写复杂固件（如网络协议栈、JSON 解析、低功耗动态任务管理等）不可或缺的基石。但在 C 语言环境中，`k_malloc` 与 `k_free` 调用的不配对极易引发**内存泄漏 (Memory Leak)**。随着物联网设备不间断运行数天甚至数月，即使每次仅泄露几个字节，也终将因**内存耗尽（OOM - Out of Memory）**引发崩溃。

本章将带您深入 Zephyr 的堆管理器底层结构，讲解如何监控堆统计数据，并构建一个可用于生产环境的、基于**前缀块头（Prefix Header）**与**金丝雀破坏检测（Tail Canary）**的高级内存泄漏追踪器（Heap Alloc Tracker）。

---

## 3.1 Zephyr 堆管理器设计与块头（Chunk Header）物理布局

Zephyr 提供两种形式的堆：
1.  **系统堆（System Heap）**：供全局调用的 `k_malloc` 空间，由 `CONFIG_HEAPS_POOL_BYTES` 定义物理大小。
2.  **自定义/用户堆（User Heaps）**：通过 `sys_heap` 结构体定义的独立内存区，提供内存物理隔离以避免模块间的相互踩踏。

### 3.1.1 Zephyr `sys_heap` 底层块结构

Zephyr 堆管理基于改良的多队列最适合度算法（Best-fit with Multi-queue）。在堆物理空间内，内存被划分为连续的 **块（Chunk）**。每个块都包含一个**块头（Chunk Header）**和**用户数据负载区**：

```text
               Zephyr 堆物理内存空间 (Sys Heap Memory Map)
               +-----------------------------------------+ High Address
               |                                         |
               |       块 N 用户数据区 (User Payload)     |
               |                                         |
               +-----------------------------------------+
               |  块 N 头 (Chunk N Header / 32或64-Bit)   | [Bit 0: Free/Used | Bits 1-31: Size]
               +-----------------------------------------+ <--- 物理上连续紧邻
               |                                         |
               |       块 N-1 用户数据区 (User Payload)   |
               |                                         |
               +-----------------------------------------+
               |  块 N-1 头 (Chunk N-1 Header)           |
               +-----------------------------------------+ Low Address
```

*   **块头结构**：为了将内存损耗降到最低，块头通常仅占用一个 Word（32位系统上为 4 字节）。其低 1 位（Bit 0）用作标记位（1 = 已分配，0 = 空闲），其余 31 位存储此块在物理上的大小（以 Word 或 Chunk 单元为单位）。
*   **内存越界危害**：当应用程序发生越界写（Buffer Overflow）时，极易将相邻块的块头标志位或大小字段覆盖。这会导致在下一次执行 `k_malloc` 遍历空闲链表或执行 `k_free` 合并相邻块时，堆管理器发生致命的内部指针损坏，直接抛出“堆已损坏（Heap Corrupted）”的 Panic 异常。

---

## 3.2 启用堆运行时统计 (CONFIG_SYS_HEAP_RUNTIME_STATS)

为了快速发现内存泄漏，我们必须能够实时跟踪系统的总空闲内存曲线。Zephyr 内置了实时的堆状态追踪：

```ini
# 启用系统堆的运行时统计
CONFIG_SYS_HEAP_RUNTIME_STATS=y
# 启用系统分配器
CONFIG_SYS_HEAP_ALLOCATOR=y
```

### 3.2.1 统计数据结构
```c
struct sys_heap_runtime_stats {
    size_t free_bytes;             /* 当前堆中可用的物理空闲字节总数 */
    size_t allocated_bytes;        /* 当前所有已分配块的载荷字节总数 */
    size_t max_allocated_bytes;    /* 自系统复位以来的历史最高占用峰值 */
};
```

### 3.2.2 编程式堆状态轮询代码
下面的 C 代码可作为一个常驻任务的一部分，在设备空闲时周期性打印堆状态，用于内存泄漏的初步判定：

```c
#include <zephyr/kernel.h>
#include <zephyr/sys/sys_heap.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(heap_diagnose, LOG_LEVEL_INF);

/* 引入 Zephyr 内部声明的全局系统堆指针 */
extern struct sys_heap _system_heap;

void dump_system_heap_health(void)
{
#if defined(CONFIG_SYS_HEAP_RUNTIME_STATS)
    struct sys_heap_runtime_stats stats;
    int err;

    /* 获取运行时堆数据 */
    err = sys_heap_runtime_stats_get(&_system_heap.heap, &stats);
    if (err == 0) {
        LOG_INF("================ HEAP STATUS ================");
        LOG_INF("  Current Free Space     : %zu bytes", stats.free_bytes);
        LOG_INF("  Current Allocated Space: %zu bytes", stats.allocated_bytes);
        LOG_INF("  Historical Max Peak    : %zu bytes", stats.max_allocated_bytes);
        LOG_INF("=============================================");
        
        /* 判定提示：若业务停止后已分配字节数仍无法回落，即高度怀疑泄漏 */
    } else {
        LOG_ERR("Failed to query runtime stats for system heap, err: %d", err);
    }
#else
    LOG_WRN("CONFIG_SYS_HEAP_RUNTIME_STATS is disabled in Kconfig!");
#endif
}
```

---

## 3.3 生产级内存泄漏追踪器实现 (Heap Alloc Tracker)

仅得知“内存减少了”并不足够，工程师必须知道“**是哪一个源文件的哪一行代码分配了这块内存而没有释放**”。

为了实现这一目标，我们可以编写一个基于**前缀块头（Prefix Block Header）**的内存分配追踪器。当我们向系统申请 $N$ 字节时，追踪器实际上会申请 $N + \text{sizeof(Header)} + \text{sizeof(Canary)}$ 字节，并将追踪元数据埋入用户指针前的阴影区。

### 3.3.1 追踪器块物理布局

```text
               内存分配物理布局 (Tracked Memory Block)
               +-----------------------------------------+ High Address
               |  尾部安全金丝雀 Tail Canary (0xEDDCBA98)| <- 溢出检测点
               +-----------------------------------------+
               |                                         |
               |  用户实际使用载荷 (User Data Payload)   | <- 返回给用户的 Ptr
               |  (Size: 'size' bytes)                   |
               |                                         |
               +-----------------------------------------+ <--- 追踪器头部终点 (Header End)
               |  前向链表指针 (prev)                    |
               +-----------------------------------------+
               |  后向链表指针 (next)                    |
               +-----------------------------------------+
               |  分配时间戳 (timestamp / Tick)          |
               +-----------------------------------------+
               |  调用行号 (line / 32-Bit)               |
               +-----------------------------------------+
               |  调用源文件指针 (const char *file)      |
               +-----------------------------------------+
               |  申请负载大小 (size / size_t)           |
               +-----------------------------------------+
               |  头部魔术字 (magic / 0x5A5A5A5A)        |
               +-----------------------------------------+ <--- 实际物理块起点 (SRAM Low Address)
```

### 3.3.2 追踪器核心代码实现

为了确保多线程并发分配时的安全性，代码中利用了互斥锁（`k_mutex`）对全局追踪链表实施同步保护：

```c
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <string.h>

LOG_MODULE_REGISTER(heap_tracker, LOG_LEVEL_INF);

#define TRACKER_MAGIC      0x5A5A5A5A
#define TAIL_CANARY        0xEDDCBA98

/* 追踪器头部结构体定义 */
struct tracker_header {
    uint32_t magic;                /* 用于校验追踪头的完整性 */
    size_t size;                   /* 载荷物理大小 */
    const char *file;              /* 分配时调用者的文件名 */
    uint32_t line;                 /* 分配时调用者的行号 */
    uint32_t timestamp;            /* 系统运行 Tick */
    struct tracker_header *next;   /* 双向链表后驱 */
    struct tracker_header *prev;   /* 双向链表前驱 */
};

/* 全局追踪链表根节点与互斥锁 */
static struct tracker_header *g_active_allocations = NULL;
static struct k_mutex g_tracker_lock;
static bool g_tracker_initialized = false;

/* 初始化追踪器互斥锁 */
static void tracker_initialize(void)
{
    if (!g_tracker_initialized) {
        k_mutex_init(&g_tracker_lock);
        g_tracker_initialized = true;
    }
}

/**
 * @brief 带追踪记录的动态内存分配函数
 */
void *tracked_malloc(size_t size, const char *file, uint32_t line)
{
    tracker_initialize();

    if (size == 0) return NULL;

    /* 计算需要分配的总物理内存：头部结构体 + 用户载荷 + 尾部校验字节 */
    size_t total_size = sizeof(struct tracker_header) + size + sizeof(uint32_t);

    k_mutex_lock(&g_tracker_lock, K_FOREVER);
    
    /* 调用 Zephyr 底层内核分配器 */
    void *raw_ptr = k_malloc(total_size);
    if (raw_ptr == NULL) {
        k_mutex_unlock(&g_tracker_lock);
        LOG_ERR("OOM: Failed to allocate memory size: %zu at [%s:%u]", size, file, line);
        return NULL;
    }

    /* 填充前缀头部 */
    struct tracker_header *header = (struct tracker_header *)raw_ptr;
    header->magic = TRACKER_MAGIC;
    header->size = size;
    header->file = file;
    header->line = line;
    header->timestamp = k_uptime_get_32();

    /* 计算用户数据指针与尾部 Canary 地址 */
    uint8_t *user_ptr = (uint8_t *)raw_ptr + sizeof(struct tracker_header);
    uint32_t *tail_canary_ptr = (uint32_t *)(user_ptr + size);
    *tail_canary_ptr = TAIL_CANARY;

    /* 将本节点插入全局双向链表头部 */
    header->prev = NULL;
    header->next = g_active_allocations;
    if (g_active_allocations != NULL) {
        g_active_allocations->prev = header;
    }
    g_active_allocations = header;

    k_mutex_unlock(&g_tracker_lock);
    return (void *)user_ptr;
}

/**
 * @brief 带追踪记录的动态内存释放函数
 */
void tracked_free(void *ptr)
{
    if (ptr == NULL) return;

    tracker_initialize();

    /* 根据用户指针逆向推算前缀头部物理起始地址 */
    struct tracker_header *header = (struct tracker_header *)((uint8_t *)ptr - sizeof(struct tracker_header));

    k_mutex_lock(&g_tracker_lock, K_FOREVER);

    /* 校验头部魔术字 */
    if (header->magic != TRACKER_MAGIC) {
        LOG_ERR("!!! FATAL: tracked_free() received pointer with invalid magic (Double Free or Corruption?) Ptr: %p", ptr);
        k_mutex_unlock(&g_tracker_lock);
        return;
    }

    /* 校验尾部金丝雀字节，检测是否发生过写越界损坏 */
    uint32_t *tail_canary_ptr = (uint32_t *)((uint8_t *)ptr + header->size);
    if (*tail_canary_ptr != TAIL_CANARY) {
        LOG_ERR("💥 [BUFFER OVERFLOW DETECTED] Memory block allocated at [%s:%u] was overwritten!", 
                header->file, header->line);
        LOG_ERR("   Expected Canary: 0x%08X, Found: 0x%08X", TAIL_CANARY, *tail_canary_ptr);
        /* 此处通常可选择挂起系统或进行内核 panic */
    }

    /* 从双向链表中移除当前节点 */
    if (header->prev != NULL) {
        header->prev->next = header->next;
    } else {
        g_active_allocations = header->next;
    }

    if (header->next != NULL) {
        header->next->prev = header->prev;
    }

    /* 清除标志位，防止重复释放 */
    header->magic = 0;

    /* 物理释放整块内存 */
    k_free(header);

    k_mutex_unlock(&g_tracker_lock);
}

/**
 * @brief 输出当前所有活跃的未释放内存块报告（诊断泄漏源）
 */
void heap_tracker_dump_leaks(void)
{
    tracker_initialize();

    k_mutex_lock(&g_tracker_lock, K_FOREVER);

    LOG_INF("============== ACTIVE HEAP LEAK DUMP ==============");
    struct tracker_header *curr = g_active_allocations;
    uint32_t leak_count = 0;
    size_t leak_total_bytes = 0;

    while (curr != NULL) {
        leak_count++;
        leak_total_bytes += curr->size;
        
        LOG_WRN("  Leak #%u: Ptr: %p, Size: %zu bytes, Alloc at [%s:%u], Life: %u ms ago",
                leak_count,
                (uint8_t *)curr + sizeof(struct tracker_header),
                curr->size,
                curr->file,
                curr->line,
                k_uptime_get_32() - curr->timestamp);
        
        curr = curr->next;
    }

    if (leak_count == 0) {
        LOG_INF("  Perfect! No active allocation leaks found in system heap.");
    } else {
        LOG_ERR("  Summary: Total Leaked Blocks: %u, Total Space: %zu bytes", 
                leak_count, leak_total_bytes);
    }
    LOG_INF("===================================================");

    k_mutex_unlock(&g_tracker_lock);
}
```

---

## 3.4 无侵入式宏重定向与编译配置

为了让常规应用代码在开发测试时能够无感使用追踪器，可在全局调试头文件 `debug_malloc.h` 中进行宏拦截：

```c
#ifndef DEBUG_MALLOC_H_
#define DEBUG_MALLOC_H_

#include <stddef.h>

void *tracked_malloc(size_t size, const char *file, uint32_t line);
void tracked_free(void *ptr);
void heap_tracker_dump_leaks(void);

#if defined(CONFIG_MY_HEAP_TRACKER_ENABLED)
    /* 利用宏覆盖标准的分配API，传入调用者物理文件名及代码行号 */
    #define k_malloc(size)      tracked_malloc(size, __FILE__, __LINE__)
    #define k_free(ptr)         tracked_free(ptr)
#endif

#endif /* DEBUG_MALLOC_H_ */
```

---

## 3.5 内存泄漏排查实战案例

### 3.5.1 场景背景：工业传感器数据打包任务

设备在进行无线 LoRaWAN 数据打包上报时，每运行几分钟就会报出 OOM。数据打包任务源码如下：

```c
#include "debug_malloc.h"
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(lora_task, LOG_LEVEL_INF);

struct sensor_payload {
    uint32_t timestamp;
    float humidity;
    float temperature;
    uint8_t *raw_sensor_data;
};

void lora_report_thread(void *p1, void *p2, void *p3)
{
    while (1) {
        /* 1. 分配负载结构体首部 */
        struct sensor_payload *payload = k_malloc(sizeof(struct sensor_payload));
        if (!payload) {
            LOG_ERR("OOM allocating payload");
            k_sleep(K_MSEC(1000));
            continue;
        }

        payload->timestamp = k_uptime_get_32();
        payload->humidity = 65.5f;
        payload->temperature = 24.2f;

        /* 2. 分配附属原始数据 buffer */
        payload->raw_sensor_data = k_malloc(128);
        if (!payload->raw_sensor_data) {
            k_free(payload);
            k_sleep(K_MSEC(1000));
            continue;
        }

        /* 模拟将打包数据发送到 LoRa 射频模块 */
        LOG_INF("Uploading Lora Frame...");

        /* 3. 错误的业务判定逻辑分支 */
        if (payload->temperature < 40.0f) {
            /* 
             * ⚠️ 致命漏洞：
             * 当温度低于 40 度时，直接跳过任务循环执行 continue。
             * 开发者遗漏了对 payload 结构体以及 raw_sensor_data 所占物理内存的释放！
             */
            LOG_DBG("Temperature normal. Skip urgent report.");
            k_sleep(K_MSEC(5000));
            continue;
        }

        /* 4. 正常释放路径 */
        k_free(payload->raw_sensor_data);
        k_free(payload);
        k_sleep(K_MSEC(5000));
    }
}
```

### 3.5.2 诊断与修复步骤

1.  **观察内存下降情况**：
    启动设备，调用之前编写的 `dump_system_heap_health`，每隔 5 秒便会发现 `Current Allocated Space` 恒定增长 156 字节（`struct sensor_payload` 大小 16 字节，外加 8 字节的 Tracking 头以及 4 字节的尾部金丝雀，外加 `128` 字节的 `raw_sensor_data` 及对应 8 字节头部和 4 字节尾部，总计 $16+12+128+12 = 168$ 字节实际堆占用）。
2.  **转储泄漏报告**：
    设备连续运行 30 秒后，通过控制台触发 `heap_tracker_dump_leaks()`，显示如下报告：
    ```text
    [00:00:30.000,000] <inf> heap_tracker: ============== ACTIVE HEAP LEAK DUMP ==============
    [00:00:30.002,000] <wrn> heap_tracker:   Leak #1: Ptr: 0x20004a88, Size: 16 bytes, Alloc at [lora_task.c:20], Life: 25000 ms ago
    [00:00:30.005,000] <wrn> heap_tracker:   Leak #2: Ptr: 0x20004ad0, Size: 128 bytes, Alloc at [lora_task.c:31], Life: 25000 ms ago
    [00:00:30.008,000] <wrn> heap_tracker:   Leak #3: Ptr: 0x20004b40, Size: 16 bytes, Alloc at [lora_task.c:20], Life: 20000 ms ago
    [00:00:30.011,000] <wrn> heap_tracker:   Leak #4: Ptr: 0x20004b88, Size: 128 bytes, Alloc at [lora_task.c:31], Life: 20003 ms ago
    [00:00:30.014,000] <err>   Summary: Total Leaked Blocks: 4, Total Space: 288 bytes
    ```
3.  **漏洞解析与修复**：
    泄漏诊断分析器精准指向了两个代码源头：
    *   `lora_task.c` 第 20 行：`payload = k_malloc(sizeof(struct sensor_payload))`
    *   `lora_task.c` 第 31 行：`payload->raw_sensor_data = k_malloc(128)`
    
    对比代码中两个分配点的执行路径，发现当温度正常（`< 40.0f`）时，没有执行释放就执行了 `continue`。
    
    **修复方法**：在 `continue` 执行之前，加入完整的内存清空释放代码：
    ```c
    if (payload->temperature < 40.0f) {
        LOG_DBG("Temperature normal. Skip urgent report.");
        k_free(payload->raw_sensor_data);
        k_free(payload);
        k_sleep(K_MSEC(5000));
        continue;
    }
    ```
4.  **最终测试**：
    修改代码后重新编译烧录，调用 `heap_tracker_dump_leaks()`，系统打印：`Perfect! No active allocation leaks found in system heap.` 内存占用回归平稳。
