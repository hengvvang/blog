# 第一章：对象构建 (__new__)、初始化 (__init__) 与序列化机制

在 Python 面向对象编程的世界中，控制对象的生命周期（从内存分配、属性注入、资源管理，直到最终被垃圾回收）是编写高性能、健壮软件的必修课。本章将深入 CPython 解释器的底层行为，探讨对象的生命周期管理与多维度序列化。

---

## 1. 深度剖析：`__new__` 与 `__init__` 的分工与协作

很多初学者容易将 `__init__` 误认为 C++/Java 意义上的“构造函数”。实际上，在 Python 中，实例的构建过程被严格分工为两个步骤：**构建（Allocation & Instantiation）** 和 **初始化（Initialization）**。

### 1.1 核心差异对比

下面的表格梳理了 `__new__` 与 `__init__` 在语义、职责与底层机制上的核心差异：

| 维度 | `__new__(cls, *args, **kwargs)` | `__init__(self, *args, **kwargs)` |
| :--- | :--- | :--- |
| **角色** | 构造器（Constructor） | 初始化器（Initializer） |
| **方法类型** | 类级别静态方法（隐式，无需 `@staticmethod`） | 实例级别方法 |
| **主要职责** | 负责在堆上**分配内存**，创建并返回新对象实例 | 负责为已创建的对象**绑定属性**、建立初始状态 |
| **参数接收** | 第一个参数为类本身 `cls` | 第一个参数为实例对象 `self` |
| **返回值** | 必须返回一个对象实例（通常为 `cls` 实例） | 只能返回 `None`（显式返回其他值会抛出 `TypeError`） |
| **定制契机** | 用于单例模式、元编程、修改不可变基类（如 `str`） | 用于大多数常规类的属性初始化逻辑 |

### 1.2 实例化流程图与 CPython 底层逻辑

当我们在 Python 中执行 `obj = MyClass(x, y=2)` 时，解释器内部的行为流向如下：

```
                    调用 MyClass(x, y=2)
                            │
                            ▼
              ┌───────────────────────────┐
              │  调用 MyClass.__new__(cls) │
              └─────────────┬─────────────┘
                            │
                            ▼
                [是否成功分配并返回新实例?]
                 ├── 否 (返回了其他类型的对象或 None) ──┐
                 │                                      │
                 └── 是 (返回了 cls 类型的实例 instance)  │
                            │                           │
                            ▼                           │
              ┌───────────────────────────┐             │
              │调用 instance.__init__(self)│             │
              └─────────────┬─────────────┘             │
                            │                           │
                            ▼                           ▼
                     [返回最终对象 obj] ◄────────────────┘
```

#### 动态类分配工作流（Dynamic Class Allocation Workflow）

```
CPython Runtime (C Level)
  └─► PyObject_Call()
        └─► tp_new (对应 MyClass.__new__)
              ├─► PyType_GenericNew() ──► 堆上分配内存 (PyObject 结构体初始化)
              └─► 返回分配的对象指针
        └─► 检查返回的指针类型是否与当前类匹配
              └─► 匹配 ──► tp_init (对应 MyClass.__init__)
                            └─► 执行绑定操作 (写入 __dict__)
```

> [!IMPORTANT]
> 如果 `__new__` 故意返回了**另一个类**的实例，或者返回了 `None`，Python 解释器在 `PyObject_Call` 层面会检测到该对象并不是 `cls` 的实例，从而**直接跳过 `__init__` 方法的执行**，并直接返回该对象。

---

## 2. 生产级实战：`__new__` 的高级应用

### 2.1 线程安全的双重检查锁单例模式

在编写数据库连接池、日志管理器等共享资源管理器时，单例模式（Singleton）是常见的设计选择。在多线程环境中，必须保证并发安全。

