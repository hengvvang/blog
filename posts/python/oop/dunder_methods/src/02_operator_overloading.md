# 运算符重载与容器协议

Python 的协议式设计允许自定义对象无缝接入语言级操作符（如 `+`、`*`、`==`、`<`）以及内置数据结构的通用接口（如索引、切片、迭代、调用）。本章将系统剖析如何通过魔术方法重载这些行为。

---

## 1. 比较运算符与全关系序排列

Python 的“富比较”（Rich Comparisons）提供了一组魔术方法，允许我们定制对象间的比较逻辑。

### 富比较魔术方法
* `__lt__(self, other)`: 小于 (`<`)
* `__le__(self, other)`: 小于等于 (`<=`)
* `__eq__(self, other)`: 等于 (`==`)
* `__ne__(self, other)`: 不等于 (`!=`)
* `__gt__(self, other)`: 大于 (`>`)
* `__ge__(self, other)`: 大于等于 (`>=`)

### 反射查找与 `NotImplemented`

当 Python 执行 `a < b` 时，其解析逻辑如下：
1. 首先尝试调用 `a.__lt__(b)`。
2. 如果 `a` 没有实现 `__lt__`，或者返回了特殊的单例对象 **`NotImplemented`**，Python 将会尝试调用右操作数的反向比较操作，即 `b.__gt__(a)`。
3. 若反向操作同样没有实现或返回 `NotImplemented`，则最终抛出 `TypeError`。

> [!IMPORTANT]
> 注意区分 `NotImplemented`（是一个单例值，用于协调多态运算符查找）与 `NotImplementedError`（是一个异常类，常在抽象基类的方法中抛出）。在魔术方法中，应使用 `return NotImplemented` 指导解释器寻找备用方法，而非抛出异常。

### 减少样板代码：`@functools.total_ordering`

实现所有六个比较方法显得繁琐。通过使用 `functools.total_ordering` 装饰器，我们只需定义 `__eq__` 以及 `__lt__`、`__le__`、`__gt__`、`__ge__` 中的**任意一个**，装饰器便会自动补全其余的比较方法。

* **性能折中**：`total_ordering` 底层通过包裹已有的比较方法来实现其余的方法，这会引入微小的额外函数调用开销。在对性能有极端要求的场景下，手动编写全部富比较方法是更好的选择。

```python
from functools import total_ordering
from typing import Any

@total_ordering
class Task:
    """
    表示一个具有优先级的任务。
    """
    def __init__(self, name: str, priority: int):
        self.name = name
        self.priority = priority

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, Task):
            return NotImplemented
        return self.priority == other.priority

    def __lt__(self, other: Any) -> bool:
        if not isinstance(other, Task):
            return NotImplemented
        # 优先级数值越小，任务等级越高
        return self.priority < other.priority

# 测试
t1 = Task("Write code", 1)
t2 = Task("Write docs", 2)
print(f"t1 < t2: {t1 < t2}")   # True (__lt__ 被调用)
print(f"t1 >= t2: {t1 >= t2}") # False (由 total_ordering 自动推导生成)
```

---

## 2. 算术运算符的深层机制：右向与就地重载

算术运算符可分为三大类：**双目常规操作**、**右向（反射）操作**以及**就地（增量）操作**。我们以加法为例：

| 操作 | 对应方法 | 触发条件 |
| :--- | :--- | :--- |
| 常规加法 | `a.__add__(b)` | 执行 `a + b` |
| 右向加法 | `b.__radd__(a)` | 执行 `a + b`，且 `a` 的 `__add__` 缺失或返回 `NotImplemented` |
| 就地加法 | `a.__iadd__(b)` | 执行 `a += b` |

### 就地运算符（In-place Operators）的设计哲学

就地运算符（如 `+=`）的覆写需要严格遵循对象的可变性设计：
* **不可变对象**（如自定义数、复数）：`__iadd__` 方法**不应该**实现。此时执行 `a += b` 会自动退化为 `a = a + b`，即创建并返回一个全新的对象。
* **可变对象**（如矩阵、自定义容器）：应当实现 `__iadd__`，在原内存地址上直接修改对象状态，并显式返回 `self`。

### 生产级矩阵（或向量）实现

下面的 `Vector2D` 类完整演示了常规、反向、就地加法以及标量乘法的稳健实现：

```python
from typing import Union, Tuple

class Vector2D:
    """
    二维数值向量，支持与同类型向量相加，以及与标量进行数乘。
    """
    def __init__(self, x: float, y: float):
        self._x = x
        self._y = y

    @property
    def components(self) -> Tuple[float, float]:
        return (self._x, self._y)

    def __repr__(self) -> str:
        return f"Vector2D({self._x}, {self._y})"

    # 1. 常规加法：Vector2D + Vector2D
    def __add__(self, other: Any) -> "Vector2D":
        if not isinstance(other, Vector2D):
            return NotImplemented
        return Vector2D(self._x + other._x, self._y + other._y)

    # 2. 右向加法（反射）：非 Vector2D + Vector2D (虽然在此例中加法满足交换律)
    def __radd__(self, other: Any) -> "Vector2D":
        return self.__add__(other)

    # 3. 标量乘法：Vector2D * scalar
    def __mul__(self, other: Union[int, float]) -> "Vector2D":
        if not isinstance(other, (int, float)):
            return NotImplemented
        return Vector2D(self._x * other, self._y * other)

    # 4. 右向乘法（反射）：scalar * Vector2D
    def __rmul__(self, other: Union[int, float]) -> "Vector2D":
        return self.__mul__(other)

    # 5. 就地加法（向量是可变的，故修改自身并返回 self）
    def __iadd__(self, other: "Vector2D") -> "Vector2D":
        if not isinstance(other, Vector2D):
            return NotImplemented
        self._x += other._x
        self._y += other._y
        return self

# 测试运算
v1 = Vector2D(1.0, 2.0)
v2 = Vector2D(3.0, 4.0)

# 常规加法
print(f"v1 + v2 = {v1 + v2}")  # Vector2D(4.0, 6.0)

# 标量乘法与右向数乘
print(f"v1 * 3 = {v1 * 3}")    # Vector2D(3.0, 6.0)
print(f"3 * v1 = {3 * v1}")    # Vector2D(3.0, 6.0)

# 就地加法
original_id = id(v1)
v1 += v2
print(f"v1 += v2 后: {v1}, ID是否改变: {id(v1) == original_id}")  # True，原内存修改
```

