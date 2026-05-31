# 第二章：Bindings 属性绑定匹配与编译期宏生成机制

设备树源文件在本质上是一种无强类型约束的物理拓扑文本，它自身无法阻拦用户输入拼写错误或提供无效的参数。为了实现静态检查并建立设备树与编译宏之间的映射桥梁，Zephyr 引入了 **YAML Bindings（绑定文件）** 机制。它是设备树的“元数据 Schema”，用以声明设备树节点应具备的合法属性、各属性的数据类型、父子节点间的总线依赖关系以及自动翻译宏的规则。

---

## 1. YAML Bindings 规范设计

在 Zephyr 中，Bindings 规范文件存放在 `dts/bindings/` 目录下（或者在用户自定义驱动的 `dts/bindings/` 目录中），其文件后缀为 `.yaml`。当解析器扫描设备树时，会提取节点声明的 `compatible` 属性，并在 Bindings 目录中进行文件名或 `compatible` 字段的全文匹配。

### 1.1 YAML 绑定的基本骨架

一个标准的 YAML Binding 文件由以下关键字段构成：

* **`compatible`**：匹配标识符。必须与 DTS 节点的 `compatible` 字符串完全一致。
* **`description`**：对该设备的文本描述，方便编译工具链输出驱动文档。
* **`properties`**：定义该节点拥有的所有属性的类型约束及必需性（`required`）。
* **`bus` / `on-bus`**：定义该设备所依赖或提供的物理总线类型（如 `spi`、`i2c`、`gpio`），用于自动分析主从挂载关系。

### 1.2 属性类型系统 (Property Types)

在 `properties` 字典下，每个属性都必须指定一种强类型：
* **`int`**：单个 32 位无符号整数。
* **`array`**：整数数组。
* **`string`**：单个字符串。
* **`string-array`**：字符串数组。
* **`boolean`**：布尔标志。在 DTS 中，该属性若被声明则为 `true`（无需写值），若未出现则被解析为 `false`。
* **`phandle`**：指向设备树中另一个节点 ID 的引用/指针。
* **`phandle-array`**：复杂的规格符元组数组。它通常包含一个指向控制器的 phandle 引用，外加若干个代表具体通道、引脚或配置标志的整型 Cell（如 GPIO 规格符、PWM 通道规格符等）。

---

## 2. YAML Binding 实例分析

根据第一章设计的 SPI 通信拓扑，我们为 SPI 主控制器和外挂的 TI 温度传感器编写两份生产级的 Binding 约束文件。

### 2.1 SPI 主控制器绑定：`acme,spi-host.yaml`

```yaml
# acme,spi-host.yaml
description: ACME High Performance SPI Host Controller

# 必须与 DTS 节点中的 compatible 字符串完全一致
compatible: "acme,spi-host"

# 引入核心库中的基础 SPI 控制器总线属性规范
include: spi-controller.yaml

properties:
  reg:
    required: true
    description: MMIO register physical base address and length.
  interrupts:
    required: true
    description: Hardware interrupt vectors.
  cs-gpios:
    type: phandle-array
    required: false
    description: GPIOs to use for Chip Select lines.
```

> [!NOTE]
> `include: spi-controller.yaml` 会自动继承 Zephyr 官方底座规范，从而引入 `#address-cells = <1>;` 和 `#size-cells = <0>;` 的默认属性约束。同时它将该控制器标记为 `bus: spi`。这意味着该节点是一条 **SPI 总线**，在其下的所有子节点都将自动被认为挂载在 SPI 总线上。

### 2.2 温度传感器绑定：`ti,tmp112.yaml`

```yaml
# ti,tmp112.yaml
description: Texas Instruments TMP112 Temperature Sensor

compatible: "ti,tmp112"

# 强约束：该硬件节点只能挂载在声明了 bus: spi 的父节点之下
on-bus: spi

properties:
  reg:
    type: int
    required: true
    description: Chip select index on the parent SPI bus.
  spi-max-frequency:
    type: int
    required: true
    description: Maximum SPI clock frequency in Hz.
  alert-gpios:
    type: phandle-array
    required: false
    description: GPIO pin used for active-low overtemperature interrupt.
  overtemp-threshold:
    type: int
    required: false
    default: 80 # 如果设备树中没有声明该属性，编译期将采用该默认值 80
    description: Overtemperature alarm threshold in Celsius.
```

> [!IMPORTANT]
> `on-bus: spi` 是一项极具生产价值的约束。如果硬件工程师在编写设备树时，错误地将 `ti,tmp112` 传感器挂载在了一个 I2C 物理总线控制器（如 `compatible = "st,stm32-i2c"`）节点下，Python 解析引擎在校验总线挂载关系时，会因为父节点提供的 `bus: i2c` 与当前子节点要求的 `on-bus: spi` 不匹配而立刻拦截并抛出编译错误。

---

## 3. 编译工具链解析流程追踪

Zephyr 的底层编译机制深度依赖 CMake。在代码编译的前置阶段，CMake 会启动底层的设备树工具链。

### 3.1 编译工具链分层解析机制

