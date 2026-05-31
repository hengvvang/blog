# 第四章：引用拷贝 (Copy-by-Reference) 指针传递与安全生命周期

在需要传输大块数据（如以太网数据帧、音频采样缓冲区、高分辨率相机的原始图像帧）或进行超高频数据传递的场景下，值拷贝带来的双重 `memcpy` 开销会瞬间吞噬 CPU 周期与内存总线带宽。为了解决这一性能痛点，嵌入式系统开发者通常采用**引用拷贝（Copy-by-Reference）**，即在队列中仅存储和传递指向数据物理地址的指针（Pointer），实现“零拷贝”通信。

---

## 1. 引用拷贝（指针传递）底层原理

引用拷贝的本质是只拷贝内存地址（32位 MCU 通常为 4 字节，64位通常为 8 字节），从而使得任意大小的数据包都能在几个 CPU 周期内完成入队和出队。

### 1.1 双重指针接口深度分析

使用 FreeRTOS 队列传输指针时，必须深刻理解其 API 的传参设计。FreeRTOS 队列的核心 API `xQueueSend(QueueHandle_t xQueue, const void * pvItemToQueue, TickType_t xTicksToWait)` 接收的第二个参数是一个**指向要放入队列的数据的指针**。

因为我们想要传输的是**指针变量本身的值**（一个 32 位的地址值），所以要让内核把这个地址值当作数据拷贝进队列，我们必须传入**指向该指针变量的指针**（即双重指针 `void **`）：

```c
/* 声明实际数据的结构体 */
typedef struct {
    uint8_t ucRawBuffer[1024];
} MyData_t;

/* 1. 创建存储指针类型的队列，元素大小必须设为指针自身的字节数 (sizeof(MyData_t *)) */
QueueHandle_t xPtrQueue = xQueueCreate( 5, sizeof( MyData_t * ) );

/* 2. 发送方任务 */
MyData_t *pxMessage = ( MyData_t * ) pvPortMalloc( sizeof( MyData_t ) );

/*
 * 【关键点分析】
 * pxMessage 是一个指针变量，它在栈上的地址是 0x20001000，其指向的物理内存地址（堆）是 0x20005000。
 *
 * 如果我们错误地写成：
 * xQueueSend( xPtrQueue, ( void * ) pxMessage, 0 );
 * 内核会将 pxMessage 指向的内容（即 0x20005000 处的 1024 字节的前 4 字节数据）拷贝进队列。这显然是致命的。
 *
 * 正确写法：
 * xQueueSend( xPtrQueue, ( void * ) &pxMessage, 0 );
 * 传入 &pxMessage（即 0x20001000 这一栈变量本身的地址）。
 * 内核读取 0x20001000 处的 4 字节数据（即 0x20005000 这个指针值），并将这个指针值拷贝入队。
 */
```

---

## 2. 指针生命周期与所有权转移协议

在引用拷贝中，数据实体的物理内存位置始终固定不变，改变的仅仅是“哪个任务拥有对其读写的特权”。为了防范多任务并发时的脏读/脏写（Data Race）与内存泄漏，必须确立严格的**所有权移交契约（Ownership Transfer Protocol）**。

### 2.1 所有权交接阶段

1.  **分配与独占（Allocate & Write）**：发送任务通过动态申请或内存池获取一块物理内存，并对其进行数据填充。此时只有该发送任务拥有读写权。
2.  **入队与移交（Enqueue & Handover）**：发送任务将指针的地址传入 `xQueueSend`。一旦入队成功，**发送任务必须立刻放弃对该指针的读写权利，也不能释放该指针**。此时，数据的控制权被暂存在队列中。
3.  **出队与承接（Dequeue & Process）**：接收任务调用 `xQueueReceive` 读出指针。此时，所有权正式移交至接收任务，接收任务可以安全地解析与处理该物理内存的数据。
4.  **销毁与终结（Free & Terminate）**：接收任务处理完毕后，**必须负责调用 Free 释放该内存块**，结束其整个生命周期。

### 2.2 指针所有权转移时序图

