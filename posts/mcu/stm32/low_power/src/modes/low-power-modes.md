# 第一章：Sleep、Stop、Standby 与 Shutdown 模式比较

在 STM32 嵌入式系统的低功耗设计中，最核心的一环是掌握其**内部电源拓扑架构**以及**各低功耗模式在物理层面的供电截断差异**。低功耗优化不仅是简单地调用固件库 API，更需要在寄存器级别和芯片级电压管理上实现精准控制。

---

## 1. STM32 电源架构与电源域划分

为了实现微安（$\mu\text{A}$）甚至纳安（$\text{nA}$）级别的极致静态电流消耗，STM32 内部并未采用单一的通用供电轨道，而是划分了多个相互独立的物理电源域，并由不同的轨电压调节器（Regulators）及电源开关（Power Switches）管理。

以下是 STM32 典型芯片的电源域划分及内部流向示意图：

```
+-----------------------------------------------------------------------------+
|                             外部供电输入                                    |
|   VDD (1.71V - 3.6V)      VDDA (1.62V - 3.6V)      VBAT (1.55V - 3.6V)      |
+---------+-----------------------+------------------------+------------------+
          |                       |                        |
          v                       v                        v
+-------------------------+ +--------------------+ +------------------------+
| VDD 电源域              | | VDDA 电源域        | | VBACKUP 备份域         |
| - I/O 引脚环 (I/O Ring) | | - 模拟外设 (ADC)   | | - 实时时钟 (RTC)       |
| - 上电复位 (POR/PDR)    | | - 数模转换 (DAC)   | | - LSE 32.768kHz 振荡器 |
| - 欠压复位 (BOR/PVD)    | | - 比较器 (COMP)    | | - 备份寄存器 (Backup)  |
| - 内部稳压器 (LDO/SMPS) | | - 运放 (OPAMP)     | | - 入侵检测 (Tamper)    |
+---------+---------------+ +--------------------+ +-----------+------------+
          |                                                    ^
          |=====[ 内部 LDO / SMPS 降压稳压器 ]====+             |
          |                                       |            | (电源切换开关)
          |                                       v            |
          |                               +---------------+    |
          |                               | VCORE 电源域   |----+
          |                               | - Cortex-M    |
          |                               | - SRAM 1/2/3  |
          |                               | - Flash 闪存   |
          |                               | - APB/AHB 外设|
          |                               +---------------+
          v
   +--------------+
   |  低功耗稳压器| ===> (在 Stop 1/2 模式下接管 VCORE，降低电压并限制电流)
   |  (LPR / SMPS)|
   +--------------+
```

### 1.1 VDD 电源域
$V_{\text{DD}}$ 是主数字 IO 供电域，电压范围通常为 $1.71\text{V} \sim 3.6\text{V}$。它直接供给：
* **芯片 I/O 引脚环（I/O Ring）**：所有数字输入输出引脚的物理驱动电平。
* **复位与电压监控模块**：上电复位（POR，Power-On Reset）、掉电复位（PDR，Power-Down Reset）、欠压检测（BOR，Brown-Out Reset）以及可编程电压监测器（PVD，Programmable Voltage Detector）。这些安全监控电路在多数休眠模式下依然带电工作，以保障系统安全。
* **内部核心电压调节器**：输入级直接连接 $V_{\text{DD}}$。

### 1.2 VDDA 电源域
$V_{\text{DDA}}$ 专为模拟模块供电（电压范围 $1.62\text{V} \sim 3.6\text{V}$），目的是将高频数字翻转噪声与高精度模拟采样隔离。
* **供电目标**：包括模数转换器（ADC）、数模转换器（DAC）、电压比较器（COMP）、运算放大器（OPAMP）及内部高精度电压基准源（VREFBUF）。
* **功耗陷阱**：在硬件设计上，通常在 $V_{\text{DD}}$ 和 $V_{\text{DDA}}$ 之间串联磁珠与电容进行 LC 滤波。即使在 MCU 休眠时，若软件未关闭这些模拟外设，模拟供电路径仍会产生数十至数百微安的静态电流。

