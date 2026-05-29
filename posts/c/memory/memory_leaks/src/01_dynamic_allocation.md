# 第一章：堆内存布局与分配器实现原理

在深入探讨动态内存泄漏与调试之前，我们必须首先理清一个核心问题：**当我们在 C 语言中调用 `malloc(size)` 时，操作系统和运行时库到底在底层做了什么？**

本章将从虚拟内存的物理及逻辑视图出发，深入解析 `malloc`/`free` 的工作逻辑、核心系统调用（`brk`/`sbrk` 与 `mmap`）、堆内存碎片的成因，并提供一个基于 C 语言编写的、具备元数据管理与空闲块合并功能的自定义堆内存分配器。

---

## 进程虚拟内存布局与堆区位置

在现代多任务操作系统中，每个进程都拥有独立的**虚拟地址空间（Virtual Address Space）**。通过内存管理单元（MMU）的分页机制，虚拟地址被映射到物理内存或磁盘交换分区（Swap）。

对于一个标准的 32 位或 64 位 Linux 进程，其虚拟地址空间布局如下：

```mermaid
stone
graph TD
    Kernel[内核空间 Kernel Space - 高地址]
    Stack[栈区 Stack - 向低地址生长]
    MMap[内存映射段 Memory Mapping Segment - 动态链接库/匿名映射]
    Heap[堆区 Heap - 向高地址生长]
    BSS[未初始化全局/静态数据区 BSS - .bss]
    Data[已初始化全局/静态数据区 Data - .data]
    Text[代码段 Text - .text / 低地址]

    Kernel --> Stack
    Stack -->|生长方向 ↓| MMap
    MMap --> Heap
    Heap -->|生长方向 ↑| BSS
    BSS --> Data
    Data --> Text
```

### 虚拟内存空间的各个核心区域：

1.  **代码段（Text Segment）：** 存储可执行的二进制机器指令，只读且在程序运行期间大小固定。
2.  **数据段（Data Segment）：** 包含程序中已初始化的全局变量和静态变量。
3.  **BSS 段（Block Started by Symbol）：** 包含程序中未初始化（或初始化为 0）的全局和静态变量，在程序加载时由内核清零。
4.  **堆区（Heap Segment）：** 动态内存分配的场所。堆的起点紧随 BSS 段之后，随着分配请求的增加而向高地址方向生长。堆的顶端由一个名为 **Program Break**（程序断点）的指针所标记。
5.  **内存映射段（Memory Mapping Segment）：** 用于加载动态共享库、文件映射（通过 `mmap`）以及大块匿名物理内存的分配。
6.  **栈区（Stack Segment）：** 存放函数的局部变量、参数和返回地址。它从高地址向低地址生长，由编译器和 CPU 自动管理。

堆区是唯一一个需要用户手动向操作系统申请，并在生命周期结束时手动退还的庞大虚拟空间。

---

## 核心系统调用：`brk`/`sbrk` 与 `mmap`

C 标准库提供的 `malloc` 和 `free` 并不是直接控制物理硬件，而是作为**用户态内存分配器**运行在内核之上。为了响应进程的内存请求，`malloc` 会通过以下两组系统调用向操作系统内核“批发”虚拟内存，再在用户态进行“零售”。

### 1. `brk` 与 `sbrk` 系统调用

对于**小额内存请求**（在 glibc 中通常小于 128KB，由 `M_MMAP_THRESHOLD` 参数决定），`malloc` 使用 `brk` 或 `sbrk` 调整堆的边界。

```c
#include <unistd.h>

int brk(void *addr);
void *sbrk(intptr_t increment);
```

*   **`brk(addr)`：** 直接将程序断点（Program Break）设置为指定的虚拟地址 `addr`。成功时返回 0，失败时返回 -1。
*   **`sbrk(increment)`：** 将程序断点增加 `increment` 字节。如果 `increment` 为 0，则返回当前 Program Break 的地址。如果 `increment` 为正数，则堆区扩大，返回分配前的旧堆顶地址。

```text
       +------------------------------------+ <--- 新的 Program Break (sbrk(increment))
       |                                    |
       |         新分配的堆内存空间         |
       |                                    |
       +------------------------------------+ <--- 旧的 Program Break (_end)
       |                                    |
       |         已分配的堆内存             |
       |                                    |
       +------------------------------------+ <--- 堆起点
```

**特点：** 通过 `sbrk`/`brk` 分配的内存，其物理页并不会立刻绑定。只有当程序发生读写，触发**缺页中断（Page Fault）**时，操作系统内核才会真正分配物理内存页并建立 MMU 页表映射。

### 2. `mmap` 与 `munmap` 系统调用

