# 第一章：GPIO 软件模拟时序与物理电平

要编写出能够在工业级干扰环境下稳定工作的软件模拟 I2C 驱动，必须在深挖其物理电平特性的基础上进行寄存器级优化。本章将从物理层原理、寄存器级操作机制、精确时序延迟控制三个维度展开，系统剖析生产级 GPIO 软件模拟 I2C 的实现方案。

---

## 1. I2C 物理层架构与电平特性

I2C（Inter-Integrated Circuit）是一种同步、半双工的总线协议。在物理层上，它最独特的特点是利用**开漏输出（Open-Drain）**与**外部上拉电阻**的组合，构造出了全局的**线与（Wired-AND）**逻辑。

### 物理连接拓扑与线与逻辑

I2C 总线物理层拓扑结构如下所示：

```
                              VCC (+3.3V / +5V)
                               |
                        +------+------+
                        |             |
                       [R1]          [R2]      Pull-up Resistors (e.g., 4.7k)
                        |             |
SDA Line  --------------+-------------+---------------+------------------------
SCL Line  --------------|-+-----------|-+-------------|------------------------
                        | |           | |             |
                  +-----+-----+ +-----+-----+   +-----+-----+
                  |   Master  | |   Slave 1 |   |   Slave 2 |
                  |   (MCU)   | |  (EEPROM) |   |  (Sensor) |
                  |           | |           |   |           |
                  |     /|    | |     /|    |   |     /|    |
SDA Output -------+----o |----+------+----o |---+---+----o |----+ (NMOS Gate)
                  |     \|    | |     \|    |   |     \|    |
                  |     NMOS  | |     NMOS  |   |     NMOS  |
                  |           | |           |   |           |
SDA Input  <------+-----------+------+------+---+-----+-----+ (Input Buffer)
                  +-----------+ +-----------+   +-----------+
```

1. **被动上拉（Passive Pull-up）**：
   I2C 器件在物理引脚上不具备强推挽输出高电平的结构。当器件希望输出逻辑高电平（Logic 1）时，其内部的 NMOS 截止，引脚呈现高阻态（High-Impedance）。此时，总线上的电平完全由外部上拉电阻 \\(R1\\) 或 \\(R2\\) 充电拉高至 \\(VCC\\)。
2. **主动下拉（Active Pull-down）**：
   当任何器件希望输出逻辑低电平（Logic 0）时，其内部的 NMOS 饱和导通，将引脚直接接地（\\(VSS\\)），从而强制将总线拉低。
3. **线与（Wired-AND）特性**：
   从拓扑中可以看出，只要有任意一个器件（无论主从）将其内部 NMOS 导通拉低总线，整条总线就会呈现低电平。只有当总线上**所有**器件都释放总线（内部 NMOS 全部截止）时，总线电平才会依靠上拉电阻恢复为高。这一物理层特性实现了多主仲裁、冲突检测以及**时钟拉伸（Clock Stretching）**。

### 上升沿时间常数与物理约束

由于高电平是通过上拉电阻对总线的寄生电容充电实现的，这属于典型的 RC 一阶响应。

根据一阶电路公式，电平从低到高的充电过程电压满足：
\\[v(t) = V_{DD} \left(1 - e^{-\frac{t}{R_{pullup} C_b}}\right)\\]

在 I2C 规范中，输入低电平门限 \\(V_{IL}\\) 最大为 \\(0.3 V_{DD}\\)，输入高电平门限 \\(V_{IH}\\) 最小为 \\(0.7 V_{DD}\\)。信号上升时间 \\(t_r\\) 定义为电压从 \\(0.3 V_{DD}\\) 上升到 \\(0.7 V_{DD}\\) 所需的时间。

代入公式计算：
\\[0.3 V_{DD} = V_{DD} \left(1 - e^{-\frac{t_1}{RC}}\right) \implies t_1 \approx 0.3567 RC\\]
\\[0.7 V_{DD} = V_{DD} \left(1 - e^{-\frac{t_2}{RC}}\right) \implies t_2 \approx 1.2040 RC\\]
\\[t_r = t_2 - t_1 \approx 0.8473 \times R_{pullup} \times C_b\\]

