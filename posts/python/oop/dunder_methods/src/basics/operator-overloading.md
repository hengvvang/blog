# 第二章：算术与比较运算符重载实现

Python 的协议式设计（Protocol-oriented Design）赋予了自定义对象接入原生语法的能力。通过重载相应的魔术方法，我们可以决定对象在遇到 `+`、`*`、`==`、`<` 甚至索引、切片、循环遍历和直接函数调用时的底层反应。

---

## 1. 比较运算符与全关系序排列

Python 废弃了早期版本中的全局通用比较 `__cmp__`，取而代之的是“富比较（Rich Comparisons）”协议，使得我们可以精确控制每一种关系运算的逻辑。

### 1.1 富比较魔术方法与反射查找路由

富比较魔术方法包括：
* `__lt__(self, other)`: 小于 (`<`)
* `__le__(self, other)`: 小于等于 (`<=`)
* `__eq__(self, other)`: 等于 (`==`)
* `__ne__(self, other)`: 不等于 (`!=`)
* `__gt__(self, other)`: 大于 (`>`)
* `__ge__(self, other)`: 大于等于 (`>=`)

#### 比较运算符反射路由图（Comparison Fallback Routing）

当 Python 执行 `a < b` 时，其背后的双向查找策略如下：

```
                发起表达式 a < b
                       │
                       ▼
              [a 是否实现 __lt__?]
               ├── 是 ──► 调用 a.__lt__(b)
               │            │
               │            ▼
               │      [返回值是否为 NotImplemented?]
               │       ├── 否 ──► 返回该结果 (True / False)
               │       └── 是 ─┐
               │               │
               └── 否 ─────────┼─► [b 是否实现 __gt__?]
                                     ├── 是 ──► 调用 b.__gt__(a)
                                     │            │
                                     │            ▼
                                     │      [返回值是否为 NotImplemented?]
                                     │       ├── 否 ──► 返回该结果 (True / False)
                                     │       └── 是 ──┐
                                     └── 否 ──────────┼─► 抛出 TypeError
```

> [!CAUTION]
> **绝对不可混淆 `NotImplemented` 与 `NotImplementedError`**：
> * **`NotImplemented`**：是一个**单例值（Value）**。在二元运算符重载中返回它，意味着“我无法处理这个类型的右操作数，请尝试调用右操作数的反射方法”。这是协调多态运算的核心机制。
> * **`NotImplementedError`**：是一个**异常类（Exception）**。通常在接口类/抽象基类的未实现方法中抛出，表示此方法必须被子类重写。如果在运算符中抛出此异常，将导致整个调用栈崩溃，而无法触发右操作数的反射查找。

### 1.2 全关系序自动生成：`@functools.total_ordering`

手动写完六个比较方法既繁琐又容易出错。`functools.total_ordering` 装饰器能够为类自动补全所有比较逻辑：
* **要求**：必须在类中重写 `__eq__`，并且重写 `__lt__`、`__le__`、`__gt__`、`__ge__` 中的**任意一个**。
* **代价**：由于未实现的运算符是通过已实现的运算符间接推导的（例如，通过 `not (self < other) and not (self == other)` 来推导 `self > other`），会在运行时多引入一层或多层函数调用。在性能敏感的高频运算（如大规模快速排序）中，显式手写所有六个魔术方法是获取最佳速度的推荐做法。

---

## 2. 算术运算符的深层机制：右向与就地重载

算术运算符的调用逻辑更为丰富，涉及：常规运算符（如 `+`）、右向反射运算符（如 `__radd__`）以及就地增量运算符（如 `+=`）。

### 2.1 运算符派发优先级与调用流程

#### 算术优先级派发图（Operator Dispatching Route）

当执行 `a + b` 时，解释器的路由流向如下：

```
                              执行 a + b
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
        [a 与 b 是否为继承关系?]           [a 与 b 无继承关系]
        (且 b 是 a 的子类)                        │
                  │                               ▼
                  │                      [a 是否实现 __add__?]
                  │                       ├── 是 ──► 调用 a.__add__(b)
                  │                       │            │
                  │                       │            ▼
                  │                       │      [返回 NotImplemented?]
                  │                       │       ├── 否 ──► 结束并返回值
                  │                       │       └── 是 ──┐
                  │                       └── 否 ──────────┼──┐
                  ▼                                        │  │
        [b 是否实现 __radd__?]                             │  │
         ├── 是 ──► 先调用 b.__radd__(a)                    │  │
         │            │                                    │  │
         │            ▼                                    │  │
         │      [返回 NotImplemented?]                     │  │
         │       ├── 否 ──► 结束并返回值                   │  │
         │       └── 是 ──► 尝试调用 a.__add__(b) ◄────────┘  │
         └── 否 ──────────► 尝试调用 a.__add__(b)              │
                                  │                            │
                                  ▼                            ▼
                         [尝试调用 b.__radd__(a)] ◄────────────┘
                                  │
                                  ▼
                         [是否都返回 NotImplemented?]
                                  ├── 是 ──► 抛出 TypeError
                                  └── 否 ──► 结束并返回值
```

