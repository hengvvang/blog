# 第二章：多目录项目构建与结构化布局

当项目从单个源文件演变为中大型工程时，合理的目录结构与清晰的依赖隔离是项目成功的基石。在本章中，我们将讨论如何设计一个工业级的多目录项目布局，深入剖析现代 CMake 核心的**面向目标（Target-based）构建哲学**，讲解如何通过 CPack 对构建产物进行打包分发，并实现一个将 C 源码编译为嵌入式 ELF、导出链接 Map 报告并自动转换为 `.bin` 和 `.hex` 固件的完整构建系统。

---

## 1. 工业级项目标准目录结构

一个结构清晰的 C/C++ 项目应当隔离应用层代码、硬件驱动/库代码、编译脚本、测试用例以及物理链接资源。以下是一个典型的面向嵌入式/系统级开发的工程目录树：

```text
my_project/
├── CMakeLists.txt              # 顶层 CMake 配置文件
├── linker.ld                   # GCC 链接器脚本（定义 MCU 物理内存布局）
├── cmake/                      # 存放自定义 CMake 工具链与辅助宏定义
│   └── toolchain-arm.cmake     # ARM 交叉编译工具链定义
├── src/                        # 主应用程序源文件目录
│   ├── CMakeLists.txt
│   └── main.c                  # 主程序入口，调用 sensor 库
├── include/                    # 主应用程序的全局公共头文件目录
│   └── app_config.h            # 全局配置参数
├── lib/                        # 内部依赖库/子系统模块目录
│   └── sensor/
│       ├── CMakeLists.txt
│       ├── include/
│       │   └── sensor.h        # 供外部模块访问的公开接口头文件
│       ├── src/
│       │   └── sensor.c        # 传感器驱动内部实现源文件
│       └── private_reg.h       # 仅 sensor 内部可见的私有寄存器头文件
└── tests/                      # 单元测试代码目录
    ├── CMakeLists.txt
    └── test_sensor.c
```

---

## 2. 现代 Target-Based CMake 构建哲学

在旧版 CMake（CMake 2.x 及更早）中，配置参数主要通过全局变量来传递，例如使用 `include_directories()`、`link_libraries()` 和 `add_definitions()`。这类指令会影响其后定义的所有目标，当工程复杂时极易造成**依赖污染（Dependency Pollution）**。

现代 CMake（3.0+）倡导 **Target-Based CMake**，即**把每一个库或可执行文件看作一个“对象（Target）”**。每个 Target 都包含自己的“属性（Properties）”，比如：
* 哪些是它的源文件？
* 它需要哪些头文件搜索路径？
* 它需要定义哪些编译宏与编译选项？
* 它依赖哪些其它的 Target？

我们通过 `target_...` 指令对特定的 Target 写入属性，并利用 `PUBLIC`、`PRIVATE` 与 `INTERFACE` 关键字来精确控制这些属性的**传播行为**。

### 2.1 依赖与属性传递拓扑

当我们在 Target A 上定义某项配置（如头文件目录），并让 Target B 链接 Target A 时（`target_link_libraries(B <VISIBILITY> A)`），该配置是否会传播给 Target B，完全由声明时的修饰符决定：

* **`PRIVATE`**：属性仅供该 Target 自己编译时使用，不向外部链接者传递。
  * *场景*：`sensor.c` 内部包含了一个仅用于读取芯片寄存器的头文件 `private_reg.h`。`lib/sensor` 应当将包含该私有头文件的目录设为 `PRIVATE`。外部的 `main.c` 链接 `sensor` 时，不需要也不应该能够访问 `private_reg.h`。
* **`INTERFACE`**：属性自身编译时不需要，但任何链接该 Target 的使用者都需要。
  * *场景*：纯头文件库（Header-only Library）、或专门定义编译器选项和链接标志的虚拟目标（如 `mcu_config`）。
