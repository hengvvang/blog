# 第三章：DMA 传输原理与双缓冲区双端口机制

在高频多通道模拟信号采集系统中，模数转换器（ADC）以极高频率输出数据。若无直接内存访问（DMA）控制器的高速搬运，系统将频繁发生数据丢失或因频繁触发中断而导致 CPU 卡死现象。

本章将深入探讨 STM32 DMA 控制器的底层传输机制、总线矩阵仲裁冲突、双缓冲（乒乓缓冲）机制的时序对齐，以及针对 Cortex-M7 内核的高速缓存（D-Cache）一致性维护规范。

---

## 3.1 DMA 底层传输机制与总线握手协议

DMA 控制器是 AHB 总线上的“主控方（Master）”，能够在没有 CPU 干预的情况下，直接接管总线控制权，在外设与内存、内存与内存之间搬运数据。

### 3.1.1 DMA 硬件请求与应答握手信号（dma_req / dma_ack）

外设（如 ADC）与 DMA 控制器之间的数据交换基于一组硬连线的握手信号：

1.  **硬件请求 `dma_req`**：当 ADC 规则组的某一个通道转换完成，数据存入 `ADC_DR` 寄存器，且 ADC 内部的 `DMA` 允许位被使能时，ADC 向 DMA 发送高电平 `dma_req` 请求信号。
2.  **通道仲裁（Arbitration）**：DMA 内部的仲裁器根据软件设定的优先级（Low, Medium, High, Very High）以及硬件通道号，决定是否响应当前请求。
3.  **总线控制权接管**：获得响应的 DMA 通道向 AHB 总线矩阵申请总线控制权。一旦总线矩阵授权，DMA 即启动一次传输周期。
4.  **外设读取阶段（Read Cycle）**：DMA 作为 Master，通过 APB 桥在总线上读取 `ADC_DR` 的数据。当数据读取完成后，硬件自动拉低 ADC 的 `dma_req` 信号，代表本次请求已被成功响应。
5.  **内存写入阶段（Write Cycle）**：DMA 将读取的数据通过 AHB 总线写入指定的 SRAM 地址。
6.  **应答/结束 `dma_ack`**：在某些高级 DMA 架构中，DMA 传输控制器会回发 `dma_ack`，指示本次数据交互流程结束，地址增量指针自动累加。

```
              __     __     __     __     __     __     __     __
HCLK (总线时钟) __|  |__|  |__|  |__|  |__|  |__|  |__|  |__|  |__
                    __________________
ADC EOC            |                  |
             ______|                  |_______________________
                    __________________
dma_req (请求)     |                  |
             ______|                  |_______________________
                           __________________
DMA 读周期                |   Read ADC_DR    |
             ____________|__________________|_________________
                                              ________________
DMA 写周期                                    |   Write SRAM   |
             ________________________________|________________|
                                                     _________
dma_ack / Done                                      |         |
             _______________________________________|         |___
```

---

## 3.2 多层 AHB 总线矩阵拓扑与总线冲突（Bus Contention）

为了最大化提升并发访问速度，STM32 内部集成了多层 AHB 总线矩阵（Multi-Layer AHB Bus Matrix），它是一个交叉开关（Crossbar Switch），允许多个主控方同时与不同的从控方通信。

### 3.2.1 AHB 总线矩阵交叉开关拓扑与冲突节点

以下是 STM32 内部总线矩阵的微观互连示意图：

```
                              从 设备 端口 (Slave Ports)
             +-------------+-------------+-------------+-------------+
             |  Flash 闪存 |    SRAM1    |    SRAM2    |  AHB2APB    |
             |  (运行代码) | (DMA缓冲区) | (堆栈/全局) |  (外设寄存器)|
-------------+-------------+-------------+-------------+-------------+
 M CPU I-Code|     [x]     |     [ ]     |     [ ]     |     [ ]     |
 A (指令流)   |             |             |             |             |
-------------+-------------+-------------+-------------+-------------+
 S CPU D-Code|     [ ]     |     [x]     |     [x]     |     [x]     |
 T (数据读写) |             | (总线冲突!) |             |             |
-------------+-------------+-------------+-------------+-------------+
 E DMA1 Master|     [ ]     |     [x]     |     [ ]     |     [x]     |
 R (外设搬运) |             | (总线冲突!) |             | (读取ADC_DR)|
-------------+-------------+-------------+-------------+-------------+
 S DMA2 Master|     [ ]     |     [ ]     |     [x]     |     [ ]     |
-------------+-------------+-------------+-------------+-------------+
```

