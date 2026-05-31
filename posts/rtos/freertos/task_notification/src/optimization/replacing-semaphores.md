# 第三章：替代二值信号量、计数信号量与事件组实战

在传统的 FreeRTOS 架构设计中，当我们需要在中断与任务、或任务与任务之间进行同步和轻量级通信时，首先想到的就是创建二值信号量、计数信号量或事件组。然而，正如前面所分析的，这些传统的 IPC 对象会引入额外的控制块内存开销与调度开销。

本章将结合生产环境下的实际硬件交互场景，通过四个完整的生产级 C 语言示例，详细讲解如何使用任务通知 API 完美替代这些传统的 IPC 机制。

---

## 1. 替代二值信号量：中断与任务的单向同步

二值信号量最常见的使用场景是**中断延迟处理（Deferred Interrupt Processing）**。当某个外设（如 SPI/I2C DMA、UART 接收）触发中断时，中断服务程序仅清除硬件标志，然后通过释放二值信号量来唤醒一个专门的后台任务来处理数据。

### 1.1 传统信号量 vs. 任务通知 API 对等关系

| 传统信号量 API | 任务通知替代 API | 底层行为模式 |
| :--- | :--- | :--- |
| `xSemaphoreGiveFromISR( xSem, &pxWoken )` | `vTaskNotifyGiveIndexedFromISR( xTask, uxIndex, &pxWoken )` | 目标通道通知值自增 1，状态标记为 RECEIVED |
| `xSemaphoreTake( xSem, xTicksToWait )` | `ulTaskNotifyTakeIndexed( uxIndex, pdTRUE, xTicksToWait )` | 退出时强制清零通知值（`pdTRUE` 对应二值特征） |

### 1.2 生产级实战：SPI DMA 发送完毕同步

以下是一个完整的 SPI 外设 DMA 发送完毕同步的代码结构。该例子演示了如何使用任务通知的通道 0 替代原有的二值信号量：

```c
#include "FreeRTOS.h"
#include "task.h"

/* 外部硬件相关定义（模拟 STM32 HAL 库结构） */
typedef struct {
    int dummy;
} SPI_HandleTypeDef;
extern SPI_HandleTypeDef hspi1;
extern void HAL_SPI_Transmit_DMA(SPI_HandleTypeDef *hspi, uint8_t *pData, uint16_t Size);
extern void SPI_PostProcess(void);

/* 声明任务句柄 */
static TaskHandle_t xSPITaskHandle = NULL;

/**
 * @brief SPI DMA 发送完成中断回调函数 (ISR)
 */
void SPI1_DMA_TX_Complete_IRQHandler( void )
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    /* 确保目标任务句柄有效 */
    if( xSPITaskHandle != NULL )
    {
        /* 
         * 使用任务通知替代 xSemaphoreGiveFromISR()。
         * vTaskNotifyGiveIndexedFromISR 会将目标通道的通知值加 1（即 0 -> 1），
         * 并将状态更新为 RECEIVED，随后将任务移入就绪列表。
         */
        vTaskNotifyGiveIndexedFromISR( 
            xSPITaskHandle, 
            0,                             /* 使用通道索引 0 */
            &xHigherPriorityTaskWoken      /* 指向检测是否需要上下文切换的变量 */
        );

        /* 退出中断前进行任务抢占调度 */
        portYIELD_FROM_ISR( xHigherPriorityTaskWoken );
    }
}

/**
 * @brief SPI 数据发送管理任务
 */
void vSPITask( void *pvParameters )
{
    ( void ) pvParameters;
    uint8_t g_tx_buffer[256] = {0};

    /* 保存当前任务句柄，以便中断服务程序获取 */
    xSPITaskHandle = xTaskGetCurrentTaskHandle();

    for( ;; )
    {
        /* 启动硬件 SPI DMA 异步发送 */
        HAL_SPI_Transmit_DMA( &hspi1, g_tx_buffer, 256 );

        /* 
         * 阻塞等待 DMA 传输完毕的通知，替代传统的 xSemaphoreTake()。
         * 参数 2 设为 pdTRUE：表示函数在收到通知退出时，会直接将该通道的通知值强制清零（Reset to 0）。
         * 这完全契合“二值信号量”的特征（即无论发送端在等待期间 Give 了多少次，消费一次后即重置为 0）。
         */
        uint32_t ulCount = ulTaskNotifyTakeIndexed( 
            0,                             /* 监听通道索引 0 */
            pdTRUE,                        /* 退出时清零（二值模式） */
            portMAX_DELAY                  /* 无限期等待，直到收到通知 */
        );

        if( ulCount > 0 )
        {
            /* DMA 发送成功完成，在任务级执行复杂的数据后处理 */
            SPI_PostProcess();
        }
    }
}
```

