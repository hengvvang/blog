---
title: Zephyr RTOS 设备树 (Devicetree) 架构精讲
publishTime: 2026-05-24 17:45
author: hengvvang
summary: 解读 DTS 设备树的树状继承与属性定义，展示 Zephyr 编译阶段如何根据设备树生成相应的外设驱动宏定义。
readingTime: 3 min
tags:
  - RTOS
  - ZEPHYR
  - Real-Time
  - Kernel
lastUpdated: 2026-05-25 02:30
cover:
  image:
    src: https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&auto=format&fit=crop
    brightness: 0.75
    scale: 1.08
  text:
    content: RTOS | ZEPHYR
    position: bottomRight
category: rtos
subcategory: zephyr
subtopic: others
---






# Zephyr RTOS 设备树 (Devicetree) 架构精讲

Zephyr 作为 Linux 基金会主导的现代嵌入式实时操作系统，吸取了 Linux 内核的许多先进设计，其中最核心的便是**设备树**（Devicetree, DT）机制。本文将带大家通俗易懂地理解设备树的语法架构以及它在硬件描述与代码解耦中的作用。

## 什么是设备树？

在传统的嵌入式开发中，板级硬件配置（如引脚分配、外设寄存器地址等）通常通过大量的 `#define` 宏或 C 语言初始化结构体硬编码在源码中。这使得代码难以移植到不同配置的芯片上。

设备树提供了一种将**硬件配置与软件逻辑分离**的方案。它是一种特殊的树形结构文本（`.dts` / `.dtsi`），专门用于描述芯片外设及板卡级硬件连接关系。

## 基础语法构成

设备树由多个节点（Node）和属性（Property）组成。下面是一个简化版的设备树节点描述：

```dts
/ {
    soc {
        #address-cells = <1>;
        #size-cells = <1>;

        usart1: serial@40013800 {
            compatible = "st,stm32-usart", "st,stm32-uart";
            reg = <0x40013800 0x400>;
            interrupts = <37 0>;
            status = "okay";
            label = "UART_1";
        };
    };
};
```

- `usart1`：节点标签（Label），用于在代码或其他节点中引用。
- `serial@40013800`：节点名称与单元地址，通常对应外设的物理基地址。
- `compatible`：兼容属性，系统根据它来匹配并加载相应的驱动程序。
- `reg`：寄存器地址与长度范围（起始于 `0x40013800`，长度为 `0x400` 字节）。

## 在 C 代码中提取设备树信息

Zephyr 在编译时会将设备树文本编译为对应的二进制文件，并生成一套庞大的 C 语言编译期宏。我们在 C 源码中通过这些特殊的宏直接获取硬件配置信息，而不需要任何运行时解析开销：

```c
#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>

// 1. 通过标签获取设备树节点标识符
#define UART1_NODE DT_NODELABEL(usart1)

void check_uart(void) {
    // 2. 检查该节点是否在设备树中被使能 (status = "okay")
    if (DT_NODE_HAS_STATUS(UART1_NODE, okay)) {
        // 3. 获取对应的系统驱动实例
        const struct device *const dev = DEVICE_DT_GET(UART1_NODE);
        if (device_is_ready(dev)) {
            printk("UART1 设备已就绪！\n");
        }
    }
}
```

## 总结

设备树的引入使得 Zephyr 能在一套代码下，仅仅依靠更换编译时的设备树定义（Board DTS），就跑在数十款不同架构的 MCU 评估板上，极大地降低了固件平台化移植的重复劳动成本。
