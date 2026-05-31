# 第二章：硬件过采样与均值滤波算法

在精密测控与微弱信号采集系统中，仅靠提高 ADC 的原始采样率是不够的。由于系统热噪声、高速开关器件引入的纹波以及电源噪声的普遍存在，ADC 的单次采样结果往往包含高频随机噪声。

为了在不增加外部精密 ADC 芯片成本的前提下提升系统信噪比（SNR）与有效分辨率（ENOB），我们可以结合 STM32 内部集成的**硬件过采样单元（Hardware Oversampling）**与**软件数字滤波算法**。本章将对这两者的数学原理、寄存器配置、滤波设计以及硬件抗干扰设计进行全面剖析。

---

## 2.1 硬件过采样单元（Oversampling）原理与寄存器配置

很多现代 STM32 系列微控制器（如 STM32G4, STM32H7, STM32L4 等）内置了硬件过采样单元。它位于 ADC 常规规则转换通道的数据输出端，在硬件层面自动完成多次采样值的累加与右移，无需 CPU 干预，也不占用 DMA 总线带宽。

### 2.1.1 动态范围提升与量化噪声分布时序图

过采样技术的核心思想是：以更高的采样速率对信号进行采样，然后进行滤波和数字降采样（抽取，Decimation）。如果量化噪声在采样频带内呈均匀白噪声分布，那么增加采样率会把相同的噪声能量均匀分散到更宽的频域中，从而降低了有用信号频带内的噪声功率。

下图形象地展示了过采样及抽取滤波对信噪比和动态范围提升的过程：

```
1. 原始采样 (Fs)
   功率谱密度 (PSD)
    ^
    | +--------------------+  <-- 量化噪声底噪 (Quantization Noise Floor)
    | |                    |
    | |  有用信号带宽      |
    +-+--------------------+---------> 频率 (f)
      0                   Fs/2

2. 过采样 (M * Fs)
    ^
    |
    |                 
    | +--+            <-- 有用信号带
    | |  |--------------------------+ <-- 噪声底噪被降低为 1/M (Noise Floor lowered by 1/M)
    +-+--+--------------------------+---------> 频率 (f)
      0 Fs/2                       M*Fs/2

3. 数字低通滤波 (Digital LPF)
    ^
    |    \
    | +--+\           <-- 滤波器截止频率 (Fs/2)
    | |  | \ (滤波)   :::::::::::::::: (被数字滤波器滤除的带外噪声)
    +-+--+--\---------::::::::::::::::---------> 频率 (f)
      0 Fs/2                               M*Fs/2

4. 降采样/抽取与输出 (Decimation to Fs)
    ^
    | +--+            
    | |  |            <-- 带外噪声被削减，信噪比提升，等效位数 (ENOB) 增加
    +-+--+---------------------> 频率 (f)
      0 Fs/2
```

### 2.1.2 有效分辨率（ENOB）提升的数学推导

假设原始 ADC 的分辨率为 $N$ 位，如果我们将采样率提高到信号最高频率的两倍（奈奎斯特频率）的 $M$ 倍，并将 $M$ 次转换的样本累加求和：
$$S = \sum_{k=1}^{M} x_k$$
累加和 $S$ 的动态范围会相应扩大。如果我们将 $S$ 进行右移 $SF$（Shift Factor）位，即可得到过采样后的结果。

根据信号与系统理论，当过采样倍率为 $M$ 时，带内量化噪声功率将降低为原来的 $\frac{1}{M}$。这使得信噪比（SNR）提升了：
$$\Delta \text{SNR} = 10 \log_{10}(M) \text{ dB}$$
由于每增加 1 位（1 bit）分辨率相当于提升了大约 $6.02\text{ dB}$ 的信噪比，因此等效位数（ENOB, Effective Number of Bits）的提升量 $\Delta bit$ 为：
$$\Delta bit = \frac{10 \log_{10}(M)}{6.02} \approx 0.5 \log_2(M) = \log_4(M)$$

