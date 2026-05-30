# 对象初始化与字符串表示

在 Python 的面向对象编程中，控制对象的生命周期（创建、初始化、销毁）与字符串表现形式，是构建健壮且易于调试的系统的核心。本章将深入解析这些底层的魔术方法。

---

## 1. 深度对比：`__new__` 与 `__init__`

许多开发者直觉地认为 `__init__` 是 Python 类的构造函数。实际上，`__new__` 才是真正的**构造方法**，而 `__init__` 是**初始化方法**。它们在调用时机、参数接收以及运行机制上有着根本的不同。

### 核心区别与工作机制

1. **`__new__`**：
   * **调用时机**：在类实例化时最先被调用，用于**创建并返回**一个类的新实例。
   * **方法类型**：它是一个静态方法（但在底层被特殊处理，不需要使用 `@staticmethod` 装饰），其第一个参数是类本身（通常命名为 `cls`）。
   * **返回值**：必须返回一个新创建的对象实例（通常通过调用 `super().__new__(cls)`）。如果它不返回该类的实例，Python 解释器将**不会**调用 `__init__`。
   
2. **`__init__`**：
   * **调用时机**：在 `__new__` 成功返回该类的实例后，由 Python 解释器自动调用。
   * **方法类型**：是一个实例方法，其第一个参数是刚刚创建的实例（通常命名为 `self`）。
   * **返回值**：不能返回任何内容（或者只能显式返回 `None`），否则会抛出 `TypeError`。

### 实例化流程图

以下是执行 `instance = MyClass(*args, **kwargs)` 时的完整调用时序图：

```mermaid
sequenceDiagram
    autonumber
    actor Caller as 调用者
    participant Class as MyClass (类)
    participant Instance as instance (实例)
    
    Caller->>Class: MyClass(*args, **kwargs)
    activate Class
    Class->>Class: 调用 __new__(cls, *args, **kwargs)
    Note over Class: 在堆上分配内存，创建空对象
    Class-->>Class: 返回新创建的实例 (instance)
    
    rect rgb(240, 248, 255)
        Note over Class: 检查 instance 是否是 MyClass 的实例?
        alt 是实例
            Class->>Instance: 调用 __init__(self, *args, **kwargs)
            activate Instance
            Note over Instance: 绑定属性，初始化状态
            Instance-->>Class: 返回 None
            deactivate Instance
        else 不是实例
            Note over Class: 略过 __init__ 调用
        end
    end
    
    Class-->>Caller: 返回 instance
    deactivate Class
```

### 生产级应用场景 1：实现线程安全的双重检查锁单例模式

通常我们不需要重写 `__new__`，但在设计模式中，比如**单例模式（Singleton）**或**元编程**中，`__new__` 是唯一拦截对象创建的入口。以下是一个生产级别的线程安全单例模式实现：

```python
import threading
from typing import Dict, Any

class ThreadSafeSingleton:
    """
    使用双重检查锁定 (Double-Checked Locking) 机制实现线程安全的单例基类。
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args: Any, **kwargs: Any) -> "ThreadSafeSingleton":
        # 第一次检查：若单例已存在，直接返回，避免不必要的加锁开销
        if cls._instance is None:
            with cls._lock:
                # 第二次检查：保证多线程并发下只创建一次实例
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

# 验证单例行为
class DatabaseConnectionPool(ThreadSafeSingleton):
    def __init__(self, dsn: str, max_connections: int = 10):
        # 注意：__init__ 仍然会被每次调用触发，因此需要在此处防止重复初始化
        if not hasattr(self, "_initialized"):
            self.dsn = dsn
            self.max_connections = max_connections
            self._initialized = True
            print(f"数据库连接池初始化成功，连接到: {self.dsn}")

# 测试代码
def worker():
    pool = DatabaseConnectionPool("mysql://root:pass@localhost/db")
    print(f"线程 {threading.current_thread().name} 获取的连接池实例 ID: {id(pool)}")

threads = [threading.Thread(target=worker) for _ in range(5)]
for t in threads:
    t.start()
for t in threads:
    t.join()
```

### 生产级应用场景 2：继承不可变类型（Immutable Types）

在 Python 中，不可变对象（如 `tuple`、`str`、`int` 等）的状态在创建后无法被修改。若我们希望通过子类化它们来定制行为，必须在 `__new__` 中拦截并修改参数，因为一旦执行到 `__init__`，实例的值已经固化。

下面的例子展示了如何创建一个始终保持大写字母的自定义字符串类 `UpperCaseStr`：

```python
class UpperCaseStr(str):
    """
    继承自内置不可变类 str，在创建对象时自动将内容转换为大写。
    """
    def __new__(cls, value: str) -> "UpperCaseStr":
        # 在创建对象前处理输入参数
        upper_value = value.upper()
        # 调用父类的 __new__ 传入修改后的参数来实例化
        return super().__new__(cls, upper_value)

# 验证行为
s = UpperCaseStr("hello world")
print(f"值: {s}")          # Output: HELLO WORLD
print(f"类型: {type(s)}")   # Output: <class '__main__.UpperCaseStr'>
```

---

## 2. 析构器与垃圾回收：`__del__` 的深坑与规避

在 Python 中，`__del__` 方法在对象即将被销毁（垃圾回收）时被触发，被称为**析构器**。由于 Python 采用引用计数与分代垃圾回收相结合的机制，`__del__` 的调用时机和可靠性存在诸多隐患。

### 为什么说 `__del__` 是不可靠的？

