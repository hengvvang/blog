# 概述：嵌入式 MCU 内存布局与对齐限制

在通用操作系统（如 Linux 或 Windows）中，应用程序运行在高度抽象的虚拟内存空间（Virtual Memory Space）之上，由操作系统的内存 management 单元（MMU）负责虚拟地址到物理内存的映射，且拥有按需分页、写时复制等高级特性。

然而，在嵌入式微控制器（MCU，如 ARM Cortex-M 系列、ESP32 等）的裸机或实时操作系统（RTOS）环境下，**物理地址就是逻辑地址**。程序直接运行在物理内存上，没有 MMU 的屏障保护。这意味着，开发人员不仅需要清晰地理解物理存储介质（Flash、SRAM）的特性，还要深刻掌握编译器与链接器如何将 C 语言代码编译并映射到具体的段（Section）中。此外，由于嵌入式处理器总线架构（如 AHB、APB）对数据传输边界的硬性限制，内存对齐（Memory Alignment）与非对齐访问限制（Unaligned Access Rules）成为了直接关系到系统稳定性和运行效率的核心问题。

---

## 嵌入式存储介质与总线架构

在典型的微控制器（以 ARM Cortex-M 为例）中，系统存储介质通常分为两大类：

1. **非易失性存储器（Flash Memory / ROM）：**
   - **特点：** 掉电后数据不丢失，读取速度较快（有时需等待周期/Wait States，或通过 Flash 缓冲/加速器缓解），但写入/擦除操作极慢且需要特定算法。
   - **用途：** 存放固件代码（指令序列）、常量数据、中断向量表以及初始化数据镜像。

2. **易失性随机存取存储器（SRAM）：**
   - **特点：** 读写速度极快，无擦写寿命限制，但掉电后数据完全丢失。
   - **用途：** 存放运行时的动态变量、堆栈（Stack）、堆（Heap）以及从 Flash 复制过来的可读写全局/静态变量。

### Cortex-M 物理内存映射拓扑

ARM Cortex-M 采用统一编址的哈佛架构（或者说在系统总线层面进行了整合），其 4GB 的物理地址空间划分如下：

```mermaid
gantt
    title Cortex-M3/M4/M7 4GB 物理地址空间映射
    dateFormat  YYYY-MM-DD
    axisFormat  %S
    section 物理映射区
    Code 区 (Flash / 中断向量表) : active, 0x00000000, 0x1FFFFFFF
    SRAM 区 (数据/堆/栈)         : done, 0x20000000, 0x3FFFFFFF
    Peripheral 区 (外设寄存器)    : active, 0x40000000, 0x5FFFFFFF
    External RAM (外部扩展内存)  : done, 0x60000000, 0x9FFFFFFF
    External Device (外部设备)   : active, 0xA0000000, 0xDFFFFFFF
    Private Peripheral Bus (PPB核心外设) : crit, 0xE0000000, 0xFFFFFFFF
```

在 4GB 地址空间的底层，指令总线（I-Code）、数据总线（D-Code）和系统总线（System Bus）各自承担着不同的访问任务：
- **I-Code & D-Code：** 访问 `0x00000000 - 0x1FFFFFFF` 区域（主要是 Flash），前者用于取指，后者用于读取常量数据（如 `.rodata`）。
- **System Bus：** 访问 `0x20000000` 以上的 SRAM 及外设区域，完成变量的读写、栈操作以及堆分配。

---

## 本书学习目标与章节规划

本书专为嵌入式系统工程师与底层系统程序员编写，旨在从**链接脚本、汇编启动代码、编译器属性、底层总线行为以及硬件 Fault 异常分析**等多个维度，系统剖析 C 语言在嵌入式环境下的内存行为。

通过阅读本书，您将掌握以下核心能力：

* **第一章：Flash 与 SRAM 内存分区深剖 (01_ram_flash_sections.md)**
  - 深入 `.text`、`.rodata`、`.data`、`.bss`、栈（Stack）以及堆（Heap）等传统分区的物理分布。
  - 理解启动代码（Startup Code）如何利用链接器符号（Linker-defined Symbols）将 `.data` 段从 Flash 拷贝至 SRAM，并将 `.bss` 段清零。
  - 解读 GCC 链接脚本（Linker Script）的语法 and 内存段分配策略。

* **第二章：内存对齐与结构体填充 (02_memory_alignment.md)**
  - 掌握硬件层面的“自然对齐”要求及其背后的总线带宽优化逻辑。
  - 剖析结构体对齐规则与编译器引入的填充字节（Padding）。
  - 熟练运用 GCC 的 `__attribute__((packed))` 与 `__attribute__((aligned(n)))`，并分析紧凑排布带来的空间优势与性能代价。

* **第三章：ARM Cortex-M 非对齐访问总线 Fault (03_bus_faults.md)**
  - 解析为什么某些 Cortex-M 内核（如 Cortex-M0/M0+）不支持非对齐访问，而其他内核（如 Cortex-M3/M4/M7）在特定总线或特定配置下会触发硬件异常。
  - 深入分析 CCR（Configuration and Control Register）寄存器中的 `UNALIGN_TRP` 位。
  - 学习如何编写生产级 HardFault/UsageFault 异常处理函数，通过栈帧指针（PSP/MSP）解码发生非对齐异常的精确指令地址（PC）以及目标内存地址，实现快速定位与在线诊断。
