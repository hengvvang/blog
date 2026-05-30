# 从 Generator 到 Native Coroutine 与事件循环底层机制

在深入使用 Python 的 `asyncio` 库之前，理解其底层的协程演进历史与事件循环工作原理是必不可少的。Python 的异步编程并不是一蹴而就的，而是经历了一条从**生成器（Generator）**到**原生协程（Native Coroutine）**的长期演进道路。

---

## 1. 协程的历史演进：从 Generator 到 Native Coroutine

### 1.1 生成器与协同控制流

在传统的计算机体系中，函数调用通过**子例程（Subroutine）**和**调用栈（Call Stack）**实现。子例程是单入单出的：从函数第一行开始执行，遇到 `return` 或执行完毕后退出，局部变量随之销毁。

而**协程（Coroutine）**是一种更灵活的控制流机制，它允许函数在执行过程中**挂起（Yield）**，将控制权交还给调用者，并在稍后从挂起点**恢复（Resume）**执行，同时保留挂起前的所有局部状态。

在 Python 2.2 中，为了实现迭代器模式，引入了 `yield` 关键字，这奠定了 Python 协程的物理基础。包含 `yield` 的函数在调用时不会立即执行，而是返回一个生成器对象（Generator Object）。

```python
def simple_generator():
    print("-> 启动生成器")
    yield 1
    print("-> 恢复执行，准备第二次挂起")
    yield 2
    print("-> 生成器结束")

gen = simple_generator()
# 此时没有任何输出，仅仅创建了生成器对象
print(type(gen))  # <class 'generator'>

# 驱动生成器执行
val1 = next(gen)  # 输出: -> 启动生成器
print(f"接收到的值: {val1}")  # 接收到的值: 1

val2 = next(gen)  # 输出: -> 恢复执行，准备第二次挂起
print(f"接收到的值: {val2}")  # 接收到的值: 2

try:
    next(gen)  # 输出: -> 生成器结束，抛出 StopIteration
except StopIteration:
    print("生成器已迭代完毕")
```

### 1.2 双向数据交互与异常双向传递

PEP 342 (Python 2.5) 极大地扩展了生成器的功能，为其引入了 `.send()`、`.throw()` 和 `.close()` 方法。这使得生成器不仅能向外“产生”数据，还能从外部“接收”数据和异常，从而转变为**双向协同程序**。

*   `g.send(value)`：恢复生成器执行，并将 `value` 作为当前挂起的 `yield` 表达式的返回值。
*   `g.throw(type, value=None, traceback=None)`：在生成器挂起点抛出一个异常。生成器可以捕获该异常进行处理，或者不捕获导致异常向上抛出。
*   `g.close()`：在生成器挂起点抛出 `GeneratorExit` 异常，迫使生成器关闭。

```python
def consumer():
    print("[Consumer] 消费者准备就绪...")
    response = None
    while True:
        # yield 表达式接收外部 send() 传入的数据，并把 response 返回给外部
        received = yield response
        if received is None:
            break
        print(f"[Consumer] 消费了数据: {received}")
        response = f"Ack for {received}"
    print("[Consumer] 消费者关闭")

c = consumer()
next(c)  # 预激（Prime）生成器，使其运行到第一个 yield 处

res1 = c.send("Data-A")  # 输出: [Consumer] 消费了数据: Data-A
print(f"[Producer] 收到回执: {res1}")

res2 = c.send("Data-B")  # 输出: [Consumer] 消费了数据: Data-B
print(f"[Producer] 收到回执: {res2}")

c.close()
```

### 1.3 `yield from` 与委托生成器

在 Python 3.3 中，PEP 380 引入了 `yield from` 语法。在最简单的场景下，`yield from iterable` 是 `for item in iterable: yield item` 的语法糖。然而，它的核心价值在于支持**生成器嵌套调用（Subgenerator Delegation）**。

