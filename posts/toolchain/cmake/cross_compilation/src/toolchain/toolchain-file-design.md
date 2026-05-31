# 第二章：CMake 交叉编译工具链文件设计

在 CMake 体系中，**工具链文件（Toolchain File）**是控制交叉编译的最核心入口。每当 CMake 初始化一个项目（遇到顶层 `CMakeLists.txt` 中的 `project()` 指令）时，它会首先确定当前的宿主操作系统（Host OS），并探测、验证编译器是否工作正常。

对于嵌入式开发，我们必须编写一个自定义的 `.cmake` 脚本，在 CMake 执行任何探测逻辑之前拦截并注入目标平台与工具链的信息。本章将详细解构 CMake 交叉编译的核心控制变量、编译探测生命周期、系统目录隔离机制，并提供一份生产级的通用工具链文件设计模板。

---

## 2.1 CMake 交叉编译生命周期与探测拦截

在默认的本地编译流程中，CMake 会自动加载宿主机的编译器（如 Windows 上的 MSVC，或 Linux 上的 GCC）。但当我们传入 `-DCMAKE_TOOLCHAIN_FILE=path/to/toolchain.cmake` 时，CMake 的执行生命周期会发生关键变化：

```text
命令行输入: cmake -DCMAKE_TOOLCHAIN_FILE=...
                 |
                 v
   [ 拦截加载 Toolchain File ]  <--- (注入目标系统与编译器变量)
                 |
                 v
      CMakeDetermineSystem.cmake  <--- (确定 CMAKE_SYSTEM_NAME, 锁定 CMAKE_CROSSCOMPILING 为 TRUE)
                 |
                 v
    CMakeDetermineCompiler.cmake  <--- (依据指定的 CMAKE_C_COMPILER 进行探针编译)
                 |
                 +-------------------------------------------------------+
                 | 默认 CMAKE_TRY_COMPILE_TARGET_TYPE = EXECUTABLE       |
                 |   -> 尝试编译、汇编、链接 test.c                       |
                 |   -> [报错] 缺失 _sbrk 等桩函数, 链接脚本未绑定          |
                 +-------------------------------------------------------+
                 | 拦截修改为 CMAKE_TRY_COMPILE_TARGET_TYPE = STATIC_LIBRARY |
                 |   -> 只编译、汇编 test.c 生成静态库                   |
                 |   -> [成功] 绕过链接阶段, 编译器检测通过                |
                 +-------------------------------------------------------+
                 |
                 v
        继续解析主 CMakeLists.txt
```

1.  **加载拦截**：CMake 在读取 `project()` 指令时，如果检测到命令行配置了 `CMAKE_TOOLCHAIN_FILE`，会优先且直接执行该工具链文件。
2.  **确定系统模型**：工具链文件声明 `CMAKE_SYSTEM_NAME`。一旦该变量被设定为与主机操作系统不同（或者在裸机中设为 `Generic`），CMake 内部会立即将只读状态变量 `CMAKE_CROSSCOMPILING` 锁定为 `TRUE`。
3.  **编译器探针测试（Try-Compile）**：CMake 会在后台自动生成一个临时的测试源文件（如 `testCCompiler.c`），并调用我们声明的交叉编译器对其进行编译测试，以检验编译器是否能正常生成代码、检测编译器版本以及支持的特性。

---

## 2.2 核心控制变量深度剖析

工具链文件中必须显式配置以下几个基础的 CMake 内部核心变量：

### 2.2.1 `CMAKE_SYSTEM_NAME` (目标系统名称)
*   **定义**：目标机运行的操作系统类型。
*   **取值**：
    *   在有操作系统的嵌入式平台中，可以设置为 `Linux`、`Android`、`Darwin`、`WindowsStore`。
    *   在**裸机（Bare-metal）**或没有得到 CMake 官方原生系统库支持的嵌入式实时操作系统（如 FreeRTOS、RT-Thread、VxWorks 等）开发中，**必须将其设置为 `Generic`**。
