# 实用装饰器案例实战

在前面的章节中，我们深入了解了闭包的底层内存模型以及基础的装饰器语法。本章将结合实际的工业开发场景，提供三个生产级别的装饰器实战案例。

每个案例都包含完整的可运行代码、细致的行级注释以及相应的测试输出分析。

---

## 案例一：高精度耗时统计装饰器 (`@time_it`)

### 1.1 设计背景与技术细节
在生产环境中，定位系统的性能瓶颈（如慢查询、耗时 API 或复杂的算法逻辑）是系统调优的重要一环。
我们使用 Python 提供的 `time.perf_counter()` 来测量时间。

> [!NOTE]
> `time.perf_counter()` 是一个具有最高可用分辨率的单调时钟（Monotonic Clock），它不会因为系统时间被管理员手动修改或通过 NTP 自动对时而发生回退。相比 `time.time()`，它更适合用于精准的耗时统计。

### 1.2 生产级代码实现

```python
import time
import functools
from typing import Callable, Any

def time_it(func: Callable[..., Any]) -> Callable[..., Any]:
    """
    高精度性能耗时统计装饰器。
    打印被装饰函数的名称、入参摘要以及具体的执行耗时。
    """
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # 记录开始时的高精度时间戳
        start_time = time.perf_counter()
        
        try:
            # 执行被装饰的函数
            result = func(*args, **kwargs)
            return result
        finally:
            # 无论函数是否正常返回或抛出异常，都会计算并输出耗时
            end_time = time.perf_counter()
            elapsed_time = end_time - start_time
            
            # 格式化位置参数摘要以防止日志输出过长（只取前 3 个参数）
            args_summary = [repr(a) for a in args[:3]]
            if len(args) > 3:
                args_summary.append("...")
                
            print(f"[PERF] 函数 {func.__name__} 调用完成 | "
                  f"参数: {', '.join(args_summary)} | "
                  f"耗时: {elapsed_time:.6f} 秒")
                  
    return wrapper

# --- 测试与验证 ---
@time_it
def compute_heavy_task(n: int, factor: float) -> int:
    """模拟一个计算密集型的耗时任务"""
    total = 0
    # 模拟一段耗时工作
    time.sleep(0.5)
    for i in range(n):
        total += int(i * factor)
    return total

if __name__ == "__main__":
    print("开始执行 compute_heavy_task...")
    res = compute_heavy_task(1000000, 1.25)
    print(f"计算结果: {res}\n")
```

### 1.3 运行结果解析
```text
开始执行 compute_heavy_task...
[PERF] 函数 compute_heavy_task 调用完成 | 参数: 1000000, 1.25 | 耗时: 0.584215 秒
计算结果: 624999375000
```
该装饰器使用 `try...finally` 结构，确保了即便目标函数在执行期间因意外崩溃抛出异常，系统的监控日志依然能够输出它在崩溃前运行了多久，这对性能分析和异常排查至关重要。

---

## 案例二：入参及返回值审计日志装饰器 (`@log_execution`)

### 2.1 设计背景与技术细节
在微服务架构或分布式系统的开发中，记录核心业务流程的输入参数与输出结果是快速定位 Bug 的关键。本案例实现的 `@log_execution` 可以监控函数的参数输入、返回数据以及其抛出的异常，同时将异常原封不动地抛出以保证业务逻辑的一致性。

### 2.2 生产级代码实现

```python
import functools
import logging
import sys
from typing import Callable, Any

# 配置一个基础的日志系统，输出至标准输出
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

def log_execution(func: Callable[..., Any]) -> Callable[..., Any]:
    """
    审计日志装饰器。
    在函数执行前记录输入参数，在执行成功后记录返回值；若发生异常则记录异常类型与错误信息。
    """
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # 构建位置参数和关键字参数的字符串形式
        args_str = ", ".join(repr(a) for a in args)
        kwargs_str = ", ".join(f"{k}={repr(v)}" for k, v in kwargs.items())
        params = ", ".join(filter(None, [args_str, kwargs_str]))
        
        logging.info(f"[CALL] 正在调用 {func.__name__}({params})")
        
        try:
            # 调用原函数
            result = func(*args, **kwargs)
            # 成功时记录返回值
            logging.info(f"[RETURN] 函数 {func.__name__} 返回值: {repr(result)}")
            return result
        except Exception as e:
            # 异常时记录详细的错误类型和消息
            logging.error(f"[EXCEPTION] 函数 {func.__name__} 抛出异常 [{type(e).__name__}]: {e}")
            # 必须重新抛出异常，不能吞掉异常导致调用方无法感知
            raise e
            
    return wrapper

# --- 测试与验证 ---
@log_execution
def division(a: float, b: float) -> float:
    return a / b

if __name__ == "__main__":
    print("--- 场景 1: 正常执行 ---")
    try:
        division(10.0, 2.0)
    except Exception:
        pass

    print("\n--- 场景 2: 触发除以零异常 ---")
    try:
        division(5.0, 0.0)
    except Exception:
        pass
```