```python
import threading
from typing import Dict, Any, Optional

class ThreadSafeSingleton:
    """
    使用双重检查锁定 (Double-Checked Locking) 机制实现线程安全的单例基类。
    """
    _instance: Optional["ThreadSafeSingleton"] = None
    _lock = threading.Lock()

    def __new__(cls, *args: Any, **kwargs: Any) -> "ThreadSafeSingleton":
        # 第一次检查：若单例已存在，直接返回，避免高并发下频繁竞争锁带来的性能衰退
        if cls._instance is None:
            with cls._lock:
                # 第二次检查：保证多线程在竞争到锁之后，依然只创建一次实例
                if cls._instance is None:
                    # 委派给父类 object.__new__ 在堆上真正分配内存
                    cls._instance = super().__new__(cls)
        return cls._instance

# 业务应用类
class DatabaseConnectionPool(ThreadSafeSingleton):
    def __init__(self, dsn: str, max_connections: int = 10):
        # 警告：由于单例模式下每次调用 DatabaseConnectionPool() 都会触发 __new__ 并紧接着触发 __init__，
        # 我们必须通过状态标志（_initialized）来防止已有单例被重复覆盖初始化。
        if not hasattr(self, "_initialized"):
            self.dsn = dsn
            self.max_connections = max_connections
            self._initialized = True
            print(f"[Init] 数据库连接池初始化成功 -> DSN: {self.dsn}, Max Connections: {self.max_connections}")
        else:
            print(f"[Skip] 实例已存在，跳过初始化逻辑")

# 多线程并发验证
def test_concurrent_singleton():
    def get_pool_instance(thread_id: int):
        # 即使入参不同，由于单例控制，也只有第一次初始化的值生效
        pool = DatabaseConnectionPool(f"mysql://user:pass@host/db_{thread_id}")
        print(f"线程-{thread_id} 获取的对象内存地址: {id(pool)}")

    threads = [threading.Thread(target=get_pool_instance, args=(i,)) for i in range(3)]
    for t in threads: t.start()
    for t in threads: t.join()

if __name__ == "__main__":
    test_concurrent_singleton()
```

### 2.2 继承不可变类型（Immutable Types Customization）

在 Python 中，诸如 `str`、`tuple`、`int` 等类型是不可变的（Immutable）。当我们需要定制其行为时，在 `__init__` 中进行修改是无效的（因为实例的二进制值已固化并在 C 层面创建）。必须在 `__new__` 中修改入参。

例如，设计一个网络通信中使用的自定义字符串类 `UpperCaseStr`，使其在实例化时自动转换为全大写：

```python
class UpperCaseStr(str):
    """
    继承自内置 str 类型。在底层内存分配前修改其字符内容。
    """
    def __new__(cls, value: str) -> "UpperCaseStr":
        # 在调用父类 __new__ 分配内存之前，对参数进行转换
        processed_value = value.upper()
        # 必须传入处理后的值给内置 str 的构建方法
        return super().__new__(cls, processed_value)

# 验证
clean_str = UpperCaseStr("cpython internals")
print(f"转换值: {clean_str}")  # CPYTHON INTERNALS
print(f"类型: {type(clean_str)}")  # <class '__main__.UpperCaseStr'>
```

---

## 3. 析构器与垃圾回收：`__del__` 的隐患与规避

在 Python 中，`__del__` 方法在对象生命周期结束、即将被垃圾回收时被触发，类似于 C++ 中的析构函数。然而，在 Python 中**极其不推荐**使用 `__del__` 来释放核心外部资源。

### 3.1 为什么说 `__del__` 存在严重隐患？

1. **执行时机的不确定性（Nondeterministic Destruction）**：
   Python 采用**引用计数（Reference Counting）**为主、**分代垃圾回收（Generational Garbage Collection）**为辅的机制。即使你在代码中执行了 `del obj`，只要外部还存在对该对象的任何引用（例如，被异常的栈帧捕获、存放在局部列表或全局闭包中），对象的引用计数就不会归零，`__del__` 也不会执行。
2. **异常丢失（Ignored Exceptions）**：
   在 `__del__` 执行期间如果抛出异常，Python 解释器不会让其向上传播（因为此时已经没有合适的调用栈去接收它），而是直接将其吞掉，并在 `sys.stderr` 打印一条类似 `Exception ignored in: ...` 的警告。
