# 作用域与基础语法

本部分将深入探讨 Python 语言中的作用域机制、闭包的内存布局以及装饰器的核心语法。这是理解和掌握 Python 高级编程（如元编程、框架开发）的关键基石。

## 本部分核心主题

在第一部分中，我们将分为两个主要章节进行深度剖析：

1. **LEGB 查找规则与闭包语法基础**
   - 探究 Python 解释器在遇到变量时的查找顺序（Local, Enclosing, Global, Built-in）。
   - 解析“第一类对象”（First-Class Citizens）的概念，并展示如何通过函数作为参数与返回值构建函数工厂。
   - 深入闭包的本质，剖析 Python 虚拟机的 `PyCellObject` 以及 `__closure__` 属性，揭示自由变量生命周期延长的内存逻辑。
   - 比较 `global` 与 `nonlocal` 关键字的原理与区别，避免 `UnboundLocalError` 陷阱。

2. **装饰器语法糖与通用参数传递**
   - 解密 `@` 语法糖在编译期与运行期的执行时机。
   - 掌握通过 `*args` 和 `**kwargs` 实现通用参数拦截与转发。
   - 探讨装饰器引起的元数据丢失问题，并利用 `functools.wraps` 对包装函数进行元数据恢复。

---

## 知识结构脑图

以下是本部分内容的逻辑结构：

```text
Python 运行期作用域 (LEGB)
  ├── L (Local): 局部作用域
  ├── E (Enclosing): 嵌套/闭包外层作用域  ─── 形成“自由变量” ─── 闭包 (__closure__)
  ├── G (Global): 模块全局作用域
  └── B (Built-in): 内建作用域
         │
         ▼
    装饰器设计 (@ 语法糖)
         ├── 编译期: 立即对 @decorator 进行求值绑定 (func = decorator(func))
         ├── 运行期: 调用 wrapper(*args, **kwargs) 并利用 functools.wraps 复制元数据
         └── 底层: 借由闭包机制，使 wrapper 维持对被包装函数的生命周期引用
```

通过这一部分的学习，你将具备从底层字节码和内存模型视角剖析 Python 函数式编程行为的能力，为后续的复杂工程实践打下坚实的基础。