### 1.3 VCORE 电源域
$V_{\text{CORE}}$ 供电域是微控制器的运算与数据存储核心，其电压不直接来自外部，而是由 $V_{\text{DD}}$ 域的内部稳压器进行降压后供给（典型值在 $0.9\text{V} \sim 1.2\text{V}$ 之间）。
* **供电目标**：ARM Cortex-M 内核、SRAM、内嵌 Flash 闪存、DMA、以及挂载在 AHB/APB 总线上的数字外设（如 SPI、USART、Timer 等）。
* **低功耗控制**：在运行模式下，其电压可通过软件动态缩放；在深度休眠模式下（如 Stop 2），时钟完全门控，稳压器降压维持极低电流；在 Standby 模式下，整个 $V_{\text{CORE}}$ 域完全断电，所有外设数据与寄存器状态丢失。

### 1.4 VBACKUP 备份域
当外部主电源 $V_{\text{DD}}$ 掉电时，片内的电源切换开关（Power Switch）会瞬间将备份域的供电切至外部 $V_{\text{BAT}}$ 引脚。
* **供电目标**：包含实时时钟（RTC）、外部 $32.768\,\text{kHz}$ 低速晶振驱动电路（LSE）、以及几十个字节的备份寄存器（Backup Registers）。
* **低功耗特征**：该域采用深亚微米超低功耗工艺制造，其静态电流在数百纳安（$\text{nA}$）级别，专为离线时钟维持与篡改检测（Tamper Detection）设计。

---

## 2. 内核电压调节器：LDO 与 SMPS 的原理与效率

微控制器 $V_{\text{CORE}}$ 域的稳压器存在两种主流物理拓扑：**低压差线性稳压器（LDO）** 与 **高效率开关稳压器（SMPS，降压 Buck 转换器）**。

### 2.1 LDO 与 SMPS 工作原理与能效对比

#### 1. LDO (Low-Dropout Regulator)
LDO 的核心工作原理是依靠工作在放大区的晶体管（通常为 PMOS）进行串联分压。
* **效率计算**：LDO 的效率 $\eta_{\text{LDO}}$ 近似为输出电压与输入电压的比值：
  $$\eta_{\text{LDO}} \approx \frac{V_{\text{CORE}}}{V_{\text{DD}}} \times 100\%$$
  若 $V_{\text{DD}} = 3.3\text{V}$，运行模式下内核电压 $V_{\text{CORE}} = 1.0\text{V}$，则 LDO 转换效率仅为：
  $$\eta_{\text{LDO}} \approx \frac{1.0}{3.3} \approx 30.3\%$$
  这意味着高达 **$70\%$ 的能量在降压过程中以热量的形式损耗在片内**，消耗了大量电池电流。

#### 2. SMPS (Switched-Mode Power Supply)
SMPS 是一个脉宽调制（PWM）控制的降压 Buck 拓扑，需要外接一颗片外功率电感（如 $2.2\,\mu\text{H}$）和滤波电容。
* **效率特征**：利用电感的磁场储能与电容的电场换能，其效率 $\eta_{\text{SMPS}}$ 在合适负载下可高达 **$85\% \sim 90\%$**。
* **节电效应**：在系统处于高主频运行模式（Run Mode）下，开启 SMPS 代替 LDO 能够直接降低主供电输入端（$V_{\text{DD}}$）约 **$50\% \sim 60\%$** 的输入电流。例如，若内核需要 $10\text{mA}$ 的工作电流，使用 LDO 时主电源输入端同样需要约 $10\text{mA}$；而使用 SMPS 时，因为转换效率高，主电源输入端仅需约 $3.6\text{mA}$ 的电流。

### 2.2 稳压器工作状态与电压等级切换

为了在不同运行速率下匹配 CMOS 电路的时序裕量并压榨功耗，STM32 引入了**动态电压缩放（VOS, Dynamic Voltage Scaling）**机制。

