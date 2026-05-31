# Git 内部原理与对象模型剖析

Git 绝非简单的“差异备份工具”（Delta-based Version Control System，如 SVN 或 CVS），其本质是一个极其优雅的**“内容寻址文件系统”（Content-Addressable File System）**，并在其之上构建了一套轻量级的版本控制逻辑。

当我们日常使用 `git add`、`git commit`、`git branch` 等高级命令（Porcelain Commands）时，Git 在底层默默地通过高效率的哈希指针、zlib 压缩以及简单直观的文本文件维护着庞大的版本树（有向无环图，即 DAG）。

本教程旨在剥离 Git 的神秘外衣，带你深入 `.git` 目录的二进制世界，通过理论详解、源码级结构解析以及底层的 Plumbing 命令实战，帮助你全面掌握 Git 的底层运作机制。

---

## 本书内容大纲

### 第一部分：Git 仓库结构与对象模型

*   **[仓库结构与三大对象](objects/README.md)**：Git 对象模型总体设计介绍。
*   **[第一章：Git 目录结构与底层存储物理布局](objects/git-repository-structure.md)**：从 `git init` 开始，拆解每个目录与文件（`HEAD`、`index`、`config`、`objects/`、`refs/` 等）的作用，并深入剖析二进制 `index` 文件的底层结构。
*   **[第二章：Blob、Tree、Commit 三大对象深度剖析](objects/git-objects-deepdive.md)**：解析内容寻址机制，剖析 `Blob`、`Tree`、`Commit` 和 `Tag` 对象的二进制报文格式，展示 SHA-1 计算与 zlib 压缩存储流程，并实现一个纯 Python 的对象解析器。

### 第二部分：底层指令与上层接口

*   **[底层指令与接口](commands/README.md)**：介绍 Plumbing 与 Porcelain 命令的设计哲学与交互逻辑。
*   **[第三章：Plumbing 底层指令与 Porcelain 上层接口对比](commands/plumbing-vs-porcelain.md)**：对比瓷器级（Porcelain）与管道级（Plumbing）指令，并进行纯底层命令提交的实战演练，完全脱离 `git add` 和 `git commit` 手动构建版本快照并提交。

---

## 学习目标与收获

通过本书的学习，你将能够：
1.  **透视 Git 存储结构**：看到任何 Git 仓库，能立刻在脑海中浮现出它的对象指针拓扑图与索引状态。
2.  **诊断复杂版本冲突**：当分支发生悬空（Dangling Commit）、引用损坏或暂存区错乱时，能使用底层工具手动排查并修复。
3.  **编写自定义 Git 脚本**：深入理解 Plumbing 命令，从而有能力开发定制化的 CI/CD 管道工具、静态分析插件或 Git 钩子（Hooks）。
4.  **掌握经典系统设计**：学习 Git 运用哈希寻址、不变性对象（Immutable Objects）以及有向无环图（DAG）等经典计算机科学模式，启发自己的系统架构设计。
