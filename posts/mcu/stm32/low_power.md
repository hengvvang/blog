---
title: "物联网 MCU 低功耗模式与底电流改善实战"
publishTime: "2026-05-24 14:20"
author: "hengvvang"
summary: "细致对比运行模式下各种唤醒源、外设时钟挂载与不同低功耗状态下的毫安级乃至微安级电流消耗。"
---




# 物联网 MCU 低功耗模式与底电流改善实战

物联网设备（IoT）对功耗极度敏感，特别是使用电池供电的节点。本文将以真实实验数据展示关闭外围设备时钟、配置 LDO 降压模块，以及合理进入 STOP 模式对全局底电流的显著改善幅度。

## MCU 功耗的组成

MCU 的功耗主要分为两部分：
1. **动态功耗**：由于晶体管开关切换引起的电容充放电功耗，公式为 $P_{dynamic} = C \cdot V^2 \cdot f$。
2. **静态功耗**：由于晶体管漏电流（Leakage Current）产生的功耗。

因此，降功耗的两个核心思路是：**降压**和**降频**。

## 常见的低功耗模式（以 STM32L4 为例）

| 模式 | 核心工作状态 | 唤醒源 | 典型电流值 |
| :--- | :--- | :--- | :--- |
| **RUN** | 全速运行 | 无 | ~100 uA/MHz |
| **SLEEP** | CPU 停止，外设工作 | 任意中断 | ~30 uA/MHz |
| **STOP 2** | 核心及外设断电，SRAM 保留 | RTC, 外部中断 (EXTI) | ~1.1 uA |
| **STANDBY** | 核心断电，SRAM 丢失 | Wakeup 引脚, RTC | ~380 nA |

## 降低底电流的最佳实践

在实际开发中，如果进入低功耗模式后底电流依然有几毫安，通常是由于引脚配置不当引起的漏电。

### 1. 将未使用的 GPIO 配置为模拟输入 (Analog Input)

未使用的引脚如果处于浮空状态，其输入缓冲器可能会因为电平波动而反复开关，产生巨大的漏电流。

```c
void GPIO_Analog_Config(void) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    
    // 启用所有 GPIO 时钟
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();
    
    // 配置为模拟模式
    GPIO_InitStruct.Pin = GPIO_PIN_ALL;
    GPIO_InitStruct.Mode = GPIO_MODE_ANALOG;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
    HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}
```

### 2. 关闭不用的外设时钟

在进入 STOP 模式之前，一定要显式关闭未使用的外设时钟，并在唤醒后重新配置系统时钟。

```c
void Enter_Low_Power_Stop2(void) {
    // 关闭不必要的外设时钟
    __HAL_RCC_USART1_CLK_DISABLE();
    
    // 进入 STOP 2 模式
    HAL_PWREx_EnterSTOP2Mode(PWR_STOPENTRY_WFI);
    
    // 唤醒后，重新使能系统时钟（由于唤醒后系统默认切换到 HSI/MSI）
    SystemClock_Config();
}
```