```
           [ 运行模式 (Run Mode) ] 
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
    [ 主稳压器 MR ]         [ 开关稳压器 SMPS ]
    (LDO 线性降压)          (高效率 Buck 降压)
   ┌─────┴──────────┐      ┌─────┴──────────┐
   │ Range 1 (1.2V) │      │ Range 1 (1.2V) │  <--- 高性能 (最高频率如 80/160MHz)
   ├────────────────┤      ├────────────────┤
   │ Range 2 (1.0V) │      │ Range 2 (1.0V) │  <--- 低功耗 (限制频率如 26MHz)
   └─────┬──────────┘      └─────┬──────────┘
         │                       │
         └───────────┬───────────┘
                     │ (系统执行 WFI 且 SLEEPDEEP=1)
                     ▼
        [ 低功耗模式 (Stop Mode) ]
                     │
         ┌───────────┼───────────┐
         │ (LPMS=00) │ (LPMS=01) │ (LPMS=10)
         ▼           ▼           ▼
     [ Stop 0 ]  [ Stop 1 ]  [ Stop 2 ]
      (MR 保持)  (LPR 降压)  (LPR 极低偏置模式, VCORE 再次降压)
                             (部分 SRAM 掉电以控制漏电)
```

在运行模式下：
* **Range 1 (High Performance)**：$V_{\text{CORE}}$ 供给最高电压（通常为 $1.2\text{V}$ 左右），支持 MCU 运行在极限时钟频率（如 $80\text{MHz}$ 或 $120\text{MHz}$）。此时的动态功耗最大。
* **Range 2 (Low Power)**：$V_{\text{CORE}}$ 降低（通常为 $1.0\text{V}$），此时由于 CMOS 动态功耗公式：
  $$P_{\text{dynamic}} = C \cdot V^2 \cdot f$$
  电压从 $1.2\text{V}$ 降至 $1.0\text{V}$，功耗与电压的平方成正比，在相同频率下，电压下降能产生 **$\approx 30.5\%$ 的功耗降幅**。但此模式下系统的主频上限会被迫降低（通常限制在 $26\text{MHz}$ 以下）。
* **Range 3 / Low-power Run**：在更低的主频下，可以使用低功耗稳压器（LPR）代替主稳压器（MR），电压降至 $0.9\text{V}$ 以下，限制时钟在 $2\text{MHz}$ 以下。此时，Flash 的读取通常需要增加等待周期，或者直接将代码移至 SRAM 中运行，以切断 Flash 内部的电荷泵功耗。

---

## 3. STM32 低功耗模式深度对比

STM32 提供了阶梯式的低功耗模式。在模式深化的过程中，**静态功耗指数级下降，但唤醒时间与上下文（RAM/寄存器）丢失率则显著增加**。

### 3.1 运行模式功耗优化 (Run / LPRun)
* **Run 模式**：CPU 与外设均可全速工作。优化手段主要为**时钟分频**与**时钟门控（Clock Gating）**，即通过 RCC 寄存器关闭所有未使用外设的输入时钟。
* **Low-Power Run (LPRun)**：内核供电切换至低功耗稳压器（LPR），$V_{\text{CORE}}$ 降至极限。CPU 主频通常限制在 $2\text{MHz}$ 以下（通常由内部 MSI 振荡器供给），关闭 Flash 并将关键 ISR 和循环代码移至 SRAM 中运行，整机运行电流可降至数十微安。

### 3.2 睡眠模式 (Sleep Mode)
* **机制**：通过设置内核 `SCB->SCR` 的 `SLEEPDEEP = 0` 并执行 `WFI`。仅 CPU 内核时钟被关闭，所有的中断向量、NVIC、外设（SPI、USART 等，如果其外设时钟未关闭）均处于正常工作状态。
* **电流消耗**：在 $1\text{mA} \sim 3\text{mA}$ 级。
* **唤醒时间**：仅需 $1 \sim 3$ 个时钟周期，属于无感唤醒。

