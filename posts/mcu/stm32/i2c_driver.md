---
title: STM32 软件模拟 I2C 驱动与总线时序实现
publishTime: 2026-05-24 15:20
author: hengvvang
summary: 深入探讨 STM32 硬件 I2C 产生死锁的经典硬件设计缺陷，并提供软件规避及驱动层面的健壮代码设计。
readingTime: 2 min
tags:
  - MCU
  - STM32
  - Embedded
  - Hardware
lastUpdated: 2026-05-25 02:30
cover:
  image: https://images.unsplash.com/photo-1639322537228-f710d846310a?w=800&auto=format&fit=crop
  position: bottomRight
  text: MCU | STM32
---






# STM32 软件模拟 I2C 驱动与总线时序实现

虽然 STM32 内部集成了硬件 I2C 控制器，但在很多早期芯片或特殊环境下，硬件 I2C 容易卡死死锁。基于普通 GPIO 引脚软件模拟 I2C 时序，是一种更加稳定且易于调试的驱动方式。

## I2C 时序三大要点

1. **起始信号（START）**：SCL 处于高电平时，SDA 产生一个下降沿。
2. **停止信号（STOP）**：SCL 处于高电平时，SDA 产生一个上升沿。
3. **数据有效性**：在 SCL 处于高电平时，SDA 的电平必须保持稳定。SDA 的电平切换只能在 SCL 为低电平时进行。

## 软件时序实现示例

```c
void I2C_Delay(void) {
    // 简易微秒级延迟
    for(volatile int i = 0; i < 50; i++);
}

// 产生起始条件
void I2C_Start(void) {
    SDA_High();
    SCL_High();
    I2C_Delay();
    SDA_Low();  // 在 SCL 高电平时拉低 SDA
    I2C_Delay();
    SCL_Low();  // 准备发送数据
}

// 发送一个字节
void I2C_SendByte(uint8_t byte) {
    for(int i = 0; i < 8; i++) {
        if(byte & 0x80) SDA_High();
        else SDA_Low();
        byte <<= 1;
        I2C_Delay();
        SCL_High();
        I2C_Delay();
        SCL_Low();
    }
}
```

软件模拟 I2C 虽然占用了 CPU 周期，但不受硬件死锁困扰，极易移植到任何单片机平台。