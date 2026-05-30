# 01 FreeRTOS 队列底层控制结构与内存布局

要透彻理解 FreeRTOS 队列的线程安全与高效通信，必须从其底层的 C 语言控制结构——`Queue_t`（在内核源码 `queue.c` 中定义为 `xQUEUE`）以及内存布局入手。FreeRTOS 通过精妙设计的控制块和指针操作，将队列的管理、数据的存储以及任务的阻塞调度完美地融合在一个连续的内存区域中。

---

## 1. Queue_t (xQUEUE) 核心控制块源码剖析

在 FreeRTOS 中，队列的控制信息存储在 `Queue_t` 结构体中。以下是该结构体在内核源码中的典型定义（省略了协程与队列集相关的条件编译，聚焦于最核心的成员）：

```c
typedef struct QueueDefinition
{
    int8_t * pcHead;           /* 指向队列存储区域的起始地址（存储区首字节） */
    int8_t * pcTail;           /* 指向队列存储区域的尾部边界地址（最后一个可用字节的下一个地址） */
    int8_t * pcWriteTo;        /* 指向下一个数据写入位置的指针 */

    union
    {
        int8_t * pcReadFrom;   /* 当结构体用作普通队列时：指向最后一次读取数据的位置 */
        UBaseType_t uxRecursiveCallCount; /* 当结构体用作递归互斥锁时：记录递归持有的次数 */
    } u;

    List_t xTasksWaitingToSend;    /* 等待发送的任务列表（因队列满而阻塞的任务，按优先级排序） */
    List_t xTasksWaitingToReceive; /* 等待接收的任务列表（因队列空而阻塞的任务，按优先级排序） */

    volatile UBaseType_t uxMessagesWaiting; /* 当前队列中已存储的数据项（消息）数量 */
    UBaseType_t uxLength;                   /* 队列能容纳的最大数据项数量（队列深度） */
    UBaseType_t uxItemSize;                 /* 每个数据项的大小（单位：字节） */

    volatile int8_t cRxLock;   /* 接收锁：队列锁定时，记录从队列中读取数据（出队）的次数 */
    volatile int8_t cTxLock;   /* 发送锁：队列锁定时，记录向队列中写入数据（入队）的次数 */

    #if ( ( configSUPPORT_STATIC_ALLOCATION == 1 ) && ( configSUPPORT_DYNAMIC_ALLOCATION == 1 ) )
        uint8_t ucStaticallyAllocated; /* 标记该队列是静态分配（Stack/Static）还是动态分配（Heap） */
    #endif

    #if ( configUSE_QUEUE_SETS == 1 )
        struct QueueDefinition * pxQueueSetContainer; /* 指向该队列所属的队列集 */
    #endif

} xQUEUE;

typedef xQUEUE Queue_t;
```

### 关键成员功能详解

#### (1) 环形缓冲区控制指针
*   `pcHead` 和 `pcTail` 共同勾勒出队列**物理存储空间**的起始和结束边界。
*   `pcWriteTo` 始终指向环形缓冲区中下一个准备写入数据项的内存首地址。
*   `u.xQueue.pcReadFrom` 则是指向**上一次**成功读取的数据项首地址。这意味着，在进行读操作时，需要先将该指针向后移动一个 `uxItemSize`，然后拷贝数据。

#### (2) 双向阻塞链表
*   `xTasksWaitingToSend`：当队列已满（`uxMessagesWaiting == uxLength`），又有任务尝试调用 `xQueueSend()` 发送数据且设置了非零的阻塞超时时间（`xTicksToWait > 0`）时，该任务会被移出就绪列表，并插入到这个阻塞链表中。
*   `xTasksWaitingToReceive`：当队列已空（`uxMessagesWaiting == 0`），又有任务尝试调用 `xQueueReceive()` 读取数据且设置了非零的阻塞超时时间时，该任务会被插入到这个阻塞链表中。
*   **优先级排序**：这两个链表是按照**任务优先级降序排列**的。这意味着当队列状态发生改变时，最高优先级的阻塞任务将最先被唤醒；如果优先级相同，则按照先来后到（FIFO）的顺序唤醒。

#### (3) 中断锁计数器
*   `cRxLock` 和 `cTxLock` 是队列锁定机制的核心。当队列被锁定时，这些计数器处于非锁定值（如非 `queueUNLOCKED`）。我们在后文将详细剖析它们的精妙设计。

---

## 2. 队列内存布局：单块连续分配 vs 静态分配

FreeRTOS 支持**动态内存分配**（`xQueueCreate()`）和**静态内存分配**（`xQueueCreateStatic()`）。两者的底层内存布局存在本质差异。

### 2.1 动态内存分配的连续布局

在使用 `xQueueCreate(uxQueueLength, uxItemSize)` 时，FreeRTOS 会在堆（Heap）上调用一次 `pvPortMalloc`。这次申请的内存大小为：

$$\text{Total Size} = sizeof(Queue\_t) + (uxQueueLength \times uxItemSize)$$