### 3.3 停止模式 (Stop 0 / Stop 1 / Stop 2)
在 Stop 模式下，$V_{\text{CORE}}$ 域中的所有高速振荡器（HSE、HSI、PLL）和分频时钟全部停振，但 SRAM 内的数据及外设的寄存器状态得到完整保持。
* **Stop 0**：主稳压器（MR）依然保持满偏置电流运行。唤醒速度极快（$\approx 3\mu\text{s} \sim 5\mu\text{s}$），但由于稳压器本身的静态偏置电流较大，整机电流约 $100\mu\text{A} \sim 250\mu\text{A}$。
* **Stop 1**：主稳压器关闭，切换至低功耗稳压器（LPR）。唤醒时间略有增加（$\approx 6\mu\text{s} \sim 10\mu\text{s}$），底电流大幅下降至 $10\mu\text{A} \sim 25\mu\text{A}$。
* **Stop 2（超低功耗停止）**：在 LPR 的基础上，VCORE 域被进一步进行极低偏置电流缩减。大多数外设彻底断电。为了抑制超深亚微米下 SRAM 产生的隧道漏电流，部分主控支持**内存分区断电**（如保留 SRAM2 以维持唤醒现场，关闭 SRAM1/3 的供电）。此时底电流被压低至极限的 **$1.0\mu\text{A} \sim 2.0\mu\text{A}$**。唤醒时间（从 MSI 起振并稳定）约为 $5\mu\text{s} \sim 15\mu\text{s}$。

### 3.4 待机模式 (Standby Mode)
* **机制**：整个 $V_{\text{CORE}}$ 域被完全断电，所有内核寄存器、外设配置以及大部分 SRAM（除可配置保留的 SRAM2 外）中的数据全部丢失。仅剩下备份域（RTC、LSE）以及极少数的待机电路（IWDG、WKUP 引脚检测器）继续带电。
* **电流消耗**：通常在 **$300\text{nA} \sim 700\text{nA}$** 级别。
* **唤醒特征**：唤醒源仅限 WKUP 引脚边沿、RTC 定时器、独立看门狗复位或 NRST 外部硬件复位。**系统被唤醒后，其行为等同于重新冷启动（Power-On Reset）**，程序会从复位向量处重新开始执行 `main` 函数，因此需要在进入待机前将必要的数据写入备份寄存器或 Flash 中。

### 3.5 关断模式 (Shutdown Mode)
* **机制**：片内 LDO/SMPS 稳压器被彻底切断，$V_{\text{CORE}}$ 电压彻底归零。芯片内部的低电压检测器（LVD）、欠压监测等模拟安全保护电路也全部关闭，仅剩下最基础的唤醒引脚输入缓冲器及外部 RTC。
* **电流消耗**：极致的静态电流 **$10\text{nA} \sim 50\text{nA}$**。
* **唤醒特征**：唤醒时间最长（$\approx 50\mu\text{s} \sim 250\mu\text{s}$，因为需要完整的上电初始化），唤醒后同样等同于重新冷启动。

---

## 4. 低功耗模式性能与功耗对比表（以 STM32L476 为例）

测试条件：$V_{\text{DD}} = 3.0\text{V}$，无外部 SMPS 接入（即使用内部 LDO），温度 $25^\circ\text{C}$：

