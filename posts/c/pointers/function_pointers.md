---
title: "C语言函数指针与面向对象回调函数设计"
publishTime: "2026-05-24 16:10"
author: "hengvvang"
summary: "学习如何将函数地址作为参数进行传递，探讨回调函数以及基于函数指针数组的多路分发实现。"
readingTime: "1 min"
tags: ["C","POINTERS","Pointers","Low-Level"]
lastUpdated: "2026-05-25 02:30"
cover: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop"
coverText:
  position: topRight
  context: "C | POINTERS"
---






# C语言函数指针与面向对象回调函数设计

函数指针允许我们将代码函数本身作为一个变量值传递，这在编写底层驱动程序、中断服务接口以及模仿面向对象设计中的“多态和接口”时不可或缺。

## 声明与基础调用

```c
// 声明一个接收两个 int 并返回 int 的函数指针类型
typedef int (*calc_func_t)(int, int);

int add(int a, int b) { return a + b; }

int main() {
    calc_func_t op = add; // 指向 add 函数
    int result = op(5, 3); // 相当于调用 add(5, 3)
    printf("结果: %d\n", result);
}
```

## 结构体中的虚表实现

我们可以利用结构体和函数指针，为 C 语言结构体绑定成员函数：

```c
typedef struct Driver {
    int id;
    void (*open)(struct Driver* self);
    void (*close)(struct Driver* self);
} Driver;
```

这样各个芯片外设驱动只需给结构体赋予不同的操作指针，就能实现平台无关的上层接口，实现面向对象的精髓。