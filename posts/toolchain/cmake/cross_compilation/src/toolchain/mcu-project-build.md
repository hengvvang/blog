# 第三章：Cortex-M 裸机项目交叉编译实战

在前两章中，我们理解了嵌入式交叉编译的物理本质，并设计好了通用的 CMake 工具链定义文件。本章将进入实际的工程构建阶段，基于 **Modern CMake（目标导向设计）** 规范，从零搭建一个基于 ARM Cortex-M 架构的 MCU 裸机工程。我们将展示如何实现汇编启动文件、链接脚本、用户 C/C++ 源码的混合编译，并通过后处理指令自动输出可以直接烧录的二进制固件。

---

## 3.1 物理内存映射与 LMA/VMA 深度解析

微控制器能够正确引导的基础在于链接脚本（Linker Script, `.ld`）所规定的物理内存映射。为了编写可靠的构建脚本，我们必须首先理清物理 Flash 与 RAM 之间的搬运关系：

### 3.1.1 芯片物理 Flash-RAM 映射图

```text
       物理 Flash 空间 (LMA, 加载域地址)            物理 SRAM 空间 (VMA, 运行域地址)
      +--------------------------------+           +--------------------------------+
0x08000000 |  Interrupt Vector Table (向量表) |           |                                |
      +--------------------------------+           |                                |
0x08000400 |  .text 段 (机器码指令)         |           |       Stack (栈空间，向下增长)  |
      |  (物理 XIP 运行于 Flash 内)    |           |       (SP 初始值指向栈顶地址)   |
      +--------------------------------+           |               |                |
      |  .rodata 段 (全局只读常量)     |           |               v                |
      +--------------------------------+           |                                |
      |  .data 加载段 (已初始化变量)   | ===拷贝==> |  .data 运行段 (读写物理变量)   | 0x20000000
      |  (断电时将初始值存放在此)      |   (启动    |  (存放于高速 SRAM 中运行)      |
      +--------------------------------+   汇编     +--------------------------------+
                                           执行)   |  .bss 运行段 (未初始化变量)    |
                                                   |  (启动时被汇编循环清零)        |
                                                   +--------------------------------+
                                                   |               ^                |
                                                   |               |                |
                                                   |       Heap (堆空间，用于malloc) |
                                                   |       (自低向高相对栈增长)     |
                                                   +--------------------------------+
                                                   |                                | 0x20020000 (RAM尾部)
```

### 3.1.2 关键概念：加载域 (LMA) vs 运行域 (VMA)

*   **加载存储地址（Load Memory Address, LMA）**：
    指程序物理上被烧录器写入并存放的持久性空间地址。在裸机系统中，这对应着芯片内部非易失的 Flash ROM 区域。
*   **运行执行地址（Virtual/Variable Memory Address, VMA）**：
    指程序运行时变量或代码所处并被 CPU 读写的物理内存地址。对于全局可写变量（`.data` 段），由于其需要频繁被修改，断电后其值丢失，故其 VMA 必须被映射到易失性读写存取速度极快的内部 SRAM 中。
*   **重定位过程**：
    链接脚本通过关键字 `AT` 指令，告知链接器将 `.data` 段的 LMA（装载地址）设在 Flash 中，而 VMA（执行地址）设在 SRAM 中。当系统上电复位时，第一阶段启动汇编（`Reset_Handler`）会检测这两个地址是否一致，若不一致，则利用循环将 Flash 中存放的初始值物理拷贝到 SRAM 对应区域。

---

## 3.2 基于 Target 的 Modern CMake 设计规范

在传统的 CMake 构建编写中，开发者常倾向于使用 `include_directories()`、`link_libraries()` 等全局指令。在庞大、多模块的嵌入式工程中，这种“大一统”的全局注入写法会导致多个协议栈（如 FreeRTOS、LwIP、USB 库）之间的宏定义互相冲突、头文件目录意外泄露，最终使项目耦合严重、难以拆分和演进。

Modern CMake 强力提倡**基于目标（Target-Based）**的设计模式。
我们将每一个功能模块定义为一个 Target（静态库或可执行目标），通过控制属性在目标间的**传播范围（Scope）**来细粒度地解耦模块：

