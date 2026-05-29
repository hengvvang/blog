# 健壮驱动设计与防死锁策略

在工业现场及消费电子应用中，一个成熟的 I2C 驱动必须解决两大问题：**多外设实例的优雅扩展** 与 **极极端异常情况下的自恢复能力（防卡死）**。本章将详细讲解如何设计一个面向对象的多通道 I2C 驱动框架，引入非阻塞超时判定，并与实时操作系统（FreeRTOS）无缝融合，提供生产级完整源码及 EEPROM 设备驱动适配实例。

---

## 1. 健壮驱动层架构设计

为了降低系统耦合度，我们需要将驱动分为三层：
1. **底层物理 GPIO 控制层**：直接与 STM32 硬件引脚、寄存器和 DWT 高精度延时打交道，仅负责最基础的 I2C 时序元动作（Start、Stop、WriteByte、ReadByte）。
2. **总线驱动管理层**：封装面向对象的多实例句柄（Handle），引入临界区互斥锁（Mutex）、总线自愈恢复（Bus Recovery）以及全局超时退出机制。
3. **设备协议层**：基于总线驱动管理层提供的标准 Read/Write 接口，编写具体设备（如 EEPROM、传感器、显示屏）的协议逻辑。

```mermaid
graph TD
    subgraph 设备协议层 (Device Protocol)
        EEPROM[AT24C02 驱动] -->|读写 API| Bus_Mgr[I2C 总线管理接口]
        Sensor[MPU6050 驱动] -->|读写 API| Bus_Mgr
    end

    subgraph 总线驱动管理层 (Bus Driver Manager)
        Bus_Mgr -->|互斥锁保护 Mutex| Mutex_Guard[并发控制]
        Bus_Mgr -->|句柄实例 Handle| Handle_Ctrl[通道配置/状态监测]
        Bus_Mgr -->|自动总线自愈| Recovery_Logic[总线死锁恢复]
    end

    subgraph 物理 GPIO 控制层 (Physical GPIO & Timing)
        Mutex_Guard -->|原子引脚操作 BSRR| Pin_Ops[GPIO 快速控制]
        Handle_Ctrl -->|DWT 精确时序延时| Delay_Ctrl[时钟拉伸检测]
    end
```

---

## 2. 软件设计要点说明

### 面向对象多实例句柄
为了在一套驱动下同时支持任意多路软件 I2C 总线，我们定义 `SoftI2C_HandleTypeDef` 句柄。它包含了 GPIO 配置、互斥信号量、当前总线状态及错误码，避免了代码的重复编写：
```c
typedef struct {
    SoftI2C_Configt GPIO_Config;    // 物理层引脚与时间常数配置
    uint32_t ErrorCode;             // 记录上一次通信的错误状态
    #if SOFT_I2C_USE_FREERTOS
    SemaphoreHandle_t Mutex;        // FreeRTOS 互斥量，保证多任务并发安全
    #endif
} SoftI2C_HandleTypeDef;
```

### 非阻塞超时设计（Non-blocking Timeout）
在前面的时序模拟中，我们提到“时钟拉伸（Clock Stretching）”需要反读 SCL 状态。如果在等待 SCL 变高时，从机坏了或者硬件断路，SCL 永远为低电平。如果用死循环 `while(READ_SCL == 0);` 就会使整个系统看门狗复位或主线程挂死。
本驱动中，所有等待循环均引入基于 DWT 计数器或循环计数上限的**自减超时机制**。一旦超时，立即强行中断当前传输，恢复总线并返回超时错误。

### 线程安全与互斥锁
在多任务系统（如 FreeRTOS）中，任务 A（例如传感器读取）和任务 B（例如日志写入 EEPROM）可能在不同的优先级下运行，并且共用同一组 GPIO 软件 I2C 引脚。如果在任务 A 正在发送地址时，系统发生任务调度切换到任务 B，任务 B 也对该 I2C 执行读写，总线电平就会彻底交织混乱。
我们使用 FreeRTOS 的**互斥量（Mutex）**来确保总线排他性访问。互斥量支持优先级继承，可以完美解决优先级翻转问题。

---

## 3. 生产级多通道软件 I2C 驱动完整源码

### 1. 头文件 `soft_i2c.h`

