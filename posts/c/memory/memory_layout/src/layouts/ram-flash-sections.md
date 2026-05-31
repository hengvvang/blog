# 第一章：RAM 与 Flash 物理分区及数据段分配

在嵌入式开发中，将 C 语言编译成二进制机器码只是第一步。要让这些代码在特定的微控制器（MCU）上正确运行，链接器（Linker）必须精确地知道物理芯片的内存边界，以及如何安排代码与数据的存放位置。这一过程由**链接脚本（Linker Script）**和**启动文件（Startup Code）**协同完成。

本章将系统分析嵌入式 C 程序中的各个经典分区（`.text`、`.rodata`、`.data`、`.bss`、Stack、Heap），探讨它们在 Flash 和 SRAM 中的物理分布，深入剖析链接脚本的配置，并详细讲解上电初始化阶段的内存搬移与清零逻辑。

---

## 内存分区物理载体与运行期属性

微控制器内的物理内存介质根据其电气特性和访问总线，承载着不同的程序分区。下表详细罗列了这些分区的关键特征：

| 段名称 (Section) | 存放物理内容 | 物理介质类型 | 加载地址 (LMA) | 运行地址 (VMA) | 读写属性 | 硬件访问总线 (Cortex-M) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`.text`** | 机器指令、指令跳转表、汇编函数 | Flash | Flash | Flash | 只读 (R) | I-Code (指令总线) |
| **`.rodata`** | `const` 全局/静态变量、字符串常量、Lookup Table (查找表) | Flash | Flash | Flash | 只读 (R) | D-Code (数据总线) |
| **`.data`** | 已初始化且非零的全局变量、静态变量 | Flash + SRAM | Flash (初始化镜像) | SRAM (运行态) | 可读写 (RW) | System 总线 / D-Code (Flash侧) |
| **`.bss`** | 未初始化或显式初始化为 0 的全局/静态变量 | SRAM | - (不占Flash空间) | SRAM | 可读写 (RW) | System 总线 |
| **`Stack` (栈)** | 函数局部变量、中断上下文压栈帧、返回地址、参数传递 | SRAM | - (不占Flash空间) | SRAM | 可读写 (RW) | System 总线 |
| **`Heap` (堆)** | 通过 `malloc()` 动态申请的内存空间 | SRAM | - (不占Flash空间) | SRAM | 可读写 (RW) | System 总线 |

---

## 链接脚本（Linker Script）核心配置解析

链接脚本（通常以 `.ld` 为后缀）主要起两个作用：
1. **定义物理内存结构（MEMORY 块）：** 声明芯片内 Flash 与 SRAM 的起始地址和物理大小。
2. **定义输出段布局（SECTIONS 块）：** 指导链接器将所有输入目标文件（`.o`）的段按顺序组合，并指明它们的加载地址与运行地址。

### 生产级链接脚本（GCC 格式）实例

下面是一个针对标准 Cortex-M4 微控制器的链接脚本实现：

