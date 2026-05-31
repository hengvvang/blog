# Rust Tokio 异步运行时与任务调度

欢迎阅读《Rust Tokio Async Runtime & Scheduling》。本书旨在为你深度剖析 Rust 异步生态的事实标准 —— **Tokio 运行时**的底层设计、工作窃取调度机制、事件驱动引擎以及异步同步原语的核心实现。

---

## 1. 为什么需要这本书？

Rust 的异步编程模型在系统级编程语言中独树一帜。它采用了**基于 Poll（拉取式）**的惰性 Future 状态机模型，而非传统语言（如 Go、Erlang）的基于 Push（推送式）的 runtime-managed 物理协程模型。这种设计虽然带来了极致的性能和零开销抽象的可能性，但也将极大的设计复杂度留给了**运行时（Runtime）**。

在 Rust 的异步世界中，标准库仅提供了底层的异步语义核心（如 `Future` trait、`Pin`、`Context` 和 `Waker`），而没有内置任何具体的事件循环、任务调度器或异步 I/O 驱动。所有这些职责都由第三方运行时库承担。**Tokio** 正是其中最成熟、最通用、性能最强悍的高并发异步运行时。

然而，在实际开发和生产运维中，许多开发者仅将 Tokio 视为一组 `#[tokio::main]` 宏和 `async/await` 的语法糖。当面临如下生产级别的复杂问题时，往往会感到无从下手：
1. **CPU 密集型任务阻塞了异步线程池**，导致其他异步 I/O 任务发生严重的延迟抖动；
2. **多线程调度下的 Work-Stealing（工作窃取）**是如何在局部队列与全局队列之间平衡负载的？
3. **协作式调度（Cooperative Scheduling）**是如何通过任务预算（Budget）防止饥饿的？
4. **异步通道（Channels）与同步锁（Mutex）**在底层是如何与 Waker 和运行时唤醒器深度集成的？
5. **取消安全性（Cancellation Safety）**在 `tokio::select!` 中是如何影响数据完整性的？

为了彻底解开这些谜团，本书将抛开浅层的 API 教学，带你深入 Tokio 的源码级设计，探索高性能异步运行时的工程实现哲学。

---

## 2. 本书核心架构与学习大纲

本书经过重新重构，分为以下两个核心部分，环环相扣，由浅入深地带你重构对异步运行时的认知：

### 第一部分：异步运行时内核与任务调度
* **[运行时核心](runtime/README.md)**：介绍异步运行时范式，区分就绪通知（Readiness-based）与完成通知（Completion-based）的区别。
* **[第一章：Tokio 运行时架构与工作窃取调度器](runtime/tokio-architecture.md)**：
  - 核心组件剖析：驱动层（IoDriver、TimeDriver）、调度层（Scheduler）与 Spawner 接口。
  - MIO 与操作系统事件循环的打通：深入操作系统内核（Linux `epoll` / Windows `IOCP` / macOS `kqueue`），阐明底层事件如何一步步向上抽象并转换为 `Waker` 的唤醒信号。
  - 运行时的单线程（`current_thread`）与多线程（`multi_thread`）模式深度手动配置。
* **[第二章：异步任务生命周期与阻塞性代码处理](runtime/async-tasks-execution.md)**：
  - 调度器内存布局：本地无锁环形队列（SPMC 环形缓冲区）与全局就绪队列的设计。
  - 工作窃取（Work-Stealing）算法：详细推演空闲 Worker 线程如何原子地窃取其他线程本地队列中半数的任务。
  - LIFO Slot 缓存机制与协作式任务预算（Task Budget）系统。
  - 物理阻塞代码的处理：`spawn_blocking` 与原生物理线程的工程选型与实战。

### 第二部分：异步通信与同步原语
* **[异步通信](sync/README.md)**：介绍在异步协作中不阻塞线程的核心法则，以及各种通信原语的整体脉络。
* **[第三章：异步锁、同步通道与 Select 并发多路复用](sync/async-synchronization.md)**：
  - 异步锁（`tokio::sync::Mutex`）与同步锁（`std::sync::Mutex`）的底层原理对比及选型指南。
  - 四大通道（oneshot, mpsc, broadcast, watch）的内存结构、环形缓冲区与状态机设计。
  - `tokio::select!` 宏的并发轮询机制与取消安全性（Cancellation Safety）的深度剖析，提供规避数据丢失的工程方案。
  - 生产级实战：结合 mpsc、Semaphore 和 watch 优雅退出构建高性能日志/任务处理管道。

---

## 3. 学习目标

阅读完本书后，你将能够：
* 深刻理解 Rust 异步 Future 在被 Poll 时的状态扭转与内存布局；
* 根据业务特性（CPU 密集型 vs. I/O 密集型）调优 Tokio 运行时的核心参数；
* 掌握无锁队列（Lock-free Queue）在多核调度器中的实际工程实践；
* 彻底理解取消安全（Cancellation Safety）的边界，规避异步代码中的各种死锁、假死与数据丢失陷阱，编写出高吞吐、低延迟的 Rust 系统级程序。