3. **全局解释器退出时的“半死不活”状态（Null-pointer during shutdown）**：
   在 Python 解释器退出（Shutdown）时，模块中的全局变量会被陆续设置为 `None`。如果 `__del__` 在此期间触发，且方法内依赖了某些全局模块（例如 `sys` 或 `os`），将会抛出 `NameError` 或 `AttributeError`，使得资源回收彻底失效。
4. **对象“复活”（Resurrection）**：
   在 `__del__` 内部，如果将 `self` 赋值给了某个全局变量，该对象会重新增加引用计数，在垃圾回收器的边缘“死而复生”。这种设计极易引入难以察觉的内存泄露。

### 3.2 替代方案：`weakref.finalize` 进行安全销毁

为了解决 `__del__` 的上述缺陷，Python 提供了 `weakref.finalize`。它允许为对象注册一个销毁回调函数，在对象被回收时自动执行，同时避免了直接重写 `__del__` 带来的各种副作用。

```python
import weakref
import os

class SafeFileClient:
    """
    使用 weakref.finalize 安全回收操作系统资源，避免使用 __del__。
    """
    def __init__(self, filename: str):
        self.filename = filename
        # 模拟打开系统文件描述符
        self._fd = os.open(filename, os.O_CREAT | os.O_WRONLY)
        print(f"[Resource] 已打开文件描述符: {self._fd}")

        # 注册 finalize 清理器
        # 注意：清理回调函数（clean_up）决不能绑定 self 实例本身，否则会造成循环引用阻止回收！
        # 必须仅传递清理资源所需的最小上下文信息（如 fd）
        self._finalizer = weakref.finalize(self, self.clean_up, self._fd, self.filename)

    @staticmethod
    def clean_up(fd: int, filename: str):
        """
        静态清理函数，仅操作必要参数，确保不引用宿主对象本身。
        """
        try:
            os.close(fd)
            print(f"[Cleanup] 成功关闭文件描述符: {fd} (文件: {filename})")
        except OSError:
            pass

    def write_data(self, data: str):
        os.write(self._fd, data.encode("utf-8"))

# 测试安全销毁
def run_file_operation():
    client = SafeFileClient("temp_log.txt")
    client.write_data("Python Data Model")
    # 离开局部作用域后，client 自动被 GC，触发静态清理器

run_file_operation()
```

---

## 4. 对象字符串表示：`__str__`、`__repr__` 与 `__format__`

Python 提供了多种将对象转化为字符串输出的魔术方法，在不同的应用场景下分工明确：

* **`__repr__(self)`**：面向**开发者**。目的是提供无歧义的、精准的字符串表达形式，通常应该满足 `eval(repr(obj)) == obj`。在控制台直接输入变量、使用 `repr(obj)` 或格式化占位符 `!r` 时触发。
* **`__str__(self)`**：面向**用户**。提供友好且易读的文字表述。通过 `print(obj)`、`str(obj)` 或 f-string（没有 `!r` 修饰）时隐式调用。
* **`__format__(self, format_spec)`**：当使用 f-string 或内置的 `format()` 传入特定的格式化规约说明符（Format Specifier）时触发，支持高自由度的自定义微语法解析。
* **`__bytes__(self)`**：在调用 `bytes(obj)` 时触发，返回对应的二进制字节流，常用于紧凑的网络封包与文件序列化。

### 4.1 自定义格式化微语法解析器

下面的 `GeoCoordinate` 物理地理坐标类展示了如何全面实现这些表示机制，包括在 `__format__` 中手写一个微型的格式语法解析器：

