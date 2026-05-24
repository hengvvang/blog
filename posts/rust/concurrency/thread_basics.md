---
title: "Rust 多线程并发编程与通道机制"
publishTime: "2026-05-24 14:00"
author: "hengvvang"
summary: "从 OS 线程创建说起，精讲 Rust 的 Send/Sync 特质，以及如何通过 mpsc 通道在线程间安全传输消息。"
readingTime: "1 min"
tags: ["RUST","CONCURRENCY","System","Safety"]
lastUpdated: "2026-05-25 02:30"
---






# Rust 多线程并发编程与通道机制

在 Rust 中，并发被视为“无畏并发”（Fearless Concurrency）。借助于所有权系统与借用检查，Rust 能够在编译期消除常见的多线程 Bug（如数据竞争）。

## 启动线程

我们可以使用 `std::thread::spawn` 来创建一个新线程：

```rust
use std::thread;
use std::time::Duration;

fn main() {
    thread::spawn(|| {
        for i in 1..10 {
            println!("来自子线程的数字: {}", i);
            thread::sleep(Duration::from_millis(1));
        }
    });

    for i in 1..5 {
        println!("来自主线程的数字: {}", i);
        thread::sleep(Duration::from_millis(1));
    }
}
```

## 消息传递通道 (Channels)

Rust 提供了消息传递并发机制，通过 `std::sync::mpsc`（多生产者，单消费者）通道在线程间传输数据：

```rust
use std::sync::mpsc;
use std::thread;

fn main() {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let val = String::from("来自子线程的信息");
        tx.send(val).unwrap(); // 发送数据
    });

    let received = rx.recv().unwrap(); // 接收数据（阻塞）
    println!("收到: {}", received);
}
```

使用 `move` 关键字强制闭包捕获它所使用的环境中的变量所有权，从而保证了发送的数据在线程间安全转移。