其中，\\(C_b\\) 是总线的寄生电容（包括走线寄生电容、引脚输入电容等）。

* **限制分析**：
  * 若 \\(R_{pullup}\\) 过大，RC 充电常数增大，上升沿 \\(t_r\\) 变缓。如果 \\(t_r\\) 超过了协议允许的最大值（标准模式 \\(100\text{kbps}\\) 下最大 \\(1000\text{ns}\\)，快速模式 \\(400\text{kbps}\\) 下最大 \\(300\text{ns}\\)），电平尚未达到 \\(V_{IH}\\) 阈值，SCL 周期就已经结束，会导致严重的采样错误。
  * 若 \\(R_{pullup}\\) 过小，当器件输出低电平时，流过 NMOS 的灌电流 \\(I_{OL}\\) 将急剧上升：
    \\[I_{OL} \approx \frac{V_{DD}}{R_{pullup}}\\]
    这会增加系统功耗，并可能超过芯片引脚的最大容许灌电流（STM32 引脚一般最大为 \\(20\text{mA}\\)，但 I2C 官方推荐灌电流不超过 \\(3\text{mA}\\)，以保证低电平电压 \\(V_{OL}\\) 足够低）。
  * 建议值：在 3.3V 系统中，若总线电容为 \\(100\text{pF}\\)，标准模式通常选择 \\(4.7\text{k}\Omega\\)，快速模式常选择 \\(1.5\text{k}\Omega\\) - \\(2.2\text{k}\Omega\\)。

### 时钟拉伸 (Clock Stretching) 原理

时钟拉伸是从机为了自身内部处理（例如 EEPROM 写入周期、ADC 转换尚未完成）而暂停总线通信的一种硬件机制。

```
Master SCL  ____        ____                    ________
                \______/    \__________________/
Slave SCL   ____        ________________________
                \______/                        \_______
Physical SCL ___        ________________________
                \______/                        \_______ (从机继续拉低)
                       ^ 从机硬件拉低，主机释放 SCL 但由于线与逻辑，SCL 仍然呈低电平
```

1. **机制**：主机在完成一次数据位传输后释放 SCL（写 ODR 寄存器为 1），按照协议，SCL 应恢复为高电平。但由于从机此时内部拉低了 SCL，由于“线与”逻辑，物理 SCL 线上实际仍然呈现低电平。
2. **要求**：主机释放 SCL 后，**不能盲目延时**直接认为时钟已变高。主机必须通过 GPIO 输入寄存器读取 SCL 的实际电平。若检测到 SCL 仍然为 0，主机必须强制挂起数据传送计数，持续等待 SCL 被从机释放为高电平，然后再进行下一步的半周期延时。
3. **软件隐患**：如果软件模拟驱动中没有对 SCL 拉低做超时处理（例如写死为 `while(READ_SCL() == 0);`），一旦从机死机或损坏，主机将永久卡死在该死循环中。

---

## 2. STM32 GPIO 寄存器级控制优化

传统的 HAL 库调用（如 `HAL_GPIO_WritePin`）每次需要执行大量的参数校验和移位运算，无法满足快速的 I2C 时序，且频繁进行输入/输出方向切换会导致极大的 CPU 开销。本节介绍如何在 STM32 上通过寄存器操作实现极致的性能优化。

### 免方向切换 (No Direction Switch) 机制

在很多低效的模拟 I2C 代码中，常有如下做法：
```c
// 极其低效的切换写法
void SDA_SetInput(void) {
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
}
void SDA_SetOutput(void) {
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
}
```
每次调用 `HAL_GPIO_Init` 均会对模式寄存器（如 `MODER`）进行“读-修改-写”操作。在高速 CPU（如运行在 168MHz 的 STM32F4）上，这会打破流水线、刷新指令缓存，引起高达数十个周期的延迟，限制了时钟模拟的最高速率。

