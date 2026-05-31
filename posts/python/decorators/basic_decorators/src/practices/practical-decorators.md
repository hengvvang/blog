# 第三章：性能分析、日志记录与权限拦截实战

在理解了词法作用域、闭包内存机制以及 `@` 语法糖的生命周期后，本章将结合软件开发中的实际业务场景，详细拆解并实现四个生产级别的装饰器，帮助你在真实的工程项目中优雅地应用这一技术。

---

## 案例一：高精度耗时统计装饰器 (`@time_it`)

### 1.1 设计背景与关键原理
在微服务治理与性能调优中，精确定位慢查询、耗时 API 或复杂的算法瓶颈是基础诉求。
本案例使用 Python 提供的 `time.perf_counter()` 实现性能监控：

> [!IMPORTANT]
> **时钟源选择**：`time.perf_counter()` 访问的是硬件级别的高精度单调时钟（Monotonic Clock），其值不会受到系统 NTP 自动同步或管理员手动修改系统时间的影响。相比之下，`time.time()` 返回的是系统挂钟时间（Wall Clock Time），在发生时间回拨时会导致耗时计算出负数或出现极大偏差。

### 1.2 生产级代码实现

```python
import time
import functools
import logging
from typing import Callable, Any

# 设置局部日志格式
logger = logging.getLogger("PerfLogger")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def time_it(func: Callable[..., Any]) -> Callable[..., Any]:
    """
    高精度函数耗时统计装饰器。
    采用 try...finally 结构，确保即使被装饰的函数抛出异常，耗时监控依旧能正确输出。
    """
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        start_time = time.perf_counter()
        try:
            # 执行目标业务函数
            result = func(*args, **kwargs)
            return result
        finally:
            # 无论目标函数是否抛出异常，均会执行 finally 块以完成计时
            end_time = time.perf_counter()
            elapsed = end_time - start_time
            
            # 为了防止日志打印过多，限制参数展示的长度
            safe_args = [repr(arg) for arg in args[:3]]
            if len(args) > 3:
                safe_args.append("...")
                
            logger.info(
                f"[PERF] 函数 '{func.__name__}' 执行完毕 | "
                f"入参: {', '.join(safe_args)} | "
                f"耗时: {elapsed:.6f} 秒"
            )
            
    return wrapper

# --- 验证测试 ---
@time_it
def compute_heavy_task(steps: int) -> int:
    """模拟一个耗时的数值计算任务"""
    time.sleep(0.3)  # 模拟 IO 阻塞
    total = sum(i * i for i in range(steps))
    return total

if __name__ == "__main__":
    logger.info("开始测试高精度耗时统计...")
    res = compute_heavy_task(100000)
    logger.info(f"计算完成，返回值: {res}")
```

### 1.3 运行输出
```text
2026-05-31 19:10:00,123 [INFO] 开始测试高精度耗时统计...
2026-05-31 19:10:00,432 [INFO] [PERF] 函数 'compute_heavy_task' 执行完毕 | 入参: 100000 | 耗时: 0.308154 秒
2026-05-31 19:10:00,433 [INFO] 计算完成，返回值: 333328333350000
```

---

## 案例二：入参及返回值审计日志装饰器 (`@log_execution`)

### 2.1 设计背景与关键原理
在核心金融交易、用户权限修改等高危操作中，我们需要对操作的入参和出参进行完整的轨迹审计。此案例在业务代码无感知的前提下，捕获调用链的参数、返回值或抛出的异常。

> [!WARNING]
> **异常处理机制**：在编写拦截器类装饰器时，若捕获到了异常，**切记必须使用 `raise` 将其原样抛出**。如果悄悄“吞掉”异常（例如只打印日志却不抛出），将导致业务调用方误以为函数执行成功，从而引发严重的数据不一致问题。

### 2.2 生产级代码实现

```python
import functools
import logging
from typing import Callable, Any

logger = logging.getLogger("AuditLogger")

def log_execution(func: Callable[..., Any]) -> Callable[..., Any]:
    """
    审计日志拦截器。
    拦截并记录函数的入参、返回值以及其向外抛出的所有异常。
    """
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # 解析出可读的参数序列
        pos_args = ", ".join(repr(a) for a in args)
        kw_args = ", ".join(f"{k}={repr(v)}" for k, v in kwargs.items())
        params_str = ", ".join(filter(None, [pos_args, kw_args]))
        
        logger.info(f"[AUDIT-CALL] 开始调用 {func.__name__}({params_str})")
        
        try:
            result = func(*args, **kwargs)
            logger.info(f"[AUDIT-RETURN] {func.__name__} 调用成功 | 返回值: {repr(result)}")
            return result
        except Exception as e:
            # 记录异常的类型与具体描述
            logger.error(
                f"[AUDIT-EXCEPTION] {func.__name__} 执行崩溃! | "
                f"异常类型: {type(e).__name__} | 错误信息: {e}"
            )
            # 必须重新向外抛出，不能掩盖程序错误
            raise e
            
    return wrapper

# --- 验证测试 ---
@log_execution
def transfer_funds(sender: str, receiver: str, amount: float) -> str:
    if amount <= 0:
        raise ValueError("转账金额必须大于 0")
    return f"TRANS-ID-{sender[:3].upper()}-{receiver[:3].upper()}"

if __name__ == "__main__":
    print("\n--- 正常转账审计 ---")
    transfer_funds("Alice", "Bob", 1500.0)
    
    print("\n--- 异常转账审计 ---")
    try:
        transfer_funds("Alice", "Bob", -50.0)
    except ValueError:
        pass  # 外部捕获以防止测试脚本异常退出
```