```c
#ifndef __SOFT_I2C_H
#define __SOFT_I2C_H

#include "stm32f4xx_hal.h" // 可根据具体 MCU 平台修改为 f1xx / g0xx / l4xx 等

// 是否启用 FreeRTOS 支持
#define SOFT_I2C_USE_FREERTOS   1

#if SOFT_I2C_USE_FREERTOS
#include "FreeRTOS.h"
#include "semphr.h"
#endif

/* ==================== 错误码定义 ==================== */
#define SOFT_I2C_ERROR_NONE      0x00000000U
#define SOFT_I2C_ERROR_TIMEOUT   0x00000001U
#define SOFT_I2C_ERROR_NACK      0x00000002U
#define SOFT_I2C_ERROR_BUSY      0x00000004U

/* ==================== 物理配置结构体 ==================== */
typedef struct {
    GPIO_TypeDef *SCL_Port;
    uint16_t SCL_Pin;
    GPIO_TypeDef *SDA_Port;
    uint16_t SDA_Pin;
    uint32_t Delay_us;      // I2C 周期半延时（通常 2~5us）
    uint32_t Timeout;       // SCL 时钟拉伸与等待响应的最大循环次数
} SoftI2C_Configt;

/* ==================== 多实例管理句柄 ==================== */
typedef struct {
    SoftI2C_Configt GPIO_Config;
    uint32_t ErrorCode;
    #if SOFT_I2C_USE_FREERTOS
    SemaphoreHandle_t Mutex;
    StaticSemaphore_t MutexBuffer; // 静态分配信号量内存
    #endif
} SoftI2C_HandleTypeDef;

/* ==================== API 函数声明 ==================== */
HAL_StatusTypeDef SoftI2C_Init(SoftI2C_HandleTypeDef *hi2c);
HAL_StatusTypeDef SoftI2C_RecoverBus(const SoftI2C_Configt *config);

HAL_StatusTypeDef SoftI2C_Master_Transmit(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                          uint8_t *pData, uint16_t Size, uint32_t Timeout);
                                          
HAL_StatusTypeDef SoftI2C_Master_Receive(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                         uint8_t *pData, uint16_t Size, uint32_t Timeout);

HAL_StatusTypeDef SoftI2C_Mem_Write(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                    uint16_t MemAddress, uint16_t MemAddSize, 
                                    uint8_t *pData, uint16_t Size, uint32_t Timeout);

HAL_StatusTypeDef SoftI2C_Mem_Read(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                   uint16_t MemAddress, uint16_t MemAddSize, 
                                   uint8_t *pData, uint16_t Size, uint32_t Timeout);

#endif /* __SOFT_I2C_H */
```

### 2. 源文件 `soft_i2c.c`

