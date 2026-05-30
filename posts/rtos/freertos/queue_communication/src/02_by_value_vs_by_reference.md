# 02 值拷贝(Copy-by-Value)与引用拷贝(Copy-by-Reference)深度剖析

在 FreeRTOS 中，数据入队和出队存在两种基本范式：**值拷贝（Copy-by-Value）**与**引用拷贝（Copy-by-Reference，即指针传递）**。理解它们的底层实现、性能开销以及内存安全性，对于设计高效、稳定的实时嵌入式系统至关重要。

---

## 1. 值拷贝（Copy-by-Value）底层机制与优劣势

### 1.1 底层实现原理
在默认情况下，FreeRTOS 推荐并采用“值拷贝”机制。当我们调用 `xQueueSend(xQueue, &xData, xTicksToWait)` 时，内核会在临界区内直接执行以下操作：

```c
/* 简化后的内核拷贝逻辑 */
memcpy( ( void * ) pxQueue->pcWriteTo, ( const void * ) pvItemToQueue, ( size_t ) pxQueue->uxItemSize );
```

这意味着数据直接从**发送任务的栈空间（或全局变量区）**被复制到了**队列的内部环形缓冲区**。

当接收任务调用 `xQueueReceive(xQueue, &xBuffer, xTicksToWait)` 时，数据同样通过 `memcpy` 从**队列缓冲区**复制到**接收任务的栈空间**。

### 1.2 优点
*   **天然的生存期解耦与线程安全**：发送任务在数据入队后，可以立即修改、重用甚至销毁该变量（例如局部变量退出作用域），而不会影响到队列中已存的数据。接收任务拥有自己独立的数据副本，不存在任何“竞争读写（Data Race）”风险。
*   **内存管理极其简单**：队列的内存由内核一次性分配（动态或静态），无需在运行期频繁申请和释放数据块，从而彻底避免了内存碎片化（Memory Fragmentation）。

### 1.3 缺点
*   **性能开销大**：如果数据项非常大（例如一个 512 字节的原始传感器帧或图像数据块），单次 `memcpy` 将消耗大量的 CPU 周期，两次拷贝（栈 $\to$ 队列 $\to$ 栈）的累积开销将严重影响任务的实时性。
*   **内存冗余**：队列需要开辟 `uxLength * uxItemSize` 的连续内存，这在 RAM 资源极其匮乏的微控制器中，可能是无法承受的负担。

---

## 2. 引用拷贝（Copy-by-Reference）底层机制与风险

当传输的数据项体积过大时，通常采用“引用拷贝”，即队列中**仅存储指向数据的指针（Pointer）**。

### 2.1 底层实现原理
创建队列时，数据项的大小 `uxItemSize` 被设置为指针的大小：

```c
/* 创建一个存储指针的队列 */
xQueue = xQueueCreate( QUEUE_LENGTH, sizeof( MyDataStruct_t * ) );
```

发送时，传递的是指针本身的地址：
```c
MyDataStruct_t *pxMessage = &xRealData;
xQueueSend( xQueue, &pxMessage, xTicksToWait ); // 注意：传递的是指针的地址（双重指针效果）
```

### 2.2 优点
*   **极高的吞吐性能**：无论实际数据结构有多大（即使是数兆字节的图像），`memcpy` 拷贝的仅仅是一个 32 位（Cortex-M 为 4 字节）或 64 位的地址指针，实现“零拷贝”级的数据吞吐。

### 2.3 核心风险与工程灾难

> [!CAUTION]
> 引用拷贝虽然高效，但如果内存管理不当，极易导致悬空指针（Dangling Pointer）、内存泄漏（Memory Leak）以及多任务并发冲突。

#### 风险一：栈内存溢出与生命周期冲突（Dangling Pointer）
如果发送任务将自己栈上的局部变量指针发送给队列，在接收任务读取该指针之前，发送任务的函数已经退出，栈帧被销毁重写，接收任务解引用该指针时将读取到垃圾数据，导致系统崩溃。

```c
void vSenderTask( void * pvParameters )
{
    for( ;; )
    {
        MyDataStruct_t xLocalData; // 局部变量，分配在栈上
        xLocalData.val = 42;
        
        MyDataStruct_t *pxPtr = &xLocalData;
        /* 致命错误：xLocalData 会在本轮循环结束或函数返回时失效 */
        xQueueSend( xQueue, &pxPtr, 0 ); 
        
        vTaskDelay( pdMS_TO_TICKS( 100 ) );
    }
}
```

