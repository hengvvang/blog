# 3. 硬件过采样与均值滤波算法优化

在精密测量与控制系统中，仅靠提高 ADC 原始采样率是不够的。由于热噪声、开关噪声以及电源纹波的存在，ADC 的单次采样结果往往包含高频随机噪声。为了在不增加外部昂贵高精度 ADC 芯片的前提下提升信噪比（SNR）与有效分辨率，我们可以结合 STM32 内部集成的**硬件过采样单元（Hardware Oversampling）**与**软件数字滤波算法**。本章将对这两者的数学原理、寄存器配置以及工程优化实现进行全面深度剖析。

---

## 3.1 STM32 硬件过采样单元详解

许多现代 STM32 系列微控制器（如 STM32G4、H7、L4 等）内置了硬件过采样单元（Hardware Oversampling Unit）。该单元位于 ADC 常规转换通道的输出端，在硬件层自动完成多次转换结果的累加与右移，无需 CPU 进行任何数据处理，也不占用 DMA 带宽。

### 3.1.1 硬件过采样的数学原理

过采样技术（Oversampling）基于以下前提：信号中混有均匀分布的白噪声，且信号在采样期间有轻微的波动（如果没有波动，可通过人为注入微小的白噪声，即 Dither 抖动技术）。

假设 ADC 原始分辨率为 $N$ 位，如果我们将采样率提高 $M$ 倍，并将这 $M$ 次转换的样本累加求和：
$$S = \sum_{k=1}^{M} x_k$$
累加和 $S$ 的动态范围会相应扩大。如果我们将 $S$ 进行右移 $SF$（Shift Factor）位，即可得到过采样后的结果。

根据信号与系统理论，当过采样倍率为 $M$ 时，带内量化噪声功率将降低为原来的 $\frac{1}{M}$。这使得信噪比（SNR）提升了：
$$\Delta \text{SNR} = 10 \log_{10}(M) \text{ dB}$$
由于每增加 1 位（1 bit）分辨率相当于提升了大约 $6.02\text{ dB}$ 的信噪比，因此等效位数（ENOB, Effective Number of Bits）的提升量 $\Delta bit$ 为：
$$\Delta bit = \frac{10 \log_{10}(M)}{6.02} \approx 0.5 \log_2(M) = \log_4(M)$$

由此可见：
*   **4 倍过采样** ($M=4$)：可使 ENOB 提升 1 位。
*   **16 倍过采样** ($M=16$)：可使 ENOB 提升 2 位。
*   **256 倍过采样** ($M=256$)：可使 ENOB 提升 4 位。

### 3.1.2 寄存器级参数配置

在 STM32 的配置中，硬件过采样由两个核心寄存器位控制（以 `ADC_CFGR2` 为例）：
1.  **`OVSR[2:0]` (Oversampling Ratio)**：过采样倍率 $M$。可选范围通常为 $2\times$ 到 $1024\times$。
2.  **`OVSS[3:0]` (Oversampling Shift)**：移位因子 $SF$。指定对累加和右移多少位。

由于累加和最大可扩展至 $12\text{ bits} + \log_2(1024) = 22\text{ bits}$，必须通过右移截断将其适配到最终输出寄存器（如 16-bit 对齐的 `ADC_DR`）。

下表列出了常见过采样倍率下，硬件推荐的移位设置以保持增益一致：

| 过采样倍率 $M$ | 最大累加位数（若基准为 12B） | 推荐右移位数 $SF$ | 等效有效位数 (ENOB) | 输出数据缩放增益 |
| :--- | :--- | :--- | :--- | :--- |
| $2\times$ | 13-bit | 1-bit | 12.5-bit | $\times 1$ |
| $4\times$ | 14-bit | 2-bit | 13-bit | $\times 1$ |
| $16\times$ | 16-bit | 4-bit | 14-bit | $\times 1$ |
| $64\times$ | 18-bit | 6-bit | 15-bit | $\times 1$ |
| $256\times$ | 20-bit | 8-bit | 16-bit | $\times 1$ |
| $256\times$ | 20-bit | 4-bit | 16-bit | $\times 16$ (增益放大) |

> [!NOTE]
> 如果配置为右移 $SF < \log_2(M)$，则输出的数据值会被放大（即包含小数位的定点数表示），这可以保留低于 1 LSB 的微小变化，实现真正意义上的 16-bit 分辨率。

---

## 3.2 多通道软件数字滤波算法设计与优化

虽然硬件过采样能有效抑制高频白噪声，但对于系统电源轨带来的低频涟漪（如 50Hz 工频干扰或开关电源的几百 Hz 纹波），仍需依赖软件滤波器。在 DMA 多通道背景下，如何设计计算效率极高的滤波算法是关键。

