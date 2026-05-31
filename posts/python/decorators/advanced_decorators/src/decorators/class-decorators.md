# 第二章：带参数的类装饰器设计与状态化

虽然函数装饰器在日常开发中十分普遍，但面对复杂的运行时状态管理和结构化面向对象设计时，**类装饰器（Class-based Decorators）**往往是更为优越的选择。然而，类装饰器的生命周期模型与常规函数有所不同，且在修饰“类中的实例方法”时会触发经典的方法绑定 Bug。

本章将全面解密类装饰器的调用机制，剖析描述符协议，并给出工业级的解决方案。

---

## 1. 无参数类装饰器的生命周期与设计

无参数类装饰器的实现逻辑非常清晰。在这种模式中，类本身充当了装饰器，而被装饰后的函数会被替换为该类的一个**实例对象**。

### 1.1 生命周期拆解
* **实例化阶段（定义期）**：当 Python 解释器在编译/加载模块时，遇到被 `@MyClassDec` 装饰的函数声明，会立即调用该类的构造函数 `__init__(self, func)`，将被装饰的函数传入并保存在实例属性中。
* **执行阶段（调用期）**：当在业务代码中执行该函数名（即 `my_func(*args, **kwargs)`）时，由于函数名已被替换为装饰器类的实例，Python 会触发该实例的 `__call__(self, *args, **kwargs)` 魔术方法。

### 1.2 示例：带细粒度状态监控的调用计数器

下面是一个生产级的调用计数器，它能够在内存中安全地记录特定函数的调用次数，并对外暴露统计指标：

```python
import functools
from typing import Callable, Any

class StateCallCounter:
    def __init__(self, func: Callable[..., Any]):
        # 1. 接收并保存被装饰的目标函数
        self.func = func
        # 2. 初始化装饰器实例的专属局部状态
        self.count = 0
        # 保留原函数的基本元数据（__name__, __doc__ 等）
        functools.update_wrapper(self, func)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        # 3. 拦截调用逻辑，累加计数器状态
        self.count += 1
        print(f"[Counter] 函数 {self.func.__name__} 开始第 {self.count} 次执行")
        try:
            result = self.func(*args, **kwargs)
            return result
        except Exception as e:
            print(f"[Counter] 函数 {self.func.__name__} 在第 {self.count} 次执行时发生异常: {e}")
            raise e

# 声明被装饰的普通函数
@StateCallCounter
def process_transaction(amount: float) -> str:
    """处理一笔交易。"""
    if amount <= 0:
        raise ValueError("交易金额必须大于 0")
    return f"Transaction of ${amount} processed successfully."

# 验证无参类装饰器的执行与状态留存
print(process_transaction(250.0))
print(process_transaction(100.5))
print(f"当前 process_transaction 实例类型: {type(process_transaction)}")
print(f"从装饰器属性中提取的累计调用次数: {process_transaction.count}")
```

---

## 2. 带参数的类装饰器设计与参数路由机制

当我们的类装饰器需要接收外部传入的配置参数时（例如 `@Retry(max_attempts=3, backoff=2.0)`），其内部的**调用逻辑与结构设计将发生本质性的改变**。

### 2.1 核心调用链对比（ASCII 结构示意图）

带参数和不带参数的类装饰器，其底层的参数路由流向完全不同。请仔细对照以下两者的初始化与调用链图：

```text
========================================================================
模式 A：无参数类装饰器（@ClassDecorator）
========================================================================
1. 定义期加载：
   my_func = ClassDecorator(my_func)
                  │
                  ▼ 触发
   __init__(self, func) ───► 将 func 存入 self.func

2. 运行期调用：
   my_func(*args) ───► 触发 __call__(self, *args) ───► 调用 self.func(*args)


========================================================================
模式 B：带参数类装饰器（@ClassDecorator(val=10)）
========================================================================
1. 定义期加载：
   Step 1: dec_instance = ClassDecorator(val=10)
                               │
                               ▼ 触发
            __init__(self, val) ───► 将配置 val 存为实例属性 (如 self.val)

   Step 2: my_func = dec_instance(my_func)
                          │
                          ▼ 触发
            __call__(self, func) ───► 接收原函数，在此必须构建并返回 wrapper

2. 运行期调用：
   my_func(*args) ───► 触发并执行定义期返回的 wrapper(*args)
```

因此，对于带参数的类装饰器：
* `__init__` 方法接收的是**装饰器本身的参数**，而不是原函数。
* `__call__` 方法接收的是**被装饰的目标函数**，并且必须在内部定义一个包装函数并将其返回，而**不是**直接执行原函数。

### 2.2 生产级设计：带退避策略的指数重试装饰器

以下是带参数类装饰器的工业级实现：

