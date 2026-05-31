# 第二章：内核流转机制与 API 操作详解

FreeRTOS 提供了高度灵活且且设计精妙的任务通知 API。为了在具体的工程实践中写出高性能且无 Race Condition 的代码，开发人员不仅需要熟练掌握各个 API 及其配置选项，更需要从源码和时序维度深刻理解其内核运行机制。

本章将详细拆解 FreeRTOS 任务通知的 API 体系，剖析发送和接收 API 的内核执行路径，并通过时序图与生命周期图来对比其与传统 IPC 的架构差异。

---

## 1. 任务通知的生命周期与延迟对比图

在深入 API 细节之前，我们先从系统设计层面，对任务通知与传统中间对象（如队列/信号量）的**生命周期**以及**信令传输延迟**进行可视化对比。

### 1.1 所有权生命周期对比 (Ownership Lifecycle Flowchart)

传统 IPC 对象（如 Semaphore）在内核中属于“独立共享资源”，其生命周期与使用它的任务是解耦的。这常导致“悬空指针”或“双重释放”的风险。而任务通知的存储区完全内嵌在接收方的 TCB 中，其生命周期与任务完全绑定。

```text
传统共享 IPC 生命周期 (共享所有权模型):
+--------------+      +------------------+      +-------------------+      +----------------+
|  创建 IPC     | ---> | 共享句柄给多个任务 | ---> | 任务 A/B 并发读写  | ---> |   删除 IPC      |
| (Queue_t)    |      | (Task A & Task B)|      |  (竞态条件与队列锁) |      | (易产生悬空指针) |
+--------------+      +------------------+      +-------------------+      +----------------+

任务通知生命周期 (私有所有权模型):
+--------------+      +-------------------------+      +-------------------+
|  创建任务 B   | ---> | 任务 B 的 TCB 自动分配  | ---> | 任务 A 直接写 B   |
| (Task B)     |      |  (包含通知值与状态数组)   |      |  (单向直接投递)   |
+--------------+      +-------------------------+      +-------------------+
                                                                 |
                                                                 v
+--------------+                                       +-------------------+
|  删除任务 B   | <------------------------------------ | TCB 释放, 通知销毁|
| (Task B)     |                                       | (零残留, 绝对安全) |
+--------------+                                       +-------------------+
```

### 1.2 信令传递延迟对比 (Signaling Latency Comparison)

当发送端向接收端投递唤醒信号时，传统队列介导的模型需要经历“加锁、写队列、链表检索、解锁”等诸多复杂步骤，而任务通知则表现为 $O(1)$ 的直接寄存器写与状态标记。

```text
队列/信号量介导的同步时延 (间接通信路径):
发送任务                  队列对象控制块                  接收任务
   |                            |                            |
   +---- 1. 临界区锁定队列 ------>|                            |
   +---- 2. 写入数据/标志 ------>|                            |
   +---- 3. 检索等待接收链表 ---->|  (时间复杂度 O(N))         |
   +---- 4. 释放队列锁 --------->|                            |
   |                            +---- 5. 移回就绪列表 ------->+
   v                            v                            v

任务通知同步时延 (直达通信路径):
发送任务                                               接收任务 (TCB)
   |                                                         |
   +---- 1. 获取接收端 TCB 句柄 (O(1) 寄存器操作) ------------>+
   +---- 2. 进入临界区，修改 ulNotifiedValue & ucNotifyState ->+
   +---- 3. 发现处于 WAITING 状态，直接将任务移入就绪列表 ---->+
   v                                                         v
```

---

## 2. 发送端 API 家族及其底层动作模式

任务通知的所有发送端 API 最终都是对内核核心函数 `xTaskGenericNotify()`（位于 `tasks.c` 中）的宏封装。其核心原型如下：

```c
BaseType_t xTaskNotifyIndexed( 
    TaskHandle_t xTaskToNotify,      /* 接收端任务的句柄（即目标 TCB 指针） */
    UBaseType_t uxToIndex,           /* 通知通道的数组索引，0 ~ (configTASK_NOTIFICATION_ARRAY_ENTRIES - 1) */
    uint32_t ulValue,                /* 发送的通知值 */
    eNotifyAction eAction            /* 核心：通知动作模式 */
);
```

### 2.1 `eNotifyAction` 动作模式深度剖析

`eNotifyAction` 是一个枚举类型，它直接决定了发送端如何修改接收端 TCB 内的 `ulNotifiedValue[uxToIndex]`。各模式的底层操作及行为特征如下：

