# 第二章：物理存储映射与自定义 Section 分配

微控制器的物理存储空间通常被划分为两类：非易失性存储（如 Flash）和易失性存储（如 SRAM）。为了让程序正确运行，链接脚本必须精心指导各种 Section 的物理映射和运行布局。

---

## 1. 标准 Section 与硬件映射关系

在 C/C++ 编译中，编译器产生的段可以归纳为以下几类，它们与微控制器硬件存储介质的映射关系如下表所示：

| 段名称 (Section) | 包含内容属性 | 目标存储介质 | 属性说明 |
| :--- | :--- | :--- | :--- |
| **`.isr_vector`** | 中断向量表（复位向量、SysTick、外设中断入口） | Flash 起始位置 | 必须最先被 CPU 读取，位置固定 |
| **`.text`** | 编译后的 CPU 机器指令（函数体代码） | Flash | 只读、可执行，运行过程中不可更改 |
| **`.rodata`** | 只读全局变量、常量（如字符常量、`const` 结构体） | Flash | 只读，为节省 RAM，直接放在 Flash 中读取 |
| **`.data`** | 已初始化的全局和静态变量（如 `int g_val = 10;`） | Flash (保存) & RAM (运行) | 初始值保存在 Flash 中，运行期拷贝到 RAM 中读写 |
| **`.bss`** | 未初始化或初始化为 0 的全局/静态变量 | RAM | 运行时清零，无需在 Flash 中存储其初始数值 |
| **`.stack`** | 局部变量、函数调用栈帧、中断上下文保护 | RAM | 硬件堆栈指针（MSP/PSP）所指向的读写区域 |
| **`.heap`** | 动态内存分配空间（如 `malloc` 所管理的区域）| RAM | 运行时堆管理器分配的空间 |

---

## 2. VMA（运行地址）与 LMA（加载地址）的本质区别

在嵌入式系统中，这是最核心、也最容易混淆的两个概念。

### 2.1 定义
*   **VMA (Virtual Memory Address)**：运行内存地址（也称虚拟内存地址或执行地址）。这是程序在运行期间，CPU 访问该段数据或代码时所使用的总线地址。
*   **LMA (Load Memory Address)**：加载内存地址。这是程序烧录到芯片中时，该段数据或代码实际存放的物理地址（通常在非易失性 Flash 中）。

```mermaid
graph TD
    subgraph 烧录状态 (Power Off / Flash Map)
        direction TB
        F_ISR[FLASH: .isr_vector]
        F_TEXT[FLASH: .text]
        F_RODATA[FLASH: .rodata]
        F_DATA[FLASH: .data 初始值]
    end
    
    subgraph 运行状态 (Active Runtime / RAM Map)
        direction TB
        R_DATA[SRAM: .data 运行副本]
        R_BSS[SRAM: .bss 零初始化]
        R_STACK[SRAM: 堆栈与堆]
    end

    F_DATA -->|上电 Startup 拷贝| R_DATA
    R_BSS -->|上电 Startup 清零| R_BSS
```

### 2.2 为什么 `.data` 段需要不同的 VMA 与 LMA？
对于一个已初始化的全局变量，例如：
```c
int global_counter = 0xAA55AA55;
```
1.  **断电保存（LMA）**：因为 RAM 是易失性存储介质，芯片断电后数据会完全丢失。因此，初始值 `0xAA55AA55` 必须保存在非易失性的 Flash 中（即 LMA 在 Flash 中）。
2.  **动态读写（VMA）**：在程序运行期间，CPU 需要对其执行写操作（如 `global_counter++`）。而 Flash 在运行时无法像 RAM 那样以字节为单位随机、快速地写入。因此，CPU 必须在 RAM 空间中读写该变量（即 VMA 在 RAM 中）。
3.  **启动拷贝**：为了解决这个矛盾，在上电复位时，微控制器的初始化汇编/C 代码（Startup Code）必须从 Flash 中读取该变量的初始值，将其拷贝到 RAM 的对应地址。

### 2.3 语法实现：`AT` 关键字
在链接脚本中，我们通过 `AT` 关键字来指定 LMA。
*   `> RAM`：指定该段的 VMA 属于 `RAM`。
*   `AT > FLASH`：指定该段的 LMA 属于 `FLASH`。

