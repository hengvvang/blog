---
title: C语言数组指针与指针数组概念辨析
publishTime: 2026-05-24 16:30
author: hengvvang
summary: 区分指针组成的数组和指向整个数组的指针，帮助理清它们在定义、解引用和地址偏移上的核心差异。
readingTime: 1 min
tags:
  - C
  - POINTERS
  - Pointers
  - Low-Level
lastUpdated: 2026-05-25 02:30
cover:
  image:
    src: https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=800&auto=format&fit=crop
    brightness: 0.75
    scale: 1.08
  text:
    content: C | POINTERS
    position: center
---






# C语言数组指针与指针数组概念辨析

在C语言的高级使用中，“数组指针”与“指针数组”仅两字之差，但其实际数据结构在内存分布上有着天壤之别。

## 1. 指针数组 (Array of Pointers)

指针数组**本质是一个数组**，数组中的每一个成员都是一个指针变量：

```c
int* arr[3]; // 定义了一个包含 3 个指向整型(int*)指针的数组
```

## 2. 数组指针 (Pointer to an Array)

数组指针**本质是一个指针**，它指向一个具有固定大小的数组：

```c
int (*ptr)[3]; // 定义了一个指向“包含3个int的数组”的指针
```

由于括号 `()` 的优先级高于 `[]`，使用括号改变结合性是区分二者的关键。深刻掌握这一概念，对于处理 C 语言多维矩阵运算非常有帮助。