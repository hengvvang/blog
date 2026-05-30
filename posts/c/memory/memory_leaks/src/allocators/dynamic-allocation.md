# 第一章：堆内存布局与分配器实现原理

在深入探讨动态内存泄漏与调试之前，我们必须首先理清一个核心问题：**当我们在 C 语言中调用 `malloc(size)` 或 `free(ptr)` 时，操作系统和运行时库（C Runtime Library）到底在底层做了什么？**

许多人将 `malloc` 误认为是一个简单的系统调用，但实际上，它是一个高度复杂的**用户态内存管理器**。它在操作系统内核提供的粗粒度物理页分配之上，构建了一套极其高效的细粒度“内存零售”算法。本章将从虚拟内存的逻辑视图出发，深入解析堆区布局、内核系统调用、glibc `ptmalloc` 分配器内核源码级设计（包括 Chunk 结构、Tcache 与 Bins 链表体系），最后提供一个支持 8 字节对齐、块分裂与相邻块合并的自定义内存分配器 C 语言实现。

---

## 进程虚拟内存布局与堆区位置

现代操作系统（如 Linux）通过 CPU 的**内存管理单元（MMU）**建立起虚拟地址空间（Virtual Address Space）到物理内存（Physical RAM）的映射。在 64 位 x86_64 体系下，用户态进程拥有高达 256TB（48位地址线）的虚拟地址空间。

一个典型 Linux 进程的虚拟内存空间布局（从低地址到高地址）如下所示：

```text
       +------------------------------------+ <--- 0x7FFFFFFFFFFF (用户空间最高虚拟地址)
       |      内核空间 (Kernel Space)        | 
       |      (仅内核态可访问，用户态受保护)  |
       +------------------------------------+ <--- 0x800000000000
       |      环境变量 & 命令行参数          |
       +------------------------------------+
       |  用户栈区 (Stack Segment)           | <--- 向低地址生长 (Downwards)
       |  (存储局部变量、函数参数、栈帧信息)  |
       |                 |                  |
       |                 v                  |
       +------------------------------------+
       |                                    |
       |     共享库和匿名映射区 (Mmap)       | <--- 用于动态库加载、大块匿名映射
       |                                    |
       +------------------------------------+
       |                 ^                  |
       |                 |                  |
       |  用户堆区 (Heap Segment)            | <--- 向高地址生长 (Upwards)
       |  (动态分配，终点为 Program Break)   |
       +------------------------------------+ <--- Program Break 指针 (brk/sbrk 控制点)
       |  未初始化全局数据区 (BSS Segment)    |
       +------------------------------------+
       |  已初始化全局数据区 (Data Segment)   |
       +------------------------------------+
       |  只读代码段 (Text Segment)           |
       +------------------------------------+ <--- 0x000000000000 (低地址起点)
```

### 虚拟内存空间的各个核心区域详解：

1.  **代码段（Text Segment）：** 存储可执行的二进制 CPU 机器指令。此区域通常是只读的，防止程序在运行时意外或恶意修改自身指令。
2.  **数据段（Data Segment）：** 包含程序中已初始化的全局变量和静态变量（如 `int global_var = 42;`）。其空间大小在编译链接阶段确定。
3.  **BSS 段（Block Started by Symbol）：** 包含未初始化的全局和静态变量（如 `int global_uninit;`）。在程序加载阶段，内核会自动将该区域全部清零。
4.  **堆区（Heap Segment）：** 动态内存分配的场所。堆的起点紧随 BSS 段之后，向高地址方向延伸。堆的顶端由一个名为 **Program Break**（程序断点）的指针标记。堆的分配和释放完全由程序员通过 `malloc`/`free` 系列 API 控制。
5.  **内存映射段（Memory Mapping Segment / Mmap）：** 用于加载动态共享库（如 `libc.so`）、文件映射（通过 `mmap` 系统调用）以及大块匿名物理内存的分配。它自顶向下或自底向上生长，取决于系统内核配置。
6.  **栈区（Stack Segment）：** 存储局部变量、函数参数以及函数调用时的上下文（返回地址、寄存器状态）。栈由编译器自动生成管理指令，在运行时由 CPU 栈指针寄存器（如 `%rsp`）直接控制，自高地址向低地址快速生长。栈的大小通常受到内核严格限制（如 `ulimit -s` 限制的 8MB）。

---

## 核心系统调用：`brk`/`sbrk` 与 `mmap`