```ld
/* 1. 声明固件的程序入口点，复位向量的起始函数 */
ENTRY(Reset_Handler)

/* 2. 定义微控制器的物理存储空间映射 */
MEMORY
{
  /* 只读存储器：起始于 0x08000000，大小为 512KB，具备可读(r)与可执行(x)属性 */
  FLASH (rx)      : ORIGIN = 0x08000000, LENGTH = 512K
  
  /* 可读写存储器：起始于 0x20000000，大小为 128KB，具备可读(r)、可写(w)与可执行(x)属性 */
  SRAM (xrw)      : ORIGIN = 0x20000000, LENGTH = 128K
}

/* 3. 静态预留堆和栈的大小，用于链接阶段的溢出检查 */
_Min_Heap_Size  = 0x0400;      /* 预留 1KB 堆空间 */
_Min_Stack_Size = 0x0800;      /* 预留 2KB 栈空间 */

/* 4. 段排布指令 */
SECTIONS
{
  /* 中断向量表段：必须放在 FLASH 存储器的最前端，以便 CPU 复位时读取 */
  .isr_vector :
  {
    . = ALIGN(4);             /* 确保当前地址指针按 4 字节对齐 */
    KEEP(*(.isr_vector))     /* 强制保留该段，即便在链接器垃圾回收(--gc-sections)时也不被裁剪 */
    . = ALIGN(4);
  } >FLASH

  /* 代码段 */
  .text :
  {
    . = ALIGN(4);
    *(.text)                 /* 包含所有输入文件的 .text 段 */
    *(.text*)                /* 包含所有输入文件的 .text.* 段 (例如 -ffunction-sections 产生的细分函数段) */
    *(.glue_7)               /* ARM/Thumb 交互执行汇编代码段（兼容性考虑） */
    *(.glue_7t)
    *(.eh_frame)             /* 异常处理帧段 */
    
    KEEP(*(.init))           /* 静态构造初始化段 */
    KEEP(*(.fini))           /* 静态析构清理段 */
    
    . = ALIGN(4);
  } >FLASH

  /* 只读数据段 */
  .rodata :
  {
    . = ALIGN(4);
    *(.rodata)               /* 包含所有输入文件的 .rodata 段 */
    *(.rodata*)              /* 包含所有输入文件的 .rodata.* 段 */
    . = ALIGN(4);
  } >FLASH

  /* 定义符号保存 .data 段在 FLASH 中烧录的起始物理地址 (LMA) */
  _sidata = LOADADDR(.data);

  /* 已初始化全局数据段：运行地址(VMA)在 SRAM，但加载地址(LMA)在 FLASH */
  .data : 
  {
    . = ALIGN(4);
    _sdata = .;              /* 标记 .data 运行地址在 SRAM 中的起始位置 */
    *(.data)                 /* 包含所有输入文件的 .data 段 */
    *(.data*)                /* 包含所有输入文件的 .data.* 段 */
    . = ALIGN(4);
    _edata = .;              /* 标记 .data 运行地址在 SRAM 中的结束位置 */
  } >SRAM AT> FLASH          /* 指明 VMA 映射到 SRAM，LMA 映射到 FLASH */

  /* 未初始化全局数据段（需要在上电时清零） */
  .bss :
  {
    . = ALIGN(4);
    _sbss = .;               /* 标记 .bss 在 SRAM 中的起始地址 */
    __bss_start__ = _sbss;
    *(.bss)                  /* 包含所有输入文件的 .bss 段 */
    *(.bss*)                 /* 包含所有输入文件的 .bss.* 段 */
    *(COMMON)                /* 包含未定义强弱类型的通用变量 */
    . = ALIGN(4);
    _ebss = .;               /* 标记 .bss 在 SRAM 中的结束地址 */
    __bss_end__ = _ebss;
  } >SRAM

  /* 用户堆空间段：用于静态编译检查，确保 SRAM 空间足够 */
  .user_heap :
  {
    . = ALIGN(8);            /* 堆空间通常需要 8 字节对齐（以满足 double 或 long long 的对齐要求） */
    PROVIDE ( end = . );     /* 提供标准动态库所需的 _end 符号 */
    PROVIDE ( _end = . );
    . = . + _Min_Heap_Size;  /* 强行向下偏移以预留大小 */
    . = ALIGN(8);
  } >SRAM

  /* 用户栈空间段 */
  .user_stack :
  {
    . = ALIGN(8);            /* 栈空间也必须 8 字节对齐 */
    . = . + _Min_Stack_Size; /* 预留栈的大小 */
    . = ALIGN(8);
  } >SRAM

  /* 计算栈顶地址 (Cortex-M 为向下生长栈，栈顶位于预留空间的最高端) */
  _estack = ORIGIN(SRAM) + LENGTH(SRAM); /* 也可以定义为栈的物理尾部 */
}
```

### 关键指令与语法剖析
* **VMA 与 LMA 的分离：**
  汇编与 C 中的指针访问都基于运行地址（VMA）。对于 `.data`，指令 `>SRAM AT> FLASH` 告知链接器：该段所有变量的绝对寻址地址都应基于 `SRAM` 基地址（VMA）；但在生成用于烧录的镜像文件时，它的原始数据（初值）必须存放在 `FLASH` 中（LMA），紧接着 `.rodata` 段。
* **定位器符号（Location Counter `.`）：**
  代表当前的输出字节偏移量。修改定位器符号（如 `. = ALIGN(4);` 或 `. = . + 0x100;`）会改变其后所有变量在最终固件中的排布地址。
* **`KEEP()` 函数：**
  当编译器开启 `-fdata-sections` 和 `-ffunction-sections`，且链接器使用 `--gc-sections` 优化选项时，未被其他代码直接引用的段（如中断向量表）会被自动移除。使用 `KEEP()` 能强行保留该段不被删除。

---

## 启动代码（Startup Code）的初始化机理

上电或复位时，微控制器处于最原始的裸机状态，SRAM 中的数据是随机的。Cortex-M 内核硬编码了复位初期的硬件步骤：

```
上电复位 -> 从 0x08000000 读取 MSP 栈顶指针 -> 从 0x08000004 读取 Reset_Handler 地址 -> PC 指针指向 Reset_Handler 并开始执行
```

为了使 C 语言环境就绪，启动代码必须完成三件事：
1. 调用 `SystemInit()` 完成最基本的硬件时钟、片外存储控制器等配置（如果有必要）。
2. 将可读写全局变量段 `.data` 的初始值从 Flash 复制到 SRAM。
3. 将未初始化的 `.bss` 段在 SRAM 中全部写入 `0` 值。

