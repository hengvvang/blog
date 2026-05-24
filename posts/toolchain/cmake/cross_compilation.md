---
title: "CMake 交叉编译配置与 Toolchain 工具链声明"
publishTime: "2026-05-24 17:10"
author: "hengvvang"
description: "在宿主机（如 x86 PC）上开发嵌入式固件并期望编译输出能在目标机（如 ARM Cortex-M 单片机）上运行，这种构建过程被称为交叉编译。"
---

# CMake 交叉编译配置与 Toolchain 工具链声明

在宿主机（如 x86 PC）上开发嵌入式固件并期望编译输出能在目标机（如 ARM Cortex-M 单片机）上运行，这种构建过程被称为**交叉编译**。

## 编写 Toolchain 脚本

我们通常定义一个专用的 `toolchain.cmake` 配置文件：

```cmake
# 声明目标系统为通用裸机系统
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

# 声明交叉编译器路径
set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_CXX_COMPILER arm-none-eabi-g++)

# 配置编译器标志，指定芯片核心
set(CMAKE_C_FLAGS "-mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16")
```

## 在编译时指定工具链

在构建项目时，直接通过参数传入该文件即可完成交叉编译链的切换：

```bash
cmake -B build -DCMAKE_TOOLCHAIN_FILE=toolchain.cmake
cmake --build build
```

借助跨平台的编译文件，开发者能无缝配置各种芯片项目的本地及 CI 自动构建工程。