```ld
.data : 
{
    _sdata = .;        /* 记录 .data 段在 RAM 中的起始 VMA 地址 */
    *(.data)
    *(.data*)
    _edata = .;        /* 记录 .data 段在 RAM 中的结束 VMA 地址 */
} > RAM AT > FLASH     /* 运行在 RAM 中，但加载存储在 FLASH 中 */
```

---

## 3. 自定义 Section 的高级设计

除了系统默认的段，我们经常需要创建自定义段，将特定功能的代码或数据强制重定向到特定的物理介质中。

### 3.1 场景一：将关键算法（如 DSP/加密）放入 RAM 运行
由于 Flash 存在读取等待周期（Wait States），为了追求极致的执行速度，我们可以将一些中断频繁调用的关键函数存放在 RAM 中运行：
```c
// 在 C 语言中，通过属性指令将函数指定到自定义段 ".ramfunc"
__attribute__((section(".ramfunc"))) 
void critical_dsp_loop(void)
{
    // 执行高频、实时性要求极高的乘累加计算
}
```
在链接脚本中，该自定义段的分配方式如下：
```ld
.ramfunc :
{
    . = ALIGN(4);
    _sramfunc = .;
    *(.ramfunc)
    *(.ramfunc*)
    . = ALIGN(4);
    _eramfunc = .;
} > RAM AT > FLASH
```
上电启动时，启动代码需要将 `.ramfunc` 从 Flash 拷贝到 RAM，之后 CPU 在调用 `critical_dsp_loop` 时，PC 指针将直接跳转到 RAM 对应的地址运行。

### 3.2 场景二：外置大容量 SRAM / 紧耦合 CCMRAM 的分配
在高级 MCU 中，常常拥有多块不同的 RAM 区域。例如 STM32F4 中的 CCMRAM（Core Coupled Memory）直接连接在 D-Bus 上，速度极快但不支持 DMA。我们可以把不需要 DMA 参与的高频局部缓冲区丢进去：
```c
// 将高频大缓冲区强制分配到 CCMRAM
__attribute__((section(".ccm_buf"))) 
uint8_t fast_buffer[4096];
```
在链接脚本中：
```ld
.ccmram (NOLOAD) :
{
    . = ALIGN(4);
    _sccmram = .;
    *(.ccm_buf)
    *(.ccm_buf*)
    . = ALIGN(4);
    _eccmram = .;
} > CCMRAM
```
*(注：`(NOLOAD)` 属性告诉链接器，该段在烧录时不占用 Flash 空间，在上电时也不需要做任何初始值拷贝。)*

---

## 4. 生产级链接器脚本模板

以下是一个针对 ARM Cortex-M4（拥有 512KB Flash，128KB 主 RAM，64KB CCMRAM）的完整、生产级链接脚本模版。它包含了各种标准段、自定义段、对齐设置以及导出给启动文件使用的所有关键符号。

