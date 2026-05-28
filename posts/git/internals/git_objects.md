---
title: Git 底层原理：三类核心对象 blob, tree, commit
publishTime: 2026-05-24 18:20
author: hengvvang
summary: 从底层文件数据库的视角拆解 blob、tree 和 commit 等核心概念，揭秘 Git 追踪文件版本变化的秘诀。
readingTime: 2 min
tags:
  - GIT
  - INTERNALS
  - VCS
  - Workflow
lastUpdated: 2026-05-25 02:30
cover:
  image:
    src: https://images.unsplash.com/photo-1516259762381-22954d7d3ad2?w=800&auto=format&fit=crop
    brightness: 0.75
    scale: 1.08
  text:
    content: GIT | INTERNALS
    position: topLeft
category: toolchain
subcategory: git
subtopic: internals
---






# Git 底层原理：三类核心对象 blob, tree, commit

Git 绝非简单的差异备份工具，而是一个优雅的“内容寻址文件系统”。在 `.git/objects/` 目录中，Git 将所有版本数据存储为由哈希值索引的三个核心对象。

## 1. 数据对象：Blob (Binary Large Object)

Blob 只存储文件的**内容**，而不保存文件名、权限和目录结构。如果两个不同目录下的文件内容一模一样，在 Git 中只会占用一个 Blob 存储空间：

```bash
# 查看一个哈希对应的 blob 内容
git cat-file -p <hash>
```

## 2. 树对象：Tree

Tree 相当于文件系统中的**目录**。它记录了目录下的文件名、文件模式（权限）以及它所包含的子 Tree 或 Blob 的哈希映射关系。

## 3. 提交对象：Commit

Commit 记录了某次版本提交的元数据，包括：
- 指向顶层 `tree` 对象的哈希指针。
- 指向父提交（Parent Commit）的指针（用以构建版本历史链）。
- 作者、提交者信息、时间戳以及提交日志描述。

这种通过“指针指向哈希”的形式，让 Git 分支的新建和切换只需要修改一个 40 字节的文件指针（如 `refs/heads/master`），快如闪电。