| 模式 | 稳压器状态 | SRAM 保持情况 | 主时钟源状态 | 典型电流消耗 | 唤醒源 | 唤醒时间 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Run (80MHz)** | MR (Range 1) | 全部保持 | HSE/PLL 正常工作 | $\approx 8.5\,\text{mA}$ | N/A | 0 |
| **LPRun (2MHz)** | LPR (Range 2) | 全部保持 | MSI 运行，高速振荡器关闭 | $\approx 280\,\mu\text{A}$ | N/A | 0 |
| **Sleep** | MR | 全部保持 | CPU 停止，外设时钟工作 | $\approx 1.5\,\text{mA}$ (24MHz) | 任意中断 / 事件 | $6$ 个 HCLK 周期 |
| **Stop 0** | MR | 全部保持 | 所有高速时钟关闭 | $\approx 110\,\mu\text{A}$ | EXTI, RTC, I2C, UART | $\approx 4.2\,\mu\text{s}$ |
| **Stop 1** | LPR | 全部保持 | 所有高速时钟关闭 | $\approx 12\,\mu\text{A}$ | EXTI, RTC, I2C, UART | $\approx 8\,\mu\text{s}$ |
| **Stop 2** | LPR (极低偏置) | 仅保留 SRAM2 和 RTC 备份 | 所有高速时钟关闭 | **$\approx 1.1\,\mu\text{A}$** | EXTI, RTC, LPTIM, I2C | $\approx 5\mu\text{s} \sim 8\mu\text{s}$ (从 MSI 唤醒) |
| **Standby** | OFF | 全部丢失 (可配置保留 SRAM2) | 全部关闭 (除 LSE/LSI) | **$\approx 350\,\text{nA}$** | WKUP 引脚, RTC, IWDG | $\approx 14\,\mu\text{s}$ (冷启动流程) |
| **Shutdown** | OFF | 全部丢失 | 全部关闭 (除 LSE) | **$\approx 30\,\text{nA}$** | WKUP 引脚, RTC | $\approx 50\,\mu\text{s}$ (冷启动流程) |

---

## 5. 低功耗切换寄存器级控制原理

要使 ARM Cortex-M 内核正确进入休眠，必须协调配置 **ARM 内核系统控制寄存器（SCR）** 与 **STM32 的电源控制寄存器（PWR_CRx）**。

### 5.1 Cortex-M 内核系统控制寄存器 (SCB->SCR)
在内核层面，控制低功耗的核心寄存器位于系统控制块（SCB），其寄存器为 `SCR`（System Control Register，基地址 `0xE000ED10`）：

```
   Bit 31                                               Bit 4      Bit 2   Bit 1
  +---------------------------------------------------+----------+-------+-------+
  |                   Reserved                        |SEVONPEND |SLEEP  |SLEEPON|
  |                                                   |          |DEEP   |EXIT   |
  +---------------------------------------------------+----------+-------+-------+
```

* **Bit 1: `SLEEPONEXIT` (退出时休眠)**
  * **作用**：若此位置 1，当 CPU 执行完最后一个中断服务程序（ISR）并返回时，不会回到主循环代码，而是**直接重新进入休眠**。
  * **场景**：极高效率的中断驱动系统（Interrupt-driven System），主程序在初始化后不执行任何死循环，全部业务在中断中完成。
* **Bit 2: `SLEEPDEEP` (深睡眠使能位)**
  * **作用**：若此位置 1，当 CPU 执行 `WFI` 或 `WFE` 指令时，内核被标记为进入**深睡眠（Deep Sleep）**，这会拉低内核的休眠控制线，通知片上电源管理模块（PWR）关断主稳压器，进而触发 Stop/Standby/Shutdown。若置 0，则仅触发浅睡眠（Sleep）。
* **Bit 4: `SEVONPEND` (挂起事件唤醒位)**
  * **作用**：若此位置 1，即使在内核屏蔽了中断（如通过配置 `PRIMASK`）的情况下，外部中断线产生的**挂起（Pending）标志**依然会作为事件，将执行了 `WFE` 的内核强制唤醒。

### 5.2 STM32 电源控制寄存器 1 (PWR->CR1)
STM32 内部的 `PWR->CR1` 寄存器定义了具体的低功耗模式档位：
* **LPMS[2:0] (Low-Power Mode Selection)**：
  * `000`: Stop 0 mode
  * `001`: Stop 1 mode
  * `010`: Stop 2 mode
  * `011`: Standby mode
  * `100`: Shutdown mode

---

## 6. 寄存器级与 LL 库代码实现

以下为基于 STM32 LL（Low-Layer）库编写的、用于执行“将内核电压缩放降低至 Range 2 以安全降频，并配置使能片内 Flash 掉电以进入 Stop 2 模式”的生产级 C 代码：

