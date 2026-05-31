# 第三章：健壮驱动设计与防死锁策略

在工业级高并发嵌入式系统中，I2C 驱动不仅需要处理常规的字节收发，还必须应对从机挂起、时钟拉伸无限阻塞、多任务并发时序冲突等严苛的物理层与系统层异常。本章将详细介绍面向对象的多实例 I2C 驱动架构设计，深入探讨全链路非阻塞超时与 RTOS 线程安全方案，并提供完整的 C 语言源代码及 AT24C02 EEPROM 设备驱动适配实例。

---

## 1. 健壮驱动层架构设计

为了保证软件系统的低耦合性与高可重用性，我们将模拟 I2C 驱动系统划分为三个清晰的软件层：

```
+-----------------------------------------------------------------+
|                    设备协议层 (Device Layer)                    |
|       (如: AT24C02 EEPROM, MPU6050 陀螺仪, SHT30 温湿度传感器)    |
+-----------------------------------------------------------------+
                                |
                                v (标准 Mem_Write / Mem_Read 接口)
+-----------------------------------------------------------------+
|                  总线驱动管理层 (Manager Layer)                  |
|     (多实例 Handle 调度、互斥锁 Mutex 保护、软件超时、总线自愈)     |
+-----------------------------------------------------------------+
                                |
                                v (Start / Stop / WriteByte 底层 API)
+-----------------------------------------------------------------+
|                  物理 GPIO 控制层 (Physical Layer)               |
|            (GPIO 寄存器原子操作 BSRR、DWT 高精度微秒延时)          |
+-----------------------------------------------------------------+
```

1. **物理 GPIO 控制层**：最底层的物理模拟，直接操作 GPIO 端口的 `BSRR` / `IDR` 寄存器，控制高精度的 DWT 时钟周期延时，处理物理时序波形。
2. **总线驱动管理层**：整个驱动的核心逻辑。负责总线资源的分配与加锁（Mutex）、对每次物理读写操作引入超时判定、以及检测到异常时自动调用上一章所实现的 `SoftI2C_RecoverBus` 进行总线物理修复。
3. **设备协议层**：基于总线驱动管理层提供的 `Mem_Write`（物理寄存器寻址写入）、`Mem_Read`（物理寄存器寻址读取）等通用标准 API，编写针对具体器件的功能代码。

---

## 2. 非阻塞超时与自愈状态机

如果驱动程序在等待 SCL 释放或从机应答（ACK）时采用死等语句：
```c
// 工业设计禁忌：死等外部状态
while(READ_SCL(config) == 0); 
```
一旦发生总线物理虚接、从机损坏或电量掉电，SCL 永远不可能被释放，导致主 CPU 立即在此处挂死，最终触发系统看门狗复位或系统长时间瘫痪。

本驱动采用了**非阻塞自减超时状态机（Non-blocking Timeout State Machine）**的设计：

```
                                  开始事务
                                     |
                                     v
                           +-------------------+
                           |  获取系统当前 Tick |
                           |  计算 Timeout 边界 |
                           +-------------------+
                                     |
                                     v
                       +---> [ 执行 I2C 物理操作 ]
                       |             |
                       |             v
                       |     (物理状态满足预期?)
                       |      /             \
                       |   N/                 \ Y
                       |   /                   \
                       |  v                     v
                [ 读取系统当前 Tick ]     [ 进入下一阶段 ]
                       |
                       v
                (是否超过 Timeout 边界?)
                 /                  \
              N /                    \ Y (超时已到)
               /                      v
              +-------------- [ 标记超时 Error ]
                                      |
                                      v
                              [ 强行中止发送 STOP ]
                                      |
                                      v
                              [ 执行总线恢复逻辑 ]
                                      |
                                      v
                                  退出并报错
```

该状态机在每个 `while` 状态轮询处都引入了上限计数器或 Tick 检测，确保一旦在给定的延时内未检测到目标状态，驱动能体面地恢复引脚、释放互斥锁并向上层返回错误码（如 `HAL_TIMEOUT`）。

---

## 3. 多任务并发安全 (RTOS Mutex)

在运行 FreeRTOS 等实时操作系统的多任务环境中，如果任务 A 正在通过 GPIO 模拟 I2C 读取传感器，发送器件地址的 8 个 bit 尚未发完，发生了高优先级任务 B 的抢占。任务 B 恰巧也需要通过这一组 GPIO 对 EEPROM 进行读写。

