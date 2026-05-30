# asyncio 核心 API 详解与任务调度

在第一章中，我们了解了协程如何利用 `selectors` 与底层多路复用实现非阻塞控制。在实际开发中，我们不需要手动编写事件循环和任务驱动器，Python 的 `asyncio` 标准库为我们提供了完善的实现。

本章将从概念底层出发，解构 `asyncio` 中的三大核心组件，并逐一分析高频核心 API 的运行生命周期与最佳实践。

---

## 1. 核心基石：Coroutines, Futures 与 Tasks

在 `asyncio` 中，编写异步程序离不开这三个概念。它们构成了一个层层递进的抽象体系：

```
+-------------------------------------------------------------+
|                            Task                             |
|  (继承自 Future，负责在 Event Loop 中真正驱动协程，管理状态)     |
+-------------------------------------------------------------+
                              | 包装 (Wrap)
                              v
+-------------------------------------------------------------+
|                          Coroutine                          |
|  (async def 定义的原生协程，仅是执行逻辑的惰性包装，不具备自驱动能力) |
+-------------------------------------------------------------+
                              | 依赖 (Await)
                              v
+-------------------------------------------------------------+
|                           Future                            |
|  (底层异步状态容器：PENDING -> CANCELLED / FINISHED)         |
+-------------------------------------------------------------+
```

### 1.1 Coroutine (协程对象)

当你通过 `async def func(): pass` 定义一个函数并调用它时，你得到的是一个 **Coroutine 对象**。
*   **特性**：它是**惰性（Lazy）**的。仅仅调用 `func()` 不会执行函数内部的任何代码。
*   **局限**：协程对象本身不知道如何与操作系统的事件选择器交互，它必须被包裹进一个 `Task` 中，或者被另一个已经在运行的协程通过 `await` 驱动。

### 1.2 asyncio.Future (未来对象)

`Future` 是一个更偏向底层设计模式的对象。它代表一个**尚未完成但预计会在未来产生结果的异步操作**。
*   **状态机**：`Future` 内部维护了一个状态变量，其生命周期跃迁如下：
    *   `PENDING`（等待中）
    *   `CANCELLED`（已取消）
    *   `FINISHED`（已完成）
*   **回调机制**：你可以通过 `fut.add_done_callback(callback)` 向其注册回调函数。一旦外部某些底层事件（如网卡接收完数据）触发 `fut.set_result(value)`，该 `Future` 变为 `FINISHED` 状态，并立即触发所有注册的回调。
*   **地位**：它是连接“低级异步回调事件”与“高级协程”的桥梁。

### 1.3 asyncio.Task (任务对象)

`Task` 继承自 `Future`，是 `Future` 的子类。
*   **核心功能**：它用来**在事件循环中并发运行协程**。
*   **机制**：当用 `asyncio.create_task(coro)` 将一个协程包装为 Task 时，该 Task 会被立即注册到当前事件循环的就绪队列中。事件循环在下一轮迭代中会自动调用 Task 的 `step()` 方法（类似于我们在第一章手写的内容），通过发送 `None` 启动协程。
*   **生命周期**：Task 不仅继承了 Future 的状态控制，还负责监控协程的执行。当协程运行完毕抛出 `StopIteration(value)` 时，Task 会捕获该异常并执行 `self.set_result(value)`，将 Task 标记为 `FINISHED`。

---

## 2. 核心 API 生命周期与最佳实践

### 2.1 异步程序入口：`asyncio.run()`

在 Python 3.7+ 中，`asyncio.run(coro)` 是启动异步应用程序的标准入口。它在底层执行了以下复杂的生命周期管理：
1.  检测当前线程中是否已经有正在运行的事件循环。如果有，抛出 `RuntimeError`。
2.  创建一个新的事件循环实例（默认为 `SelectorEventLoop` 或 `ProactorEventLoop`）。
3.  将传入的协程包装为 Task 并运行，直到该 Task 完成。
4.  **优雅收尾（Cleanup）**：当主协程运行完毕，`asyncio.run` 会自动获取事件循环中所有尚未完成的 Tasks（通过 `asyncio.all_tasks()`），向它们发送取消请求（`task.cancel()`），并通过 `loop.run_until_complete()` 等待它们响应取消。
5.  关闭线程池执行器（Executor），最后关闭并销毁事件循环。

> [!IMPORTANT]
> **最佳实践**：不要在同一个线程中多次频繁调用 `asyncio.run()`，也不要在已经运行的协程中调用它。它应当只作为整个进程（或主线程）的**唯一控制起点**。

### 2.2 任务创建：`create_task` vs `ensure_future`

在代码中，如果我们希望并发启动一个协程，我们需要将其转化为 Task。常见的做法有三种：

