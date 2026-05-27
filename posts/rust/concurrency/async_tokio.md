---
title: Rust Tokio 异步运行时入门与任务调度
publishTime: 2026-05-24 14:10
author: hengvvang
summary: 详细剖析 Tokio 内部的多线程调度队列、工作窃取（Work-Stealing）算法与异步 IO 事件监听核心。
readingTime: 1 min
tags:
  - RUST
  - CONCURRENCY
  - System
  - Safety
lastUpdated: 2026-05-25 02:30
cover:
  image: https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=800&auto=format&fit=crop
  position: topLeft
  text: RUST | CONCURRENCY
---






# Rust Tokio 异步运行时入门与任务调度

Tokio 是 Rust 生态中最流行的异步运行时环境，专为编写高并发、非阻塞的网络应用程序而设计。

## 引入 Tokio

在 `Cargo.toml` 中添加：

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

## 使用 #[tokio::main] 宏

这个宏用于将你的同步 `main` 函数转换为异步入口点，并在后台设置 Tokio 运行时环境：

```rust
#[tokio::main]
async fn main() {
    println!("Hello, Tokio!");
    
    // 并发运行多个任务
    let handle = tokio::spawn(async {
        // 后台任务
        "任务结果"
    });
    
    let res = handle.await.unwrap();
    println!("收到: {}", res);
}
```

## 并发任务调度 (join!)

```rust
use tokio::time::{sleep, Duration};

async fn do_work(id: u32, delay: u64) {
    sleep(Duration::from_secs(delay)).await;
    println!("任务 {} 完成", id);
}

#[tokio::main]
async fn main() {
    tokio::join!(
        do_work(1, 2),
        do_work(2, 1)
    );
}
```

通过非阻塞的 `sleep`，Tokio 可以在单线程或固定线程池内并发调度成千上万个任务，实现极高的吞吐率。