对于**大额内存请求**（通常 $\ge$ 128KB），为了避免堆内严重的碎片化（后面会详细探讨），`malloc` 会绕过 `sbrk`，直接使用 `mmap` 在**内存映射段**申请一块独立的匿名虚拟内存。

```c
#include <sys/mman.h>

void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
int munmap(void *addr, size_t length);
```

*   在 `malloc` 中，通常这样调用 `mmap`：
    ```c
    void *ptr = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    ```
    *   `MAP_ANONYMOUS`：表示进行匿名内存映射，不与任何物理文件关联。
    *   `fd = -1`，`offset = 0`：因为是匿名映射，忽略文件描述符。
*   **释放机制：** 当调用 `free` 释放这块大内存时，`malloc` 内部会直接调用 `munmap` 将该虚拟内存还给内核，从而立即释放物理内存。

---

## 现代分配器（以 glibc `ptmalloc` 为例）的元数据管理

在 C 语言中，当我们调用 `free(ptr)` 时，我们并没有传入需要释放的字节大小。分配器是如何知道 `ptr` 指向的内存有多长呢？

这就是**元数据（Metadata）**的作用。现代内存分配器在分配堆块时，会在返回给用户的地址之前，静默地加上一个控制头（Header）。

### 1. 堆块（Chunk）的物理结构

在 glibc `ptmalloc` 中，每一个被分配或空闲的内存块被称为一个 `chunk`。它的结构设计十分精妙：

```text
+------------------------------+------------------------------+
|      prev_size (8 bytes)     | 如果前一个相邻 chunk 是空闲的，记录其大小 |
+------------------------------+------------------------------+
|        size (8 bytes)        | 当前 chunk 的总大小（含头），低3位作标志位  | A | M | P |
+------------------------------+------------------------------+ <--- malloc 返回的指针 ptr 指向这里
|                                                             |
|                    用户数据区 (User Data)                    |
|                                                             |
+-------------------------------------------------------------+
```

*   **`prev_size`**：如果相邻的前一个堆块（低地址方向）是空闲的，则此字段记录前一堆块的大小；若前一堆块已被占用，此字段可复用为前一堆块的用户数据区尾部（节省内存）。
*   **`size`**：当前 chunk 的总大小。因为 64 位系统下内存通常按 8 字节或 16 字节对齐，这意味着 `size` 值的低 3 位永远是 0。分配器便巧妙地复用了这低 3 位作为状态标志位：
    *   **`A` (NON_MAIN_ARENA)**：是否不属于主分配区（0 表示属于，1 表示不属于）。
    *   **`M` (IS_MMAPPED)**：是否是通过 `mmap` 匿名映射分配的。
    *   **`P` (PREV_INUSE)**：前一个相邻的堆块是否处于使用状态（1 表示已占用，0 表示空闲）。这是**内存块合并（Coalescing）**的核心依据。
*   **用户指针 `ptr`**：`malloc(N)` 返回的指针其实指向的是 `chunk + 16` 字节（在 64 位系统上）的位置，即避开了 `prev_size` 和 `size` 的头部。

### 2. 垃圾回收与空闲链表（Bins）

当程序释放内存时，分配器为了下次能够复用这块空间，并不会立刻通过 `sbrk` 缩小堆（这涉及到昂贵的系统调用和上下文切换），而是将空闲的 chunk 放入称为 **Bins（箱子）** 的双向/单向链表中：

*   **Fastbins**：单向链表，用于存放小内存块（如 < 80 字节）。不进行内存合并，分配和释放速度极快（LIFO）。
*   **Unsorted Bin**：双向链表，释放的块首先放在这里。在垃圾回收和下一次 `malloc` 遍历时，分配器会尝试整理这里的块并分类放入其他 bin 中。
*   **Smallbins / Largebins**：分别存储固定大小和范围大小的空闲块，支持块拆分与合并。

---

## 堆碎片（Heap Fragmentation）的成因与类型

在长生命周期的复杂 C 程序中，频繁地申请和释放大小不一的内存，会导致堆空间变得像蜂窝一样千疮百孔。这就是堆碎片问题，它分为两种：

```text
【内部碎片示意】
+-----------------------+--------+
|   用户请求 (10字节)    | 对齐损耗|  <- 实际分配了 16 字节，6 字节为内部碎片
+-----------------------+--------+

【外部碎片示意】
+-----------+-----------+-----------+-----------+
|  已占块A   | 空闲块B    |  已占块C   | 空闲块D    |  <- 存在两个 10KB 空闲块，但无法分配
|  (10KB)   | (10KB)    |  (10KB)   | (10KB)    |     一个 20KB 的连续空间
+-----------+-----------+-----------+-----------+
```