### 3.2.2 并发执行与总线冲突成因

*   **无冲突并发**：当 CPU 通过 `I-Code` 总线从 Flash 中读取指令执行，同时 `DMA1` 将数据从 `AHB2APB` 桥读取并写入 `SRAM1` 时，两条通信链路物理上完全独立。此时两者**并行工作，实现零等待周期**。
*   **总线冲突（Bus Contention）**：如果 CPU 在后台运行密集的数字滤波算法（例如在 `SRAM1` 中读取原始数据并写入滤波结果），而此时 `DMA1` 也试图将刚刚采集的 ADC 值写入 `SRAM1`。此时，总线矩阵仲裁器（Arbiter）将介入，根据轮转（Round-robin）或优先级算法插入**等待周期（Wait States）**。
*   **过载与溢出（Overrun）**：如果 CPU 长时间独占该总线，或者高优先级 DMA 通道（例如以太网或大带宽 SPI）阻碍了 ADC 所在 DMA 通道的访问，可能导致 ADC 发出的 `dma_req` 迟迟无法得到响应。若在下一次 ADC 转换完成前 DMA 还未取走上一次的数据，ADC 将抛出 **Overrun (OVR) 错误**，并彻底卡死 DMA 传输。

---

## 3.3 双缓冲区（乒乓缓冲）无缝读写机制与指针翻转

为了彻底解决高频采样下 CPU 读数据与 DMA 写数据的冲突问题，必须使用**双缓冲区（Double Buffer / Ping-Pong Buffer）**架构。

### 3.3.1 乒乓缓冲物理逻辑与指针翻转时序

双缓冲区逻辑上被平分为两部分：前半区（Buffer A）和后半区（Buffer B）。其基本运作机制依赖于 DMA 的两个硬件中断：**半传输完成（HT）**和**传输完成（TC）**。

```
        SRAM 循环缓冲区 (总容量: 2 * L 字节)
  +-----------------------------------+-----------------------------------+
  |       前半区 Buffer A             |       后半区 Buffer B             |
  |       [ 地址: BaseAddr ]          |       [ 地址: BaseAddr + L ]      |
  +-----------------------------------+-----------------------------------+
  ^                                   ^
  |                                   |
BaseAddress                  BaseAddress + L (偏移量)

1. DMA 写入前半区 (Buffer A)：
   DMA 写指针: =======> (正向 Buffer A 写入数据)
   CPU 状态  : 处理 Buffer B 的历史数据，或者处于休眠状态。

2. 写指针到达中点 (L - 1)：
   ==> 触发 DMA 半传输完成 (HT) 中断！
   ==> CPU 在后台启动对 Buffer A 数据的处理。
   ==> DMA 写指针无缝翻转到后半区 Buffer B：
       ============================> (正向 Buffer B 写入数据)

3. 写指针到达终点 (2L - 1)：
   ==> 触发 DMA 传输完成 (TC) 中断！
   ==> CPU 在后台启动对 Buffer B 数据的处理。
   ==> DMA 写指针环回并重新向 Buffer A 写入数据：
       ===> (循环写入 Buffer A)
```

只要 **CPU 消费一个半区数据的时间绝对小于 DMA 填满半区的时间**，系统就能以 100% 的确定性实现零丢包、零拷贝的无缝高速采样。

---

## 3.4 Cortex-M7 内核 D-Cache 一致性挑战

在带有数据高速缓存（D-Cache）的高性能内核（如 Cortex-M7 架构的 STM32H7）中，由于 CPU 速度远快于外部 SRAM 速度，内核设计了 D-Cache：

*   **数据不一致（Data Incoherency）**：当 DMA 将 ADC 数据直接搬运到 SRAM 中时，这部分物理内存的更改是**绕过 CPU 的 D-Cache 直接操作的**。如果 CPU 此时读取该缓冲区，它可能会直接从 D-Cache 中读取之前的旧数据，导致读取的内容是“脏数据”。
*   **写回冲突（Write-Back Jitter）**：如果 CPU 在该区域内写回其他局部变量，D-Cache 中的脏数据会重新写回 SRAM，覆盖掉 DMA 刚刚搬运进去的最新的真实 ADC 数据。

### 3.4.1 Cache 一致性最佳防御规范

为解决此问题，可以采用以下几种工程规范：

