# 第二章：STM32 硬件 Bug 与从机死锁成因

在嵌入式开发中，I2C 协议的死锁（Deadlock）和卡死（Hang）是困扰广大开发人员的经典难题。本章将深入剖析 STM32 硬件 I2C 控制器底层的硅缺陷（Silicon Bugs）机理，解析总线发生“从机拉低 SDA 导致死锁”的物理逻辑，并给出生产级总线自愈恢复策略的完整实现。

---

## 1. STM32 硬件 I2C 硅缺陷深度分析

在许多经典的 STM32 微控制器（尤其是 STM32F1xx、STM32F4xx 早期批次）中，硬件 I2C 控制器由于状态机内部设计过于复杂、同步逻辑不严密，存在多项众所周知的硬件设计缺陷。

### 状态清除逻辑与中断抢占冲突

在 STM32 硬件 I2C 外设中，很多核心状态标志的清除依赖特定的寄存器顺序读取操作。以下是其中最经典的 **ADDR 标志清除机制**：
* **标准操作**：当主控发送地址被应答后，硬件置位 `I2C_SR1` 寄存器的 `ADDR` 位。要清除该标志，CPU 必须首先读取 `I2C_SR1` 寄存器，接着读取 `I2C_SR2` 寄存器。
* **物理时序异常**：

```
 CPU Execution:               ISR or Task Preemption
  [Read SR1] -------------------> [Interrupt Handler (SysTick/DMA/UART)]
   (ADDR active)                      (I2C hardware state changes on bus)
                                                  |
                                                  v
                              [Read SR2] <--------+ (Context Restored)
                               (Hardware Sync Fails -> BUSY flag lockup)
```

如果在 CPU 读取完 `SR1` 之后、准备读取 `SR2` 的那一个微小的时间窗内，系统发生了一个高优先级中断（如 SysTick 滴答定时器、DMA 数据流传输或串口接收中断），CPU 会强行挂起当前线程转而执行中断服务程序。

在此期间，硬件 I2C 控制器在物理总线上仍然在持续运转。若此时发生硬件状态改变（如从机由于主控未能及时读取接收缓冲而拉低时钟），当 CPU 中断返回并继续读取 `SR2` 时，硬件状态机的同步电路就会发生不可控的错乱。

### 缺陷导致的具体后果：
1. **BUSY 标志位硬死锁**：`I2C_SR2` 中的 `BUSY` 标志位被硬件永久置 1，即便此时总线物理电平已释放回双高电平空闲态，主控也无法再生成任何起始（START）条件。
2. **SCL 被硬件永久拉低**：当硬件检测到接收数据溢出（Overrun）或未被及时处理时，会启动硬件防溢出机制，将 SCL 物理线强行拉低。由于内部同步故障，该拉低操作无法被清除软件释放。
3. **唯一的物理恢复方式**：使用 `RCC` 外设复位寄存器对整个 I2C 外设块（如 `RCC_APB1RSTR`）执行硬复位：
   ```c
   I2C1->CR1 |= I2C_CR1_SWRST;   // 软件复位 I2C 外设
   I2C1->CR1 &= ~I2C_CR1_SWRST;
   ```
   然而，频繁对物理外设进行硬复位会导致中断配置丢失、DMA 通道解绑等一连串副作用，使软件驱动架构的设计变得支离破碎。

---

## 2. 从机死锁（拉低 SDA）的物理成因

相较于主控芯片的硬件缺陷，**从机强行拉低 SDA 导致的死锁**是一个物理协议级的通病，与使用的是硬件 I2C 还是软件模拟 I2C 无关。

### 死锁场景产生机制

这一现象绝大多数发生于**主机在读取从机数据字节的中途被突然复位**（例如系统看门狗复位、调试时在 IDE 中点击 Reset 按钮、或者瞬间电磁脉冲干扰触发的主控硬件复位）。

#### 从机拉低 SDA 死锁状态流向图：

```
                    +---------------------------------------------+
                    |           正常通信：主机启动读数据           |
                    +---------------------------------------------+
                                           |
                                           | (从机输出数据字中，某一位是 0)
                                           v
                    +---------------------------------------------+
                    |     从机激活内部 NMOS，将 SDA 物理拉低 (0)    |
                    +---------------------------------------------+
                                           |
                                           | (主机在此瞬间异常复位 / 挂起)
                                           v
                    +---------------------------------------------+
                    |    主机 GPIO 浮空高，SCL 线恢复为高电平 (1)    |
                    |    从机状态机原地冻结，等待 SCL 的下一个下降沿  |
                    +---------------------------------------------+
                                           |
                                           | (主机重启完毕，试图开始新通信)
                                           v
                    +---------------------------------------------+
                    |      主机检测到 SDA 为低，认为总线繁忙 (BUSY)   |
                    |      主机无法发出 START 信号，通信彻底陷入瘫痪   |
                    +---------------------------------------------+
```