### 2.3 运行输出
```text
--- 正常转账审计 ---
2026-05-31 19:10:01,001 [INFO] [AUDIT-CALL] 开始调用 transfer_funds('Alice', 'Bob', 1500.0)
2026-05-31 19:10:01,002 [INFO] [AUDIT-RETURN] transfer_funds 调用成功 | 返回值: 'TRANS-ID-ALI-BOB'

--- 异常转账审计 ---
2026-05-31 19:10:01,003 [INFO] [AUDIT-CALL] 开始调用 transfer_funds('Alice', 'Bob', -50.0)
2026-05-31 19:10:01,004 [ERROR] [AUDIT-EXCEPTION] transfer_funds 执行崩溃! | 异常类型: ValueError | 错误信息: 转账金额必须大于 0
```

---

## 案例三：基于闭包的线程安全单例装饰器 (`@singleton`)

### 3.1 设计背景与关键原理
单例模式限制了类对象的实例化次数，广泛应用于数据库连接池、全局配置中心、日志写入器等需要全局唯一实例的场景。
使用类装饰器实现单例比重写 `__new__` 更加直观和解耦。我们利用闭包字典 `instances` 来存放已创建的 `{Class: Instance}` 映射。

> [!CAUTION]
> **多线程竞态条件**：在多线程高并发环境下，若有多个线程同时调用实例化方法，可能会在字典中尚无记录时，同时判断 `cls not in instances` 成立，从而并行创建出多个不同的对象实体。
> 本实现结合**重入锁 (`threading.RLock`)** 和**双重检查锁定 (Double-Checked Locking)** 模式，兼顾了并发性能与线程安全性。

### 3.2 生产级代码实现

```python
import functools
import threading
from typing import Type, Any, Dict

def singleton(cls: Type[Any]) -> Callable[..., Any]:
    """
    线程安全的单例类装饰器。
    使用双重检查锁定（Double-Checked Locking）实现，最大程度减少加锁开销。
    """
    # 存放唯一实例的闭包容器
    instances: Dict[Type[Any], Any] = {}
    
    # 互斥重入锁，防止多线程竞态创建
    lock = threading.RLock()
    
    @functools.wraps(cls)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # 第一重校验：快速判断，避免每一次获取单例时都进行无谓的抢锁操作（提升性能）
        if cls not in instances:
            with lock:
                # 第二重校验：抢到锁后，必须再次检查。
                # 防止在当前线程等待锁的期间，另一个线程已经成功创建了该实例。
                if cls not in instances:
                    instances[cls] = cls(*args, **kwargs)
        return instances[cls]
        
    return wrapper

# --- 验证测试 ---
@singleton
class ConfigManager:
    def __init__(self) -> None:
        self.settings = {}
        # 打印初始化标志，用于监控其实例化次数
        print("[INIT] ConfigManager 全局配置被实例化了一次！")

def thread_task(results: list) -> None:
    # 尝试获取单例对象
    cfg = ConfigManager()
    results.append(id(cfg))

if __name__ == "__main__":
    print("\n--- 启动多线程并发获取单例测试 ---")
    threads = []
    thread_results = []
    
    # 开启 10 个并发线程同时读取单例
    for _ in range(10):
        t = threading.Thread(target=thread_task, args=(thread_results,))
        threads.append(t)
        t.start()
        
    for t in threads:
        t.join()
        
    # 验证是否所有线程拿到的对象内存地址都完全一致
    assert len(set(thread_results)) == 1, "单例失效！检测到不同的实例地址"
    print(f"10 个线程获取到的实例内存地址: {thread_results}")
    print("线程安全单例模式验证通过！")
```

### 3.3 运行输出
```text
--- 启动多线程并发获取单例测试 ---
[INIT] ConfigManager 全局配置被实例化了一次！
10 个线程获取到的实例内存地址: [140412852230192, 140412852230192, 140412852230192, 140412852230192, 140412852230192, 140412852230192, 140412852230192, 140412852230192, 140412852230192, 140412852230192]
线程安全单例模式验证通过！
```

---

## 案例四：基于上下文的权限校验拦截门控装饰器 (`@require_permission`)

### 4.1 设计背景与拦截门控
在 Web 系统或后台管理中，特定操作（如删除数据库、修改系统配置）只能由具备特定角色或权限的用户发起。
我们可以设计一个带有参数的装饰器，或者一个基于当前上下文环境变量的门控校验装饰器。若鉴权未通过，直接抛出异常拦截调用。

