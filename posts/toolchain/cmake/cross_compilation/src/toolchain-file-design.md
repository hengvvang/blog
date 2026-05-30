# 第二章：CMake 工具链文件 (Toolchain File) 深度设计

在 CMake 的架构中，**工具链文件（Toolchain File）**是控制交叉编译的核心入口。每当 CMake 初始化一个项目（遇到 `project()` 指令）时，它会首先确定当前的操作系统与编译器，并运行一系列测试程序来验证编译器是否工作正常。

对于嵌入式开发，我们必须编写一个自定义的 `.cmake` 文件，在 CMake 执行任何编译器检测之前注入目标平台的信息。通过在命令行中传入 `-DCMAKE_TOOLCHAIN_FILE=path/to/toolchain.cmake`，即可让 CMake 切换到交叉编译模式。

---

## 2.1 CMake 交叉编译的核心控制变量

编写工具链文件时，我们需要声明几个对 CMake 行为有决定性影响的内部变量：

### 2.1.1 `CMAKE_SYSTEM_NAME`

*   **定义**：目标系统（运行环境）的操作系统名称。
*   **裸机设置**：在无操作系统的嵌入式开发中，该变量必须设置为 `Generic`。
*   **作用**：一旦设置了该变量，CMake 会自动将只读变量 `CMAKE_CROSSCOMPILING` 设为 `TRUE`，进而关闭针对主机系统的某些默认行为（如在 `/usr/lib` 或 Windows 注册表中搜索库文件）。
*   **示例**：
    ```cmake
    set(CMAKE_SYSTEM_NAME Generic)
    ```

### 2.1.2 `CMAKE_SYSTEM_PROCESSOR`

*   **定义**：目标处理器的架构名称。
*   **作用**：虽然 CMake 自身不会根据该值自动匹配编译器参数，但许多第三方 CMake 模块会利用该变量进行平台条件判断（如区分 `arm`、`riscv32`、`riscv64`、`xtensa`）。
*   **示例**：
    ```cmake
    set(CMAKE_SYSTEM_PROCESSOR arm)
    ```

### 2.1.3 `CMAKE_TRY_COMPILE_TARGET_TYPE` (核心痛点)

*   **默认值**：`EXECUTABLE`。
*   **报错原因**：默认情况下，CMake 在检测编译器时，会尝试编译、汇编并**链接**一个非常简单的可执行测试程序。但在嵌入式裸机开发中，此时我们还没有给项目绑定链接脚本，链接器找不到对应的内存布局，且由于缺乏 `_exit`、`_sbrk` 等存根函数，链接必定失败。这会导致 CMake 抛出致命错误：`"System is unknown to cmake, compiler cannot create executables"` 并终止配置。
*   **解决方案**：将该变量设置为 `STATIC_LIBRARY`。这会指示 CMake 的编译器检测机制**只编译、汇编为静态库（`.a`）而无需进行链接**，从而完美绕过链接阶段的存根缺失问题。
*   **示例**：
    ```cmake
    set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
    ```

---

## 2.2 寻找交叉编译器路径的优雅实践

许多开发者会在工具链文件中硬编码编译器的绝对路径（如 `C:/Program Files/.../arm-none-eabi-gcc`）。这种做法不仅导致项目无法在其他开发者的机器上编译，也破坏了 CI/CD 自动构建的通用性。

### 推荐的动态搜索策略：
1.  **环境变量优先**：允许开发者通过设置环境变量（如 `ARM_TOOLCHAIN_DIR`）显式指定编译器所在的目录。
2.  **PATH 目录搜索**：若环境变量未设置，则让 CMake 自动在操作系统的 `PATH` 环境变量中搜索可执行文件。
3.  **支持平台后缀**：在 Windows 上，可执行文件带有 `.exe` 后缀，而 Linux/macOS 上没有，应利用 `CMAKE_HOST_SYSTEM_NAME` 进行自适应处理。

---

## 2.3 限制系统资源搜索路径（Sysroot 隔离）

交叉编译时，我们绝对不希望 CMake 搜索到主机（Host）系统的库或头文件。例如，在编译 ARM 裸机程序时，如果 CMake 意外引入了主机 Ubuntu 上的 `/usr/include/stdio.h`，将会导致灾难性的段错误或链接冲突。

CMake 提供了以下变量来限制搜索范围：

*   **`CMAKE_FIND_ROOT_PATH`**：指定交叉编译器的根目录（Sysroot）以及第三方嵌入式依赖库的路径。
*   **`CMAKE_FIND_ROOT_PATH_MODE_PROGRAM`**：设置查找构建工具（如 `ninja`、`make`、`git`）的行为。必须设为 `NEVER`，表示**只在主机系统**中寻找可执行工具。
*   **`CMAKE_FIND_ROOT_PATH_MODE_LIBRARY`**：设为 `ONLY`，表示只在 `CMAKE_FIND_ROOT_PATH` 指定的目标平台路径中查找库文件。
*   **`CMAKE_FIND_ROOT_PATH_MODE_INCLUDE`**：设为 `ONLY`，表示只在目标平台路径中查找头文件。
*   **`CMAKE_FIND_ROOT_PATH_MODE_PACKAGE`**：设为 `ONLY`，表示只在目标平台路径中查找 CMake 配置文件（如 `xxxConfig.cmake`）。

