---
title: "Zephyr 线程栈分析器与内存泄漏调试指南"
publishTime: "2026-05-24 14:40"
author: "hengvvang"
summary: "【摘要测试】这是一篇关于 RTOS / ZEPHYR 的技术分享，核心探讨了《Zephyr 线程栈分析器与内存泄漏调试指南》的实现细节与核心概念。"
---


# Zephyr 线程栈分析器与内存泄漏调试指南

在嵌入式开发中，栈溢出（Stack Overflow）是极难排查的 Bug 之一。Zephyr 提供了原生的线程栈分析器（Thread Analyzer），能够实时检测各个线程的栈水位。

## 启用分析器

在 `prj.conf` 中添加以下编译配置项：

```toml
CONFIG_THREAD_ANALYZER=y
CONFIG_THREAD_ANALYZER_LOG=y
CONFIG_THREAD_ANALYZER_AUTO=y
CONFIG_THREAD_ANALYZER_AUTO_INTERVAL_MS=5000
```

## 日志输出解析

启用后，Zephyr 会每隔 5 秒在串口自动打印统计信息：

```text
Thread analyze:
 main            : unused 1500 usage 548 / 2048 (26 %)
 idle            : unused  200 usage  56 /  256 (21 %)
 workq           : unused  700 usage 324 / 1024 (31 %)
```

如果 `unused` 值接近 0，则表明该线程极有发生栈溢出的危险，必须立即调大 `K_THREAD_STACK_DEFINE` 的大小以防程序崩溃。