```python
import asyncio

async def sample_coro():
    await asyncio.sleep(1)
    return "Done"

async def main():
    # 方式一：推荐，最符合现代化标准
    task1 = asyncio.create_task(sample_coro())

    # 方式二：低级 API，当需要对特定事件循环实例进行操作时使用
    loop = asyncio.get_running_loop()
    task2 = loop.create_task(sample_coro())

    # 方式三：兼容性封装
    task3 = asyncio.ensure_future(sample_coro())
```

*   **`asyncio.create_task(coro)`**：Python 3.7 引入的标准 API。它在内部调用 `asyncio.get_running_loop().create_task(coro)`。如果当前线程没有运行的事件循环，会直接抛出异常。
*   **`loop.create_task(coro)`**：针对指定事件循环实例创建任务。
*   **`asyncio.ensure_future(obj)`**：这是一个历史兼容性极强的辅助函数。它不仅能接收 Coroutine，还能接收 Future。如果传入的已经是 `Future` 或 `Task`，它会原样返回；如果是 `Coroutine`，则会在当前循环中将其包装为 `Task` 返回。
*   **选择建议**：在协程内部，一律优先使用现代化的 `asyncio.create_task(coro)`。

---

## 3. 并发组合器深度对比：gather vs wait vs as_completed

当有多个 Task 需要并发运行时，`asyncio` 提供了三种主流的组合控制手段。它们的行为模式、异常处理和返回值结构大相径庭。

### 3.1 `asyncio.gather(*aws, return_exceptions=False)`

*   **特点**：以**位置参数**形式接收多个可等待对象。并发驱动它们，并返回一个包含所有结果的**列表**，结果顺序与传入参数的顺序完全一致（与实际完成的先后顺序无关）。
*   **`return_exceptions` 行为**：
    *   `False`（默认值）：如果其中某一个任务抛出了异常，`gather` 会**立即向上抛出该异常**，但**并不会取消**其他正在运行的任务。其他任务依然会在后台继续运行直至结束。
    *   `True`：任务抛出的异常不会阻碍流程，而是会被视为一种“执行结果”，被放入返回的结果列表中。

```python
import asyncio

async def worker(db_id, delay, fail=False):
    await asyncio.sleep(delay)
    if fail:
        raise ValueError(f"Worker {db_id} failed!")
    return f"Result {db_id}"

async def main():
    # 场景一：默认 return_exceptions=False
    try:
        results = await asyncio.gather(
            worker(1, 1),
            worker(2, 2, fail=True),
            worker(3, 3)
        )
    except ValueError as e:
        print(f"捕获到异常: {e}")  # 2秒时捕获异常，但 worker 3 依然在后台继续运行
        
    # 场景二：设置 return_exceptions=True
    results_safe = await asyncio.gather(
        worker(1, 1),
        worker(2, 1, fail=True),
        worker(3, 1),
        return_exceptions=True
    )
    # 输出: ['Result 1', ValueError('Worker 2 failed!'), 'Result 3']
    print(f"安全获取的所有结果: {results_safe}")

asyncio.run(main())
```

### 3.2 `asyncio.wait(aws, timeout=None, return_when=ALL_COMPLETED)`

*   **特点**：接收一个 Task 集合（注意：必须是 `Task`/`Future` 集合，如果是裸协程会自动报 Deprecation 警告，建议手动 `create_task`）。
*   **返回值**：返回一个二元元组 `(done_set, pending_set)`，其中包含了已完成的 Tasks 和仍在运行的 Tasks。
*   **`return_when` 控制策略**：
    *   `ALL_COMPLETED`（默认）：所有任务都完成后返回。
    *   `FIRST_COMPLETED`：任意一个任务完成（或失败）后，立即返回。
    *   `FIRST_EXCEPTION`：任意一个任务抛出异常时立即返回；如果无异常，则等同于 `ALL_COMPLETED`。

```python
async def main():
    t1 = asyncio.create_task(worker(1, 1))
    t2 = asyncio.create_task(worker(2, 3))
    t3 = asyncio.create_task(worker(3, 2))
    
    # 监控第一个完成的任务
    done, pending = await asyncio.wait(
        {t1, t2, t3}, 
        return_when=asyncio.FIRST_COMPLETED
    )
    
    print(f"已完成的任务数: {len(done)}")     # 1
    print(f"仍在运行的任务数: {len(pending)}") # 2
    
    # 获取已完成任务的结果
    for task in done:
        print(f"已完成结果: {task.result()}")
        
    # 如果不想让 pending 任务继续跑，必须手动取消它们
    for task in pending:
        task.cancel()
```