### 生产级 C 语言启动初始化实现

在传统的微控制器工程中，这段逻辑通常用汇编（如 `startup_stm32f4xx.s`）实现，但也可以完全用清晰的 C 语言来实现（对于理解内存拷贝逻辑更为直观）：

```c
#include <stdint.h>

/* 
 * 引入链接脚本中导出的边界地址符号。
 * 注意：这些符号只是地址标签，本身不占用物理存储。
 * 我们需要获取它们的地址，而不是它们的值。
 */
extern uint32_t _sidata; /* .data 在 Flash 中的加载源物理起始地址 */
extern uint32_t _sdata;  /* .data 在 SRAM 中的运行目的起始地址 */
extern uint32_t _edata;  /* .data 在 SRAM 中的运行目的结束地址 */
extern uint32_t _sbss;   /* .bss  在 SRAM 中的起始地址 */
extern uint32_t _ebss;   /* .bss  在 SRAM 中的结束地址 */
extern uint32_t _estack; /* 栈顶地址，系统复位时加载到主堆栈指针 MSP */

/* 外部 main 函数和硬件 SystemInit 函数声明 */
extern int main(void);
extern void SystemInit(void);

/* 
 * 中断向量表：必须被定位到 .isr_vector 段中。
 * 向量表的第一项是 MSP 栈顶值，第二项是复位入口函数地址。
 */
__attribute__((section(".isr_vector"), used))
void (* const g_pfnVectors[])(void) = {
    (void (*)(void))&_estack,  /* 主堆栈指针的初始值 (MSP) */
    &Reset_Handler,            /* 复位服务入口 */
    // 后续可以继续列出 NMI_Handler, HardFault_Handler 等...
};

/* 复位异常入口函数 */
void Reset_Handler(void) {
    // 1. 调用硬件底层时钟及基础寄存器初始化
    SystemInit();

    // 2. 拷贝 .data 数据段：将初始镜像从 Flash 转移到 SRAM 中
    uint32_t *pSource = &_sidata;
    uint32_t *pDest   = &_sdata;

    // 按 32 位（4 字节）宽度进行高效的块数据拷贝
    while (pDest < &_edata) {
        *pDest++ = *pSource++;
    }

    // 3. 清零 .bss 数据段：确保所有未初始化全局变量在 main 运行前都为 0
    uint32_t *pBss = &_sbss;
    while (pBss < &_ebss) {
        *pBss++ = 0;
    }

    // 4. 执行 C++ 的静态全局构造函数（若使用纯 C 开发则无需开启）
    // extern void __libc_init_array(void);
    // __libc_init_array();

    // 5. 正式进入 C 语言环境的用户主函数
    main();

    // 6. 防跑飞死循环：如果 main 函数异常退出，在此挂起处理器
    while (1) {
        __asm("NOP");
    }
}
```

---

## 内存物理拓扑图示（Memory Map）

以下是编译、加载与上电执行后的 MCU 物理内存全景图。图示展示了程序段从 Flash 中被映射并重定位到 SRAM 中的对应关系：

```
       物理 FLASH 空间 (LMA)                         物理 SRAM 空间 (VMA)
+--------------------------------+ 0x08000000
| .isr_vector (中断向量表)       |
+--------------------------------+
| .text       (机器指令代码)      |
+--------------------------------+
| .rodata     (只读数据常量)      |
+--------------------------------+
| .data 镜像   (初始化值)          | ----- 拷贝 -----+
+--------------------------------+                |
|                                |                |
|       (Flash 剩余未用空间)      |                |
|                                |                |
+--------------------------------+                |
                                                  |
                                                  v
                                         +--------------------------------+ 0x20000000
                                         | .data 运行态 (可读写全局变量)   | (由 _sdata 到 _edata)
                                         +--------------------------------+
                                         | .bss 运行态 (已清零全局变量)    | (由 _sbss 到 _ebss)
                                         +--------------------------------+
                                         | Heap 堆空间 (向高地址方向生长)   |
                                         |          |                     |
                                         |          v                     |
                                         |                                |
                                         |          ^                     |
                                         |          |                     |
                                         | Stack 栈空间 (向低地址方向生长)  |
                                         +--------------------------------+
                                         | 栈底 (预留栈的最底部)          | <-- _estack - _Min_Stack_Size
                                         |                                |
                                         | 栈顶 (系统复位时加载的值)      | <-- _estack (SRAM 的最高物理边界)
                                         +--------------------------------+
```

---

## 堆与栈的深度对比与冲突规避

在没有 MMU 保护的 MCU 架构中，堆（Heap）和栈（Stack）共享同一块物理 SRAM。栈通常从高地址向下（低地址）生长，而堆从低地址向上（高地址）生长。如果程序运行超限，两者就会发生灾难性的相撞，即**堆栈冲突（Stack-Heap Collision）**，这会破坏正常的数据结构，导致不可预测的崩溃。

