# 第二章：内部 RTC 与外部中断低功耗唤醒源机制

在完成了低功耗模式的选择（第一章）以及对 GPIO 漏电流的治理（第三章）之后，设计低功耗系统的核心任务就变成了**“如何高效地唤醒系统”**。如果系统无法稳定地被唤醒，或者唤醒机制配置错误导致系统频繁误唤醒，低功耗系统将形同虚设。

---

## 1. WFI 与 WFE 的底层唤醒流向深度对比

在 ARM Cortex-M 处理器内核中，挂起 CPU 的汇编指令有两个：`WFI`（Wait For Interrupt）和 `WFE`（Wait For Event）。它们在唤醒后的执行路径、系统开销以及中断屏蔽响应上有着本质区别。

以下是 WFI 与 WFE 执行及唤醒流程对比图：

```
           +------------------+
           | MCU 处于休眠状态 |
           +--------+---------+
                    |
              [ 产生中断信号 ]
                    |
                    v
           +--------+---------+
           | NVIC 接收并判定优先级|
           +--------+---------+
                    |
                    v
         ┌──────────┴──────────┐
         │ 是由 WFI 还是 WFE 进入?│
         └────┬────────────┬───┘
              │            │
         [由 WFI 进入]   [由 WFE 进入]
              │            │
              v            v
      +-------+-----+  +---+--------------------+
      | 唤醒 CPU 内核|  | 唤醒 CPU 内核          |
      +-------+-----+  +---+--------------------+
              |            |
              v            v
     +--------+--------+  | (跳过中断矢量表与ISR)
     | 从中断矢量表获取  |  | 直接在 WFE 指令的
     | 中断向量并执行ISR  |  | 下一行继续执行
     +--------+--------+  |
              |            |
              v            |
     +--------+--------+  |
     | 执行完成并返回   |  |
     | 至 WFI 的下一行  |  |
     +--------+--------+  |
              |            |
              v            v
           +──+────────────+──+
           | 系统恢复正常代码执行 |
           +------------------+
```

### 1.1 WFI (Wait For Interrupt) 详解
* **指令作用**：`WFI` 会强制 CPU 立即挂起当前的指令流水线，暂停内核时钟，进入等待中断状态。
* **唤醒条件**：必须是在 NVIC（Nested Vectored Interrupt Controller）中已经使能的、且未被内核屏蔽的中断事件。
* **唤醒路径**：
  1. 外部信号触发中断，NVIC 接收该中断，判定优先级。
  2. 唤醒内核时钟。
  3. 内核首先保存当前 CPU 寄存器现场（硬件自动入栈，保存 R0-R3、R12、LR、PC、xPSR）。
  4. **强行跳转至对应的中断服务函数（ISR）** 中执行具体的业务逻辑。
  5. 执行完中断服务函数后，出栈恢复现场，最终返回至 `WFI` 汇编指令的下一行代码继续执行。
* **物理开销**：由于涉及硬件自动压栈、跳转 ISR、出栈恢复的流程，唤醒总耗时通常需要额外增加约 $12 \sim 25$ 个 CPU 时钟周期。

### 1.2 WFE (Wait For Event) 详解
* **指令作用**：`WFE` 会使 CPU 进入等待事件状态。其内部关联着一个单比特的**“事件寄存器（Event Register）”**。
* **事件寄存器机制**：
  - 当执行 `WFE` 指令时，如果该事件寄存器为 `1`，则 CPU **不会进入休眠**，而是直接将该寄存器清 `0`，并继续向下执行代码。
  - 如果该事件寄存器为 `0`，CPU 才会真正暂停时钟并挂起。
* **唤醒条件**：任何外设挂起的中断（即使在 NVIC 中并未使能该中断）、或者是其他处理器核心执行的 `SEV`（Send Event）指令。
* **唤醒路径**：一旦外部信号触发事件，CPU 被唤醒，它**不会跳转执行任何 ISR（中断矢量表获取被跳过）**，而是直接清除事件寄存器，并从 `WFE` 指令的下一行继续执行。
* **物理开销**：因为跳过了中断压栈、出栈以及矢量跳转过程，唤醒恢复的时间被压缩到极致，非常适合要求超快瞬态响应（例如高速 DMA 缓存搬运完成后的内核极速拉起）的应用场景。

