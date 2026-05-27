---
title: FreeRTOS 队列通信机制与数据拷贝深度剖析
publishTime: 2026-05-24 14:30
author: hengvvang
summary: 讲解如何在不同优先级的 FreeRTOS 任务之间或者中断服务程序中，通过线程安全队列安全传递结构体数据。
readingTime: 2 min
tags:
  - RTOS
  - FREERTOS
  - Real-Time
  - Kernel
lastUpdated: 2026-05-25 02:30
cover:
  image:
    src: https://images.unsplash.com/photo-1607799279861-4dd421887fb3?w=800&auto=format&fit=crop
    brightness: 0.75
    scale: 1.08
  text:
    content: RTOS | FREERTOS
    position: bottomLeft
---






# FreeRTOS 队列通信机制与数据拷贝深度剖析

队列是 FreeRTOS 中任务间传递数据的主要手段。与传递指针相比，FreeRTOS 队列默认采用**数据拷贝（By Value）**而非引用传递，这带来了优良的线程安全性。

## 创建与读写队列

```c
QueueHandle_t xQueue;
xQueue = xQueueCreate(10, sizeof(int)); // 深度为10，每个成员 4 字节

// 在发送任务中：
int val = 100;
xQueueSend(xQueue, &val, portMAX_DELAY); // 发送（拷贝）

// 在接收任务中：
int rxVal;
xQueueReceive(xQueue, &rxVal, portMAX_DELAY); // 接收（拷贝）
```

## 数据拷贝 vs 引用传递

- **数据拷贝**：数据被直接复制进队列内存中。即使发送任务在发送后立即修改了原变量，接收任务收到的也是发送那一刻的值。这避免了野指针与共享数据竞争。
- **引用传递**：如果传递的数据量非常大（如 1KB 的图像帧缓冲），拷贝开销过大，可以通过在队列中**只传递指针**的方式来优化速度，但在接收端使用完该数据前，发送端不得释放或修改这块内存。