此时，如果没有任何保护，任务 B 的 GPIO 操作会立刻破坏任务 A 原本正处于高电平保持的 SCL/SDA 时序。当任务 A 恢复运行并继续输出时，整个总线数据将彻底错乱，进而引发各种虚假数据或死锁。

### 互斥锁 (Mutex) 的核心价值：
* **总线独占**：在调用任意主控传输接口前，必须执行 `xSemaphoreTake(Mutex, portMAX_DELAY)`，确保同一时间只有一个任务拥有该 I2C 物理通道的读写所有权。
* **优先级继承（Priority Inheritance）**：FreeRTOS 的互斥锁内置优先级继承机制。如果一个低优先级任务持有 I2C Mutex 时被中优先级的 CPU 密集型任务抢占，导致高优先级任务也在等待该 Mutex。RTOS 会临时将持有锁的低优先级任务提升到与等待它的最高优先级任务相同的优先级，使其能尽快运行并释放锁，彻底避免了“优先级翻转”的系统隐患。

---

## 4. 生产级多实例 I2C 驱动完整源码

### 头文件 `soft_i2c.h`

```c
/**
 * ******************************************************************************
 * @file    soft_i2c.h
 * @brief   高健壮性、多实例、支持 FreeRTOS 的软件模拟 I2C 驱动头文件。
 *          提供完整的超时退出和自动死锁总线恢复逻辑。
 * ******************************************************************************
 */

#ifndef __SOFT_I2C_H
#define __SOFT_I2C_H

#include "stm32f4xx_hal.h" // 根据实际 STM32 芯片系列替换, 如 f1xx/g0xx/h7xx 等

/* 配置宏：是否启用 FreeRTOS 互斥量支持 */
#define SOFT_I2C_USE_FREERTOS   1

#if SOFT_I2C_USE_FREERTOS
#include "FreeRTOS.h"
#include "semphr.h"
#endif

/* ==================== 1. 软件 I2C 驱动错误码 ==================== */
#define SOFT_I2C_ERROR_NONE      0x00000000U /*!< 正常无错误 */
#define SOFT_I2C_ERROR_TIMEOUT   0x00000001U /*!< 时钟拉伸或应答检测超时 */
#define SOFT_I2C_ERROR_NACK      0x00000002U /*!< 从机未产生 ACK 响应 */
#define SOFT_I2C_ERROR_BUSY      0x00000004U /*!< 总线被意外拉低，处于忙锁死状态 */

/* ==================== 2. 软件 I2C 物理配置结构体 ==================== */
typedef struct {
    GPIO_TypeDef *SCL_Port; /*!< SCL 对应的 GPIO 端口指针 (如 GPIOB) */
    uint16_t SCL_Pin;       /*!< SCL 对应的 GPIO 引脚编号 (如 GPIO_PIN_6) */
    GPIO_TypeDef *SDA_Port; /*!< SDA 对应的 GPIO 端口指针 (如 GPIOB) */
    uint16_t SDA_Pin;       /*!< SDA 对应的 GPIO 引脚编号 (如 GPIO_PIN_7) */
    uint32_t Delay_us;      /*!< 物理时序半周期延迟时间 (us) */
    uint32_t Timeout;       /*!< 底层循环等待的最大计数阈值 (非阻塞计数) */
} SoftI2C_Configt;

/* ==================== 3. 软件 I2C 多通道句柄结构体 ==================== */
typedef struct {
    SoftI2C_Configt GPIO_Config; /*!< GPIO 物理配置参数 */
    uint32_t ErrorCode;          /*!< 上一次通信的错误寄存器 */
#if SOFT_I2C_USE_FREERTOS
    SemaphoreHandle_t Mutex;     /*!< 通道独占互斥信号量 */
    StaticSemaphore_t MutexBuffer;/*!< 信号量静态内存缓冲区 */
#endif
} SoftI2C_HandleTypeDef;

/* ==================== 4. 驱动核心 API 声明 ==================== */

/**
 * @brief  初始化软件 I2C 相关的 GPIO 引脚为开漏模式，并创建互斥锁
 * @param  hi2c: 软件模拟 I2C 句柄指针
 * @retval HAL_StatusTypeDef: 初始化成功返回 HAL_OK，总线严重锁死返回 HAL_ERROR
 */
HAL_StatusTypeDef SoftI2C_Init(SoftI2C_HandleTypeDef *hi2c);

/**
 * @brief  总线物理自愈恢复接口
 * @param  config: 底层物理配置指针
 * @retval HAL_StatusTypeDef: 成功释放并恢复返回 HAL_OK
 */
HAL_StatusTypeDef SoftI2C_RecoverBus(const SoftI2C_Configt *config);

/**
 * @brief  I2C 主机模式发送缓冲区数据
 */
HAL_StatusTypeDef SoftI2C_Master_Transmit(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                          uint8_t *pData, uint16_t Size, uint32_t Timeout);
                                          
/**
 * @brief  I2C 主机模式接收数据至缓冲区
 */
HAL_StatusTypeDef SoftI2C_Master_Receive(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                         uint8_t *pData, uint16_t Size, uint32_t Timeout);

/**
 * @brief  I2C 主机写从机指定寄存器/物理地址
 */
HAL_StatusTypeDef SoftI2C_Mem_Write(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                    uint16_t MemAddress, uint16_t MemAddSize, 
                                    uint8_t *pData, uint16_t Size, uint32_t Timeout);

/**
 * @brief  I2C 主机读从机指定寄存器/物理地址
 */
HAL_StatusTypeDef SoftI2C_Mem_Read(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                   uint16_t MemAddress, uint16_t MemAddSize, 
                                   uint8_t *pData, uint16_t Size, uint32_t Timeout);

#endif /* __SOFT_I2C_H */
```