---

## 2. 外部中断唤醒与硬件防抖电路设计 (EXTI)

使用 GPIO 作为外部中断（EXTI）源唤醒 MCU 是大多数低功耗方案（如机械按键、门磁传感器、加速度计中断引脚）的基本配置。然而，在低功耗状态下，**软件延时防抖算法是无法执行的**，因此硬件层面的防抖滤波至关重要。

### 2.1 频繁误唤醒的危害与软件防抖的失效
机械弹性开关在闭合或断开时，会产生长达 $5\text{ms} \sim 10\text{ms}$ 的高频接触抖动。
* **若无硬件防抖**：第一个边沿脉冲会瞬间将 MCU 从 Stop 模式唤醒。MCU 醒来后尝试进入软件防抖延时，但由于此时后续的抖动仍在持续，系统会频繁进入中断，甚至在刚重新休眠的瞬间再次被抖动沿拉醒。这种高频的“休眠-唤醒”剧烈振荡，会导致系统底电流从 $1\mu\text{A}$ 飙升至 $mA$ 级，电池电能迅速耗尽。

### 2.2 推荐的低功耗硬件 RC 滤波防抖设计

```
                   VDD (3.3V)
                    │
                   [R1: 10kΩ] (上拉电阻)
                    │
   [按键或传感器] ───┴────[R2: 1kΩ]────┬──── EXTI GPIO Pin (MCU)
                                      │
                                    [C1: 100nF] (低通电容)
                                      │
                                     GND
```

* **滤波机制**：
  - **上拉电阻 $R_1$**：在按键未按下时，将输入端稳定维持在 $V_{\text{DD}}$。
  - **低通滤波器 $R_2$ 与 $C_1$**：构成了一级 RC 低通滤波器。其截止频率 $f_c$ 计算公式为：
    $$f_c = \frac{1}{2\pi \cdot R_2 \cdot C_1} = \frac{1}{2\pi \cdot 1\text{k}\Omega \cdot 100\text{nF}} \approx 1.59\,\text{kHz}$$
    时间常数 $\tau = R_2 \cdot C_1 = 100\,\mu\text{s}$。
  - 当按键闭合发生抖动时，高频的抖动电平波动会被 $C_1$ 滤波电容吸收，使得 MCU 的 GPIO 引脚上只呈现出一个干净平滑的下降边沿，**确保 MCU 仅被唤醒一次**。

---

## 3. 定时唤醒源配置：RTC 与 LPTIM

当物联网设备需要每隔固定的时间间隔（如 10 分钟）主动醒来采集传感器数据或上报网络时，必须依靠低功耗硬件定时器。

### 3.1 实时时钟 (RTC) 周期性唤醒配置
STM32 内部 RTC 最优配置为使用片外 **LSE（32.768kHz 外部低速晶振）**。LSE 具有极高的 ppm 精度和温度稳定性，且在 Stop 2 模式下依然可以保持起振工作。

RTC 的定时唤醒核心是**唤醒定时器（WUT，Wakeup Timer）**。它是一个 16 位的自减计数器。其定时唤醒周期的计算公式如下：
* **时钟源选择**：通常配置为 `RTCCLK` 的 16 分频。此时唤醒定时器输入时钟频率为：
  $$f_{\text{WUT\_CLK}} = \frac{f_{\text{LSE}}}{16} = \frac{32768\,\text{Hz}}{16} = 2048\,\text{Hz}$$
* **周期计算公式**：
  $$T_{\text{wakeup}} = \frac{\text{WUT\_TR} + 1}{f_{\text{WUT\_CLK}}} = \frac{\text{WUT\_TR} + 1}{2048}$$
  若我们需要设定唤醒周期为固定的 $5$ 秒，则重装载寄存器的值 $\text{WUT\_TR}$ 应配置为：
  $$\text{WUT\_TR} = (5 \times 2048) - 1 = 10239$$

