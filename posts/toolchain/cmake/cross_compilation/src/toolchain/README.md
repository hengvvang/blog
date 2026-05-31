# 第二部分：工具链设计与嵌入式构建

要让 CMake 优雅且可靠地完成嵌入式交叉编译，不能仅仅在主项目的 `CMakeLists.txt` 中堆砌大量的底层编译参数。我们需要引入 CMake 体系中最核心的构建配置抽象机制：**工具链文件（Toolchain File）**。

本部分将探讨如何编写健壮的工具链配置文件，以及如何在实际的微控制器（MCU）裸机工程中完成构建：

## 1. 工具链描述文件设计 (Toolchain File Design)

*   **核心变量声明**：如何设置 `CMAKE_SYSTEM_NAME`（设为 `Generic` 代表裸机）、`CMAKE_SYSTEM_PROCESSOR` 以及编译器路径等核心变量。
*   **探针行为配置**：利用 `CMAKE_TRY_COMPILE_TARGET_TYPE` 改变 CMake 的编译器检测机制。避免在未绑定链接脚本前，因为检测链接失败而导致的配置崩溃。
*   **搜索路径隔离**：通过 `CMAKE_FIND_ROOT_PATH` 及相关搜索限制策略，确保第三方依赖库、头文件搜索完全隔离在目标系统的 Sysroot 空间内，防止意外污染。

## 2. 平台重写与参数注入 (Platform Overrides)

嵌入式项目通常具有强烈的硬件依赖性。工具链文件将负责：
*   指定特定目标 MCU 的内核指令集（如 `-mcpu=cortex-m4`、`-mthumb`）。
*   指定硬件浮点协处理器参数（如 `-mfloat-abi=hard`、`-mfpu=fpv4-sp-d16`）。
*   注入用于优化体积的全局编译/链接标志（如 `-ffunction-sections`、`-fdata-sections` 和链接器垃圾回收标志 `--gc-sections`）。

```text
+------------------------------------+
|     CMake Toolchain File           |
|  - CMAKE_SYSTEM_NAME: Generic      |
|  - Compilers: arm-none-eabi-gcc    |
|  - ARCH Flags: -mcpu=cortex-m4 ... |
+------------------------------------+
                  |
                  v 注入
+------------------------------------+
|         CMake Build System         |
|  - 独立于具体工程 (解耦)             |
|  - 提供统一的交叉编译上下文         |
+------------------------------------+
```

## 3. 嵌入式构建配置与二进制后处理

在工具链文件的基础上，我们将开展微控制器项目的实战构建，演示如何：
*   采用 Modern CMake 的 Target-Based 规范管理源文件、宏定义与头文件目录。
*   安全且精细地绑定 `.ld` 链接脚本（Linker Script），控制 Flash 和 SRAM 的布局分配。
*   利用 CMake 自定义命令挂载 `objcopy` 和 `size` 等后处理工具，自动输出用于最终烧录的 `.bin`、`.hex` 文件，并实时生成物理内存空间占用报告。

---

掌握了工具链设计与构建配置，你将能够为任何架构的嵌入式微控制器搭建一套纯文本定义、极其灵活且完美适配 CI/CD 自动化流水线的现代化工程模板。