```c
#include "soft_i2c.h"

/* ==================== 1. 高精度 DWT 延时 & 快速引脚控制 ==================== */

static inline void DWT_Init(void) {
    if (!(CoreDebug->DEMCR & CoreDebug_DEMCR_TRCENA_Msk)) {
        CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    }
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

static inline void Delay_us(uint32_t us) {
    uint32_t start_tick = DWT->CYCCNT;
    uint32_t delay_ticks = us * (SystemCoreClock / 1000000);
    while ((DWT->CYCCNT - start_tick) < delay_ticks);
}

#define SDA_HIGH(cfg)   ((cfg)->SDA_Port->BSRR = (cfg)->SDA_Pin)
#define SDA_LOW(cfg)    ((cfg)->SDA_Port->BSRR = ((uint32_t)(cfg)->SDA_Pin << 16))
#define SCL_HIGH(cfg)   ((cfg)->SCL_Port->BSRR = (cfg)->SCL_Pin)
#define SCL_LOW(cfg)    ((cfg)->SCL_Port->BSRR = ((uint32_t)(cfg)->SCL_Pin << 16))

#define READ_SDA(cfg)   (((cfg)->SDA_Port->IDR & (cfg)->SDA_Pin) ? 1 : 0)
#define READ_SCL(cfg)   (((cfg)->SCL_Port->IDR & (cfg)->SCL_Pin) ? 1 : 0)

/* ==================== 2. 总线互斥保护机制 ==================== */

static inline void SoftI2C_Lock(SoftI2C_HandleTypeDef *hi2c) {
#if SOFT_I2C_USE_FREERTOS
    if (hi2c->Mutex != NULL) {
        xSemaphoreTake(hi2c->Mutex, portMAX_DELAY);
    }
#endif
}

static inline void SoftI2C_Unlock(SoftI2C_HandleTypeDef *hi2c) {
#if SOFT_I2C_USE_FREERTOS
    if (hi2c->Mutex != NULL) {
        xSemaphoreGive(hi2c->Mutex);
    }
#endif
}

/* ==================== 3. 基础时序协议元动作 ==================== */

static HAL_StatusTypeDef I2C_Start(const SoftI2C_Configt *cfg) {
    SDA_HIGH(cfg);
    SCL_HIGH(cfg);
    Delay_us(cfg->Delay_us);

    // 时钟拉伸超时检测
    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0) {
        if (--timeout == 0) return HAL_TIMEOUT;
        Delay_us(1);
    }

    if (READ_SDA(cfg) == 0) {
        return HAL_ERROR; // SDA 物理异常，被强行拉低
    }

    SDA_LOW(cfg);
    Delay_us(cfg->Delay_us);
    SCL_LOW(cfg);
    Delay_us(cfg->Delay_us);
    return HAL_OK;
}

static void I2C_Stop(const SoftI2C_Configt *cfg) {
    SDA_LOW(cfg);
    Delay_us(cfg->Delay_us);
    SCL_HIGH(cfg);
    
    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0 && timeout > 0) {
        timeout--;
        Delay_us(1);
    }
    Delay_us(cfg->Delay_us);
    SDA_HIGH(cfg);
    Delay_us(cfg->Delay_us);
}

static HAL_StatusTypeDef I2C_WriteByte(const SoftI2C_Configt *cfg, uint8_t byte) {
    for (uint8_t i = 0; i < 8; i++) {
        if (byte & 0x80) SDA_HIGH(cfg);
        else SDA_LOW(cfg);
        byte <<= 1;
        Delay_us(cfg->Delay_us);

        SCL_HIGH(cfg);
        uint32_t timeout = cfg->Timeout;
        while (READ_SCL(cfg) == 0) {
            if (--timeout == 0) return HAL_TIMEOUT;
            Delay_us(1);
        }
        Delay_us(cfg->Delay_us);
        SCL_LOW(cfg);
    }

    // 读取应答位
    SDA_HIGH(cfg);
    Delay_us(cfg->Delay_us);
    SCL_HIGH(cfg);

    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0) {
        if (--timeout == 0) return HAL_TIMEOUT;
        Delay_us(1);
    }

    uint8_t ack = READ_SDA(cfg);
    Delay_us(cfg->Delay_us);
    SCL_LOW(cfg);
    Delay_us(cfg->Delay_us);

    return (ack == 0) ? HAL_OK : HAL_ERROR;
}

static uint8_t I2C_ReadByte(const SoftI2C_Configt *cfg, uint8_t ack_action) {
    uint8_t byte = 0;
    SDA_HIGH(cfg);
    Delay_us(cfg->Delay_us);

    for (uint8_t i = 0; i < 8; i++) {
        SCL_HIGH(cfg);
        uint32_t timeout = cfg->Timeout;
        while (READ_SCL(cfg) == 0 && timeout > 0) {
            timeout--;
            Delay_us(1);
        }
        byte <<= 1;
        if (READ_SDA(cfg)) byte |= 0x01;
        Delay_us(cfg->Delay_us);
        SCL_LOW(cfg);
        Delay_us(cfg->Delay_us);
    }

    if (ack_action == 0) SDA_LOW(cfg); // ACK
    else SDA_HIGH(cfg);                // NACK
    
    Delay_us(cfg->Delay_us);
    SCL_HIGH(cfg);
    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0 && timeout > 0) {
        timeout--;
        Delay_us(1);
    }
    Delay_us(cfg->Delay_us);
    SCL_LOW(cfg);
    SDA_HIGH(cfg);
    Delay_us(cfg->Delay_us);

    return byte;
}

/* ==================== 4. 初始化与恢复接口 ==================== */

HAL_StatusTypeDef SoftI2C_Init(SoftI2C_HandleTypeDef *hi2c) {
    DWT_Init();
    hi2c->ErrorCode = SOFT_I2C_ERROR_NONE;

#if SOFT_I2C_USE_FREERTOS
    if (hi2c->Mutex == NULL) {
        hi2c->Mutex = xSemaphoreCreateMutexStatic(&(hi2c->MutexBuffer));
    }
#endif

    // 配置 SCL 与 SDA 引脚为开漏输出模式
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    GPIO_InitStruct.Pin = hi2c->GPIO_Config.SCL_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(hi2c->GPIO_Config.SCL_Port, &GPIO_InitStruct);

    GPIO_InitStruct.Pin = hi2c->GPIO_Config.SDA_Pin;
    HAL_GPIO_Init(hi2c->GPIO_Config.SDA_Port, &GPIO_InitStruct);

    // 默认释放总线
    SDA_HIGH(&(hi2c->GPIO_Config));
    SCL_HIGH(&(hi2c->GPIO_Config));

    // 检测总线死锁并尝试恢复
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0) {
        if (SoftI2C_RecoverBus(&(hi2c->GPIO_Config)) != HAL_OK) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_BUSY;
            return HAL_ERROR;
        }
    }

    return HAL_OK;
}

/* 总线恢复逻辑 (代码参见第 2 章物理恢复详解) */
HAL_StatusTypeDef SoftI2C_RecoverBus(const SoftI2C_Configt *config) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    uint8_t clocks = 9;
    uint8_t sda_state = 1;

    GPIO_InitStruct.Pin = config->SDA_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);

    GPIO_InitStruct.Pin = config->SCL_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(config->SCL_Port, &GPIO_InitStruct);
    HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
    HAL_Delay(1);

    if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_SET) {
        // 总线已自动复位为高，无需继续恢复
        GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
        HAL_GPIO_Init(config->SCL_Port, &GPIO_InitStruct);
        HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);
        return HAL_OK;
    }

    for (uint8_t i = 0; i < clocks; i++) {
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_RESET);
        HAL_Delay(1); 
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
        HAL_Delay(1);

        if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_SET) {
            sda_state = 1;
            break;
        }
        sda_state = 0;
    }

    if (sda_state == 1) {
        GPIO_InitStruct.Pin = config->SDA_Pin;
        GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
        HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);

        HAL_GPIO_WritePin(config->SDA_Port, config->SDA_Pin, GPIO_PIN_RESET);
        HAL_Delay(1);
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_RESET);
        HAL_Delay(1);
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
        HAL_Delay(1);
        HAL_GPIO_WritePin(config->SDA_Port, config->SDA_Pin, GPIO_PIN_SET);
        HAL_Delay(1);
    }

    // 重新恢复开漏输出配置
    GPIO_InitStruct.Pin = config->SCL_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(config->SCL_Port, &GPIO_InitStruct);
    GPIO_InitStruct.Pin = config->SDA_Pin;
    HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);

    if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_RESET) {
        return HAL_ERROR;
    }
    return HAL_OK;
}

/* ==================== 5. 主机数据收发高级接口 ==================== */

HAL_StatusTypeDef SoftI2C_Master_Transmit(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                          uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    HAL_StatusTypeDef status = HAL_OK;
    uint32_t tickstart = HAL_GetTick();

    SoftI2C_Lock(hi2c);
    hi2c->ErrorCode = SOFT_I2C_ERROR_NONE;

    // 1. 发送 START 条件
    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 2. 发送设备写地址 (DevAddress 必须已含最低位写标志，即 DevAddress & 0xFE)
    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress & 0xFE);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 3. 循环发送缓冲区数据
    for (uint16_t i = 0; i < Size; i++) {
        // 超时检查
        if ((HAL_GetTick() - tickstart) > Timeout) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            status = HAL_TIMEOUT;
            break;
        }

        status = I2C_WriteByte(&(hi2c->GPIO_Config), pData[i]);
        if (status != HAL_OK) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
            break;
        }
    }

    // 4. 发送 STOP 信号
    I2C_Stop(&(hi2c->GPIO_Config));
    
    // 如果总线在结束后依然死锁拉低，主动触发恢复逻辑
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0) {
        SoftI2C_RecoverBus(&(hi2c->GPIO_Config));
    }

    SoftI2C_Unlock(hi2c);
    return status;
}

HAL_StatusTypeDef SoftI2C_Master_Receive(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                         uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    HAL_StatusTypeDef status = HAL_OK;
    uint32_t tickstart = HAL_GetTick();

    SoftI2C_Lock(hi2c);
    hi2c->ErrorCode = SOFT_I2C_ERROR_NONE;

    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 发送设备读地址 (最低位置 1)
    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress | 0x01);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    for (uint16_t i = 0; i < Size; i++) {
        if ((HAL_GetTick() - tickstart) > Timeout) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            status = HAL_TIMEOUT;
            break;
        }

        // 读最后一个字节时发送 NACK，其余发送 ACK
        uint8_t ack_action = (i == (Size - 1)) ? 1 : 0;
        pData[i] = I2C_ReadByte(&(hi2c->GPIO_Config), ack_action);
    }

    I2C_Stop(&(hi2c->GPIO_Config));
    
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0) {
        SoftI2C_RecoverBus(&(hi2c->GPIO_Config));
    }

    SoftI2C_Unlock(hi2c);
    return status;
}

/* ==================== 6. 寄存器寻址操作接口 ==================== */

HAL_StatusTypeDef SoftI2C_Mem_Write(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                    uint16_t MemAddress, uint16_t MemAddSize, 
                                    uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    HAL_StatusTypeDef status = HAL_OK;
    uint32_t tickstart = HAL_GetTick();

    SoftI2C_Lock(hi2c);
    hi2c->ErrorCode = SOFT_I2C_ERROR_NONE;

    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress & 0xFE);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 发送内存物理寄存器地址 (支持 8 位和 16 位地址)
    if (MemAddSize == I2C_MEMADD_SIZE_16BIT) {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)((MemAddress >> 8) & 0xFF));
        if (status == HAL_OK) {
            status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFF));
        }
    } else {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFF));
    }

    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 循环写入数据缓冲
    for (uint16_t i = 0; i < Size; i++) {
        if ((HAL_GetTick() - tickstart) > Timeout) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            status = HAL_TIMEOUT;
            break;
        }

        status = I2C_WriteByte(&(hi2c->GPIO_Config), pData[i]);
        if (status != HAL_OK) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
            break;
        }
    }

    I2C_Stop(&(hi2c->GPIO_Config));
    
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0) {
        SoftI2C_RecoverBus(&(hi2c->GPIO_Config));
    }

    SoftI2C_Unlock(hi2c);
    return status;
}

HAL_StatusTypeDef SoftI2C_Mem_Read(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                   uint16_t MemAddress, uint16_t MemAddSize, 
                                   uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    HAL_StatusTypeDef status = HAL_OK;
    uint32_t tickstart = HAL_GetTick();

    SoftI2C_Lock(hi2c);
    hi2c->ErrorCode = SOFT_I2C_ERROR_NONE;

    // A. 写阶段：发送器件地址与要访问的寄存器地址
    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress & 0xFE);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    if (MemAddSize == I2C_MEMADD_SIZE_16BIT) {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)((MemAddress >> 8) & 0xFF));
        if (status == HAL_OK) {
            status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFF));
        }
    } else {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFF));
    }

    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // B. 重起始阶段：发送 Re-Start 信号读取数据
    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress | 0x01);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // C. 循环接收数据
    for (uint16_t i = 0; i < Size; i++) {
        if ((HAL_GetTick() - tickstart) > Timeout) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            status = HAL_TIMEOUT;
            break;
        }

        uint8_t ack_action = (i == (Size - 1)) ? 1 : 0;
        pData[i] = I2C_ReadByte(&(hi2c->GPIO_Config), ack_action);
    }

    I2C_Stop(&(hi2c->GPIO_Config));
    
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0) {
        SoftI2C_RecoverBus(&(hi2c->GPIO_Config));
    }

    SoftI2C_Unlock(hi2c);
    return status;
}
```