这种设计的最大好处是**内存的高局部性（Locality）**。队列控制块和数据缓冲区在内存中是完全连续的。

```mermaid
grid-layout
```

上面这种内存连续布局在物理内存中呈现如下所示：

```
+-------------------------------------------------------+
|                 Queue_t 控制块结构体                  |
|  pcHead --------+                                     |
|  pcTail --------+--------------------------------+    |
|  pcWriteTo      |                                |    |
|  ...            |                                |    |
+-----------------+--------------------------------+----+
|  Item 0         |  Item 1  |  ...   |  Item N-1       |
+-----------------+----------+--------+-----------------+
^                                      ^
pcHead                                 pcTail
(pcHead + 0*ItemSize)                  (pcHead + N*ItemSize)
```

> [!NOTE]
> `pcTail` 指向的是最后一个数据项的边界之外（即第一个非法地址）。在指针溢出判断中，若指针递增后等于 `pcTail`，则会直接重置为 `pcHead`。

### 2.2 静态内存分配的离散布局

而在使用 `xQueueCreateStatic()` 时，用户必须在外部定义两个独立的内存块：一个用于放置控制块，另一个作为缓冲区：

```c
StaticQueue_t xQueueBuffer;
uint8_t ucQueueStorage[ QUEUE_LENGTH * ITEM_SIZE ];
QueueHandle_t xQueue;

xQueue = xQueueCreateStatic( QUEUE_LENGTH, ITEM_SIZE, ucQueueStorage, &xQueueBuffer );
```

此时的内存布局是非连续的：

```mermaid
graph LR
    subgraph 控制块内存 (xQueueBuffer)
        QB[Queue_t 结构体]
    end
    subgraph 独立数据存储区 (ucQueueStorage)
        Buf[Item 0 | Item 1 | ... | Item N-1]
    end
    QB -- pcHead --> Buf
```

---

## 3. 环形缓冲区（Ring Buffer）指针演进机制

FreeRTOS 队列的数据拷贝是基于典型的环形缓冲区思想实现的。下面详细剖析在**入队**与**出队**操作中，指针是如何演进和回绕（Wrap-around）的。

### 3.1 入队指针演进（Writing to Queue）

假设当前队列中有空闲空间，向队列写入一个数据项的步骤如下：

1.  **拷贝数据**：调用 `memcpy( ( void * ) pxQueue->pcWriteTo, pvItemToQueue, ( size_t ) pxQueue->uxItemSize )`。将用户栈/全局区的数据直接拷贝到 `pcWriteTo` 指向的地址。
2.  **指针递增**：将 `pcWriteTo` 加上 `uxItemSize`：
    ```c
    pxQueue->pcWriteTo += pxQueue->uxItemSize;
    ```
3.  **边界回绕**：如果递增后的地址达到了 `pcTail`，说明已经到达缓冲区末尾，需要回绕：
    ```c
    if( pxQueue->pcWriteTo >= pxQueue->pcTail )
    {
        pxQueue->pcWriteTo = pxQueue->pcHead;
    }
    ```
4.  **数量递增**：增加消息计数：`pxQueue->uxMessagesWaiting++`。

### 3.2 出队指针演进（Reading from Queue）

从队列中读取一个数据项的步骤如下：

1.  **计算读取地址**：由于 `pcReadFrom` 指向的是上一次读取的位置，因此本次读取的地址需要预先向后移动：
    ```c
    int8_t *pcReadPosition = pxQueue->u.xQueue.pcReadFrom + pxQueue->uxItemSize;
    ```
2.  **读前边界回绕**：如果计算出的读取位置达到了 `pcTail`，则回绕至 `pcHead`：
    ```c
    if( pcReadPosition >= pxQueue->pcTail )
    {
        pcReadPosition = pxQueue->pcHead;
    }
    ```
3.  **拷贝数据**：将数据从缓冲区拷贝到用户的接收地址：
    ```c
    memcpy( pvBuffer, ( void * ) pcReadPosition, ( size_t ) pxQueue->uxItemSize );
    ```
4.  **更新读指针**：更新 `pcReadFrom` 指针为本次成功读取的地址：
    ```c
    pxQueue->u.xQueue.pcReadFrom = pcReadPosition;
    ```
5.  **数量递减**：减少消息计数：`pxQueue->uxMessagesWaiting--`。

---

## 4. 中断锁（Queue Locks）精妙设计

在 FreeRTOS 中，当任务正在修改队列时（例如正在执行入队或出队拷贝，或者正在调整阻塞任务链表），为了保证操作的原子性，必须对队列进行保护。

如果直接通过“关中断（Disable Interrupts）”来保护，那么在传输大块数据或有大量阻塞任务需要调整时，关中断时间会非常长，这会带来极高的**中断延迟（Interrupt Latency）**，破坏系统的实时性。

为了解决这一痛点，FreeRTOS 引入了**队列锁（Queue Locks）**机制：`cRxLock` 和 `cTxLock`。

### 4.1 锁的定义与状态