### 1. 内部碎片（Internal Fragmentation）
*   **成因**：由于内存对齐要求（如 8 字节对齐），或者分配器设计中固定的堆块大小限制，导致分配给程序的内存空间大于其实际请求的空间。
*   **影响**：这部分多分配的内存无法被程序有效利用，也无法分配给其他请求，造成微量浪费。

### 2. 外部碎片（External Fragmentation）
*   **成因**：堆内存中存在大量离散的、细小的空闲内存块。虽然它们的总和很大，但由于不连续，当程序请求一块较大的连续内存时，分配器无法满足该请求，不得不继续向操作系统申请扩充堆。
*   **危害**：会导致进程的虚拟内存和物理内存消耗持续攀升，甚至在系统内存依然充足的假象下抛出 `ENOMEM`（内存不足）错误。

---

## 自定义内存分配器实现（First-Fit, 8字节对齐, 块分裂与合并）

为了将上述理论转化为切实的工程理解，我们将使用标准的 `sbrk` 系统调用，在 C 语言中从零开始构建一个具备工业雏形的自定义堆内存分配器。

### 1. 分配器核心逻辑设计

我们的分配器需要具备以下功能：
1.  **内存对齐**：所有返回给用户的地址必须是 8 字节对齐的。
2.  **元数据控制头**：使用链表节点结构标记每一块内存的属性。
3.  **First-Fit 策略**：遍历空闲块链表，找到第一个足够容纳请求大小的空闲块。
4.  **块分裂（Split）**：当找到的空闲块比请求的尺寸大得多时，将其拆分为两块，避免造成严重的内部碎片。
5.  **块合并（Coalescing）**：当用户释放内存时，自动检查并将其与物理上相邻的空闲块合并，对抗外部碎片。

### 2. 自定义分配器源码实现 (`my_malloc.c`)

下面是完整的、包含测试驱动的自定义堆内存分配器实现：

