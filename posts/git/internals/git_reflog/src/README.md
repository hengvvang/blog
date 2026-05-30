# Git Reflog 简介

在日常的版本控制实践中，开发者们不可避免地会遇到这类令人战栗的场景：
- 执行了 `git reset --hard HEAD~5`，回滚了本地提交，却突然发现其中包含尚未推送到远程的重要修改；
- 误删除了一个开发了数周但尚未合并的本地分支（`git branch -D feature-x`）；
- 在进行复杂的 `git rebase` 或 `git cherry-pick` 时发生冲突，为了“推倒重来”执行了错误的清理命令，导致工作区和提交历史一片混乱。

在这些看似“无可挽回”的灾难背后，Git 实际上悄悄为我们保留了一道终极防线——**引用日志（Reference Logs，简称 Reflog）**。本书将从底层数据结构、对象模型以及 Git 管道命令（Plumbing Commands）的视角，带您深入探索 Git Reflog 的内部工作机制，帮助您在面对代码丢失时能够沉着应对，利用底层的恢复机制找回任何曾经提交过（甚至仅暂存过）的代码。

---

## 什么是 Git Reflog？

简单来说，**Reflog 是 Git 用来记录本地仓库中引用（References，如分支指针、HEAD 指针、标签等）更新历史的机制**。

每当你在本地仓库中执行任何会改变引用指向的操作（例如 `commit`、`checkout`、`reset`、`rebase`、`merge`、`pull` 等），Git 都会在对应的引用日志文件中追加一条记录，标明该引用在什么时间、由谁、因为什么操作，从哪一个 Commit SHA-1 转移到了另一个 Commit SHA-1。

### Reflog 与 Git Log 的本质区别

很多初学者容易混淆 `git reflog` 与 `git log`。下表对比了两者的核心差异：

| 维度 | Git Log | Git Reflog |
| :--- | :--- | :--- |
| **数据源** | 提交历史的有向无环图（Commit DAG） | 本地引用更新的顺序日志（Chronological Log） |
| **范围** | 共享的、跨仓库的（会随 `push` / `fetch` 传输） | 纯本地的（绝不参与任何网络传输，每个克隆独有） |
| **寿命** | 永久保留（只要能从任何分支/标签追溯到该提交） | 具有有效期限制（默认 30~90 天，过期后会被垃圾回收） |
| **视图性质** | 逻辑上的版本演进历史 | 物理上的指针移动审计痕迹 |
| **包含内容** | 仅包含当前分支/历史可达的有效提交 | 包含所有“已废弃”的、悬空的提交（Dangling Commits） |

---

## 本书内容概览

为了让您能够从原理到实践彻底掌握这一工具，本书分为三个核心章节：

### 1. [引用指针与引用日志底层原理](01_references_and_reflog.md)
我们将深入剖析 `.git` 目录的物理结构，探寻 `.git/refs/` 与 `.git/logs/` 的对应关系。通过直接读取和解析底层的日志文件，您将了解 Reflog 条目的具体字节格式、写入触发时机，以及 HEAD 指针与分支指针 Reflog 的独立性。

### 2. [误操作恢复：找回丢失的提交与分支](02_recovering_lost_commits.md)
本章将进入实战场景。我们将模拟多种常见的“代码丢失”灾难，并使用 `git reflog`、`git log -g`、`git fsck --lost-found` 等工具逐步分析并成功定位、恢复那些已经成为“孤儿（Orphan）”或“悬空（Dangling）”的 Commit、分支甚至未提交（但已 `git add`）的暂存区代码。

### 3. [Reflog 维护与过期策略解析](03_maintenance_and_expiry.md)
Reflog 不可能无限增长。本章将详细讲解 Git 垃圾回收（Garbage Collection）的触发机制，剖析 `gc.reflogExpire` 与 `gc.reflogExpireUnreachable` 等关键配置项对引用日志生命周期的控制逻辑，并指导您如何编写脚本来安全地进行 Reflog 审计与手动清理。

---

## 学习目标

通过阅读本书，您将达到以下技术深度：
1. **源码级理解**：能够脱离 Git CLI 抽象，直接用命令行和脚本解析 `.git/logs/` 下的原始日志，理解其文本存储协议。
2. **灾难恢复专家**：掌握科学的排查链路，无论是 `reset --hard`、分支强删还是 `rebase` 失败，都能迅速画出局部的 Commit 图谱，精确定位 SHA-1 并恢复。
3. **运维与调优能力**：理解 Git 的自动修剪（Pruning）策略，能够合理配置大型项目中的 GC 参数，保证本地开发与中央服务器的性能平衡。
