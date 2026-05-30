# 第三章：高级装饰器技巧、元数据保留与动态代理

在企业级 Python 应用开发中，简单的包裹函数已经无法满足高可靠性和可维护性的要求。装饰器需要完美兼容类型提示（Type Hints）、正确传递函数签名、提供动态代理能力，并且能对整个类进行深度的切面扫描。本章将介绍这些前沿的“黑魔法”。

---

## 1. 元数据丢失与完美保留机制

当一个函数被装饰器包装后，其名字 `__name__` 和文档字符串 `__doc__` 都会变成内部包装器的信息，这会导致调试困难和自动化文档工具失效。

### 1.1 `functools.wraps` 底层做了什么？
Python 的 `functools` 模块提供了 `wraps` 装饰器，它实际上是 `update_wrapper` 的快捷方式。它会将原函数的如下属性复制到包装器函数上：
- `__module__`、`__name__`、`__qualname__`、`__doc__` 和 `__annotations__`。
- 它还会创建一个 `__wrapped__` 属性，直接指向未包装的原函数。这形成了一条调用链，使 `inspect.signature` 等工具能追溯到最底层的签名。

### 1.2 现代 Python (3.10+) 类型安全装饰器：`ParamSpec`
在 Python 3.10 之前，我们很难静态标注装饰器的类型，因为包装器往往会改变原函数的参数或返回值类型。
为了解决这一痛点，PEP 612 引入了 **`typing.ParamSpec`（参数规格）** 和 **`typing.Concatenate`（参数拼接）**，使得装饰器能完美继承原函数的签名。

```python
import time
from typing import Callable, TypeVar, ParamSpec

# 定义泛型参数
P = ParamSpec('P')
R = TypeVar('R')

def timer(func: Callable[P, R]) -> Callable[P, R]:
    """
    一个类型安全的性能测试装饰器。
    它确保被装饰函数的参数列表 P 和返回值 R 在静态检查期被完整保留。
    """
    import functools
    
    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        start_time = time.perf_counter()
        result = func(*args, **kwargs)
        end_time = time.perf_counter()
        print(f"[Timer] {func.__name__} 耗时: {end_time - start_time:.6f} 秒")
        return result
        
    return wrapper

# 静态类型检查器（如 mypy/Pyright）和 IDE 现在能够正确提示参数和返回值类型
@timer
def process_data(data_id: int, mode: str = "fast") -> str:
    time.sleep(0.1)
    return f"Processed {data_id} in {mode} mode"

# IDE 此时能够精准提示 data_id 必须为 int，返回值必须为 str
output = process_data(10086, mode="normal")
```

---

## 2. 动态代理包装与属性拦截

有时候，我们不希望只在函数调用前后增加逻辑，而是需要将返回的函数或对象包装进一个**代理对象（Proxy Object）**中，以拦截后续的属性访问（例如懒加载、细粒度权限控制或调用审计）。

### 2.1 动态属性审计代理
我们可以设计一个包装器，返回一个代理类，该代理类会利用魔术方法 `__getattr__` 和 `__setattr__` 动态监测所有的属性读写操作：

```python
import functools

class AuditProxy:
    def __init__(self, wrapped_obj):
        # 使用 self.__dict__ 直接赋值，避免触发 __setattr__ 引起无限递归
        self.__dict__['_wrapped_obj'] = wrapped_obj

    def __getattr__(self, name):
        # 拦截所有读取操作
        obj = self.__dict__['_wrapped_obj']
        attr = getattr(obj, name)
        
        # 如果是可调用对象（方法），对其也进行包裹
        if callable(attr):
            @functools.wraps(attr)
            def wrapper(*args, **kwargs):
                print(f"[Audit] 调用方法: {name} | 参数: {args}, {kwargs}")
                return attr(*args, **kwargs)
            return wrapper
        
        print(f"[Audit] 读取属性: {name}")
        return attr

    def __setattr__(self, name, value):
        # 拦截所有写入操作
        obj = self.__dict__['_wrapped_obj']
        print(f"[Audit] 修改属性: {name} 为 {value}")
        setattr(obj, name, value)

# 装饰器函数：将返回的对象包裹在代理中
def audited(cls):
    @functools.wraps(cls)
    def wrapper(*args, **kwargs):
        instance = cls(*args, **kwargs)
        return AuditProxy(instance)
    return wrapper

# 测试代理拦截
@audited
class BankAccount:
    def __init__(self, owner, balance):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount
        return self.balance

account = BankAccount("Alice", 1000)
# 1. 尝试修改属性
account.balance = 1200  # 输出: [Audit] 修改属性: balance 为 1200
# 2. 尝试调用方法
account.deposit(300)    # 输出: [Audit] 调用方法: deposit | 参数: (300,), {}
```