---

## 2. 替代计数信号量：资源计数与事件累积

计数信号量通常用于两种场景：
1. **事件计数**：当发生高频外部事件（如外部脉冲计数）时，中断向任务发送信号，任务可能来不及立即处理。计数信号量能够记录“发生了多少次事件”，任务则循环消费，直到计数归零。
2. **资源管理**：管理有限的系统资源（如可用内存块数量）。

### 2.1 传统计数信号量 vs. 任务通知 API 对等关系

| 传统信号量 API | 任务通知替代 API | 底层行为模式 |
| :--- | :--- | :--- |
| `xSemaphoreGiveFromISR( xSem, &pxWoken )` | `xTaskNotifyIndexedFromISR( xTask, uxIndex, 0, eIncrement, &pxWoken )` | 通知值进行自增 1 操作 |
| `xSemaphoreTake( xSem, xTicksToWait )` | `ulTaskNotifyTakeIndexed( uxIndex, pdFALSE, xTicksToWait )` | 退出时若计数大于 0 则递减 1（`pdFALSE` 对应计数特征） |

### 2.2 生产级实战：高频脉冲计数消费

以下是利用通道 1 替代计数信号量，对高频硬件中断触发的脉冲进行计数和累积消费的实现：

```c
#include "FreeRTOS.h"
#include "task.h"

extern void ProcessSinglePulse(void);

/* 脉冲消费处理任务的句柄 */
static TaskHandle_t xPulseConsumerTaskHandle = NULL;

/**
 * @brief 外部 GPIO 引脚双边沿脉冲中断服务程序
 */
void ExternalPulse_IRQHandler( void )
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    if( xPulseConsumerTaskHandle != NULL )
    {
        /* 
         * 替代 xSemaphoreGiveFromISR() 用于计数。
         * 使用 eIncrement 动作模式，每次中断触发时，目标任务的通知值自动累加 1。
         */
        xTaskNotifyIndexedFromISR( 
            xPulseConsumerTaskHandle, 
            1,                             /* 使用通道索引 1 */
            0,                             /* eIncrement 模式下此值无效 */
            eIncrement,                    /* 累加动作 */
            &xHigherPriorityTaskWoken 
        );

        /* 触发上下文切换 */
        portYIELD_FROM_ISR( xHigherPriorityTaskWoken );
    }
}

/**
 * @brief 脉冲数据处理消费任务
 */
void vPulseConsumerTask( void *pvParameters )
{
    ( void ) pvParameters;
    
    /* 记录本任务的句柄 */
    xPulseConsumerTaskHandle = xTaskGetCurrentTaskHandle();

    for( ;; )
    {
        /* 
         * 阻塞等待脉冲事件。
         * 参数 2 设为 pdFALSE：表示函数退出时，如果通知值大于 0，则仅将该值减 1，而不是清零。
         * 这与计数信号量从获取资源时自减 1 的逻辑完全一致。
         * 返回值为减 1 之前的原始通知值。
         */
        uint32_t ulCount = ulTaskNotifyTakeIndexed( 
            1,                             /* 监听通道索引 1 */
            pdFALSE,                       /* 每次退出仅减 1（计数模式） */
            portMAX_DELAY                  /* 无限阻塞等待 */
        );

        /* 
         * ulCount 是消费前的计数值。如果它大于 0，说明存在积压的脉冲事件需要处理。
         * 注意：由于 ulTaskNotifyTakeIndexed 会自动将通知值减 1，
         * 只要循环回到此函数，就会继续处理下一个积压的脉冲，直到通知值递减为 0 后任务再次进入阻塞。
         */
        if( ulCount > 0 )
        {
            /* 消费处理单个脉冲 */
            ProcessSinglePulse();
        }
    }
}
```

---

## 3. 替代事件组：轻量级多事件位同步

传统的 FreeRTOS 事件组（Event Groups）非常强大，它允许任务通过按位操作（`AND` / `OR`）来等待多个事件标志的组合状态。然而，事件组在内核中设计相对较重，涉及多任务阻塞列表和复杂的唤醒匹配逻辑。