1.  **`PRIVATE`**：表示属性（如包含目录、宏定义、编译参数）只对当前 Target 的源文件编译有效，不会向下传递给任何链接了该 Target 的其他目标。
2.  **`PUBLIC`**：表示属性对当前 Target 有效，且会自动向上传递，强制任何链接了该 Target 的其他目标也自动获得此属性。
3.  **`INTERFACE`**：表示当前 Target 自身不使用该属性（例如纯头文件的 API 定义库，或仅包含第三方导出的库），但任何链接到它的目标都会强制导入这些参数。

---

## 3.3 实战：编写顶层 `CMakeLists.txt` 构建脚本

以下是为基于 STM32F407 的 Cortex-M 裸机工程定制的顶层构建脚本。它展示了如何优雅地导入底层汇编代码、如何绑定链接参数、以及如何设置后处理流水线。

```cmake
# ==============================================================================
# CMakeLists.txt
# 基于 STM32F407VET6 MCU 的生产级 Modern CMake 构建脚本
# ==============================================================================

# 1. 声明 CMake 最低版本兼容要求
cmake_minimum_required(VERSION 3.16)

# 2. 声明工程项目名称，并显式激活 C、C++ 以及 ASM(汇编) 语言编译器支持
project(stm32_embedded_app C CXX ASM)

# 3. 约束 C/C++ 语言标准规范
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 4. 定义可执行二进制目标
# 在裸机开发中，芯片的汇编启动文件 (.s/.S) 与系统初始化 C 文件必须一并加入编译列表
add_executable(${PROJECT_NAME})

# 5. 声明目标所属源码文件
# 采用 target_sources 保证依赖项完全限定在该目标内，杜绝使用全局 GLOB 引入无用符号
target_sources(${PROJECT_NAME} PRIVATE
    src/main.c                  # 主应用代码
    src/syscalls.c              # 第一章设计的底层 C 标准库系统调用桩函数
    src/system_stm32f4xx.c      # 芯片时钟与核心外设基础配置
    startup_stm32f407vetx.s     # 厂商官方提供的中断向量表与汇编启动代码
)

# 6. 配置目标的头文件搜索路径
# 使用 PRIVATE 防止此路径泄露给链接到此工程的其他辅助测试 Target
target_include_directories(${PROJECT_NAME} PRIVATE
    include
)

# 7. 配置该 Target 所需的特定宏定义
target_compile_definitions(${PROJECT_NAME} PRIVATE
    STM32F407xx                 # 指定芯片型号，激活标准库内部的寄存器定义宏
    USE_HAL_DRIVER              # 启用物理 HAL 驱动层支持
)

# ------------------------------------------------------------------------------
# 8. 绑定物理链接脚本 (Linker Script) 与链接阶段深度配置
# ------------------------------------------------------------------------------
set(LINKER_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/stm32f407vetx_flash.ld")

target_link_options(${PROJECT_NAME} PRIVATE
    # A. 指定物理链接脚本路径，利用前缀参数 -T 直接传递给底层的 arm-none-eabi-ld 链接器
    "-T${LINKER_SCRIPT}"
    
    # B. 生成内存映射描述文件 (.map)，该文件能够精准展现每个全局函数和变量的物理地址
    "-Wl,-Map=${CMAKE_BINARY_DIR}/${PROJECT_NAME}.map"
    
    # C. 强制链接器在最终打包时剔除所有未被实际调用的函数段（gc-sections），配合编译器优化降低体积
    "-Wl,--gc-sections"
    
    # D. 要求链接器在编译结束时在终端中直接输出 RAM / FLASH 的空间分配百分比与已使用字节数
    "-Wl,--print-memory-usage"
)

# ------------------------------------------------------------------------------
# 9. 二进制固件后处理：生成烧录文件与物理占用分析
#    默认的构建只会产生带有庞大调试信息的 ELF 文件，裸机芯片无法直接识别。
#    我们利用生成器表达式与 add_custom_command 来挂载编译后置钩子 (POST_BUILD)。
# ------------------------------------------------------------------------------
if(CMAKE_OBJCOPY AND CMAKE_SIZE)
    
    # 使用生成器表达式动态获取目标可执行文件的最终生成绝对路径
    set(ELF_FILE_PATH $<TARGET_FILE:${PROJECT_NAME}>)
    set(HEX_FILE_PATH "${CMAKE_BINARY_DIR}/${PROJECT_NAME}.hex")
    set(BIN_FILE_PATH "${CMAKE_BINARY_DIR}/${PROJECT_NAME}.bin")

    # 在目标构建完成后，自动串行拉起后置处理工具链
    add_custom_command(
        TARGET ${PROJECT_NAME}
        POST_BUILD
        
        # A. 调用 objcopy 从 ELF 中抽取物理段，生成 Intel HEX 格式烧录文本
        COMMAND "${CMAKE_OBJCOPY}" -O ihex "${ELF_FILE_PATH}" "${HEX_FILE_PATH}"
        
        # B. 调用 objcopy 生成紧凑的纯二进制流文件 (.bin)，直接面向 Flash 物理块
        COMMAND "${CMAKE_OBJCOPY}" -O binary "${ELF_FILE_PATH}" "${BIN_FILE_PATH}"
        
        # C. 触发 size 静态空间检测器，使用 berkeley 格式输出代码段大小
        COMMAND "${CMAKE_SIZE}" --format=berkeley "${ELF_FILE_PATH}"
        
        # 终端显示注释
        COMMENT "Post-Processing: Extracting BIN/HEX images and calculating firmware memory footprint..."
    )

endif()
```

