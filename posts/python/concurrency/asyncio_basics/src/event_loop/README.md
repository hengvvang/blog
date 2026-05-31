# 第一部分：事件循环与协程机制

本部分将深入探讨 Python `asyncio` 的底层基础与运行机理。我们将追溯协程的历史演进，解构事件循环（Event Loop）的核心架构，并详细剖析 `asyncio` 提供的任务调度与生命周期管理 API。

## 章节概览

### [第一章：事件循环与原生协程机制](event-loop-coroutines.md)
本章将带你深入 Python 协程的演进历程与底层实现原理：
- **协程演进史**：从基于 `yield` 的生成器（Generator）、到通过 `.send()`、`.throw()` 和 `.close()` 实现的双向控制流、再到 Python 3.3 中用于生成器嵌套委托的 `yield from` 语法，最后演变为 Python 3.5 引入的原生协程（`async def`/`await`）。
- **原生协程本质**：剖析原生协程在编译期打上的 `CO_COROUTINE` 标志，探讨其与 `CO_GENERATOR` 的底层差异。
- **事件循环架构**：解构基于 I/O 多路复用（Linux `epoll`、macOS `kqueue`、Windows `IOCP` 或 `select`）的单线程事件循环机制。
- **Toy Event Loop 实战**：脱离标准库，手写一个包含 `Future`、`Task` 和非阻塞 Socket 多路复用的极简事件循环，完美闭环异步编程的底层模型。

### [第二章：任务调度 API 与异常处理机制](asyncio-apis.md)
本章将聚焦于 `asyncio` 标准库中的任务调度核心 API 及其实战场景：
- **核心三剑客**：理清 `Coroutine`（协程对象）、`Future`（异步状态容器）与 `Task`（事件循环内驱动协程的实体）的继承与交互关系。
- **程序入口生命周期**：详尽剖析 `asyncio.run()` 在创建循环、运行任务、优雅清理未完成 Task 及关闭执行器等各阶段的运行逻辑。
- **任务并发组合器**：深入对比 `gather`、`wait` 和 `as_completed` 的使用场景、返回值结构、超时控制以及当任务中途抛出异常时的不同行为。
- **取消与异常屏障**：探讨 `task.cancel()` 触发的 `CancelledError` 异常流转与资源清理的最佳实践，以及使用 `asyncio.shield()` 保护关键任务不被取消的技巧。
- **全局异常捕捉**：如何为事件循环配置全局 `exception_handler`，防止后台协程默默崩溃导致资源泄漏。

通过本部分的学习，你将从底层逻辑到高层 API 建立起完整的 Python 异步并发认知体系，能够游刃有余地编写高效、健壮的原生协程代码。