用户态的 `malloc` 库并不是凭空产生内存的，它必须向操作系统内核申请虚拟内存页（以 4KB 为基本单位）。当 `malloc` 收到内存请求时，会根据请求的大小，选择不同的底层系统调用来向内核“批发”虚拟空间：

```text
                         +-----------------------------+
                         |     C 应用程序 (用户态)      |
                         +-----------------------------+
                                     |
                                     | 调用 malloc(size)
                                     v
                        +-------------------------------+
                        | glibc ptmalloc 用户态分配管理器 |
                        +-------------------------------+
                               /                 \
                 小于 128KB   /                   \   大于等于 128KB
                (小额分配)   /                     \  (大额分配)
                            v                       v
                     +------------+           +------------+
                     | brk / sbrk |           |    mmap    |
                     +------------+           +------------+
                            \                       /
                             \ 触发缺页中断时映射    /
                              v                   v
                        +-------------------------------+
                        |       Linux 内核 (内核态)      |
                        +-------------------------------+
```

### 1. `brk` 与 `sbrk`：扩展堆顶断点（针对小额分配）

当申请的内存小于阈值（glibc 中默认为 128KB，由 `M_MMAP_THRESHOLD` 决定）时，分配器使用 `brk` 或 `sbrk` 系统调用来抬高堆顶的 Program Break 指针，使堆区向高地址方向扩展。

```c
#include <unistd.h>

int brk(void *addr);
void *sbrk(intptr_t increment);
```

*   **`brk(addr)`**：直接将进程的 Program Break 指针设置为指定的虚拟地址 `addr`。若成功返回 0，失败返回 -1 并设置 `errno`。
*   **`sbrk(increment)`**：将 Program Break 指针向高地址移动 `increment` 字节。若 `increment` 为 0，则返回当前堆顶的虚拟地址；若 `increment` 为正数，则将堆顶抬高，并返回**移动前**的旧堆顶虚拟地址（即新分配内存的起点）。

#### sbrk 移动过程示意图：
```text
      低地址                                                             高地址
      =========================================================================>
      |      BSS 段      |     已分配堆空间     |  新分配虚拟空间  |  未分配虚拟空间  |
      =========================================================================>
                                             ^                 ^
                                             |                 |
                                      旧 Program Break   新 Program Break
                                    (sbrk 移动前的返回值) (sbrk(increment) 之后)
```

> [!NOTE]
> **延迟绑定（Lazy Allocation）**：无论是 `brk` 还是 `mmap`，在成功执行系统调用后，内核仅在页表（Page Table）中分配了虚拟地址范围，并**没有**立刻分配物理内存页。只有当程序首次读写这块新分配的虚拟内存时，CPU 会触发**缺页中断（Page Fault）**，内核才会去物理内存中寻找空闲页帧，并将其与虚拟地址建立映射关系。这极大节省了系统资源。

### 2. `mmap` 与 `munmap`：匿名映射（针对大额分配）

当分配请求大小超过 `M_MMAP_THRESHOLD`（通常为 128KB 至 512KB）时，为了防止在堆区内部留下大量无法归还给操作系统的碎空闲块，`malloc` 会调用 `mmap` 在虚拟内存映射区申请一块独立的虚拟内存空间。

```c
#include <sys/mman.h>

void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
int munmap(void *addr, size_t length);
```

*   在 `malloc` 中，大内存的匿名映射调用方式如下：
    ```c
    void *ptr = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    ```
    *   `addr = NULL`：由操作系统自动选择合适的虚拟地址进行映射。
    *   `length`：需要分配的内存字节数（会自动对齐到 4KB 页面边界）。
    *   `PROT_READ | PROT_WRITE`：映射区域可读、可写。
    *   `MAP_PRIVATE | MAP_ANONYMOUS`：私有映射且为匿名映射（不关联任何物理文件，数据保存在物理 RAM 中，与文件描述符无关）。
    *   `fd = -1`, `offset = 0`：因为是匿名映射，文件描述符和偏移量被忽略。
*   **物理内存释放**：当对这块内存调用 `free(ptr)` 时，分配器内部会立即调用 `munmap(ptr, length)`。操作系统内核会立即销毁对应的页表映射，将物理页回收，这块虚拟内存会立即交还给内核。而使用 `brk`/`sbrk` 扩展的内存，即使调用 `free` 也通常无法立即交还操作系统，只能退回到分配器的空闲链表中等待复用。