```cmake
# 系统资源查找重定向配置
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
```

---

## 2.4 生产级 `arm-none-eabi.cmake` 工具链文件模板

以下是一份可以直接在生产中使用的 ARM Cortex-M 交叉编译工具链定义文件。它展示了如何动态检测编译器、声明特定 MCU 的硬件浮点与指令集参数，以及防范搜索路径越界。

```cmake
# ==============================================================================
# arm-none-eabi.cmake
# 针对 ARM Cortex-M / Bare-metal 架构的 CMake 交叉编译工具链配置文件
# ==============================================================================

# 1. 声明目标系统与架构
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

# 2. 绕过编译器链接测试（防止无链接脚本时检测失败）
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# 3. 确定主机平台特定的编译器可执行文件后缀
if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Windows")
    set(TOOLCHAIN_EXT ".exe")
else()
    set(TOOLCHAIN_EXT "")
endif()

# 4. 寻找交叉编译器路径
# 优先从环境变量 ARM_TOOLCHAIN_DIR 获取路径，若未定义则在系统 PATH 中寻找
if(NOT DEFINED ENV{ARM_TOOLCHAIN_DIR})
    message(STATUS "Environment variable 'ARM_TOOLCHAIN_DIR' not set. Searching compiler in system PATH...")
    find_program(ARM_GCC_PATH NAMES "arm-none-eabi-gcc${TOOLCHAIN_EXT}")
    if(NOT ARM_GCC_PATH)
        message(FATAL_ERROR "Could not find arm-none-eabi-gcc in system PATH. Please install it or set 'ARM_TOOLCHAIN_DIR'.")
    endif()
    # 提取编译器所在目录作为工具链根目录
    get_filename_component(TOOLCHAIN_BIN_DIR "${ARM_GCC_PATH}" DIRECTORY)
else()
    set(TOOLCHAIN_BIN_DIR "$ENV{ARM_TOOLCHAIN_DIR}")
    # 规范化路径斜杠
    file(TO_CMAKE_PATH "${TOOLCHAIN_BIN_DIR}" TOOLCHAIN_BIN_DIR)
endif()

message(STATUS "Using Toolchain Bin Directory: ${TOOLCHAIN_BIN_DIR}")

# 5. 指定 C/C++/ASM 编译器以及工具链辅助程序
set(CMAKE_C_COMPILER   "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-gcc${TOOLCHAIN_EXT}" CACHE FILEPATH "C Compiler")
set(CMAKE_CXX_COMPILER "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-g++${TOOLCHAIN_EXT}" CACHE FILEPATH "C++ Compiler")
set(CMAKE_ASM_COMPILER "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-gcc${TOOLCHAIN_EXT}" CACHE FILEPATH "ASM Compiler")

# 指定辅助工具（objcopy, size, objdump 等）
set(CMAKE_OBJCOPY      "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-objcopy${TOOLCHAIN_EXT}" CACHE FILEPATH "Objcopy Tool")
set(CMAKE_OBJDUMP      "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-objdump${TOOLCHAIN_EXT}" CACHE FILEPATH "Objdump Tool")
set(CMAKE_SIZE         "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-size${TOOLCHAIN_EXT}" CACHE FILEPATH "Size Tool")

# 6. 配置底层架构编译 flags（以 Cortex-M4 硬件浮点为例）
# 这些参数会被自动追加到所有目标的编译命令中
set(ARCH_FLAGS "-mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16")

# 注入全局编译标志
set(CMAKE_C_FLAGS   "${ARCH_FLAGS} -fdata-sections -ffunction-sections -Wall -Wextra" CACHE STRING "C Flags")
set(CMAKE_CXX_FLAGS "${ARCH_FLAGS} -fdata-sections -ffunction-sections -Wall -Wextra -fno-exceptions -fno-rtti" CACHE STRING "C++ Flags")
set(CMAKE_ASM_FLAGS "${ARCH_FLAGS} -x assembler-with-cpp" CACHE STRING "ASM Flags")

# 注入全局链接标志（例如，剥离未使用的段，使用 newlib-nano 规范）
set(CMAKE_EXE_LINKER_FLAGS "${ARCH_FLAGS} --specs=nano.specs -Wl,--gc-sections" CACHE STRING "Linker Flags")

# 7. 控制系统搜索路径行为
# 查找编译器自带的 sysroot 路径
execute_process(
    COMMAND "${CMAKE_C_COMPILER}" -print-sysroot
    OUTPUT_VARIABLE GCC_SYSROOT
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
if(GCC_SYSROOT)
    set(CMAKE_FIND_ROOT_PATH "${GCC_SYSROOT}")
endif()

# 隔离主机系统资源查找
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
