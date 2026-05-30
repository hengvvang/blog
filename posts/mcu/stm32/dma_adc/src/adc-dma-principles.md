# 1. ADC 与 DMA 底层协同与时序配合机制

要设计出高效、稳定且无数据丢失的高频多通道模拟信号采集系统，必须从芯片级的微观视角出发，理清模数转换器（ADC）内部的采样保持时序，以及直接内存访问（DMA）控制器在总线矩阵（Bus Matrix）中的数据搬运机制。本章将详细剖析这两者的底层协同原理。

---

## 1.1 SAR ADC 核心架构与采样时序推导

STM32 微控制器中集成的 ADC 大多采用**逐次逼近型寄存器（SAR, Successive Approximation Register）**架构。理解其工作流程需要深入到电容电荷分配的物理过程。

### 1.1.1 SAR ADC 内部原理

SAR ADC 核心电路由采样保持电路（Sample and Hold Circuit）、比较器（Comparator）、数字模拟转换器（DAC，通常采用电容网络 CDAC）和逐次逼近寄存器组成。

```
                    +------------------------------------+
                    |        逐次逼近寄存器 (SAR)        |
                    +-----------------+------------------+
                                      | (数字控制)
                                      v
                                +-----------+
Vin (模拟输入) ---[ 采样开关 ]---> | 电容 CDAC |---> (比较器同相端)
                                +-----------+          |
                                                       | (比较结果)
Vref (参考电压) -----------------> [ 比较基准 ]---> (比较器反相端) ----+
```

1.  **采样阶段（Sampling Phase）**：采样开关断开，电容网络（CDAC）与输入通道 $V_{in}$ 连接，对输入信号充电。在此期间，输入源必须为采样电容提供足够的电荷以达到与输入电压相等的稳定值。
2.  **保持与比较阶段（Hold & Conversion Phase）**：采样开关断开，将输入电压“锁定”在内部电容网络中。逐次逼近寄存器通过二分法（Binary Search）逐位调整 CDAC 的数字值，从最高有效位（MSB）到最低有效位（LSB）与被锁定的模拟电压进行比较。12-bit ADC 需要进行 12 次比较。

### 1.1.2 转换时间时序公式

ADC 的总转换时间 $T_{conv}$ 是采样时间 $T_{sampling}$ 与逐次逼近比较时间 $T_{SAR}$ 的之和：

$$T_{conv} = T_{sampling} + T_{SAR}$$

其中：
*   **$T_{sampling}$（采样时间）**：由软件配置的 ADC 时钟周期数（$ADC\_CLK$）决定。为了使输入电压在内部电容上完全稳定，采样周期必须大于或等于输入源阻抗所要求的最小电荷建立时间。
*   **$T_{SAR}$（比较时间）**：对于 $N$ 位分辨率的 ADC，比较周期是固定的。例如在 12-bit 分辨率下，STM32F4/G4 的 $T_{SAR}$ 通常为 12.5 个 $ADC\_CLK$ 周期（其中 12 个周期用于 12 次二分法比较，0.5 个周期用于同步与状态机切换）。而在 10-bit、8-bit 分辨率下，比较周期相应减少。

**时序计算示例**：
假设 $ADC\_CLK = 60\text{ MHz}$（时钟周期 $t_{ADC} = 16.67\text{ ns}$），软件配置采样时间 $T_{sampling} = 2.5$ 个周期。
在 12-bit 分辨率下，总转换周期为：
$$T_{conv\_cycles} = 2.5 + 12.5 = 15 \text{ 周期}$$
则单次转换时间为：
$$T_{conv} = 15 \times 16.67\text{ ns} = 250\text{ ns}$$
此时，ADC 的最大吞吐率（Throughput）可达：
$$F_{sample\_max} = \frac{1}{250\text{ ns}} = 4.0\text{ MSPS (Mega Samples Per Second)}$$

### 1.1.3 输入阻抗约束公式