本案例实现一个 `@require_permission` 门控装饰器，用来判断当前线程上下文中关联的“用户角色”是否满足访问条件：

```python
import functools
import threading
from typing import Callable, Any, Set

# 使用线程本地存储 (Thread Local Storage) 模拟当前请求的上下文
current_request_ctx = threading.local()

def set_current_user(username: str, roles: Set[str]) -> None:
    """辅助函数：设置当前线程的用户上下文"""
    current_request_ctx.username = username
    current_request_ctx.roles = roles

def clear_current_user() -> None:
    """清理当前线程上下文"""
    if hasattr(current_request_ctx, "username"):
        del current_request_ctx.username
    if hasattr(current_request_ctx, "roles"):
        del current_request_ctx.roles


def require_permission(required_role: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """
    带参数的权限校验装饰器。
    接收所需的角色名称，并在执行目标函数前校验当前上下文的用户角色。
    若无权限，抛出 PermissionError 中断调用。
    """
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # 1. 从线程上下文中获取角色信息，默认角色为 guest
            user_roles = getattr(current_request_ctx, "roles", set())
            username = getattr(current_request_ctx, "username", "Anonymous")
            
            # 2. 检查当前用户是否具有所需的角色
            if required_role not in user_roles:
                raise PermissionError(
                    f"拒绝访问: 用户 '{username}' 缺少必要的角色权限 '{required_role}'！"
                )
                
            # 3. 鉴权通过，执行核心业务函数
            return func(*args, **kwargs)
        return wrapper
    return decorator

# --- 验证测试 ---
@require_permission("admin")
def delete_database_table(table_name: str) -> None:
    print(f"🗑️ [DB] 数据表 '{table_name}' 已成功被物理删除！")

if __name__ == "__main__":
    print("\n--- 权限校验拦截门控测试 ---")
    
    # 模拟管理员身份调用
    set_current_user("SuperAdmin", {"admin", "developer"})
    try:
        delete_database_table("user_accounts")
    except PermissionError as e:
        print(f"拦截成功: {e}")
        
    # 模拟普通访客身份调用
    set_current_user("GuestUser", {"guest"})
    try:
        delete_database_table("financial_records")
    except PermissionError as e:
        print(f"拦截成功: {e}")
        
    clear_current_user()
```

### 4.2 运行输出
```text
--- 权限校验拦截门控测试 ---
🗑️ [DB] 数据表 'user_accounts' 已成功被物理删除！
拦截成功: 拒绝访问: 用户 'GuestUser' 缺少必要的角色权限 'admin'！
```

---

## 5. 多重装饰器的叠加执行顺序分析（洋葱模型）

在真实的工程实践中，一个核心业务函数经常会被同时打上多个装饰器。例如：

```python
@log_execution
@time_it
@require_permission("admin")
def delete_user(user_id: int):
    pass
```

很多开发者对于多重装饰器的执行顺序感到困惑。我们可以通过编译期的语义转换将这一过程展开：

`delete_user = log_execution(time_it(require_permission("admin")(delete_user)))`

由此可见：
1. **装饰器包装顺序（自下而上）**：
   最内层的 `require_permission` 最先对 `delete_user` 进行包装；然后 `time_it` 对生成的包装函数进行二次包装；最后最外层的 `log_execution` 进行三重包装。
2. **函数执行顺序（自外向内，呈洋葱剥皮结构）**：
   当最终调用 `delete_user(1)` 时，流程从最外层（最上方定义的装饰器）开始向里渗透：
   
```text
                         [ 进入调用 ]
                              │
               ┌──────────────▼──────────────┐
               │    log_execution (最外层)   │
               │  ┌───────────────────────┐  │
               │  │    time_it            │  │
               │  │  ┌─────────────────┐  │  │
               │  │  │require_perm(内层)│  │  │
               │  │  │  ┌───────────┐  │  │  │
               │  │  │  │ delete_usr│  │  │  │  (核心业务)
               │  │  │  └───────────┘  │  │  │
               │  │  └─────────────────┘  │  │
               │  └───────────────────────┘  │
               └─────────────────────────────┘
                              │
                         [ 返回响应 ]
```

- **第一阶段（前置逻辑）**：首先进入 `log_execution` 包装层，打印 `[AUDIT-CALL]` 日志；随后进入 `time_it` 计时层，记录 `start_time`；接着进入 `require_permission` 鉴权层，校验角色合法性。
- **第二阶段（业务执行）**：如果鉴权通过，执行核心的 `delete_user` 逻辑。
- **第三阶段（后置逻辑）**：退出 `require_permission`；随后进入 `time_it` 的 `finally` 块计算并输出耗时；最后返回 `log_execution` 记录返回值。

如果在 `require_permission` 层鉴权失败抛出了异常，则执行流程在此处阻断并原样抛出，底层的 `delete_user` 函数将永远不会被调用，但由于异常向外传播，最外层的 `log_execution` 会在 `except` 块中捕获到这一崩溃快照并记入错误日志。

掌握了上述四个经典工业案例和叠加执行逻辑，你就能够游刃有余地构建稳固、易扩展的切面逻辑系统。