由此可见：
*   **4 倍过采样** ($M=4$)：$\Delta bit = \log_4(4) = 1\text{ bit}$。
*   **16 倍过采样** ($M=16$)：$\Delta bit = \log_4(16) = 2\text{ bits}$。
*   **256 倍过采样** ($M=256$)：$\Delta bit = \log_4(256) = 4\text{ bits}$。对于 12-bit ADC，过采样可使其等效达到 16-bit 精度。

### 2.1.3 寄存器参数配置规范

在 STM32 中，硬件过采样由两个核心寄存器位控制（以 `ADC_CFGR2` 为例）：
1.  **`OVSR[2:0]` (Oversampling Ratio)**：过采样倍率 $M$。可选范围通常为 $2\times$ 到 $1024\times$。
2.  **`OVSS[3:0]` (Oversampling Shift)**：移位因子 $SF$。指定对累加和右移多少位。
3.  **`ROVSE` (Regular Oversampling Enable)**：开启规则通道过采样。

由于累加和最大可扩展至 $12\text{ bits} + \log_2(1024) = 22\text{ bits}$，必须通过右移截断将其适配到最终输出寄存器（如 16-bit 对齐的 `ADC_DR`）。
下表列出了常见过采样倍率下，硬件推荐的移位设置以保持增益一致：

| 过采样倍率 $M$ | 最大累加位数（基准为 12B） | 推荐右移位数 $SF$ | 等效有效位数 (ENOB) | 输出数据缩放增益 |
| :--- | :--- | :--- | :--- | :--- |
| $2\times$ | 13-bit | 1-bit | 12.5-bit | $\times 1$ |
| $4\times$ | 14-bit | 2-bit | 13-bit | $\times 1$ |
| $16\times$ | 16-bit | 4-bit | 14-bit | $\times 1$ |
| $64\times$ | 18-bit | 6-bit | 15-bit | $\times 1$ |
| $256\times$ | 20-bit | 8-bit | 16-bit | $\times 1$ |
| $256\times$ | 20-bit | 4-bit | 16-bit | $\times 16$ (定点数无损缩放) |

---

## 2.2 多通道软件数字滤波算法设计与优化

虽然硬件过采样能有效抑制高频随机噪声，但对于系统电源轨带来的低频涟漪（如 50Hz 工频干扰或开关电源的纹波），仍需依赖软件滤波器。在高频采集下，必须配置计算效率极高的滤波算法以防 CPU 满载。

### 2.2.1 增量式滑动平均滤波（$O(1)$ 时间复杂度）

传统滑动平均算法公式如下：
$$y[n] = \frac{1}{W} \sum_{k=0}^{W-1} x[n-k]$$
若窗口大小 $W=32$，每次新样本进来时，传统方法需要对 32 个历史样本进行累加。在高频采样下，其 $O(W)$ 的计算开销会导致 CPU 负担极大。

**增量更新优化方案 ($O(1)$ 复杂度)**：
我们维护一个通道专用的环形缓冲区和一个累加器 `Sum`。当新样本 $x[n]$ 存入环形队列并准备覆盖最老数据 $x[n-W]$ 时，更新公式为：
$$\text{Sum}_{new} = \text{Sum}_{old} + x[n] - x[n-W]$$
$$y[n] = \text{Sum}_{new} \gg \log_2(W) \quad (\text{其中窗口大小 } W \text{ 取为 } 2 \text{ 的幂次})$$
通过该公式，无论窗口大小 $W$ 为多大（即使是 1024），每次滤波更新都仅需要：**1 次减法、1 次加法和 1 次移位**。

### 2.2.2 一阶滞后滤波（定点数 Q16 优化）

一阶滞后滤波器（指数滑动平均，EMA）的数学表达式为：
$$y[n] = \alpha \cdot x[n] + (1 - \alpha) \cdot y[n-1]$$
其中权重因子 $\alpha \in (0, 1)$。