#### 方法 A：配置 MPU 设为 Non-Cacheable（无缓存区）
通过内存保护单元（MPU），将 DMA 缓冲区的 SRAM 区域属性配置为 `Non-Cacheable` 或 `Shared`。这样 CPU 对该区域的读写将直接穿透到物理 SRAM，虽然牺牲了微小的读写速度，但彻底排除了 Cache 不一致的隐患。

#### 方法 B：在中断中执行 Cache 失效操作（Cache Invalidation）
在 DMA 中断（HT 和 TC 中断）触发时，CPU 准备处理某半区数据前，调用 `SCB_InvalidateDCache_by_Addr()` 强制清除该地址范围内对应的 Cache 行。这样，CPU 后续的读操作会被强制穿透到 SRAM，获取 DMA 写入的最新真实数据。

---

## 3.5 生产级双缓冲、错误恢复与 Cache 维护 C 代码实现

下面给出基于 STM32H7 平台，整合了双缓冲管理、OVR 自动故障恢复以及 D-Cache 维护的完整底座代码。

### 3.5.1 系统定义与内存布局 (`adc_dma_manager.c`)

```c
#include "main.h"
#include <string.h>

#define CHANNELS        4       // 采集通道数
#define SCAN_LOOPS      256     // 单个半区容纳的扫描次数
#define BUF_SIZE        (SCAN_LOOPS * 2 * CHANNELS) // 双缓冲区总大小 (16-bit)

// 在 STM32H7 上，DMA 缓冲必须 32 字节对齐，且最好放置在 D2 域的 AXI SRAM (如 0x30000000) 以消除总线锁冲突
ALIGN_32BYTES(uint16_t g_adc_pingpong_buffer[BUF_SIZE]);

typedef enum {
    HALF_READY = 0,
    FULL_READY,
    FAULT_OVERRUN
} DMA_Event_t;

volatile uint8_t g_dma_ready_flag = 0;
volatile uint8_t g_dma_active_half = 0; // 0: 前半区就绪, 1: 后半区就绪

// 定义 ADC 与 DMA 句柄
extern ADC_HandleTypeDef hadc1;
extern DMA_HandleTypeDef hdma_adc1;

/**
  * @brief  配置 MPU，将 ADC DMA 缓冲区区域（假设地址对齐）设为 Non-Cacheable
  *         （本代码在系统启动初期调用）
  */
void MPU_Config_ADC_Buffer(void)
{
    MPU_Region_InitTypeDef MPU_InitStruct = {0};

    // 禁用中断，防止配置过程被干扰
    HAL_MPU_Disable();

    // 配置 MPU Region
    MPU_InitStruct.Enable = MPU_ACCESS_ENABLE;
    MPU_InitStruct.Number = MPU_REGION_NUMBER0;
    MPU_InitStruct.BaseAddress = (uint32_t)g_adc_pingpong_buffer;
    MPU_InitStruct.Size = MPU_REGION_SIZE_4KB; // 根据双缓冲大小调整，此处配置为 4KB
    MPU_InitStruct.SubRegionDisable = 0x00;
    
    // 设置为无缓存、强顺序物理读写模式 (Non-Cacheable, Outer and Inner Shareable)
    MPU_InitStruct.TypeShareability = MPU_ACCESS_OUTER_SHAREABLE;
    MPU_InitStruct.AccessPermission = MPU_ACCESS_FULL_ACCESS;
    MPU_InitStruct.DisableExec = MPU_INSTRUCTION_ACCESS_DISABLE;
    MPU_InitStruct.IsShareable = MPU_ACCESS_SHAREABLE;
    MPU_InitStruct.IsCacheable = MPU_ACCESS_NOT_CACHEABLE;
    MPU_InitStruct.IsBufferable = MPU_ACCESS_NOT_BUFFERABLE;

    HAL_MPU_ConfigRegion(&MPU_InitStruct);
    HAL_MPU_Enable(MPU_PRIVILEGED_DEFAULT);
}
```

### 3.5.2 中断回调与 Cache 维护机制

