---
title: "深入理解 C 语言栈溢出攻击与防御防范"
publishTime: "2026-05-24 16:20"
author: "hengvvang"
description: "C语言中不带边界检测的数组拷贝操作（如 strcpy）极易造成缓冲区溢出（Stack Overflow），进而导致程序被非法注入恶意代码甚至夺取系统最高控制权。"
---

# 深入理解 C 语言栈溢出攻击与防御防范

C语言中不带边界检测的数组拷贝操作（如 `strcpy`）极易造成缓冲区溢出（Stack Overflow），进而导致程序被非法注入恶意代码甚至夺取系统最高控制权。

## 溢出原理示意

局部变量和函数返回地址（RET 指针）都保存在物理栈（Stack）中。栈向低地址生长。如果在拷贝字符时超出定义边界，数据就会向上覆盖破坏 RET 地址：

```c
void unsafe_copy(char* input) {
    char buf[8];
    strcpy(buf, input); // 输入若大于 8 字节，将覆盖其后的栈返回地址
}
```

## 防御措施

1. **改用安全函数**：彻底淘汰 `strcpy`，改用带大小限制的 `strncpy` 或更健壮的 `snprintf`。
2. **启用编译守护**：GCC 提供了 `-fstack-protector`（堆栈保护哨兵），在函数退出时检查验证哨兵数值是否被修改，防止代码被篡改。