### 3.2.1 优化版滑动平均滤波（Incremental Moving Average）

**传统滑动平均**公式为：
$$y[n] = \frac{1}{W} \sum_{k=0}^{W-1} x[n-k]$$
若窗口大小 $W=32$，每次新样本进来时，传统方法需要丢弃最老的数据，并循环累加 32 次，或移动整个数组。在多通道、高频采样下，这种 $O(W)$ 的计算开销会导致 CPU 满载。

**增量更新优化方案 ($O(1)$ 复杂度)**：
我们维护一个通道专用的**环形缓冲区（Circular Window）**和一个累加器 `Sum`。当新样本 $x[n]$ 到达时，我们找到最老的数据 $x[n-W]$，更新累加器：
$$\text{Sum}_{new} = \text{Sum}_{old} + x[n] - x[n-W]$$
$$y[n] = \text{Sum}_{new} \gg \log_2(W) \quad (\text{假设 } W \text{ 为 } 2\text{ 的幂次})$$
此时，无论窗口大小 $W$ 为多大（即使是 1024），每次滤波更新都仅需要：**1 次减法、1 次加法和 1 次移位**。

### 3.2.2 一阶滞后滤波（Recursive Exponential Filter）

一阶滞后滤波器（又称指数滑动平均，EMA）的数学表达式为：
$$y[n] = \alpha \cdot x[n] + (1 - \alpha) \cdot y[n-1]$$
其中权重因子 $\alpha \in (0, 1)$。

*   **定点数优化**：为了避免在无 FPU 的 MCU 上进行慢速浮点数乘法，我们将 $\alpha$ 转化为 $2^P$ 分母：
    设 $\alpha = \frac{1}{2^P}$，代入上式整理得：
    $$y[n] = y[n-1] + \frac{x[n] - y[n-1]}{2^P}$$
    化简为定点 C 代码：
    `y[n] = y[n-1] + ((x[n] - y[n-1]) >> P);`
*   **空间开销**：极低。不需要为每个通道维护一个历史队列，只需存储上一次的输出值 $y[n-1]$。

### 3.2.3 一维卡尔曼滤波（1D Kalman Filter）

对于传感器非线性漂移或伴随突发尖峰脉冲的噪声，卡尔曼滤波具有极强的自适应抑制能力。其在微控制器上的轻量级五步迭代公式为：

1.  **预测状态**：$x_{k|k-1} = x_{k-1}$
2.  **预测协方差**：$P_{k|k-1} = P_{k-1} + Q$
3.  **计算卡尔曼增益**：$K_k = \frac{P_{k|k-1}}{P_{k|k-1} + R}$
4.  **更新状态**：$x_k = x_{k|k-1} + K_k \cdot (z_k - x_{k|k-1})$
5.  **更新协方差**：$P_k = (1 - K_k) \cdot P_{k|k-1}$

其中 $Q$ 为系统过程噪声协方差，$R$ 为测量噪声协方差，$z_k$ 为 ADC 原始输入。

### 3.2.4 滤波算法综合对比

| 滤波器类型 | CPU 耗时 ($O$) | 内存开销 (RAM) | 阶跃响应相位延迟 | 适用噪声场景 |
| :--- | :--- | :--- | :--- | :--- |
| **硬件过采样** | **$0$ (完全硬件)** | **$0$** | 极低（等效于采样周期微调） | 高频热噪声、白噪声 |
| **一阶滞后滤波**| $O(1)$ | 极小（每个通道 1 个变量） | 中等（随阻尼增大而变长） | 缓变信号（如温度、气压） |
| **优化滑动平均**| $O(1)$ | 中等（每个通道 $W$ 个半字）| 较大（为窗口宽度的一半） | 周期性涟漪（如 50Hz 工频）|
| **卡尔曼滤波** | $O(1)$ 浮点运算 | 较小（每个通道 3 个浮点） | 自动自适应 | 动态性强且环境复杂的传感器 |

---

## 3.3 混合信号 PCB 级抗干扰与低噪声设计

没有任何软件算法可以完美拯救由于硬件 PCB 设计缺陷导致的受损信号。在高精度模数混合电路中，必须遵循严格的硬件物理隔离准则。

### 3.3.1 模拟地与数字地（AGND / DGND）分割与连接

数字电路（高频 CPU 开关、I/O 翻转、PWM 驱动）会在地平面上产生大量的瞬态高频回流噪声。如果这些噪声灌入敏感的模拟地，会直接导致 ADC 参考电压或输入信号抖动。