在采样阶段，ADC 内部等效于一个一阶 RC 低通滤波器。

```
           R_ext (源阻抗)          R_adc (采样开关阻抗)
Vin (源) ----[======]----+-----------[======]-----------+
                         |                              |
                      C_ext (外部滤波电容)            C_adc (采样电容)
                         |                              |
                        GND                            GND
```

*   $R_{adc}$：ADC 内部开关的等效电阻（通常在数 $k\Omega$ 级别，例如 $1\text{ k}\Omega$）。
*   $C_{adc}$：ADC 内部采样保持电容（通常在 $4\text{ pF}$ 到 $8\text{ pF}$ 左右）。
*   $R_{ext}$：信号源的输出阻抗。

为了保证 12-bit 转换精度，采样期间 $C_{adc}$ 充电后的电压误差必须小于半个 LSB（即误差 $< \frac{1}{2^{N+1}} = \frac{1}{8192}$）。根据指数衰减规律：
$$e^{-\frac{T_{sampling}}{\tau}} < \frac{1}{8192} \implies \frac{T_{sampling}}{\tau} > \ln(8192) \approx 9.01$$
其中时间常数 $\tau = (R_{ext} + R_{adc}) \times C_{adc}$。因此，最大允许源阻抗 $R_{ext}$ 必须满足：
$$R_{ext} < \frac{T_{sampling}}{9.01 \times C_{adc}} - R_{adc}$$

> [!WARNING]
> 如果信号源输出阻抗较高，且没有使用运放进行阻抗匹配（Buffer），若设置的采样时间 $T_{sampling}$ 太短，将导致高频采样时电压充不满电容，采集到的数值会明显偏低，并伴随通道间的串扰（Crosstalk）。

---

## 1.2 AHB/APB 总线矩阵与 DMA 硬件握手时序

当 ADC 转换结束（EOC）时，如果不及时取走数据，下一次转换结果将会覆盖当前值。DMA 控制器作为 AHB 总线上的主控方（Master），负责将 ADC 数据寄存器（`ADC_DR`）中的数据搬运到 RAM。这一过程由硬件握手线及总线矩阵进行协调。

### 1.2.1 总线矩阵拓扑与并发访问

STM32 采用多层 AHB 总线矩阵（Multi-Layer AHB Bus Matrix），将不同的主设备（Cortex-M 核心、DMA1、DMA2、以太网等）与从设备（Flash、SRAM1/2、AHB-to-APB 桥等）相互连接。

```mermaid
graph TD
    subgraph Master Nodes (主控方)
        CPU["Cortex-M CPU (D-Code / System)"]
        DMA1["DMA1 Master"]
        DMA2["DMA2 Master"]
    end

    subgraph Bus Matrix (总线矩阵)
        BM["AHB Bus Matrix Arbitration Layer"]
    end

    subgraph Slave Nodes (被控方)
        SRAM1["SRAM1 (Data Buffer)"]
        SRAM2["SRAM2 (Stack/Heap)"]
        AHB2APB["AHB-to-APB Bridge"]
    end

    CPU --> BM
    DMA1 --> BM
    DMA2 --> BM

    BM --> SRAM1
    BM --> SRAM2
    BM --> AHB2APB

    subgraph APB Peripherals
        AHB2APB --> ADC1["ADC1 Peripheral"]
        AHB2APB --> TIM2["TIM2 (Trigger)"]
    end
```

在总线矩阵中，只要 CPU 和 DMA 访问的是不同的物理从设备（例如 CPU 读写 SRAM2 中的局部变量，DMA 写入 SRAM1 中的 ADC 接收缓存），两者就可以**并行工作，实现零等待周期**。

### 1.2.2 DMA 硬件握手协议 (Request / Acknowledge)

ADC 与 DMA 之间的交互并非通过软件，而是通过专用硬件信号线进行硬件握手：