#### 风险二：共享资源的竞态条件（Race Condition）
如果发送方发送了指向全局变量或堆内存的指针后，在接收方处理完毕前，又去修改该内存区的内容，就会造成数据不一致。

---

## 3. 引用拷贝的安全内存管理方案

为了安全地进行引用拷贝，工程上通常采用以下三种内存管理策略：

### 3.1 策略 A：动态内存分配（Heap-based）
发送方动态申请内存，接收方负责释放。
*   **优点**：按需分配，适合不规则、突发性的海量数据。
*   **缺点**：在硬实时系统（Hard Real-Time）中，`pvPortMalloc` / `vPortFree` 的时间开销是不确定的（取决于内存管理算法如 Heap_4），且长期运行存在内存碎片风险。

### 3.2 策略 B：专用内存池/块分配（Memory Pool）
使用第三方内存池（如 FreeRTOS 的 `StreamBuffer`，或者预先分配好的静态结构体数组加上“空闲指针队列”）来管理数据。
*   **优点**：分配时间恒定（$O(1)$），无碎片。

### 3.3 策略 C：双缓冲区 / 环形多缓冲区（Double Buffering）
发送方和接收方交替持有两个或多个静态全局缓冲区指针，通过队列只传递当前填充完毕的缓冲区编号或指针。

---

## 4. 生产级对比代码示例

### 4.1 值拷贝生产级代码

该示例展示了如何安全地利用“值拷贝”传输温度与湿度数据。

```c
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"

/* 定义数据结构 */
typedef struct
{
    uint32_t ulSensorID;
    float fTemperature;
    float fHumidity;
    TickType_t xTimeStamp;
} SensorData_t;

/* 声明队列句柄 */
static QueueHandle_t xSensorQueue = NULL;

/* 生产者任务：采集传感器数据 */
void vSensorDataPublisher( void * pvParameters )
{
    SensorData_t xData;
    xData.ulSensorID = 0xABCD0001;
    
    for( ;; )
    {
        /* 模拟硬件采集 */
        xData.fTemperature = 25.0f + ( (float)( rand() % 100 ) / 50.0f );
        xData.fHumidity = 50.0f + ( (float)( rand() % 100 ) / 10.0f );
        xData.xTimeStamp = xTaskGetTickCount();
        
        /* 
         * 值拷贝入队：将 xData 的内容 memcpy 到队列缓冲区中。
         * 即使后面 xData 被修改，队列中的数据也不会受影响。
         */
        if( xQueueSend( xSensorQueue, ( void * ) &xData, pdMS_TO_TICKS( 10 ) ) != pdPASS )
        {
            /* 队列满，入队失败处理（例如丢弃或记录日志） */
        }
        
        vTaskDelay( pdMS_TO_TICKS( 500 ) ); // 500ms 周期采集
    }
}

/* 消费者任务：处理传感器数据 */
void vSensorDataSubscriber( void * pvParameters )
{
    SensorData_t xReceivedData;
    
    for( ;; )
    {
        /* 
         * 阻塞接收：如果队列为空，任务进入阻塞态，不占用 CPU
         */
        if( xQueueReceive( xSensorQueue, &( xReceivedData ), portMAX_DELAY ) == pdPASS )
        {
            /* 成功读取副本，进行业务处理 */
            printf( "Sensor ID: 0x%08X | Temp: %.2f C | Hum: %.2f%%\n",
                    (unsigned int)xReceivedData.ulSensorID,
                    xReceivedData.fTemperature,
                    xReceivedData.fHumidity );
        }
    }
}

void vStartValCopyDemo( void )
{
    /* 创建队列：深度为 5，每个元素大小为 SensorData_t 的字节数 */
    xSensorQueue = xQueueCreate( 5, sizeof( SensorData_t ) );
    
    if( xSensorQueue != NULL )
    {
        xTaskCreate( vSensorDataPublisher, "Publisher", 1024, NULL, 2, NULL );
        xTaskCreate( vSensorDataSubscriber, "Subscriber", 1024, NULL, 1, NULL );
    }
}
```

### 4.2 引用拷贝生产级代码（动态分配安全释放模式）

该示例展示了如何安全地使用动态内存分配（使用 FreeRTOS `pvPortMalloc`）进行大块数据（如网络数据帧）的“引用拷贝”传输。

