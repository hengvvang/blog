# 第三章：C API 设备树访问层与驱动解耦实战

在前两章中，我们详细了解了设备树的语法树继承规则以及它在编译期如何根据 YAML 绑定翻译成扁平化的 C 宏。在本章中，我们将深入学习如何在实际编写 C 代码时，安全地利用 Zephyr 的标准 C API 访问这些设备树配置。最后，我们将结合前文设计的拓扑，实战编写一个生产级的 SPI 传感器解耦驱动程序。

---

## 1. 官方 C 预处理宏 API 详解

为了避免代码直接依赖形如 `DT_N_S_soc_S_spi_40013000...` 这样极其脆弱且随着硬件微调就失效的内部扁平化宏，Zephyr 在 `<zephyr/devicetree.h>` 中封装了一套规范、类型安全且高可读性的标准 C 预处理宏 API。

### 1.1 节点标识符获取（Node Identifiers）

要在 C 代码中操作一个设备树节点，第一步是获取其**节点标识符（Node Identifier）**。节点标识符在预处理阶段可以直接传递给其他属性提取宏。

* **`DT_NODELABEL(label)`**：最常用。直接传入你在 DTS 中定义的节点标签名。
  ```c
  /* 获取标签为 spi1 的节点标识符 */
  #define MY_SPI_NODE DT_NODELABEL(spi1)
  ```
* **`DT_PATH(path...)`**：根据从根节点开始的绝对路径节点序列来定位。
  ```c
  /* 通过绝对路径 /soc/spi@40013000 定位节点 */
  #define MY_SPI_NODE DT_PATH(soc, spi_40013000)
  ```
* **`DT_ALIAS(alias)`**：通过 `aliases` 节点中定义的全局别名来定位。
  ```c
  /* 通过别名 temp-sensor 定位物理节点 */
  #define TEMP_SENSOR_NODE DT_ALIAS(temp_sensor)
  ```

### 1.2 属性提取宏（Property Accessors）

一旦拿到了节点标识符，就可以通过属性提取宏拉取具体的数据值：

* **`DT_PROP(node_id, prop)`**：获取节点中普通属性的值。
  ```c
  /* 获取温度传感器节点的最大工作速率属性值 */
  int max_freq = DT_PROP(DT_NODELABEL(tmp112), spi_max_frequency); /* 预处理期展开为 2000000 */
  ```
* **`DT_REG_ADDR(node_id)` / `DT_REG_SIZE(node_id)`**：获取物理寄存器基地址和空间长度。
  ```c
  /* 获取 SPI1 控制器的物理寄存器基地址 */
  uintptr_t reg_addr = DT_REG_ADDR(DT_NODELABEL(spi1)); /* 预处理期展开为 0x40013000 */
  ```
* **`DT_NODE_HAS_STATUS(node_id, status)`**：检查节点是否处于特定的使能状态（如 `okay`）。
  ```c
  #if DT_NODE_HAS_STATUS(DT_NODELABEL(tmp112), okay)
      /* 只有当 tmp112 外设在设备树中被激活使能时，才编译此段代码 */
  #endif
  ```

### 1.3 GPIO 与 Phandle-Array 属性提取宏

GPIO 属性属于复杂的 `phandle-array` 结构。对于此类属性，Zephyr 提供了特化的快捷提取宏：

```c
#define TMP112_NODE DT_NODELABEL(tmp112)

/* 获取 alert-gpios 关联的 GPIO 控制器设备树节点标识符 */
#define GPIO_CTRL_NODE DT_GPIO_CTLR(TMP112_NODE, alert_gpios) 
/* 获取引脚编号值 (4) */
#define ALERT_PIN      DT_GPIO_PIN(TMP112_NODE, alert_gpios)
/* 获取引脚配置标志位值 (1) */
#define ALERT_FLAGS    DT_GPIO_FLAGS(TMP112_NODE, alert_gpios)
```

---

## 2. 基于 `DT_INST` 驱动实例化设计模式

在开发可复用的外设驱动程序时，**禁止**在驱动 C 源码中直接硬编码任何具体的设备树 Label（例如在驱动中直接写 `DT_NODELABEL(tmp112)` 是一种低移植性的反模式。这会导致如果板上挂载了两个相同型号的传感器时，驱动代码无法复用）。

为了实现**“一次编写，根据设备树自动实例化任意个物理设备”**，Zephyr 设计了 **`DT_INST` 驱动实例化模式**。

### 2.1 `DT_DRV_COMPAT` 机制