当在委托生成器（Delegating Generator）中使用 `yield from subgenerator` 时，它会在调用方（Caller）与子生成器（Subgenerator）之间建立一条**直接的双向通道**。

```
+------------+  g.send(val)   +----------------------+                +-----------------+
|   Caller   | -------------> | Delegating Generator | -------------> |  Subgenerator   |
| (调用发)   | <------------- |     (委托生成器)     | <------------- |   (子生成器)    |
+------------+  yield val     +----------------------+   yield val    +-----------------+
```

所有发送给委托生成器的 `send()`、`throw()` 调用都会被自动转发给子生成器；子生成器抛出的异常会被直接暴露给调用方；同时，当子生成器执行完毕（抛出 `StopIteration`）时，其 `value` 属性（即 `return` 的值）会成为 `yield from` 表达式的返回值。

如果不使用 `yield from`，要在 Python 中手动实现完全健壮的异常转发与边界状态恢复，需要写出极其冗长且易错的 `try...except...finally` 样板代码。

### 1.4 Native Coroutine: `async def` 与 `await`

尽管基于生成器的协程能够工作，但它存在严重的语义混淆：一个用于产生数据流的生成器，与一个用于异步任务调度的协程，在语法上没有任何区别。这导致代码可读性变差，且容易引发 Bug（例如误用 `next()` 驱动协程）。

PEP 492 (Python 3.5) 引入了 `async def` 和 `await` 关键字，从语言语法层面正式确立了**原生协程（Native Coroutine）**：

*   **`async def`**：定义的函数在调用时返回一个原生协程对象（Coroutine Object）。原生协程对象的类标志中包含 `CO_COROUTINE`，与普通的 `CO_GENERATOR` 有本质区别。
*   **`await`**：只能在 `async def` 函数内部使用，且后面必须跟一个 **可等待对象（Awaitable）**。可等待对象包括：
    1.  原生协程对象。
    2.  实现了 `__await__` 方法并返回一个迭代器的对象（如 `asyncio.Future`）。
*   原生协程不再支持 `next()` 或 `send()` 的直接外部调用（除非通过其内部的 `__await__` 代理），防止了接口混淆。

---

## 2. 事件循环（Event Loop）深度剖析

`asyncio` 的核心是事件循环。它是单线程内实现并发的调度中枢。

### 2.1 事件循环的核心职责

事件循环本质上是一个无限死循环，执行步骤如下：
1.  **管理定时任务**：维护一个基于最小堆的定时器队列（Timer Heap），计算距离下一个定时任务激活还有多长时间。
2.  **多路复用监听**：调用操作系统底层的 I/O 多路复用系统调用（如 `epoll`），阻塞等待网络套接字（Socket）可读或可写事件，阻塞的超时时间由步骤 1 中最近的定时任务决定。
3.  **分发回调（Dispatch Callbacks）**：当 I/O 事件就绪或定时器超时，事件循环将对应的回调函数加入就绪队列（Ready Queue）。
4.  **执行就绪队列**：依次执行就绪队列中的所有回调，直到队列清空，然后开始下一轮循环。

### 2.2 底层多路复用驱动

为了让单线程在等待 I/O 时不阻塞程序运行，`asyncio` 依赖于 Python 标准库中的 `selectors` 模块。`selectors` 提供了对操作系统底层高性能多路复用 API 的高层封装：
*   **Linux**: `epoll`
*   **macOS / BSD**: `kqueue`
*   **Windows**: `select`（对于 Selector 事件循环）或 `IOCP`（输入输出完成端口，对于 Proactor 事件循环）

当我们在协程中执行 `await reader.read(1024)` 时，底层的非阻塞 Socket 会向 `selectors` 注册一个 `EVENT_READ` 事件，并关联一个唤醒回调。随后，协程向外挂起，将控制权交还给事件循环。事件循环在每一次迭代中通过 `selector.select(timeout)` 询问操作系统哪些 Socket 已经准备好数据。一旦就绪，便执行关联的唤醒回调，进而驱动协程继续向下执行。