### 2.2 就地运算符（In-place）的设计哲学

就地运算符（如 `+=`, `*=`）的覆写需要根据对象的可变性（Mutability）采取截然不同的策略：
* **不可变对象（如自定义数值复数、不可变向量）**：
  **不应实现** `__iadd__` 等就地方法。当用户执行 `a += b` 时，Python 会自动回退调用 `a = a + add(b)`。这样会产生并返回一个新对象，符合不可变语义。
* **可变对象（如矩阵、高维数组、可变序列）**：
  **必须实现** `__iadd__`。直接修改 `self` 内部的状态（原地修改，避免高频分配与垃圾回收开销），并且方法内**必须 `return self`**。

### 2.3 生产级三维向量类 `Vector3D` 完整实现

下面的代码展示了包含常规、右向反射、就地和数值乘除在内的严谨数学向量实现：

```python
from typing import Union, Tuple, Any

class Vector3D:
    """
    三维向量类，包含常规算术、右向算术、就地算术和富比较。
    """
    __slots__ = ("_x", "_y", "_z")  # 优化内存分配，避免 __dict__ 开销

    def __init__(self, x: float, y: float, z: float):
        self._x = float(x)
        self._y = float(y)
        self._z = float(z)

    @property
    def coordinates(self) -> Tuple[float, float, float]:
        return (self._x, self._y, self._z)

    def __repr__(self) -> str:
        return f"Vector3D({self._x}, {self._y}, {self._z})"

    # --- 1. 富比较重载 ---
    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, Vector3D):
            return NotImplemented
        return self._x == other._x and self._y == other._y and self._z == other._z

    # --- 2. 常规加法与反射加法 ---
    def __add__(self, other: Any) -> "Vector3D":
        if not isinstance(other, Vector3D):
            # 返回 NotImplemented，告知解释器尝试调用右侧的 __radd__
            return NotImplemented
        return Vector3D(self._x + other._x, self._y + other._y, self._z + other._z)

    def __radd__(self, other: Any) -> "Vector3D":
        # 加法满足交换律，直接复用 __add__
        return self.__add__(other)

    # --- 3. 乘法（支持向量点积与标量数乘） ---
    def __mul__(self, other: Union[int, float, "Vector3D"]) -> Union["Vector3D", float]:
        if isinstance(other, (int, float)):
            # 标量数乘：Vector3D * scalar
            return Vector3D(self._x * other, self._y * other, self._z * other)
        elif isinstance(other, Vector3D):
            # 向量点积：Vector3D * Vector3D
            return self._x * other._x + self._y * other._y + self._z * other._z
        return NotImplemented

    def __rmul__(self, other: Union[int, float]) -> "Vector3D":
        # 数乘满足交换律：scalar * Vector3D
        if isinstance(other, (int, float)):
            return Vector3D(self._x * other, self._y * other, self._z * other)
        return NotImplemented

    # --- 4. 可变语义下的就地加法 (In-place) ---
    def __iadd__(self, other: Any) -> "Vector3D":
        if not isinstance(other, Vector3D):
            return NotImplemented
        # 原地修改状态，避免创建新实例
        self._x += other._x
        self._y += other._y
        self._z += other._z
        # 必须显式返回 self
        return self

# 测试运算
if __name__ == "__main__":
    v1 = Vector3D(1.0, 2.0, 3.0)
    v2 = Vector3D(4.0, 5.0, 6.0)

    # 加法与反射加法
    print(f"v1 + v2 = {v1 + v2}")
    
    # 标量数乘与右向数乘
    print(f"v1 * 2.5 = {v1 * 2.5}")
    print(f"3 * v2 = {3 * v2}")
    
    # 向量点积
    dot_product = v1 * v2
    print(f"v1 点乘 v2 = {dot_product}")
    
    # 就地加法验证
    addr_before = id(v1)
    v1 += v2
    addr_after = id(v1)
    print(f"v1 就地加后: {v1}, 地址是否未变: {addr_before == addr_after}")
```

---

## 3. 容器与序列协议：切片与成员检索

为了使自定义类能够支持类似于内置 `list`、`dict` 的序列及映射操作，我们需要重写容器相关的方法。

### 3.1 核心方法
* `__len__(self)`：返回容器中元素的数量。
* `__contains__(self, item)`：拦截成员运算符 `item in self`。
* `__getitem__(self, key)`：支持读取操作 `self[key]`。
* `__setitem__(self, key, value)`：支持修改操作 `self[key] = value`。
* `__delitem__(self, key)`：支持删除操作 `del self[key]`。

### 3.2 深度解析切片（Slicing）处理逻辑

当执行 `obj[1:5:2]` 时，传入 `__getitem__` 的 `key` 是一个内置的 **`slice`** 对象。对于健壮的容器，我们必须使用 `slice.indices(len)` 方法对边界进行缩减与对齐，防止出现 `IndexError`。

