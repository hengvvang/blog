---
title: "Python 元类 Metaclasses 与动态类创建原理"
publishTime: "2026-05-24 18:45"
author: "hengvvang"
summary: "剖析 Python 的 __new__ 与 __init__，了解如何拦截类创建过程并在类实例化之前修改其属性与行为。"
---




# Python 元类 Metaclasses 与动态类创建原理

在绝大多数面向对象语言中，类是用来创建对象的模板。但在 Python 中，**类本身也是一个对象**，它是由“元类”（Metaclass）创建出来的。

## 动态创建类：type()

通常我们用 `class` 声明一个类。但实际上，我们可以用 `type()` 动态构建一个类：

```python
# 语法: type(类名, 父类元组, 属性与方法字典)
MyClass = type("MyClass", (object,), {"val": 100})

obj = MyClass()
print(obj.val) # 输出: 100
```

## 什么是元类？

元类就是“创建类的类”。Python 中默认的元类是 `type`。

通过继承 `type` 并重写 `__new__` 方法，我们可以在类被定义的那一刻对其进行拦截、修改、校验甚至完全重构。这常用于编写大型 ORM 框架或插件验证系统。

## 自定义元类示例

编写一个元类，强制该类下的所有自定义属性名称必须全部为大写：

```python
class UpperAttrMetaclass(type):
    def __new__(mcs, name, bases, attrs):
        uppercase_attrs = {}
        for key, val in attrs.items():
            if not key.startsWith("__"): # 忽略系统双下属性
                uppercase_attrs[key.upper()] = val
            else:
                uppercase_attrs[key] = val
        return super().__new__(mcs, name, bases, uppercase_attrs)

class MyCustomModel(metaclass=UpperAttrMetaclass):
    data_value = "hello"

obj = MyCustomModel()
# print(obj.data_value) # 报错！没有该属性
print(obj.DATA_VALUE) # 成功输出: hello
```

## 总结

元类属于 Python 的高级黑魔法。由于它会显著增加代码的理解难度，除非你在开发底层的模块级框架或极其复杂的校验系统，否则在普通业务开发中应当慎用。