在驱动 C 文件的开头，必须定义当前驱动服务的 `compatible` 属性名（将其中的特殊字符转为下划线）：

```c
#define DT_DRV_COMPAT ti_tmp112
```

一旦声明了 `DT_DRV_COMPAT`，该 C 文件中便被赋予了使用 `DT_INST(inst, compat)` 的权力。这里的 `inst` 是指**状态为 okay 的该兼容设备在全局的自动递增索引**（从 0 开始）。
例如，如果设备树中使能了两个 `ti,tmp112` 设备，系统在编译期就会生成 `DT_INST(0, ti_tmp112)` 和 `DT_INST(1, ti_tmp112)` 两个合法的节点 ID。

### 2.2 `DT_INST_FOREACH_STATUS_OKAY` 循环生成模式

配合预处理宏回调，我们可以在编译期自动根据设备树使能的节点个数，生成对应数量的驱动实例、配置结构体与内核设备注册定义：

```c
/* 实例化回调定义 */
#define TMP112_DEFINE(inst)                                        \
    static struct tmp112_data tmp112_data_##inst;                  \
    static const struct tmp112_config tmp112_config_##inst = {    \
        .spi = SPI_DT_SPEC_INST_GET(inst, SPI_OP_MODE_MASTER, 0),  \
        .alert_gpio = GPIO_DT_SPEC_INST_GET_OR(inst, alert_gpios, {0}) \
    };                                                             \
    DEVICE_DT_INST_DEFINE(inst,                                    \
                        tmp112_init,                               \
                        NULL,                                      \
                        &tmp112_data_##inst,                       \
                        &tmp112_config_##inst,                     \
                        POST_KERNEL,                               \
                        CONFIG_SENSOR_INIT_PRIORITY,               \
                        &tmp112_api);

/* 为所有使能且兼容 ti,tmp112 的节点执行批量宏展开 */
DT_INST_FOREACH_STATUS_OKAY(TMP112_DEFINE)
```

---

## 3. 生产级自定义驱动实战：`ti,tmp112` 温度传感器驱动

接下来，我们编写一个符合 Zephyr 驱动模型、完全与物理硬件细节解耦的 `ti,tmp112` 传感器驱动。它通过编译期宏静态绑定 SPI 通信总线和报警 GPIO。

### 3.1 宏替换与静态数据绑定路径图

```
 +--------------------------------------------------------------------------------+
 |                           编译期静态驱动数据流                                 |
 +--------------------------------------------------------------------------------+
 |                                                                                |
 |  [DTS 节点: tmp112: temp@0]                                                    |
 |        │                                                                       |
 |        ├─► spi-max-frequency = <2000000>                                       |
 |        ├─► alert-gpios = <&gpioa 4 1>                                          |
 |        └─► overtemp-threshold = <75>                                           |
 |                                                                                |
 |  [C 宏翻译阶段: DT_INST_FOREACH_STATUS_OKAY]                                   |
 |        │                                                                       |
 |        ▼ 翻译展开为 C 语言静态结构体实例                                       |
 |  static const struct tmp112_config tmp112_config_0 = {                         |
 |      .spi = {                                                                  |
 |          .bus = DEVICE_DT_GET(DT_NODELABEL(spi1)),                             |
 |          .config = {                                                           |
 |              .frequency = 2000000,                                             |
 |              .operation = SPI_WORD_SET(8) | SPI_TRANSFER_MSB,                  |
 |              .slave = 0,                                                       |
 |              .cs = &cs_ctrl_struct                                             |
 |          }                                                                     |
 |      },                                                                        |
 |      .alert_gpio = {                                                           |
 |          .port = DEVICE_DT_GET(DT_NODELABEL(gpioa)),                           |
 |          .pin = 4,                                                             |
 |          .dt_flags = 1                                                         |
 |      },                                                                        |
 |      .overtemp_threshold = 75                                                  |
 |  };                                                                            |
 |                                                                                |
 +--------------------------------------------------------------------------------+
```

### 3.2 驱动程序源码：`tmp112.c`

