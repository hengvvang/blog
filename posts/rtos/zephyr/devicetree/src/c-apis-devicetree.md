# 第三章：C API 设备树访问层与驱动解耦实战

在前两章中，我们了解了设备树的语法架构以及它如何在编译期被翻译成扁平化的底层 C 宏。在本章中，我们将学习如何在实际编写 C 代码时，安全地利用 Zephyr 的标准 C API 访问设备树信息。最后，我们将结合前文设计的拓扑，完成一个生产级的 SPI 传感器驱动实例化开发。

---

## 1. 官方 C 预处理宏 API 详解

为了避免代码直接依赖形如 `DT_N_S_soc_S_spi_40013000...` 这样极易因硬件微调而失效的内部底层宏，Zephyr 在 `<zephyr/devicetree.h>` 中向我们开放了一套结构清晰、类型安全的 C 预处理宏 API。

### 1.1 节点标识符获取（Node Identifiers）
要在 C 代码中操作一个设备树节点，首先必须获取其“节点标识符（Node Identifier）”：

* **`DT_NODELABEL(label)`**：最常用。传入你在 DTS 中定义的标签名。
  ```c
  #define MY_SPI_NODE DT_NODELABEL(spi1)
  ```
* **`DT_PATH(path...)`**：根据从根节点开始的绝对路径节点序列来定位。
  ```c
  #define MY_SPI_NODE DT_PATH(soc, spi_40013000)
  ```
* **`DT_ALIAS(alias)`**：通过 `aliases` 节点中定义的全局别名来定位。
  ```c
  #define TEMP_SENSOR_NODE DT_ALIAS(temp_sensor)
  ```

### 1.2 属性提取宏（Property Accessors）
有了节点标识符后，可以通过属性提取宏拉取具体的配置值：

* **`DT_PROP(node_id, prop)`**：获取节点中普通属性的值。
  ```c
  int max_freq = DT_PROP(DT_NODELABEL(tmp112), spi_max_frequency); // 展开为 2000000
  ```
* **`DT_REG_ADDR(node_id)` / `DT_REG_SIZE(node_id)`**：获取寄存器基地址和大小。
  ```c
  uintptr_t reg_addr = DT_REG_ADDR(DT_NODELABEL(spi1)); // 展开为 0x40013000
  ```
* **`DT_ENUM_TOKEN(node_id, prop)`**：获取枚举类型的 token，多用于 C 语言的 `switch-case` 判定。
* **`DT_NODE_HAS_STATUS(node_id, status)`**：检查节点是否处于特定的使能状态（如 `okay`）。
  ```c
  #if DT_NODE_HAS_STATUS(DT_NODELABEL(tmp112), okay)
      /* 编译此段代码 */
  #endif
  ```

### 1.3 GPIO 与 Phandle-Array 专属宏
GPIO 属性属于 `phandle-array`。对于此类属性，Zephyr 提供了特化的便捷宏：

```c
#define TMP112_NODE DT_NODELABEL(tmp112)

// 获取 alert-gpios 关联的 GPIO 控制器设备对象名称/指针
#define GPIO_CTRL_NODE DT_GPIO_CTLR(TMP112_NODE, alert_gpios) 
// 获取引脚编号 (4)
#define ALERT_PIN      DT_GPIO_PIN(TMP112_NODE, alert_gpios)
// 获取配置标志位 (1)
#define ALERT_FLAGS    DT_GPIO_FLAGS(TMP112_NODE, alert_gpios)
```

---

## 2. 基于 `DT_INST` 驱动实例化设计模式

在开发外设驱动程序时，我们的 C 源码不应当绑定到任何特定的设备树 Label 上（例如在驱动中直接写 `DT_NODELABEL(tmp112)` 是一种反模式，这会导致当板子上挂载了第二个相同型号的传感器时，驱动代码无法复用）。

为了实现“编写一次驱动，根据设备树自动实例化任意个物理设备”，Zephyr 推荐使用 **`DT_INST` 系列宏**。

### 2.1 `DT_DRV_COMPAT` 机制
在驱动 C 文件的开头，定义当前驱动所服务的 `compatible` 属性名：

