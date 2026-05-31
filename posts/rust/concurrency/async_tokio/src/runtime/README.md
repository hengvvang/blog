# 运行时核心 (Runtime Core)

异步运行时是 Rust 异步编程生态的核心基石。与 Go 或 Erlang 等在语言编译器与运行时深度绑定、使用基于 Push（推送式）的 runtime-managed 协程模型不同，Rust 选择了基于 Poll（拉取式）的惰性 Future 状态机模型。这种设计将“如何调度任务”与“如何监听事件”的权力完全交给了第三方运行时。

本部分将深入探讨 Tokio 运行时的核心组件与底层机制，主要涵盖以下两大核心主题：

1. **Tokio 运行时架构与事件驱动机制**：
   - 探索运行时内核的层次结构：从最底层的驱动层（Drivers，包括基于 MIO 的 I/O 驱动和分级时间轮 Timer 驱动），到中间的调度层（Scheduler），再到最上层的 Spawner 接口。
   - 剖析 Reactor-Executor 模式在 Rust 中的闭环：网卡数据包到达如何转化为 CPU 中断，最终如何通过 `Waker` 唤醒被挂起的任务。

2. **异步任务生命周期与工作窃取（Work-Stealing）调度算法**：
   - 解构 `tokio::spawn` 产生的异步 Task 在内存中的表示。
   - 深入无锁局部环形队列（Local Queue）与全局队列（Global Queue）的设计，详尽推演多线程并发调度下的工作窃取算法。
   - 分析 LIFO 快速缓存槽（LIFO Slot）和协作式任务预算（Task Budget）机制如何平抑调度延迟，防止饥饿并实现极限的 CPU 缓存局部性。

---

## 异步运行时范式：Readiness vs. Completion

在系统级异步 I/O 编程中，主要存在两种范式：

* **基于就绪通知（Readiness-based）**：以 Linux `epoll`、macOS `kqueue` 为代表。当某个 I/O 通道可读或可写时，内核通知应用程序，由应用程序负责发起实际的 `read` 或 `write` 系统调用。Tokio 的 I/O 驱动层（基于 MIO 封装）就是这种范式的典型实现。
* **基于完成通知（Completion-based）**：以 Windows `IOCP` 和 Linux 新一代 `io_uring` 为代表。应用程序向内核提交一个 I/O 请求及一块缓冲区，内核在后台默默完成读写操作，完成后通知应用程序。在这种模型中，缓冲区的所有权在 I/O 挂起期间必须保持稳定。

Tokio 通过强大的抽象能力，将这两种截然不同的底层系统 API 统一融入到其 `Driver` 与 `Future` 的 Poll 契约中，为 Rust 开发者提供了一致且高性能的并发编程体验。

接下来，我们将展开第一章，深入剖析 Tokio 运行时的底层拓扑与事件循环架构。