1.  **`dma_req` (DMA 请求)**：当 ADC 转换完成，`EOC` 标志置位，且使能了 DMA 请求（`ADDMA = 1`），ADC 会向 DMA 控制器发送一个高电平的脉冲或持续信号 `dma_req`。
2.  **DMA 内部仲裁与总线分配**：DMA 接收到 `dma_req` 后，根据该通道的软件和硬件优先级进行仲裁。在获得总线控制权后，DMA 开始启动传输。
3.  **读外设**：DMA 主控单元在 AHB 总线上向 APB 桥发起读操作，读取 `ADC_DR` 寄存器。此时硬件自动清除 ADC 的 `EOC` 信号，并将 `dma_req` 拉低。
4.  **写内存**：DMA 随后在同一个传输周期（或经由内部 FIFO）向 AHB 总线上的目的 SRAM 地址发起写操作。
5.  **`dma_ack` (DMA 应答)**：在一些高级 DMA 控制器中，完成传输后会向外设发送一个应答信号，告知转换数据已被成功取走。

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
DMA Bus Access            |   Read ADC_DR    |   Write SRAM     |
             ____________|__________________|__________________
                                                    __________
dma_ack / Done                                     |          |
             ______________________________________|          |___
```

---

## 1.3 高频采样下的 Overrun 错误与总线冲突

在高频（大于 1 MSPS）多通道数据采集系统中，由于总线竞争或 CPU 频繁中断，可能会发生严重的传输错误。

### 1.3.1 Overrun (OVR) 溢出错误的物理成因

ADC 的**溢出错误（Overrun）**是指：在新一次的模数转换完成并产生 `EOC` 时，前一次转换的数据尚未被 DMA 或 CPU 读走。此时：
*   如果 `ADC_CFGR` 中的 `OVRMOD` 位设为 0：新转换的数据会被丢弃，`ADC_DR` 保持老数据。
*   如果 `ADC_CFGR` 中的 `OVRMOD` 位设为 1：新转换的数据会覆盖 `ADC_DR` 中的老数据。
*   在两种情况下，ADC 的状态寄存器（`ADC_SR` 或 `ADC_ISR`）中的 `OVR` 标志位都会置 1，并产生溢出中断（如果使能了 `OVRIE`）。

**主要成因**：
1.  **DMA 通道被挂起或优先级过低**：其他高优先级 DMA 通道（例如大吞吐量的 SPI 发送、以太网数据包搬运）长时间独占 AHB 总线，导致 ADC 通道的 `dma_req` 迟迟无法得到仲裁响应。
2.  **SRAM 读写冲突（Bus Contention）**：当 CPU 以紧密循环（如 `memcpy` 或计算重度滤波）高频访问 DMA 正在写入的同一个 SRAM 分区时，总线矩阵的仲裁器会插入等待周期（Wait States），从而延长了 DMA 单次搬运的耗时。

### 1.3.2 寄存器诊断与故障恢复策略

当 OVR 错误发生时，ADC 传输往往会彻底卡死（停止发送 DMA 请求）。系统设计中必须有自动恢复机制：

```c
/**
  * @brief  ADC 溢出中断/错误处理函数（中断服务程序中调用）
  * @param  hadc ADC句柄
  * @retval None
  */
