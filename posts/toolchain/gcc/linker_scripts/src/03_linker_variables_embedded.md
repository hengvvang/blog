# 第三章：链接器变量、符号与 C 运行时交互

在嵌入式底层开发中，链接器脚本不仅仅用来静态规划内存，它还定义了大量的物理边界符号。这些符号需要被 C 语言启动代码（Startup Code）引用，从而在上电时完成搬移数据、清除内存等底层的初始化工作。

---

## 1. 链接器符号（Linker Symbols）与 C 语言变量的本质区别

在 C 语言中引用链接器脚本定义的符号（例如第二章模板中的 `_sdata` 或 `_sbss`）是新手极易出错的地方。

### 1.1 核心差异对比
下表阐明了这两者在编译器/链接器眼中的本质差异：

| 维度 | C 语言普通全局变量 (`int var`) | 链接脚本定义的符号 (`_sdata`) |
| :--- | :--- | :--- |
| **内存占用** | 在 `.data` 或 `.bss` 区占用 4 字节的物理内存空间 | **不占用任何物理内存空间**。它仅仅是符号表中的一个绝对地址项。 |
| **符号的值** | 该变量内存中所存储的**具体数据数值** (比如 `10`) | 无符号值。在编译期，符号的名字等同于它的**内存物理地址**本身。 |
| **符号的引用方式**| 直接使用名字：`var = 5;` | 必须使用地址运算符：`&_sdata`。 |

### 1.2 寻址机制解析

如果我们在 C 语言中这样声明：
```c
extern uint32_t _sdata; // 错误做法
```
当你在 C 代码中直接读取 `_sdata` 时：
```c
uint32_t val = _sdata;
```
编译器会认为 `_sdata` 是一个普通的全局变量。它会生成一条加载指令，去读取内存地址为 `_sdata` 处存放的 **前4个字节的数据**（对于 RAM 来说，就是 `.data` 段的第一个变量的数值）。这显然违背了我们的本意（我们想要的是 `_sdata` 这个地址本身）。

#### 正确的引用方式一：取地址运算符 `&`
我们必须将链接器符号声明为常规类型，但在使用时**强制使用取地址符号 `&`** 来获取它的值：
```c
extern uint32_t _sdata; // 声明为 extern 变量

uint32_t sdata_addr = (uint32_t)&_sdata; // 正确：通过 & 符号获取该链接符号代表的绝对地址
```

#### 正确的引用方式二：声明为未定长数组
将符号声明为无长度的字符数组（或类型数组）。在 C 语言中，数组名本身就代表该数组的起始地址，这样在使用时无需加 `&`：
```c
extern uint8_t _sdata[]; // 声明为无长度数组

uint8_t *sdata_ptr = _sdata; // 正确：_sdata 隐式转换为该地址的指针
```

---

## 2. 生产级 C 语言启动代码（Startup Code）

许多开发者习惯使用汇编语言编写启动文件（如 `startup_stm32.s`）。事实上，在现代 GCC 编译器环境下，我们完全可以使用纯 C 语言配合链接器变量，编写出可读性极佳、维护性更强的 C 语言启动文件。

以下为适配第二章链接脚本的完整 C 语言启动代码实例：