### 2.3 协程、Future/Task 与事件循环的交互关系

下面的 Mermaid 序列图展示了一个 Task 在事件循环中从启动、挂起（等待非阻塞网络 I/O）到被重新唤醒的完整生命周期：

```mermaid
sequenceDiagram
    autonumber
    participant Loop as Event Loop (事件循环)
    participant Task as Task (任务)
    participant Coro as Coroutine (协程)
    participant Selector as Selector (多路复用)

    Note over Loop: 1. 事件循环从就绪队列取出 Task 并调度
    Loop->>Task: step() 驱动任务
    Task->>Coro: send(None) 驱动协程执行
    Note over Coro: 2. 协程执行到 await 处，发起非阻塞 I/O
    Coro->>Loop: 注册 I/O 监听与回调
    Loop->>Selector: register(fd, EVENT_READ, callback)
    Coro-->>Task: 产生并返回 Future 对象
    Task-->>Loop: 挂起，控制权交还给事件循环
    
    Note over Loop: 3. 进入下一轮循环，阻塞在 select()
    Loop->>Selector: select(timeout)
    Note over Selector: 外部网络数据到达，fd 可读
    Selector-->>Loop: 返回就绪 fd 列表
    
    Note over Loop: 4. 触发回调，将 Task 重新加入就绪队列
    Loop->>Loop: 执行 callback，设置 Future 结果
    Loop->>Task: step() 再次驱动任务
    Task->>Coro: send(data) 将数据传回协程
    Note over Coro: 5. 协程从 await 处恢复，继续执行
    Coro-->>Task: 协程执行完毕，抛出 StopIteration(result)
    Task->>Loop: 设置 Task 最终状态为 Finished
```

---

## 3. 硬核实战：手写极简的 Toy Event Loop

为了彻底理清生成器协程与 `selectors` 是如何无缝结合实现并发 I/O 的，我们下面脱离 `asyncio` 标准库，使用纯 Python 手写一个功能闭环的单线程事件循环（Toy Event Loop）。

这个迷你事件循环支持：
1.  `Future` 对象包装异步状态与回调链。
2.  `Task` 对象驱动生成器协程。
3.  基于 `selectors.DefaultSelector` 的非阻塞 Socket 异步连接与读取。

### 3.1 完整实现代码

