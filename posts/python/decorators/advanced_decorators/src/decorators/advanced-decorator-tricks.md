# 第三章：元数据丢失防范与签名检查高级技巧

在大型企业级 Python 项目中，装饰器的使用无处不在。然而，简单粗暴的包裹函数会破坏原函数的元数据（Metadata），导致 IDE 自动补全失效、类型检查报错以及运行时反射工具失灵。

本章将讨论如何完美保留原函数的元数据与静态类型签名，并介绍动态代理属性拦截与类级方法扫描改写的高级元编程设计。

---

## 1. 元数据丢失与完美保留机制

当一个目标函数被装饰器包裹后，它的变量名（如 `my_func`）在当前作用域内就被重新绑定到了内部包装函数（如 `wrapper`）上。这意味着它的 `__name__` 属性会变成 `"wrapper"`，文档字符串 `__doc__` 也会变成包装器的文档，这直接破坏了基于反射的分析工具和调试栈的可读性。

### 1.1 `functools.wraps` 的底层复制路径

Python 标准库提供了 `functools.wraps` 装饰器（基于 `functools.update_wrapper` 函数）来解决这一问题。它会在底层将原函数的关键属性逐一复制到包装器函数上。

在 CPython 标准库中，这一复制过程定义为：
* **`WRAPPER_ASSIGNMENTS`（直接覆盖的属性元组）**：
  `('__module__', '__name__', '__qualname__', '__doc__', '__annotations__')`
* **`WRAPPER_UPDATES`（字典增量更新）**：
  `('__dict__',)`

此外，`update_wrapper` 还会自动为包装器注入一个名为 **`__wrapped__`** 的特殊属性，指向未包装的原函数。这形成了一条可追溯的**包装链**。当外部工具（如 `inspect.signature`）试图获取函数签名时，它会沿着这根链条向上追溯，直到找到最底层的真实函数签名。

#### 元数据拷贝与 `__wrapped__` 追溯路径图：

```text
+---------------------------------------------------+
| 原始目标函数 (func)                                 |
|  - __name__: "process_payment"                    |
|  - __doc__: "处理一笔订单支付"                      |
|  - __dict__: {'timeout': 30}                      |
+---------------------------------------------------+
                          │
                          │ 被 functools.wraps(func) 复制属性
                          ▼
+---------------------------------------------------+
| 包装器函数 (wrapper)                                |
|  - __name__: "process_payment" (拷贝自原函数)        |
|  - __doc__: "处理一笔订单支付" (拷贝自原函数)        |
|  - __dict__: {'timeout': 30}   (增量更新)           |
|                                                   |
|  - __wrapped__ ───────────────► 指向 func          |
+---------------------------------------------------+
        ▲
        │ 外部 inspect.signature(wrapper) 调用
        │ 沿着 __wrapped__ 链条向前追溯
        └────────────────────────────────────────────
```

### 1.2 现代 Python (3.10+) 类型安全装饰器：`ParamSpec`

在 Python 3.10 之前，对于接受任意参数并返回任意类型的装饰器，我们只能粗糙地标注为 `Callable[..., Any]`。这导致类型检查器（如 MyPy 或 Pyright）无法推导被装饰后函数的精确形参类型，从而在 IDE 中失去了强大的自动补全和静态错误警示。

为了解决这一痛点，**PEP 612** 引入了 **`typing.ParamSpec`（参数规格）** 和 **`typing.Concatenate`（参数拼接）**。

#### 1.2.1 标准类型安全模板
下面是一个完美保留入参和返回值类型提示的装饰器实现：

```python
import time
import functools
from typing import Callable, TypeVar, ParamSpec, Any

# 声明泛型变量
P = ParamSpec('P')  # 代表原函数的形参规格 (参数类型及顺序)
R = TypeVar('R')    # 代表原函数的返回值类型

def performance_telemetry(func: Callable[P, R]) -> Callable[P, R]:
    """
    类型安全的高性能遥测装饰器。
    它确保被装饰后的函数签名与原函数 P, R 保持绝对一致。
    """
    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        start_time = time.perf_counter()
        try:
            result = func(*args, **kwargs)
            return result
        finally:
            duration = time.perf_counter() - start_time
            print(f"[Telemetry] 执行 {func.__name__} 共耗时 {duration:.6f} 秒")
    return wrapper

# 演示使用
@performance_telemetry
def query_database(query_str: str, limit: int = 100) -> list[dict[str, Any]]:
    """模拟数据库查询操作"""
    time.sleep(0.05)
    return [{"id": 1, "data": "row1"}]

# IDE 会精准补全：query_str 必须为 str，limit 必须为 int，返回值会被正确推导为 list[dict[str, Any]]
records = query_database("SELECT * FROM users", limit=50)
```