1. **垃圾回收时机不确定**：`__del__` 只有在对象的引用计数归零，或者垃圾回收器（GC）扫描到循环引用时才会触发。你无法预测它什么时候被执行，甚至可能在程序退出时才被调用。
2. **循环引用导致内存泄漏**：在 Python 3.4 之前（PEP 442 引入之前），如果循环引用的对象中定义了 `__del__` 方法，垃圾回收器将无法打破该循环，导致永久内存泄漏。即使在现代 Python 中，如果析构器内部代码复杂，依然极易引起死锁或资源残留。
3. **异常处理受限**：当 `__del__` 执行时发生异常，该异常不会向上传播，而是会被直接忽略并输出一行警告（到 `sys.stderr`），这使得排查错误异常困难。
4. **全局清理时的 Null 错误**：在解释器关闭时，全局变量或模块中的引用可能会先于对象被销毁，导致 `__del__` 执行时报 `AttributeError` 或 `NameError`。

### 生产环境规避方案

**绝对不要**使用 `__del__` 来释放关键的外部资源（如数据库连接、文件描述符、网络套接字等）。请始终优先使用**上下文管理器（Context Managers，详见第三章）**或者 `weakref` 弱引用库。

---

## 3. 对象字符串表现力：`__str__`、`__repr__` 与 `__format__`

Python 提供了多种将对象转化为字符串输出的魔术方法，每种方法在不同的应用场景下承担着不同的角色。

* **`__repr__` (Representation)**：
  面向**开发者**。输出格式应清晰、明确、无歧义，最好能够满足 `eval(repr(obj)) == obj` 的要求，用于调试（Debug）和日志记录（Logging）。
* **`__str__` (String)**：
  面向**用户**。输出格式友好、美观，侧重于可读性，通过 `print()` 或 `str(obj)` 隐式调用。
* **`__format__` (Format Specification)**：
  由 `format()` 函数或 f-string 触发，支持自定义的格式化语法。
* **`__bytes__` (Byte Representation)**：
  由 `bytes(obj)` 调用，用于将对象序列化为二进制字节流。

### 自定义格式化解析器的实现

下面我们将编写一个 `GeoCoordinate`（地理坐标）类，详细展示如何重写上述所有方法，并在 `__format__` 中实现自定义微语法解析（比如，支持度分秒、十进制等格式化输出）：

```python
import struct
from typing import Tuple

class GeoCoordinate:
    """
    地理坐标点，包含纬度和经度。
    支持自定义格式化说明符：
    - 'd': 十进制小数形式 (Decimal)，如 "39.9042°N, 116.4074°E"
    - 'dms': 度分秒形式 (Degree-Minute-Second)，如 "39°54'15"N, 116°24'26"E"
    """
    def __init__(self, latitude: float, longitude: float):
        self.latitude = latitude
        self.longitude = longitude

    def __repr__(self) -> str:
        # 满足 eval(repr(obj)) == obj，提供开发者友好的表达
        return f"{self.__class__.__name__}({self.latitude}, {self.longitude})"

    def __str__(self) -> str:
        # 用户友好的默认表达
        return f"({self.latitude:.4f}, {self.longitude:.4f})"

    def __bytes__(self) -> bytes:
        # 将经纬度打包为双精度浮点数的二进制字节流（8+8 = 16 字节）
        return struct.pack("dd", self.latitude, self.longitude)

    def _to_dms(self, decimal_deg: float, is_lat: bool) -> str:
        direction = ""
        if is_lat:
            direction = "N" if decimal_deg >= 0 else "S"
        else:
            direction = "E" if decimal_deg >= 0 else "W"
        
        abs_deg = abs(decimal_deg)
        degrees = int(abs_deg)
        minutes_float = (abs_deg - degrees) * 60
        minutes = int(minutes_float)
        seconds = round((minutes_float - minutes) * 60)
        
        return f"{degrees}°{minutes}'{seconds}\"{direction}"

    def __format__(self, format_spec: str) -> str:
        # 若未指定格式说明符，则默认退化为 str() 表达
        if not format_spec or format_spec == "":
            return str(self)
        
        if format_spec == "d":
            lat_dir = "N" if self.latitude >= 0 else "S"
            lon_dir = "E" if self.longitude >= 0 else "W"
            return f"{abs(self.latitude):.4f}°{lat_dir}, {abs(self.longitude):.4f}°{lon_dir}"
        
        elif format_spec == "dms":
            lat_dms = self._to_dms(self.latitude, is_lat=True)
            lon_dms = self._to_dms(self.longitude, is_lat=False)
            return f"{lat_dms}, {lon_dms}"
        
        else:
            # 格式符不支持时，按规范抛出 ValueError
            raise ValueError(f"Unknown format specifier '{format_spec}' for GeoCoordinate")

# 测试与运行
if __name__ == "__main__":
    beijing = GeoCoordinate(39.9042, 116.4074)
    
    # 1. 调试与日志输出
    print(f"REPR: {beijing!r}") # Output: GeoCoordinate(39.9042, 116.4074)
    
    # 2. 普通打印
    print(f"STR: {beijing}")    # Output: (39.9042, 116.4074)
    
    # 3. 自定义格式化输出
    print(f"十进制格式: {beijing:d}")     # Output: 39.9042°N, 116.4074°E
    print(f"度分秒格式: {beijing:dms}")   # Output: 39°54'15"N, 116°24'27"E
    
    # 4. 二进制序列化
    bin_data = bytes(beijing)
    print(f"BYTES (长度: {len(bin_data)}): {bin_data.hex()}")
    # 反序列化还原
    lat, lon = struct.unpack("dd", bin_data)
    print(f"还原数据: {lat}, {lon}")