为了避免在没有硬件 FPU 的微控制器上执行慢速浮点数乘法，我们采用定点数表示：
设 $\alpha = \frac{1}{2^P}$，代入上式整理得：
$$y[n] = y[n-1] + \frac{x[n] - y[n-1]}{2^P}$$
化简为移位 C 代码：
`y[n] = y[n-1] + ((x[n] - y[n-1]) >> P);`

**Q16 精度优化**：若直接用 16 位整数计算 `(x[n] - y[n-1]) >> P`，当输入与输出偏差较小时，由于右移会直接丢弃低位，会引入显著的**静差（Quantization Deadband）**。
解决方案是将内部状态值 `last_output` 乘以 65536，以 Q16 定点格式保存，仅在最终输出时右移 16 位还原为 16-bit 整数。

### 2.2.3 一维卡尔曼滤波（1D Kalman Filter）

卡尔曼滤波可根据系统动态模型和当前测量值，自适应地调整卡尔曼增益，兼顾噪声抑制与响应速度。其在 MCU 上的轻量级五步迭代公式为：

1.  **预测当前状态**（假设为静态系统）：
    $$x_{k|k-1} = x_{k-1}$$
2.  **预测协方差**（加入系统过程噪声 $Q$）：
    $$P_{k|k-1} = P_{k-1} + Q$$
3.  **计算卡尔曼增益**（引入测量噪声 $R$）：
    $$K_k = \frac{P_{k|k-1}}{P_{k|k-1} + R}$$
4.  **根据测量值 $z_k$ 更新估计状态**：
    $$x_k = x_{k|k-1} + K_k \cdot (z_k - x_{k|k-1})$$
5.  **更新误差协方差**：
    $$P_k = (1 - K_k) \cdot P_{k|k-1}$$

在 MCU 开发中，常设 $Q$ 在 $10^{-5} \sim 10^{-3}$ 之间，$R$ 在 $10^{-3} \sim 10^{-1}$ 之间。$Q$ 越小系统越平滑，响应越慢；$R$ 越小系统对当前测量值的信任度越高，响应越快。

### 2.2.4 滤波算法综合对比

| 滤波器类型 | CPU 耗时 ($O$) | 内存开销 (RAM) | 阶跃响应相位延迟 | 适用噪声场景 |
| :--- | :--- | :--- | :--- | :--- |
| **硬件过采样** | **$0$ (完全硬件)** | **$0$** | 极低（仅等效于采样时钟微调） | 随机热噪声、高频白噪声 |
| **一阶滞后滤波** | $O(1)$ | 极小（每通道 1 个变量） | 中等（随阻尼增大而变长） | 变化缓慢的物理量（温度、电芯电压） |
| **增量滑动平均** | $O(1)$ | 中等（每通道 $W$ 个半字）| 较大（随窗口宽度增加呈线性增加）| 周期性涟漪（如 50Hz/100Hz 工频噪声）|
| **一维卡尔曼滤波** | $O(1)$（含浮点数）| 较小（每通道 3 个浮点变量）| 自适应调整，延迟低 | 环境恶劣、尖峰脉冲大的传感器信号 |

---

## 2.3 混合信号 PCB 级抗干扰与低噪声设计

没有任何算法可以拯救物理上被严重污染的模拟信号。在高精度模数混合 PCB 设计中，必须遵循以下准则：

### 2.3.1 模拟地与数字地（AGND / DGND）单点接地设计

数字电路（CPU 核心、I/O 翻转、PWM 功率回路）在工作时会产生很强的瞬态共模电流。为避免这些回流污染脆弱的模拟采样回路，必须将模拟地平面（AGND）与数字地平面（DGND）进行物理隔离。

两个地平面在电气上仅在**一点**相连（通常在 ADC 参考源附近），连接处可选用一个 $0\ \Omega$ 电阻或一个磁珠（Ferrite Bead）：

```
 [ 模拟电路区 (弱电/敏感) ]              [ 数字电路区 (强电/噪声) ]
+-------------------------+              +-------------------------+
|          AGND           |              |          DGND           |
+------------+------------+              +------------+------------+
             |                                        |
             +-------------[ 0 Ohm / 磁珠 ]-----------+
                                  |
                           ( 唯一单点接地处 )
```

