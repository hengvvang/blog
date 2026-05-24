---
title: "Python 装饰器基础与函数运行时计时器"
publishTime: "2026-05-24 18:30"
author: "hengvvang"
description: "装饰器（Decorators）是 Python 中极其优雅的语法糖，允许你在不修改原函数代码的前提下，动态地为函数织入额外的行为逻辑（如日志打印、耗时统计、权限校验）。"
---

# Python 装饰器基础与函数运行时计时器

装饰器（Decorators）是 Python 中极其优雅的语法糖，允许你在不修改原函数代码的前提下，动态地为函数织入额外的行为逻辑（如日志打印、耗时统计、权限校验）。

## 装饰器的本质

装饰器本质上是一个接收函数作为参数、并返回一个新包装函数的**高阶函数**。

```python
def my_decorator(func):
    def wrapper():
        print("执行前...")
        func()
        print("执行后.")
    return wrapper

@my_decorator
def say_hi():
    print("Hi!")

say_hi()
```

## 计时器装饰器实战

下面是一个通用的高阶函数运行时长统计计时器，使用 `functools.wraps` 保留原函数的文档与名称元数据：

```python
import time
from functools import wraps

def time_it(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        end = time.perf_counter()
        print(f"函数 {func.__name__} 耗时: {end - start:.6f} 秒")
        return result
    return wrapper

@time_it
def compute_squares(n):
    return [i**2 for i in range(n)]

compute_squares(100000)
```

利用通用的 `*args` 和 `**kwargs`，该计时器可直接套用到任何参数形式的函数上。