```c
#define DT_DRV_COMPAT ti_tmp112
```

一旦定义了 `DT_DRV_COMPAT`，我们就获得了使用 `DT_INST(inst, compat)` 的权利。这里的 `inst` 是从 0 开始的自动递增索引。例如，若设备树中使能了两个 `ti,tmp112` 设备，系统在编译时就会存在 `DT_INST(0, ti_tmp112)` 和 `DT_INST(1, ti,tmp112)`。

### 2.2 `DT_INST_FOREACH_STATUS_OKAY` 循环生成模式
我们可以通过一个预处理回调宏，配合 `DT_INST_FOREACH_STATUS_OKAY`，在编译期自动根据设备树的节点个数，生成对应数量的驱动实例与控制结构体：

```c
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

// 为所有状态为 "okay" 且兼容 "ti,tmp112" 的节点执行批量宏展开
DT_INST_FOREACH_STATUS_OKAY(TMP112_DEFINE)
```

---

## 3. 生产级自定义驱动实战：`ti,tmp112` 温度传感器驱动

接下来，我们编写一个符合 Zephyr 驱动模型、完全与硬件细节解耦的 `ti,tmp112` 传感器驱动。它通过设备树宏静态配置 SPI 通信总线和报警 GPIO。

### 驱动程序源码 `tmp112.c`

```c
#define DT_DRV_COMPAT ti_tmp112

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(TMP112, CONFIG_SENSOR_LOG_LEVEL);

/* 设备配置常量结构体 (只读，存放在 Flash 中) */
struct tmp112_config {
    struct spi_dt_spec spi;
    struct gpio_dt_spec alert_gpio;
    uint8_t overtemp_threshold;
};

/* 设备运行期数据结构体 (可写，存放在 RAM 中) */
struct tmp112_data {
    int16_t current_temp;
    struct gpio_callback gpio_cb;
};

/* 传感器硬件接口函数 */
static int tmp112_read_reg(const struct device *dev, uint8_t reg, uint16_t *val)
{
    const struct tmp112_config *config = dev->config;
    uint8_t tx_buf[1] = { reg };
    uint8_t rx_buf[2] = { 0 };

    const struct spi_buf tx_bufs[] = {
        { .buf = tx_buf, .len = sizeof(tx_buf) }
    };
    const struct spi_buf_set tx = { .buffers = tx_bufs, .count = ARRAY_SIZE(tx_bufs) };

    struct spi_buf rx_bufs[] = {
        { .buf = NULL, .len = sizeof(tx_buf) }, // 跳过写入的寄存器地址长度
        { .buf = rx_buf, .len = sizeof(rx_buf) }
    };
    const struct spi_buf_set rx = { .buffers = rx_bufs, .count = ARRAY_SIZE(rx_bufs) };

    // 利用静态绑定的 SPI spec 执行传输，无需手动组装片选控制
    int ret = spi_transceive_dt(&config->spi, &tx, &rx);
    if (ret < 0) {
        LOG_ERR("SPI read failed: %d", ret);
        return ret;
    }

    *val = (rx_buf[0] << 8) | rx_buf[1];
    return 0;
}

/* 报警 GPIO 中断回调函数 */
static void tmp112_alert_handler(const struct device *port, struct gpio_callback *cb, gpio_port_pins_t pins)
{
    // 通过 CONTAINER_OF 逆向获取运行期数据区
    struct tmp112_data *data = CONTAINER_OF(cb, struct tmp112_data, gpio_cb);
    LOG_WRN("Overtemperature Alert Triggered! Last known temp: %d oC", data->current_temp);
}

/* 设备驱动初始化入口 */
static int tmp112_init(const struct device *dev)
{
    const struct tmp112_config *config = dev->config;
    struct tmp112_data *data = dev->data;
    int ret;

    LOG_INF("Initializing TMP112 sensor instance...");

    // 1. 验证编译期绑定的 SPI 总线设备是否就绪
    if (!spi_is_ready_dt(&config->spi)) {
        LOG_ERR("SPI bus device not ready");
        return -ENODEV;
    }

    // 2. 验证并配置编译期绑定的 GPIO 报警引脚
    if (config->alert_gpio.port != NULL) {
        if (!gpio_is_ready_dt(&config->alert_gpio)) {
            LOG_ERR("Alert GPIO device not ready");
            return -ENODEV;
        }

        // 配置 GPIO 输入引脚 (极性和拉电阻由 DTS 静态标志决定)
        ret = gpio_pin_configure_dt(&config->alert_gpio, GPIO_INPUT);
        if (ret < 0) {
            LOG_ERR("Failed to configure Alert GPIO: %d", ret);
            return ret;
        }

        // 绑定中断回调
        gpio_init_callback(&data->gpio_cb, tmp112_alert_handler, BIT(config->alert_gpio.pin));
        ret = gpio_add_callback(config->alert_gpio.port, &data->gpio_cb);
        if (ret < 0) {
            LOG_ERR("Failed to add GPIO callback: %d", ret);
            return ret;
        }

        // 启用中断触发模式 (高/低电平触发从 DTS 中解析)
        ret = gpio_pin_interrupt_configure_dt(&config->alert_gpio, GPIO_INT_EDGE_TO_ACTIVE);
        if (ret < 0) {
            LOG_ERR("Failed to configure GPIO interrupt: %d", ret);
            return ret;
        }
    }

    LOG_INF("TMP112 configured with Overtemp Threshold: %d C", config->overtemp_threshold);
    return 0;
}

/* 虚构的驱动内部 API 结构体 */
static const struct sensor_driver_api tmp112_api = {
    // 挂载标准的 Zephyr 传感器接口函数，如 channel_get, sample_fetch 等
};

/* 自动生成实例的核心定义 */
#define TMP112_INST_DEFINE(inst)                                                          \
    static struct tmp112_data tmp112_data_##inst;                                          \
    static const struct tmp112_config tmp112_config_##inst = {                            \
        .spi = SPI_DT_SPEC_INST_GET(inst, SPI_WORD_SET(8) | SPI_TRANSFER_MSB, 0),         \
        .alert_gpio = GPIO_DT_SPEC_INST_GET_OR(inst, alert_gpios, {0}),                   \
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

/* 根据设备树中 ti,tmp112 的实例个数，循环展开定义 */
DT_INST_FOREACH_STATUS_OKAY(TMP112_INST_DEFINE)
```