| 枚举值 | 内核底层 C 语言操作 | 功能与应用场景 | 发送端返回值 |
| :--- | :--- | :--- | :--- |
| `eNoAction` | *(无数值操作)* | **二值信号量模拟**：只将接收方的通知状态设为 `taskNOTIFICATION_RECEIVED`，用以唤醒任务，不改变通知值。 | 始终返回 `pdPASS` |
| `eIncrement` | `pxTCB->ulNotifiedValue[idx]++` | **计数信号量模拟**：通知值自增 1。每次发送代表产生一个事件，接收端逐步消费。 | 始终返回 `pdPASS` |
| `eSetBits` | `pxTCB->ulNotifiedValue[idx] \|= ulValue` | **事件组模拟**：将通知值与 `ulValue` 按位进行或（`OR`）操作。各个 bit 代表不同的事件标志位。 | 始终返回 `pdPASS` |
| `eSetValueWithOverwrite` | `pxTCB->ulNotifiedValue[idx] = ulValue` | **覆写型邮箱模拟**：强行将通知值更新为 `ulValue`。若接收端有未读数据，旧值会被直接覆盖，确保接收最新值。 | 始终返回 `pdPASS` |
| `eSetValueWithoutOverwrite` | `if(state != RECEIVED) { pxTCB->ulNotifiedValue[idx] = ulValue; }` | **非覆写型邮箱模拟**：仅在接收端不存在未读通知时才更新值。若上一次通知未被接收端消费，则更新失败，防止数据丢失。 | 成功返回 `pdPASS`；若因未消费被拒绝则返回 `pdFAIL` |

---

## 3. 接收端 API 与清零掩码设计

接收端有两个核心 API：功能完备的 `xTaskNotifyWaitIndexed()` 和针对信号量极简优化的 `ulTaskNotifyTakeIndexed()`。

### 3.1 完备接收函数：`xTaskNotifyWaitIndexed()`

```c
BaseType_t xTaskNotifyWaitIndexed(
    UBaseType_t uxToIndex,              /* 监听的通道索引 */
    uint32_t ulBitsToClearOnEntry,      /* 进入函数时需要清除的 bit 掩码 */
    uint32_t ulBitsToClearOnExit,       /* 退出函数时需要清除的 bit 掩码 */
    uint32_t *pulNotificationValue,     /* 用于输出接收到的通知值的指针 */
    TickType_t xTicksToWait             /* 最大阻塞等待时间 */
);
```

#### 清零掩码（Clear On Entry / Exit）的运行机制：
1. **`ulBitsToClearOnEntry`**：在任务判断当前是否有挂起通知之前，将通知值中与该掩码相对应的 bit 置 0。例如，传入 `0x00000003` 表示进入时强行清除低 2 位；传入 `0xFFFFFFFF` 则清除所有位。这常用于在开始新的同步阶段前，滤除历史累积的无效干扰信号。
2. **`ulBitsToClearOnExit`**：在任务成功接收到通知，且已将当前的通知值写入到 `pulNotificationValue` 所指的内存之后，但在函数退出返回之前，将通知值中与该掩码对应的 bit 置 0。
   - 若要将其用作**二值信号量**，通常将此参数设为 `0xFFFFFFFF`（退出时清空所有位），确保下次读取时任务必须重新阻塞等待。
   - 若要将其用作**事件组**，且任务只处理了某些特定的标志位，则将 `ulBitsToClearOnExit` 设为已处理标志位的掩码，从而保留其他尚未处理的 bit 供后续逻辑或其他流程消费。

---

## 4. `xTaskGenericNotify` 内核源码逐行剖析

以下是 FreeRTOS 内核中 `xTaskGenericNotify` 函数的底层实现骨架（精简了部分多核 SMP 相关的特定处理，保留了单核及多通道通知的核心逻辑），并附有详尽的注释说明：

