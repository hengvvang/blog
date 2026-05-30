# 第二章：类装饰器与参数化深度设计

相比于函数装饰器，**类装饰器（Class-based Decorators）**在结构化设计、状态管理以及面向对象扩展方面具有天然的优势。然而，类装饰器的引入也带来了更复杂的调用生命周期以及极易踩坑的“实例方法绑定失效”问题。本章将对这些高阶设计进行深入探究。

---

## 1. 使用类实现无参数装饰器

无参数类装饰器的实现非常直观。在这种设计模式中：
- 构造函数 `__init__` 负责接收被修饰的函数，并将其保存在实例属性中。
- 魔术方法 `__call__` 让类实例成为一个可调用对象（Callable）。当原函数被调用时，实际执行的是 `__call__` 中的逻辑。

### 1.1 示例：带状态维护的调用计数器

下面是一个用于统计函数调用次数的类装饰器：

```python
import functools

class CallCounter:
    def __init__(self, func):
        # 1. 接收目标函数并保存
        self.func = func
        # 2. 初始化装饰器自身的内部状态
        self.count = 0
        # 尽量保留基本元数据（后面章节会详述 wraps）
        functools.update_wrapper(self, func)

    def __call__(self, *args, **kwargs):
        # 3. 每次被调用时累加状态
        self.count += 1
        print(f"[{self.func.__name__}] 已被调用 {self.count} 次")
        # 4. 调用原函数并返回结果
        return self.func(*args, **kwargs)

# 使用装饰器
@CallCounter
def calculate_area(width, height):
    return width * height

print(calculate_area(5, 4))
print(calculate_area(10, 2))
print(f"最终统计到的调用次数: {calculate_area.count}")
```

---

## 2. 带参数的类装饰器设计

一旦类装饰器需要接收参数（例如 `@Retry(max_attempts=3)`），其调用模型和参数流向就会发生**本质性变化**。

### 2.1 结构性差异
当解析器遇到带参数的 `@MyClassDec(arg1)` 时：
1. 它首先调用 `MyClassDec(arg1)`。这意味着类的 `__init__` 接收的**不再是原函数**，而是**装饰器本身的参数**。
2. 然后，`MyClassDec(arg1)` 返回的类实例会被当作一个装饰器去包裹原函数，即调用 `instance(func)`。这意味此时触发的 `__call__` 接收的**是原函数**。
3. `__call__` 方法必须在内部定义一个包裹函数，并将其返回。

### 2.2 示例：可配置的指数退避重试装饰器

我们实现一个工业级的重试装饰器，支持自定义重试次数与退避延迟：

```python
import time
import functools

class ExponentialRetry:
    def __init__(self, max_attempts=3, backoff_factor=2.0):
        # __init__ 接收的是装饰器参数，而不是原函数
        self.max_attempts = max_attempts
        self.backoff_factor = backoff_factor

    def __call__(self, func):
        # __call__ 接收的是原函数，必须在此返回一个包装器
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            attempt = 0
            delay = 1.0
            while attempt < self.max_attempts:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    attempt += 1
                    if attempt >= self.max_attempts:
                        print(f"[Retry] 已达最大尝试次数 {self.max_attempts}，抛出异常。")
                        raise e
                    print(f"[Retry] 失败: {e}. {delay} 秒后进行第 {attempt} 次重试...")
                    time.sleep(delay)
                    delay *= self.backoff_factor
        return wrapper

# 使用带参数的类装饰器
@ExponentialRetry(max_attempts=4, backoff_factor=1.5)
def unstable_network_request(url):
    import random
    if random.random() > 0.2:
        raise ConnectionError("Timeout connection failed")
    return "Success Data"

# 测试重试逻辑
try:
    result = unstable_network_request("https://api.example.com")
    print(f"请求结果: {result}")
except ConnectionError:
    print("最终请求失败！")
```

---

## 3. 类装饰器装饰“实例方法”的崩溃成因与描述符修复

这是一个高级 Python 开发者经常遇到的**经典 Bug**。

### 3.1 问题复现
当我们尝试用前文实现的 `CallCounter` 装饰一个类的方法时：

```python
class Worker:
    def __init__(self, name):
        self.name = name

    @CallCounter
    def do_work(self, task):
        print(f"{self.name} 正在工作: {task}")

w = Worker("Alice")
# 调用会抛出异常
w.do_work("编写代码")
```

**运行报错**：`TypeError: do_work() missing 1 required positional argument: 'self'`。