---

## 现代分配器元数据管理（以 glibc `ptmalloc` 为例）

为了高效管理分配出的内存并实现高频复用，分配器必须知道每一块已分配或已释放内存的**大小**与**状态**。这些信息就保存在内存块的头部，称为**元数据（Metadata）**。

### 1. 堆块（Chunk）的物理布局

在 glibc `ptmalloc` 中，内存的分配单位是 `malloc_chunk`（堆块）。它的结构非常紧凑，根据使用状态（In-Use）与空闲状态（Free），其内部字段的物理复用逻辑如下：

#### A. 处于使用状态中的 Chunk 物理结构：
```text
+-----------------------+-----------------------+
|  prev_size (8 bytes)  | 如果前一个相邻 chunk 是空闲的，记录其物理大小；若前块已分配，此空间可复用为前块用户数据 |
+-----------------------+-----------------------+
|    size (8 bytes)     | 当前 chunk 的总大小（包括头部），由于对齐，低 3 位用作状态标志位 [A|M|P]      |
+-----------------------+-----------------------+ <--- malloc(N) 返回给用户的指针 ptr 指向这里
|                                               |
|               用户数据区 (User Data)           |
|               (大小为 8 或 16 字节对齐)         |
|                                               |
+-----------------------------------------------+
```

*   **`prev_size`**：仅在前一个相邻低地址 chunk 是空闲状态（Free）时有效，记录前块大小。如果前块正在被使用，`prev_size` 字段是无用的，为了节省内存，前块的用户数据会直接延伸并覆盖写入这个 8 字节空间（这称为“空间复用”）。
*   **`size`**：表示当前 chunk 的总大小（单位是字节）。在 64 位系统上，所有 chunk 大小必须按 16 字节对齐，因此 `size` 值的低 3 位（bit 2, bit 1, bit 0）必然为 0。分配器复用了这 3 位作为控制标志：
    *   **`A` (NON_MAIN_ARENA, 值为 0x4)**：非主分配区标志。1 表示该 chunk 来自线程创建的次要分配区（Non-main Arena），0 表示来自进程主分配区（Main Arena）。
    *   **`M` (IS_MMAPPED, 值为 0x2)**：通过 `mmap` 匿名映射分配标志。1 表示是通过 `mmap` 分配的大内存，0 表示通过 `brk` 扩展堆分配。
    *   **`P` (PREV_INUSE, 值为 0x1)**：前一相邻物理堆块使用标志。1 表示前一个相邻堆块正在被使用，0 表示前一相邻堆块空闲。**这是 `free` 时判断是否与前一相邻块进行内存合并的关键依据。**

#### B. 处于空闲状态中的 Chunk 物理结构：
当一个 chunk 被 `free` 后，它内部的用户数据区不再起作用。分配器会将其改写为指针链表节点，用于将空闲块组织起来：
```text
+-----------------------+-----------------------+
|  prev_size (8 bytes)  | 前一个相邻块空闲时，记录其大小（同上）                                        |
+-----------------------+-----------------------+
|    size (8 bytes)     | 当前 chunk 的总大小，低 3 位 [A|M|P]                                        |
+-----------------------+-----------------------+ <--- 链表指针复用了原本的用户数据区
|      fd (8 bytes)     | Forward Pointer：指向当前 Bins 链表中的下一个空闲 Chunk                         |
+-----------------------+-----------------------+
|      bk (8 bytes)     | Backward Pointer：指向当前 Bins 链表中的前一个空闲 Chunk                        |
+-----------------------+-----------------------+
|  fd_nextsize (8bytes) | 仅在 Largebin 中有效：指向下一个不同大小的空闲 Chunk                             |
+-----------------------+-----------------------+
|  bk_nextsize (8bytes) | 仅在 Largebin 中有效：指向前一个不同大小的空闲 Chunk                             |
+-----------------------+-----------------------+
```

### 2. 线程缓存与空闲链表（Bins）体系

当程序频繁调用 `free` 时，分配器并不会立刻通过 `sbrk` 收缩堆空间（因为系统调用有较大的上下文切换开销），而是将空闲堆块根据大小和分类，放入不同的“回收箱”——**Bins** 中，以便下次 `malloc` 时实现 $O(1)$ 或 $O(\log N)$ 的极速复用。

glibc 的空闲链表体系包括：

