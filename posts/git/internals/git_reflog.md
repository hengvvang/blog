---
title: "Git Reflog 误删分支与未提交代码灾难恢复"
publishTime: "2026-05-24 18:25"
author: "hengvvang"
summary: "教你使用引用日志来拯救那些被意外重置或强制删除的提交，是日常开发中必不可少的急救手册。"
readingTime: "2 min"
tags: ["GIT","INTERNALS","VCS","Workflow"]
lastUpdated: "2026-05-25 02:30"
cover: "https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&auto=format&fit=crop"
coverText:
  position: bottomLeft
  context: "GIT | INTERNALS"
---






# Git Reflog 误删分支与未提交代码灾难恢复

在开发中，不小心误执行了 `git reset --hard` 或是删除了未合并的本地分支，往往会让人冷汗直流。实际上，只要该代码曾经被 `commit` 提交过，就可以用 `git reflog` 轻易找回。

## 什么是 Reflog？

`git log` 记录的是分支的历史提交记录，而 `git reflog`（引用日志）记录的是**本地 HEAD 指针在本地的一切移动轨迹**。无论是 checkout、commit、reset 还是 merge，所有动作都会被忠实记录。

## 恢复实战步骤

### 1. 查看移动历史

输入命令：

```bash
git reflog
```

输出格式类似于：

```text
a1b2c3d HEAD@{0}: reset: moving to HEAD~1
e4f5g6h HEAD@{1}: commit: 编写了核心 API
i7j8k9l HEAD@{2}: checkout: moving from dev to main
```

### 2. 定位丢失的提交并恢复

从输出中我们可以看到，`HEAD@{1}` 对应的是被 reset 丢弃的那个 commit。我们只需要将其重新拉回：

```bash
# 在当前分支上强制重置到该历史指针
git reset --hard e4f5g6h
```

代码瞬间完璧归赵！记住，Git 几乎从不删除数据，它只是让某些提交在图上不可达，而 Reflog 就是找回这些隐藏提交的终极密码。