### 3.2 原因剖析
在 Python 中，方法和函数是有本质区别的。
- 普通函数（如 `def do_work`）实现了**描述符协议（Descriptor Protocol）**，它是一个**非数据描述符**，包含 `__get__` 方法。
- 当我们通过实例访问方法时（如 `w.do_work`），Python 解释器在幕后会将 `w.do_work` 转换为 `do_work.__get__(w, Worker)`。
- 函数的 `__get__` 方法会返回一个**绑定方法对象（Bound Method）**。该绑定方法在调用时会自动将实例 `w` 作为第一个参数（即 `self`）注入。

但是，`CallCounter` 装饰器将 `do_work` 替换为了 `CallCounter` 类的**实例对象**。
- `CallCounter` 实例只是个普通的 Python 对象，默认**没有实现 `__get__` 方法**。
- 因此，当访问 `w.do_work` 时，直接返回了 `CallCounter` 实例本身。
- 随后执行 `CallCounter.__call__(*args, **kwargs)`，此时传入的参数只有 `"编写代码"`，没有任何机制传入实例 `w`（即 `self`）。这就导致了参数缺失的错误。

### 3.3 解决方案：引入描述符协议
要让类装饰器既能装饰普通函数，又能装饰实例方法，必须在其内部实现 `__get__` 方法，将装饰器实例转变为描述符：

```python
import types
import functools

class UniversalLogger:
    def __init__(self, func):
        self.func = func
        functools.update_wrapper(self, func)

    def __call__(self, *args, **kwargs):
        # 针对普通函数，直接执行
        print(f"[Log] 正在调用函数: {self.func.__name__}")
        return self.func(*args, **kwargs)

    def __get__(self, instance, owner):
        # 如果通过类访问（如 Worker.do_work），instance 为 None
        if instance is None:
            return self
        
        # 如果通过实例访问（如 w.do_work），返回一个绑定到该实例的方法对象
        # types.MethodType 将 self.func (原函数) 绑定到 instance (w) 上，
        # 并返回一个可调用对象。但这样会绕过装饰器自身的 __call__！
        # 
        # 为了让装饰器的逻辑 (__call__) 仍然生效，我们应该将“装饰器自身的可调用逻辑”
        # 绑定到实例上，而不是原函数。
        print(f"[Descriptor] 绑定方法到实例: {instance}")
        return types.MethodType(self, instance)

# 测试修复后的装饰器
class Developer:
    def __init__(self, name):
        self.name = name

    @UniversalLogger
    def code(self, language):
        print(f"{self.name} 正在使用 {language} 编码。")

dev = Developer("Bob")
# 此时 dev.code 会触发 UniversalLogger.__get__
# 返回一个绑定了 dev 实例的 MethodType 对象，该对象在调用时会把 dev 传入 UniversalLogger.__call__ 的第一个参数
dev.code("Python")
```

#### 绑定流向示意图

```text
访问 dev.code 
    │
    ▼
触发 UniversalLogger.__get__(self, instance=dev, owner=Developer)
    │
    ▼
创建并返回 types.MethodType(self_decorator, dev) ── 即绑定了 self_decorator 的 bound method
    │
    ▼
执行该绑定方法(args=["Python"]) ── 实际调用 UniversalLogger.__call__(dev, "Python")
```

---

## 4. 状态维护的并发与线程安全

当我们在类装饰器实例中维护状态（如前文的 `CallCounter.count`）时，如果在多线程环境下并发调用被装饰的函数，可能会产生**竞态条件（Race Conditions）**，导致数据不一致。

### 4.1 使用线程锁（threading.Lock）
最直接的解决方案是在累加计数时加锁：

```python
import threading
import functools

class ThreadSafeCounter:
    def __init__(self, func):
        self.func = func
        self.count = 0
        self._lock = threading.Lock()
        functools.update_wrapper(self, func)

    def __call__(self, *args, **kwargs):
        with self._lock:
            self.count += 1
            current_count = self.count
        print(f"[ThreadSafe] 函数 {self.func.__name__} 已被调用 {current_count} 次")
        return self.func(*args, **kwargs)
```

### 4.2 隔离线程状态（threading.local）
如果是要实现一个在线程间互相独立的上下文（例如，记录每个线程中该函数被调用的次数，或者缓存每个线程特有的数据），应使用 `threading.local`：

```python
import threading
import functools

class ThreadLocalCounter:
    def __init__(self, func):
        self.func = func
        self._local = threading.local()
        functools.update_wrapper(self, func)

    def __call__(self, *args, **kwargs):
        # 为每个线程初始化独立的计数器
        if not hasattr(self._local, 'count'):
            self._local.count = 0
        self._local.count += 1
        print(f"[Thread-{threading.get_ident()}] 调用次数: {self._local.count}")
        return self.func(*args, **kwargs)
```

掌握了类装饰器和描述符的融合，我们可以彻底消除方法绑定的隐患。下一章，我们将突破局限，研究如何精细保留元数据，并设计更加复杂的动态代理与拦截装饰器。
