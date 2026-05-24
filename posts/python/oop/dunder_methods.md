---
title: "Python 常见双下魔术方法与运算符重载"
publishTime: "2026-05-24 18:40"
author: "hengvvang"
summary: "总结 Python 内部的各种双下划线特殊成员，揭示如何通过重载它们使自定义类具备运算符、迭代器等原生能力。"
readingTime: "2 min"
tags: ["PYTHON","OOP","Scripting"]
lastUpdated: "2026-05-25 02:30"
---






# Python 常见双下魔术方法与运算符重载

Python 的类中包含许多以双下划线开头和结尾的方法，被称为“魔术方法”（Magic Methods）或“双下方法”（Dunder Methods）。它们是 Python 协议式设计的核心。

## 1. 字符串表示：__str__ 与 __repr__

- `__str__`：由 `str()` 或 `print()` 触发，返回用户友好的描述。
- `__repr__`：由 `repr()` 触发，返回面向开发者调试的描述。

```python
class Vector:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return f"向量({self.x}, {self.y})"
```

## 2. 运算符重载：__add__ 与 __len__

通过覆写双下方法，我们可以让自定义对象支持原生的 `+` 加号或 `len()` 操作：

```python
class CustomCollection:
    def __init__(self, items):
        self.items = items

    def __len__(self):
        return len(self.items)

    def __add__(self, other):
        # 支持用 + 拼接集合
        return CustomCollection(self.items + other.items)
```

## 3. 上下文管理器：__enter__ 与 __exit__

这构成了 `with` 语句的基石，常用于实现资源的自动分配和安全释放（如文件、网络套接字句柄）：

```python
class Resource:
    def __enter__(self):
        print("获取资源...")
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        print("释放资源！")
        return False
```

通过覆写这些底层的魔术方法，能使你的类表现得如 Python 自带的内置对象般自然顺手。