### 物理底层微观过程解析：

1. **从机控制权控制**：
   当主机向从机发起读取传输（`Read`）时，在应答阶段之后，总线控制权交由从机。从机开始通过改变 SDA 电平来发送数据。
2. **发送数据 `0`**：
   假设当前字节的某一位是逻辑 `0`。从机必须将 SDA 引脚上的 NMOS 导通，把 SDA 物理线上积累的电荷泄放到地（GND），此时 SDA 呈现强物理低电平。
3. **主控发生异常复位**：
   在这个特定时刻，主机突然发生复位。主机的所有 GPIO 寄存器在硬件复位时都会重置为默认的**输入浮空状态**。
   * **SCL 状态**：由于主机不再主动拉低 SCL，SCL 引脚变成浮空输入，在外部上拉电阻作用下回到逻辑高电平。
   * **SDA 状态**：虽然主机的 SDA 释放了，但**从机并不知道主机已经复位**。从机的移位寄存器和状态机认为当前仍然处于上一次读取事务的中间。它在等待什么？它在等待**主控将 SCL 时钟线拉低**，作为移位下一位数据的触发信号。
4. **僵局形成**：
   * **从机方面**：SCL 没有下降沿，它不能转移到下一个比特，所以必须一直开启 NMOS 驱动，持续将 SDA 物理线拉低。
   * **主机方面**：复位重启后，软件根据 I2C 标准，在准备生成 `START` 条件前，必须先检测 SDA 与 SCL 是否均为高电平（即总线处于空闲 IDLE 状态）。如果检测到 SDA 为低电平，主机会认为当前总线有其它设备在占用（处于 `BUSY` 状态），必须阻塞等待总线释放。
   * **死锁产生**：主机等从机释放 SDA，从机等主机给 SCL 下降沿，双方永远无法前进，死锁达成。

---

## 3. 总线恢复逻辑（Bus Recovery）

要打破上述死锁状态，软件模拟 I2C 表现出了硬件 I2C 无法企及的灵活性。主机必须打破正常的 I2C 控制寄存器逻辑，切换为 GPIO 普通输入输出模式，人工对总线进行物理修复。

这个修复逻辑在嵌入式开发中被称为 **"Clocks of Death"（死亡脉冲）**。

### 物理修复步骤详解：

1. **临时转换引脚角色**：
   将 SCL 引脚配置为普通的**推挽输出模式**，将 SDA 配置为带上拉的**输入模式**（为了读取 SDA 的真实状态）。
2. **判断总线状态**：
   读取 SDA 引脚的电平。
   * 若 SDA 为高电平，说明总线没有发生死锁，可直接退出。
   * 若 SDA 为低电平，证明从机确实正卡在发送 `0` 的周期，开始执行脉冲恢复。
3. **发送 9 个时钟脉冲**：
   由 SCL 输出最多 9 个周期的脉冲信号（High -> Low -> High）。
   * *为什么要选 9 个脉冲？* 因为 I2C 协议中，传送一个完整字节（8 位）加一个应答位（1 位）最大刚好是 9 个时钟。无论从机此时卡在字节传输的哪一个 bit，发送 9 个脉冲都足以让它的内部移位寄存器滚动完成当前的字节发送，进而释放 SDA。
   * **提前中止优化**：在每次 SCL 脉冲拉高时，读取 SDA。如果发现 SDA 已经由低变高，说明从机已经完成了当前字节传输并释放了 SDA，主机可以立即停止发送多余的脉冲。
4. **强行生成 STOP 条件**：
   在 SDA 被释放变高后，从机的状态机现在处于数据字节的边界。主机必须立刻配置 SDA 为输出，在 SCL 为高电平时，手动控制 SDA 产生一个从低到高的电平跳变（即合法的 STOP 条件）。
   * *重要性*：STOP 信号是 I2C 总线上的最高级逻辑信号，它可以将所有在线从机的硬件状态机强行重置回 IDLE 空闲状态。
5. **恢复开漏配置**：
   重新将 SCL 和 SDA 均配置为开漏输出模式，准备下一次正常的通信。

---

## 4. 工业级总线恢复 C 代码实现