---

## 3. 类级装饰器与方法自动扫描包装

类装饰器不仅可以修饰函数，还可以直接放置在类定义之上：
```python
@class_decorator
class MyClass:
    pass
```
这时的类装饰器接收一个**类对象**作为参数，我们可以在内存中对其进行检查、修改，甚至替换其所有的方法。

### 3.1 兼容静态方法和类方法的扫描器
在自动包装类方法时，初学者常犯的一个错误是认为类 `__dict__` 中的所有内容都是普通的函数。然而，`staticmethod`、`classmethod` 以及 `property` 在类定义中是以**描述符**的形式存在的，不能像普通函数那样直接被包裹。

下面是一个健壮的类装饰器，它会自动对类中的所有公有实例方法、静态方法和类方法注入执行耗时统计：

```python
import functools
import inspect

def time_all_methods(cls):
    """
    类装饰器：自动对类中的所有公有方法（实例方法、静态方法、类方法）加上耗时统计。
    """
    for name, value in list(cls.__dict__.items()):
        # 排除私有/魔术方法
        if name.startswith('__'):
            continue
            
        # 情况 1：静态方法 (staticmethod)
        if isinstance(value, staticmethod):
            original_func = value.__func__
            print(f"[ClassDecorator] 发现静态方法: {name}")
            # 包装底层函数，重新构造 staticmethod 并写回
            setattr(cls, name, staticmethod(timer(original_func)))
            
        # 情况 2：类方法 (classmethod)
        elif isinstance(value, classmethod):
            original_func = value.__func__
            print(f"[ClassDecorator] 发现类方法: {name}")
            # 包装底层函数，重新构造 classmethod 并写回
            setattr(cls, name, classmethod(timer(original_func)))
            
        # 情况 3：普通实例方法 / 可调用属性
        elif callable(value):
            print(f"[ClassDecorator] 发现实例方法: {name}")
            setattr(cls, name, timer(value))
            
    return cls

# 演示使用的 timer 装饰器
def timer(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        res = func(*args, **kwargs)
        print(f"[Log] 执行 {func.__name__} 耗时: {time.perf_counter() - start:.6f}s")
        return res
    return wrapper

# 应用类装饰器
@time_all_methods
class ServiceAPI:
    def __init__(self, endpoint):
        self.endpoint = endpoint

    def fetch_data(self):
        # 模拟耗时网络操作
        time.sleep(0.05)
        return {"status": "ok"}

    @staticmethod
    def ping():
        time.sleep(0.02)
        return "pong"

    @classmethod
    def create_default(cls):
        return cls("https://api.default.com")

print("\n--- 开始测试类装饰器方法调用 ---")
api = ServiceAPI("https://api.custom.com")
api.fetch_data()
ServiceAPI.ping()
default_api = ServiceAPI.create_default()
```

#### 执行输出结果：
```text
[ClassDecorator] 发现实例方法: fetch_data
[ClassDecorator] 发现静态方法: ping
[ClassDecorator] 发现类方法: create_default

--- 开始测试类装饰器方法调用 ---
[Log] 执行 fetch_data 耗时: 0.051234s
[Log] 执行 ping 耗时: 0.020567s
[Log] 执行 create_default 耗时: 0.000002s
```

---

## 4. 总结

通过本书的学习，我们打通了 Python 装饰器的底层闭包与元编程设计：
1. **闭包**利用 CPython 的 Cell 机制将自由变量的生命周期与执行帧解耦，配合字节码的 `LOAD_DEREF` 指令，构成了装饰器的底层内存模型。
2. **类装饰器**是状态维护和逻辑复用的利器，但必须实现 `__get__` 描述符协议才能正确地绑定实例方法，解决 `self` 缺失的 Bug。
3. 在构建工业级库时，应随时关注**元数据的完备性**，合理利用 `functools.wraps` 保留调试信息，并借助现代 Python 的 `ParamSpec` 实现静态类型提示。
4. **类级装饰器与动态代理**能帮我们在更大的尺度上进行切面拦截，让应用架构具备极高灵活性。