```c
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"

/* 定义大块数据结构 */
typedef struct
{
    uint32_t ulFrameNumber;
    uint32_t ulDataLength;
    uint8_t *pucRawPayload; /* 动态分配的载荷数据 */
} NetworkFrame_t;

/* 声明队列句柄（注意：队列项大小是 NetworkFrame_t 指针的大小） */
static QueueHandle_t xNetworkFrameQueue = NULL;

/* 发送者任务：网络报文接收线程（模拟） */
void vNetworkRxTask( void * pvParameters )
{
    uint32_t ulFrameCounter = 0;
    
    for( ;; )
    {
        /* 模拟接收到大块数据，进行动态内存申请 */
        NetworkFrame_t *pxFrame = ( NetworkFrame_t * ) pvPortMalloc( sizeof( NetworkFrame_t ) );
        
        if( pxFrame != NULL )
        {
            pxFrame->ulFrameNumber = ulFrameCounter++;
            pxFrame->ulDataLength = 128; /* 假设报文长度为 128 字节 */
            
            /* 分配实际 payload 的内存空间 */
            pxFrame->pucRawPayload = ( uint8_t * ) pvPortMalloc( pxFrame->ulDataLength );
            
            if( pxFrame->pucRawPayload != NULL )
            {
                /* 填充 Payload 数据 */
                memset( pxFrame->pucRawPayload, 0xAA, pxFrame->ulDataLength );
                
                /*
                 * 引用拷贝入队：传递的是 pxFrame 指针本身的地址。
                 * 队列保存的是 pxFrame 的 4/8 字节指针。
                 */
                if( xQueueSend( xNetworkFrameQueue, ( void * ) &pxFrame, pdMS_TO_TICKS( 50 ) ) == pdPASS )
                {
                    /* 
                     * 成功入队！
                     * 注意：此时 pxFrame 指向的内存所有权已转移给队列。
                     * 发送者任务绝不能再对其执行写操作，也不能在这里 free 它。
                     */
                }
                else
                {
                    /* 发送失败，必须由发送方主动释放所有已分配内存，防止内存泄漏 */
                    vPortFree( pxFrame->pucRawPayload );
                    vPortFree( pxFrame );
                }
            }
            else
            {
                /* 内存不足，释放外层控制结构 */
                vPortFree( pxFrame );
            }
        }
        
        vTaskDelay( pdMS_TO_TICKS( 200 ) );
    }
}

/* 接收者任务：协议解析与落库 */
void vNetworkProcessorTask( void * pvParameters )
{
    NetworkFrame_t *pxReceivedFrame = NULL;
    
    for( ;; )
    {
        /* 
         * 阻塞接收指针：取出的是保存在队列中的 NetworkFrame_t*
         */
        if( xQueueReceive( xNetworkFrameQueue, &pxReceivedFrame, portMAX_DELAY ) == pdPASS )
        {
            /* 安全断言，确保指针合法 */
            configASSERT( pxReceivedFrame != NULL );
            configASSERT( pxReceivedFrame->pucRawPayload != NULL );
            
            /* 处理数据... */
            printf( "Processing Frame %u, Length: %u\n",
                    (unsigned int)pxReceivedFrame->ulFrameNumber,
                    (unsigned int)pxReceivedFrame->ulDataLength );
            
            /* 
             * 消费完毕，必须由接收方完全释放内存！
             */
            vPortFree( pxReceivedFrame->pucRawPayload );
            vPortFree( pxReceivedFrame );
            
            /* 避免悬空指针 */
            pxReceivedFrame = NULL;
        }
    }
}

void vStartRefCopyDemo( void )
{
    /* 创建队列：保存的数据项是 NetworkFrame_t * 指针类型 */
    xNetworkFrameQueue = xQueueCreate( 4, sizeof( NetworkFrame_t * ) );
    
    if( xNetworkFrameQueue != NULL )
    {
        /* 创建任务 */
        xTaskCreate( vNetworkRxTask, "NetRx", 1024, NULL, 3, NULL );
        xTaskCreate( vNetworkProcessorTask, "NetProc", 1024, NULL, 2, NULL );
    }
}
```

### 4.3 两种方式设计维度综合对比

| 比较维度 | 值拷贝 (Copy-by-Value) | 引用拷贝 (Copy-by-Reference) |
| :--- | :--- | :--- |
| **单次数据拷贝量** | 结构体大小（`uxItemSize`） | 指针大小（通常为 4/8 字节） |
| **CPU 周期开销** | 随结构体增大而**线性增加** | **恒定极小**，不受结构体大小影响 |
| **内存所有权** | 明确。队列维护独立的副本空间 | 转移。需制定严格的生命周期协议 |
| **内存泄漏风险** | 无 | 极高。设计不当易导致内存泄漏 |
| **生存期冲突** | 天然免疫 | 需避免局部变量指针出队后的退栈 |
| **典型应用场景** | 状态量、传感器读数、简短控制指令 | 大块网络报文、图像帧、大型配置日志 |
