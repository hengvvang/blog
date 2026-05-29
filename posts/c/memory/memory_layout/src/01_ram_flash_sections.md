# Flash 与 SRAM 内存分区深剖

在嵌入式编译生成固件的过程中，链接器（Linker）扮演着决定性角色。它根据链接脚本（Linker Script）的指示，将汇编器输出的重定位目标文件（`.o`）中的各个数据段与代码段进行重组，最终生成适合烧录进 MCU 内部 Flash 并映射到物理地址空间的二进制映像。

本章将系统分析嵌入式 C 程序中的各个经典分区（`.text`、`.rodata`、`.data`、`.bss`、Stack、Heap），探讨它们在 Flash 和 SRAM 中的物理分布，以及启动代码（Startup Code）如何通过链接符号完成运行时的内存初始化。

---

## 内存分区概览

首先，我们通过下表整体梳理微控制器运行 C 程序时，各个内存分区的物理载体、生命周期与读写属性：

| 段名称 (Section) | 存放内容 | 物理介质类型 | 加载地址 (LMA) | 运行地址 (VMA) | 读写属性 | 生命周期 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`.text`** | 机器指令、汇编跳转指令 | Flash | Flash | Flash | 只读 (R) | 全局唯一，随固件生命周期 |
| **`.rodata`** | `const` 修饰的全局/静态变量、字符串常量 | Flash | Flash | Flash | 只读 (R) | 全局唯一，随固件生命周期 |
| **`.data`** | 已初始化的全局变量、已初始化的静态变量 | Flash + SRAM | Flash (镜像) | SRAM | 可读写 (RW) | 全局唯一，随程序生命周期 |
| **`.bss`** | 未初始化（或显式初始化为 0）的全局/静态变量 | SRAM | - (无需占用Flash) | SRAM | 可读写 (RW) | 全局唯一，随程序生命周期 |
| **`Stack` (栈)** | 函数局部变量、参数传递、中断现场保存、返回地址 | SRAM | - | SRAM | 可读写 (RW) | 函数调用期间，动态生存 |
| **`Heap` (堆)** | `malloc()` / `calloc()` 动态申请的内存 | SRAM | - | SRAM | 可读写 (RW) | 手动管理，直到 `free()` |

---

## 链接脚本（Linker Script）核心机理解析

链接脚本不仅定义了微控制器的物理存储空间大小，还直接控制着程序段的加载地址（LMA，Load Memory Address）与运行地址（VMA，Virtual Memory Address）的映射。对于 `.data` 段，由于其变量可读写，它必须在 SRAM 中运行（VMA）；但由于其具有初始值，其初值必须预先烧录在只读的 Flash 中（LMA），并在系统上电初始化时拷贝到 SRAM。

下面是一个典型的 ARM Cortex-M4 MCU 链接脚本（GCC 格式），展示了如何定义存储空间并摆放这些核心分区：

```ld
/* 1. 定义入口地址，复位向量 */
ENTRY(Reset_Handler)

/* 2. 物理内存段定义 */
MEMORY
{
  FLASH (rx)      : ORIGIN = 0x08000000, LENGTH = 512K
  SRAM (xrw)      : ORIGIN = 0x20000000, LENGTH = 128K
}

/* 3. 堆栈大小定义 */
_Min_Heap_Size  = 0x400;      /* 1KB */
_Min_Stack_Size = 0x800;      /* 2KB */

/* 4. 定义段的重映射与摆放 */
SECTIONS
{
  /* 中断向量表必须放在 Flash 的最前端 */
  .isr_vector :
  {
    . = ALIGN(4);
    KEEP(*(.isr_vector))
    . = ALIGN(4);
  } >FLASH

  /* 代码段 */
  .text :
  {
    . = ALIGN(4);
    *(.text)           /* 所有 .o 文件的 .text 段 */
    *(.text*)          /* 所有以 .text. 开头的段（如优化后的内联函数） */
    . = ALIGN(4);
  } >FLASH

  /* 只读数据段 */
  .rodata :
  {
    . = ALIGN(4);
    *(.rodata)
    *(.rodata*)
    . = ALIGN(4);
  } >FLASH

  /* 获取 .data 段在 Flash 中的加载地址(LMA)起始值 */
  _sidata = LOADADDR(.data);

  /* 已初始化数据段，运行时映射到 SRAM，但加载于 FLASH */
  .data :
  {
    . = ALIGN(4);
    _sdata = .;        /* 数据段在 SRAM(VMA) 中的起始地址 */
    *(.data)
    *(.data*)
    . = ALIGN(4);
    _edata = .;        /* 数据段在 SRAM(VMA) 中的结束地址 */
  } >SRAM AT> FLASH

  /* 未初始化数据段 (.bss) */
  .bss :
  {
    . = ALIGN(4);
    _sbss = .;         /* BSS段在 SRAM 中的起始地址 */
    __bss_start__ = _sbss;
    *(.bss)
    *(.bss*)
    *(COMMON)          /* 存放未定义强弱类型的全局变量 */
    . = ALIGN(4);
    _ebss = .;         /* BSS段在 SRAM 中的结束地址 */
    __bss_end__ = _ebss;
  } >SRAM

  /* 堆空间分配（用于静态边界检查） */
  .user_heap :
  {
    . = ALIGN(8);
    PROVIDE ( end = . );
    PROVIDE ( _end = . );
    . = . + _Min_Heap_Size;
    . = ALIGN(8);
  } >SRAM

  /* 栈空间分配 */
  .user_stack :
  {
    . = ALIGN(8);
    . = . + _Min_Stack_Size;
    . = ALIGN(8);
  } >SRAM

  /* 计算栈顶地址（Cortex-M 为向下生长栈，栈顶为高地址） */
  _estack = ORIGIN(SRAM) + LENGTH(SRAM);
}
```

