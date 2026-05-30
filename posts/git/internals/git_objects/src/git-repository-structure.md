# Git 仓库目录结构解析

要理解 Git 的工作原理，首先必须剖析 `.git` 文件夹。当你在一个目录中执行 `git init` 时，Git 会在该目录下创建一个名为 `.git` 的隐藏文件夹。这个文件夹就是 Git 的**版本库（Repository）**，它包含了管理该项目版本历史所需的所有数据、元数据以及配置文件。

本章将详细剖析 `.git` 目录的物理结构、核心文件职责、以及分支与标签（引用）的底层实现机制。

---

## 1. `.git` 目录的初始化布局

在一个全新的空目录中执行初始化命令：

```bash
# 创建一个新的测试仓库
mkdir git-internals-demo
cd git-internals-demo
git init
```

此时，使用 `tree /F` (Windows) 或 `find .` (Linux/macOS) 查看 `.git` 目录，你会看到以下经典的初始化结构：

```text
.git/
├── HEAD
├── config
├── description
├── hooks/
│   ├── applypatch-msg.sample
│   ├── commit-msg.sample
│   ├── ... (其他以 .sample 结尾的钩子模板)
│   └── pre-push.sample
├── info/
│   └── exclude
└── objects/
    ├── info/
    └── pack/
```

> [!NOTE]
> 在执行第一次 `git add` 和 `git commit` 之前，`.git` 目录中并不存在 `index`（暂存区文件）以及 `refs/` 目录下的大部分引用结构。这些文件会在我们与仓库发生交互时被动态创建。

---

## 2. 核心文件与目录功能详解

下面我们自顶向下逐一解析这些文件和文件夹在 Git 运行体系中的核心职责：

### 2.1 `HEAD` 文件：当前分支的罗盘

`HEAD` 是一个纯文本文件，它指示了 Git 当前正处于哪个分支上，或者正指向哪一个具体的提交。

打开 `HEAD` 文件：
```bash
cat .git/HEAD
```
输出通常是：
```text
ref: refs/heads/main
```
这表明当前工作区处于 `main` 分支。`ref: refs/heads/main` 是一种**符号引用（Symbolic Reference）**，它指向另一个引用文件 `.git/refs/heads/main`。

#### 游离头指针（Detached HEAD）状态
当你不通过分支，而是直接检出（checkout）某个特定的提交哈希值、标签或远程分支时，`HEAD` 文件中的内容会发生变化。它不再是 `ref: ...`，而是直接写入一个 40 位的 SHA-1 提交哈希值：
```text
8a9f0d1b4c6e8f5a2b0c3d4e5f6a7b8c9d0e1f2a
```
此时，Git 处于“游离头指针”状态。任何在此时创建的提交，如果没有显式创建分支来“接住”它们，随着 HEAD 的切换，它们将变成无主的“悬空提交”（Dangling Commits），并最终被 Git 的垃圾回收机制（GC）清理。

---

### 2.2 `index` 文件：暂存区（Staging Area）

`index` 是一个**二进制文件**，通常也被称为**Staging Area**或**Directory Cache**。它是 Git 架构设计的精髓之一。

*   **它的角色**：它是工作区（Working Directory）和本地版本库（`objects/`）之间的桥梁。
*   **它的内容**：`index` 记录了所有被追踪文件的路径、文件大小、最后修改时间（mtime）、文件权限（mode）以及对应的 Blob 对象的 SHA-1 哈希值。
*   **核心机理**：当你执行 `git add <file>` 时，Git 会做两件事：
    1.  将该文件内容压缩并写入 `objects/` 目录中，生成一个 Blob 对象。
    2.  在 `index` 文件中添加或更新该文件的条目，记录其相对路径及对应的 Blob 哈希值。
*   当你执行 `git commit` 时，Git **不需要**扫描整个工作区目录，而仅仅是根据 `index` 文件中记录的条目快速生成树对象（Tree）并创建提交。

可以使用底层的 `git ls-files` 命令来读取并格式化输出二进制 `index` 的当前内容：
```bash
git ls-files --stage
```

---

### 2.3 `objects/` 目录：对象数据库

`objects/` 目录是 Git 的**对象数据库（Object Database）**，存储着版本库中所有文件的实际内容、目录树结构、提交历史以及标签数据。

#### (1) 松散对象（Loose Objects）
Git 默认以“松散对象”的形式写入文件。为防止单个目录下文件过多导致系统查找效率下降，Git 采用**哈希前两位作为目录名**，后 38 位作为文件名的存储策略。
例如，一个 SHA-1 值为 `bd6f9a0c...` 的对象会被存储在：
`.git/objects/bd/6f9a0c...` 

#### (2) 打包对象（Packfiles）
随着项目增大，数万个松散小文件会严重消耗磁盘的 inode 资源并降低 I/O 效率。Git 会在特定时机（如执行 `git gc` 或推送代码时）将松散对象打包成一个大文件 `.pack`，并附带一个 `.idx` 索引文件以支持在打包文件中快速随机访问。它们存储在：
`.git/objects/pack/`

---

### 2.4 `refs/` 目录：引用管理

引用（References，简称 refs）是 Git 用来给长达 40 位的 SHA-1 哈希值起易读别名的机制。`refs/` 目录包含三个主要子目录：

```text
.git/refs/
├── heads/      # 本地分支
├── tags/       # 本地标签
└── remotes/    # 远程跟踪分支
```

