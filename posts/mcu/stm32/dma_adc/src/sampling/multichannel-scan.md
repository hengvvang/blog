# 第一章：ADC 多通道扫描与硬件触发机制

在多通道高速数据采集系统中，如何保证每一个模拟通道的采样值真实反映输入电压，且各通道之间的采样时间点具备严格的确定性，是系统设计的首要挑战。本章将从模数转换器（ADC）内部的电容电荷分配物理过程出发，深入分析多通道扫描机制与定时器硬件触发原理。

---

## 1.1 SAR ADC 内部物理原理与电容阵列 (CDAC)

STM32 微控制器集成的 ADC 大多采用**逐次逼近型寄存器（SAR, Successive Approximation Register）**架构。其核心电路由采样保持电路、比较器、电容式数字模拟转换器（CDAC，电容网络）和逐次逼近寄存器组成。

### 1.1.1 逐次逼近型电容网络（CDAC）物理拓扑

为了理解 ADC 在采样与比较阶段的内部行为，我们需要分析其逐次逼近电容阵列（CDAC）的原理。以下是 5 位（作为简化示例）CDAC 网络与开关控制的内部拓扑图：

```
                                               Vref+   GND
                                                 |      |
                                                [o]    [o]  (由 SAR 逻辑独立控制)
                                                 \______/
                                                    |
         +------------------+------------------+----+-------------+-------------+
         |                  |                  |                  |             |
        ---                ---                ---                ---           ---
    16C | |             8C | |             4C | |             2C | |         C | |
        ---                ---                ---                ---           ---
         |                  |                  |                  |             |
         +------------------+------------------+------------------+-------------+
                                                                  |
                                                                  |  Vx (比较节点)
Vin (模拟输入) -----/  -------------------------------------------+-------------o (比较器同相端)
                采样开关                                                         |
                                                                                |
Vref- (模拟地) -----------------------------------------------------------------o (比较器反相端)
                                                                                |
                                                                                v
                                                                      +-------------------+
                                                                      | 比较器 (Comparator)|
                                                                      +---------+---------+
                                                                                | (输出)
                                                                                v
                                                                      +-------------------+
                                                                      |  SAR 控制逻辑与   |
                                                                      |  逐次逼近寄存器    |
                                                                      +-------------------+
```

### 1.1.2 CDAC 三阶段工作原理

1.  **采样/就绪阶段（Acquisition/Sampling Phase）**：
    采样开关（Sampling Switch）闭合。所有的 CDAC 电容下极板全部连接到模拟输入电压 $V_{in}$，上极板连接到比较器的公共端（被置为 $V_{ref-}$ 或虚拟地）。此时输入源对所有的电容充电，电容网络中储存的总电荷与 $V_{in}$ 成正比。
2.  **保持阶段（Hold Phase）**：
    采样开关断开。此时，公共端节点 $V_x$ 处于浮空状态。由于电荷守恒，这部分被“锁定”的电荷将保持不变。接着，CDAC 所有电容的下极板全部改接至模拟地 $V_{ref-}$。此时 $V_x$ 处的电位变为了 $-V_{in}$。
3.  **逐次逼近比较阶段（Approximation Phase）**：
    比较器开始逐位执行二分法（Binary Search）寻找对应的数字码。
    *   **测试最高有效位 (MSB)**：SAR 控制逻辑将最大电容（如 $16C$）的下极板改接到 $V_{ref+}$，其他电容下极板保持接地。根据电容分压原理，比较节点 $V_x$ 的电位变为：
        $$V_x = -V_{in} + \frac{16C}{32C} V_{ref+} = -V_{in} + \frac{1}{2}V_{ref+}$$
        比较器对 $V_x$ 与 0 伏进行比较：
        *   若 $V_x > 0$（即 $V_{in} < \frac{1}{2}V_{ref+}$），则 MSB 设为 0，该电容的下极板重新切回 $GND$；
        *   若 $V_x < 0$（即 $V_{in} \ge \frac{1}{2}V_{ref+}$），则 MSB 设为 1，该电容的下极板保持连接到 $V_{ref+}$。
    *   **测试次高位**：依次对 $8C$、$4C$ 等电容重复该步骤，直至最后一位 LSB 比较完成。最终，逐次逼近寄存器中锁存的数字值即为 $V_{in}$ 的数字化结果。

---

## 1.2 ADC 采样时间与输入阻抗匹配