```text
               +-------------------------------------------------------+
               |                    malloc(size)                       |
               +-------------------------------------------------------+
                                           |
                                           v
               +-------------------------------------------------------+
               | 1. Tcache (Thread Cache - 线程局部无锁单向链表)        |
               +-------------------------------------------------------+
                                           | (未命中)
                                           v
               +-------------------------------------------------------+
               | 2. Fastbins (小对象无合并单向链表, LIFO)               |
               +-------------------------------------------------------+
                                           | (未命中)
                                           v
               +-------------------------------------------------------+
               | 3. Unsorted Bin (未分类空闲块缓冲双向链表, 合并整理)     |
               +-------------------------------------------------------+
                                           | (未命中)
                                           v
               +-------------------------------------------------------+
               | 4. Smallbins (固定大小双向链表, FIFO, <1024B)          |
               +-------------------------------------------------------+
                                           | (未命中)
                                           v
               +-------------------------------------------------------+
               | 5. Largebins (范围大小排序双向链表, 支持拆分)           |
               +-------------------------------------------------------+
                                           | (未命中)
                                           v
               +-------------------------------------------------------+
               | 6. Top Chunk (堆顶最后的预留空间，若仍不够则调用 sbrk)   |
               +-------------------------------------------------------+
```

*   **Tcache (Thread Local Cache)**：从 glibc 2.26 引入。每个线程独占一个缓存结构，包含 64 个单向链表。每个链表最多存放 7 个相同大小的空闲 chunk（范围在 24 到 1032 字节之间）。由于是线程局部存储（TLS），存取时**不需要加锁**，性能极高。
*   **Fastbins**：快速回收箱。单向链表，采用后进先出（LIFO）策略。用于存放小尺寸的空闲块（通常 $\le 80$ 字节，最大可配置至 160 字节）。为了保证极速存取，Fastbins 中的 chunk 释放后**不会被清除 PREV_INUSE 标志，也不会与相邻空闲块合并**。
*   **Unsorted Bin**：未分类回收箱。双向链表。除了 Tcache 和 Fastbin 之外，所有被释放的堆块首先进入这里。它是分配器的一个高效缓冲区。在随后的 `malloc` 动作遍历该链表时，分配器会尝试整理这些块：能直接满足请求的就分配出去，否则将其从 Unsorted Bin 移出，正确分类并归档到对应的 Smallbins 或 Largebins 中。
*   **Smallbins**：小型回收箱。双向链表，采用先进先出（FIFO）策略。共有 62 个 Smallbin，每个 Smallbin 链表内只包含**完全相同尺寸**的空闲 chunk（16、32、48... 直至小于 1024 字节）。
*   **Largebins**：大型回收箱。双向链表。共有 62 个 Largebin，用于存储 $\ge 1024$ 字节的空闲块。每个 Largebin 存放的是一个**大小范围**内的空闲块，块在链表内部按照大小从大到小降序排列，以便在分配大内存时进行快速检索。

---

## 堆碎片（Heap Fragmentation）的成因与类型

频繁的动态内存申请与释放，很容易导致物理内存的低效利用。这种现象被称为堆碎片，主要分为两类：

### 1. 内部碎片（Internal Fragmentation）
*   **物理表现**：
    ```text
    +-----------------------------------------------+
    |            用户申请的 17 字节数据               | 对齐填充 (15 字节) |
    +-----------------------------------------------+-----------------+
    |<------------------------- 实际分配的 Chunk 大小 (32 字节) ------------->|
    ```
*   **成因**：为了提高内存访问效率（如 CPU 数据对齐要求）以及简化分配器的元数据管理，分配器通常会对申请的大小进行对齐向上取整（例如 8 字节或 16 字节对齐）。如果用户申请 17 字节，分配器实际给出了 32 字节。
*   **影响**：多分配的 15 字节由于被分配器控制头视作该 chunk 的一部分，无法分配给其他请求，造成了微量但高频的内存隐形浪费。

### 2. 外部碎片（External Fragmentation）
*   **物理表现**：
    ```text
    +-----------+-----------+-----------+-----------+-----------+
    |  已占块 A  |  空闲块 B  |  已占块 C  |  空闲块 D  |  已占块 E  |  <-- 堆区现状
    |  (16 KB)  |  (32 KB)  |  (16 KB)  |  (32 KB)  |  (16 KB)  |
    +-----------+-----------+-----------+-----------+-----------+
    ```