```python
import socket
import selectors
import time

# 全局的多路复用选择器
selector = selectors.DefaultSelector()

class Future:
    """代表一个尚未完成的异步操作结果"""
    def __init__(self):
        self.result = None
        self.done = False
        self._callbacks = []

    def add_done_callback(self, fn):
        """当异步操作完成时，执行此回调"""
        if self.done:
            fn(self)
        else:
            self._callbacks.append(fn)

    def set_result(self, result):
        """设置结果，并触发所有绑定的回调"""
        self.result = result
        self.done = True
        for fn in self._callbacks:
            fn(self)


class Task:
    """负责驱动生成器协程的执行实体"""
    def __init__(self, coro):
        self.coro = coro
        # 启动协程（发送 None 预激）
        self.step()

    def step(self, future=None):
        try:
            if future is None:
                # 首次运行，向协程发送 None
                next_future = self.coro.send(None)
            else:
                # 被 Future 唤醒，将 Future 的执行结果发回协程挂起点
                next_future = self.coro.send(future.result)
        except StopIteration:
            # 协程执行完毕
            return
        
        # 协程 yield 出来了一个 Future 对象，我们需要在它 ready 时重新 step 本任务
        next_future.add_done_callback(self.step)


def async_connect(sock, address):
    """异步连接套接字的协程辅助函数"""
    fut = Future()
    
    # 尝试非阻塞连接
    try:
        sock.connect(address)
    except BlockingIOError:
        # 此时连接尚未建立，属于正常现象，等待可写事件
        pass

    def on_writable():
        # 连接成功或失败，注销可写监听
        selector.unregister(sock.fileno())
        fut.set_result(None)  # 唤醒挂起的协程

    # 监听 Socket 的可写事件（表示连接已成功建立）
    selector.register(sock.fileno(), selectors.EVENT_WRITE, on_writable)
    return fut


def async_read(sock, num_bytes):
    """异步从套接字读取数据的协程辅助函数"""
    fut = Future()

    def on_readable():
        # 数据已到达，注销可读监听
        selector.unregister(sock.fileno())
        try:
            data = sock.recv(num_bytes)
            fut.set_result(data)
        except Exception as e:
            fut.set_result(e)

    # 监听 Socket 的可读事件（表示数据已到达缓冲区）
    selector.register(sock.fileno(), selectors.EVENT_READ, on_readable)
    return fut


# 定义一个协程模拟网络请求
def fetch_url(host, port, path):
    print(f"[Coro] 开始请求 {host}:{port}{path}")
    
    # 创建非阻塞套接字
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setblocking(False)

    # 1. 异步连接
    yield from async_connect(sock, (host, port))
    print(f"[Coro] 成功连接至 {host}")

    # 发送 HTTP 请求报文
    request = f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    sock.send(request.encode("utf-8"))

    # 2. 异步接收响应
    response = b""
    while True:
        chunk = yield from async_read(sock, 4096)
        if not chunk:
            break
        response += chunk
        print(f"[Coro] {host} 接收到数据块，大小: {len(chunk)} 字节")
    
    sock.close()
    print(f"[Coro] {host} 请求完成，总长度: {len(response)} 字节")


# 模拟运行事件循环
def run_event_loop(tasks_count):
    print("\n--- 事件循环启动 ---")
    start_time = time.time()
    
    # 当 selector 中依然有注册的 fd 监听时，循环不止
    while True:
        events = selector.select(timeout=0.5)
        if not events:
            # 没有就绪事件，且没有监听的 fd，则说明所有 I/O 任务已结束
            # 在实际事件循环中，此处还会检查就绪回调队列与定时器
            break
            
        for key, mask in events:
            callback = key.data
            callback()  # 执行绑定的唤醒回调（on_writable 或 on_readable）

    print(f"--- 事件循环结束，总耗时: {time.time() - start_time:.4f} 秒 ---\n")


if __name__ == "__main__":
    # 并发发起两个网络请求，目标为公共 HTTP 测试服务（注意：测试需在联网环境下进行）
    # 为保证稳定，我们使用一个能够快速响应的 IP/Host
    t1 = Task(fetch_url("example.com", 80, "/"))
    t2 = Task(fetch_url("example.com", 80, "/"))

    # 驱动事件循环
    run_event_loop(2)
```

### 3.2 运行机制深度解析

在这个 Toy Event Loop 中：
1.  **没有多线程或多进程**：自始至终只有主线程在运行。
2.  **`yield from async_read(sock, 4096)`**：这行代码将控制权层层传递。`async_read` 创建了一个 `Future`，将套接字的描述符和 `on_readable` 回调注册到 `selector` 中，然后 `yield` 这个 `Future`。`Task.step()` 接收到这个 `Future`，停止调用 `send()`，等待 `Future` 被解析。
3.  **`selector.select()`**：事件循环在主循环中阻塞等待套接字可读。一旦操作系统通知某个套接字可读，`selector` 返回事件，触发 `on_readable`，该函数执行 `fut.set_result(data)`。
4.  **回调唤醒**：`Future.set_result` 会依次调用绑定的回调，即 `Task.step()`。`Task.step` 内部执行 `self.coro.send(future.result)`，将读取到的数据送回协程，协程从挂起点继续向下运行。

这就是 Python `asyncio` 的核心运作机理。通过将阻塞式的 I/O 转换为基于底层多路复用 API 的事件订阅，结合协程的挂起与恢复能力，用极低的单线程成本换取了超高的并发处理性能。
