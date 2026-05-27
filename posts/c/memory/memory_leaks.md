---
title: C语言动态内存分配、内存泄漏与 Valgrind 排查
publishTime: 2026-05-24 17:30
author: hengvvang
summary: 介绍如何利用 Valgrind 检测 C 代码中的内存开辟与释放不配对问题，保障堆内存的安全管理。
readingTime: 3 min
tags:
  - C
  - MEMORY
  - Pointers
  - Low-Level
lastUpdated: 2026-05-25 02:30
cover:
  image: https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=800&auto=format&fit=crop
  position: topLeft
  text: C | MEMORY
---






# C语言动态内存分配、内存泄漏与 Valgrind 排查

在没有垃圾回收机制的C语言中，手动管理堆内存是每个程序员的基本功。然而，内存泄漏、野指针、野内存访问等问题往往隐藏得很深。本文将介绍常见的动态分配陷阱，并展示如何使用调试工具 Valgrind 快速定位内存泄漏。

## 常见的动态分配 API

C标准库在 `<stdlib.h>` 中提供了动态内存管理的四个核心 API：
- `malloc(size)`：分配指定字节的内存，内容未初始化。
- `calloc(num, size)`：分配并清零内存。
- `realloc(*ptr, new_size)`：重新调整已分配内存的大小。
- `free(*ptr)`：释放内存。

```c
int* arr = (int*)malloc(10 * sizeof(int));
if (arr == NULL) {
    // 处理分配失败
    return;
}
// 使用完毕后必须释放
free(arr);
arr = NULL; // 避免野指针
```

## 内存泄漏的典型原因

1. **忘记释放内存**：在函数提前返回（Return）时丢失了指针的引用，没有调用 `free()`。
2. **指针重新赋值导致地址丢失**：
   ```c
   char* p = malloc(10);
   p = malloc(20); // 原先 10 字节的地址丢失，导致永久泄漏！
   ```
3. **结构体内部的悬挂指针**：释放了结构体容器本身，却忘记释放结构体内部指针指向的成员内存。

## 使用 Valgrind 排查泄漏

Valgrind 是一款强大的动态分析工具，它可以在虚拟机上运行你的可执行文件，并监控所有的读写与分配操作。

### 编译测试程序

要让 Valgrind 输出带源文件名和行号的详细报告，编译时必须加上 `-g` 调试参数：

```bash
gcc -g -O0 main.c -o my_prog
```

### 运行 Valgrind 检测

```bash
valgrind --tool=memcheck --leak-check=full ./my_prog
```

### 报告输出示例

```text
==12345== HEAP SUMMARY:
==12345==     in use at exit: 40 bytes in 1 blocks
==12345==   total heap usage: 1 allocs, 0 frees, 40 bytes allocated
==12345== 
==12345== 40 bytes in 1 blocks are definitely lost in loss record 1 of 1
==12345==    at 0x4C29F73: malloc (vg_replace_malloc.c:309)
==12345==    by 0x40054F: main (main.c:6)
```

Valgrind 会明确指出哪个函数、哪一行代码（如 `main.c:6`）分配的内存最终“Definitely Lost”了。

## 总结

防范内存泄漏的关键在于良好的编程习惯。坚持“谁分配谁释放”的对称设计，并结合静态分析工具和 Valgrind 动态监测，能极大地提升 C 代码的健壮性。