*   **本地分支 (`refs/heads/`)**：里面的每个文件代表一个分支，文件名就是分支名。例如，`.git/refs/heads/main` 是一个纯文本文件，里面仅包含一行 40 位的 commit 哈希值，指向该分支当前的最新提交。
*   **标签 (`refs/tags/`)**：类似于分支，指向特定提交的只读指针。轻量级标签（Lightweight Tag）文件内直接记录 commit 哈希；附注标签（Annotated Tag）文件内记录一个 Tag 对象的哈希。
*   **远程跟踪分支 (`refs/remotes/`)**：记录远程仓库（如 `origin`）在上次同步（fetch/pull）时各分支的最新提交哈希，不允许在本地直接修改，必须通过与远程服务器通信来更新。

#### 压缩引用：`packed-refs` 文件
当项目中分支和标签非常多时，为了避免在磁盘上产生大量的小文本文件，Git 会运行垃圾回收，将它们合并写入到 `.git/packed-refs` 文件中。该文件的格式非常简单，每一行对应一个引用：
```text
# pack-refs with: peeled fully-peeled sorted 
8a9f0d1b4c6e8f5a2b0c3d4e5f6a7b8c9d0e1f2a refs/heads/main
e3b0c44298fc1c149afbf4c8996fb92427ae41e4 refs/tags/v1.0.0
```
如果在 `refs/heads/` 下和 `packed-refs` 中同时存在同名分支，Git 会优先使用 `refs/heads/` 下的松散引用（因为它是最新的）。

---

### 2.5 其他配置文件与目录

*   **`config`**：这是该仓库的局部配置文件（Local Config）。你可以用文本编辑器直接编辑它，或者通过 `git config --local` 命令行工具来修改。诸如远程仓库 URL（`[remote "origin"]`）、分支上游关系（`[branch "main"]`）以及当前仓库特有的行为控制都写在这里。
*   **`description`**：该文件仅在通过 Gitweb 等基于网页的旧版 CGI 工具展示项目描述时使用，对现代的 Git 操作（如 Clone/Push/Pull）没有任何实际影响。
*   **`hooks/`**：存放客户端或服务端钩子脚本的目录。这些脚本在特定的动作（如 `pre-commit`、`commit-msg`、`post-receive`）发生时被自动触发执行。默认以 `.sample` 结尾的文件是不生效的，去掉后缀并赋予可执行权限后即可启用。
*   **`info/exclude`**：存放项目本地的排除规则。它的作用与根目录下的 `.gitignore` 完全一致，唯一的区别是：`info/exclude` **不会被提交到版本库中**，因此其中的规则仅对你当前这台主机的本地工作区生效。

---

## 3. Git 内部的引用与对象关系图

下面我们通过 Mermaid 状态图直观展示 `.git` 的文件系统与对象数据库之间的引用指向关系：

```mermaid
graph TD
    subgraph 引用与指引 Reference and Pointer
        HEAD["HEAD 文件<br/>(内容: ref: refs/heads/main)"] --> MainBranch["refs/heads/main 文件<br/>(内容: Commit-SHA-A)"]
        Tag["refs/tags/v1.0.0 文件<br/>(内容: Commit-SHA-B)"]
    end

    subgraph 对象数据库 Object Database (.git/objects/)
        CommitA["Commit A<br/>(最新提交)"]
        CommitB["Commit B<br/>(父提交)"]
        Tree["Tree 对象<br/>(根目录)"]
        Blob["Blob 对象<br/>(文件内容)"]
    end

    MainBranch -->|指向最新| CommitA
    Tag -->|指向历史| CommitB
    CommitA -->|parent| CommitB
    CommitA -->|tree| Tree
    Tree -->|子项描述| Blob
```

---

## 4. 实践：手动修改分支指针

为了验证“分支在底层只是一个普通文本文件”这一结论，我们可以做一个有趣的物理修改实验。

### 步骤一：创建两个提交
```bash
# 配置本地用户名和邮箱
git config user.name "test"
git config user.email "test@example.com"

# 创建第一个提交
echo "version 1" > file.txt
git add file.txt
git commit -m "Commit 1"

# 记录当前提交的哈希值
git log --oneline
```
此时，假设我们得到哈希：`a1b2c3d (Commit 1)`。

### 步骤二：创建第二个提交
```bash
echo "version 2" >> file.txt
git add file.txt
git commit -m "Commit 2"
git log --oneline
```
此时，`git log` 输出大概如下：
```text
e5f6g7h (HEAD -> main) Commit 2
a1b2c3d Commit 1
```

### 步骤三：直接通过文件系统“回滚”分支
我们不使用 `git reset` 这一高级命令，而是直接操作 `.git` 目录下的分支引用文件：
```bash
# 在 Windows Powershell 中运行
echo "a1b2c3d" > .git/refs/heads/main

# 或者在 Linux / macOS / Git Bash 中运行
echo "a1b2c3d" > .git/refs/heads/main
```
再次运行 `git log --oneline`：
```text
a1b2c3d (HEAD -> main) Commit 1
```
你会惊奇地发现，我们的 `main` 分支已经彻底回退到了第一个提交！而第二个提交 `e5f6g7h` 则暂时变成了无引用的悬空对象。

> [!CAUTION]
> 直接使用文本重写分支引用文件绕过了 Git 内部的写入锁与引用日志记录（Reflog），在日常开发中请千万不要这样直接修改，这可能导致 Reflog 错乱或状态不一致。在此仅作为教学原理解析演示。

通过本章的探索，我们清晰地看到 Git 并非将每个版本保存为一个大包或者一堆差异补丁，而是完全基于哈希寻址的文件系统。在下一章中，我们将深入解析构成这个系统基石的四大核心对象（Blob、Tree、Commit、Tag）的底层二进制结构。