### 2.3.2 RC 抗混叠滤波器（Anti-aliasing Filter）配置

为了防止高频噪声混叠进入 ADC 采样带内，必须在 ADC 模拟输入引脚前设计一阶低通抗混叠滤波器：

```
  Vin (源) o------[  R_ext  ]------+------o ADC_IN
                                   |
                                 [ C_ext ] (NP0/C0G 电容)
                                   |
                                  GND
```

*   **截止频率公式**：$f_c = \frac{1}{2\pi R_{ext} C_{ext}}$。
*   **配置实例**：若采样率为 100 kHz，可配置截止频率在 $10\text{ kHz} \sim 20\text{ kHz}$。通常选 $R_{ext} = 100\ \Omega$，$C_{ext} = 150\text{ nF}$。
*   **电容材质要求**：外部滤波电容必须选用 **C0G 或 NP0** 陶瓷电容。严禁在模拟链路中使用高介电常数的 Y5V、Z5U 等电容，它们会随偏置电压变化引入严重的非线性失真。

---

## 2.4 多通道优化数字滤波算法 C 语言实现

以下是实现多通道增量式滑动平均、定点 Q16 一阶滞后及卡尔曼滤波的完整模块化代码。

### 2.4.1 头文件定义 (`dsp_filter.h`)

```c
#ifndef DSP_FILTER_H
#define DSP_FILTER_H

#include <stdint.h>

#define FILTER_CHANNELS     4       // 处理的模拟通道数量
#define MOV_AVG_WINDOW_POW  5       // 滑动窗口大小为 2^5 = 32
#define MOV_AVG_WINDOW_SIZE (1 << MOV_AVG_WINDOW_POW)

/* 优化滑动平均滤波器上下文 */
typedef struct {
    uint16_t history[FILTER_CHANNELS][MOV_AVG_WINDOW_SIZE]; // 循环历史队列
    uint32_t sum[FILTER_CHANNELS];                          // 通道累加器
    uint16_t head;                                          // 环形队列写入游标
} MovAvgFilter_t;

/* 一阶滞后滤波器上下文 (定点数 Q16 版) */
typedef struct {
    uint32_t last_output_q16[FILTER_CHANNELS];              // 上一次的输出 (Q16格式)
    uint16_t shift_factor;                                  // 指数分母偏移 P
} RecursiveFilter_t;

/* 一维卡尔曼滤波器上下文 */
typedef struct {
    float x_est[FILTER_CHANNELS];                           // 估计状态
    float P_est[FILTER_CHANNELS];                           // 估计协方差
    float Q;                                                // 过程噪声协方差
    float R;                                                // 测量噪声协方差
} KalmanFilter1D_t;

/* 函数接口声明 */
void MovAvg_Filter_Init(MovAvgFilter_t* filter);
void MovAvg_Filter_Update(MovAvgFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out);

void Recursive_Filter_Init(RecursiveFilter_t* filter, uint16_t shift_factor);
void Recursive_Filter_Update(RecursiveFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out);

void Kalman_Filter_Init(KalmanFilter1D_t* filter, float Q, float R, float initial_val);
void Kalman_Filter_Update(KalmanFilter1D_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out);

#endif /* DSP_FILTER_H */
```

### 2.4.2 源文件实现 (`dsp_filter.c`)