```c
/* 
 * tmp112.c - 生产级温度传感器驱动源码 
 */
#define DT_DRV_COMPAT ti_tmp112 /* 声明该驱动服务于 ti,tmp112 兼容外设 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/logging/log.h>

/* 注册传感器日志模块 */
LOG_MODULE_REGISTER(TMP112, CONFIG_SENSOR_LOG_LEVEL);

/* 设备配置常量结构体 (只读，编译后存放在 Flash 中) */
struct tmp112_config {
    struct spi_dt_spec spi;           /* 自动打包的 SPI 节点规格定义 */
    struct gpio_dt_spec alert_gpio;   /* 自动打包的 GPIO 节点规格定义 */
    uint8_t overtemp_threshold;       /* 过温警报门限值 */
};

/* 设备运行期数据结构体 (可写，存放在 RAM 中) */
struct tmp112_data {
    int16_t current_temp;             /* 缓存当前读取的温度值 */
    struct gpio_callback gpio_cb;     /* 报警 GPIO 中断回调结构体 */
};

/* 传感器寄存器读取函数 */
static int tmp112_read_reg(const struct device *dev, uint8_t reg, uint16_t *val)
{
    const struct tmp112_config *config = dev->config;
    uint8_t tx_buf[1] = { reg };
    uint8_t rx_buf[2] = { 0 };

    /* 构造发送缓冲区 */
    const struct spi_buf tx_bufs[] = {
        { .buf = tx_buf, .len = sizeof(tx_buf) }
    };
    const struct spi_buf_set tx = { .buffers = tx_bufs, .count = ARRAY_SIZE(tx_bufs) };

    /* 构造接收缓冲区 */
    struct spi_buf rx_bufs[] = {
        { .buf = NULL, .len = sizeof(tx_buf) }, /* 跳过写入寄存器地址时的接收字节占位 */
        { .buf = rx_buf, .len = sizeof(rx_buf) }
    };
    const struct spi_buf_set rx = { .buffers = rx_bufs, .count = ARRAY_SIZE(rx_bufs) };

    /* 
     * 利用设备树中静态绑定的 SPI spec 直接执行双工传输，
     * spi_transceive_dt 内部会自动接管 cs-gpios 声明的片选引脚，无需手动控制拉高/拉低。
     */
    int ret = spi_transceive_dt(&config->spi, &tx, &rx);
    if (ret < 0) {
        LOG_ERR("SPI transfer failed: %d", ret);
        return ret;
    }

    *val = (rx_buf[0] << 8) | rx_buf[1];
    return 0;
}

/* 报警 GPIO 硬件中断回调函数 */
static void tmp112_alert_handler(const struct device *port, struct gpio_callback *cb, gpio_port_pins_t pins)
{
    /* 
     * 核心技巧：通过 CONTAINER_OF 逆向寻址，
     * 从 gpio_callback 成员指针逆向推导出它所在的物理 tmp112_data 实例内存首地址。
     */
    struct tmp112_data *data = CONTAINER_OF(cb, struct tmp112_data, gpio_cb);
    LOG_WRN("Overtemperature Alert Triggered! Last known temp: %d C", data->current_temp);
}

/* 物理设备驱动初始化入口 */
static int tmp112_init(const struct device *dev)
{
    const struct tmp112_config *config = dev->config;
    struct tmp112_data *data = dev->data;
    int ret;

    LOG_INF("Initializing TMP112 sensor instance...");

    /* 1. 验证编译期绑定的 SPI 总线设备是否就绪 */
    if (!spi_is_ready_dt(&config->spi)) {
        LOG_ERR("Parent SPI bus device not ready");
        return -ENODEV;
    }

    /* 2. 验证并配置编译期绑定的 GPIO 报警引脚 */
    if (config->alert_gpio.port != NULL) {
        if (!gpio_is_ready_dt(&config->alert_gpio)) {
            LOG_ERR("Alert GPIO controller device not ready");
            return -ENODEV;
        }

        /* 配置 GPIO 输入引脚 (引脚编号和极性 flags 完全由设备树中 alert-gpios = <&gpioa 4 1> 自动翻译) */
        ret = gpio_pin_configure_dt(&config->alert_gpio, GPIO_INPUT);
        if (ret < 0) {
            LOG_ERR("Failed to configure Alert GPIO: %d", ret);
            return ret;
        }

        /* 绑定物理中断回调句柄 */
        gpio_init_callback(&data->gpio_cb, tmp112_alert_handler, BIT(config->alert_gpio.pin));
        ret = gpio_add_callback(config->alert_gpio.port, &data->gpio_cb);
        if (ret < 0) {
            LOG_ERR("Failed to register GPIO callback: %d", ret);
            return ret;
        }

        /* 启用中断触发模式 (高/低电平触发配置自动从设备树中解析翻译) */
        ret = gpio_pin_interrupt_configure_dt(&config->alert_gpio, GPIO_INT_EDGE_TO_ACTIVE);
        if (ret < 0) {
            LOG_ERR("Failed to configure GPIO interrupt trigger: %d", ret);
            return ret;
        }
    }

    LOG_INF("TMP112 configured with Overtemp Threshold: %d C", config->overtemp_threshold);
    return 0;
}

/* 传感器标准操作接口定义 */
static const struct sensor_driver_api tmp112_api = {
    /* 此处挂载标准的 Zephyr 传感器接口虚函数，如 sample_fetch, channel_get */
};

/* 自动生成实例的核心实例化宏 */
#define TMP112_INST_DEFINE(inst)                                                          \
    static struct tmp112_data tmp112_data_##inst;                                          \
    static const struct tmp112_config tmp112_config_##inst = {                            \
        /* 提取对应实例的 SPI 总线规格，配置字长为 8 bits 且 MSB 优先发送 */              \
        .spi = SPI_DT_SPEC_INST_GET(inst, SPI_WORD_SET(8) | SPI_TRANSFER_MSB, 0),         \
        /* 安全获取 GPIO 规格，如果该实例没配置 alert-gpios，则优雅返回空结构体防止报错 */  \
        .alert_gpio = GPIO_DT_SPEC_INST_GET_OR(inst, alert_gpios, {0}),                   \
        /* 获取过温阈值属性，若 DTS 中没有配置，则默认采用 80 摄氏度 */                     \
        .overtemp_threshold = DT_INST_PROP_OR(inst, overtemp_threshold, 80),              \
    };                                                                                    \
    DEVICE_DT_INST_DEFINE(inst,                                                           \
                          tmp112_init,                                                    \
                          NULL,                                                           \
                          &tmp112_data_##inst,                                            \
                          &tmp112_config_##inst,                                          \
                          POST_KERNEL,                                                    \
                          CONFIG_SENSOR_INIT_PRIORITY,                                    \
                          &tmp112_api);

/* 根据设备树中匹配 ti,tmp112 且 status 为 okay 的节点数量，批量展开静态实例 */
DT_INST_FOREACH_STATUS_OKAY(TMP112_INST_DEFINE)
```