```python
import struct
import re
from typing import Tuple

class GeoCoordinate:
    """
    三维/二维地理坐标。
    支持的自定义格式说明符 (format_spec)：
    - 'd': 纯十进制带方向形式，例如 "39.9042N, 116.4074E"
    - 'dms': 度分秒形式 (Degree-Minute-Second)，例如 "39°54'15"N, 116°24'26"E"
    - 支持精度修饰（如 '.2dms' 或 '.6d'）控制秒/小数部分的保留位数。
    """
    def __init__(self, latitude: float, longitude: float):
        # 限制范围
        if not (-90.0 <= latitude <= 90.0):
            raise ValueError("纬度必须在 [-90.0, 90.0] 之间")
        if not (-180.0 <= longitude <= 180.0):
            raise ValueError("经度必须在 [-180.0, 180.0] 之间")
        self.latitude = latitude
        self.longitude = longitude

    def __repr__(self) -> str:
        # 提供代码级别的完整无歧义表示，便于 debug
        return f"{self.__class__.__name__}({self.latitude}, {self.longitude})"

    def __str__(self) -> str:
        # 用户视角下的默认展示
        return f"({self.latitude:.4f}, {self.longitude:.4f})"

    def __bytes__(self) -> bytes:
        # 将经纬度打包为双精度浮点数二进制流 (8 + 8 = 16 字节，大端序)
        return struct.pack(">dd", self.latitude, self.longitude)

    def _to_dms(self, val: float, is_lat: bool, precision: int = 0) -> str:
        direction = ("N" if val >= 0 else "S") if is_lat else ("E" if val >= 0 else "W")
        val = abs(val)
        degrees = int(val)
        minutes_float = (val - degrees) * 60
        minutes = int(minutes_float)
        seconds = (minutes_float - minutes) * 60
        
        # 格式化秒的精度
        sec_fmt = f"{seconds:.{precision}f}"
        return f"{degrees}°{minutes}'{sec_fmt}\"{direction}"

    def __format__(self, format_spec: str) -> str:
        # 默认回退逻辑
        if not format_spec:
            return str(self)

        # 使用正则解析修饰符：可选的 "." + 精度数字 (\d+) + 类型代码 ('dms' 或 'd')
        match = re.match(r"^(?:\.(\d+))?(dms|d)$", format_spec)
        if not match:
            raise ValueError(f"无效的 GeoCoordinate 格式说明符: '{format_spec}'")

        precision_str, spec_type = match.groups()
        # 若未提供精度，dms 默认为 0，d 默认为 4
        precision = int(precision_str) if precision_str is not None else (0 if spec_type == "dms" else 4)

        if spec_type == "d":
            lat_dir = "N" if self.latitude >= 0 else "S"
            lon_dir = "E" if self.longitude >= 0 else "W"
            return (f"{abs(self.latitude):.{precision}f}°{lat_dir}, "
                    f"{abs(self.longitude):.{precision}f}°{lon_dir}")
        
        elif spec_type == "dms":
            lat_dms = self._to_dms(self.latitude, is_lat=True, precision=precision)
            lon_dms = self._to_dms(self.longitude, is_lat=False, precision=precision)
            return f"{lat_dms}, {lon_dms}"

        return str(self)

# 验证测试
if __name__ == "__main__":
    loc = GeoCoordinate(39.904212, 116.407395)

    # 1. 打印 __str__ 和 __repr__
    print(f"默认打印 (str): {loc}")
    print(f"开发者打印 (repr): {loc!r}")
    print(f"强行指定 repr 占位符 (f-string): {loc!r}")

    # 2. 格式化控制
    print(f"十进制展示 (默认4位): {loc:d}")
    print(f"十进制展示 (保留6位): {loc:.6d}")
    print(f"度分秒展示 (默认整数秒): {loc:dms}")
    print(f"度分秒展示 (秒保留2位): {loc:.2dms}")

    # 3. 字节序列化与反序列化
    serialized = bytes(loc)
    print(f"序列化字节 (Hex): {serialized.hex()}")
    unpacked_lat, unpacked_lon = struct.unpack(">dd", serialized)
    restored_loc = GeoCoordinate(unpacked_lat, unpacked_lon)
    print(f"反序列化还原: {restored_loc!r}")