*   **作用**：告诉 CMake 目标系统没有默认的库路径、默认的头文件搜索目录（如 `/usr/lib`）以及标准的主机运行时环境，必须严格按照工具链提供的路径进行寻址。

### 2.2.2 `CMAKE_SYSTEM_PROCESSOR` (目标处理器架构)
*   **定义**：目标芯片的 CPU 硬件架构。
*   **取值**：通常为 `arm`、`riscv32`、`riscv64`、`mips` 等。
*   **作用**：用于在项目脚本中做条件分支选择。例如，主工程可以根据该变量来决定是否开启特定架构的硬件加速汇编代码：
    ```cmake
    if(CMAKE_SYSTEM_PROCESSOR STREQUAL "arm")
        target_sources(my_app PRIVATE asm/arm_dsp_filter.s)
    elseif(CMAKE_SYSTEM_PROCESSOR STREQUAL "riscv32")
        target_sources(my_app PRIVATE asm/riscv_dsp_filter.s)
    endif()
    ```

### 2.2.3 `CMAKE_TRY_COMPILE_TARGET_TYPE` (探针测试生成类型)
*   **默认值**：`EXECUTABLE` (生成可执行程序)。
*   **裸机痛点**：在默认配置下，CMake 的探针测试会执行完整的编译和链接过程（生成 ELF 文件）。然而在裸机开发中，此时 CMake 还不知道我们的物理内存布局，没有绑定链接脚本（`.ld`），且没有链接底层的系统桩函数（如前面实现的 `_sbrk`、`_write`）。因此，链接器必定会抛出 "undefined reference" 的链接错误，导致 CMake 直接报错并中断配置。
*   **黄金解法**：在工具链文件中加入：
    ```cmake
    set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
    ```
    强制 CMake 的测试探针**只进行编译、汇编生成静态库（`*.a`）文件，完全绕过链接步骤**。由于编译静态库不涉及符号解析与物理地址分配，测试将 100% 成功，编译器得已被顺利识别。

---

## 2.3 系统根目录寻址与隔离（Sysroot 机制）

为了防止交叉编译时混入主机系统的资源，CMake 提供了 Sysroot 隔离机制。

### 2.3.1 `CMAKE_FIND_ROOT_PATH` (资源重定向根路径)
指定交叉编译器自带的标准库、系统头文件以及第三方库的物理根路径。例如：
`C:/arm-gnu-toolchain/arm-none-eabi/`。
当我们在主 CMake 脚本中调用 `find_path()` 或 `find_library()` 时，CMake 会将此路径作为前缀拼接到待查找的子路径之前。

### 2.3.2 搜索过滤模式控制 (Search Modes)
CMake 允许通过以下四个变量精确控制不同类型资源的搜索范围：

| 变量名称 | 适用搜索指令 | 推荐取值 | 行为说明 |
| :--- | :--- | :--- | :--- |
| **`CMAKE_FIND_ROOT_PATH_MODE_PROGRAM`** | `find_program()` | `NEVER` | **只在主机（Host）系统**中查找可执行工具（如 `ninja`、`make`、`git` 等）。因为目标微控制器无法运行这些构建辅助程序。 |
| **`CMAKE_FIND_ROOT_PATH_MODE_LIBRARY`** | `find_library()` | `ONLY` | **只在指定的 `CMAKE_FIND_ROOT_PATH`**（目标 Sysroot）下查找库文件，绝对禁止引入主机架构的库。 |
| **`CMAKE_FIND_ROOT_PATH_MODE_INCLUDE`** | `find_path()` / `find_file()` | `ONLY` | **只在目标系统的 Sysroot** 下查找头文件。 |
| **`CMAKE_FIND_ROOT_PATH_MODE_PACKAGE`** | `find_package()` | `ONLY` | **只在目标系统的 Sysroot** 下寻找 CMake 配置文件（如 `TargetConfig.cmake`）。 |

---

## 2.4 生产级 `arm-none-eabi.cmake` 工具链设计