在采样阶段，信号源必须在有限的采样时间 $T_{sampling}$ 内，将 ADC 内部电容网络充电到足够的精度。

### 1.2.1 阻抗匹配一阶滤波模型

在采样开关闭合时，信号源与 ADC 内部等效于一个一阶 RC 低通电路：

```
           R_ext (源阻抗)          R_adc (内部采样开关阻抗)
Vin (源) ----[======]----+-----------[======]-----------+
                         |                              |
                      C_ext (外部滤波电容)            C_adc (内部采样电容)
                         |                              |
                        GND                            GND
```

*   $R_{adc}$：ADC 内部模拟开关的等效电阻（通常在 $1\text{ k}\Omega \sim 5\text{ k}\Omega$ 之间，随 $V_{DDA}$ 电压降低而增大）。
*   $C_{adc}$：采样电容（通常为 $4\text{ pF} \sim 8\text{ pF}$）。
*   $R_{ext}$：被测信号源的等效输出阻抗。

### 1.2.2 采样精度与充电建立时间的推导

为了保证模数转换结果达到 $N$ 位（$N$-bit）的分辨率，充电结束时 $C_{adc}$ 上的电荷误差必须小于 $\frac{1}{2}$ LSB。
一阶 RC 充电的电压变化公式为：
$$V_c(t) = V_{in} \left(1 - e^{-\frac{t}{\tau}}\right)$$
其中时间常数 $\tau = (R_{ext} + R_{adc}) \times C_{adc}$。
要求误差小于 $\frac{1}{2^{N+1}}$，即：
$$e^{-\frac{T_{sampling}}{\tau}} < \frac{1}{2^{N+1}} \implies \frac{T_{sampling}}{\tau} > \ln\left(2^{N+1}\right)$$

*   对于 **12位 ADC**：$\ln(2^{13}) = \ln(8192) \approx 9.01$，即采样时间必须大于 $9.01$ 个时间常数 $\tau$。
*   对于 **16位 ADC**：$\ln(2^{17}) = \ln(131072) \approx 11.78$，即采样时间必须大于 $11.78$ 个时间常数 $\tau$。

由此可以导出最大允许源阻抗 $R_{ext}$ 的上限公式：
$$R_{ext} < \frac{T_{sampling}}{\ln(2^{N+1}) \times C_{adc}} - R_{adc}$$

> [!WARNING]
> 若源阻抗 $R_{ext}$ 过大（例如直接串联了 $100\text{ k}\Omega$ 分压电阻），且未采用运算放大器进行电压阻抗跟随，如果配置的采样时间 $T_{sampling}$ 过短，采样电容将无法充满电，导致转换结果偏低。
> 此外，在多通道扫描模式下，当前通道未充满的电荷会残留在 $C_{adc}$ 上，当开关切换到下一通道时，这些残留电荷会污染下一通道的信号，造成严重的**通道间串扰（Crosstalk）**。

---

## 1.3 多通道扫描模式与转换组机制

STM32 的 ADC 转换通道分为**规则组（Regular Group）**和**注入组（Injected Group）**。

*   **规则组**：正常顺序执行的通道序列，最多支持 16 个 Rank（通道槽位）。规则通道的转换结果均存放在同一个寄存器 `ADC_DR` 中。
*   **注入组**：类似于中断，最多支持 4 个 Rank。当注入组被触发时，会立即打断正在进行的规则组转换，转换完毕后再恢复规则组转换。注入组有 4 个独立的数据寄存器（`ADC_JDR1` $\sim$ `ADC_JDR4`），因此不需要绑定 DMA 也不会发生数据覆盖。

### 1.3.1 扫描模式与单次/连续转换的组合工作流

通过配置 `ADC_CFGR` 和 `ADC_CR` 寄存器，可以组合出四种工作模式：

| 模式 | 扫描配置 (`SCAN`) | 转换配置 (`CONT`) | 硬件工作机制 |
| :--- | :--- | :--- | :--- |
| **单次单通道模式** | 禁用 | 单次 | 触发一次，仅转换 Rank1 指定的通道，随后停止。 |
| **连续单通道模式** | 禁用 | 连续 | 触发一次，不断对 Rank1 通道进行转换，数据不断覆盖 `ADC_DR`。 |
| **单次扫描模式** | 启用 | 单次 | 触发一次，依次对 Rank1 到 RankM 转换。转换结束后停止，等待下次触发。 |
| **连续扫描模式** | 启用 | 连续 | 触发一次，依次对 Rank1 到 RankM 转换。结束后自动环回到 Rank1 循环执行。 |