#### 1.2.2 使用 `Concatenate` 动态注入参数
如果你的装饰器会截断或向原函数头部注入一个新的参数（常见于中间件或依赖注入），可以使用 `Concatenate` 进行精准类型描述：

```python
from typing import Concatenate
import sqlite3

# P 表示除注入参数外的其他形参规格
P = ParamSpec('P')
R = TypeVar('R')

def inject_db_connection(func: Callable[Concatenate[sqlite3.Connection, P], R]) -> Callable[P, R]:
    """
    自动注入 sqlite3.Connection 对象作为原函数第一个位置参数的装饰器。
    """
    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        # 打开数据库连接
        conn = sqlite3.connect(":memory:")
        try:
            # 将 conn 作为第一个参数注入
            return func(conn, *args, **kwargs)
        finally:
            conn.close()
    return wrapper

# 使用示例
@inject_db_connection
def get_user_name(conn: sqlite3.Connection, user_id: int) -> str:
    # 业务调用时不需要传入 conn，只需传入 user_id
    cursor = conn.cursor()
    cursor.execute("SELECT 'Alice'")
    return cursor.fetchone()[0]

# 调用时只需传入 user_id: int，IDE 不会报“缺失参数 conn”的警告
username = get_user_name(42)
print(f"查询到的用户名为: {username}")
```

---

## 2. 基于魔法方法的动态代理与拦截包装

在一些高阶开发场景中，我们不只是想在函数被调用的瞬间增加逻辑，而是需要将返回的函数或对象包装进一个**代理对象（Proxy Object）**中，从而在任意时间点拦截针对该对象的属性读写或方法调用。

### 2.1 动态属性审计代理

下面的代理类在初始化时通过修改 `__dict__` 巧妙地规避了无限递归问题，实现了对宿主对象所有属性访问与方法调用的透明拦截：

```python
import functools
from typing import Any

class AuditProxy:
    def __init__(self, wrapped_obj: Any):
        # 核心防坑点：必须通过 __dict__ 直接赋值以绕过自定义的 __setattr__ 拦截，
        # 否则会陷入无限循环递归调用，导致栈溢出。
        self.__dict__['_wrapped_obj'] = wrapped_obj

    def __getattr__(self, name: str) -> Any:
        # 拦截所有外部属性或方法的读取操作
        target = self.__dict__['_wrapped_obj']
        attribute = getattr(target, name)
        
        # 如果读取的属性是可调用对象（例如实例的方法）
        if callable(attribute):
            @functools.wraps(attribute)
            def method_wrapper(*args: Any, **kwargs: Any) -> Any:
                print(f"[Audit Log] 正在调用方法: {name} | 参数: args={args}, kwargs={kwargs}")
                res = attribute(*args, **kwargs)
                print(f"[Audit Log] 方法 {name} 执行完毕。")
                return res
            return method_wrapper
        
        print(f"[Audit Log] 正在读取非方法属性: {name} = {attribute}")
        return attribute

    def __setattr__(self, name: str, value: Any) -> None:
        # 拦截所有外部写入操作
        target = self.__dict__['_wrapped_obj']
        print(f"[Audit Log] 正在修改属性: {name} | 原值: {getattr(target, name, None)} --> 新值: {value}")
        setattr(target, name, value)

def audited(cls: type) -> type:
    """
    类装饰器：在实例化时返回一个 AuditProxy 代理对象
    """
    @functools.wraps(cls)
    def instance_wrapper(*args: Any, **kwargs: Any) -> Any:
        instance = cls(*args, **kwargs)
        return AuditProxy(instance)
    return instance_wrapper

# 使用审计代理装饰类
@audited
class SecureWallet:
    def __init__(self, owner: str, balance: float):
        self.owner = owner
        self.balance = balance

    def transfer(self, target: str, amount: float) -> bool:
        if self.balance >= amount:
            self.balance -= amount
            return True
        return False

# 测试代理拦截
wallet = SecureWallet("Bob", 5000.0)

# 1. 尝试修改属性，触发 __setattr__
wallet.balance = 6000.0

# 2. 尝试读取属性，触发 __getattr__
current_owner = wallet.owner

# 3. 尝试调用方法，触发 __getattr__ 返回的 method_wrapper
wallet.transfer("Alice", 1500.0)
```

---

## 3. 类级全局扫描与修饰器重构