**优化设计**：**将 SDA 和 SCL 永久配置为开漏输出（Open-Drain）模式**。
在 STM32 中，GPIO 处于开漏输出配置时，其内部输入缓冲电路（Input Buffer）其实是**常开**的。这意味着：
* 当输出数据寄存器（`ODR`）写入 `1` 时，内部 NMOS 截止，引脚处于悬空状态（由外部上拉拉高）。此时，如果外界从机将 SDA 拉低，我们直接通过输入数据寄存器（`IDR`）依然可以读到真实的物理低电平 `0`；如果从机释放 SDA，读取到的就是物理高电平 `1`。
* 当 `ODR` 写入 `0` 时，内部 NMOS 导通，引脚被强制拉低，此时读取 `IDR` 将始终为 `0`。

因此，在软件模拟驱动中，我们**只需在初始化时将 SDA 和 SCL 均配置为开漏输出 + 硬件上拉**，在后续的所有字节读写、应答检测流程中，**完全无需切换引脚方向**：
* 写入数据时，直接通过 `BSRR` 往引脚写 `0` 或 `1`。
* 读取数据时，**首先写入 `1` 释放 SDA 总线**，随后直接读取 `IDR`。

```
                             STM32 GPIO 内部结构 (开漏模式)
                 +-----------------------------------------------+
                 |                                               |
                 |         +-------+                             |
  Write ODR = 1  |         | PMOS  | (始终关闭/禁用)              |
 ------------->  |  x----->|驱动器  |--- [X]                       |
                 |         +-------+                             |
                 |         +-------+                             |   Physical Pin
  Write ODR = 0  |         | NMOS  |                             |======*======
 ------------->  | ------->|驱动器  |---+-- [NMOS Gate] -----------+      |
                 |         +-------+   |                                  |
                 |                     |                                  |
                 |         +-------+   |                                  |
  Read IDR       |         | 输入  |   v                                  |
 <-------------  | <-------| 缓冲器 |<--+----------------------------------+
                 |         | (常开) |
                 +---------+-------+-----------------------------+
```

### 寄存器原子操作：BSRR / BRR

在并发或中断活跃的系统中，避免使用类似 `GPIOx->ODR |= GPIO_PIN_x` 这种“读-改-写”的非原子操作。如果被高优先级中断打断，可能导致其它引脚的设置被覆盖。
我们必须使用 **端口位设置/清除寄存器（BSRR - Bit Set Reset Register）**。
* 对 STM32F4 等平台：
  * `hi2c->SDA_Port->BSRR = hi2c->SDA_Pin;` 原子置 1。
  * `hi2c->SDA_Port->BSRR = (uint32_t)hi2c->SDA_Pin << 16;` 原子清 0。
* 对 STM32F1/G0 等带有独立 `BRR`（Bit Reset Register）的芯片，可以直接写 `BRR`。

---

## 3. 时序元动作的精确模拟与 C 代码实现

I2C 通信由五个基本的元动作组成：**空闲检测、START（起始）、STOP（停止）、WriteByte（写字节）和 ReadByte（读字节）**。

### SCL / SDA 总线基本时序对照

```
           START 阶段                 数据字节发送阶段                     STOP 阶段
       _______________          _____       _____       _____          _______________
SCL                   \________/     \_____/     \_____/     \________/
       _________               ___         ___         ___                    ________
SDA             \_____________/   \_______/   \_______/   \__________________/
       |  START  |  Idle Time | SDA Change|SDA Stable |  ACK/NACK  |  Idle Time|  STOP   |
```

1. **START 条件**：在 SCL 保持高电平期间，SDA 发生下降沿（由高变低）。
2. **STOP 条件**：在 SCL 保持高电平期间，SDA 发生上升沿（由低变高）。
3. **数据稳定采样**：当 SCL 处于高电平时，SDA 的电平必须保持稳定，从机在该阶段读取 SDA；当 SCL 处于低电平时，允许 SDA 电平发生跳变更新。

### 高精度 DWT 延时机制