---

## 3.4 构建执行与编译管道说明

当我们组织好上述文件结构后，跨平台编译的拉起变得极其简单与统一。

### 3.4.1 核心构建指令详解

#### Step 1: 配置与生成阶段 (CMake Generate)
在项目根目录下打开终端，执行以下命令：

```bash
# 推荐采用 Ninja 作为构建生成器，以获得极致的并行编译体验
cmake -DCMAKE_TOOLCHAIN_FILE=arm-none-eabi.cmake -B build -G Ninja
```

*   **`-DCMAKE_TOOLCHAIN_FILE=arm-none-eabi.cmake`**：
    这是交叉编译的关键。该命令指示 CMake 挂载我们在第二章编写的工具链文件，从而使 CMake 拦截主机编译器检测，重定向到我们的交叉工具链 bin 目录，并锁死目标系统特性。
*   **`-B build`**：
    在根目录下新建并使用 `build` 文件夹，将所有的 CMake 缓存变量、临时编译中间目标 `.o` 隔离在其中，保证源文件目录的干净。
*   **`-G Ninja`**：
    指定底层的构建引擎。如果不指定，在 Windows 平台上 CMake 可能会默认调用 MSVC Visual Studio 构建环境，这会导致架构参数冲突。

#### Step 2: 编译与后处理阶段 (CMake Build)
使用 CMake 统一的平台命令触发底层编译：

```bash
cmake --build build -j 8
```

*   **`--build build`**：
    自动根据第一步的设定去调用 `build` 下的构建器（如 Ninja 或 Make）执行编译，免去了开发者根据平台不同在 `make` 或 `ninja` 命令之间切换的麻烦。
*   **`-j 8`**：
    开启 8 线程并行编译，编译速度极快。

---

## 3.5 编译输出产物说明

当编译成功后，在 `build` 文件夹中将生成以下四个核心文件，它们在嵌入式调试周期中各自承担重要的任务：

1.  **`stm32_embedded_app.elf`**：
    包含了完整的 DWARF 调试符号表和主机的元数据。虽然它体积庞大（可能有几百 KB 甚至数 MB），但它是进行单步调试（J-Link GDB Server / OpenOCD）时必不可少的映射文件。
2.  **`stm32_embedded_app.bin`**：
    被剔除了任何头文件元数据的纯物理机器指令流。它与芯片 Flash 中的物理电平结构完全一一对应。可通过 J-Flash、STM32CubeProgrammer 烧写。
3.  **`stm32_embedded_app.hex`**：
    用 ASCII 字符表示的 Intel HEX 文本，包含了具体的起始地址段偏移与校验码。在量产烧录时常用。
4.  **`stm32_embedded_app.map`**：
    这是最重要的内存物理映像文件。它记录了每一个静态局部变量、物理全局函数、甚至中断堆栈在 SRAM/Flash 中的绝对物理十六进制寻址地址，是分析静态代码溢出和排查死机时的第一手文献。
