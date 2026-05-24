---
title: "Git Flow 分支管理工作流最佳实践"
publishTime: "2026-05-24 18:10"
author: "hengvvang"
summary: "【摘要测试】这是一篇关于 GIT / WORKFLOW 的技术分享，核心探讨了《Git Flow 分支管理工作流最佳实践》的实现细节与核心概念。"
---


# Git Flow 分支管理工作流最佳实践

Git Flow 是一种非常经典且规范的分支管理工作流模型，适用于具有固定发布周期、多版本并存的团队项目开发。

## 五大分支角色

Git Flow 模型定义了五种主要的分支，各自扮演不同的角色：

1. **master（主分支）**：保存发布到生产环境的代码。此分支上的每一个提交都应当是稳定的发行版本。
2. **develop（开发分支）**：日常开发的主分支，保存最新的合并代码，准备用于下一次发布。
3. **feature（功能分支）**：从 develop 分支拉出，用于开发特定新功能，开发完成后合并回 develop。
4. **release（发布分支）**：当开发累计到准备发布时，从 develop 拉出，用于测试和修 Bug。发布时合并回 master 和 develop。
5. **hotfix（热修复分支）**：直接从 master 分支拉出，紧急修复线上 Bug，修复后合并回 master 和 develop。

## 典型操作指令

```bash
# 开始一个新特性开发
git checkout -b feature/login develop

# 特性完成后合并回 develop
git checkout develop
git merge --no-ff feature/login
git branch -d feature/login
```

使用 `--no-ff`（非快进合并）能强制 Git 创建一个新的合并提交，从而在提交历史中清晰地保留该功能分支的存在记录。