传统的 `for(volatile int i=0);` 极易由于编译器优化等级（如 `-O0` 到 `-O3`）的变化而导致时延大幅缩短甚至被优化掉。
Cortex-M3/M4/M7/H7 等内核提供了一个 **数据观察点和跟踪（DWT）** 外设。它包含一个 32 位的时钟周期计数器 `CYCCNT`，与 CPU 主频同频自增（如 168MHz 时每秒计数 168,000,000 次），能够提供极其确定的高精度延时。

#### DWT 初始化与延时实现

```c
#include "stm32f4xx_hal.h" // 视具体平台而定

/**
 * @brief  初始化 Cortex-M 内核的 DWT 外设计数器
 */
static inline void SoftI2C_DWT_Init(void) {
    // 开启 CoreDebug 外设的跟踪使能 TRCENA
    if (!(CoreDebug->DEMCR & CoreDebug_DEMCR_TRCENA_Msk)) {
        CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    }
    // 复位周期计数器
    DWT->CYCCNT = 0U;
    // 使能 DWT 周期计数器自增
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

/**
 * @brief  基于 DWT 周期计数器实现的高精度微秒级阻塞延时
 * @param  us: 延时微秒数
 * @note   支持 CPU 主频动态改变，且与编译器优化级别无关
 */
static inline void SoftI2C_Delay_us(uint32_t us) {
    uint32_t start_tick = DWT->CYCCNT;
    // 计算所需时钟周期数：us * (SystemCoreClock / 1,000,000)
    uint32_t delay_ticks = us * (SystemCoreClock / 1000000U);
    
    // 使用无符号数差值运算，能够完美解决 CYCCNT 32位溢出回零问题
    while ((DWT->CYCCNT - start_tick) < delay_ticks) {
        // 等待时钟周期数累加达到目标值
    }
}
```

### 完整元动作 C 语言实现 (SoftI2C Core)

以下是具备**时钟拉伸检测**与**高精度延时**的底层模拟 I2C 时序元动作的完整实现。

#### 1. 结构体与宏定义

```c
// 物理配置参数结构体
typedef struct {
    GPIO_TypeDef *SCL_Port;
    uint16_t SCL_Pin;
    GPIO_TypeDef *SDA_Port;
    uint16_t SDA_Pin;
    uint32_t Delay_us;     // 时序半周期延时参数 (100kHz 选择 5us，400kHz 选择 2us)
    uint32_t Timeout;      // SCL 拉伸与 ACK 检测的最大阻塞计数阈值
} SoftI2C_Configt;

// 原子控制引脚宏定义
#define SDA_HIGH(cfg)   ((cfg)->SDA_Port->BSRR = (cfg)->SDA_Pin)
#define SDA_LOW(cfg)    ((cfg)->SDA_Port->BSRR = ((uint32_t)(cfg)->SDA_Pin << 16))
#define SCL_HIGH(cfg)   ((cfg)->SCL_Port->BSRR = (cfg)->SCL_Pin)
#define SCL_LOW(cfg)    ((cfg)->SCL_Port->BSRR = ((uint32_t)(cfg)->SCL_Pin << 16))

// 输入状态读取宏定义
#define READ_SDA(cfg)   (((cfg)->SDA_Port->IDR & (cfg)->SDA_Pin) ? 1U : 0U)
#define READ_SCL(cfg)   (((cfg)->SCL_Port->IDR & (cfg)->SCL_Pin) ? 1U : 0U)
```

#### 2. 起始与停止信号 (START / STOP)