---

## 4. 上层设备驱动适配示例：AT24C02 读写

接下来，我们以经典的 AT24C02 EEPROM 为例，演示如何在应用中实例化我们的软件 I2C 句柄并执行线程安全的寄存器读写。

### 1. 实例化句柄配置

```c
#include "soft_i2c.h"

// 实例化一个软件 I2C 通道，对应物理引脚 GPIOB Pin 6 (SCL) 与 Pin 7 (SDA)
SoftI2C_HandleTypeDef hsoft_i2c1 = {
    .GPIO_Config = {
        .SCL_Port = GPIOB,
        .SCL_Pin = GPIO_PIN_6,
        .SDA_Port = GPIOB,
        .SDA_Pin = GPIO_PIN_7,
        .Delay_us = 4,          // 4us 延时，时钟频率约为 100kHz
        .Timeout = 1000         // 时钟拉伸与 ACK 检测的最大循环次数
    }
};
```

### 2. AT24C02 通信代码封装

```c
#define AT24C02_DEV_ADDR   0xA0 // 设备 8-bit 地址

/**
 * @brief  向 AT24C02 写入单个字节
 * @param  reg_addr: 写入的 EEPROM 内存地址 (0~255)
 * @param  data: 写入的数据字节
 * @retval HAL_StatusTypeDef
 */
HAL_StatusTypeDef AT24C02_WriteByte(uint8_t reg_addr, uint8_t data) {
    HAL_StatusTypeDef status;
    uint8_t temp_data = data;
    
    // 调用 Mem_Write，1 字节寄存器寻址，超时时间为 100ms
    status = SoftI2C_Mem_Write(&hsoft_i2c1, AT24C02_DEV_ADDR, reg_addr, 
                               I2C_MEMADD_SIZE_8BIT, &temp_data, 1, 100);
                               
    // AT24C02 写入后需要约 5ms 的内部物理写入延迟 (Twr)
    if (status == HAL_OK) {
        #if SOFT_I2C_USE_FREERTOS
        vTaskDelay(pdMS_TO_TICKS(5)); 
        #else
        HAL_Delay(5);
        #endif
    }
    return status;
}

/**
 * @brief  从 AT24C02 读取多个连续字节
 * @param  reg_addr: 开始读取的起始地址
 * @param  pBuffer: 存储读取数据的缓冲区指针
 * @param  size: 要读取的字节数量
 * @retval HAL_StatusTypeDef
 */
HAL_StatusTypeDef AT24C02_ReadBuffer(uint8_t reg_addr, uint8_t *pBuffer, uint16_t size) {
    // 调用 Mem_Read，超时时间为 100ms
    return SoftI2C_Mem_Read(&hsoft_i2c1, AT24C02_DEV_ADDR, reg_addr, 
                            I2C_MEMADD_SIZE_8BIT, pBuffer, size, 100);
}
```