```ld
/*
 * ============================================================================
 * 生产级嵌入式链接脚本 (适用于 ARM Cortex-M4 微控制器)
 * ============================================================================
 */

/* 1. 声明程序执行的入口函数 */
ENTRY(Reset_Handler)

/* 2. 定义系统的最小堆与栈空间 */
_Min_Heap_Size  = 0x400;  /* 1KB 堆空间 */
_Min_Stack_Size = 0x800;  /* 2KB 栈空间 */

/* 3. 声明栈顶地址 (SRAM 结束地址，由于栈向下生长) */
_estack = ORIGIN(RAM) + LENGTH(RAM);

/* 4. 定义物理存储器布局 */
MEMORY
{
    FLASH  (rx)  : ORIGIN = 0x08000000, LENGTH = 512K
    RAM    (xrw) : ORIGIN = 0x20000000, LENGTH = 128K
    CCMRAM (rw)  : ORIGIN = 0x10000000, LENGTH = 64K
}

/* 5. 定义具体的段分配规则 */
SECTIONS
{
    /* 5.1 中断向量表段：必须放置在 FLASH 的最前端 */
    .isr_vector :
    {
        . = ALIGN(4);
        KEEP(*(.isr_vector)) /* 防止被链接器垃圾回收剪裁 */
        . = ALIGN(4);
    } > FLASH

    /* 5.2 代码段：存放所有编译后的可执行代码 */
    .text :
    {
        . = ALIGN(4);
        *(.text)           /* 匹配所有输入文件中的 .text 段 */
        *(.text*)          /* 匹配如 .text.func_name 等优化段 */
        *(.glue_7)         /* ARM 与 Thumb 指令交互所必需的代码 */
        *(.glue_7t)
        *(.eh_frame)       /* 异常处理帧（如使用 C++ 时需要） */

        KEEP(*(.init))     /* 硬件及库初始化代码 */
        KEEP(*(.fini))

        . = ALIGN(4);
        _etext = .;        /* 定义代码段结束标记 */
    } > FLASH

    /* 5.3 只读数据段：存放全局常量、字符串字面量 */
    .rodata :
    {
        . = ALIGN(4);
        *(.rodata)
        *(.rodata*)
        . = ALIGN(4);
    } > FLASH

    /* 5.4 C++ 构造与析构函数段 (C++ 裸机运行所需) */
    .ARM.extab : 
    { 
        *(.ARM.extab* .gnu.linkonce.armextab.*) 
    } > FLASH
    
    .ARM.exidx : 
    {
        __exidx_start = .;
        *(.ARM.exidx* .gnu.linkonce.armexidx.*)
        __exidx_end = .;
    } > FLASH

    .preinit_array :
    {
        PROVIDE_HIDDEN (__preinit_array_start = .);
        KEEP (*(.preinit_array*))
        PROVIDE_HIDDEN (__preinit_array_end = .);
    } > FLASH

    .init_array :
    {
        PROVIDE_HIDDEN (__init_array_start = .);
        KEEP (*(SORT(.init_array.*)))
        KEEP (*(.init_array*))
        PROVIDE_HIDDEN (__init_array_end = .);
    } > FLASH

    .fini_array :
    {
        PROVIDE_HIDDEN (__fini_array_start = .);
        KEEP (*(SORT(.fini_array.*)))
        KEEP (*(.fini_array*))
        PROVIDE_HIDDEN (__fini_array_end = .);
    } > FLASH

    /* 5.5 数据初始值段（LMA 保存区）：
     * 它是 .data 段在 Flash 中的物理存储起点，C 启动代码将从该地址读取数据拷贝至 RAM
     */
    _sidata = LOADADDR(.data);

    /* 5.6 已初始化数据段（VMA 运行区）：
     * 运行在 RAM，但其初始值物理存储在 FLASH
     */
    .data :
    {
        . = ALIGN(4);
        _sdata = .;        /* C 启动代码所需的变量拷贝起始地址 */
        *(.data)
        *(.data*)
        . = ALIGN(4);
        _edata = .;        /* C 启动代码所需的变量拷贝结束地址 */
    } > RAM AT > FLASH

    /* 5.7 RAM 运行函数段：对于时间要求极其严苛的代码 */
    _sframfunc_lma = LOADADDR(.ramfunc);
    .ramfunc :
    {
        . = ALIGN(4);
        _sframfunc_vma = .;
        *(.ramfunc)
        *(.ramfunc*)
        . = ALIGN(4);
        _eframfunc_vma = .;
    } > RAM AT > FLASH

    /* 5.8 未初始化数据段：上电时启动代码必须将其全部清零 */
    .bss :
    {
        . = ALIGN(4);
        _sbss = .;         /* C 启动代码所需的 BSS 清零起始地址 */
        __bss_start__ = _sbss;
        *(.bss)
        *(.bss*)
        *(COMMON)          /* 匹配未初始化的全局弱符号（Common block） */
        . = ALIGN(4);
        _ebss = .;         /* C 启动代码所需的 BSS 清零结束地址 */
        __bss_end__ = _ebss;
    } > RAM

    /* 5.9 CCMRAM 专有数据段 (无需在 Flash 中分配初始值，NOLOAD) */
    .ccmram (NOLOAD) :
    {
        . = ALIGN(4);
        _sccmram = .;
        *(.ccmram)
        *(.ccmram*)
        . = ALIGN(4);
        _eccmram = .;
    } > CCMRAM

    /* 5.10 用户堆与栈空间的安全检查段：
     * 不进行实际数据填充，仅用于强制限制并检查 RAM 是否有足够剩余空间分配堆栈
     */
    ._user_heap_stack :
    {
        . = ALIGN(8);      /* ARM 栈地址必须满足 8 字节对齐 */
        PROVIDE ( end = . );
        PROVIDE ( _end = . );
        . = . + _Min_Heap_Size;
        . = . + _Min_Stack_Size;
        . = ALIGN(8);
    } > RAM

    /* 5.11 垃圾回收检测：移除不需要的 debug 信息段 */
    /DISCARD/ :
    {
        libc.a ( * )
        libm.a ( * )
        libgcc.a ( * )
    }
}
```
