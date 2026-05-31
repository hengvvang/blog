# 第三章：属性访问控制与 With 上下文管理器实现

在 Python 中，接管属性查找、自定义描述符模式以及利用上下文管理器锁定资源生命周期，是框架开发（如 Django ORM, SQLAlchemy, Pytest）中最为核心的底层技能。本章将详细剖析这些高阶魔术方法的调用边界与异常链路。

---

## 1. 属性访问控制：`__getattr__` 与 `__getattribute__` 的边界

当外界尝试读取一个对象的属性（例如 `value = obj.field`）时，Python 会运行一系列复杂的底层检索算法。在这一流程中，`__getattribute__` 和 `__getattr__` 扮演着截然不同的角色。

### 1.1 属性查找序列与拦截契机

* **`__getattribute__(self, name)`**：
  * **调用契机**：**无条件拦截**。只要访问对象属性，无论该属性是否存在于对象的本地字典（`__dict__`）中，此方法均会首先被调用。
  * **无限递归隐患**：由于它是无条件拦截，如果在方法内部通过 `self.name` 或 `self.__dict__` 获取属性，会再次触发对 `__getattribute__` 的调用，从而迅速占满调用栈抛出 `RecursionError`。
  * **避坑法则**：在方法内如需访问实例数据，必须通过底层基类代理调用：`super().__getattribute__(name)` 或 `object.__getattribute__(self, name)`。
* **`__getattr__(self, name)`**：
  * **调用契机**：**后备兜底（Fallback）**。只有当正常的属性查找链（包含：`__getattribute__`、实例 `__dict__`、类变量、MRO 继承链上的所有父类以及描述符）全部以失败告终、无法定位属性并即将抛出 `AttributeError` 时，此方法才会被触发。
  * **安全特点**：不会产生自我递归，非常适用于动态代理模式、懒加载设计。

#### 属性查找步骤序列图（Attribute Lookup Step Sequence）

当执行 `obj.field` 时，CPython 的属性解析步骤如下：

```
                              发起访问 obj.field
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │    调用 __getattribute__()    │
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                            [是否命中数据描述符?]
                             ├── 是 ──► 调用数据描述符的 __get__() 并返回
                             └── 否 ──┐
                                      │
                                      ▼
                           [是否存在于 obj.__dict__?]
                             ├── 是 ──► 返回该实例属性
                             └── 否 ──┐
                                      │
                                      ▼
                           [是否命中非数据描述符/方法?]
                             ├── 是 ──► 调用非数据描述符/绑定方法并返回
                             └── 否 ──┐
                                      │
                                      ▼
                            [是否命中了普通类属性?]
                             ├── 是 ──► 返回该类属性
                             └── 否 ──┐
                                      │
                                      ▼
                           [是否实现了 __getattr__?]
                             ├── 是 ──► 调用 __getattr__("field") 并返回结果
                             └── 否 ──► 抛出 AttributeError 异常
```

### 1.2 写入与删除拦截：`__setattr__` 与 `__delattr__`

* **`__setattr__(self, name, value)`**：拦截所有属性写操作。
  * **注意**：同样具有无限递归风险，切不可在内部写 `self.name = value`。必须通过 `super().__setattr__(name, value)` 或修改实例字典 `self.__dict__[name] = value`。
* **`__delattr__(self, name)`**：拦截 `del obj.name`。必须使用 `super().__delattr__(name)` 进行安全转发。

### 1.3 生产级实战：动态 API 链式调用客户端代理

```python
from typing import Any, Dict, List

class DynamicAPIClient:
    """
    通过属性访问拦截动态构建 HTTP 请求路径的 SDK 客户端。
    支持链式属性调用和方法自动补全。
    """
    def __init__(self, base_url: str, path: str = ""):
        self._base_url = base_url
        self._path = path

    def __getattr__(self, name: str) -> "DynamicAPIClient":
        # 拦截所有不存在的属性，作为路径的一节，生成新的客户端代理实例
        new_path = f"{self._path}/{name}"
        return DynamicAPIClient(self._base_url, new_path)

    def __call__(self, **params: Any) -> Dict[str, Any]:
        # 当最终对实例进行调用时，模拟执行请求组装
        full_url = f"{self._base_url}{self._path}"
        query_str = "&".join(f"{k}={v}" for k, v in params.items())
        return {
            "url": f"{full_url}?{query_str}" if query_str else full_url,
            "method": "GET"
        }

    def __dir__(self) -> List[str]:
        # 为集成开发环境 (IDE) 以及 dir() 提供补全支持
        return ["users", "orders", "auth", "products", "get_report"]

# 测试客户端
if __name__ == "__main__":
    client = DynamicAPIClient("https://api.v1.com")
    
    # 动态链式调用路径：/users/active/profile
    api_endpoint = client.users.active.profile
    request_payload = api_endpoint(user_id=42, format="json")
    
    print(f"生成的API信息: {request_payload}")
    print(f"动态属性自动补全列表: {dir(client)}")
```