* **`PUBLIC`**：它是 `PRIVATE` 和 `INTERFACE` 的结合。自己编译时需要，使用者编译时也必须导入。
  * *场景*：`sensor.h` 是 `lib/sensor` 暴露给应用层的外部接口。`lib/sensor` 内部的源文件编译需要它，外部的 `main.c` 调用其函数时也必须 include 它。

```text
属性与编译参数传播机制图：
+-----------------------+                    +-----------------------+
|  Target A (Static Lib)|                    |   Target B (App Exec) |
|                       |                    |                       |
|  [PUBLIC INTERFACE]   | -- target_link --> |                       |
|   - include/sensor.h  |                    |  继承 A 的 PUBLIC 属性|
|                       |                    |  - 自动包含 sensor.h  |
|  [PRIVATE INTERNAL]   |                    |                       |
|   - private_reg.h     |                    |  无法继承 A 的 PRIVATE|
|   - 宏: SENSOR_DBG=2  |                    |  - 隔离内部细节       |
+-----------------------+                    +-----------------------+
```

---

## 3. 自定义构建规则与后期处理

在生成最终二进制文件后，系统级开发往往需要对目标文件进行后期处理（如生成二进制烧录包）。CMake 提供了自定义命令和自定义目标来完成这些工作。

### 3.1 `add_custom_command` 与 `add_custom_target` 的区别

| 特性 | `add_custom_command` | `add_custom_target` |
| :--- | :--- | :--- |
| **设计目的** | 定义生成某个**物理输出文件**的规则 | 创建一个**不产出物理文件**的逻辑构建目标 |
| **触发机制** | 惰性触发（Lazy）。仅当有其他 Target 依赖其 OUTPUT 时才运行 | 始终触发。只要显式调用该 target 即必定运行 |
| **典型场景** | 从 ELF 提取 `.bin`/`.hex` 固件；利用工具生成源码 | 一键烧录 `make flash`；一键格式化 `make format` |
| **依赖关系** | 通过指定 `OUTPUT` 和 `DEPENDS` 与 Target 关联 | 通过 `add_dependencies()` 与其他 Target 绑定 |

---

## 4. CPack 安装与打包分发

构建系统不仅要完成编译，还要提供发布产物的方法。CMake 的 **CPack** 系统是原生的打包解决方案。

通过在 CMakeLists.txt 中定义安装行为，CPack 能够自动生成各种分发格式（如 `.zip`、`.tar.gz` 或者是 Windows 下的 `.msi`、Linux 下的 `.deb` 包）。

```cmake
# ==============================================================================
# 1. 定义安装规则（指定在安装阶段哪些 Target 的哪些产物放入什么地方）
# ==============================================================================
install(TARGETS app_elf sensor
    RUNTIME DESTINATION bin     # 可执行二进制文件安装到 <prefix>/bin
    LIBRARY DESTINATION lib     # 共享库安装到 <prefix>/lib
    ARCHIVE DESTINATION lib     # 静态库安装到 <prefix>/lib
)

install(FILES lib/sensor/include/sensor.h
    DESTINATION include         # 头文件安装到 <prefix>/include
)

# ==============================================================================
# 2. 配置 CPack 打包生成器
# ==============================================================================
set(CPACK_PACKAGE_NAME "EmbeddedOS")
set(CPACK_PACKAGE_VENDOR "hengvvang")
set(CPACK_PACKAGE_VERSION "1.0.0")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Industrial-grade C/C++ Embedded OS Core Distribution")

# 设置默认生成器类型：ZIP 和 TGZ 压缩包
set(CPACK_GENERATOR "ZIP;TGZ")

# 引入 CPack 模块，必须放在所有 CPACK_ 变量定义之后
include(CPack)
```

---

## 5. 实战：交叉编译嵌入式固件项目配置

下面，我们通过一个完整的 C 语言嵌入式工程模板，将多目录组织、现代 Target 传递、GCC 链接器脚本绑定以及 Post-Build 二进制固件导出整合在一起。

### 5.1 顶层 `CMakeLists.txt`