```c
/* 
 * FreeRTOS 核心任务通知发送函数
 * 位于 tasks.c 中
 */
BaseType_t xTaskGenericNotify( TaskHandle_t xTaskToNotify,
                               UBaseType_t uxToIndex,
                               uint32_t ulValue,
                               eNotifyAction eAction,
                               uint32_t *pulPreviousNotificationValue )
{
    TCB_t * pxTCB;
    BaseType_t xReturn = pdPASS;
    uint8_t ucOriginalNotifyState;

    /* 断言：确保目标任务句柄不为空，且数组通道索引未越界 */
    configASSERT( xTaskToNotify );
    configASSERT( uxToIndex < configTASK_NOTIFICATION_ARRAY_ENTRIES );

    /* 任务句柄本质上是指向 TCB 结构体的指针 */
    pxTCB = xTaskToNotify;

    /* 进入临界区，保护 TCB 状态字段 */
    taskENTER_CRITICAL();
    {
        /* 如果调用者传入了指针，则将更新前的通知值写回以供查询 */
        if( pulPreviousNotificationValue != NULL )
        {
            *pulPreviousNotificationValue = pxTCB->ulNotifiedValue[ uxToIndex ];
        }

        /* 暂存该通道的原始通知状态 */
        ucOriginalNotifyState = pxTCB->ucNotifyState[ uxToIndex ];

        /* 只要调用了发送 API，状态就会强制转为 taskNOTIFICATION_RECEIVED */
        pxTCB->ucNotifyState[ uxToIndex ] = taskNOTIFICATION_RECEIVED;

        /* 根据 eAction 执行不同的 TCB 通知值数学或位运算操作 */
        switch( eAction )
        {
            case eSetBits:
                /* 按位或运算：保留原有的 bit，同时置位新传入的 bit */
                pxTCB->ulNotifiedValue[ uxToIndex ] |= ulValue;
                break;

            case eIncrement:
                /* 累加运算：递增通知值，用以模拟计数信号量 */
                ( pxTCB->ulNotifiedValue[ uxToIndex ] )++;
                break;

            case eSetValueWithOverwrite:
                /* 强制覆写：不关心是否有历史挂起，直接用新值替代旧值 */
                pxTCB->ulNotifiedValue[ uxToIndex ] = ulValue;
                break;

            case eSetValueWithoutOverwrite:
                /* 非覆写模式：如果先前已有挂起的通知未消费，则拒绝写入 */
                if( ucOriginalNotifyState != taskNOTIFICATION_RECEIVED )
                {
                    pxTCB->ulNotifiedValue[ uxToIndex ] = ulValue;
                }
                else
                {
                    /* 存在挂起通知，拒绝写入并返回错误代码 */
                    xReturn = pdFAIL;
                }
                break;

            case eNoAction:
                /* 纯状态触发模式：只唤醒任务，不修改通知值（用于二值信号量模拟） */
                break;

            default:
                /* 捕获非法 Action */
                xReturn = pdFAIL;
                break;
        }

        /* 核心唤醒判定：如果目标任务先前正阻塞等待该通道的通知 */
        if( ucOriginalNotifyState == taskWAITING_NOTIFICATION )
        {
            /* 
             * 将该任务从当前的阻塞链表（如 DelayedTaskList）中移除。
             * 任务通知无需操作事件链表，因为目标 TCB 中已直接记录了其等待关系。
             */
            if( uxListRemove( &( pxTCB->xStateListItem ) ) == ( UBaseType_t ) 0 )
            {
                /* 如果移除该任务后，系统延时链表变空，则更新内核下一次解锁的时间戳 */
                prvResetNextTaskUnblockTime();
            }

            /* 将解除了阻塞状态的任务重新插入到 Ready 列表中 */
            prvAddTaskToReadyList( pxTCB );

            /* 如果被唤醒的任务优先级高于当前正在运行的任务，则需进行抢占式调度 */
            if( pxTCB->uxPriority > pxCurrentTCB->uxPriority )
            {
                /* 触发 PendSV 中断以执行抢占 */
                taskYIELD_IF_USING_PREEMPTION();
            }
        }
    }
    taskEXIT_CRITICAL();

    return xReturn;
}
```

---

## 5. 中断安全发送（FromISR）机制与上下文切换设计

在实际生产项目中，最常用的应用场景是在**中断服务程序（ISR）中向某个处理任务发送通知**（例如 DMA 传输完毕、GPIO 边缘检测触发或定时器溢出）。

### 5.1 ISR 中断安全的底层机制

由于中断具有随机且异步的特点，ISR 执行时可能打断了任意优先级的任务。为了保证内核链表在多优先级环境下的完整性，FreeRTOS 强制区分了常规 API 和带有 `FromISR` 后缀的 API。
`FromISR` 版本的发送函数通过参数 `pxHigherPriorityTaskWoken` 来协调上下文切换：

```c
/* 串口 DMA 接收完毕中断服务函数 */
void USART1_DMA_RX_IRQHandler( void )
{
    /* 必须初始化为 pdFALSE */
    BaseType_t xHigherPriorityTaskWoken = pdFALSE; 

    /* 清除硬件上的 DMA 传输完成标志 */
    __HAL_DMA_CLEAR_FLAG( DMA1, DMA_FLAG_TC5 );

    /* 假设 xRxTaskHandle 是已创建的数据解析任务句柄 */
    if( xRxTaskHandle != NULL )
    {
        /* 
         * 使用通道索引 0 发送通知，动作模式为 eNoAction 模拟二值信号量。
         * 如果 xRxTaskHandle 的优先级高于当前被中断打断的任务，
         * 内核会在函数内部将 xHigherPriorityTaskWoken 设置为 pdTRUE。
         */
        xTaskNotifyIndexedFromISR( 
            xRxTaskHandle, 
            0,                             /* 通道索引 0 */
            0,                             /* 忽略数值 */
            eNoAction, 
            &xHigherPriorityTaskWoken 
        );

        /* 
         * 触发中断退出后的上下文切换。
         * 在 ARM Cortex-M 架构下，此宏会触发 PendSV 中断。
         * 中断处理完毕后，CPU 会直接跳转到刚才被唤醒的高优先级解析任务执行，
         * 从而避免了等待下一个 OS SysTick 周期，保证了微秒级的实时响应。
         */
        portYIELD_FROM_ISR( xHigherPriorityTaskWoken );
    }
}
```