在**连续扫描模式**下，必须开启 DMA 传输。因为所有的 Rank 共享同一个数据寄存器 `ADC_DR`，若没有 DMA 在每次转换完成的瞬间将结果搬运到内存，前一个通道的数据就会被后一个通道的数据直接覆盖。

---

## 1.4 定时器硬件触发机制与采样抖动消除

如果使用软件启动（如在 CPU 定时器中断中调用 `HAL_ADC_Start()`）来控制采样率，由于中断响应延迟、现场保护、操作系统任务调度等因素，每次采样的实际时间间隔并不均等。这种时间轴上的微小偏差被称为**采样抖动（Sampling Jitter）**。

### 1.4.1 采样抖动的危害

采样抖动会在频域引入额外的相位噪声。对于输入频率为 $f_{in}$ 的交流信号，抖动时间偏差 $\Delta t$ 引起的电压误差 $\Delta V$ 为：
$$\Delta V \approx \frac{dV(t)}{dt} \Delta t = 2\pi f_{in} V_{max} \Delta t$$
随着信号频率 $f_{in}$ 的上升，即使纳秒级的抖动也会严重拉低系统的动态范围，使得高精度 ADC 的信噪比（SNR）急剧恶化。

### 1.4.2 定时器 TRGO 硬件触发时序

为了实现完全无抖动的等间隔采样，STM32 内部设计了硬件联动机制：配置定时器（TIMx）在更新事件（Update Event）或比较事件时生成 **TRGO（Trigger Out）** 信号，通过内部硬连线直接送达 ADC 的外部触发输入口（EXTSEL）。整个过程完全不需要 CPU 中断的介入。

以下是硬件触发与 DMA 搬运的时序对齐图：

```
           |<------------------ T_trigger (1 / F_sample) ------------------->|
           |                                                                 |
TIM_CNT    /|                                /|                              /|
(计数器)   / |                              / |                             / |
         /  |                             /  |                            /  |
        /___|____________________________/___|___________________________/___|____
            ^                                ^                               ^
TIM_TRGO    |                                |                               |
(触发信号)  |__                              |__                             |__
          __|  |___________________________|  |___________________________|  |____
            |                                |                                |
ADC_STATE   |<--T_sample-->|<---T_sar--->|   |<--T_sample-->|<---T_sar--->|   |
(ADC状态)   |   采样阶段    |   逐次逼近   |   |   采样阶段    |   逐次逼近   |   |
          __|______________|_____________|___|______________|_____________|___|____
                                         ^                                   ^
ADC_EOC                                  |__                                 |__
(转换完成) ______________________________|  |_______________________________|  |___
                                         |                                   |
DMA_REQ                                  |__                                 |__
(DMA请求)  ______________________________|  |_______________________________|  |___
```

在 TRGO 硬件触发模式下，ADC 从接收到触发脉冲到开始采样的延迟是固定的数个 $ADC\_CLK$ 周期（通常为 2.5 或 3.5 个周期，用于内部同步），采样抖动基本为 0（仅受限于外部晶振的相噪）。

---

## 1.5 生产级硬件触发多通道采集 C 代码实现

下面提供一套基于 STM32G4（Cortex-M4）平台的生产级配置代码。我们使用定时器 **TIM2** 产生 100 kHz 的 TRGO 信号，硬件触发 **ADC1** 执行 4 通道扫描采样，数据通过 **DMA1 Channel 1** 自动搬运到内存中。

### 1.5.1 时钟与硬件引脚映射表

*   PA0 $\rightarrow$ ADC1_IN1 (Rank 1)
*   PA1 $\rightarrow$ ADC1_IN2 (Rank 2)
*   PA2 $\rightarrow$ ADC1_IN3 (Rank 3)
*   PA3 $\rightarrow$ ADC1_IN4 (Rank 4)

### 1.5.2 核心初始化源文件