### 关键指令解释
- `>SRAM AT> FLASH`：表示该段的运行地址（VMA）在 `SRAM` 中，而加载地址（LMA）在 `FLASH` 中。
- `LOADADDR(.data)`：链接器内置函数，用于提取指定段在 Flash 中被烧录的物理基地址。
- `PROVIDE`：定义一个符号，如果用户程序中没有定义该符号，链接器将提供默认值。
- `ALIGN(4)` / `ALIGN(8)`：要求地址向上对齐到 4 或 8 字节边界，以满足 Cortex-M 的数据对齐访问要求。

---

## 启动代码（Startup Code）的初始化过程

在上电或复位时，微控制器硬件会执行以下硬件操作：
1. 从 `0x08000000`（或当前映射的代码区基地址）读取第一个 32 位字，将其装入**主堆栈指针（MSP）**。
2. 读取第二个 32 位字（即 `Reset_Handler` 的地址），将其装入**程序计数器（PC）**，从而跳转到启动函数。

此时，SRAM 里的内容是一片随机噪声。`.data` 段的数据尚未从 Flash 复制过来，`.bss` 段也充满了垃圾数据。我们必须在跳转到 `main()` 之前，用 C 语言或汇编语言编写变量初始化逻辑：

### 用 C 语言实现启动初始化逻辑

```c
#include <stdint.h>

/* 声明链接脚本中定义的外部边界符号 */
extern uint32_t _sidata; /* .data 在 Flash 中的加载源地址 */
extern uint32_t _sdata;  /* .data 在 SRAM 中的运行目的起始地址 */
extern uint32_t _edata;  /* .data 在 SRAM 中的运行目的结束地址 */
extern uint32_t _sbss;   /* .bss  在 SRAM 中的起始地址 */
extern uint32_t _ebss;   /* .bss  在 SRAM 中的结束地址 */

/* main 外部函数声明 */
extern int main(void);

/* 系统复位中断服务函数 */
void Reset_Handler(void) {
    // 1. 初始化系统时钟与基础硬件（通常调用 SystemInit()）
    // SystemInit();

    // 2. 将已初始化的全局变量 (.data) 从 Flash 拷贝到 SRAM
    uint32_t *pSource = &_sidata;
    uint32_t *pDest   = &_sdata;

    while (pDest < &_edata) {
        *pDest++ = *pSource++;
    }

    // 3. 将未初始化的全局变量段 (.bss) 全部清零
    uint32_t *pBss = &_sbss;
    while (pBss < &_ebss) {
        *pBss++ = 0;
    }

    // 4. C++ 静态构造函数调用（如果使用 C++，在此处调用 __libc_init_array）
    // __libc_init_array();

    // 5. 跳转到用户的应用程序入口
    main();

    // 如果 main 返回，死循环防跑飞
    while (1) {
        __asm("NOP");
    }
}
```

---

## 代码与数据段在 C 语言中的直接对应关系

我们来看一段具体的 C 语言代码，以直观理解每类变量在内存中的具体归属：