```c
/**
  * @brief  DMA 传输半满中断回调 (HT) —— 对应前半区 Buffer A 就绪
  */
void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef* hadc)
{
    if (hadc->Instance == ADC1)
    {
        g_dma_ready_flag = 1;
        g_dma_active_half = 0; // 指示前半区可以读取

        /* 针对使能了 D-Cache 且未使用 MPU 隔离的配置：
           在读取数据之前，必须对前半区对应的 Cache 进行 Invalidate (失效) 操作，
           以防止 CPU 从 Cache 中读取到过期的数据 */
        #if defined (__DCACHE_PRESENT) && (__DCACHE_PRESENT == 1U)
        uint32_t buf_addr = (uint32_t)&g_adc_pingpong_buffer[0];
        uint32_t buf_size = (SCAN_LOOPS * CHANNELS) * sizeof(uint16_t);
        SCB_InvalidateDCache_by_Addr((uint32_t *)buf_addr, buf_size);
        #endif
    }
}

/**
  * @brief  DMA 传输完全满中断回调 (TC) —— 对应后半区 Buffer B 就绪
  */
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* hadc)
{
    if (hadc->Instance == ADC1)
    {
        g_dma_ready_flag = 1;
        g_dma_active_half = 1; // 指示后半区可以读取

        /* 针对后半区进行 Cache 失效操作 */
        #if defined (__DCACHE_PRESENT) && (__DCACHE_PRESENT == 1U)
        uint32_t buf_addr = (uint32_t)&g_adc_pingpong_buffer[SCAN_LOOPS * CHANNELS];
        uint32_t buf_size = (SCAN_LOOPS * CHANNELS) * sizeof(uint16_t);
        SCB_InvalidateDCache_by_Addr((uint32_t *)buf_addr, buf_size);
        #endif
    }
}
```

### 3.5.3 OVR 溢出故障诊断与恢复机制

在发生总线极度拥堵或 CPU 处理超时时，ADC 会发生 Overrun，此时 ADC 会锁死 DMA 请求。必须执行寄存器级的重置。

```c
/**
  * @brief  ADC 错误处理回调函数
  */
void HAL_ADC_ErrorCallback(ADC_HandleTypeDef *hadc)
{
    if (hadc->Instance == ADC1)
    {
        // 检查是否发生 Overrun (溢出错误)
        if (HAL_ADC_GetError(hadc) & HAL_ADC_ERROR_OVR)
        {
            /* 1. 停止当前常规组 ADC 转换与 DMA 搬运 */
            HAL_ADC_Stop_DMA(hadc);

            /* 2. 清除中断标志与错误寄存器 */
            __HAL_ADC_CLEAR_FLAG(hadc, ADC_FLAG_OVR);
            hadc->ErrorCode = HAL_ADC_ERROR_NONE;

            /* 3. 内存屏障操作，确保寄存器清空写入已同步 */
            __DSB();
            __ISB();

            /* 4. 重新初始化 DMA 接收状态机并重新开启 DMA 搬运 */
            HAL_ADC_Start_DMA(hadc, (uint32_t*)g_adc_pingpong_buffer, BUF_SIZE);
        }
    }
}
```

### 3.5.4 实时消费任务循环

```c
uint16_t g_processed_channel_data[CHANNELS][SCAN_LOOPS];

/**
  * @brief  应用层轮询消费任务
  */
void App_DMA_ADC_Consumer_Task(void)
{
    if (g_dma_ready_flag)
    {
        // 立即清除就绪标志
        g_dma_ready_flag = 0;

        // 指向对应的半区首地址
        uint16_t* p_src = (g_dma_active_half == 0) ? 
                          &g_adc_pingpong_buffer[0] : 
                          &g_adc_pingpong_buffer[SCAN_LOOPS * CHANNELS];

        // 执行多通道解复用
        for (uint32_t i = 0; i < SCAN_LOOPS; i++)
        {
            g_processed_channel_data[0][i] = p_src[i * CHANNELS + 0]; // 通道 0
            g_processed_channel_data[1][i] = p_src[i * CHANNELS + 1]; // 通道 1
            g_processed_channel_data[2][i] = p_src[i * CHANNELS + 2]; // 通道 2
            g_processed_channel_data[3][i] = p_src[i * CHANNELS + 3]; // 通道 3
        }

        // 此处可以加入上一章设计的增量滑动平均滤波或一阶滞后滤波算法
        // Motor_FOC_Update(g_processed_channel_data[0], g_processed_channel_data[1]);
    }
}
```

通过本章的深入设计，我们将高速多通道采样在总线和内存层面进行了无阻碍的并发优化。在硬件 MPU、D-Cache 失效以及 OVR 自动恢复机制的多层防御下，系统在高频并发采样的复杂工业环境中仍能保证绝对的稳定性和数据连续性。