```c
/**
 * @brief  生成 I2C 起始条件 (START)
 * @param  config: I2C 通道引脚与延时参数配置
 * @retval HAL_OK: 成功生成起始信号; HAL_TIMEOUT: SCL被拉死，发生超时
 */
HAL_StatusTypeDef SoftI2C_Start(const SoftI2C_Configt *config) {
    // 确保总线空闲，释放 SDA 与 SCL
    SDA_HIGH(config);
    SCL_HIGH(config);
    SoftI2C_Delay_us(config->Delay_us);

    // 检测时钟拉伸：如果从机拉低了 SCL，主机必须等待
    uint32_t sda_stretch_timeout = config->Timeout;
    while (READ_SCL(config) == 0U) {
        if (--sda_stretch_timeout == 0U) {
            return HAL_TIMEOUT; // 从机强行拉低 SCL，发生超时
        }
        SoftI2C_Delay_us(1U);
    }

    // 检测总线状态：若此时 SDA 为低，说明总线被异常占用
    if (READ_SDA(config) == 0U) {
        return HAL_ERROR;
    }

    SDA_LOW(config); // SCL 仍为高时，拉低 SDA，产生起始下降沿
    SoftI2C_Delay_us(config->Delay_us);
    SCL_LOW(config); // 随后拉低 SCL，准备进入数据发送阶段
    SoftI2C_Delay_us(config->Delay_us);
    return HAL_OK;
}

/**
 * @brief  生成 I2C 停止条件 (STOP)
 * @param  config: I2C 通道引脚与延时参数配置
 * @retval HAL_OK: 成功生成停止信号; HAL_TIMEOUT: 时钟拉伸超时
 */
HAL_StatusTypeDef SoftI2C_Stop(const SoftI2C_Configt *config) {
    SDA_LOW(config); // 确保 SDA 处于低电平
    SoftI2C_Delay_us(config->Delay_us);
    SCL_HIGH(config); // 拉高 SCL
    
    // 等待从机释放 SCL 信号 (时钟拉伸)
    uint32_t scl_stretch_timeout = config->Timeout;
    while (READ_SCL(config) == 0U) {
        if (--scl_stretch_timeout == 0U) {
            return HAL_TIMEOUT;
        }
        SoftI2C_Delay_us(1U);
    }
    SoftI2C_Delay_us(config->Delay_us);
    
    SDA_HIGH(config); // SCL 为高电平期间，拉高 SDA，产生停止上升沿
    SoftI2C_Delay_us(config->Delay_us);
    return HAL_OK;
}
```

#### 3. 字节写操作与应答获取 (WriteByte)

```c
/**
 * @brief  向总线写入一个字节 (MSB先行) 并获取从机应答
 * @param  config: I2C 通道引脚与延时参数配置
 * @param  byte: 待发送的 8-bit 数据
 * @retval HAL_OK: 收到从机 ACK(0); HAL_ERROR: 收到 NACK(1); HAL_TIMEOUT: 时钟拉伸超时
 */
HAL_StatusTypeDef SoftI2C_WriteByte(const SoftI2C_Configt *config, uint8_t byte) {
    // 循环发送 8 个数据位
    for (uint8_t i = 0U; i < 8U; i++) {
        // 根据当前最高位状态更新 SDA 物理电平
        if (byte & 0x80U) {
            SDA_HIGH(config);
        } else {
            SDA_LOW(config);
        }
        byte <<= 1U;
        SoftI2C_Delay_us(config->Delay_us);

        SCL_HIGH(config); // 释放 SCL，此时 SDA 必须保持稳定
        
        // 时钟拉伸检测
        uint32_t stretch_timeout = config->Timeout;
        while (READ_SCL(config) == 0U) {
            if (--stretch_timeout == 0U) {
                return HAL_TIMEOUT;
            }
            SoftI2C_Delay_us(1U);
        }
        
        SoftI2C_Delay_us(config->Delay_us);
        SCL_LOW(config); // 结束本位时钟，允许下一次电平改变
    }

    // --- 应答采样周期 ---
    SDA_HIGH(config); // 主机释放 SDA，准备接收从机的 ACK/NACK
    SoftI2C_Delay_us(config->Delay_us);
    SCL_HIGH(config); // 拉高 SCL 开始采样应答

    // 时钟拉伸检测
    uint32_t stretch_timeout = config->Timeout;
    while (READ_SCL(config) == 0U) {
        if (--stretch_timeout == 0U) {
            return HAL_TIMEOUT;
        }
        SoftI2C_Delay_us(1U);
    }

    // 此时从机若返回 ACK，应拉低 SDA；若返回 NACK，释放 SDA 呈高
    uint8_t ack_state = READ_SDA(config);
    SoftI2C_Delay_us(config->Delay_us);
    
    SCL_LOW(config); // 拉低时钟，结束应答周期
    SoftI2C_Delay_us(config->Delay_us);

    // I2C 官方规定：0 表示 ACK，1 表示 NACK
    return (ack_state == 0U) ? HAL_OK : HAL_ERROR;
}
```