如果我们只需要**“多对一”的同步关系**（即多个任务/中断负责设置事件标志，但**只有一个**确定的任务负责监听并处理这些事件），那么任务通知完全可以通过 `eSetBits` 动作模式替代事件组。

### 3.1 传统事件组 vs. 任务通知 API 对等关系

| 传统事件组 API | 任务通知替代 API | 底层行为模式 |
| :--- | :--- | :--- |
| `xEventGroupSetBitsFromISR( xEvent, uxBits, &pxWoken )` | `xTaskNotifyIndexedFromISR( xTask, uxIndex, uxBits, eSetBits, &pxWoken )` | 通知值与 `uxBits` 进行按位或运算 |
| `xEventGroupWaitBits( xEvent, uxBits, xClear, xWaitAll, xTicks )` | `xTaskNotifyWaitIndexed( uxIndex, 0, uxClearMask, &uxVal, xTicks )` | 阻塞等待，可配置退出时清除哪些位，只支持“任意位置位即唤醒” |

### 3.2 生产级实战：多事件混合监控系统

以下代码演示了如何使用任务通知通道 2，收集来自串口中断、CAN 中断以及系统异常标志，并进行统一处理：

```c
#include "FreeRTOS.h"
#include "task.h"

/* 定义事件位掩码（32 位整数中的不同 Bit） */
#define EVENT_FLAG_USART_RX  ( 1UL << 0 )   /* 串口接收到新数据包 */
#define EVENT_FLAG_CAN_RX    ( 1UL << 1 )   /* CAN 总线接收到新数据包 */
#define EVENT_FLAG_SYS_ERROR ( 1UL << 31 )  /* 系统硬件异常指示位 */

extern void HandleUsartEvent(void);
extern void HandleCanEvent(void);
extern void HandleErrorEvent(void);

/* 监控处理任务的句柄 */
static TaskHandle_t xSystemMonitorTaskHandle = NULL;

/**
 * @brief 串口中断服务函数 (ISR)
 */
void USART_Rx_IRQHandler( void )
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    if( xSystemMonitorTaskHandle != NULL )
    {
        /* 
         * 使用 eSetBits 模式，向监控任务发送“串口数据到达”事件标志。
         * 这相当于向事件组设置位 EVENT_FLAG_USART_RX。
         */
        xTaskNotifyIndexedFromISR( 
            xSystemMonitorTaskHandle, 
            2,                             /* 使用通道索引 2 */
            EVENT_FLAG_USART_RX,           /* 要设置的事件位 */
            eSetBits,                      /* 动作模式：按位或 */
            &xHigherPriorityTaskWoken 
        );

        portYIELD_FROM_ISR( xHigherPriorityTaskWoken );
    }
}

/**
 * @brief 系统监控与事件分发任务
 */
void vSystemMonitorTask( void *pvParameters )
{
    ( void ) pvParameters;
    uint32_t ulNotifiedValue = 0;

    /* 记录任务句柄 */
    xSystemMonitorTaskHandle = xTaskGetCurrentTaskHandle();

    for( ;; )
    {
        /* 
         * 阻塞等待任何一个事件标志置位。
         * 参数 2 (ulBitsToClearOnEntry) = 0x00：进入时不清除任何标志，防止漏掉历史事件。
         * 参数 3 (ulBitsToClearOnExit) = 0xFFFFFFFF：退出时清空所有 32 位标志。
         *                                           这意味着我们一次性把所有已到达的事件“打包消费”。
         * 参数 4 (pulNotificationValue) = &ulNotifiedValue：将收到通知时的 32 位完整标志值拷贝出来。
         */
        BaseType_t xResult = xTaskNotifyWaitIndexed(
            2,                             /* 监听通道索引 2 */
            0x00,                          /* Entry 时不清除 */
            0xFFFFFFFF,                    /* Exit 时彻底清零，表示已消费 */
            &ulNotifiedValue,              /* 拷贝输出的事件位 */
            portMAX_DELAY                  /* 无限期等待 */
        );

        if( xResult == pdTRUE )
        {
            /* 
             * 解析已到达的事件。由于退出时已清零，
             * 我们必须依据拷贝出的 ulNotifiedValue 进行按位检查。
             */
            if( ( ulNotifiedValue & EVENT_FLAG_USART_RX ) != 0 )
            {
                HandleUsartEvent();
            }
            if( ( ulNotifiedValue & EVENT_FLAG_CAN_RX ) != 0 )
            {
                HandleCanEvent();
            }
            if( ( ulNotifiedValue & EVENT_FLAG_SYS_ERROR ) != 0 )
            {
                HandleErrorEvent();
            }
        }
    }
}
```