### 3.3 `asyncio.as_completed(aws, timeout=None)`

*   **特点**：接收一个可等待对象列表，返回一个**迭代器**。每次对该迭代器进行迭代或 `await`，都会返回**最先完成**的那个任务的结果。
*   **适用场景**：希望在任务流执行过程中“即时处理结果”，例如并发爬取 100 个网页，哪个网页先返回，就先解析哪个网页，避免因等待慢速网页而造成管道空闲。

```python
async def main():
    tasks = [worker(i, 4 - i) for i in range(1, 4)]
    # worker(1, 3秒), worker(2, 2秒), worker(3, 1秒)
    
    for future in asyncio.as_completed(tasks):
        result = await future
        print(f"获取到先完成的结果: {result}")
        # 依次输出: Result 3 (1秒时), Result 2 (2秒时), Result 1 (3秒时)
```

---

## 4. 任务取消机制与异常屏障

异步系统的生命周期管理往往比同步系统更复杂，核心在于**优雅取消**和**全局异常捕获**。

### 4.1 任务取消机制与 `CancelledError`

当对一个正在运行的 `Task` 调用 `task.cancel()` 时，事件循环会在下一轮迭代中向该协程内部抛出一个 `asyncio.CancelledError` 异常。

*   协程可以选择在内部通过 `try...except asyncio.CancelledError` 捕获该异常，执行清理逻辑（如关闭连接、回滚事务）。
*   在捕获 `CancelledError` 后，如果你执行了清理工作，**必须重新抛出该异常**，或者直接让协程自然退出，否则会导致 Task 无法正常终止。

```python
async def cancel_demo():
    try:
        print("工作启动，准备进入循环等待...")
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        print("捕获到取消请求！开始执行资源清理...")
        await asyncio.sleep(0.5) # 模拟异步清理资源
        print("清理完成。")
        raise # 必须重新抛出以使取消生效
    finally:
        print("这里的 cleanup 逻辑无论取消与否都会执行")

async def main():
    task = asyncio.create_task(cancel_demo())
    await asyncio.sleep(1)
    print("决定取消任务...")
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("主协程感知到任务已成功取消。")

asyncio.run(main())
```

### 4.2 使用 `asyncio.shield()` 保护关键任务

在一些业务场景下，某个异步操作极其关键（例如写数据库），不能因为客户端连接断开或外部取消信号而中断。此时可以使用 `asyncio.shield()` 包装该可等待对象：

```python
async def critical_write():
    print("开始写入核心数据库，不可中断...")
    await asyncio.sleep(3)
    print("核心数据写入完成！")
    return True

async def main():
    # 使用 shield 保护
    shielded_task = asyncio.shield(critical_write())
    
    # 假设外层因为超时或取消信号，取消了 shielded_task
    await asyncio.sleep(1)
    print("外部尝试取消 shielded_task...")
    shielded_task.cancel()
    
    try:
        await shielded_task
    except asyncio.CancelledError:
        print("外层调用捕获到了 CancelledError")
        
    # 等待一会查看后台日志
    await asyncio.sleep(3)
    # 虽然 shielded_task.cancel() 被调用，且外层抛出了 CancelledError，
    # 但底层的 critical_write() 依然会完整运行完毕，不受影响。
```

### 4.3 全局未捕获异常的防线：Exception Handler

如果一个 Task 抛出了异常，而我们既没有 `await` 它，也没有对其调用 `.result()`，那么这个异常就会变成“未捕获的后台垃圾”，通常会在 Task 被垃圾回收时输出一条类似 `Task exception was never retrieved` 的警告。

为了全局捕获这种后台遗漏异常，我们可以为事件循环设置一个全局异常处理器：

```python
import sys

def global_exception_handler(loop, context):
    # context 包含异常信息、发生异常的 Task/Future 实例以及错误消息
    exception = context.get("exception")
    message = context.get("message")
    task = context.get("future") # Task 继承自 Future
    
    print(f"!!! 全局捕获异常 !!!")
    print(f"描述信息: {message}")
    if exception:
        print(f"异常类型: {type(exception).__name__}, 内容: {exception}")
    if task:
        print(f"关联任务: {task}")
    # 在生产环境下，通常在此处接入 Sentry 或输出日志

async def buggy_task():
    await asyncio.sleep(1)
    raise RuntimeError("后台发生灾难性故障")

async def main():
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(global_exception_handler)
    
    # 启动任务，但故意不 await 它，也不获取结果
    asyncio.create_task(buggy_task())
    await asyncio.sleep(2)

asyncio.run(main())
```

通过这一层全局防线，可以有效避免生产环境下由于后台协程崩溃无声无息而导致的内存泄漏或数据不一致问题。
