---
title: "Python Asyncio 异步协程并发编程实战"
publishTime: "2026-05-24 16:20"
author: "hengvvang"
---
# Python Asyncio 异步协程并发编程实战

在处理高并发 I/O 密集型任务时，传统的线程和进程模型往往会带来高额的内存开销与上下文切换损耗。Python 3.4 引入的 `asyncio` 模块，通过单线程事件循环（Event Loop）与协程协同式调度，为编写超大规模并发网络应用提供了原生支持。

## 协程的基本定义与运行

协程（Coroutine）是通过 `async def` 定义的特殊函数。不同于普通函数，协程在调用时并不会立即执行，而是返回一个协程对象。我们必须通过 `await` 或在事件循环中驱动它执行：

```python
import asyncio

async def say_hello():
    print("开始等待...")
    await asyncio.sleep(1) # 模拟非阻塞 I/O
    print("Hello, Asyncio!")

# 运行协程
asyncio.run(say_hello())
```

## 并发执行多个协程任务

`asyncio.gather` 可以并发运行多个协程，并收集它们的返回值：

```python
import asyncio
import time

async def fetch_data(db_id, delay):
    print(f"数据源 {db_id} 开始查询...")
    await asyncio.sleep(delay)
    print(f"数据源 {db_id} 查询完毕。")
    return f"结果 {db_id}"

async def main():
    start = time.time()
    # 同时并发发起 3 个查询
    results = await asyncio.gather(
        fetch_data(1, 2),
        fetch_data(2, 3),
        fetch_data(3, 1)
    )
    print(f"合并结果: {results}")
    print(f"总耗时: {time.time() - start:.2f} 秒")

asyncio.run(main())
```

在这个例子中，虽然三个查询的延迟加起来有 6 秒，但因为它们是并发执行的，整个程序的总耗时只有延迟最长的那个协程的执行时间（即 3 秒）。

## 避免阻塞事件循环

由于 `asyncio` 是单线程运行的，如果在协程中调用了阻塞性代码（如 `time.sleep()` 或同步的 `requests.get()`），会导致整个事件循环卡死，失去并发的优势。

### 错误示范

```python
async def bad_coroutine():
    time.sleep(5) # 阻塞了整个线程！
```

### 正确解决方案

如果必须运行同步阻塞任务，应将其提交给事件循环的执行器（Executor）中后台运行：

```python
async def good_coroutine():
    loop = asyncio.get_running_loop()
    # 将同步阻塞操作放入线程池中运行
    result = await loop.run_in_executor(None, time.sleep, 5)
```

## 总结

`asyncio` 极大地改变了 Python 开发高并发服务端程序的方式。熟练掌握 `async/await` 关键字与事件循环的工作机制，能帮你轻松开发出稳定、高效的现代 Python 异步应用。