当计数器递减至 0 时，RTC 模块会将状态标志位置位，同时通过内建的 **EXTI Line 20** 产生一个中断信号送往 NVIC，将内核从深度休眠中拉醒。

### 3.2 低功耗定时器 (LPTIM)
与普通定时器不同，LPTIM（Low Power Timer）在 CPU 进入 Stop 模式、主时钟域停振后，仍可利用 LSE 或 LSI 维持工作。
* **无内核计数模式**：LPTIM 支持在内核完全挂起的状态下，自动对外部 GPIO 传入的脉冲进行计数。当计数值达到设定的比较值时产生唤醒信号。适用于在休眠状态下测量流量计脉冲等低能耗场景。

---

## 4. 低功耗下的看门狗 (IWDG) 共存策略

独立看门狗（IWDG）的时钟直接来源于片内的 **LSI（低速内部 RC 振荡器）**。这意味着即使在 Stop 甚至 Standby 模式下，LSI 仍在振荡，看门狗计数器依然在递减。如果休眠周期（如 30 秒）长于看门狗复位周期（通常最大约 $4\text{s} \sim 8\text{s}$），MCU 就会在休眠期间被看门狗复位。

### 4.1 硬件冻结机制（推荐方案）
STM32 硬件支持在低功耗模式下**自动暂停**看门狗计数器。该功能通常配置在**选项字节（Option Bytes）**或 `DBGMCU->APB1FZR1` 寄存器中：
* **关键控制位**：`IWDG_STOP`（有些芯片为 `WDG_SW` 或在选项字节中的 `IWDG_STOP` 位）。
* **工作效果**：
  * 当 CPU 处于 Run 模式时，看门狗正常工作，必须按时喂狗。
  * 当内核执行 `WFI` 进入 Stop 模式后，硬件逻辑会自动侦测到休眠信号，**暂停看门狗的时钟供给（LSI 门控关闭或计数器冻结）**。
  * 当系统被外部 EXTI 或 RTC 中断唤醒后，看门狗计数器立刻无缝恢复工作。
  * 该方案具有最高的安全性，不消耗任何额外的软件开销。

### 4.2 周期性唤醒喂狗方案（备用方案）
如果选用的芯片不支持休眠期看门狗冻结，则必须将 RTC 唤醒周期配置为小于看门狗超时时间。例如，若看门狗在 4 秒内复位，则将 RTC 周期唤醒设为 3 秒。
* **固件逻辑**：
  ```
  唤醒 ──> 喂狗 (IWDG->KR = 0xAAAA) ──> 再次调用 WFI 进入休眠
  ```
  每次唤醒仅耗时十几微秒，虽然略微拉高了平均功耗，但保障了看门狗不溢出复位。

---

## 5. 生产级低功耗控制与时钟重建固件实现

以下是配合第一章及第三章封装的、包含“GPIO 关断隔离 $\rightarrow$ RTC 定时器配置 $\rightarrow$ 深度休眠 $\rightarrow$ 唤醒后系统主时钟重建”的量产级 C 代码：