```python
import time
import functools
from typing import Callable, Any

class ExponentialRetry:
    def __init__(self, max_attempts: int = 3, backoff_factor: float = 2.0):
        # 此时 __init__ 负责接收装饰器的配置参数，并将其固化在实例属性中
        self.max_attempts = max_attempts
        self.backoff_factor = backoff_factor

    def __call__(self, func: Callable[..., Any]) -> Callable[..., Any]:
        # 此时 __call__ 接收的是原函数本身，我们必须在此处返回一个包装函数
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            attempt = 0
            current_delay = 1.0
            
            while attempt < self.max_attempts:
                try:
                    return func(*args, **kwargs)
                except Exception as error:
                    attempt += 1
                    if attempt >= self.max_attempts:
                        print(f"[Retry] 函数 {func.__name__} 已达最大重试上限 {self.max_attempts}。抛出错误。")
                        raise error
                    
                    print(f"[Retry] 函数 {func.__name__} 第 {attempt} 次失败: {error}。"
                          f"将在 {current_delay:.2f} 秒后重试...")
                    time.sleep(current_delay)
                    current_delay *= self.backoff_factor
        return wrapper

# 演示使用带参数的类装饰器
@ExponentialRetry(max_attempts=3, backoff_factor=1.5)
def fetch_user_profile(user_id: int) -> dict:
    # 模拟一个偶发性失败的网络接口
    import random
    if random.random() > 0.3:
        raise ConnectionResetError("Remote server closed connection prematurely.")
    return {"user_id": user_id, "status": "active"}

# 测试重试行为
try:
    data = fetch_user_profile(999)
    print(f"数据获取成功: {data}")
except ConnectionResetError:
    print("重试 3 次后依然无法建立连接。")
```

---

## 3. 类装饰器装饰实例方法时的“self 丢失”崩溃成因与描述符修复

当尝试将一个**无参数的类装饰器**应用于修饰一个类的方法时，会发生著名的崩溃 Bug。

### 3.1 问题复现

```python
class Agent:
    def __init__(self, name: str):
        self.name = name

    @StateCallCounter  # 使用前面定义的无参类装饰器
    def ping_host(self, host: str) -> str:
        return f"{self.name} pinged {host}"

agent = Agent("Echo-1")
# 下面这一行会直接报错崩溃：
# agent.ping_host("127.0.0.1")
```

#### 崩溃报错：
`TypeError: ping_host() missing 1 required positional argument: 'host'`

### 3.2 崩溃背后的底层原理：CPython 描述符协议的缺失

在 Python 中，通过实例访问一个普通的方法时，其实经历了一次隐式的动态绑定过程。

1. **普通的函数对象**（如类定义中的 `def ping_host`）实现了**描述符协议（Descriptor Protocol）**，它包含了一个非数据描述符方法 `__get__`。
2. 当我们访问 `agent.ping_host` 时，底层会被 CPython 解释器转换为以下调用：
   `ping_host_bound = Agent.ping_host.__get__(agent, Agent)`
3. 函数的 `__get__` 方法会返回一个 **绑定方法对象（Bound Method Object）**。在这个绑定方法被调用时，它会自动把 `agent` 实例作为第一个参数（即 `self`）注入到真实的函数调用中。
4. 然而，当使用 `StateCallCounter` 装饰 `ping_host` 后，类 `Agent` 内部的 `ping_host` 键指向的不再是一个普通函数，而是 `StateCallCounter` 类的**一个实例对象**。
5. `StateCallCounter` 的实例是一个常规的 Python 对象，默认情况下**没有实现 `__get__` 描述符方法**。
6. 因此，访问 `agent.ping_host` 时，解释器无法进行描述符绑定，直接返回了 `StateCallCounter` 的实例对象。
7. 随后调用该实例：`counter_instance("127.0.0.1")`，对应的 `__call__` 被触发，接收到的位置参数只有 `"127.0.0.1"`。由于没有任何地方传入 `agent` 实例，这就导致底层调用 `self.func` 时缺失了第一个位置参数（`self`）。

### 3.3 解决方案：利用描述符协议动态绑定

为了让我们的类装饰器成为“全能装饰器”（既能修饰普通函数，也能修饰实例方法），我们必须为装饰器类实现 `__get__` 方法，在方法被访问时正确地返回绑定方法：

