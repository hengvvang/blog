# 现代 CMake 库目标管理范式

在大型 C/C++ 工程实践中，构建系统（Build System）的质量往往直接决定了项目的可维护性、可扩展性以及模块解耦的彻底程度。长久以来，传统的 CMake 被称为“过时的 CMake”（Legacy CMake），其核心特点是以**目录/变量**为中心，使用诸如 `include_directories`、`link_directories`、`add_definitions` 等全局或目录级命令。这种模式随着项目规模的增长，会导致变量污染、依赖关系模糊、构建配置不可预测等一系列灾难性问题。

现代 CMake（Modern CMake，通常指 CMake 3.0+）引入了一次颠覆性的范式转变：**以目标（Target）和属性（Property）为核心进行构建建模**。在现代 CMake 中，库（Library）和可执行文件（Executable）均被视为“目标”。每个目标都封装了自己的源文件、编译选项、宏定义、头文件搜索路径以及对其他目标的依赖关系，并能够通过精确控制的属性传播机制，自动向其消费者（Consumers）声明构建与链接要求。

---

## 本书设计架构与核心章节

本书致力于深入探讨 **CMake 库目标管理（CMake Library Targets Management）** 的底层机制与工业级实践规范。无论您是开发底层嵌入式固件、高性能静态/动态中间件，还是大型跨平台 C++ 软件框架，掌握库目标的精确控制都是必不可少的硬核技能。

本书分为两个核心部分：

### [第一部分：库类型与链接原理](linking/README.md)

*   **[第一章：静态库、动态库与接口库原理及链接机制](linking/library-types-and-linking.md)**：从操作系统与编译器底层视角出发，对比静态链接与动态链接在内存占用、加载耗时、符号决议（Symbol Resolution）上的差异。
*   **符号可见性（Visibility）控制**：解析 GCC/Clang 的 `-fvisibility=hidden` 与 Windows 平台下 `__declspec(dllexport/dllimport)` 的处理差异，并使用 CMake 官方的 `GenerateExportHeader` 模块自动生成跨平台导出头文件。
*   **对象库（OBJECT）**：探索如何使用对象库规避重复编译，在不生成最终归档或链接目标的前提下，共享编译后的二进制目标文件。
*   **接口库（INTERFACE）**：剖析 Header-only 库与“虚拟/配置目标”的构建与封装机制。

### [第二部分：属性传播与分发打包](distribution/README.md)

*   **[第二章：基于现代 Target 的属性传播与可见性控制](distribution/modern-target-properties.md)**：详细梳理 `INTERFACE_*` 属性与非接口属性的内在映射关系。
*   **传播可见性控制**：深度图解 `PUBLIC`、`PRIVATE` 与 `INTERFACE` 关键字在依赖关系树中的传播逻辑。
*   **生成器表达式（Generator Expressions）**：掌握 `$<BUILD_INTERFACE:...>` 与 `$<INSTALL_INTERFACE:...>` 的本质区别，彻底解决构建树（Build Tree）与安装树（Install Tree）路径冲突的顽疾。
*   **[第三章：CMake 库的安装、导出与打包发布](distribution/library-distribution.md)**：使用 `install(TARGETS ... EXPORT)` 与 `install(EXPORT)` 机制，正确处理库分发中的包接口文件。
*   **CMake 配置文件生成**：结合 `CMakePackageConfigHelpers` 模块，编写高兼容性的 `<PackageName>Config.cmake` 与 `<PackageName>ConfigVersion.cmake`，实现下游通过 `find_package(PackageName CONFIG REQUIRED)` 一键集成。
*   **RPATH/RUNPATH 精细控制**：解析动态库在不同路径下加载的寻址机制，解决运行时“库未找到（Library Not Found）”的问题，规范多平台下的分发配置。

---

## 核心设计思想

通过学习本书，您将建立起一个清晰的模型：**构建一个 C++ 库，本质上是定义一个包含“自身构建属性”与“消费者导出属性”的目标接口。** 

这不仅能让您的 `CMakeLists.txt` 代码量大幅精简、逻辑更加清晰，更能极大提升库的分发体验，使下游接入犹如调用标准库一般无缝与直观。