*   **成因**：在程序运行中，交替释放了 B 块和 D 块。此时系统共有 64KB 的空闲内存，但它们在物理地址上是**不连续**的。如果程序此时申请一块 48KB 的连续内存，分配器将无法使用 B 块或 D 块进行响应，只能继续向内核调用 `sbrk` 抬高 Program Break 来获取更多空间。
*   **危害**：导致进程的虚拟内存和物理内存占用不断膨胀，甚至在系统明明还有大量剩余物理内存的情况下，由于找不到连续的空间而抛出 `ENOMEM`（内存不足）错误崩溃。
*   **对抗策略**：分配器在 `free` 时检测前后相邻块的 `P` 位，如果为空闲状态则执行**合并（Coalescing）**，将离散的碎小块融合成一个大块。

---

## 自定义内存分配器实现

为了深入理解分配器管理的本质，我们将在 C 语言中，使用 Linux 标准的用户态堆底 `sbrk` 调用，从零实现一个具备 First-Fit（首次适应）搜索算法、8 字节对齐、块分裂（Split）以及相邻块立即合并（Coalescing）的自定义内存分配器。

### 1. 核心设计框图与对齐算术

*   **8字节对齐**：为了满足 CPU 存取效率，所有返回的地址必须是 8 字节的倍数。我们使用位运算宏 `ALIGN(size)`：
    ```c
    #define ALIGN(size) (((size) + 7) & ~7)
    ```
*   **元数据控制头**：我们定义一个 `BlockHeader` 链表结构，隐式存放在用户数据指针的左侧：
    ```c
    typedef struct BlockHeader {
        size_t size;               // 用户数据区的大小（不含头部自身）
        int is_free;               // 是否空闲标记：1 代表空闲，0 代表正在使用
        struct BlockHeader* next;   // 指向下一个物理相邻的内存块控制头
    } BlockHeader;
    ```
    在 64 位系统上，`BlockHeader` 结构体的大小为 `8 + 4 + 8 = 20` 字节。通过 `ALIGN` 宏对齐后，控制头实际占用 `24` 字节。

#### 内存块物理连续链表布局：
```text
  global_free_list_head
         |
         v
  +------------------+     +------------------+     +------------------+
  | BlockHeader 1    |     | BlockHeader 2    |     | BlockHeader 3    |
  | size: 32         |     | size: 64         |     | size: 16         |
  | is_free: 0       |     | is_free: 1       |     | is_free: 0       |
  | next: ----------->---->| next: ----------->---->| next: NULL       |
  +------------------+     +------------------+     +------------------+
  |  用户数据区 1    |     |  用户数据区 2    |     |  用户数据区 3    |
  |  (32 bytes)      |     |  (64 bytes)      |     |  (16 bytes)      |
  +------------------+     +------------------+     +------------------+
  ^                        ^                        ^
  block1                   block2                   block3
  (malloc 返回 block1+1)    (空闲块可被复用/分裂)     (sbrk 申请的新堆底)
```

### 2. 自定义分配器完整实现 (`my_allocator.c`)

请阅读下方带有详尽注释的生产级 C 语言源码实现：