```c
#include "stm32l4xx_ll_rcc.h"
#include "stm32l4xx_ll_pwr.h"
#include "stm32l4xx_ll_rtc.h"
#include "stm32l4xx_ll_gpio.h"
#include "stm32l4xx_ll_exti.h"
#include "stm32l4xx_ll_bus.h"

/* 外部函数声明，定义于第三章 */
extern void GPIO_Prepare_For_LowPower(void);
extern void GPIO_Restore_After_Wakeup(void);

/**
  * @brief  系统主时钟树重建 (当 MCU 从 Stop 唤醒后，重新使能 HSE/PLL 并切换为主频)
  * @note   唤醒后默认时钟源为 MSI (通常仅为 4MHz)
  * @param  None
  * @retval None
  */
void SystemClock_Reconfig_After_Wakeup(void)
{
    /* 1. 开启外部高速晶振 (HSE) */
    LL_RCC_HSE_Enable();
    while (LL_RCC_HSE_IsReady() != 1)
    {
        /* 等待外部晶振硬件电路稳定起振 */
    }

    /* 2. 重新使能锁相环 (PLL) */
    LL_RCC_PLL_Enable();
    while (LL_RCC_PLL_IsReady() != 1)
    {
        /* 等待锁相环（PLL）锁定，确保时钟相位对齐 */
    }

    /* 3. 将系统时钟源（SYSCLK）从唤醒默认的 MSI 切换回高性能 PLL */
    LL_RCC_SetSysClkSource(LL_RCC_SYS_CLKSOURCE_PLL);
    while (LL_RCC_GetSysClkSource() != LL_RCC_SYS_CLKSOURCE_STATUS_PLL)
    {
        /* 等待时钟总线切源成功 */
    }
}

/**
  * @brief  初始化配置 RTC 定时周期唤醒
  * @param  seconds 定时唤醒时间（秒）
  * @retval None
  */
void RTC_Wakeup_Init(uint32_t seconds)
{
    /* 1. 开启电源控制器的备份域访问权限 */
    LL_PWR_EnableBkUpAccess();
    
    /* 2. 解除 RTC 寄存器写保护 */
    LL_RTC_DisableWriteProtection(RTC);
    
    /* 3. 关闭 RTC 唤醒定时器以允许配置写入 */
    LL_RTC_WUT_Disable(RTC);
    while (LL_RTC_IsActiveFlag_WUTW(RTC) != 1)
    {
        /* 等待写允许标志置位（WUTW = 1） */
    }
    
    /* 4. 配置 WUT 时钟源为 RTCCLK (LSE = 32768Hz) 的 16 分频，分频后频率为 2048Hz */
    LL_RTC_WUT_SetClockSource(RTC, LL_RTC_WUT_TIMEBASE_16XTAL_DIV);
    
    /* 5. 写入重装载值：计算公式：(秒数 * 2048) - 1 */
    LL_RTC_WUT_SetAutoReload(RTC, (seconds * 2048) - 1);
    
    /* 6. 使能唤醒定时器中断，重新启用唤醒定时器 */
    LL_RTC_EnableIT_WUT(RTC);
    LL_RTC_WUT_Enable(RTC);
    
    /* 7. 开启 RTC 寄存器写保护，防止后续误写入 */
    LL_RTC_EnableWriteProtection(RTC);

    /* 8. 配置外部中断线 EXTI Line 20 (对应内部 RTC 唤醒事件) */
    LL_EXTI_EnableIT_0_31(LL_EXTI_LINE_20);
    LL_EXTI_EnableRisingTrig_0_31(LL_EXTI_LINE_20);
    
    /* 9. 在 NVIC 中使能 RTC 唤醒中断并配置最高中断优先级 */
    NVIC_SetPriority(RTC_WKUP_IRQn, 0);
    NVIC_EnableIRQ(RTC_WKUP_IRQn);
}

/**
  * @brief  RTC 周期唤醒中断服务程序 (ISR)
  */
void RTC_WKUP_IRQHandler(void)
{
    /* 检测是否由 WUT 定时器产生的中断 */
    if (LL_RTC_IsActiveFlag_WUT(RTC) != 0)
    {
        /* 必须手动清除 RTC 的唤醒标志位 */
        LL_RTC_ClearFlag_WUT(RTC);
        
        /* 必须手动清除 EXTI 中断线 20 的挂起状态 */
        LL_EXTI_ClearFlag_0_31(LL_EXTI_LINE_20);
    }
}

/**
  * @brief  主程序低功耗测试任务循环
  */
void LowPower_Main_Loop(void)
{
    /* 初始化 RTC 定时唤醒源为 5 秒 */
    RTC_Wakeup_Init(5);

    while (1)
    {
        /* ================= 步骤 1：主控工作阶段 ================= */
        // 执行业务逻辑，例如采集 I2C 传感器数据、进行数字滤波与闪存写入
        LL_mDelay(100); // 模拟工作时间 100ms

        /* ================= 步骤 2：进入休眠前准备 ================= */
        /* 1. 关闭不再使用的外设时钟，切断动态功耗 */
        LL_AHB1_GRP1_DisableClock(LL_AHB1_GRP1_PERIPH_DMA1);
        
        /* 2. 隔离 GPIO，强制将所有闲置引脚配置为模拟输入，防止倒灌与漏电 */
        GPIO_Prepare_For_LowPower();

        /* ================= 步骤 3：执行休眠挂起 ================= */
        /* 3. 清除所有可能的唤醒标志 */
        LL_PWR_ClearFlag_WU();
        
        /* 4. 配置 PWR 控制寄存器进入 Stop 2 模式 */
        LL_PWR_SetPowerMode(LL_PWR_MODE_STOP2);
        
        /* 5. 开启内核深休眠模式，即 SCB_SCR_SLEEPDEEP 位置 1 */
        SCB->SCR |= SCB_SCR_SLEEPDEEP_Msk;
        
        /* 6. 执行数据同步与指令屏障，确保在指令流水线挂起前，配置已完全写入寄存器 */
        __DSB();
        __ISB();
        
        /* 7. 执行汇编挂起指令，MCU 进入 Stop 2 深休眠（底电流降低至约 1.1uA） */
        __WFI(); 

        /* ================= 步骤 4：被唤醒后的系统重建 ================= */
        /* 8. 唤醒后系统时钟自动回退为 MSI。在此必须立即配置时钟树，恢复主 PLL 80MHz 工作 */
        SystemClock_Reconfig_After_Wakeup();
        
        /* 9. 恢复引脚的初始功能模式（包括 UART/SPI/I2C 功能配置） */
        GPIO_Restore_After_Wakeup();
        
        /* 10. 重新开启外设总线时钟并重新初始化相关模块 */
        LL_AHB1_GRP1_EnableClock(LL_AHB1_GRP1_PERIPH_DMA1);
        
        // 系统回到工作状态，进入下一次循环
    }
}
```

