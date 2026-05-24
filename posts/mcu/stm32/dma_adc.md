---
title: "STM32 DMA 搬运 ADC 多通道高速采样机制"
publishTime: "2026-05-24 15:00"
author: "hengvvang"
description: "在高速数据采集系统中，如果单纯用 CPU 中断读取 ADC 寄存器，会占用大量的 CPU 计算周期。借助于直接内存访问（DMA），ADC 转换结果可以直接在硬件层面被搬运到 SRAM 缓冲区中。"
---

# STM32 DMA 搬运 ADC 多通道高速采样机制

在高速数据采集系统中，如果单纯用 CPU 中断读取 ADC 寄存器，会占用大量的 CPU 计算周期。借助于直接内存访问（DMA），ADC 转换结果可以直接在硬件层面被搬运到 SRAM 缓冲区中。

## DMA 工作原理

DMA 在硬件总线上是一个独立的外设主控器，它不经过 CPU 的干预，直接在两个物理地址（如 ADC 寄存器与内存数组）之间进行大量高速的数据传输。

## 配置步骤（以 HAL 库为例）

```c
#define ADC_CONVERTED_DATA_BUFFER_SIZE 3

uint16_t adc_val[ADC_CONVERTED_DATA_BUFFER_SIZE];

void Start_ADC_DMA(void) {
    // 启动 ADC 并在 DMA 模式下传输转换结果
    HAL_ADC_Start_DMA(&hadc1, (uint32_t*)adc_val, ADC_CONVERTED_DATA_BUFFER_SIZE);
}

// DMA 传输完毕回调函数
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* hadc) {
    // 转换完成，此时 adc_val 数组已填满最新多通道采样值
}
```

DMA 控制器配置为“循环模式（Circular Mode）”和“外设地址固定、内存地址递增”后，ADC 就会源源不断地刷新内存缓冲区，而 CPU 此时可以做其他计算任务，实现了高效协作。