```c
/**
 * ============================================================================
 * @file    startup.c
 * @brief   生产级 ARM Cortex-M4 裸机 C 语言启动文件
 * ============================================================================
 */

#include <stdint.h>

/* 1. 外部链接符号声明 (在链接器脚本中定义) */
extern uint32_t _sidata;         /* .data 段初始值在 Flash 中的源起始地址 */
extern uint32_t _sdata;          /* .data 段在 RAM 中的目的起始地址 (VMA) */
extern uint32_t _edata;          /* .data 段在 RAM 中的结束地址 (VMA) */

extern uint32_t _sframfunc_lma;  /* .ramfunc 段在 Flash 中的源起始地址 */
extern uint32_t _sframfunc_vma;  /* .ramfunc 段在 RAM 中的目的起始地址 (VMA) */
extern uint32_t _eframfunc_vma;  /* .ramfunc 段在 RAM 中的结束地址 (VMA) */

extern uint32_t _sbss;           /* .bss 段在 RAM 中的起始地址 */
extern uint32_t _ebss;           /* .bss 段在 RAM 中的结束地址 */

extern uint32_t _estack;         /* 栈顶地址 (指向 RAM 末尾) */

/* 2. 声明用户主函数及系统时钟初始化函数 */
extern int main(void);
extern void SystemInit(void);

/* C++ 全局构造函数初始化链调用 (C++ 裸机环境必需) */
extern void __libc_init_array(void);

/* 3. 声明默认中断服务程序 (使用 weak 属性，允许用户在应用层重写) */
void Reset_Handler(void);
void Default_Handler(void);

/* 4. 定义 Cortex-M 系统异常与中断向量表 */
/* 使用 attribute 强制放入链接脚本最前端的 .isr_vector 段，且防止被编译器优化掉 */
__attribute__((section(".isr_vector"), used))
const uint32_t * g_pfnVectors[] = {
    (uint32_t *)&_estack,               /* 00: 初始栈顶指针 (MSP) */
    (uint32_t *)Reset_Handler,          /* 01: 复位向量 (上电/复位后首个执行地址) */
    (uint32_t *)Default_Handler,        /* 02: NMI 异常 */
    (uint32_t *)Default_Handler,        /* 03: HardFault 硬件异常 */
    (uint32_t *)Default_Handler,        /* 04: MemManage 内存管理异常 */
    (uint32_t *)Default_Handler,        /* 05: BusFault 总线异常 */
    (uint32_t *)Default_Handler,        /* 06: UsageFault 使用状态异常 */
    0, 0, 0, 0,                         /* 07-10: 保留 */
    (uint32_t *)Default_Handler,        /* 11: SVCall 系统调用 */
    (uint32_t *)Default_Handler,        /* 12: Debug Monitor 调试监控 */
    0,                                  /* 13: 保留 */
    (uint32_t *)Default_Handler,        /* 14: PendSV 挂起系统调用 */
    (uint32_t *)Default_Handler         /* 15: SysTick 系统滴答定时器 */
};

/**
 * @brief  系统复位入口函数
 * @note   完成数据段搬移、BSS段清零、时钟配置及构造函数调用后，跳转至 main
 */
void Reset_Handler(void)
{
    /* 2.1 拷贝已初始化的全局变量段 (.data) 从 FLASH (LMA) 到 RAM (VMA) */
    uint32_t *pSrc = &_sidata;
    uint32_t *pDst = &_sdata;
    
    while (pDst < &_edata)
    {
        *pDst++ = *pSrc++;
    }

    /* 2.2 拷贝 RAM 运行代码段 (.ramfunc) 从 FLASH (LMA) 到 RAM (VMA) */
    pSrc = &_sframfunc_lma;
    pDst = &_sframfunc_vma;
    
    while (pDst < &_eframfunc_vma)
    {
        *pDst++ = *pSrc++;
    }

    /* 2.3 清空未初始化全局变量段 (.bss) 为 0 */
    pDst = &_sbss;
    while (pDst < &_ebss)
    {
        *pDst++ = 0;
    }

    /* 2.4 调用硬件平台初始化（如配置时钟树、启用外设总线） */
    SystemInit();

    /* 2.5 执行 C++ 全局静态对象的构造函数 */
    __libc_init_array();

    /* 2.6 正式进入用户主函数 */
    main();

    /* 2.7 如果 main 函数意外返回，进入死循环 */
    while (1)
    {
        __asm("NOP");
    }
}

/**
 * @brief  默认中断服务程序
 */
void Default_Handler(void)
{
    while (1)
    {
        /* 捕获未处理的异常，在此挂起以便使用调试器回溯 */
    }
}
```

---

## 3. 内存对齐引发的硬件异常（HardFault）深度剖析

在上述 `Reset_Handler` 的数据拷贝与清零流程中，我们采用的是高效的 **32位字（`uint32_t`）拷贝**。这就要求所有相关指针必须满足 **4 字节对齐**。

```c
*pDst++ = *pSrc++; // 若 pDst 或 pSrc 地址不是 4 字节的整数倍，则会触发非对齐访问
```