```
[ 发送任务 A ]                   [ FreeRTOS 指针队列 ]                 [ 接收任务 B ]
      |                                    |                                     |
 1. 申请内存并写入数据                      |                                     |
    [ A 独占读写所有权 ]                    |                                     |
      |                                    |                                     |
 2. 调用 xQueueSend(&Ptr)                  |                                     |
      |----------------------------------->|                                     |
      |                               [ 所有权暂存队列 ]                          |
    [ A 必须彻底放弃所有权，                  |                                     |
      禁止再读写或释放指针 ]                  |                                     |
      |                                    |                                     |
      |                                    |-----( 唤醒并出队 )------------------>|
      |                                    |                                     |
      |                                    |                            3. xQueueReceive(&Ptr)
      |                                    |                               获得物理地址，
      |                                    |                               [ B 承接所有权 ]
      |                                    |                                     |
      |                                    |                            4. 独占读取与处理数据
      |                                    |                                     |
      |                                    |                            5. 释放物理内存 vPortFree
      |                                    |                               数据生命周期正式终止
```

> [!CAUTION]
> **局部栈变量指针悬空灾难**：如果发送方任务发送了自己局部函数栈上的变量指针（如 `&xLocalVar`），一旦发送函数返回或当前任务被抢占导致其栈帧重写，接收方通过队列拿到的指针将指向一个已被破坏的栈空间。解引用此指针将导致不可预测的数据损坏，甚至直接触发 MCU 的硬件异常（HardFault）。**严禁使用队列传递局部栈变量的指针**。

---

## 3. 动态内存安全性与碎片化规避方案

虽然通过 `pvPortMalloc` / `vPortFree`（使用 FreeRTOS `Heap_4` 或 `Heap_5`）能够灵活分配大块内存，但在高度并发、长时间不间断运行的嵌入式系统中，频繁申请释放堆内存面临严重的局限性：
*   **分配延迟的不确定性（Non-deterministic Latency）**：`Heap_4` 需要在空闲链表中寻找最佳大小匹配的内存块，搜索时间取决于当前空闲碎片的数量（时间复杂度为 $O(N)$），无法满足硬实时性（Hard Real-Time）要求。
*   **内存碎片化堆积（Heap Fragmentation）**：长时间运行后，连续的物理内存可能会退化为无数细小的碎片，导致后续的大对象分配因找不到足够长的连续空间而宣告失败。

### 3.1 替代方案：固定大小静态内存池（Block Memory Pool）

为了在指针传递中获得绝对确定的 $O(1)$ 时间开销并彻底规避内存碎片，最佳实践是设计一个**静态块内存池**：
*   在编译期预先定义一个包含 $N$ 个大结构体的全局静态数组。
*   使用一个专门的 FreeRTOS 队列（称为“空闲块管理队列”）来存放所有空闲结构体的物理指针。
*   **申请内存**：发送任务直接从“空闲块管理队列”中获取一个可用指针（若队列空，说明内存耗尽，任务可进入阻塞等待空闲块释放）。
*   **释放内存**：接收任务消费完毕后，不调用系统的 `vPortFree`，而是直接将该结构体指针重新发送回“空闲块管理队列”。

---

## 4. 生产级引用拷贝通信代码模板（带防御性异常回收与内存池设计）

以下代码完整展示了在 FreeRTOS 中如何利用**线程安全的块内存池**进行高效、零碎片的“引用拷贝”指针通信。

