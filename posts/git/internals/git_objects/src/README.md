# Git 对象模型与底层原理剖析

Git 绝非简单的“差异备份工具”（Delta-based Version Control System），其本质是一个极其优雅的**“内容寻址文件系统”（Content-Addressable File System）**，并在其之上构建了一套轻量级的版本控制逻辑。

当我们日常使用 `git add`、`git commit`、`git branch` 等高级命令（Porcelain Commands）时，Git 在底层默默地通过高效率的哈希指针、zlib 压缩以及简单直观的文本文件维护着庞大的版本树。

本教程旨在剥离 Git 的神秘外衣，带你深入 `.git` 目录的二进制世界，通过理论详解、源码级结构解析以及底层的 Plumbing 命令实战，帮助你全面掌握 Git 的底层运作机制。

---

## 本书内容大纲

### 1. [Git 仓库目录结构解析](01_git_repository_structure.md)
*   **`.git` 目录解构**：从 `git init` 开始，拆解每个目录与文件（`HEAD`、`index`、`config`、`objects/`、`refs/` 等）的作用。
*   **暂存区（Index/Stage）的本质**：剖析二进制 `index` 文件如何充当工作区与版本库之间的纽带。
*   **引用（References）的管理**：剖析本地分支、远程分支及标签在文件系统中的具象表示，以及 `packed-refs` 的优化机制。

### 2. [Git 四大核心对象深度剖析](02_git_objects_deepdive.md)
*   **内容寻址机制**：解析如何利用 SHA-1 算法计算文件内容的唯一指纹，实现去重与快速寻址。
*   **二进制报文格式**：深度剖析 `Blob`、`Tree`、`Commit` 和 `Tag` 对象的报文结构（Header + Payload）及 Null 字符（`\0`）分隔符设计。
*   **二进制文件解析器实现**：通过一段 Python 脚本，不依赖 Git 工具链，直接读取、解压并结构化解析 `.git/objects/` 中的二进制松散对象。

### 3. [底层命令与上层命令 (Plumbing vs Porcelain) 实战](03_plumbing_vs_porcelain.md)
*   **工具链划分**：对比 Porcelain（面向普通用户，如 `add`/`commit`/`checkout`）与 Plumbing（面向底层开发者或脚本，如 `hash-object`/`cat-file`/`write-tree`）。
*   **纯底层命令提交实战**：脱离 `git add` 与 `git commit`，完全通过底层命令手动将文件哈希化、构建文件目录树、生成提交记录并更新分支指针，从而彻底理解 Git 的提交全链路。

---

## 学习目标与收获

通过本书的学习，你将能够：
1.  **透视 Git 存储结构**：看到任何 Git 仓库，能立刻在脑海中浮现出它的对象指针拓扑图。
2.  **诊断复杂版本冲突**：当分支发生悬空（Dangling Commit）、引用损坏或暂存区错乱时，能使用底层工具手动修复。
3.  **编写自定义 Git 脚本**：深入理解 Plumbing 命令，从而有能力开发定制化的 CI/CD 管道工具、静态分析插件或 Git 钩子（Hooks）。
4.  **掌握经典系统设计**：学习 Git 运用哈希寻址、不变性对象（Immutable Objects）以及有向无环图（DAG）等经典计算机科学模式，启发自己的系统架构设计。