---

## 6. 调试低功耗模式时的技巧与陷阱

在低功耗系统的研发调试中，工程师最常遇到“仿真器一休眠就断连”以及“烧录后芯片锁死无法二次擦写”的问题。以下是应对这两大痛点的黄金准则：

### 6.1 低功耗下保持 SWD/JTAG 连接 (DBGMCU)
* **原因**：当 MCU 进入 Stop 或 Standby 模式时，Cortex-M 的调试时钟（FCLK/HCLK）被强制关断。调试器物理连接瞬间中断，Keil/IAR 会弹出 **"Loss of DND connection"** 或 **"Target DLL has been cancelled"** 错误。
* **解决方案**：
  在代码初始化时，主动写入调试 MCU 控件寄存器（`DBGMCU_CR`），使能 `DBG_STOP` 位。
  ```c
  /* 使能低功耗下的调试支持（仅在产品开发和测量前使用） */
  LL_DBGMCU_EnableDBGStopMode();
  ```
* **注意**：该配置会导致 MCU 在 Stop 模式下**依然保持调试物理链路带电**。此时测试底电流会比正常值偏大数百微安。**在产品进入量产发布阶段，必须在代码中将该项使能彻底删除。**

### 6.2 增加上电开机保护性延迟
* **原因**：如果固件中没有加入上电保护，一上电就直接关断引脚并调用 `__WFI()` 进入 Shutdown 模式，调试器将根本没有时间在 CPU 挂起前建立通信物理连接，芯片将被“锁死”，造成无法再次烧写代码的假死现象。
* **解决方案**：
  在主程序的 `main` 函数开头，加入一个强制性的 **$2\text{s} \sim 3\text{s}$ 延时**（如 `HAL_Delay(2000)`），在此延时阶段不执行任何低功耗配置，保持 SWD 引脚和调试引脚为默认状态。这样，一旦发生程序运行异常，开发人员只需断电重新上电，并在上电后 2 秒的窗口期内点击“擦除（Erase）”或“烧写（Download）”，即可顺利恢复对芯片的控制。