---

## 4. 替代轻量级单字邮箱 (Mailbox)

在 RTOS 设计中，很多时候我们使用消息队列（Message Queue）并不是为了缓冲很多数据，而仅仅是为了**“传递一个 32 位的指针”**或**“传递一个 32 位的整型数值”**。这在设计模式中被称为**单字邮箱**。

通过 `eSetValueWithOverwrite`（强制覆盖旧数据）或 `eSetValueWithoutOverwrite`（保护旧数据，类似于单容量队列），任务通知能以最极致的性能承担邮箱的工作。

### 4.1 生产级实战：温湿度数据指针共享与分发

以下例子展示了温湿度传感器采集任务如何将采集到的最新数据结构体的地址指针，作为 32 位无符号整数直接投递到显示任务的通道 3 中：

```c
#include "FreeRTOS.h"
#include "task.h"

/* 温湿度数据结构体 */
typedef struct
{
    float temperature;
    float humidity;
} SensorData_t;

/* 全局唯一的共享数据缓冲区（为了保证指针指向的数据安全，通常需要互斥或采用只读副本模式） */
static SensorData_t g_shared_sensor_data;

extern float ReadTemperature(void);
extern float ReadHumidity(void);
extern void DisplayData(float temp, float hum);

/* 显示更新任务句柄 */
static TaskHandle_t xDisplayTaskHandle = NULL;

/**
 * @brief 传感器数据采集任务 (发送端)
 */
void vSensorCollectTask( void *pvParameters )
{
    ( void ) pvParameters;

    for( ;; )
    {
        /* 采集物理传感器数据并写入全局变量 */
        g_shared_sensor_data.temperature = ReadTemperature();
        g_shared_sensor_data.humidity = ReadHumidity();

        if( xDisplayTaskHandle != NULL )
        {
            /* 
             * 将结构体指针直接作为通知值发送给显示任务。
             * 指针本质上是 32 位（或 64 位，此处假设为 32 位 MCU 架构）地址，可强转为 uint32_t。
             * 
             * 使用 eSetValueWithOverwrite 模式：
             * 如果显示任务由于 CPU 负载过重来不及处理上一帧数据，
             * 新的指针值会直接覆盖旧指针，确保显示任务苏醒时渲染的是最新采集的数值。
             */
            xTaskNotifyIndexed( 
                xDisplayTaskHandle, 
                3,                                 /* 使用通道索引 3 */
                ( uint32_t )&g_shared_sensor_data, /* 发送的数据值（强转结构体指针） */
                eSetValueWithOverwrite             /* 动作模式：覆盖写入 */
            );
        }

        /* 限制采集频率为每 500ms 一次 */
        vTaskDelay( pdMS_TO_TICKS( 500 ) );
    }
}

/**
 * @brief 显示渲染任务 (接收端)
 */
void vDisplayTask( void *pvParameters )
{
    ( void ) pvParameters;
    uint32_t ulReceivedValue = 0;

    /* 记录本任务的句柄 */
    xDisplayTaskHandle = xTaskGetCurrentTaskHandle();

    for( ;; )
    {
        /* 
         * 阻塞等待通道 3 的通知邮箱。
         * 退出时清除全部（0xFFFFFFFF），以确保下一次必须处于新值等待中。
         */
        BaseType_t xResult = xTaskNotifyWaitIndexed(
            3,                             /* 监听通道索引 3 */
            0x00,                          /* Entry 时不清除 */
            0xFFFFFFFF,                    /* Exit 时清零，完成对该邮箱值的消费 */
            &ulReceivedValue,              /* 拷贝输出邮箱中的 32 位值 */
            portMAX_DELAY                  /* 无限等待 */
        );

        if( xResult == pdTRUE )
        {
            /* 将接收到的 32 位值还原强转为结构体指针 */
            SensorData_t *pxData = ( SensorData_t * )ulReceivedValue;
            
            /* 提取指针指向的数据，执行硬件屏幕渲染 */
            DisplayData( pxData->temperature, pxData->humidity );
        }
    }
}
```
