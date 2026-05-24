---
title: "CMake 构建宏编写与自动化 CI/CD 环境结合运用"
publishTime: "2026-05-24 12:15"
author: "hengvvang"
summary: "从 CMakeLists.txt 的基础指令开始，构建一个从单文件编译到多层目录结构项目的工程范本。"
readingTime: "2 min"
tags: ["TOOLCHAIN","CMAKE","Build","Compiler"]
lastUpdated: "2026-05-25 02:30"
---






# CMake 构建宏编写与自动化 CI/CD 环境结合运用

一套好用的构建工具链可以大幅提升软件开发生产力。本文从 GCC 链接器脚本（.ld）的自定义语法分配出发，讨论 CMake 构建宏的编写，以及如何将它们与现代 CI/CD 自动化流水线结合。

## CMake 基础宏与自定义配置

CMake 作为跨平台的构建生成器，提供了丰富的宏（Macro）和函数（Function）定义机制。

### 定义一个自定义目标构建函数

```cmake
# 定义一个编译并生成 Hex/Bin 文件的辅助函数
function(add_embedded_executable TARGET_NAME)
    add_executable(${TARGET_NAME} ${ARGN})
    
    # 链接特殊的链接器脚本
    target_link_options(${TARGET_NAME} PRIVATE 
        "-T${CMAKE_CURRENT_SOURCE_DIR}/linker.ld"
        "-Wl,-Map=${TARGET_NAME}.map"
    )
    
    # 构建后自动转换为 binary 文件
    add_custom_command(TARGET ${TARGET_NAME} POST_BUILD
        COMMAND ${CMAKE_OBJCOPY} -O binary ${TARGET_NAME} ${TARGET_NAME}.bin
        COMMENT "Generating bin file for programming..."
    )
endfunction()
```

## GCC 链接器脚本（.ld）的作用

链接器脚本定义了目标板的物理内存排布。对于嵌入式设备，我们必须精确将代码段放入 Flash，变量段放入 RAM。

```ld
/* 简化的 linker.ld 示例 */
MEMORY
{
  FLASH (rx)      : ORIGIN = 0x08000000, LENGTH = 512K
  RAM (xrw)       : ORIGIN = 0x20000000, LENGTH = 128K
}

SECTIONS
{
  .text :
  {
    KEEP(*(.isr_vector)) /* 中断向量表 */
    *(.text*)            /* 程式代碼 */
    *(.rodata*)          /* 只讀數據 */
  } > FLASH
}
```

## 自动化 CI/CD 环境集成

在持续集成（CI）系统中，我们通常需要自动化地执行静态代码检查、单元测试并输出最终固件。

下面是一个标准的 `.github/workflows/build.yml` 配置示例：

```yaml
name: Embedded CMake Build

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Arm GNU Toolchain
        run: |
          sudo apt-get update
          sudo apt-get install -y gcc-arm-none-eabi cmake ninja-build
          
      - name: Configure CMake
        run: cmake -B build -G Ninja -DCMAKE_TOOLCHAIN_FILE=toolchain-arm.cmake
        
      - name: Build Firmware
        run: cmake --build build --target my_firmware
```

通过这样的自动化集成，我们能够保证每次提交的代码都在物理层面上是可编译的，确保团队协作的健康与稳定。