以下为在 STM32 平台上，针对死锁情况编写的生产级总线恢复函数。该函数在每次初始化软件 I2C 通道时均会执行自检，在日常通信超时或错误处理例程中也可以随时调用。

```c
#include "soft_i2c_hal.h"

/**
 * @brief  利用 9 个时钟脉冲彻底解决从机拉低 SDA 造成的总线死锁
 * @param  config: 软件模拟 I2C 通道的引脚及延时配置句柄
 * @retval HAL_OK: 总线已成功恢复或本身处于空闲状态;
 *         HAL_ERROR: 恢复失败，可能存在物理硬短路或从机硬件物理失效
 */
HAL_StatusTypeDef SoftI2C_RecoverBus(const SoftI2C_Configt *config) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    uint8_t clocks = 9U;
    uint8_t is_sda_released = 0U;

    // 1. 将 SDA 暂时重新配置为带上拉的输入模式，保证能读取到引脚最真实的电平
    GPIO_InitStruct.Pin = config->SDA_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);

    // 2. 将 SCL 暂时重新配置为普通推挽输出模式，用以输出强脉冲
    GPIO_InitStruct.Pin = config->SCL_Pin;
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(config->SCL_Port, &GPIO_InitStruct);

    // 首先释放 SCL 处于逻辑高电平
    HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
    HAL_Delay(1U); // 稳定电平 1 毫秒

    // 3. 自检：如果 SDA 已经为高，直接说明总线是健康的，无需发送脉冲
    if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_SET) {
        // 直接重新配置回软件模拟所要求的开漏状态
        SoftI2C_Init(config);
        return HAL_OK;
    }

    // 4. 循环产生最多 9 个物理时钟脉冲，以使从机移位寄存器滚出 0
    for (uint8_t i = 0U; i < clocks; i++) {
        // SCL 拉低
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_RESET);
        // 时钟半周期延时 (这里延时 20us，以适配甚至极低速的古老传感器)
        SoftI2C_Delay_us(20U); 

        // SCL 拉高 (释放)
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
        SoftI2C_Delay_us(20U);

        // 在 SCL 处于高电平时采样检测 SDA 物理状态
        if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_SET) {
            is_sda_released = 1U;
            break; // 只要 SDA 变高，说明从机已释放 SDA 线，提前中止脉冲
        }
    }

    // 5. 若 SDA 已成功恢复为高电平，立即发送强行复位状态机的 START 与 STOP 条件
    if (is_sda_released == 1U) {
        // 重新将 SDA 配置为推挽输出模式，以便我们能手动控制其发出沿跳变
        GPIO_InitStruct.Pin = config->SDA_Pin;
        GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
        HAL_GPIO_Init(config->SDA_Port, &GPIO_InitStruct);

        // --- 手动产生 START 信号 ---
        // 此时 SCL 已为高，SDA 从高拉低
        HAL_GPIO_WritePin(config->SDA_Port, config->SDA_Pin, GPIO_PIN_RESET);
        SoftI2C_Delay_us(10U);
        // SCL 拉低
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_RESET);
        SoftI2C_Delay_us(10U);

        // --- 手动产生 STOP 信号 ---
        // 此时 SCL 和 SDA 均为低。首先释放 SCL 变高
        HAL_GPIO_WritePin(config->SCL_Port, config->SCL_Pin, GPIO_PIN_SET);
        SoftI2C_Delay_us(10U);
        // SCL 为高电平期间，拉高 SDA，产生停止沿
        HAL_GPIO_WritePin(config->SDA_Port, config->SDA_Pin, GPIO_PIN_SET);
        SoftI2C_Delay_us(10U);
    }

    // 6. 重新将两个引脚初始化为标准的开漏输出模式，恢复软件模拟 I2C 的运行态
    SoftI2C_Init(config);

    // 7. 进行最终的物理层检测
    if (HAL_GPIO_ReadPin(config->SDA_Port, config->SDA_Pin) == GPIO_PIN_RESET) {
        // 若仍然为低电平，说明无法恢复 (可能线路发生了物理接地短路、或从机芯片已击穿损坏)
        return HAL_ERROR;
    }

    return HAL_OK; // 总线完美修复
}
```

本章所介绍的物理死锁恢复方法已被广泛应用于工业级温湿度传感器、大容量存储 EEPROM 和工业电流电压采样芯片等领域。在下一章中，我们将把此功能整合至多实例设备句柄中，讲解如何编写高健壮性的并发安全、超时自愈型 I2C 驱动。