```c
#include <stddef.h>
#include <unistd.h>
#include <stdio.h>
#include <stdint.h>
#include <assert.h>

// 8字节对齐宏
#define ALIGN(size) (((size) + 7) & ~7)

// 内存块元数据控制头
typedef struct BlockHeader {
    size_t size;               // 数据区大小（不含 Header 自身）
    int is_free;               // 标志位：0-正在使用，1-空闲
    struct BlockHeader* next;   // 指向下一个物理相邻（或链表中）的内存块
} BlockHeader;

// 元数据头部的大小（8字节对齐）
#define BLOCK_HEADER_SIZE ALIGN(sizeof(BlockHeader))

// 堆的起始节点指针（链表头）
static BlockHeader* global_free_list_head = NULL;

/**
 * @brief 在已有的链表中寻找符合 First-Fit 策略的空闲内存块
 */
static BlockHeader* find_free_block(BlockHeader** last, size_t size) {
    BlockHeader* current = global_free_list_head;
    while (current && !(current->is_free && current->size >= size)) {
        *last = current;
        current = current->next;
    }
    return current;
}

/**
 * @brief 向操作系统申请扩展堆内存（通过 sbrk）
 */
static BlockHeader* request_space_from_os(BlockHeader* last, size_t size) {
    BlockHeader* block = (BlockHeader*)sbrk(0);
    // 申请的总虚拟空间：元数据头大小 + 用户数据区大小
    size_t total_size = BLOCK_HEADER_SIZE + size;
    
    // 扩展 Program Break 指针
    void* request = sbrk(total_size);
    if (request == (void*)-1) {
        return NULL; // sbrk 失败（内存耗尽）
    }
    
    if (last) { // 挂载到现有链表的尾部
        last->next = block;
    }
    
    block->size = size;
    block->is_free = 0;
    block->next = NULL;
    
    return block;
}

/**
 * @brief 分裂一个过大的空闲内存块，减少内部碎片
 */
static void split_block(BlockHeader* block, size_t size) {
    // 剩余空间必须大于元数据头 + 最小对齐字节（8字节），否则分裂不划算
    if (block->size >= size + BLOCK_HEADER_SIZE + 8) {
        // 计算分裂出的新块地址
        BlockHeader* new_block = (BlockHeader*)((char*)block + BLOCK_HEADER_SIZE + size);
        new_block->size = block->size - size - BLOCK_HEADER_SIZE;
        new_block->is_free = 1;
        new_block->next = block->next;
        
        block->size = size;
        block->next = new_block;
    }
}

/**
 * @brief 自定义 malloc
 */
void* my_malloc(size_t size) {
    if (size <= 0) {
        return NULL;
    }
    
    // 保证请求字节数 8 字节对齐
    size_t aligned_size = ALIGN(size);
    
    BlockHeader* block;
    
    if (global_free_list_head == NULL) {
        // 第一次调用分配器，直接向系统申请
        block = request_space_from_os(NULL, aligned_size);
        if (!block) {
            return NULL;
        }
        global_free_list_head = block;
    } else {
        BlockHeader* last = global_free_list_head;
        // 尝试寻找满足 First-Fit 的空闲块
        block = find_free_block(&last, aligned_size);
        if (block) {
            // 找到空闲块，尝试进行块分裂
            split_block(block, aligned_size);
            block->is_free = 0;
        } else {
            // 找不到，只能向系统要新内存并链接到尾部
            block = request_space_from_os(last, aligned_size);
            if (!block) {
                return NULL;
            }
        }
    }
    
    // 返回跳过 Header 之后的实际用户数据区指针
    return (void*)(block + 1);
}

/**
 * @brief 合并相邻的空闲块（Coalescing）
 */
static void coalesce_free_blocks() {
    BlockHeader* current = global_free_list_head;
    while (current && current->next) {
        if (current->is_free && current->next->is_free) {
            // 将下一个块的尺寸以及它的 Header 空间合入当前块
            current->size += BLOCK_HEADER_SIZE + current->next->size;
            current->next = current->next->next;
        } else {
            current = current->next;
        }
    }
}

/**
 * @brief 自定义 free
 */
void my_free(void* ptr) {
    if (!ptr) {
        return;
    }
    
    // 通过指针回退拿到 BlockHeader 地址
    BlockHeader* block = (BlockHeader*)ptr - 1;
    assert(block->is_free == 0);
    
    // 标为闲置
    block->is_free = 1;
    
    // 立即执行相邻空闲块合并，对抗外部碎片
    coalesce_free_blocks();
}

// ==================== 测试驱动程序 ====================
void dump_heap_structure(const char* stage) {
    printf("\n--- Heap Structure [%s] ---\n", stage);
    BlockHeader* curr = global_free_list_head;
    int index = 0;
    while (curr) {
        printf("Block [%d] | Address: %p | Free: %d | Size: %zu (Bytes) | Next: %p\n",
               index++, (void*)curr, curr->is_free, curr->size, (void*)curr->next);
        curr = curr->next;
    }
    printf("------------------------------------\n");
}

int main() {
    printf("Header struct size: %zu, aligned to: %zu\n", sizeof(BlockHeader), BLOCK_HEADER_SIZE);
    
    // 1. 分配三个块
    int* p1 = (int*)my_malloc(10 * sizeof(int)); // 40 字节 -> 8字节对齐
    char* p2 = (char*)my_malloc(100 * sizeof(char)); // 100 字节 -> 对齐至 104 字节
    double* p3 = (double*)my_malloc(5 * sizeof(double)); // 40 字节
    
    dump_heap_structure("After Allocating P1, P2, P3");
    
    // 2. 释放中间的块 P2，制造空闲空洞
    printf("\nFreeing P2...\n");
    my_free(p2);
    dump_heap_structure("After Freeing P2");
    
    // 3. 申请一个较小的块，观察 First-Fit 匹配与分裂
    printf("\nAllocating P4 (24 Bytes, fits in P2 slot)...\n");
    char* p4 = (char*)my_malloc(24);
    dump_heap_structure("After Allocating P4 (Splitting P2)");
    
    // 4. 释放 P4 和 P3，观察块连续合并
    printf("\nFreeing P4 and P3 to trigger coalescing...\n");
    my_free(p4);
    my_free(p3); // P3 与 P4 物理相邻且均为空闲，触发合并
    dump_heap_structure("After Freeing P4 and P3 (Coalesced)");
    
    // 释放最后一个 P1
    my_free(p1);
    dump_heap_structure("Final Heap state (All Free & Coalesced)");
    
    return 0;
}
```

### 3. 运行分析与核心机制理解

在这段代码中：
*   **指针算术操作 `(BlockHeader*)ptr - 1`**：利用了 C 语言的类型系统。当 `ptr` 为 `void*` 转为 `BlockHeader*` 后，对其减 1，指针实际上向前平移了 `sizeof(BlockHeader)` 字节，即重定位到隐藏在用户数据前方的元数据区。
*   **`coalesce_free_blocks` 的时机**：在 `my_free` 被触发后直接启动，它遍历链表，一旦发现相邻的两个节点都是 `is_free == 1`，就进行链表解点合并。这极大地缓解了由于多次释放导致堆内满是细小碎片的状况。
