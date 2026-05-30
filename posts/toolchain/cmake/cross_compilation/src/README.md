# 序言与导读：现代嵌入式开发的构建变革

在传统的微控制器（MCU）与嵌入式系统开发中，开发者往往严重依赖厂商提供的集成开发环境（IDE），例如 Keil MDK、IAR Embedded Workbench 以及各类芯片厂商基于 Eclipse 定制的 IDE。虽然这些工具提供了“开箱即用”的点按式配置，但在面对复杂、现代的工程需求时，它们的弊端也越发明显：

1. **版本控制困难**：IDE 的工程文件（如 `.uvprojx`、`.ewp`）通常是复杂的 XML 或二进制格式，混合了源文件列表、编译选项与本地 IDE 窗口布局。在多人协作时，极易引发难以解决的合并冲突。
2. **CI/CD 自动化集成瓶颈**：现代软件工程依赖自动化构建与测试。传统的嵌入式 IDE 极难在无图形界面的 Linux 服务器或 Docker 容器中运行，导致持续集成（CI）流程的搭建成本极高。
3. **生态圈封闭与编辑器落后**：IDE 内置的编辑器在现代代码补全、静态分析、重构支持（如 LSP、Clangd）方面，与 VS Code、CLion、Neovim 等现代编辑器相比存在代差。
4. **难以支持复杂的依赖管理与跨平台构建**：当项目需要引入单元测试、模拟器运行（如 QEMU/PC 本地编译测试），或者需要在不同的硬件平台之间共享底层业务逻辑时，单一的 IDE 工程难以应付。

为了打破这些限制，**CMake** 成为了现代嵌入式开发的首选构建系统。作为一个跨平台的构建配置工具，CMake 并不直接编译代码，而是生成底层的构建文件（如 Ninja.build 或 Makefile）。通过 CMake，我们可以使用纯文本定义整个项目的拓扑结构与编译选项，实现“一次编写，到处构建”。

---

## 本书内容概览

本书将由浅入深，全面拆解基于 CMake 的嵌入式交叉编译核心技术。全书分为三个核心章节：

### [第一章：嵌入式交叉编译核心概念](01_cross_compilation_concepts.md)
我们将深入探讨交叉编译的本质。从 Host（主机）与 Target（目标机）的区分开始，解析目标三元组（Target Triplet，如 `arm-none-eabi`）的每一部分的具体含义。同时，我们还将深入裸机（Bare-metal）运行时的底层逻辑，探讨启动代码（Startup Code）、链接脚本（Linker Script）、中断向量表，以及 C 标准库（newlib / newlib-nano）在无操作系统环境下的打桩与系统调用适配。

### [第二章：CMake 工具链文件 (Toolchain File) 深度设计](02_toolchain_file_design.md)
工具链文件是 CMake 实现交叉编译的基石。我们将深入学习 CMake 如何管理交叉编译生命周期，并详细剖析 `CMAKE_SYSTEM_NAME`、`CMAKE_SYSTEM_PROCESSOR` 以及 `CMAKE_TRY_COMPILE_TARGET_TYPE` 等关键变量的底层机理。本章将提供一份可直接用于生产环境的 `arm-none-eabi-gcc` 模块化工具链文件，教你如何优雅地声明架构编译参数（如 Cortex-M4 的 `-mcpu`、FPU 配置）与系统搜索路径控制。

### [第三章：MCU 实战项目构建与编译流程](03_mcu_project_build.md)
我们将从零构建一个完整的嵌入式 MCU 项目。本章将遵循 **Modern CMake (基于 Target 的设计模式)**，抛弃过时的全局变量注入式写法。我们将详细展示如何将 `.c`、`.cpp` 以及汇编启动文件（`.s`）混合编译，如何优雅地绑定链接脚本，并利用 CMake 的 `add_custom_command` 与 `add_custom_target` 在编译完成后自动调用 `objcopy` 和 `size` 工具生成 `.hex`、`.bin` 固件以及输出 Flash/RAM 占用率报告。

---

## 学习目标

完成本书的学习后，你将能够：
- **自主设计与编写** 针对任何嵌入式架构（如 ARM Cortex-M0+/M3/M4/M7、RISC-V、ESP32 等）的 CMake 工具链文件。
- **构建高扩展性的 MCU 工程**，支持代码静态检查（Clang-Tidy）、单元测试（GTest）与多目标硬件配置一键切换。
- **摆脱对特定嵌入式 IDE 的依赖**，完全使用 VS Code / CLion 结合 Ninja 构建工具链，实现秒级的编译速度。
- **无缝对接 CI/CD 流程**，在 GitHub Actions 或 GitLab CI 中实现固件的自动编译、发布与静态测试。