```python
from typing import Union, List, Any

class CustomDataFrameRow:
    """
    自定义行数据容器，展示如何通过 slice.indices 安全处理切片索引。
    """
    def __init__(self, col_names: List[str], values: List[Any]):
        self._cols = list(col_names)
        self._values = list(values)

    def __len__(self) -> int:
        return len(self._values)

    def __contains__(self, item: Any) -> bool:
        # 同时支持按列名或值检索
        return item in self._cols or item in self._values

    def __getitem__(self, index: Union[int, slice, str]) -> Any:
        if isinstance(index, str):
            # 支持映射式按列名查找
            if index not in self._cols:
                raise KeyError(f"列 {index} 不存在")
            idx = self._cols.index(index)
            return self._values[idx]

        elif isinstance(index, slice):
            # 关键：调用 slice.indices(len) 规范化切片参数。
            # 这会返回一个三元组 (start, stop, step)，全部转化为安全的非负整型索引范围。
            start, stop, step = index.indices(len(self))
            sliced_values = [self._values[i] for i in range(start, stop, step)]
            sliced_cols = [self._cols[i] for i in range(start, stop, step)]
            return CustomDataFrameRow(sliced_cols, sliced_values)

        elif isinstance(index, int):
            # 普通整型索引支持，允许负数索引
            if index < 0:
                index += len(self)
            if index >= len(self) or index < 0:
                raise IndexError("索引超出范围")
            return self._values[index]

        else:
            raise TypeError("索引类型必须是 int, slice 或 str")

    def __repr__(self) -> str:
        pairs = [f"{k}:{v}" for k, v in zip(self._cols, self._values)]
        return f"Row({', '.join(pairs)})"

# 验证测试
if __name__ == "__main__":
    row = CustomDataFrameRow(["id", "name", "age", "role"], [1001, "Alice", 30, "TechLead"])
    
    # 映射属性获取
    print(f"获取 'name': {row['name']}")
    
    # 整数索引获取
    print(f"获取索引 2: {row[2]}")
    
    # 切片操作与 indices 安全规范
    sliced_row = row[1:10:2]  # stop=10 超出容器长度 4
    print(f"切片子行 [1:10:2]: {sliced_row}")
    
    # 成员运算符
    print(f"'age' 是否存在: {'age' in row}")
```

---

## 4. 迭代器协议与可调用对象

### 4.1 迭代器协议 (Iterable vs Iterator)

* **可迭代对象（Iterable）**：实现了 `__iter__`，返回一个迭代器。
* **迭代器（Iterator）**：实现了 `__iter__`（返回自身）和 `__next__`（返回下一个元素，遍历结束时抛出 `StopIteration`）。

#### 斐波那契数限额迭代器实现

```python
class FibonacciSeq:
    """
    斐波那契可迭代对象。
    """
    def __init__(self, limit: int):
        self.limit = limit

    def __iter__(self) -> "FibonacciIterator":
        # 每次遍历返回一个全新的迭代器状态
        return FibonacciIterator(self.limit)

class FibonacciIterator:
    """
    斐波那契迭代器。
    """
    def __init__(self, limit: int):
        self.limit = limit
        self.a, self.b = 0, 1
        self.count = 0

    def __iter__(self) -> "FibonacciIterator":
        return self

    def __next__(self) -> int:
        if self.count >= self.limit:
            raise StopIteration
        res = self.a
        self.a, self.b = self.b, self.a + self.b
        self.count += 1
        return res
```

### 4.2 可调用对象协议 (`__call__`)

实现 `__call__` 的对象可以像普通函数一样使用 `()` 进行调用。常用于需要在函数调用之间**保持与共享内部状态**的场景，或构建更加灵活的装饰器。

#### 生产级设计：带调用次数限制与延迟的执行拦截器

```python
import time
from typing import Callable, Any

class RateLimiter:
    """
    可调用对象：对函数执行次数实施频率控制，用作装饰器。
    """
    def __init__(self, max_calls: int, period: float):
        self.max_calls = max_calls
        self.period = period
        self.history = []

    def __call__(self, func: Callable[..., Any]) -> Callable[..., Any]:
        # 装饰器包裹函数
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            now = time.time()
            # 移出时间窗口外的记录
            self.history = [t for t in self.history if now - t < self.period]
            
            if len(self.history) >= self.max_calls:
                raise RuntimeError(f"API 调用受限！每 {self.period} 秒内最多调用 {self.max_calls} 次")
            
            self.history.append(now)
            return func(*args, **kwargs)
        return wrapper

# 装饰函数
@RateLimiter(max_calls=2, period=3.0)
def fetch_api_data():
    print("-> 成功获取 API 敏感数据")

# 测试调用限制
if __name__ == "__main__":
    fetch_api_data()
    fetch_api_data()
    try:
        fetch_api_data()  # 触发频率限制错误
    except RuntimeError as e:
        print(f"触发限流: {e}")
```