### 3. 多任务并发测试任务

在 FreeRTOS 环境下，我们可以放心地在多个任务中并发读写此设备。互斥锁（Mutex）会确保在读写期间，SDA/SCL 上的时序完全完整，互不冲突：

```c
#if SOFT_I2C_USE_FREERTOS
void StartTask_Sensor(void const * argument) {
    uint8_t read_val = 0;
    for(;;) {
        // 读取任务并发访问
        if (AT24C02_ReadBuffer(0x10, &read_val, 1) == HAL_OK) {
            printf("Sensor Task: Read address 0x10 value: 0x%02X\r\n", read_val);
        } else {
            printf("Sensor Task: Read Error, Code: 0x%08X\r\n", (unsigned int)hsoft_i2c1.ErrorCode);
        }
        vTaskDelay(pdMS_TO_TICKS(100)); // 挂起 100ms
    }
}

void StartTask_Logger(void const * argument) {
    uint8_t write_val = 0xAA;
    for(;;) {
        // 写入任务并发访问
        if (AT24C02_WriteByte(0x10, write_val) == HAL_OK) {
            printf("Logger Task: Successfully wrote 0xAA to 0x10\r\n");
            write_val = ~write_val; // 反转数值
        } else {
            printf("Logger Task: Write Error, Code: 0x%08X\r\n", (unsigned int)hsoft_i2c1.ErrorCode);
        }
        vTaskDelay(pdMS_TO_TICKS(500)); // 挂起 500ms
    }
}
#endif
```

通过这一层层精良的设计，我们不仅规避了 STM32 硬件 I2C 的芯片级缺陷，还赋予了软件模拟驱动无懈可击的容错性能与高并发安全保证，使其足以在各种工业级应用场景下担此重任。