### 源文件 `soft_i2c.c`

```c
/**
 * ******************************************************************************
 * @file    soft_i2c.c
 * @brief   高健壮性、多实例、支持 FreeRTOS 的软件模拟 I2C 驱动源文件。
 *          封装底层寄存器级操作，实现免方向切换及超时自愈机制。
 * ******************************************************************************
 */

#include "soft_i2c.h"

/* ==================== 1. 底层高精度延时与快速寄存器操作 ==================== */

/**
 * @brief  内部使能并复位 Cortex-M 内核自带的 DWT 计数器
 */
static inline void SoftI2C_DWT_Init(void) {
    if (!(CoreDebug->DEMCR & CoreDebug_DEMCR_TRCENA_Msk)) {
        CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    }
    DWT->CYCCNT = 0U;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

/**
 * @brief  基于 DWT 实现的微秒级精确定时
 */
static inline void SoftI2C_Delay_us(uint32_t us) {
    uint32_t start_tick = DWT->CYCCNT;
    uint32_t delay_ticks = us * (SystemCoreClock / 1000000U);
    while ((DWT->CYCCNT - start_tick) < delay_ticks) {
        // 阻塞等待
    }
}

/* 原子设置引脚电平宏，使用 BSRR 寄存器避免读-改-写时钟周期开销 */
#define SDA_HIGH(cfg)   ((cfg)->SDA_Port->BSRR = (cfg)->SDA_Pin)
#define SDA_LOW(cfg)    ((cfg)->SDA_Port->BSRR = ((uint32_t)(cfg)->SDA_Pin << 16))
#define SCL_HIGH(cfg)   ((cfg)->SCL_Port->BSRR = (cfg)->SCL_Pin)
#define SCL_LOW(cfg)    ((cfg)->SCL_Port->BSRR = ((uint32_t)(cfg)->SCL_Pin << 16))

/* 快速反读引脚电平宏 (在开漏配置下，通过 IDR 读取真实物理电平) */
#define READ_SDA(cfg)   (((cfg)->SDA_Port->IDR & (cfg)->SDA_Pin) ? 1U : 0U)
#define READ_SCL(cfg)   (((cfg)->SCL_Port->IDR & (cfg)->SCL_Pin) ? 1U : 0U)

/* ==================== 2. RTOS 线程安全加锁/解锁 ==================== */

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

/* ==================== 3. 具备超时机制的物理元动作 ==================== */

/**
 * @brief  产生 START 条件
 */
static HAL_StatusTypeDef I2C_Start(const SoftI2C_Configt *cfg) {
    SDA_HIGH(cfg);
    SCL_HIGH(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);

    // 时钟拉伸非阻塞等待
    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0U) {
        if (--timeout == 0U) {
            return HAL_TIMEOUT;
        }
        SoftI2C_Delay_us(1U);
    }

    if (READ_SDA(cfg) == 0U) {
        return HAL_ERROR; // SDA 在空闲时呈低，可能总线已被拉死
    }

    SDA_LOW(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);
    SCL_LOW(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);
    return HAL_OK;
}

/**
 * @brief  产生 STOP 条件
 */
static HAL_StatusTypeDef I2C_Stop(const SoftI2C_Configt *cfg) {
    SDA_LOW(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);
    SCL_HIGH(cfg);
    
    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0U) {
        if (--timeout == 0U) {
            return HAL_TIMEOUT;
        }
        SoftI2C_Delay_us(1U);
    }
    SoftI2C_Delay_us(cfg->Delay_us);
    SDA_HIGH(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);
    return HAL_OK;
}

/**
 * @brief  写一个字节
 */
static HAL_StatusTypeDef I2C_WriteByte(const SoftI2C_Configt *cfg, uint8_t byte) {
    for (uint8_t i = 0U; i < 8U; i++) {
        if (byte & 0x80U) {
            SDA_HIGH(cfg);
        } else {
            SDA_LOW(cfg);
        }
        byte <<= 1U;
        SoftI2C_Delay_us(cfg->Delay_us);

        SCL_HIGH(cfg);
        uint32_t timeout = cfg->Timeout;
        while (READ_SCL(cfg) == 0U) {
            if (--timeout == 0U) {
                return HAL_TIMEOUT;
            }
            SoftI2C_Delay_us(1U);
        }
        SoftI2C_Delay_us(cfg->Delay_us);
        SCL_LOW(cfg);
    }

    // 接收从机应答
    SDA_HIGH(cfg); // 释放 SDA 呈高阻态
    SoftI2C_Delay_us(cfg->Delay_us);
    SCL_HIGH(cfg);

    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0U) {
        if (--timeout == 0U) {
            return HAL_TIMEOUT;
        }
        SoftI2C_Delay_us(1U);
    }

    uint8_t ack = READ_SDA(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);
    SCL_LOW(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);

    return (ack == 0U) ? HAL_OK : HAL_ERROR;
}

/**
 * @brief  读一个字节
 */
static HAL_StatusTypeDef I2C_ReadByte(const SoftI2C_Configt *cfg, uint8_t ack_action, uint8_t *pByte) {
    uint8_t byte = 0U;
    SDA_HIGH(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);

    for (uint8_t i = 0U; i < 8U; i++) {
        SCL_HIGH(cfg);
        uint32_t timeout = cfg->Timeout;
        while (READ_SCL(cfg) == 0U) {
            if (--timeout == 0U) {
                return HAL_TIMEOUT;
            }
            SoftI2C_Delay_us(1U);
        }
        byte <<= 1U;
        if (READ_SDA(cfg)) {
            byte |= 0x01U;
        }
        SoftI2C_Delay_us(cfg->Delay_us);
        SCL_LOW(cfg);
        SoftI2C_Delay_us(cfg->Delay_us);
    }
    *pByte = byte;

    // 发送应答/非应答位
    if (ack_action == 0U) {
        SDA_LOW(cfg);  // 发送 ACK
    } else {
        SDA_HIGH(cfg); // 发送 NACK
    }
    SoftI2C_Delay_us(cfg->Delay_us);
    SCL_HIGH(cfg);

    uint32_t timeout = cfg->Timeout;
    while (READ_SCL(cfg) == 0U) {
        if (--timeout == 0U) {
            return HAL_TIMEOUT;
        }
        SoftI2C_Delay_us(1U);
    }
    SoftI2C_Delay_us(cfg->Delay_us);
    SCL_LOW(cfg);
    SDA_HIGH(cfg);
    SoftI2C_Delay_us(cfg->Delay_us);

    return HAL_OK;
}

/* ==================== 4. 初始化与总线恢复 ==================== */

HAL_StatusTypeDef SoftI2C_Init(SoftI2C_HandleTypeDef *hi2c) {
    SoftI2C_DWT_Init();
    hi2c->ErrorCode = SOFT_I2C_ERROR_NONE;

#if SOFT_I2C_USE_FREERTOS
    if (hi2c->Mutex == NULL) {
        // 使用静态分配函数创建 Mutex，防止堆碎片化
        hi2c->Mutex = xSemaphoreCreateMutexStatic(&(hi2c->MutexBuffer));
    }
#endif

    // 初始化 GPIO 为开漏输出
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    GPIO_InitStruct.Pin = hi2c->GPIO_Config.SCL_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(hi2c->GPIO_Config.SCL_Port, &GPIO_InitStruct);

    GPIO_InitStruct.Pin = hi2c->GPIO_Config.SDA_Pin;
    HAL_GPIO_Init(hi2c->GPIO_Config.SDA_Port, &GPIO_InitStruct);

    // 默认释放总线为高电平
    SDA_HIGH(&(hi2c->GPIO_Config));
    SCL_HIGH(&(hi2c->GPIO_Config));

    // 上电自检：如果 SDA 被异常拉低，立刻自动尝试总线死锁恢复
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0U) {
        if (SoftI2C_RecoverBus(&(hi2c->GPIO_Config)) != HAL_OK) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_BUSY;
            return HAL_ERROR;
        }
    }

    return HAL_OK;
}

/* 详尽的总线物理恢复代码在第二章中已经进行过理论及工程推导 */
HAL_StatusTypeDef SoftI2C_RecoverBus(const SoftI2C_Configt *config) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    uint8_t clocks = 9U;
    uint8_t sda_state = 1U;

    GPIO_InitStruct.Pin = config->SDA_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);

    GPIO_InitStruct.Pin = config->SCL_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(config->SCL_Port, &GPIO_InitStruct);
    HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
    HAL_Delay(1U);

    if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_SET) {
        GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
        HAL_GPIO_Init(config->SCL_Port, &GPIO_InitStruct);
        HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);
        return HAL_OK;
    }

    for (uint8_t i = 0U; i < clocks; i++) {
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_RESET);
        HAL_Delay(1U); 
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
        HAL_Delay(1U);

        if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_SET) {
            sda_state = 1U;
            break;
        }
        sda_state = 0U;
    }

    if (sda_state == 1U) {
        GPIO_InitStruct.Pin = config->SDA_Pin;
        GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
        HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);

        HAL_GPIO_WritePin(config->SDA_Port, config->SDA_Pin, GPIO_PIN_RESET);
        HAL_Delay(1U);
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_RESET);
        HAL_Delay(1U);
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
        HAL_Delay(1U);
        HAL_GPIO_WritePin(config->SDA_Port, config->SDA_Pin, GPIO_PIN_SET);
        HAL_Delay(1U);
    }

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

/* ==================== 5. 主机数据读写高级 API 实现 ==================== */

HAL_StatusTypeDef SoftI2C_Master_Transmit(SoftI2C_HandleTypeDef *hi2c, uint16_t DevAddress, 
                                          uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    HAL_StatusTypeDef status = HAL_OK;
    uint32_t tickstart = HAL_GetTick();

    SoftI2C_Lock(hi2c);
    hi2c->ErrorCode = SOFT_I2C_ERROR_NONE;

    // 产生 START 起始
    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 发送从机写地址 (R/W 位为 0)
    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress & 0xFEU);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 循环输出数据
    for (uint16_t i = 0U; i < Size; i++) {
        // 检测系统毫秒级软件超时
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

    // 发送 STOP 停止
    I2C_Stop(&(hi2c->GPIO_Config));
    
    // 如果发送完毕后，由于某种物理异常 SDA 仍呈现低电平，主动拉起物理修复
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0U) {
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

    // 发送从机读地址 (R/W 位为 1)
    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress | 0x01U);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 循环接收数据
    for (uint16_t i = 0U; i < Size; i++) {
        if ((HAL_GetTick() - tickstart) > Timeout) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            status = HAL_TIMEOUT;
            break;
        }

        // I2C 规范：读取最后一个字节时应发送 NACK (1) 结束，其余字节均发送 ACK (0)
        uint8_t ack_action = (i == (Size - 1U)) ? 1U : 0U;
        status = I2C_ReadByte(&(hi2c->GPIO_Config), ack_action, &pData[i]);
        if (status != HAL_OK) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            break;
        }
    }

    I2C_Stop(&(hi2c->GPIO_Config));
    
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0U) {
        SoftI2C_RecoverBus(&(hi2c->GPIO_Config));
    }

    SoftI2C_Unlock(hi2c);
    return status;
}

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

    // 发送物理器件写地址
    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress & 0xFEU);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 发送从机器件内部的寄存器/内存地址 (支持 8-bit 和 16-bit 寻址长度)
    if (MemAddSize == I2C_MEMADD_SIZE_16BIT) {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)((MemAddress >> 8) & 0xFFU));
        if (status == HAL_OK) {
            status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFFU));
        }
    } else {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFFU));
    }

    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // 循环写入数据
    for (uint16_t i = 0U; i < Size; i++) {
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
    
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0U) {
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

    // A. 写阶段：发送设备写物理地址及寄存器寻址物理地址
    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress & 0xFEU);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    if (MemAddSize == I2C_MEMADD_SIZE_16BIT) {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)((MemAddress >> 8) & 0xFFU));
        if (status == HAL_OK) {
            status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFFU));
        }
    } else {
        status = I2C_WriteByte(&(hi2c->GPIO_Config), (uint8_t)(MemAddress & 0xFFU));
    }

    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // B. 重新生成 START 起始，切换进入读模式
    status = I2C_Start(&(hi2c->GPIO_Config));
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    status = I2C_WriteByte(&(hi2c->GPIO_Config), DevAddress | 0x01U);
    if (status != HAL_OK) {
        hi2c->ErrorCode |= SOFT_I2C_ERROR_NACK;
        I2C_Stop(&(hi2c->GPIO_Config));
        SoftI2C_Unlock(hi2c);
        return status;
    }

    // C. 循环接收数据
    for (uint16_t i = 0U; i < Size; i++) {
        if ((HAL_GetTick() - tickstart) > Timeout) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            status = HAL_TIMEOUT;
            break;
        }

        uint8_t ack_action = (i == (Size - 1U)) ? 1U : 0U;
        status = I2C_ReadByte(&(hi2c->GPIO_Config), ack_action, &pData[i]);
        if (status != HAL_OK) {
            hi2c->ErrorCode |= SOFT_I2C_ERROR_TIMEOUT;
            break;
        }
    }

    I2C_Stop(&(hi2c->GPIO_Config));
    
    if (READ_SDA(&(hi2c->GPIO_Config)) == 0U) {
        SoftI2C_RecoverBus(&(hi2c->GPIO_Config));
    }

    SoftI2C_Unlock(hi2c);
    return status;
}
```