```cmake
# ==============================================================================
# 1. 顶层 CMake 初始化
# ==============================================================================
cmake_minimum_required(VERSION 3.16)
project(EmbeddedOS VERSION 1.0.0 LANGUAGES C)

# 确保在交叉编译时，CMake 不会因为找不到标准的本地主机系统的 C 库而报错
set(CMAKE_TRY_COMPILE_TARGET_TYPE "STATIC_LIBRARY")

# 强制要求域外构建 (Out-of-Source Build)
if(${CMAKE_SOURCE_DIR} STREQUAL ${CMAKE_BINARY_DIR})
    message(FATAL_ERROR "In-source builds are not allowed. Please build from a separate directory (e.g. build/)")
endif()

# ==============================================================================
# 2. 全局编译属性配置 (通过接口 Target 统一管理并传播)
# ==============================================================================
# 定义全局硬件编译选项的目标 (接口库形式)
add_library(mcu_config INTERFACE)

# 绑定 Cortex-M4 相关的硬件编译和链接参数，确保所有 Target 统一步调
target_compile_options(mcu_config INTERFACE
    -mcpu=cortex-m4
    -mthumb
    -mfloat-abi=hard
    -mfpu=fpv4-sp-d16
    -ffunction-sections
    -fdata-sections
    -Wall
    -Wextra
    -Wstrict-prototypes
)

target_link_options(mcu_config INTERFACE
    -mcpu=cortex-m4
    -mthumb
    -mfloat-abi=hard
    -mfpu=fpv4-sp-d16
    -specs=nano.specs
    -specs=nosys.specs
    -Wl,--gc-sections
)

# ==============================================================================
# 3. 引入子系统与应用代码
# ==============================================================================
# 添加子模块静态库 (lib/sensor)
add_subdirectory(lib/sensor)

# 添加应用层主程序 (src)
add_subdirectory(src)
```

### 5.2 驱动库 `lib/sensor/CMakeLists.txt`

```cmake
# ==============================================================================
# 子模块库: sensor (静态库)
# ==============================================================================

# 定义源文件列表
set(SENSOR_SRCS
    src/sensor.c
)

# 声明构建静态库
add_library(sensor STATIC ${SENSOR_SRCS})

# 链接全局 MCU 属性配置，使用 PUBLIC 使链接者也同样被施加 Cortex-M4 编译选项
target_link_libraries(sensor PUBLIC mcu_config)

# 头文件搜索路径隔离：
# 1. include/ 目录包含公开的 sensor.h，供外部链接者调用，设为 PUBLIC
# 2. src/ 目录包含私有 private_reg.h，仅内部编译使用，设为 PRIVATE
target_include_directories(sensor
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# 给 sensor 库在编译时传入一个特定宏定义（仅私有）
target_compile_definitions(sensor PRIVATE SENSOR_DEBUG_LEVEL=2)
```

### 5.3 驱动代码实现参考

* **`lib/sensor/include/sensor.h`**
```c
#ifndef SENSOR_H
#define SENSOR_H

/* 对外公开接口：初始化传感器 */
int sensor_init(void);

#endif /* SENSOR_H */
```

* **`lib/sensor/src/private_reg.h`**
```c
#ifndef PRIVATE_REG_H
#define PRIVATE_REG_H

/* 私有硬件寄存器地址映射 */
#define SENSOR_REG_CTRL 0x40012400
#define SENSOR_REG_DATA 0x40012404

#endif /* PRIVATE_REG_H */
```

* **`lib/sensor/src/sensor.c`**
```c
#include "sensor.h"
#include "private_reg.h"

int sensor_init(void) {
    /* 模拟往私有寄存器写入控制命令 */
    volatile unsigned int *ctrl_reg = (volatile unsigned int *)SENSOR_REG_CTRL;
    *ctrl_reg = 0x01;
    return 0;
}
```

### 5.4 应用层 `src/CMakeLists.txt`