*   **单点接地（Star Grounding）**：模拟地（AGND）与数字地（DGND）在 PCB 空间上必须物理分割，仅在一点进行电气连接。单点连接处通常使用一个 $0\ \Omega$ 电阻或一个磁珠（Ferrite Bead），磁珠可为高频共模干扰提供极高的阻抗。

```
 [ 模拟电路区 (敏感) ]                  [ 数字电路区 (吵闹) ]
+---------------------+              +---------------------+
|        AGND         |              |        DGND         |
+----------+----------+              +----------+----------+
           |                                    |
           +-------------[ 0 Ohm / 磁珠 ]--------+
                               |
                        ( 唯一单点接地处 )
```

### 3.3.2 阻抗匹配与抗混叠滤波器（Anti-aliasing Filter）

根据奈奎斯特定理，为了防止高频噪声混叠（Aliasing）到有用频带内，必须在 ADC 输入引脚前放置一阶 RC 低通滤波器。

```
  Vin o------[  R  ]------+------o ADC_IN
                          |
                        [ C ]
                          |
                         GND
```

*   **截止频率计算**：设截止频率为 $f_c = \frac{1}{2 \pi R C}$。对于 $100\text{ kHz}$ 采样率的系统，RC 截止频率通常配置在 $10\text{ kHz} \sim 20\text{ kHz}$ 左右。
*   **电容容值选择**：$C$ 常选用 $100\text{ pF} \sim 1\text{ nF}$ 的高品质 C0G/NP0 陶瓷电容。避免使用高介电常数的材质（如 Y5V），因为它们的电容值随温度和偏压波动剧烈，会引入非线性失真。

### 3.3.3 基准源 VREF+ 的纹波隔离

ADC 的转换结果是输入电压与 $V_{REF+}$ 的比值。如果基准源电压存在 $1\%$ 的纹波，转换结果也会出现 $1\%$ 的误差。
*   **去耦设计**：$V_{REF+}$ 引脚必须紧挨着并联一个 $100\text{ nF}$ 陶瓷电容和一个 $10\ \mu\text{F}$ 钽电容或低内阻陶瓷电容，且回流路径要尽可能短。
*   在超高精度（如 16 位分辨率及以上）场景下，严禁使用不稳定的 VDD 作为 VREF+，必须选用专用超低噪声、低漂移外部精密基准芯片（如 ADR4530 或 REF3030）。

---

## 3.4 多通道优化数字滤波算法 C 语言实现

以下代码实现了针对多通道规则组采样的**滑动平均滤波（环形队列 + 增量更新优化）**和**一阶滞后滤波**。

### 3.4.1 头文件与数据结构定义 (`dsp_filter.h`)

```c
#ifndef DSP_FILTER_H
#define DSP_FILTER_H

#include <stdint.h>

#define FILTER_CHANNELS     4       // 通道数
#define MOV_AVG_WINDOW_POW  5       // 窗口大小为 2^5 = 32
#define MOV_AVG_WINDOW_SIZE (1 << MOV_AVG_WINDOW_POW)

/* 优化滑动平均滤波器上下文 */
typedef struct {
    uint16_t history[FILTER_CHANNELS][MOV_AVG_WINDOW_SIZE]; // 历史循环队列缓冲
    uint32_t sum[FILTER_CHANNELS];                          // 通道累加器
    uint16_t head;                                          // 环形缓冲写入指针
} MovAvgFilter_t;

/* 一阶滞后滤波器上下文 */
typedef struct {
    uint32_t last_output[FILTER_CHANNELS];                  // 上一次的输出值 (使用Q16定点数提高精度)
    uint16_t shift_factor;                                  // 指数分母偏移 P (alpha = 1 / 2^P)
} RecursiveFilter_t;

/* 函数声明 */
void MovAvg_Filter_Init(MovAvgFilter_t* filter);
void MovAvg_Filter_Update(MovAvgFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out);

void Recursive_Filter_Init(RecursiveFilter_t* filter, uint16_t shift_factor);
void Recursive_Filter_Update(RecursiveFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out);

#endif /* DSP_FILTER_H */
```

### 3.4.2 源文件实现 (`dsp_filter.c`)