---

## 4. 调试与排错指南

在开发基于设备树的系统时，由于宏被层层嵌套，编译报错信息往往显得较为晦涩。以下是开发过程中常见的错误模型与排错方案：

### 4.1 典型错误一：“`DT_N_S_..._EXISTS` is undefined” 或报错提示找不到宏

* **致命诱因**：在 C 代码中调用了类似 `DT_NODELABEL(tmp112)` 的宏，但在编译时报错指示该宏未定义或不存在。
* **排查路径**：
  1. **检查 status 状态**：确认该物理节点在最终合并后的设备树中 `status` 是否被正确配置为 `"okay"`。如果节点处于 `"disabled"` 状态，工具链**不会**为其生成存在性定义宏。
  2. **核对拼写错误**：检查 `.overlay` 文件或板级 `.dts` 文件中标签引用的拼写是否出现了细微的字母错漏。
  3. **确认 compatible 匹配**：检查对应的 YAML 绑定文件是否存在并匹配当前节点 compatible 声明。

### 4.2 典型错误二：“`devicetree_generated.h`: No such file or directory”

* **致命诱因**：CMake 构建前期阶段异常中止，未生成底层的宏定义头文件。
* **排查路径**：
  1. 向上滚动 CMake 的日志，忽略 GCC 的级联报错，直接寻找 Python 脚本抛出的语义 traceback。
  2. 观察 `edtlib.py` 的校验报告。它会给出精确的行号，指示哪个属性由于不符合 YAML 规定的约束而导致校验失败（例如：`ti,tmp112.yaml` 规定 `spi-max-frequency` 为必填项 `required: true`，但你在 DTS 节点中遗漏了该属性声明）。

### 4.3 静态调试法宝：直接阅读 `devicetree_generated.h`

不要盲目猜测工具链生成的宏名称。你可以直接查看编译器生成的扁平化宏定义全景图：
* **文件物理路径**：打开你项目的构建目录 `build/zephyr/include/generated/devicetree_generated.h`。
* **调试方法**：使用文本编辑器的搜索功能，输入你的外设名或 Label（如 `tmp112` 或 `spi`），即可直接观察到生成了哪些底层的宏定义，以及各个引脚被翻译出的具体整数值。这对于调试片选引脚数组、中断向量引脚映射等复杂设备属性极其高效。