### 1. 栈（Stack）的特征与溢出分析
* **数据结构与硬件机制：**
  栈的推进是通过调整 CPU 的主堆栈指针（MSP）或进程堆栈指针（PSP）实现的。当执行 `PUSH` 或进行函数调用时，SP 指针递减；执行 `POP` 或函数返回时，SP 指针递增。这种硬件级行为使栈的分配不需要搜索空闲链表，效率为 \\(O(1)\\)。
* **栈帧（Stack Frame）结构：**
  当函数被调用时，它会在栈上分配一个栈帧，包含输入参数、局部变量以及返回地址（LR）。而在中断发生时，内核会自动在栈上压入 8 个寄存器的值（R0-R3、R12、LR、PC、xPSR），称为自动压栈（Auto-Stacking）。
* **溢出成因：**
  - **深层递归：** 递归深度过大，导致不断生成新的栈帧，最终耗尽栈空间。
  - **超大局部变量：** 在函数内定义巨大的局部数组（如 `uint8_t buffer[1024]`）而未加 `static` 关键字。
  - **多重中断嵌套：** 多个高优先级中断接连触发，硬件多次执行自动压栈，使 MSP 迅速耗尽。

### 2. 堆（Heap）的特征与碎片化
* **分配算法：**
  动态内存分配器（如 `malloc()`）在底层通过 `sbrk` 机制移动堆的最大边界。分配器内部维护了一个空闲内存块链表。
* **碎片化隐患：**
  由于 MCU 上不存在虚拟地址重映射，内存分配器无法对物理内存进行“整理和移动”。如果频繁地申请和释放不同大小的临时内存，堆中就会产生大量的**外部碎片**。最终导致的结果是：虽然空闲内存总和足够大，但在申请大块连续内存时，依然会因为找不到满足要求的整块内存而返回 `NULL`。

### 3. 生产级堆栈冲突防护方案

在工业级高可靠性代码中，通常采用以下三重防线来保护堆栈不发生越界冲突：

#### 第一防线：链接脚本静态空间预留
如前文链接脚本所示，必须显式定义堆和栈的物理边界：
```ld
_Min_Heap_Size  = 0x0400; /* 预留 1KB */
_Min_Stack_Size = 0x0800; /* 预留 2KB */
```
链接器会在最终输出阶段计算已占用的 RAM（`.data` + `.bss` + `.user_heap` + `.user_stack`）是否超出了实际物理 SRAM 的长度限制。一旦超出，编译阶段将立刻报出链接错误，从源头杜绝了因 RAM 物理不足而引发的溢出。

#### 第二防线：硬件内存保护单元（MPU）强防护
对于带有 MPU 的处理器（如 Cortex-M4/M7/M33），在上电初始化时，可以将**栈的生长极限地址（即栈底下方相邻的 32 字节区域）**配置为“禁止读写区域（No-Access Zone）”：

```
SRAM 高地址 ->  +-----------------------------+
               | Stack 正常运行区域          |
               |                             | (向下生长)
               |                             |     v
栈底边界 ---->  +-----------------------------+
               | MPU 保护区 (No-Access, 32B) | <-- 一旦 SP 越界触碰此区域，立刻触发 MemManage Fault
               +-----------------------------+
               | Heap 空间                   | (向上生长)
SRAM 低地址 ->  +-----------------------------+
```

当程序因为递归或局部变量过大导致栈溢出，指针触碰到该被保护的内存区间时，CPU 的硬件 MPU 会瞬间识别出非法访问，立即打断程序的执行并抛出 `MemManage` 异常。这起到了硬件“熔断保护”的作用，防止损坏堆中的重要数据。

#### 第三防线：软件哨兵值（Canary / Stack Guard Word）
对于没有 MPU 的低端处理器，可以在栈底的最下端内存单元写入一个特定的魔术字，常被称为**栈哨兵（Stack Canary）**：
```c
#define STACK_CANARY_VAL 0xDEADBEEF
volatile uint32_t * const gp_stack_canary = (volatile uint32_t *)&_sbss; // 假设栈底与.bss紧邻
```
在系统的定时中断、RTOS 的任务切换钩子（Hook）函数中，定期检查该单元的内容是否被修改：
```c
void Stack_Monitor_Tick(void) {
    if (*gp_stack_canary != STACK_CANARY_VAL) {
        // 哨兵值被修改，说明栈溢出已发生
        System_Emergency_Handler("Stack Overflow Detected!");
    }
}
```
该方案虽然属于事后检测（软件具有一定的延迟性），但其部署成本极低，不需要 MPU 硬件支持，是嵌入式开发中应用极其广泛的鲁棒性优化实践。