```c
#define queueUNLOCKED    ( ( int8_t ) -1 )
#define queueLOCKED_UNMODIFIED ( ( int8_t ) 0 )
```
*   `cRxLock` / `cTxLock` 的初始值为 `queueUNLOCKED`（即 `-1`）。
*   当队列被锁定时，它们的值被设置为 `queueLOCKED_UNMODIFIED`（即 `0`）。

### 4.2 锁定期间的中断安全处理机制

当任务在临界区内操作队列时，它会调用 `prvLockQueue( pxQueue )`：
```c
#define prvLockQueue( pxQueue )                          \
    taskENTER_CRITICAL();                                \
    {                                                    \
        if( ( pxQueue )->cRxLock == queueUNLOCKED )      \
        {                                                \
            ( pxQueue )->cRxLock = queueLOCKED_UNMODIFIED; \
        }                                                \
        if( ( pxQueue )->cTxLock == queueUNLOCKED )      \
        {                                                \
            ( pxQueue )->cTxLock = queueLOCKED_UNMODIFIED; \
        }                                                \
    }                                                    \
    taskEXIT_CRITICAL()
```

一旦队列被锁定，**中断服务程序（ISR）仍然可以正常向队列写入或读取数据**，但 ISR **不能**直接去操作阻塞链表（因为这涉及任务就绪列表的修改，而在中断中修改任务状态是不允许的，或者必须使用特定锁）。

这时，ISR 的处理方式极其精妙：

1.  **数据拷贝**：ISR 照常将数据拷贝入队（或出队）。
2.  **锁计数器递增**：ISR 检测到队列已被锁（`cTxLock` 或 `cRxLock` $\ge 0$），它不会去唤醒阻塞在 `xTasksWaitingToReceive` 上的任务，而是仅仅将计数器加 1：
    ```c
    /* 以下为 xQueueSendFromISR 中的核心逻辑片段 */
    if( cTxLock != queueUNLOCKED )
    {
        /* 队列已被锁定，只增加计数，不修改任务链表 */
        pxQueue->cTxLock = ( int8_t ) ( cTxLock + 1 );
    }
    else
    {
        /* 队列未锁，直接将等待接收的任务移出阻塞链表，加入就绪链表 */
        if( listLIST_IS_EMPTY( &( pxQueue->xTasksWaitingToReceive ) ) == pdFALSE )
        {
            if( xTaskRemoveFromEventList( &( pxQueue->xTasksWaitingToReceive ) ) != pdFALSE )
            {
                /* 记录有高优先级任务被唤醒，需要在 ISR 退出前进行上下文切换 */
                *pxHigherPriorityTaskWoken = pdTRUE;
            }
        }
    }
    ```

### 4.3 解锁队列时的补偿操作（Unlocking Queue）

当任务离开临界区并调用 `prvUnlockQueue( pxQueue )` 时，它会检查在锁定期间是否有中断写入或读取了数据。如果有，它会在任务上下文中补做这些工作：

```c
static void prvUnlockQueue( Queue_t * const pxQueue )
{
    taskENTER_CRITICAL();
    {
        int8_t cTxLock = pxQueue->cTxLock;

        /* 处理锁定期间发生的所有入队事件（TxLock） */
        while( cTxLock > queueLOCKED_UNMODIFIED )
        {
            #if ( configUSE_QUEUE_SETS == 1 )
                /* 队列集相关逻辑 */
            #else
            {
                /* 如果有任务在等待接收，则唤醒它们 */
                if( listLIST_IS_EMPTY( &( pxQueue->xTasksWaitingToReceive ) ) == pdFALSE )
                {
                    if( xTaskRemoveFromEventList( &( pxQueue->xTasksWaitingToReceive ) ) != pdFALSE )
                    {
                        /* 如果唤醒的任务优先级高于当前运行的任务，触发挂起调度 */
                        vTaskMissedYield();
                    }
                }
                else
                {
                    break;
                }
            }
            #endif
            cTxLock--;
        }
        pxQueue->cTxLock = queueUNLOCKED;
    }
    taskEXIT_CRITICAL();

    /* 同理，处理 RxLock 期间发生的出队事件，唤醒等待发送的任务 */
    taskENTER_CRITICAL();
    {
        int8_t cRxLock = pxQueue->cRxLock;

        while( cRxLock > queueLOCKED_UNMODIFIED )
        {
            if( listLIST_IS_EMPTY( &( pxQueue->xTasksWaitingToSend ) ) == pdFALSE )
            {
                if( xTaskRemoveFromEventList( &( pxQueue->xTasksWaitingToSend ) ) != pdFALSE )
                {
                    vTaskMissedYield();
                }
                cRxLock--;
            }
            else
            {
                break;
            }
        }
        pxQueue->cRxLock = queueUNLOCKED;
    }
    taskEXIT_CRITICAL();
}
```

这种设计完美实现了**中断延迟的最小化**。由于 ISR 无需触碰复杂的任务链表调整，其执行路径被压缩到了极短的几行寄存器与内存读写操作，大幅提升了系统的硬实时响应能力。