void DMA_ADC_IRQHandler_OVR_Fix(ADC_HandleTypeDef* hadc)
{
    // 检测 ADC 状态寄存器中的 OVR 标志
    if (__HAL_ADC_GET_FLAG(hadc, ADC_FLAG_OVR))
    {
        /* 1. 清除溢出错误标志 */
        __HAL_ADC_CLEAR_FLAG(hadc, ADC_FLAG_OVR);

        /* 2. 停止当前 DMA 传输，避免状态机紊乱 */
        HAL_ADC_Stop_DMA(hadc);

        /* 3. 清空 DMA 缓冲区并重新初始化其传输计数器 */
        // 此处可以重置缓冲区指针，防止由于错位导致通道映射偏移

        /* 4. 重新启动 ADC DMA 采样 */
        HAL_ADC_Start_DMA(hadc, (uint32_t*)g_adc_raw_buffer, ADC_BUFFER_SIZE);
        
        // 5. 记录系统错误日志，用于后端的系统抖动诊断
        System_Log_Error(ERROR_ADC_OVERRUN);
    }
}
```

> [!TIP]
> **总线优化防御方案**：将 DMA 缓冲区分配到独立的物理内存区。例如，在 STM32H7 系列中，将 ADC 缓冲区放置在 **D2 域的 AXI SRAM** 或 **DTCM** 中，与 CPU 常用的 D1 域 AXI-SRAM 隔离开来，从硬件上消除总线锁竞争。

---

## 1.4 LL/HAL 级底层初始化与时钟配置规范

下面展示如何使用 STM32 HAL/LL 库，以底层寄存器配置为基准，配置 ADC 采样时钟、采样时间以及 DMA 循环模式。

### 1.4.1 时钟树设计规范

ADC 时钟源通常有两种选择：
1.  **同步时钟（Synchronous Clock）**：直接分频自 AHB 时钟（例如 `PCLK2`）。其优点是没有跨时钟域的时序抖动，缺点是主频改变时会影响采样率。
2.  **异步时钟（Asynchronous Clock）**：源自独立的 PLL（如 `PLLP` 或 `PLLQ`），即使 AHB 时钟运行在极高频率（如 H7 的 480MHz），异步时钟也能独立分频到 ADC 所需的安全频率（如 $50\text{ MHz}$）。

### 1.4.2 寄存器初始化代码实现 (C 语言)

以下为 STM32G4 平台下的 ADC1 单通道配合 DMA1 Channel1 的高吞吐初始化实现：

```c
#include "stm32g4xx_ll_adc.h"
#include "stm32g4xx_ll_dma.h"
#include "stm32g4xx_ll_bus.h"
#include "stm32g4xx_ll_gpio.h"

#define ADC_BUFFER_SIZE 1024
uint16_t g_adc_raw_buffer[ADC_BUFFER_SIZE];