---

## 3. 容器与序列协议：切片与成员检索

要让一个自定义对象像 Python 原生的 `list` 或 `dict` 一样支持索引检索、切片赋值及成员包含判断，需要实现容器协议。

### 核心方法
* `__len__(self)`：对应 `len(obj)`。应当返回一个非负整数。
* `__contains__(self, item)`：对应 `item in obj`。
* `__getitem__(self, key)`：对应 `obj[key]`。
* `__setitem__(self, key, value)`：对应 `obj[key] = value`。
* `__delitem__(self, key)`：对应 `del obj[key]`。

### 处理切片（Slicing）
当用户执行 `obj[1:5:2]` 时，传入 `__getitem__` 的 `key` 参数并非整数，而是一个 **`slice`** 对象。一个健壮的容器必须判断 `key` 的类型并予以兼容：

```python
from typing import Any, List, Union

class CustomSequence:
    """
    自定义只读序列，包装了一个内部列表，完美支持整数索引与切片操作。
    """
    def __init__(self, items: List[Any]):
        self._data = list(items)

    def __len__(self) -> int:
        return len(self._data)

    def __contains__(self, item: Any) -> bool:
        # 高效的成员检索。若未定义 __contains__，Python 会退化为遍历 __iter__
        return item in self._data

    def __getitem__(self, index: Union[int, slice]) -> Union[Any, List[Any]]:
        if isinstance(index, slice):
            # 处理切片逻辑：获取 slice 的 start, stop, step 并对内部数据做切片
            return CustomSequence(self._data[index])
        elif isinstance(index, int):
            # 处理单个索引逻辑
            return self._data[index]
        else:
            raise TypeError(f"Sequence indices must be integers or slices, not {type(index).__name__}")

# 测试
seq = CustomSequence([10, 20, 30, 40, 50])
print(f"长度: {len(seq)}")             # Output: 5
print(f"元素检索 seq[1]: {seq[1]}")    # Output: 20
print(f"切片操作 seq[1:4]: {seq[1:4]._data}")  # Output: [20, 30, 40]
print(f"是否包含 30: {30 in seq}")      # Output: True
```

---

## 4. 迭代器协议与可调用对象

### 迭代器协议

在 Python 中，任何支持循环遍历的对象都遵循**迭代器协议**。该协议由两部分组成：
1. **可迭代对象（Iterable）**：实现了 `__iter__` 方法，该方法必须返回一个**迭代器**对象。
2. **迭代器（Iterator）**：实现了 `__iter__` 方法（返回自身）以及 `__next__` 方法（每次被调用时返回序列的下一项，若没有更多元素，需抛出 `StopIteration` 异常）。

此外，如果类实现了 `__reversed__(self)`，则可以使用 `reversed(obj)` 进行反向迭代。

```python
class FibonacciIterator:
    """
    生成斐波那契数列前 N 项的迭代器。
    """
    def __init__(self, limit: int):
        self.limit = limit
        self.count = 0
        self.a, self.b = 0, 1

    def __iter__(self) -> "FibonacciIterator":
        # 迭代器协议要求 __iter__ 返回迭代器本身
        return self

    def __next__(self) -> int:
        if self.count >= self.limit:
            raise StopIteration
        
        result = self.a
        self.a, self.b = self.b, self.a + self.b
        self.count += 1
        return result

# 测试斐波那契迭代器
for num in FibonacciIterator(6):
    print(num, end=" ")  # Output: 0 1 1 2 3 5
print()
```

### 可调用对象协议 (`__call__`)

若一个类实现了 `__call__` 魔术方法，那么它的实例便可以像函数一样被调用，例如 `instance(*args, **kwargs)`。

#### 生产级设计：带内部状态的调用计数装饰器类

```python
from typing import Callable, Any

class CallCounter:
    """
    可调用对象：既是一个可以记录被调用次数的计数器，也可以作为装饰器使用。
    """
    def __init__(self, func: Callable[..., Any]):
        self._func = func
        self._calls = 0

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self._calls += 1
        print(f"函数 {self._func.__name__} 被调用了 {self._calls} 次")
        return self._func(*args, **kwargs)

    @property
    def call_count(self) -> int:
        return self._calls

# 将其作为装饰器应用
@CallCounter
def add(a: int, b: int) -> int:
    return a + b

# 测试调用
add(1, 2)
add(3, 4)
print(f"总计调用次数: {add.call_count}") # Output: 2
```