```c
#include "dsp_filter.h"
#include <string.h>

/**
  * @brief  初始化滑动平均滤波器
  */
void MovAvg_Filter_Init(MovAvgFilter_t* filter)
{
    memset(filter->history, 0, sizeof(filter->history));
    memset(filter->sum, 0, sizeof(filter->sum));
    filter->head = 0;
}

/**
  * @brief  增量式多通道滑动平均更新 (O(1) 复杂度)
  * @param  filter 滤波器上下文指针
  * @param  p_raw_in 原始数据输入数组 (长度等于 FILTER_CHANNELS)
  * @param  p_filtered_out 滤波后数据输出数组 (长度等于 FILTER_CHANNELS)
  */
void MovAvg_Filter_Update(MovAvgFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out)
{
    uint16_t next_head = (filter->head + 1) & (MOV_AVG_WINDOW_SIZE - 1);

    for (uint32_t ch = 0; ch < FILTER_CHANNELS; ch++)
    {
        // 1. 获取当前环形位置中即将被覆盖的最老样本数据
        uint16_t oldest_val = filter->history[ch][filter->head];

        // 2. 增量更新累加器：加上新值，减去最老值
        filter->sum[ch] = filter->sum[ch] + p_raw_in[ch] - oldest_val;

        // 3. 将新值存入历史环形缓冲区，以便后续轮次剔除
        filter->history[ch][filter->head] = p_raw_in[ch];

        // 4. 计算平均值 (利用移位代替除法)
        p_filtered_out[ch] = (uint16_t)(filter->sum[ch] >> MOV_AVG_WINDOW_POW);
    }

    // 5. 更新环形写入游标
    filter->head = next_head;
}

/**
  * @brief  初始化一阶滞后滤波器
  */
void Recursive_Filter_Init(RecursiveFilter_t* filter, uint16_t shift_factor)
{
    memset(filter->last_output, 0, sizeof(filter->last_output));
    filter->shift_factor = shift_factor;
}

/**
  * @brief  多通道一阶滞后滤波更新
  * @param  filter 滤波器上下文指针
  * @param  p_raw_in 原始数据输入数组
  * @param  p_filtered_out 滤波后数据输出数组
  */
void Recursive_Filter_Update(RecursiveFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out)
{
    for (uint32_t ch = 0; ch < FILTER_CHANNELS; ch++)
    {
        /* 为了防止多次 >> 移位导致低位被截断产生静差，
           将内部状态 last_output 放大 65536 倍（Q16 定点数表示法）进行计算 */
        uint32_t current_val_q16 = ((uint32_t)p_raw_in[ch]) << 16;
        
        // 增量迭代公式： y[n] = y[n-1] + (x[n] - y[n-1]) >> P
        int32_t diff = (int32_t)current_val_q16 - (int32_t)filter->last_output[ch];
        
        filter->last_output[ch] += (diff >> filter->shift_factor);
        
        // 还原回 16 位整数形式输出
        p_filtered_out[ch] = (uint16_t)(filter->last_output[ch] >> 16);
    }
}
```

### 3.4.3 将滤波算法集成到双缓冲框架中

将我们在第 2 章中编写的 `Process_ADC_SubBuffer` 进行升级，直接原地对就绪半区的数据流进行实时多通道滤波运算：

```c
#include "dsp_filter.h"

// 静态实例化滤波器上下文
static MovAvgFilter_t g_mov_avg_inst;
static uint16_t g_cleaned_data[SAMPLES_PER_HALF][FILTER_CHANNELS];

void App_Filter_System_Init(void)
{
    // 系统启动时初始化滤波器
    MovAvg_Filter_Init(&g_mov_avg_inst);
}

/**
  * @brief  在 DMA 双缓冲半区就绪时调用的信号处理引擎
  * @param  p_src 就绪缓冲区的首地址
  */
void Process_ADC_SubBuffer_WithFilter(const uint16_t* p_src)
{
    uint16_t raw_temp[FILTER_CHANNELS];
    uint16_t filtered_temp[FILTER_CHANNELS];

    for (uint32_t i = 0; i < SAMPLES_PER_HALF; i++)
    {
        // 1. 抽取出当前时间切片的多通道原始采样数据
        raw_temp[0] = p_src[i * FILTER_CHANNELS + 0];
        raw_temp[1] = p_src[i * FILTER_CHANNELS + 1];
        raw_temp[2] = p_src[i * FILTER_CHANNELS + 2];
        raw_temp[3] = p_src[i * FILTER_CHANNELS + 3];

        // 2. 输入滤波器进行多通道实时并行处理
        MovAvg_Filter_Update(&g_mov_avg_inst, raw_temp, filtered_temp);

        // 3. 将滤波后的干净信号存入用户内存，供控制算法直接调用
        g_cleaned_data[i][0] = filtered_temp[0];
        g_cleaned_data[i][1] = filtered_temp[1];
        g_cleaned_data[i][2] = filtered_temp[2];
        g_cleaned_data[i][3] = filtered_temp[3];
    }
}
```

通过这一层优化，采集系统在物理层拥有了高频过采样的噪声压制能力，在软件层具备了针对低频工频及偶发脉冲的高效滤波机制，从而保证了采集到 RAM 中的数据具备极高的精度与稳定性。