void MX_DMA_ADC_Init(void)
{
    /* 1. 开启外设时钟 */
    LL_AHB1_GRP1_EnableClock(LL_AHB1_GRP1_PERIPH_DMA1);
    LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_ADC12);
    LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOA); // PA0 作为 ADC12_IN1

    /* 2. 配置 GPIO 为模拟输入模式 */
    LL_GPIO_SetPinMode(GPIOA, LL_GPIO_PIN_0, LL_GPIO_MODE_ANALOG);
    LL_GPIO_SetPinPull(GPIOA, LL_GPIO_PIN_0, LL_GPIO_PULL_NO);

    /* 3. 配置 DMA1 Channel1 */
    LL_DMA_SetPeriphAddress(DMA1, LL_DMA_CHANNEL_1, (uint32_t)&(ADC1->DR));
    LL_DMA_SetMemoryAddress(DMA1, LL_DMA_CHANNEL_1, (uint32_t)g_adc_raw_buffer);
    LL_DMA_SetDataLength(DMA1, LL_DMA_CHANNEL_1, ADC_BUFFER_SIZE);
    
    // 配置 DMA 传输方向：外设 -> 内存
    LL_DMA_SetTransferDirection(DMA1, LL_DMA_CHANNEL_1, LL_DMA_DIRECTION_PERIPH_TO_MEMORY);
    // 配置地址自增模式：外设地址固定，内存地址递增 (16位)
    LL_DMA_SetPeriphSize(DMA1, LL_DMA_CHANNEL_1, LL_DMA_PDATAALIGN_HALFWORD);
    LL_DMA_SetMemorySize(DMA1, LL_DMA_CHANNEL_1, LL_DMA_MDATAALIGN_HALFWORD);
    LL_DMA_SetMemoryIncrementMode(DMA1, LL_DMA_CHANNEL_1, LL_DMA_MINT_ENABLE);
    LL_DMA_SetPeriphIncrementMode(DMA1, LL_DMA_CHANNEL_1, LL_DMA_PINT_DISABLE);
    
    // 配置为循环模式 (Circular Mode)，溢出后自动重载，实现不间断采集
    LL_DMA_SetMode(DMA1, LL_DMA_CHANNEL_1, LL_DMA_MODE_CIRCULAR);
    // 设置通道优先级：高 (High Priority)
    LL_DMA_SetChannelPriorityLevel(DMA1, LL_DMA_CHANNEL_1, LL_DMA_PRIORITY_HIGH);
    
    /* 开启半传输 (HT) 与 传输完成 (TC) 中断 */
    LL_DMA_EnableIT_TC(DMA1, LL_DMA_CHANNEL_1);
    LL_DMA_EnableIT_HT(DMA1, LL_DMA_CHANNEL_1);

    /* 4. 配置 ADC1 */
    // 选择异步时钟源，PLLP 分频输出，无同步预分频
    LL_ADC_SetCommonClock(__LL_ADC_COMMON_INSTANCE(ADC1), LL_ADC_PATH_INTERNAL_NONE);
    
    // 禁用 ADC 的深睡眠以准备校准
    LL_ADC_DisableDeepPowerDown(ADC1);
    LL_ADC_EnableInternalRegulator(ADC1);
    
    // 延时等待 ADC 电压稳压器稳定 (通常 > 20us)
    for (volatile uint32_t i = 0; i < 10000; i++);

    /* 5. 运行自动自校准 (Calibration) */
    LL_ADC_StartCalibration(ADC1, LL_ADC_SINGLE_ENDED);
    while (LL_ADC_IsCalibrationOnGoing(ADC1) != 0); // 等待校准完成

    // 配置分辨率、数据右对齐、连续转换模式
    LL_ADC_SetResolution(ADC1, LL_ADC_RESOLUTION_12B);
    LL_ADC_SetDataAlignment(ADC1, LL_ADC_DATA_ALIGN_RIGHT);
    LL_ADC_SetLowPowerMode(ADC1, LL_ADC_LP_MODE_NONE);
    
    // 配置常规组转换模式：连续转换
    LL_ADC_SetConversionMode(ADC1, LL_ADC_CONV_CONTINUOUS);
    
    // 配置 DMA 传输模式：循环模式，不断请求 DMA
    LL_ADC_SetDMATransferMode(ADC1, LL_ADC_REG_DMA_TRANSFER_UNLIMITED);

    // 配置序列长度（本章单通道，长度为1）与采样通道通道映射
    LL_ADC_REG_SetSequencerLength(ADC1, LL_ADC_REG_SEQ_SCAN_DISABLE);
    LL_ADC_REG_SetSequencerRanks(ADC1, LL_ADC_REG_RANK_1, LL_ADC_CHANNEL_1);
    
    // 设置采样时间：根据源阻抗，选择相对保守的 24.5 个 ADC 时钟周期，兼顾高频与输入阻抗
    LL_ADC_SetChannelSamplingTime(ADC1, LL_ADC_CHANNEL_1, LL_ADC_SAMPLETIME_24CYCLES_5);

    /* 6. 使能外设并开启采集 */
    LL_ADC_Enable(ADC1);
    while (LL_ADC_IsActiveFlag_ADRDY(ADC1) == 0); // 等待 ADC 就绪

    // 启动 DMA 通道
    LL_DMA_EnableChannel(DMA1, LL_DMA_CHANNEL_1);
    // 启动常规通道转换
    LL_ADC_REG_StartConversion(ADC1);
}
```

通过上述时序配置与寄存器设置，我们将 ADC-DMA 底层链路完全建立。下一章，我们将在此基础上，将其扩展到多通道扫描（Scan Mode）和双缓冲（乒乓缓冲）的高级架构中。
