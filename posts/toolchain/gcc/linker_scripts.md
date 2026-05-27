---
title: 链接器脚本高级命令与自定义 Section 分配
publishTime: 2026-05-24 16:50
author: hengvvang
summary: 从 MEMORY 和 SECTIONS 指令入手，解析如何定义 Flash 与 RAM 的边界，以及如何安排代码段与数据段的存放位置。
readingTime: 1 min
tags:
  - TOOLCHAIN
  - GCC
  - Build
  - Compiler
lastUpdated: 2026-05-25 02:30
cover:
  image: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop
  position: topRight
  text: TOOLCHAIN | GCC
---






# 链接器脚本高级命令与自定义 Section 分配

链接器脚本（Linker Script）控制着最终二进制文件每一部分代码在芯片物理存储中的位置。

## 定义专属的自定义内存段

假定我们需要为系统内核提供一个独立的配置参数区域：

```ld
SECTIONS
{
  .config_data :
  {
    . = ALIGN(4);
    KEEP(*(.kernel_config)) /* 保留 kernel_config 变量不被 GCC 的 GC 优化回收 */
  } > FLASH
}
```

## C代码声明分配

在 C 源码中，通过属性标记将指定配置项丢入该位置：

```c
const char config_info[] __attribute__((section(".kernel_config"))) = "CORE_V1.0";
```

通过此类脚本的高级定义，我们可以在芯片烧录时，把固件代码和特定参数放置在不同的区间，进行独立升级维护。