#### 4. 字节读操作与应答生成 (ReadByte)

```c
/**
 * @brief  从总线读取一个字节并发送 ACK 或 NACK
 * @param  config: I2C 通道引脚与延时参数配置
 * @param  ack_action: 0 表示接收后发送有效应答 ACK; 1 表示发送非应答 NACK
 * @param  pData: 存放读取字节的缓冲区指针
 * @retval HAL_OK: 读取成功; HAL_TIMEOUT: 从机拉伸 SCL 超时
 */
HAL_StatusTypeDef SoftI2C_ReadByte(const SoftI2C_Configt *config, uint8_t ack_action, uint8_t *pData) {
    uint8_t temp_byte = 0U;

    SDA_HIGH(config); // 主机释放 SDA 端口，使其呈输入就绪状态
    SoftI2C_Delay_us(config->Delay_us);

    for (uint8_t i = 0U; i < 8U; i++) {
        SCL_HIGH(config); // 释放 SCL，通知从机开始输出数据
        
        // 时钟拉伸检测
        uint32_t stretch_timeout = config->Timeout;
        while (READ_SCL(config) == 0U) {
            if (--stretch_timeout == 0U) {
                return HAL_TIMEOUT;
            }
            SoftI2C_Delay_us(1U);
        }

        temp_byte <<= 1U;
        // 采样 SDA 上的物理电平
        if (READ_SDA(config)) {
            temp_byte |= 0x01U;
        }
        
        SoftI2C_Delay_us(config->Delay_us);
        SCL_LOW(config); // 拉低 SCL
        SoftI2C_Delay_us(config->Delay_us);
    }

    *pData = temp_byte;

    // --- 生成应答周期 ---
    if (ack_action == 0U) {
        SDA_LOW(config);  // 主机主动拉低 SDA，发送 ACK (0)
    } else {
        SDA_HIGH(config); // 主机释放 SDA，发送 NACK (1)
    }
    SoftI2C_Delay_us(config->Delay_us);
    SCL_HIGH(config); // 拉高 SCL 发送应答

    // 时钟拉伸检测
    uint32_t stretch_timeout = config->Timeout;
    while (READ_SCL(config) == 0U) {
        if (--stretch_timeout == 0U) {
            return HAL_TIMEOUT;
        }
        SoftI2C_Delay_us(1U);
    }
    
    SoftI2C_Delay_us(config->Delay_us);
    SCL_LOW(config);  // 结束应答时钟
    SDA_HIGH(config); // 重新释放 SDA 总线
    SoftI2C_Delay_us(config->Delay_us);

    return HAL_OK;
}
```

---

## 4. 总结与物理时序测试建议

在真实硬件部署时，建议使用示波器或逻辑分析仪（如 Saleae Logic）对生成的 SCL 与 SDA 波形进行物理测量：
1. **测试上升沿时间 \\(t_r\\)**：测量 SCL 由 0.3VCC 升至 0.7VCC 的实际时间，若大于 300ns (快速模式下)，应考虑更换更小阻值的物理上拉电阻。
2. **校验 START 建立时间**：验证 SDA 发生跳变与 SCL 变高之间的真实延迟，应完全满足 \\(t_{SU;STA} \ge 0.6\mu\text{s}\\)（快速模式）的要求。

接下来，我们将继续探讨因强干扰或主机中途复位引发的“从机持续拉低 SDA 导致总线锁死（死锁）”问题，以及如何在此底层时序代码中优雅实现总线物理自愈恢复。
