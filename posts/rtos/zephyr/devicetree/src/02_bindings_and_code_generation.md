# 第二章：Bindings 属性绑定匹配与编译期宏生成机制

设备树本身仅仅是一种数据拓扑的声明，它并不带有类型系统，也无法阻止用户填写无效或含义不明的属性。为了解决数据合法性校验问题，Zephyr 引入了 **YAML Bindings（绑定文件）** 机制。它是设备树的“元数据 Schema”，定义了每个节点允许包含什么属性、属性的数据类型以及这些数据应如何映射到最终的 C 语言宏中。

---

## 1. YAML Bindings 规范设计

在 Zephyr 中，Bindings 文件存放在 `dts/bindings/` 目录以及各级驱动的专属目录下，文件后缀通常为 `.yaml`。当解析器扫描设备树节点时，会提取节点中的 `compatible` 属性，然后在 Bindings 库中寻找匹配的文件名或内部兼容性声明。

### 1.1 YAML 绑定的基本骨架

一个标准的 Binding 文件包含以下核心元素：

* **`compatible`**：匹配标识符。必须与 DTS 中的 `compatible` 字符串完全一致。
* **`description`**：对该设备的文本描述，方便工具生成文档。
* **`properties`**：定义该节点拥有的所有属性的类型约束。
* **`bus` / `on-bus`**：定义该设备的总线属性，用于自动分析主从关系。

### 1.2 属性类型系统

在 `properties` 字段中，可以对属性声明以下类型：
- `int`：单个 32 位整数。
- `array`：整数数组。
- `string`：单个字符串。
- `string-array`：字符串数组。
- `boolean`：布尔值。在 DTS 中，若该属性名出现则为 true，未出现则为 false。
- `phandle`：指向树中另一个节点的指针/引用。
- `phandle-array`：元组数组，通常包含一个 phandle 指针及若干个整型参数（如 GPIO 规格符、时钟规格符等）。

---

## 2. YAML Binding 实例分析

为了展示其实际应用，我们针对第一章定义的 SPI 总线控制器和外挂传感器编写两个 Binding 约束文件。

### 2.1 SPI 主控制器绑定：`acme,spi-host.yaml`

```yaml
description: ACME High Performance SPI Host Controller

compatible: "acme,spi-host"

# 引入基础总线属性（包含 reg, interrupts 等常见属性的基类定义）
include: spi-controller.yaml

properties:
  reg:
    required: true
  interrupts:
    required: true
  cs-gpios:
    type: phandle-array
    required: false
    description: GPIOs to use for Chip Select lines.
```

> [!NOTE]
> 在此文件中，`include: spi-controller.yaml` 表示该绑定继承了 Zephyr 核心库中定义的 SPI 控制器标准接口规范。这会自动将 `#address-cells = <1>;` 和 `#size-cells = <0>;` 的约束以及 `bus: spi` 标记引入当前配置，宣告此节点是一条 **SPI 总线**。

### 2.2 SPI 温度传感器物理绑定：`ti,tmp112.yaml`

```yaml
description: Texas Instruments TMP112 Temperature Sensor

compatible: "ti,tmp112"

# 宣告此设备必须挂载在 SPI 总线上
on-bus: spi

properties:
  reg:
    type: int
    required: true
    description: Chip select index on the SPI bus.
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
    default: 80
    description: Overtemperature alarm threshold in Celsius.
```

> [!TIP]
> `on-bus: spi` 的声明具有极强的作用。它明确地约束了在设备树拓扑中，`ti,tmp112` 节点必须作为具有 `bus: spi` 标记的节点（如 `acme,spi-host`）的子节点存在。若用户在 DTS 中误将该传感器挂载在 I2C 节点下，编译器的静态语法检查阶段会立刻拦截并报错。

---

## 3. 编译工具链解析流程追踪

Zephyr 的底层构建系统完全基于 CMake 构建。在编译的前期阶段，CMake 会启动 Python 工具链来处理设备树文件：

```
                              CMake 构建触发
                                    │
                                    v
                     调用 scripts/dts/gen_defines.py
                                    │
                ┌───────────────────┴───────────────────┐
                ▼                                       ▼
       解析 dts/dtlib.py                      解析 dts/edtlib.py
  (基础词法/语法树构建，生成            (语义解析器：应用 Bindings 校验，
  原始的没有绑定属性的普通树)             合并 Overlays 并进行总线拓扑计算)
                │                                       │
                └───────────────────┬───────────────────┘
                                    v
                     生成 devicetree_generated.h 
                         (并校验所有必需属性)
```

1. **`dtlib.py`**：这是第一层解析器。它只关心合法的设备树语法，解析 C 预处理器输出的 `.dts.pre` 文件，生成基础的内存节点树。
2. **`edtlib.py`（Enhanced Devicetree Library）**：这是语义分析核心。它导入上一步的原始树，并扫描所有 `compatible` 属性。接着查找对应的 YAML 绑定文件进行校验，并解析 phandle 引用，计算出总线上的物理设备映射关系。
3. **`gen_defines.py`**：它遍历 `edtlib` 处理后产生的、经过类型校验并合并完毕的数据结构，通过将树节点扁平化，生成数以万计的 C 预处理器宏定义，并将其输出到构建目录下的 `zephyr/include/generated/devicetree_generated.h` 中。