```cmake
# ==============================================================================
# 应用层主程序构建与固件导出
# ==============================================================================

# 声明主程序可执行目标
add_executable(app_elf main.c)

# 链接项目依赖项：
# 1. 链接子模块 sensor，sensor 会自动将其 PUBLIC 头文件目录与 mcu_config 属性传播给 app_elf
target_link_libraries(app_elf PRIVATE sensor)

# 绑定全局公共头文件配置目录
target_include_directories(app_elf PRIVATE ${PROJECT_SOURCE_DIR}/include)

# ==============================================================================
# 链接器脚本 (.ld) 与 Map 报告的高级配置
# ==============================================================================
set(LINKER_SCRIPT "${PROJECT_SOURCE_DIR}/linker.ld")
set(MAP_FILE "${CMAKE_BINARY_DIR}/app_elf.map")

target_link_options(app_elf PRIVATE
    "-T${LINKER_SCRIPT}"
    "-Wl,-Map=${MAP_FILE}"
)

# 确保链接器脚本物理文件存在，若不存在则报出显式的构建错误
if(NOT EXISTS ${LINKER_SCRIPT})
    message(FATAL_ERROR "Linker script not found at: ${LINKER_SCRIPT}")
endif()

# ==============================================================================
# 自动生成 Binary & Hex 烧录文件 (Post-Build 后期处理)
# ==============================================================================
# 查找或定义 arm-none-eabi-objcopy 路径（如果使用的是系统工具链）
if(NOT CMAKE_OBJCOPY)
    set(CMAKE_OBJCOPY "arm-none-eabi-objcopy")
endif()

# 1. 构建后自动导出 .bin 固件 (文件级构建动作)
add_custom_command(
    TARGET app_elf POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:app_elf> ${CMAKE_BINARY_DIR}/firmware.bin
    COMMENT "Converting ELF target to binary firmware: firmware.bin"
)

# 2. 构建后自动导出 .hex 固件 (文件级构建动作)
add_custom_command(
    TARGET app_elf POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O ihex $<TARGET_FILE:app_elf> ${CMAKE_BINARY_DIR}/firmware.hex
    COMMENT "Converting ELF target to Intel Hex firmware: firmware.hex"
)

# 3. 输出固件大小报告
if(CMAKE_SIZE)
    add_custom_command(
        TARGET app_elf POST_BUILD
        COMMAND ${CMAKE_SIZE} $<TARGET_FILE:app_elf>
        COMMENT "Firmware Flash and RAM consumption report:"
    )
endif()
```

### 5.5 主应用代码参考

* **`src/main.c`**
```c
#include "app_config.h"
#include "sensor.h"

int main(void) {
    /* 调用静态库 sensor 的接口 */
    sensor_init();
    while (1) {
        /* 主循环 */
    }
    return 0;
}
```

---

## 6. 编译构建流程

在此架构设计下，开发者的构建命令极度简洁。在 build 目录下执行：
```bash
# 1. 配置并生成底层构建文件（例如生成高效率的 Ninja 脚本）
cmake -B build -G Ninja

# 2. 执行编译
cmake --build build
```

在配置与构建时，CMake 将遵循如下构建顺序及属性传递网络：
1. 编译静态库 `sensor`。编译时加入 `mcu_config` 规定的 GCC 优化标志，且能访问 `private_reg.h` 和 `sensor.h`。
2. 编译可执行程序 `app_elf`。编译时自动获得由 `sensor` PUBLIC 传递过来的 `sensor.h` 搜索路径，且获得 `mcu_config` 中的 Cortex-M4 编译与链接选项。
3. 链接 `app_elf`，带入 `linker.ld` 文件并将段映射表输出到 `app_elf.map`。
4. 原地执行 post-build 命令，自动产出 `firmware.bin` 与 `firmware.hex`。

通过如此标准化的工程化定义，您的多目录构建系统具备了清晰的物理边界、健壮的依赖解析方案与一键式的固件分发体验。