```python
import types
import functools
from typing import Any, Callable

class UniversalCounter:
    def __init__(self, func: Callable[..., Any]):
        self.func = func
        self.count = 0
        functools.update_wrapper(self, func)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        # 当直接调用普通函数时，会走这个入口
        self.count += 1
        print(f"[Universal] 函数 {self.func.__name__} 调用次数: {self.count}")
        return self.func(*args, **kwargs)

    def __get__(self, instance: Any, owner: Any) -> Any:
        # 1. 如果是通过类对象直接访问方法（如 Agent.ping_host），直接返回装饰器实例本身
        if instance is None:
            return self
        
        # 2. 如果是通过实例访问方法（如 agent.ping_host）
        # 我们需要返回一个绑定到实例上的可调用对象。
        # 
        # 注意：如果使用 types.MethodType(self.func, instance) 绑定，
        # 则后续调用会直接绕过装饰器的 __call__，从而导致计数逻辑失效。
        # 
        # 为了使装饰器的 wrapper __call__ 逻辑仍然生效，我们必须使用 types.MethodType(self, instance) 
        # 将“装饰器实例自身”与“宿主实例”进行绑定。
        # 这样在调用绑定方法时，instance (agent) 会作为第一个参数传入 self.__call__(instance, *args, **kwargs)。
        print(f"[Descriptor] 触发动态绑定，宿主实例为: {instance}")
        return types.MethodType(self, instance)

# 测试修复后的通用类装饰器
class ServerAgent:
    def __init__(self, region: str):
        self.region = region

    @UniversalCounter
    def check_health(self, service: str) -> str:
        return f"[{self.region}] Service '{service}' is healthy."

agent = ServerAgent("Asia-East")
# 此时访问 agent.check_health 会触发 UniversalCounter.__get__
# 返回一个 Bound Method ── types.MethodType(counter_instance, agent)
# 调用该绑定方法时，等价于执行 UniversalCounter.__call__(agent, "Database")
print(agent.check_health("Database"))
print(agent.check_health("Cache"))

# 验证属性保存情况
print(f"累计调用次数: {agent.check_health.count}")
```

#### 方法绑定时的数据流与类装饰器调用关系图：

```text
访问实例方法：agent.check_health("Database")
  │
  ├──► 触发 UniversalCounter.__get__(instance=agent, owner=ServerAgent)
  │      │
  │      └──► 执行 types.MethodType(self_decorator_instance, agent)
  │             返回 Bound Method 对象，其属性：
  │               - __self__ 指向 agent
  │               - __func__ 指向 self_decorator_instance
  │
  ▼ 调用 Bound Method
触发 self_decorator_instance.__call__(agent, "Database")
  │
  ├──► 内部逻辑：累加计数器 count += 1
  │
  └──► 调用实际原函数：self.func(agent, "Database") ── 即真正的方法调用
```

---

## 4. 状态化装饰器的并发与多线程安全问题

由于类装饰器的状态（如 `count`、`cache`）是存储在全局唯一的装饰器实例属性中的，当该被装饰函数在多线程环境下并发执行时，就会产生经典的**竞态条件（Race Condition）**。

### 4.1 使用互斥锁（threading.Lock）保证全局状态的线程安全

如果计数器或者状态统计是全局共享的（例如全局调用频次统计），必须在状态更新处添加线程互斥锁：

```python
import threading
import functools
from typing import Callable, Any

class ThreadSafeCounter:
    def __init__(self, func: Callable[..., Any]):
        self.func = func
        self.count = 0
        self._lock = threading.Lock()  # 实例化专用的重入/互斥锁
        functools.update_wrapper(self, func)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        # 使用上下文管理器安全获取与释放锁，确保状态递增的原子性
        with self._lock:
            self.count += 1
            local_count = self.count
            
        print(f"[ThreadSafe-{threading.get_ident()}] 调用累计: {local_count}")
        return self.func(*args, **kwargs)
```

### 4.2 使用 `threading.local` 隔离线程间状态

如果装饰器的状态**不应共享**，而是需要为每个线程维护独立的副本（例如，每个线程独立的事务计数、数据库连接缓存或调用链路 Trace ID），应当使用 `threading.local` 进行状态隔离：

```python
import threading
import functools
from typing import Callable, Any

class ThreadLocalCounter:
    def __init__(self, func: Callable[..., Any]):
        self.func = func
        # 创建线程局部数据对象，其属性读写在不同线程间是天然隔离的
        self._local_state = threading.local()
        functools.update_wrapper(self, func)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        # 为当前执行线程初始化私有状态
        if not hasattr(self._local_state, 'count'):
            self._local_state.count = 0
            
        self._local_state.count += 1
        print(f"[ThreadLocal-{threading.get_ident()}] 当前线程独占计数: {self._local_state.count}")
        return self.func(*args, **kwargs)

# 测试并发隔离性
@ThreadLocalCounter
def execute_task():
    pass

def worker():
    for _ in range(3):
        execute_task()

threads = [threading.Thread(target=worker) for _ in range(2)]
for t in threads:
    t.start()
for t in threads:
    t.join()
```

本章我们深入探索了类装饰器的底层工作流，并利用描述符协议化解了实例方法绑定的难题。在下一章中，我们将进入终极黑魔法篇，讨论元数据的完美继承、基于 `__getattr__` 的动态代理，以及类级全局扫描改写的高级元编程技巧。