```c
#include <stddef.h>
#include <unistd.h>
#include <stdio.h>
#include <stdint.h>
#include <assert.h>

// 将传入的大小向上对齐到 8 字节的倍数
// 例如：ALIGN(3) -> 8; ALIGN(8) -> 8; ALIGN(9) -> 16
#define ALIGN(size) (((size) + 7) & ~7)

// 内存块控制头
typedef struct BlockHeader {
    size_t size;               // 实际分配给用户的数据区大小（不含 BlockHeader 自身）
    int is_free;               // 状态标志：0 表示占用，1 表示空闲
    struct BlockHeader* next;   // 链表指针，指向物理地址相邻的下一个堆块
} BlockHeader;

// 元数据头部占用空间，必须进行 8 字节对齐
#define BLOCK_HEADER_SIZE ALIGN(sizeof(BlockHeader))

// 全局堆内存物理链表头指针
static BlockHeader* global_free_list_head = NULL;

/**
 * @brief 使用 First-Fit (首次适应) 策略在空闲链表中寻找合适的块
 * @param last 出参，保存遍历到的最后一个块，方便后续申请新空间时进行追加链接
 * @param size 对齐后的请求大小
 * @return 找到的符合条件的空闲块指针；若未找到返回 NULL
 */
static BlockHeader* find_free_block(BlockHeader** last, size_t size) {
    BlockHeader* current = global_free_list_head;
    while (current) {
        if (current->is_free && current->size >= size) {
            return current;
        }
        *last = current;
        current = current->next;
    }
    return NULL;
}

/**
 * @brief 向操作系统内核申请物理页扩展堆顶 (通过 sbrk 系统调用)
 * @param last 当前链表的尾节点，新申请的块将追加到该节点后
 * @param size 对齐后的用户数据区大小
 * @return 新分配的块控制头指针；若系统内存耗尽返回 NULL
 */
static BlockHeader* request_space_from_os(BlockHeader* last, size_t size) {
    // 获取当前堆顶的 Program Break 地址
    BlockHeader* block = (BlockHeader*)sbrk(0);
    
    // 物理分配的总虚拟空间：控制头大小 + 对齐后的用户数据区大小
    size_t total_size = BLOCK_HEADER_SIZE + size;
    
    // 调用 sbrk 移动堆顶指针
    void* request = sbrk(total_size);
    if (request == (void*)-1) {
        return NULL; // 内存不足，sbrk 失败
    }
    
    // 如果链表不为空，将新块挂载到现有链表的尾部
    if (last) {
        last->next = block;
    }
    
    block->size = size;
    block->is_free = 0;
    block->next = NULL;
    
    return block;
}

/**
 * @brief 块分裂 (Splitting)：将一个过大的空闲块拆分为两块，减少内部碎片
 * @param block 待分裂的空闲块控制头指针
 * @param size 用户请求的对齐大小
 */
static void split_block(BlockHeader* block, size_t size) {
    // 分裂阈值：剩余空间必须能容纳一个完整的 BlockHeader 加上最少 8 字节的数据区
    // 否则进行分裂反而会增加控制头的开销，得不偿失
    if (block->size >= size + BLOCK_HEADER_SIZE + 8) {
        // 计算分裂出的新空闲块的起始物理地址
        BlockHeader* new_block = (BlockHeader*)((char*)block + BLOCK_HEADER_SIZE + size);
        
        // 初始化新分裂出的空闲块控制头
        new_block->size = block->size - size - BLOCK_HEADER_SIZE;
        new_block->is_free = 1;
        new_block->next = block->next;
        
        // 修正原块的尺寸，并将新块插入链表
        block->size = size;
        block->next = new_block;
    }
}

/**
 * @brief 首次适应动态内存分配函数
 * @param size 用户请求分配的字节数
 * @return 指向已分配内存的指针（已对齐）；若失败返回 NULL
 */
void* my_malloc(size_t size) {
    if (size <= 0) {
        return NULL;
    }
    
    // 对齐用户请求的字节大小
    size_t aligned_size = ALIGN(size);
    BlockHeader* block = NULL;
    
    // 1. 若为首次分配，则直接向系统申请空间
    if (global_free_list_head == NULL) {
        block = request_space_from_os(NULL, aligned_size);
        if (!block) {
            return NULL;
        }
        global_free_list_head = block;
    } else {
        BlockHeader* last = global_free_list_head;
        // 2. 遍历链表寻找满足大小的空闲块
        block = find_free_block(&last, aligned_size);
        if (block) {
            // 3. 找到后尝试对其进行分裂，防止大块小用造成内部碎片
            split_block(block, aligned_size);
            block->is_free = 0;
        } else {
            // 4. 未找到空闲块，通过 sbrk 向内核申请新空间并挂载到链表尾部
            block = request_space_from_os(last, aligned_size);
            if (!block) {
                return NULL;
            }
        }
    }
    
    // 关键点：返回跳过 BlockHeader 控制头之后的实际数据区指针
    return (void*)(block + 1);
}

/**
 * @brief 空闲块合并 (Coalescing)：遍历物理相邻的节点，合并连续的空闲块以对抗外部碎片
 */
static void coalesce_free_blocks() {
    BlockHeader* current = global_free_list_head;
    while (current && current->next) {
        // 如果当前块和下一个相邻块均为空闲状态，则进行物理合并
        if (current->is_free && current->next->is_free) {
            // 当前块的大小累加：下块的数据区大小 + 下块控制头本身大小
            current->size += BLOCK_HEADER_SIZE + current->next->size;
            // 从物理链表中剥离下块
            current->next = current->next->next;
        } else {
            current = current->next;
        }
    }
}

/**
 * @brief 动态内存释放函数
 * @param ptr 指向需要释放的内存的指针
 */
void my_free(void* ptr) {
    if (!ptr) {
        return;
    }
    
    // 核心算术：通过用户指针回退 1 个 BlockHeader 的步长，定位到头部元数据
    BlockHeader* block = (BlockHeader*)ptr - 1;
    
    // 防御性断言，防止对未分配或已释放的块重复操作
    assert(block->is_free == 0);
    
    // 标记为闲置
    block->is_free = 1;
    
    // 释放后立即扫描整个堆链表，对物理上连续的空闲空洞进行深度合并
    coalesce_free_blocks();
}

// ==================== 验证测试驱动程序 ====================

/**
 * @brief 打印当前自定义堆的物理链表结构，用于直观分析
 */
void print_heap_layout(const char* stage) {
    printf("\n>>> Heap Layout [%s] <<<\n", stage);
    BlockHeader* curr = global_free_list_head;
    int index = 0;
    while (curr) {
        printf("  Block [%02d] | Addr: %p | Free: %d | DataSize: %4zu Bytes | Next: %p\n",
               index++, (void*)curr, curr->is_free, curr->size, (void*)curr->next);
        curr = curr->next;
    }
    printf("===========================================\n");
}

int main() {
    printf("[Init] Size of BlockHeader: %zu, Aligned size: %zu\n", 
           sizeof(BlockHeader), BLOCK_HEADER_SIZE);
    
    // 1. 连续分配 3 块内存
    int* arr1 = (int*)my_malloc(10 * sizeof(int));      // 40 字节 -> 对齐到 40 字节
    char* str2 = (char*)my_malloc(100 * sizeof(char));   // 100 字节 -> 对齐到 104 字节
    double* dbl3 = (double*)my_malloc(5 * sizeof(double)); // 40 字节 -> 对齐到 40 字节
    
    print_heap_layout("Step 1: After 3 allocations");
    
    // 2. 释放中间的块 str2，制造空闲空洞（外部碎片雏形）
    printf("\n--> Freeing str2 (中间块)...\n");
    my_free(str2);
    print_heap_layout("Step 2: After freeing str2 (Middle void created)");
    
    // 3. 申请一个较小的内存块，观察 First-Fit 匹配与 Split 分裂行为
    printf("\n--> Allocating tmp4 (24 Bytes, fits into str2 slot)...\n");
    char* tmp4 = (char*)my_malloc(24); // 24 字节正好能放进 104 字节中，并满足分裂条件
    print_heap_layout("Step 3: After allocating tmp4 (Split occurs)");
    
    // 4. 释放 tmp4 和 dbl3，观察相邻物理空闲块的 Coalesce 合并
    printf("\n--> Freeing tmp4 and dbl3 to trigger coalescing...\n");
    my_free(tmp4);
    my_free(dbl3); // 此时堆中会产生连续的空闲区，将触发合并
    print_heap_layout("Step 4: After freeing tmp4 and dbl3 (Coalescing complete)");
    
    // 5. 释放最后剩下的 arr1，堆恢复全空闲且单一节点状态
    printf("\n--> Freeing arr1 (最后剩下的占用块)...\n");
    my_free(arr1);
    print_heap_layout("Step 5: Final State (All merged into one big free block)");
    
    return 0;
}
```

### 3. 指针算术核心机制深度剖析

在该自定义分配器中，有两个关键设计支撑着其稳定运行：

*   **指针平移 `(BlockHeader*)ptr - 1`**：
    在 C 语言的指针算术中，对类型为 `T*` 的指针加减整数 `N`，其在内存中的实际地址偏移量是 `N * sizeof(T)`。由于我们在分配时返回给用户的地址是 `block + 1`，它在地址上向右偏过了 `BLOCK_HEADER_SIZE`。在 `my_free` 时，我们将 `void* ptr` 先强转为 `BlockHeader*`，然后减 1，物理地址就会精确向左回退 `sizeof(BlockHeader)` 字节，完美重新定位到存放控制头的首地址。
*   **分裂（Split）与合并（Coalesce）的临界条件**：
    在 `split_block` 中，我们做了一个防御性检查：`block->size >= size + BLOCK_HEADER_SIZE + 8`。如果不做此限制，分裂出一个只有 1 字节数据区的空闲块，其所需的控制头却需要占用 24 字节。这种“元数据膨胀”会导致堆区极度低效。因此，只有当剩余空闲块足够大，且除去控制头后至少还能存放 8 字节用户数据时，分裂才被执行。
