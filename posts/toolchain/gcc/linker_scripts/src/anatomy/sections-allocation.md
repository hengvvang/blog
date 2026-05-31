# 第二章：物理/虚拟内存分区与程序段映射机制

在嵌入式裸机开发中，所有的代码和数据都必须根据它们在运行时的读写特性（Read/Write）、执行特性（Executable）以及是否断电保存的要求，精准地分配到物理存储器上。本章将详细讨论各个标准 Section 的划分机制，深入解构加载地址（LMA）与运行地址（VMA）的差异，并提供一套生产级的链接脚本作为实战分析基础。

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

## 2. VMA（运行地址）与 LMA（加载地址）的物理图景

在复杂的嵌入式或多存储介质硬件系统中，程序镜像在烧录时存放的物理地址（LMA）与程序执行时被 CPU 寻址的物理地址（VMA）不一定一致。

* **LMA (Load Memory Address，加载地址)**：程序烧录进芯片时，该段内容被写入的物理非易失性存储地址（通常在 Flash 中）。
* **VMA (Virtual/Runtime Memory Address，运行地址)**：程序运行期间，CPU 执行指令或存取数据时，所使用的实际总线地址（对于已初始化的可变全局变量，通常在 SRAM 中）。

```text
+========================================================================+
|                       【LMA 视角: 烧录态 (Flash 镜像)】                  |
+========================================================================+
| 0x08000000 -> 0x08005000                                               |
| [ .isr_vector ] [ .text ] [ .rodata ] [ .data 的初始值数据镜像 ]        |
+========================================================================+
                                                 |
                                                 | (上电时启动汇编/C 拷贝数据)
                                                 v
+========================================================================+
|                       【VMA 视角: 运行态 (SRAM 布局)】                  |
+========================================================================+
| 0x20000000 -> 0x20000100                      0x20000100 -> 0x20020000 |
| [ .data 的运行副本 ]                           [ .bss段(零初始化) / 栈 / 堆 ] |
+========================================================================+
```

### 2.1 为什么 `.data` 段需要不同的 VMA 与 LMA？
对于已初始化的全局变量，例如 `int current_speed = 60;`：
1. **持久化保存（LMA）**：因为 SRAM 具有易失性，断电后其内容会完全消失。如果将初始值 `60` 仅存放在 RAM 中，上电后该变量将为随机值。因此，初始值 `60` 必须烧录在 Flash（LMA）中。
2. **运行时修改（VMA）**：在程序执行时，该变量需要被更改（如 `current_speed = 70;`）。CPU 无法直接通过单周期指令写入 Flash 扇区，因此该变量的运行实体必须位于 SRAM（VMA）中。
3. **搬移工作**：在复位阶段，启动代码将位于 Flash 的初始化数据复制到 SRAM 中的 VMA 对应位置。

### 2.2 语法实现：`AT` 关键字
在链接脚本中，我们通过 `AT` 关键字显式地将加载地址（LMA）指定到非易失性存储介质中。例如：
```ld
.data : 
{
    . = ALIGN(4);      /* 强制 4 字节对齐 */
    _sdata = .;        /* 获取并导出 .data 在 RAM 中的 VMA 起始地址 */
    *(.data)           /* 收集输入文件的所有 .data 段 */
    *(.data*)          /* 收集输入文件的所有 .data.xxx 段 */
    . = ALIGN(4);      /* 强制 4 字节对齐 */
    _edata = .;        /* 获取并导出 .data 在 RAM 中的 VMA 结束地址 */
} > RAM AT > FLASH     /* 运行在 RAM (VMA) 中，但加载存储在 FLASH (LMA) 中 */
```
链接器在识别到 `AT > FLASH` 时，会将该段的加载地址重定向到 Flash 空间的当前计数器，并自动导出 `LOADADDR(.data)` 以供启动文件读取。

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
    _sframfunc_vma = .; /* 记录 RAM 中该段运行的起始 VMA 地址 */
    *(.ramfunc)
    *(.ramfunc*)
    . = ALIGN(4);
    _eframfunc_vma = .; /* 记录 RAM 中该段运行的结束 VMA 地址 */
} > RAM AT > FLASH

/* 导出该段在 Flash 中的 LMA 起始地址 */
_sframfunc_lma = LOADADDR(.ramfunc);
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