---

## 4. 调试与排错指南

在开发基于设备树的系统时，编译报错通常较为晦涩。以下是常见的错误模型与排查路径：

### 4.1 错误：“`DT_N_S_..._EXISTS` is undefined” 或找不到宏
* **典型诱因**：在 C 代码中引用了 `DT_NODELABEL(tmp112)`，但编译报错提示宏未定义。
* **排查方案**：
  1. 确认该节点在设备树合并后的状态是否为 `status = "okay"`。如果被配置为 `"disabled"`，工具链不会为其生成存在性宏。
  2. 确认设备树拼写是否正确。检查 `app.overlay` 或 board 级的 `.dts` 拼写是否出现了字母错误。
  3. 确认兼容性属性（`compatible`）拼写是否正确，且与指定的 Binding 文件完全匹配。

### 4.2 错误：“`devicetree_generated.h`: No such file or directory”
* **典型诱因**：构建系统未能生成中间头文件。
* **排查方案**：
  1. 这通常意味着在 CMake 解析阶段就发生了致命语法错误。
  2. 向上翻阅 CMake 的输出日志，找到 Python 脚本（`edtlib.py`）抛出的 Traceback 异常。它通常会给出具体的行号和由于不符合 Binding 约束而导致的校验错误信息（例如：`Property 'spi-max-frequency' is required but missing in node...`）。

### 4.3 静态排错技巧：查看中间生成产物
不要盲目猜测宏名，可以直接查看编译器生成的终极扁平化宏定义：
* **产物路径**：打开工程构建目录下的 `build/zephyr/include/generated/devicetree_generated.h`。
* **使用方式**：使用搜索功能直接定位你的外设名称（如 `tmp112` 或 `spi`），即可直接观察到生成了哪些宏定义以及各属性的解析数值。这对于调试 phandle 引用或复杂数组属性极其高效。
