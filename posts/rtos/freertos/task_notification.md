---
title: "FreeRTOS 任务通知替代信号量之高性能优化"
publishTime: "2026-05-24 14:50"
author: "hengvvang"
summary: "展示如何直接通过任务控制块（TCB）中的通知值，实现零内存开销的高速单向唤醒，避免创建多余的信号量。"
readingTime: "2 min"
tags: ["RTOS","FREERTOS","Real-Time","Kernel"]
lastUpdated: "2026-05-25 02:30"
cover: "https://images.unsplash.com/photo-1535378917042-10a22c95931a?w=800&auto=format&fit=crop"
coverText:
  position: center
  context: "RTOS | FREERTOS"
---






# FreeRTOS 任务通知替代信号量之高性能优化

在 FreeRTOS 中，普通的信号量和事件组需要额外的控制块（TCB 以外的内存），且读写时有多次上下文开销。任务通知（Task Notifications）是 FreeRTOS V8.2 引入的高效轻量级事件机制。

## 为什么选用任务通知？

- **更低内存**：每个任务控制块内部已有通知数，无需分配额外 RAM 结构。
- **更高速度**：发送任务通知时不需要进入复杂的信号量阻塞链表，直接修改目标任务状态，上下文切换更快，通常能提升 45% 的事件传输性能。

## 代码示例

```c
TaskHandle_t xReceiverTask;

// 接收任务代码
void vReceiver(void *pvParameters) {
    uint32_t ulNotificationValue;
    while(1) {
        // 等待任务通知
        xTaskNotifyWait(0, ULONG_MAX, &ulNotificationValue, portMAX_DELAY);
        printf("收到事件通知，值: %d
", ulNotificationValue);
    }
}

// 中断服务例程或发送任务代码
void vSender() {
    // 发送任务通知并附带数值
    xTaskNotify(xReceiverTask, 0x01, eSetBits);
}
```

只要不需要一对多的广播或队列数据缓存，任务通知完全可以替代二值信号量、计数信号量和事件组。