### 3.1 致命对齐缺陷分析
假设在链接器脚本中，我们没有在段的结尾加上对齐指令：
```ld
/* 缺陷示例 */
.data :
{
    _sdata = .;
    *(.data)
    *(.data*)
    _edata = .; /* 如果 .data 段的大小刚好是 33 字节，_edata 的值将是 0x20000021 */
} > RAM AT > FLASH
```
如果发生上述情况：
1.  `_sdata` 地址为 `0x20000000`（4 字节对齐）。
2.  由于数据大小原因，`_edata` 的值计算出来是 `0x20000021`。
3.  启动代码执行循环 `while (pDst < &_edata)`。因为 `pDst` 每次累加 4 个字节，其变化路径为：`0x20000000` -> `0x20000004` -> ... -> `0x20000020` -> `0x20000024`。
4.  **严重后果一**：`pDst` 永远不会精确等于 `0x20000021`！循环将越界执行，继续向 RAM 后续空间写入垃圾数据，直到撑爆 SRAM 空间，触发硬件访问保护或改写了其他全局变量，造成不可预测的恶性 Bug。
5.  **严重后果二**：如果拷贝逻辑为 `pDst < &_edata` 且我们使用 `uint32_t *` 指针解引用访问了非 4 字节对齐地址（如对 `0x20000021` 执行写操作）：
    *   在 ARM Cortex-M0/M0+ 架构上，硬件**完全不支持**非对齐的 32 位访问，会直接触发 `HardFault`。
    *   在 ARM Cortex-M3/M4/M7 上，如果系统控制寄存器（CCR）中的 `UNALIGN_TRP` 位被置 1，同样会触发 `UsageFault` 异常。

> [!CAUTION]
> 必须确保链接器脚本中每个段的起始与结束位置都执行了 **`ALIGN(4)`** 或 **`ALIGN(8)`**。这不仅能规避硬件异常，还能利用 32 位或 64 位宽的总线实现最高的内存访问效率。

---

## 4. 静态内存审计：如何深度分析 Map 文件

GCC 编译器在链接时可以通过加入 `-Wl,-Map=output.map` 选项来生成 **Map 文件（内存映射文件）**。Map 文件是静态内存审计、内存泄漏排查、分析代码大小（Code Size）最权威的文本报告。

### 4.1 Map 文件的核心组成

打开一个典型的 Map 文件，其内容通常按顺序分为以下几个板块：

1.  **Archive member included ...**：
    说明最终的可执行文件引入了哪些静态库文件（`.a`）中的特定目标文件（`.o`）。可以用于定位为什么某些不相关的库函数被莫名其妙打包进固件中。
2.  **Memory Configuration**：
    列出我们在链接脚本中定义的物理 `MEMORY` 块及其使用率：
    ```text
    Memory Configuration
    Name             Origin             Length             Attributes
    FLASH            0x08000000         0x00080000         xr
    RAM              0x20000000         0x00020000         xrw
    CCMRAM           0x10000000         0x00010000         rw
    *default*        0x00000000         0xffffffff
    ```
3.  **Linker Script and Memory Map**（最核心部分）：
    详细列出最终输出段内，每一个输入 `.o` 文件中各个函数与变量的具体排布地址及所占字节大小。

### 4.2 实战分析：段细节与符号定位

以下是从真实生产环境 Map 文件截取的 `.data` 段布局片段：

```text
.data           0x20000000       0x28 load address 0x080015b0
                0x20000000                . = ALIGN (0x4)
 *(.data)
 *(.data*)
 .data.g_system_ticks
                0x20000000        0x4 build/main.o
                0x20000000                g_system_ticks
 .data.sensor_profile
                0x20000004       0x20 build/sensor.o
                0x20000004                sensor_profile
                0x20000024                . = ALIGN (0x4)
                0x20000024                _edata = .
```

#### 从上述片段中能够解读的关键信息：
1.  **VMA & LMA 分布**：`.data` 段的运行起始地址（VMA）是 `0x20000000`，物理存储地址（LMA）是 `0x080015b0`，整个段总共占据了 `0x28`（40 字节）的空间。
2.  **变量映射与大小**：
    *   源自 `main.o` 的全局变量 `g_system_ticks` 被分配在 `0x20000000`，大小为 4 字节。
    *   源自 `sensor.o` 的全局结构体变量 `sensor_profile` 被分配在 `0x20000004`，大小为 32 字节（`0x20`）。
3.  **对齐与边界**：在 `0x20000024` 处执行了对齐，并在此处导出了 `_edata` 符号。

利用 Map 文件，系统工程师可以非常方便地生成脚本，统计出哪些文件占用的 RAM/Flash 最多，从而进行针对性的重构与优化。