---

## 2. 描述符协议（Descriptor Protocol）：属性控制的终极形态

当我们需要在多个类之间共享同一个属性验证（或计算）逻辑时，手动在每个类里写 `__setattr__` 会导致极度臃肿的代码。描述符是将属性访问行为解耦的核心机制。

### 2.1 描述符分类与查找优先级

实现以下方法中的一个或多个即可构成描述符：
* `__get__(self, instance, owner)`：获取属性时触发。
* `__set__(self, instance, value)`：写入属性时触发。
* `__delete__(self, instance)`：删除属性时触发。
* `__set_name__(self, owner, name)`：Python 3.6+ 引入。在类构建时自动回调，自动获取宿主类分配给该描述符的变量名。

#### 数据描述符 vs 非数据描述符

1. **数据描述符（Data Descriptor）**：实现了 `__set__` 或 `__delete__`。
   * **优先级**：**高于**实例字典 `__dict__`。如果实例的 `__dict__` 中有同名属性，依然优先调用描述符的 `__get__`。
2. **非数据描述符（Non-data Descriptor）**：仅实现了 `__get__`。
   * **优先级**：**低于**实例字典 `__dict__`。若实例字典中有同名属性，描述符会被直接覆盖失效。

### 2.2 生产级描述符实战：带类型与值域校验的 ORM 字段

```python
from typing import Any

class ValidatedField:
    """
    描述符基类：实现自动命名与类型校验
    """
    def __init__(self, expected_type: type):
        self.expected_type = expected_type
        self.storage_name = ""

    def __set_name__(self, owner: Any, name: str):
        # 自动推导并保存带有下划线的内部变量名，防止在宿主实例上发生命名冲突
        self.storage_name = f"_{name}"

    def __get__(self, instance: Any, owner: Any) -> Any:
        if instance is None:
            # 允许通过类本身访问描述符实例本身
            return self
        # 从宿主类实例上安全获取私有属性，默认为 None
        return getattr(instance, self.storage_name, None)

    def __set__(self, instance: Any, value: Any):
        if not isinstance(value, self.expected_type):
            raise TypeError(f"属性 {self.storage_name[1:]} 必须为 {self.expected_type.__name__} 类型")
        # 实际的值保存在宿主类实例（instance）的 __dict__ 中，杜绝了由于类变量带来的内存泄漏
        setattr(instance, self.storage_name, value)

class RangeIntegerField(ValidatedField):
    """
    数值描述符：带最小值与最大值校验
    """
    def __init__(self, min_val: int, max_val: int):
        super().__init__(int)
        self.min_val = min_val
        self.max_val = max_val

    def __set__(self, instance: Any, value: Any):
        super().__set__(instance, value)  # 先进行类型校验
        if not (self.min_val <= value <= self.max_val):
            raise ValueError(f"属性 {self.storage_name[1:]} 必须在 [{self.min_val}, {self.max_val}] 之间")

# 宿主类定义
class GameCharacter:
    level = RangeIntegerField(min_val=1, max_val=100)
    health = RangeIntegerField(min_val=0, max_val=9999)

    def __init__(self, name: str, level: int, health: int):
        self.name = name
        self.level = level    # 触发 RangeIntegerField.__set__
        self.health = health  # 触发 RangeIntegerField.__set__

# 测试描述符校验
if __name__ == "__main__":
    hero = GameCharacter("Arthur", 10, 100)
    
    try:
        hero.level = 105  # 超出上限，报错
    except ValueError as e:
        print(f"数据校验拦截: {e}")
```

---

## 3. 上下文管理器与安全资源保障

在涉及并发锁、事务提交、外部套接字和文件指针的维护时，程序必须具有极高的容错性。上下文管理器协议是应对资源泄漏的绝对屏障。

### 3.1 上下文生命周期与异常压制机制

上下文管理器包含两个核心双下方法：
* `__enter__(self)`：进入 `with` 块时调用，返回值作为 `as` 后绑定的变量。
* `__exit__(self, exc_type, exc_val, exc_tb)`：退出 `with` 块时被调用。其三个参数分别接收触发的异常类型、异常实例和追溯（Traceback）对象。如果未抛出异常，则这三个参数皆为 `None`。

#### 上下文异常跟踪路径（Exception Tracking Route）