```c
#include <stdlib.h>
#include <stdint.h>

// 1. 全局变量，已初始化且不为0 -> 属于 .data 段
int32_t g_init_var = 0x12345678;

// 2. 全局变量，未初始化 -> 默认初始化为0，属于 .bss 段
int32_t g_uninit_var;

// 3. 全局变量，显式初始化为0 -> 属于 .bss 段
int32_t g_zero_var = 0;

// 4. const 全局常量 -> 属于 .rodata 段，保存在 Flash 中
const uint8_t g_const_table[4] = { 0xA, 0xB, 0xC, 0xD };

// 5. 静态变量，属于模块内私有数据，但其生存周期为全局
static int32_t s_init_var = 99;    // .data
static int32_t s_uninit_var;       // .bss

void demo_function(int32_t input_param) {
    // 6. 函数参数 input_param -> 存于寄存器（如 R0），若寄存器不够用则溢出到 Stack 
    
    // 7. 局部变量 -> 存于 Stack（栈），退出函数时空间自动释放
    int32_t local_temp = 5; 
    
    // 8. 局部静态变量 -> 不在栈上分配，依然在全局数据区
    static int32_t local_static_uninit; // .bss
    static int32_t local_static_init = 100; // .data

    // 9. 局部指针变量 -> 指针本身 (ptr) 存储在 Stack 上
    uint8_t *ptr;
    
    // 10. ptr 指向的动态内存 -> 存于 Heap (堆) 空间
    ptr = (uint8_t *)malloc(32);
    if (ptr != NULL) {
        ptr[0] = 0xAA;
        free(ptr);
    }
}
```

### 内存布局物理拓扑图示

```
           +------------------------------------------+  0x08000000 (Flash 起始)
           | .isr_vector (中断向量表)                 |
           +------------------------------------------+
           | .text       (机器指令代码)                |
           +------------------------------------------+
FLASH      | .rodata     (常量、字符串)               |
           +------------------------------------------+
           | .data 镜像   (用于复制到SRAM的初始值)     | <-- _sidata 符号指向此处
           +==========================================+  0x20000000 (SRAM 起始)
           | .data 运行态 (可读写变量)                 | <-- _sdata 到 _edata
           +------------------------------------------+
           | .bss 运行态  (清零变量)                   | <-- _sbss 到 _ebss
           +------------------------------------------+
SRAM       | Heap (堆，向上增长)                      |  malloc 分配区
           |        |                                 |
           |        v                                 |
           |                                          |
           |        ^                                 |
           |        |                                 |
           | Stack (栈，向下增长)                     |  局部变量与函数调用栈帧
           +------------------------------------------+  _estack (SRAM 末尾高地址)
```

---

## 堆与栈的深度对比与冲突规避

在嵌入式系统中，堆和栈的物理边界通常直接相邻。在裸机环境下，如果两者分配的空间不合理，或者程序运行超限，就会发生灾难性的**堆栈冲突（Stack-Heap Collision）**：

### 1. 栈（Stack）
- **生长方向：** 通常向下生长（从高地址向低地址）。
- **运行特征：** 分配极快（仅需调整栈指针 SP 寄存器），无需复杂的链表查找。
- **溢出成因：**
  - **深层递归调用：** 每一级函数调用都会在栈上压入栈帧（寄存器、返回地址、参数）。
  - **庞大的局部变量：** 如在函数内部定义 `uint8_t buffer[1024]` 且未加 `static`。
  - **嵌套中断服务程序：** 多个高优先级中断同时嵌套触发，各自使用主堆栈进行现场保护。

### 2. 堆（Heap）
- **生长方向：** 通常向上生长（从低地址向高地址）。
- **运行特征：** 需要通过动态内存分配器（如 `malloc`，在底层常通过 `_sbrk` 系统调用调整堆边界）搜索空闲块链表，容易产生外部碎片。
- **碎片与失效成因：** MCU 缺乏虚拟内存重排能力，长期频繁地申请与释放非固定大小的内存，会导致内存块碎片化，最后即便空闲内存总和足够，也可能因无法找到连续的空闲区而导致 `malloc` 返回 `NULL`。

### 3. 生产级堆栈冲突防护方案

为了防止堆和栈相互覆盖，工业级代码常使用以下策略：

1. **链接脚本静态预留：** 
   在链接脚本中显式定义堆栈的最小尺寸（如前文链接脚本中的 `_Min_Heap_Size` 和 `_Min_Stack_Size`），如果编译时发现 SRAM 剩余空间不足以容纳它们，链接器将报错（`Section Limit Overflow`），避免在运行时静默崩溃。
2. **硬件 MPU（内存保护单元）防护：**
   使用 Cortex-M 内核的 MPU 模块，将栈底（栈生长的极限位置）下方的相邻区域设置为“禁止访问区”（No-Access Zone）。一旦栈发生溢出触碰到该边界，硬件将立刻触发 `MemManage` 异常，中断非法写入，保护系统核心数据。
3. **软件防线（Stack Guard Word）：**
   在栈的最底端位置（如 `_sbss` 之后或栈底边界）放置一个特殊的魔术字（如 `0xDEADBEEF`）。在 RTOS 任务调度器或定时中断中，定期检测该地址的值是否被修改。一旦魔术字被覆写，说明栈已发生溢出，立即触发告警或安全复位。