```c
#include "dsp_filter.h"
#include <string.h>

/**
  * @brief  初始化滑动平均滤波器上下文
  */
void MovAvg_Filter_Init(MovAvgFilter_t* filter)
{
    memset(filter->history, 0, sizeof(filter->history));
    memset(filter->sum, 0, sizeof(filter->sum));
    filter->head = 0;
}

/**
  * @brief  多通道增量式滑动平均更新 (O(1) 复杂度)
  * @param  filter 滤波器上下文指针
  * @param  p_raw_in 原始通道数据输入缓冲区 (长度等于 FILTER_CHANNELS)
  * @param  p_filtered_out 滤波后数据输出缓冲区 (长度等于 FILTER_CHANNELS)
  */
void MovAvg_Filter_Update(MovAvgFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out)
{
    uint16_t next_head = (filter->head + 1) & (MOV_AVG_WINDOW_SIZE - 1);

    for (uint32_t ch = 0; ch < FILTER_CHANNELS; ch++)
    {
        // 1. 读取当前游标中即将被覆盖的 32 步前的老样本
        uint16_t oldest_val = filter->history[ch][filter->head];

        // 2. 增量更新通道累加和：Sum = Sum + New_val - Old_val
        filter->sum[ch] = filter->sum[ch] + p_raw_in[ch] - oldest_val;

        // 3. 将最新数据写入历史队列
        filter->history[ch][filter->head] = p_raw_in[ch];

        // 4. 右移快速求得均值，并回填至输出缓冲区
        p_filtered_out[ch] = (uint16_t)(filter->sum[ch] >> MOV_AVG_WINDOW_POW);
    }

    // 5. 游标更新
    filter->head = next_head;
}

/**
  * @brief  初始化一阶滞后滤波器
  */
void Recursive_Filter_Init(RecursiveFilter_t* filter, uint16_t shift_factor)
{
    memset(filter->last_output_q16, 0, sizeof(filter->last_output_q16));
    filter->shift_factor = shift_factor;
}

/**
  * @brief  多通道一阶滞后滤波 (定点Q16格式，解决移位死区静差)
  */
void Recursive_Filter_Update(RecursiveFilter_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out)
{
    for (uint32_t ch = 0; ch < FILTER_CHANNELS; ch++)
    {
        // 1. 将新输入无损提升到 Q16 域
        uint32_t current_val_q16 = ((uint32_t)p_raw_in[ch]) << 16;
        
        // 2. 计算偏差：Diff = Input - Last_Output
        int32_t diff = (int32_t)current_val_q16 - (int32_t)filter->last_output_q16[ch];
        
        // 3. 更新迭代值：Output = Output + Diff / 2^P
        filter->last_output_q16[ch] += (diff >> filter->shift_factor);
        
        // 4. 转换回 16-bit 整数输出
        p_filtered_out[ch] = (uint16_t)(filter->last_output_q16[ch] >> 16);
    }
}

/**
  * @brief  初始化一维卡尔曼滤波器
  */
void Kalman_Filter_Init(KalmanFilter1D_t* filter, float Q, float R, float initial_val)
{
    filter->Q = Q;
    filter->R = R;
    for (uint32_t ch = 0; ch < FILTER_CHANNELS; ch++)
    {
        filter->x_est[ch] = initial_val;
        filter->P_est[ch] = 1.0f; // 初始协方差
    }
}

/**
  * @brief  多通道一维卡尔曼滤波器更新更新
  */
void Kalman_Filter_Update(KalmanFilter1D_t* filter, const uint16_t* p_raw_in, uint16_t* p_filtered_out)
{
    for (uint32_t ch = 0; ch < FILTER_CHANNELS; ch++)
    {
        // 1. 状态预测（假设上一时刻状态就是这一时刻的状态）
        float x_temp = filter->x_est[ch];
        
        // 2. 协方差预测
        float P_temp = filter->P_est[ch] + filter->Q;

        // 3. 计算卡尔曼增益
        float K = P_temp / (P_temp + filter->R);

        // 4. 结合测量值修正状态估计
        float measurement = (float)p_raw_in[ch];
        filter->x_est[ch] = x_temp + K * (measurement - x_temp);

        // 5. 更新估计协方差
        filter->P_est[ch] = (1.0f - K) * P_temp;

        // 6. 将估计状态转换为 16 位整数返回
        p_filtered_out[ch] = (uint16_t)filter->x_est[ch];
    }
}
```

通过这一章的软硬件抗噪方法，我们将 ADC 物理输入的信号精度提升到了高可靠性工业标准。在下一部分中，我们将转入 **DMA 高速数据搬运**部分，探讨如何在不消耗 CPU 的情况下，安全无锁地将这些高频多通道数据导入系统内存。