---

## 4. `devicetree_generated.h` 扁平化宏命名体系

在 `devicetree_generated.h` 中，设备树的层级结构（Parent-Child）被压扁为带有特定规则前缀的全局唯一宏。

### 4.1 节点路径的扁平化命名规则

宏的命名体系是依据节点在设备树中的**绝对路径**进行转义命名的。其基本前缀为 `DT_N`（代表 Node），随后将绝对路径中的 `/` 转换为 `_S_`（代表 Subnode），将特殊字符（如 `@`、`,`、`-`）全部转换为下划线 `_`。

以第一章中的 `tmp112: temp@0` 节点为例，其绝对路径为 `/soc/spi@40013000/temp@0`：
* 转义后的全局唯一节点 ID 为：
  `DT_N_S_soc_S_spi_40013000_S_temp_0`

### 4.2 属性宏命名规则

有了唯一的节点 ID 后，该节点下的所有属性都会在此基础上追加特定的后缀：

* **节点是否存在标记**：
  `#define DT_N_S_soc_S_spi_40013000_S_temp_0_EXISTS 1`
* **基础属性**（以 `spi-max-frequency` 为例，连字符 `-` 会转为下划线 `_`）：
  `#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_spi_max_frequency 2000000`
* **物理寄存器信息（`reg` 属性）**：
  `#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_reg 0`
* **引脚配置（以 `alert-gpios` 为例，带有 phandle 引用与 cells）**：
  ```c
  // 指向绑定的 GPIO 控制器的节点全局 ID
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_PH DT_N_S_soc_S_gpio_40020000
  // 第 0 个索引处的 pin 单元值 (4)
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_pin 4
  // 第 0 个索引处的 flags 单元值 (1)
  #define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_flags 1
  ```

### 4.3 别名与标签宏定义（Aliases & Labels）

为了方便 C 语言代码不需要知道这么冗长复杂的路径宏，工具链会为设备树中的 `aliases` 和 `label` 额外生成对应的快捷指向宏：

* **通过 Label 指向（`usart1` / `spi1` / `tmp112`）**：
  `#define DT_N_NODELABEL_tmp112 DT_N_S_soc_S_spi_40013000_S_temp_0`
* **通过 Alias 指向（`temp-sensor`）**：
  `#define DT_N_ALIAS_temp_sensor DT_N_S_soc_S_spi_40013000_S_temp_0`

---

## 5. 详细的映射转换过程追踪

为了直观呈现设备树这一高度自动化的翻译链条，我们将前文中的 `temp@0` 节点在各阶段的状态进行横向比对：

### 阶段一：设备树源文件声明 (DTS Overlay 合并后)
```dts
// 路径: /soc/spi@40013000/temp@0
tmp112: temp@0 {
    compatible = "ti,tmp112";
    reg = <0>;
    spi-max-frequency = <2000000>;
    alert-gpios = <&gpioa 4 1>;
    overtemp-threshold = <75>;
    label = "TMP112_BOARD";
};
```

### 阶段二：YAML Binding 静态类型约束匹配 (`ti,tmp112.yaml`)
* 解析器发现 `compatible = "ti,tmp112"`，载入其 YAML 文件。
* 校验发现 `reg` 是 `int` 类型，值为 `0`，符合约束。
* 校验发现 `spi-max-frequency` 是 `int` 类型，值为 `2000000`，符合约束。
* 校验发现 `alert-gpios` 是 `phandle-array` 类型。解析器通过 `&gpioa` 找到对应的 GPIO 控制器节点，拉取其定义并解包出：`pin = 4`，`flags = 1`。

### 阶段三：Python 宏生成结果 (`devicetree_generated.h`)
```c
/* 
 * Generated by gen_defines.py
 * WARNING: Do not modify this file directly!
 */

/* 节点路径宏转换 */
#define DT_N_S_soc_S_spi_40013000_S_temp_0_EXISTS 1
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_label "TMP112_BOARD"
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_reg 0
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_spi_max_frequency 2000000
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_overtemp_threshold 75

/* GPIO 关联属性转换 */
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_LEN 1
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_EXISTS 1
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_PH DT_N_S_soc_S_gpio_40020000
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_pin 4
#define DT_N_S_soc_S_spi_40013000_S_temp_0_P_alert_gpios_IDX_0_VAL_flags 1

/* 快捷链接宏 */
#define DT_N_NODELABEL_tmp112 DT_N_S_soc_S_spi_40013000_S_temp_0
#define DT_N_ALIAS_temp_sensor DT_N_S_soc_S_spi_40013000_S_temp_0

/* 兼容性全局统计 */
#define DT_N_COMPAT_ti_tmp112_EXISTS 1
#define DT_COMPAT_ti_tmp112 DT_N_COMPAT_ti_tmp112_EXISTS
```

在下一章中，我们将通过应用层及驱动层的 C 语言接口，讲解如何安全、规范地使用这些宏，避免直接调用底层带有双下划线或超长转义路径的内部宏。