有时，我们不希望逐个对类的方法添加装饰器，而是希望对整个类施加影响。例如：对所有的方法注入日志、将所有方法注册到 API 路由表、或者自动将所有同步方法重构为异步方法等。这可以通过**类级装饰器（Class-level Decorators）**实现。

### 3.1 兼容 `staticmethod`、`classmethod` 与 `property` 的高级扫描引擎

类级扫描装饰器接收一个**类对象**，通过扫描类名称空间（`cls.__dict__`），我们能定位其拥有的所有描述符和方法。
但要注意：**静态方法、类方法和属性（Property）在类 `__dict__` 中并不以普通函数的形式存在**。如果我们不加区分地对它们直接使用普通包装函数，会彻底破坏其内部原有的绑定机制。

以下是兼容这些复杂描述符的工业级全局扫描引擎：

```python
import functools
import time
from typing import Callable, Any

def audit_all_methods(cls: type) -> type:
    """
    类级装饰器：扫描并对类的所有公有方法（实例方法、静态方法、类方法）自动注入耗时审计。
    """
    # 必须将其转为 list 以避免在循环中修改字典时报错 RuntimeError: dictionary changed size during iteration
    for name, value in list(cls.__dict__.items()):
        # 排除私有及魔术方法
        if name.startswith("__"):
            continue

        # 1. 如果是静态方法 (staticmethod)
        if isinstance(value, staticmethod):
            original_func = value.__func__
            print(f"[Scanner] 发现静态方法: {name}")
            # 包装其底层的裸函数，并重新构造为 staticmethod 写回类中
            setattr(cls, name, staticmethod(time_logger(original_func)))

        # 2. 如果是类方法 (classmethod)
        elif isinstance(value, classmethod):
            original_func = value.__func__
            print(f"[Scanner] 发现类方法: {name}")
            # 包装其底层的裸函数，并重新构造为 classmethod 写回类中
            setattr(cls, name, classmethod(time_logger(original_func)))

        # 3. 如果是属性 (property)
        elif isinstance(value, property):
            # 属性包含 fget, fset, fdel，需要分别对其包装后重新构造 property
            print(f"[Scanner] 发现属性 (Property): {name}")
            new_fget = time_logger(value.fget) if value.fget else None
            new_fset = time_logger(value.fset) if value.fset else None
            new_fdel = time_logger(value.fdel) if value.fdel else None
            setattr(cls, name, property(new_fget, new_fset, new_fdel))

        # 4. 如果是普通的公有可调用对象 (即普通的实例方法)
        elif callable(value):
            print(f"[Scanner] 发现实例方法: {name}")
            setattr(cls, name, time_logger(value))

    return cls

# 辅助包装函数
def time_logger(func: Callable[..., Any]) -> Callable[..., Any]:
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            elapsed = time.perf_counter() - start
            print(f"[Scan Log] 方法 {func.__name__} 执行耗时: {elapsed:.6f}s")
    return wrapper

# 应用类级装饰器
@audit_all_methods
class MicroService:
    def __init__(self, service_name: str):
        self._name = service_name

    def query_status(self) -> str:
        # 普通实例方法
        time.sleep(0.02)
        return "Online"

    @property
    def service_name(self) -> str:
        # Property
        return self._name

    @staticmethod
    def ping() -> str:
        # 静态方法
        time.sleep(0.01)
        return "pong"

    @classmethod
    def create_sandbox(cls) -> "MicroService":
        # 类方法
        return cls("Sandbox-Env")

# 验证调用
service = MicroService("Production-Gateway")
service.query_status()
_ = service.service_name
MicroService.ping()
sandbox = MicroService.create_sandbox()
```

---

## 4. 本章小结

通过第一部分对闭包的字节码剖析，以及第二部分对类装饰器、描述符协议、类型规格和属性代理的层层递进，我们打通了 Python 元编程的最核心通道：

1. **元信息保留**：不要忘记在所有的装饰器（无论是函数还是类装饰器）中添加 `functools.wraps`，并利用现代 `typing.ParamSpec` 保护静态类型边界。
2. **方法绑定修复**：如果设计无参类装饰器，必须重写其非数据描述符方法 `__get__`，确保被修饰的实例方法能通过 `types.MethodType` 进行运行时 `self` 绑定。
3. **安全并发状态**：有状态装饰器需要利用 `threading.Lock` 或是 `threading.local` 处理线程间竞态条件与多线程状态隔离问题。
4. **动态切面**：通过 `__getattr__` 属性代理和类级修饰扫描，我们可以构建出强大的非侵入式企业级切面服务（AOP）。