1. **`dtlib.py`**：纯词法/语法解析器。它读取由 C 预处理器（CPP）合成后的 DTS 纯文本，只分析设备树本身的语法结构（如大括号是否闭合、属性是否以分号结尾），然后生成一颗原始的、未经验证的内存树（Raw AST）。
2. **`edtlib.py`（Enhanced Devicetree Library）**：核心语义解析器。它导入由 `dtlib` 输出的 Raw AST，并加载系统中的 YAML Binding 文件进行遍历核对。在这个过程中，它计算每个属性的类型、填充默认值、校验父子节点间的 `bus` 与 `on-bus` 契约，并解析 phandle 指针，计算出总线上的逻辑设备映射树（Cooked AST）。
3. **`gen_defines.py`**：终极宏生成引擎。它遍历 `edtlib` 输出的 Cooked AST，将其扁平化地翻译为数万个 C 预处理 `#define` 宏，最终输出到构建路径下的 `zephyr/include/generated/devicetree_generated.h` 中。

---

## 4. `devicetree_generated.h` 扁平化宏命名体系

在 `devicetree_generated.h` 中，原本具有多层嵌套的树形拓扑被平铺直叙地翻译成了一连串全局唯一的宏。为了保证没有命名冲突，宏的名字生成遵循着严格的路径转义规则。

### 4.1 节点绝对路径的宏化命名

宏的全局标识符以 `DT_N` 开头（代表 Node），接着使用 `_S_`（代表 Subnode）替换绝对路径中的 `/`。对于绝对路径中包含的所有特殊字符（如 `@`、`,`、`-`），一律转换为下划线 `_`。

以第一章的物理节点 `temp@0` 为例：
* 其在设备树中的绝对路径为：`/soc/spi@40013000/temp@0`
* 对应的唯一节点路径 ID（Node Identifier Macro）为：
  ```c
  #define DT_N_S_soc_S_spi_40013000_S_temp_0 ...
  ```

### 4.2 属性宏的后缀命名规则

针对该节点下的所有属性，会在上述节点 ID 宏的基础上追加特定后缀：

* **属性存在性标志 (EXISTS)**：
  ```c
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_EXISTS 1
  ```
* **数值/字符串属性 (以 `spi-max-frequency` 为例，连字符 `-` 会被转为下划线 `_`)**：
  ```c
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_spi_max_frequency 2000000
  ```
* **寄存器索引属性 (reg)**：
  ```c
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_reg 0
  ```
* **带有 Phandle 和 Cells 的复杂引脚配置属性 (以 `alert-gpios` 为例)**：
  ```c
  /* 指向 alert-gpios 中 &gpioa 所映射的底层 GPIO 节点的全局宏 ID */
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_PH DT_N_S_soc_S_gpio_40020000
  /* 提取引脚编号（由 YAML 的 gpio-cells 定义名称） */
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_pin 4
  /* 提取标志位值 */
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_flags 1
  ```

### 4.3 节点别名与 Label 指向宏

为了屏蔽上述极其复杂的绝对路径宏名，工具链会自动根据 DTS 中定义的 `aliases` 和节点标签（Label）生成直观的“快捷指向宏”：

* **节点标签快捷宏 (NODELABEL)**：
  ```c
  #define DT_N_NODELABEL_tmp112 DT_N_S_soc_S_spi_40013000_S_temp_0
  ```
* **别名快捷宏 (ALIAS)**：
  ```c
  #define DT_N_ALIAS_temp_sensor DT_N_S_soc_S_spi_40013000_S_temp_0
  ```

---

## 5. DTS 到 C 宏映射转换全景路由图

为了直观呈现设备树这一高度自动化的翻译链条，我们追踪 `temp@0` 节点从底层 DTS 的声明，到 YAML 校验，再到输出 C 宏的过程：

```
+-----------------------------------------------------------------------------------------+
| [DTS 设备树源声明]                                                                      |
|                                                                                         |
|  tmp112: temp@0 {                                                                       |
|      compatible = "ti,tmp112";                                                          |
|      reg = <0>;                                                                         |
|      spi-max-frequency = <2000000>;                                                     |
|      alert-gpios = <&gpioa 4 1>;                                                        |
|  };                                                                                     |
+--------------------------------------------┬--------------------------------------------+
                                             │
                                             v
+-----------------------------------------------------------------------------------------+
| [YAML Binding 静态类型约束匹配与语义校验]                                               |
|                                                                                         |
|  1. 通过 ti,tmp112.yaml 匹配该节点。                                                    |
|  2. 校验 reg 属性：类型匹配为 int，数值为 0。                                            |
|  3. 校验 spi-max-frequency 属性：类型匹配为 int，数值为 2000000。                       |
|  4. 解析 alert-gpios：找到 &gpioa 节点物理描述，并解包出：pin = 4，flags = 1。           |
+--------------------------------------------┬--------------------------------------------+
                                             │
                                             v
+-----------------------------------------------------------------------------------------+
| [C 语言预处理宏最终输出结果 (devicetree_generated.h)]                                   |
|                                                                                         |
|  #define DT_N_S_soc_S_spi_40013000_S_temp_0_EXISTS 1                                     |
|  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_reg 0                                       |
|  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_spi_max_frequency 2000000                  |
|  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_pin 4                 |
|  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_flags 1               |
|                                                                                         |
|  /* 快捷方式绑定 */                                                                     |
|  #define DT_N_NODELABEL_tmp112 DT_N_S_soc_S_spi_40013000_S_temp_0                       |
+-----------------------------------------------------------------------------------------+
```

在下一章中，我们将进入 C 代码开发实战，学习如何利用 Zephyr 的标准 C API 层对这些极其扁平化的生成宏进行高级封装，并结合驱动初始化模型，优雅地实例化硬件驱动。