```
                     进入 with Context() as c
                                │
                                ▼
                       执行 Context.__enter__()
                                │
                 [with 块内部业务逻辑执行]
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
               [执行过程正常]            [抛出异常 Error]
                    │                       │
                    ▼                       ▼
            调用 __exit__(None,       调用 __exit__(type,
                         None,                     val,
                         None)                     tb)
                    │                       │
                    ▼                       ▼
                释放资源               [检查 __exit__ 的返回值]
                    │                  ├── 返回 True (压制异常) ──► 吞掉异常，继续向下执行
                    │                  └── 返回 False/None ─────► 异常重新向上抛出 (Crash)
                    ▼
               结束 with 块
```

### 3.2 生产级实战：支持事务隔离与回滚的数据库管理器

下面展示如何使用面向类的上下文管理器安全隔离数据库事务：

```python
import sys
from typing import Any

class MockDBTransaction:
    """
    模拟的数据库事务上下文。
    """
    def __init__(self):
        self.in_transaction = False

    def begin(self):
        self.in_transaction = True
        print("[DB] ---> 开启新数据库事务")

    def commit(self):
        self.in_transaction = False
        print("[DB] ---> 提交事务成功，数据持久化完成")

    def rollback(self):
        self.in_transaction = False
        print("[DB] ---> 监测到内部逻辑错误，自动回滚数据到初始状态")

class DBTransactionGuard:
    """
    生产级事务上下文管理器。
    - 进入时自动启动事务
    - 无异常退出时自动 commit
    - 发生异常时自动 rollback 并将特定的临时连接关闭，同时向外抛出真实异常
    """
    def __init__(self, db_tx: MockDBTransaction):
        self.db = db_tx

    def __enter__(self) -> MockDBTransaction:
        self.db.begin()
        return self.db

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        if exc_type is not None:
            # 捕获到了未处理的异常，进行回滚
            print(f"[Guard] 发生内部异常: {exc_val}")
            self.db.rollback()
            # 返回 False，明确要求解释器将当前捕获的异常继续向上层业务抛出
            return False
        else:
            # 正常执行完毕，安全提交事务
            self.db.commit()
            return True

# 场景 1：无错误正常提交
if __name__ == "__main__":
    db_tx = MockDBTransaction()
    print("=== 场景一：正常逻辑 ===")
    with DBTransactionGuard(db_tx) as conn:
        print("[Client] 写入用户基础数据...")
        print("[Client] 关联订单状态...")

    # 场景 2：抛出错误自动回滚
    print("\n=== 场景二：异常触发自动回滚 ===")
    try:
        with DBTransactionGuard(db_tx) as conn:
            print("[Client] 扣减用户账户余额...")
            # 模拟错误引发
            raise RuntimeError("系统发生扣减溢出错误，账户金额不能为负！")
            print("[Client] 该条语句不会执行...")
    except RuntimeError as err:
        print(f"[Client] 顶层捕获到了抛出的异常: {err}")
```

### 3.3 生成器上下文管理器与 `@contextmanager` 底层机理

通过 `contextlib.contextmanager` 装饰器，我们可以用一个简单的生成器实现相同的功能。其工作原理基于 CPython 对生成器生命周期的精准调度：

```python
from contextlib import contextmanager
import socket

@contextmanager
def socket_guard(host: str, port: int):
    """
    基于生成器的 Socket 网络套接字安全管理器
    """
    print(f"[Conn] 初始化套接字连接: {host}:{port}")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # 在 yield 之前的逻辑对应 __enter__
        yield sock
    except Exception as e:
        # yield 之后的异常处理捕获 with 块内抛出的异常
        print(f"[Conn] 发生异常，开始关闭套接字: {e}")
        raise
    finally:
        # finally 对应 __exit__ 逻辑，确保资源百分之百关闭
        print("[Conn] 强制关闭 Socket 文件描述符")
        sock.close()
```

#### 底层转换原理解释

1. 当执行 `with socket_guard(...) as sock:` 时，装饰器底层生成的类会调用生成器的 `__next__()`，使代码运行到 `yield sock` 处并暂停（Suspend），同时将 `sock` 传递给 `as` 变量。
2. 如果 `with` 块内部发生异常，该类在 C 语言层面的 `__exit__` 会执行 `generator.throw(exc_type, exc_val, exc_tb)`。这使得异常直接在生成器的 `yield` 语句处被抛出，驱动 `try-except-finally` 执行清理操作。
3. 如果无异常，则在 `__exit__` 内部再次执行 `__next__()` 激活生成器，运行 `yield` 之后的剩余代码。