---

## 5. 设备驱动适配实例：AT24C02 EEPROM

为了展示该模拟驱动的调用方法，以下给出一个典型的 AT24C02 设备驱动层封装。

### 1. 通道实例与初始化配置

```c
#include "soft_i2c.h"
#include <stdio.h>

// 静态实例化一软件 I2C 句柄，绑定 GPIOB 引脚 6 (SCL) 与 7 (SDA)
SoftI2C_HandleTypeDef hsoft_i2c1 = {
    .GPIO_Config = {
        .SCL_Port = GPIOB,
        .SCL_Pin = GPIO_PIN_6,
        .SDA_Port = GPIOB,
        .SDA_Pin = GPIO_PIN_7,
        .Delay_us = 4U,       // 4微秒半延时，换算主频约为 125kHz
        .Timeout = 1500U      // 底层 SCL 信号拉伸最大循环等待阈值
    }
};

/**
 * @brief  初始化物理板载的 I2C 通道并测试总线
 */
void System_I2C_Init(void) {
    // 假设物理时钟配置已在外围完成
    __HAL_RCC_GPIOB_CLK_ENABLE();

    if (SoftI2C_Init(&hsoft_i2c1) == HAL_OK) {
        printf("Soft-I2C Channel 1 initialized successfully.\r\n");
    } else {
        printf("Soft-I2C Channel 1 initialization failed! Code: 0x%08X\r\n", 
               (unsigned int)hsoft_i2c1.ErrorCode);
    }
}
```

