# 属性绑定与宏生成

在 Zephyr RTOS 中，设备树的拓扑树仅描述了硬件的关系，若要使其在编译时被 C 语言程序安全访问，需要通过 YAML 绑定（Bindings）进行静态类型校验，并自动生成宏。

本部分主要探讨 Bindings 属性匹配规则以及底层 C 宏的转换细节：

- **YAML Bindings 规范**：解构 YAML 绑定文件的基本结构，包含兼容性声明（`compatible`）、父子总线约束（`bus` 与 `on-bus`）以及设备树属性的强类型系统（`int`、`string`、`phandle-array` 等）。
- **编译工具链与 Python 解析引擎**：梳理 `dtlib`、`edtlib` 和 `gen_defines.py` 的处理流程，展示 DTS + Bindings 转换为 C 宏的过程。
- **C 宏映射与命名规则**：探索 `devicetree_generated.h` 中节点绝对路径、属性、别名与标签的全局扁平化命名体系。

通过深入理解这一部分，开发者将能够掌握 Zephyr 独创的“全编译期静态解析”设备树技术，在无任何运行时 RAM/Flash 损耗的前提下完成复杂的硬件抽象。