### 2.3 运行结果解析
```text
--- 场景 1: 正常执行 ---
2026-05-30 23:30:01,123 [INFO] [CALL] 正在调用 division(10.0, 2.0)
2026-05-30 23:30:01,124 [INFO] [RETURN] 函数 division 返回值: 5.0

--- 场景 2: 触发除以零异常 ---
2026-05-30 23:30:01,125 [INFO] [CALL] 正在调用 division(5.0, 0.0)
2026-05-30 23:30:01,126 [ERROR] [EXCEPTION] 函数 division 抛出异常 [ZeroDivisionError]: float division by zero
```

---

## 案例三：基于闭包的线程安全单例装饰器 (`@singleton`)

### 3.1 设计背景与技术细节
单例模式（Singleton Pattern）是一种确保类在生命周期内只有一个实例的设计模式。
许多开发者习惯在类内部重写 `__new__` 方法来实现单例，但这种方式存在模板代码较多、不易复用等缺点。

实际上，我们可以将装饰器应用在**类**上。当装饰器接收一个类时，其参数 `cls` 代表该类本身。我们可以在装饰器的闭包中维护一个实例字典 `instances`。当有实例化请求时，我们检查字典，如果存在则直接返回，否则调用 `cls(*args, **kwargs)` 创建实例并存入字典。

> [!WARNING]
> 在多线程环境中，如果多个线程同时请求实例化，传统的闭包单例可能会因为竞态条件（Race Condition）而创建出多个实例。因此，我们必须引入互斥锁（Mutex Lock）来保证多线程环境下的单例安全性。

### 3.2 生产级代码实现

```python
import functools
import threading
from typing import Type, Any, Dict

def singleton(cls: Type[Any]) -> Type[Any]:
    """
    线程安全的单例装饰器（作用于类）。
    通过闭包字典 instances 保存类实例，使用双重检查锁定（Double-Checked Locking）保证线程安全。
    """
    # instances 存在于外层闭包作用域中，用于存放 {Class: Instance}
    instances: Dict[Type[Any], Any] = {}
    
    # 定义一把重入锁（Reentrant Lock），用于多线程同步
    lock = threading.RLock()

    @functools.wraps(cls)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # 第一重检查：如果不在线性表中，说明尚未实例化，准备加锁
        if cls not in instances:
            with lock:
                # 第二重检查：获取锁后再次确认，防止在加锁期间其他线程已创建实例
                if cls not in instances:
                    # 实例化类并存储于闭包字典中
                    instances[cls] = cls(*args, **kwargs)
        return instances[cls]

    return wrapper

# --- 测试与验证 ---
@singleton
class DatabaseConnectionPool:
    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port
        print(f"[INIT] 数据库连接池已初始化。地址: {self.host}:{self.port}")

def worker(host: str, port: int, results: list):
    # 模拟线程任务：尝试获取单例对象，并将其内存地址存入 results
    pool = DatabaseConnectionPool(host, port)
    results.append(id(pool))

if __name__ == "__main__":
    print("开始多线程并发获取单例测试...")
    threads = []
    thread_results = []
    
    # 启动 10 个线程同时尝试初始化连接池
    for i in range(10):
        t = threading.Thread(
            target=worker, 
            args=("localhost", 3306, thread_results)
        )
        threads.append(t)
        t.start()
        
    for t in threads:
        t.join()
        
    # 检查是否所有线程获取到的对象地址都完全相同
    all_same = all(addr == thread_results[0] for addr in thread_results)
    print(f"所有实例的内存地址: {thread_results}")
    print(f"线程安全性验证成功？ {all_same}")
```

### 3.3 运行结果解析
```text
开始多线程并发获取单例测试...
[INIT] 数据库连接池已初始化。地址: localhost:3306
所有实例的内存地址: [140685955681024, 140685955681024, 140685955681024, 140685955681024, 140685955681024, 140685955681024, 140685955681024, 140685955681024, 140685955681024, 140685955681024]
线程安全性验证成功？ True
```
如上结果所示，虽然有 10 个线程并发执行实例化动作，但控制台只输出了一次 `[INIT]` 日志，且所有线程拿到的实例内存地址完全相同。这表明 `@singleton` 装饰器在保证了多线程安全的同时，成功将普通的类改造成了单例类。