### 2. AT24C02 核心读写逻辑封装

```c
#define AT24C02_DEVICE_ADDR  0xA0U  // AT24C02 的 8-bit 写地址

/**
 * @brief  向 AT24C02 的指定存储单元写入一个字节
 * @param  mem_addr: EEPROM 内部存储单元地址 (0~255)
 * @param  data: 待写入的单字节数据
 * @retval HAL_StatusTypeDef
 */
HAL_StatusTypeDef AT24C02_WriteByte(uint8_t mem_addr, uint8_t data) {
    HAL_StatusTypeDef status;
    uint8_t buffer = data;

    // 利用标准的 Mem_Write 写入 1 字节数据，寻址长度为 8-bit，API 超时设定为 100ms
    status = SoftI2C_Mem_Write(&hsoft_i2c1, AT24C02_DEVICE_ADDR, (uint16_t)mem_addr, 
                               I2C_MEMADD_SIZE_8BIT, &buffer, 1U, 100U);

    // AT24C02 存在物理写入周期限制 (T_wr)，每次物理写入完成后需强制挂起 5ms
    if (status == HAL_OK) {
#if SOFT_I2C_USE_FREERTOS
        vTaskDelay(pdMS_TO_TICKS(5U));
#else
        HAL_Delay(5U);
#endif
    }
    return status;
}

/**
 * @brief  从 AT24C02 的指定存储单元开始，连续读取多个字节
 * @param  mem_addr: EEPROM 起始存储单元地址
 * @param  pBuffer: 接收数据的缓冲区指针
 * @param  size: 要读取的字节数
 * @retval HAL_StatusTypeDef
 */
HAL_StatusTypeDef AT24C02_ReadBuffer(uint8_t mem_addr, uint8_t *pBuffer, uint16_t size) {
    // 调用标准的 Mem_Read 执行读取，API 超时设定为 100ms
    return SoftI2C_Mem_Read(&hsoft_i2c1, AT24C02_DEVICE_ADDR, (uint16_t)mem_addr, 
                            I2C_MEMADD_SIZE_8BIT, pBuffer, size, 100U);
}
```