```c
#include "stm32l4xx_ll_pwr.h"
#include "stm32l4xx_ll_system.h"
#include "stm32l4xx_ll_utils.h"

/**
  * @brief  安全地将 VCORE 域电压调整为 Range 2 (低功耗模式)
  * @note   在此模式下，系统时钟 (SYSCLK) 不得超过 26 MHz
  * @param  None
  * @retval None
  */
void System_Voltage_Scaling_To_Range2(void)
{
    /* 1. 检测当前是否已处于 Range 2。若是，则无需重复配置 */
    if (LL_PWR_GetRegulVoltageScaling() != LL_PWR_REGU_VOLTAGE_SCALE2)
    {
        /* 2. 写入 PWR_CR1 寄存器的 VOS 字段，设置为 Scale 2 */
        LL_PWR_SetRegulVoltageScaling(LL_PWR_REGU_VOLTAGE_SCALE2);
        
        /* 3. 阻塞等待，直到 VOSF (Voltage Scaling Flag) 电压稳定标志位清零 */
        /* 这表示内部稳压器已经成功将内核供电平稳地降低到新的目标电压 */
        while (LL_PWR_IsActiveFlag_VOSF() != 0)
        {
            /* 芯片硬件自动调压中 */
        }
    }
}

/**
  * @brief  将内核配置为 Stop 2 模式，并执行休眠挂起
  * @param  None
  * @retval None
  */
void Enter_Stop2_Mode(void)
{
    /* 1. 强制清除电源控制寄存器中的所有唤醒标志位 (Wakeup Flags) */
    /* 否则如果有之前遗留的未处理唤醒事件，WFI 指令将瞬间返回，无法进入休眠 */
    LL_PWR_ClearFlag_WU();

    /* 2. 配置 STM32 的具体低功耗档位为 Stop 2 模式 */
    /* 寄存器级映射：PWR->CR1 寄存器的 LPMS[2:0] = 010 */
    LL_PWR_SetPowerMode(LL_PWR_MODE_STOP2);

    /* 3. 设置 Cortex-M 内核的系统控制寄存器 (SCR) 的 SLEEPDEEP 位 */
    /* 寄存器级映射：SCB->SCR 的 SLEEPDEEP 位置 1 */
    SCB->SCR |= SCB_SCR_SLEEPDEEP_Msk;

    /* 4. （可选但推荐的优化措施）使能 Flash 闪存的低功耗关断 */
    /* 在进入 Stop 2 模式期间，将 Flash 的供电和内部电荷泵完全关断。 */
    /* 虽然唤醒时会增加约 3us ~ 5us 的 Flash 唤醒延迟，但可节省 15uA ~ 20uA 的底电流 */
    LL_PWR_EnableFlashPowerDownInStop();

    /* 5. 插入屏障指令，保证所有配置完全写入总线 */
    __DSB(); /* 数据同步屏障，确保在休眠前所有数据内存操作完成 */
    __ISB(); /* 指令同步屏障，清空流水线，确保后续执行最新的休眠配置 */

    /* 6. 执行汇编 WFI 指令，进入低功耗状态 */
    __WFI();

    /* ================================================================= */
    /* ---------------------- MCU 被外部中断唤醒后从此处恢复 ---------------------- */
    /* ================================================================= */
    
    /* 7. 唤醒后立即清除 SLEEPDEEP 位，避免后续程序运行中出现意外的内核自动挂起 */
    SCB->SCR &= ~SCB_SCR_SLEEPDEEP_Msk;
    
    /* 8. 重新禁用 Flash Power Down，使 Flash 退出极低功耗状态，以便外设可立即读取数据 */
    LL_PWR_DisableFlashPowerDownInStop();
}
```

> [!WARNING]
> 在从 Stop 2 模式唤醒后，**原本使能的锁相环（PLL）以及外部高速晶振（HSE）会被硬件自动关闭，MCU 的系统时钟源会被迫降级恢复为内部高速振荡器（默认为 MSI 4MHz 或 HSI 16MHz）**。因此，系统被唤醒后的第一步工作，必须是立即调用时钟树重建函数，将时钟切换回高性能主频，否则整个系统将处于极其缓慢的降频运行状态。具体时钟恢复机制详见第二章。