以下是一份高度模块化、具备强健兼容性且可直接应用于生产环境的 `arm-none-eabi-gcc` 交叉编译工具链配置文件。它支持自动从环境变量或系统 PATH 中动态检索编译器、自动适配 Windows/Linux/macOS 平台，并预设了标准的 MCU 编译优化参数：

```cmake
# ==============================================================================
# arm-none-eabi.cmake
# 针对 ARM Cortex-M 裸机/嵌入式系统的通用 CMake 交叉编译工具链定义文件
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. 拦截目标系统与探针设置
# ------------------------------------------------------------------------------
set(CMAKE_SYSTEM_NAME Generic)       # 声明目标系统为通用裸机
set(CMAKE_SYSTEM_PROCESSOR arm)      # 目标处理器架构为 ARM 32位

# 强制 CMake 在编译器探针测试时仅生成静态库，完美绕过链接存根报错
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# ------------------------------------------------------------------------------
# 2. 主机兼容性处理 (自动识别 Windows 上的 .exe 后缀)
# ------------------------------------------------------------------------------
if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Windows")
    set(TOOLCHAIN_SUFFIX ".exe")
else()
    set(TOOLCHAIN_SUFFIX "")
endif()

# ------------------------------------------------------------------------------
# 3. 动态检索交叉编译器路径
#    检索优先级：
#    A. 用户指定的 CMake 缓存变量 -DARM_TOOLCHAIN_DIR
#    B. 系统的环境变量 ENV{ARM_TOOLCHAIN_DIR}
#    C. 自动在操作系统环境变量 PATH 中查找 arm-none-eabi-gcc
# ------------------------------------------------------------------------------
if(DEFINED ARM_TOOLCHAIN_DIR)
    # A. 优先使用用户通过 -D 传入的变量
    set(TOOLCHAIN_BIN_DIR "${ARM_TOOLCHAIN_DIR}")
elseif(DEFINED ENV{ARM_TOOLCHAIN_DIR})
    # B. 次优先使用环境变量
    set(TOOLCHAIN_BIN_DIR "$ENV{ARM_TOOLCHAIN_DIR}")
else()
    # C. 自动在 PATH 中定位 arm-none-eabi-gcc 的物理路径
    find_program(ARM_GCC_EXECUTABLE NAMES "arm-none-eabi-gcc${TOOLCHAIN_SUFFIX}")
    if(NOT ARM_GCC_EXECUTABLE)
        message(FATAL_ERROR "Could not find 'arm-none-eabi-gcc' in your system PATH.\n"
                            "Please add the compiler directory to your system PATH, or set the "
                            "environment variable 'ARM_TOOLCHAIN_DIR' to specify its location.")
    endif()
    # 提取可执行文件所在的 BIN 目录
    get_filename_component(TOOLCHAIN_BIN_DIR "${ARM_GCC_EXECUTABLE}" DIRECTORY)
endif()

# 规范化路径分隔符，确保在 Windows 平台下也使用斜线 '/'
file(TO_CMAKE_PATH "${TOOLCHAIN_BIN_DIR}" TOOLCHAIN_BIN_DIR)
message(STATUS "Embedded Toolchain Bin Path: ${TOOLCHAIN_BIN_DIR}")

# ------------------------------------------------------------------------------
# 4. 显式指定编译器与核心二进制工具的绝对物理路径
# ------------------------------------------------------------------------------
set(CMAKE_C_COMPILER   "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-gcc${TOOLCHAIN_SUFFIX}" CACHE FILEPATH "C Compiler")
set(CMAKE_CXX_COMPILER "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-g++${TOOLCHAIN_SUFFIX}" CACHE FILEPATH "C++ Compiler")
set(CMAKE_ASM_COMPILER "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-gcc${TOOLCHAIN_SUFFIX}" CACHE FILEPATH "ASM Compiler")

set(CMAKE_OBJCOPY      "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-objcopy${TOOLCHAIN_SUFFIX}" CACHE FILEPATH "Objcopy")
set(CMAKE_OBJDUMP      "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-objdump${TOOLCHAIN_SUFFIX}" CACHE FILEPATH "Objdump")
set(CMAKE_SIZE         "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-size${TOOLCHAIN_SUFFIX}" CACHE FILEPATH "Size Tool")
set(CMAKE_AR           "${TOOLCHAIN_BIN_DIR}/arm-none-eabi-ar${TOOLCHAIN_SUFFIX}" CACHE FILEPATH "Archiver")

# ------------------------------------------------------------------------------
# 5. 指定 CPU 内核架构、浮点配置与编译优化标志
#    (注意：这些标志通常属于目标芯片，本处以 Cortex-M4 硬件单精度浮点为例)
# ------------------------------------------------------------------------------
set(ARCH_FLAGS "-mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16")

# 注入全局 C 编译选项
# -ffunction-sections & -fdata-sections: 让编译器将每个函数和全局变量放入独立的 ELF 段中，
#                                        便于链接器在打包时剔除未使用的死代码。
set(CMAKE_C_FLAGS   "${ARCH_FLAGS} -ffunction-sections -fdata-sections -Wall -Wextra" CACHE STRING "Global C compiler flags")

# 注入全局 C++ 编译选项
# -fno-exceptions & -fno-rtti: 禁用 C++ 异常处理机制与运行时类型识别。这两个特性会产生巨大的
#                              异常展开表和元数据，会导致 MCU 裸机 Flash 空间瞬间爆满。
set(CMAKE_CXX_FLAGS "${ARCH_FLAGS} -ffunction-sections -fdata-sections -fno-exceptions -fno-rtti -Wall -Wextra" CACHE STRING "Global C++ compiler flags")

# 注入全局汇编编译选项
# -x assembler-with-cpp: 告诉编译器启用预处理器，允许在汇编启动文件 (.s / .S) 中使用 #define 或 #include
set(CMAKE_ASM_FLAGS "${ARCH_FLAGS} -x assembler-with-cpp" CACHE STRING "Global ASM compiler flags")

# 注入全局可执行文件链接选项
# --specs=nano.specs: 强制链接轻量级的 Newlib-Nano 标准库
# -Wl,--gc-sections: 垃圾回收，链接时丢弃所有未被引用的 function-section 和 data-section，大幅降低最终固件体积
set(CMAKE_EXE_LINKER_FLAGS "${ARCH_FLAGS} --specs=nano.specs -Wl,--gc-sections" CACHE STRING "Global linker flags")

# ------------------------------------------------------------------------------
# 6. 配置系统的 Sysroot 重定向与隔离机制
# ------------------------------------------------------------------------------
# 向编译器查询其内建的 Sysroot 路径
execute_process(
    COMMAND "${CMAKE_C_COMPILER}" -print-sysroot
    OUTPUT_VARIABLE GCC_SYSROOT_PATH
    OUTPUT_STRIP_TRAILING_WHITESPACE
)

if(GCC_SYSROOT_PATH)
    set(CMAKE_FIND_ROOT_PATH "${GCC_SYSROOT_PATH}")
else()
    # 如果 GCC 未返回 sysroot，将工具链 bin 目录的上级目录作为搜索根目录
    get_filename_component(TOOLCHAIN_PARENT_DIR "${TOOLCHAIN_BIN_DIR}" DIRECTORY)
    set(CMAKE_FIND_ROOT_PATH "${TOOLCHAIN_PARENT_DIR}/arm-none-eabi")
endif()

# 强制隔离搜索行为
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER) # 查找辅助构建软件只去主机系统找
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)  # 库查找严格锁定在工具链内
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)  # 头文件查找严格锁定在工具链内
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)  # CMake package 查找严格锁定在工具链内
```

在下一章中，我们将编写针对实际 MCU 裸机芯片的 `CMakeLists.txt` 构建配置，并在顶层把这个工具链描述文件与启动汇编、链接脚本、二进制后处理操作完全缝合。
