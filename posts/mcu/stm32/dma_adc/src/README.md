# 前言

在现代嵌入式系统、工业控制、电机驱动以及医疗仪器等高精度、实时性要求极高的应用场景中，模拟信号的数字化采集（Analog-to-Digital Conversion, ADC）是一项至关重要的基础功能。如何实现**高吞吐量、多通道、低延迟且零CPU干预**的ADC数据流搬运，是衡量系统级芯片（SoC）底层架构设计与嵌入式固件工程师水平的重要指标。

在传统的单片机开发中，开发者常使用以下两种方式获取ADC数据，但在高性能应用场景下它们暴露出致命缺陷：
*   **CPU轮询（Polling）方式**：CPU发出启动信号后必须死等（Busy-waiting）转换结束标志位（EOC）。这种同步阻塞模式极大地浪费了主频资源，在高采样率下会导致主循环（Main Loop）卡死，无法处理其他实时任务。
*   **中断触发（Interrupt-driven）方式**：单次转换完成或一轮扫描结束后触发EOC中断，由CPU在中断服务函数（ISR）中读取结果。虽然避免了死等，但当采样率提升至百kHz乃至MHz级时，高频中断会使CPU频繁执行现场保护和恢复（Context Switch Overhead）。甚至会出现**中断嵌套与饥饿**，CPU时间几乎被中断处理程序蚕食殆尽，称为“中断风暴（Interrupt Storm）”。

为了彻底解决这一瓶颈，STM32系列微控制器集成了强大的**直接内存访问控制器（Direct Memory Access, DMA）**。DMA可以直接接管总线控制权，充当外设与内存之间的“高速公路专职司机”。在不需要CPU介入的情况下，硬件自动将ADC转换完成的数据搬运至指定的SRAM缓冲区中，转换完成时仅通过一次DMA传输完成中断（TC）或者半传输中断（HT）来通知CPU进行数据处理。

---

## 本书内容大纲与核心目标

本书旨在从底层寄存器时序、AHB/APB总线架构、DMA仲裁优先级以及内存对齐等微观视角，深入剖析STM32中“DMA + ADC多通道”的高速采集机制。全书共分为三个核心章节：

### 1. [ADC与DMA底层协同与时序配合机制](01_adc_dma_principles.md)
*   剖析ADC逐次逼近型（SAR）架构的工作原理，探讨采样时间（Sampling Time）与转换时间（Conversion Time）对输入阻抗与精度的约束关系。
*   深入APB外设总线与AHB内存总线之间DMA的握手信号（dma_req / dma_ack）、双缓冲乒乓传输及总线仲裁机制。
*   结合寄存器和硬件时序图，分析高频采样下的总线冲突（Bus Contention）与数据越界错误（Overrun Error）产生机理及应对策略。

### 2. [多通道扫描采样与DMA双缓冲区机制](02_multichannel_scan.md)
*   详细解读扫描模式（Scan Mode）、连续转换模式（Continuous Mode）与间断模式（Discontinuous Mode）的区别。
*   通过核心时序图分析多通道采样时，数据在SRAM内存中的空间排布对齐规律（半字 16-bit / 字 32-bit）。
*   基于STM32 HAL库与LL库，提供生产级“DMA双缓冲区（乒乓缓冲）+ 中断半传输（Half Transfer）”的无缝无锁数据链表实现。

### 3. [硬件过采样与均值滤波算法优化](03_hardware_oversampling_filtering.md)
*   介绍现代STM32（如STM32G4、H7等）内置的**硬件过采样单元（Hardware Oversampling）**，推导如何通过无损右移提高ADC的等效位数（ENOB）。
*   设计在DMA中断中执行的超高效滑动平均滤波（Moving Average）、递推平均滤波以及卡尔曼滤波算法，最大化降低CPU计算负载。
*   探讨如何在混合信号PCB设计中，通过软硬件手段协同压制电源轨噪声与通道间串扰（Crosstalk）。

---

## 预备知识与硬件说明

本书的代码范例和硬件解析主要基于以下平台和规范：
1.  **架构基础**：ARM Cortex-M4/M7（如STM32F4, STM32F7, STM32G4, STM32H7）。这些芯片拥有先进的AHB总线矩阵（Bus Matrix），支持多主控（DMA1, DMA2, CPU, Ethernet等）并发访问不同的内存块（SRAM1, SRAM2, DTCM等）。
2.  **软件规范**：采用生产环境常用的 **C99/C11 语言标准**。核心驱动提供基于寄存器级/LL（Low-Layer）库与HAL（Hardware Abstraction Layer）相结合的优化代码，注重无锁（Lock-free）设计与内存屏障（DMB/DSB）的应用。
3.  **时钟与精度**：针对高精度测量，重点讨论如何利用定时器触发（Timer Trigger）而非软件触发，消除ADC采样抖动（Jitter）。

让我们翻开下一页，开启STM32 DMA-ADC高速采集机制的探索之旅。
