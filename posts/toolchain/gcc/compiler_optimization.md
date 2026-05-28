---
title: GCC 编译器三级优化选项与内联汇编详解
publishTime: 2026-05-24 16:40
author: hengvvang
summary: 全方位对比 GCC 的各类编译优化等级，分析其在循环展开、死代码消除、函数内联及二进制体积上的抉择。
readingTime: 1 min
tags:
  - TOOLCHAIN
  - GCC
  - Build
  - Compiler
lastUpdated: 2026-05-25 02:30
cover:
  image:
    src: https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&auto=format&fit=crop
    brightness: 0.75
    scale: 1.08
  text:
    content: TOOLCHAIN | GCC
    position: bottomRight
category: toolchain
subcategory: gcc
subtopic: others
---






# GCC 编译器三级优化选项与内联汇编详解

GCC 提供了不同层级的代码优化编译选项（-O0 至 -O3），它们在编译速度、代码体积以及运行执行速度之间做着精细权衡。

## 优化级别定义

- **-O0**：无优化。生成最直接对应的汇编代码，便于在断点调试中查看真实的变量变化。
- **-O1**：基础优化。尝试精简冗余指令并做寄存器分配。
- **-O2**：二级常规优化。包含几乎所有的全局优化算法，推荐用于最终交付产品。
- **-O3**：三级深度优化。开启函数内联（Inlining）、循环展开（Loop Unrolling）及自动矢量化（Auto-Vectorization），可能导致最终固件体积变大。

## GCC 内联汇编使用

有时候我们必须在 C 语言中插入汇编指令：

```c
// 使用 inline asm 读取 ARM 控制寄存器
uint32_t read_control(void) {
    uint32_t val;
    __asm__ volatile("MRS %0, CONTROL" : "=r"(val) :: "memory");
    return val;
}
```

使用 `volatile` 告诉编译器千万不能将这段自定义指令优化挪动位置。