```c
#include "stm32g4xx_ll_adc.h"
#include "stm32g4xx_ll_dma.h"
#include "stm32g4xx_ll_tim.h"
#include "stm32g4xx_ll_bus.h"
#include "stm32g4xx_ll_gpio.h"

#define ADC_CH_NUM      4       // 通道数量
#define BUF_SIZE        512     // 循环缓冲区容量 (存放 128 轮扫描数据)

uint16_t g_adc_raw_buffer[BUF_SIZE];

/**
  * @brief  配置 TIM2 作为 ADC1 的 100kHz 定时触发源
  * @param  None
  * @retval None
  */
static void TIM2_Trigger_Config(void)
{
    // 使能 TIM2 时钟，运行在APB1时钟域（假设为170MHz）
    LL_APB1_GRP1_EnableClock(LL_APB1_GRP1_PERIPH_TIM2);

    // 设置预分频，不分频
    LL_TIM_SetPrescaler(TIM2, 0);

    // 设置自动重装载值以生成 100kHz 频率 (170,000,000 / 100,000 - 1 = 1699)
    LL_TIM_SetAutoReload(TIM2, 1699);

    // 配置计数模式：向上计数
    LL_TIM_SetCounterMode(TIM2, LL_TIM_COUNTERMODE_UP);

    // 设置 TIM2 主模式输出选择：更新事件作为 TRGO 输出
    LL_TIM_SetTriggerOutput(TIM2, LL_TIM_TRGO_UPDATE);

    // 启用自动重载预装载使能（ARPE）
    LL_TIM_EnableARRPreload(TIM2);
}

/**
  * @brief  初始化配置 DMA1, ADC1 扫描模式与硬件触发联动
  */
void System_ADC_Trigger_Init(void)
{
    /* 1. 开启相关外设时钟 */
    LL_AHB1_GRP1_EnableClock(LL_AHB1_GRP1_PERIPH_DMA1);
    LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_ADC12);
    LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOA);

    /* 2. 配置 PA0 - PA3 为模拟输入 */
    LL_GPIO_InitTypeDef gpio_init = {0};
    gpio_init.Pin = LL_GPIO_PIN_0 | LL_GPIO_PIN_1 | LL_GPIO_PIN_2 | LL_GPIO_PIN_3;
    gpio_init.Mode = LL_GPIO_MODE_ANALOG;
    gpio_init.Pull = LL_GPIO_PULL_NO;
    LL_GPIO_Init(GPIOA, &gpio_init);

    /* 3. 配置 DMA1 Channel 1 搬运数据 */
    LL_DMA_SetPeriphAddress(DMA1, LL_DMA_CHANNEL_1, (uint32_t)&(ADC1->DR));
    LL_DMA_SetMemoryAddress(DMA1, LL_DMA_CHANNEL_1, (uint32_t)g_adc_raw_buffer);
    LL_DMA_SetDataLength(DMA1, LL_DMA_CHANNEL_1, BUF_SIZE);

    // 配置 DMA 方向：外设到内存，启用内存地址自增，外设地址固定
    LL_DMA_SetTransferDirection(DMA1, LL_DMA_CHANNEL_1, LL_DMA_DIRECTION_PERIPH_TO_MEMORY);
    LL_DMA_SetPeriphSize(DMA1, LL_DMA_CHANNEL_1, LL_DMA_PDATAALIGN_HALFWORD);
    LL_DMA_SetMemorySize(DMA1, LL_DMA_CHANNEL_1, LL_DMA_MDATAALIGN_HALFWORD);
    LL_DMA_SetMemoryIncrementMode(DMA1, LL_DMA_CHANNEL_1, LL_DMA_MINT_ENABLE);
    LL_DMA_SetPeriphIncrementMode(DMA1, LL_DMA_CHANNEL_1, LL_DMA_PINT_DISABLE);

    // 启用 DMA 循环传输模式 (Circular Mode)，硬件优先级设为非常高
    LL_DMA_SetMode(DMA1, LL_DMA_CHANNEL_1, LL_DMA_MODE_CIRCULAR);
    LL_DMA_SetChannelPriorityLevel(DMA1, LL_DMA_CHANNEL_1, LL_DMA_PRIORITY_VERYHIGH);

    // 开启 DMA 的半传输 (HT) 与 传输完成 (TC) 中断，用于双缓冲无锁切换
    LL_DMA_EnableIT_TC(DMA1, LL_DMA_CHANNEL_1);
    LL_DMA_EnableIT_HT(DMA1, LL_DMA_CHANNEL_1);

    /* 4. 配置 ADC1 扫描模式 */
    // 设置 ADC 异步时钟源，不分频
    LL_ADC_SetCommonClock(__LL_ADC_COMMON_INSTANCE(ADC1), LL_ADC_PATH_INTERNAL_NONE);
    
    // 退出深睡眠并使能内部电压调节器
    LL_ADC_DisableDeepPowerDown(ADC1);
    LL_ADC_EnableInternalRegulator(ADC1);
    // 延迟等待调节器稳定
    for (volatile uint32_t i = 0; i < 20000; i++);

    // 自动校准
    LL_ADC_StartCalibration(ADC1, LL_ADC_SINGLE_ENDED);
    while (LL_ADC_IsCalibrationOnGoing(ADC1) != 0);

    // 配置分辨率 12-bit，右对齐
    LL_ADC_SetResolution(ADC1, LL_ADC_RESOLUTION_12B);
    LL_ADC_SetDataAlignment(ADC1, LL_ADC_DATA_ALIGN_RIGHT);
    
    // 扫描模式配置：多通道扫描时必须开启
    LL_ADC_SetLowPowerMode(ADC1, LL_ADC_LP_MODE_NONE);
    // 注意：在单次触发下，扫描模式会转换完整个通道序列，将 CONT 设为单次，由定时器多次触发
    LL_ADC_SetConversionMode(ADC1, LL_ADC_CONV_SINGLE);
    
    // 启用无限 DMA 模式，即使计数器溢出也会持续产生 DMA 请求
    LL_ADC_SetDMATransferMode(ADC1, LL_ADC_REG_DMA_TRANSFER_UNLIMITED);

    /* 5. 配置 ADC 规则组通道序列 (Rank) */
    LL_ADC_REG_SetSequencerLength(ADC1, LL_ADC_REG_SEQ_SCAN_ENABLE_4BANDS);
    
    LL_ADC_REG_SetSequencerRanks(ADC1, LL_ADC_REG_RANK_1, LL_ADC_CHANNEL_1);  // PA0
    LL_ADC_REG_SetSequencerRanks(ADC1, LL_ADC_REG_RANK_2, LL_ADC_CHANNEL_2);  // PA1
    LL_ADC_REG_SetSequencerRanks(ADC1, LL_ADC_REG_RANK_3, LL_ADC_CHANNEL_3);  // PA2
    LL_ADC_REG_SetSequencerRanks(ADC1, LL_ADC_REG_RANK_4, LL_ADC_CHANNEL_4);  // PA3

    // 设置各通道采样时间：保守选择 24.5 个 ADC 时钟周期，以应对较高的信号阻抗
    LL_ADC_SetChannelSamplingTime(ADC1, LL_ADC_CHANNEL_1, LL_ADC_SAMPLETIME_24CYCLES_5);
    LL_ADC_SetChannelSamplingTime(ADC1, LL_ADC_CHANNEL_2, LL_ADC_SAMPLETIME_24CYCLES_5);
    LL_ADC_SetChannelSamplingTime(ADC1, LL_ADC_CHANNEL_3, LL_ADC_SAMPLETIME_24CYCLES_5);
    LL_ADC_SetChannelSamplingTime(ADC1, LL_ADC_CHANNEL_4, LL_ADC_SAMPLETIME_24CYCLES_5);

    /* 6. 绑定定时器硬件触发源 */
    // 设置触发源为 TIM2 TRGO 信号，且检测上升沿触发
    LL_ADC_REG_SetTriggerSource(ADC1, LL_ADC_REG_TRIG_EXT_TIM2_TRGO);
    LL_ADC_REG_SetTriggerEdge(ADC1, LL_ADC_REG_TRIG_EXT_EDGE_RISING);

    /* 7. 使能 ADC 并启动传输 */
    LL_ADC_Enable(ADC1);
    while (LL_ADC_IsActiveFlag_ADRDY(ADC1) == 0);

    // 使能 DMA 通道
    LL_DMA_EnableChannel(DMA1, LL_DMA_CHANNEL_1);
    
    // 启动 ADC 规则组转换（此时等待 TIM2 TRGO 脉冲到来）
    LL_ADC_REG_StartConversion(ADC1);

    // 配置 TIM2 并启动计数器，开始输出 100kHz 的采样触发信号
    TIM2_Trigger_Config();
    LL_TIM_EnableCounter(TIM2);
}
```

通过这一套高度优化的配置，我们消除了 CPU 软件启动 ADC 的不确定性，建立起了稳定且精度极高的硬件自主采样链路。在下一章中，我们将讨论当数据源充满杂音时，如何结合微控制器的硬件过采样和软件数字滤波算法，实现信号的精密预处理。