### 3. 多任务安全并发访问测试

如下代码演示了在 FreeRTOS 环境下，两个不同优先级、不同周期触发的任务安全地读写同一个 EEPROM 器件。驱动中内置的互斥锁完美杜绝了引脚电平的时序交叉冲突。

```c
#if SOFT_I2C_USE_FREERTOS

/**
 * @brief  任务 A：周期性高频读取 EEPROM 历史配置 (读取任务)
 */
void StartTask_Telemetry(void const * argument) {
    uint8_t config_data = 0U;
    for(;;) {
        // 并发读取单元 0x20
        if (AT24C02_ReadBuffer(0x20U, &config_data, 1U) == HAL_OK) {
            printf("[Telemetry Task] Config at 0x20: 0x%02X\r\n", config_data);
        } else {
            printf("[Telemetry Task] Read failed! Bus Error Register: 0x%08X\r\n", 
                   (unsigned int)hsoft_i2c1.ErrorCode);
        }
        
        vTaskDelay(pdMS_TO_TICKS(100U)); // 周期挂起 100 毫秒
    }
}

/**
 * @brief  任务 B：周期性将运行数据写入 EEPROM 备份 (写入任务)
 */
void StartTask_DataLogger(void const * argument) {
    uint8_t log_counter = 0U;
    for(;;) {
        // 并发写入单元 0x20
        if (AT24C02_WriteByte(0x20U, log_counter) == HAL_OK) {
            printf("[Logger Task] Successfully logged: 0x%02X\r\n", log_counter);
            log_counter++;
        } else {
            printf("[Logger Task] Write failed! Bus Error Register: 0x%08X\r\n", 
                   (unsigned int)hsoft_i2c1.ErrorCode);
            // 这里可以针对不同的错误码执行特定的策略，例如：
            if (hsoft_i2c1.ErrorCode & SOFT_I2C_ERROR_BUSY) {
                 // 发生严重忙死锁，可以触发总线复位操作
                 SoftI2C_Init(&hsoft_i2c1);
            }
        }
        
        vTaskDelay(pdMS_TO_TICKS(1000U)); // 周期挂起 1 秒
    }
}

#endif
```

通过这套精心封装的物理模拟、句柄保护和设备适配，软件模拟 I2C 不仅具备极强的硬件移植通用性，而且在复杂的强电磁工业控制和多线程抢占环境中，展现出了硬件 I2C 根本无法媲美的可靠性与容错自恢复性能。