```c
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include <stdio.h>
#include <string.h>

/* 定义大数据帧的结构体 (300字节，不适合值拷贝) */
typedef struct
{
    uint32_t ulFrameID;
    uint32_t ulPayloadLength;
    uint8_t  ucDataBuffer[ 292 ];
} LargeFrame_t;

#define MEMORY_POOL_SIZE    4  /* 内存池容量 */

/* 静态分配大对象的物理存储数组 */
static LargeFrame_t xFramesBuffer[ MEMORY_POOL_SIZE ];

/* 声明两个队列句柄 */
static QueueHandle_t xDataQueue = NULL;        /* 用于传递填充好数据的指针队列 */
static QueueHandle_t xFreeBlockQueue = NULL;   /* 用于管理空闲块指针的内存池队列 */

/* 初始化内存池管理结构 */
void vInitializeMemoryPool( void )
{
    /* 创建管理空闲块指针的队列 */
    xFreeBlockQueue = xQueueCreate( MEMORY_POOL_SIZE, sizeof( LargeFrame_t * ) );
    
    if( xFreeBlockQueue != NULL )
    {
        for( BaseType_t i = 0; i < MEMORY_POOL_SIZE; i++ )
        {
            LargeFrame_t *pxPtr = &xFramesBuffer[ i ];
            /* 将静态结构体的物理地址直接送入空闲块管理队列 */
            xQueueSend( xFreeBlockQueue, &pxPtr, portMAX_DELAY );
        }
    }
}

/* 发送者任务：数据生成与所有权移交 */
void vFrameProducerTask( void * pvParameters )
{
    uint32_t ulFrameCounter = 0;
    LargeFrame_t *pxFreeFrame = NULL;
    ( void ) pvParameters;
    
    for( ;; )
    {
        /* 
         * 1. 申请空闲内存块：从空闲队列中弹出一个物理结构体指针。
         * 此操作为 O(1) 确定性延迟，绝对不会产生堆碎片。
         * 如果目前无空闲内存，任务将阻塞等待 100ms 缓冲时间。
         */
        if( xQueueReceive( xFreeBlockQueue, &pxFreeFrame, pdMS_TO_TICKS( 100 ) ) == pdPASS )
        {
            /* 保证指针合法性 */
            configASSERT( pxFreeFrame != NULL );
            
            /* 2. 独占填充物理内存内容 */
            pxFreeFrame->ulFrameID = ulFrameCounter++;
            pxFreeFrame->ulPayloadLength = sizeof( pxFreeFrame->ucDataBuffer );
            memset( pxFreeFrame->ucDataBuffer, 0x5A, pxFreeFrame->ulPayloadLength ); /* 填充测试载荷 */
            
            /* 
             * 3. 引用拷贝入队：通过传递双重指针 &pxFreeFrame，将 4 字节的物理指针发送到数据队列中。
             * 必须进行防御性分支判断。
             */
            if( xQueueSend( xDataQueue, ( const void * ) &pxFreeFrame, pdMS_TO_TICKS( 50 ) ) == pdPASS )
            {
                /* 
                 * 入队成功！此时物理空间的所有权已成功转移至数据队列及接收端。
                 * 发送方在此分支下绝对不能再对 pxFreeFrame 指针进行任何读写操作。
                 */
                pxFreeFrame = NULL; /* 防御性清除，避免产生野指针 */
            }
            else
            {
                /* 
                 * 异常回滚处理：数据队列已满且超时未决，发送失败。
                 * 必须由发送方主动将该物理块的指针退回“空闲块管理队列”，防止“内存泄漏”！
                 */
                printf( "Data Queue Full! Recovering block %u to free pool.\n", ( unsigned int ) pxFreeFrame->ulFrameID );
                xQueueSend( xFreeBlockQueue, &pxFreeFrame, portMAX_DELAY );
                pxFreeFrame = NULL;
            }
        }
        else
        {
            /* 内存池已枯竭异常处理 */
            printf( "Memory pool exhausted! Frame %u dropped.\n", ( unsigned int ) ulFrameCounter );
        }
        
        vTaskDelay( pdMS_TO_TICKS( 200 ) ); /* 200ms 发送周期 */
    }
}

/* 接收者任务：所有权接收与内存回收 */
void vFrameConsumerTask( void * pvParameters )
{
    LargeFrame_t *pxReceivedFrame = NULL;
    ( void ) pvParameters;
    
    for( ;; )
    {
        /* 
         * 1. 阻塞获取数据指针：
         * 出队时，保存在数据队列中的 4 字节物理指针值被值拷贝到局部指针变量 pxReceivedFrame 中。
         */
        if( xQueueReceive( xDataQueue, &pxReceivedFrame, portMAX_DELAY ) == pdPASS )
        {
            configASSERT( pxReceivedFrame != NULL );
            
            /* 2. 独占使用数据内容 */
            printf( "Processing Frame %u. Payload size: %u bytes\n",
                    ( unsigned int ) pxReceivedFrame->ulFrameID,
                    ( unsigned int ) pxReceivedFrame->ulPayloadLength );
            
            /* 3. 使用完毕，必须将该结构体的物理指针发送回空闲队列，以释放资源给生产者 */
            xQueueSend( xFreeBlockQueue, &pxReceivedFrame, portMAX_DELAY );
            
            /* 4. 清除指针，避免发生悬空使用 */
            pxReceivedFrame = NULL;
        }
    }
}

void vStartRefCopyDemo( void )
{
    /* 初始化静态内存池与空闲管理队列 */
    vInitializeMemoryPool();
    
    /* 创建数据队列：专门存放 LargeFrame_t 指针类型，大小为 sizeof(LargeFrame_t *) */
    xDataQueue = xQueueCreate( 4, sizeof( LargeFrame_t * ) );
    
    if( xDataQueue != NULL && xFreeBlockQueue != NULL )
    {
        xTaskCreate( vFrameProducerTask, "FramePub", 1024, NULL, 3, NULL );
        xTaskCreate( vFrameConsumerTask, "FrameSub", 1024, NULL, 2, NULL );
    }
}
```
