# 引用与变更日志

在深入解析具体的 Git 命令和恢复技巧之前，我们必须首先厘清 Git 内部是如何存储引用指针，以及如何记录这些指针变化的。本部分将聚焦于 Git 的**底层文件系统存储模型**。

---

## 引用存储 (Reference Storage)

Git 中的引用（References）实质上是人类可读的别名，用于代替难以记忆的哈希值。它们集中存放在 `.git/refs/` 目录下：

1. **`refs/heads/` (本地分支)**：
   * 对应本地仓库中的每个分支。例如 `refs/heads/main` 或 `refs/heads/feature-1`。
   * 文件内容为该分支当前最新一次提交的 SHA-1/SHA-256 值。
2. **`refs/tags/` (标签)**：
   * 对应本地的标签。轻量标签（Lightweight Tag）文件内直接保存提交哈希；附注标签（Annotated Tag）文件内保存指向标签对象（Tag Object）的哈希。
3. **`refs/remotes/` (远程跟踪分支)**：
   * 对应最近一次与远程仓库同步时，远程分支所在的位置。例如 `refs/remotes/origin/main`。它们对本地开发者是只读的，只能通过 `git fetch` 或 `git push` 进行间接更新。

此外，`.git/HEAD` 是一个特殊的**符号引用（Symbolic Reference）**，它通常指向 `refs/heads/` 中的某个具体分支文件，表明当前工作区正处于该分支的开发上下文中。

---

## 引用变更日志 (Reflog Storage)

与引用存储的目录结构高度对称，`.git/logs/` 目录用于持久化所有的变更轨迹：

```text
.git/
├── HEAD                        <-- 当前分支指示器
├── refs/
│   ├── heads/
│   │   ├── main                <-- 本地 main 分支的最新 commit 哈希
│   │   └── dev                 <-- 本地 dev 分支的最新 commit 哈希
│   ├── tags/
│   │   └── v1.0.0              <-- 标签 v1.0.0 指向的 commit 或 tag 对象哈希
│   └── remotes/
│       └── origin/
│           └── main            <-- 远程跟踪分支最新 commit 哈希
└── logs/
    ├── HEAD                    <-- HEAD 的变迁历史文件 (极度活跃)
    └── refs/
        ├── heads/
        │   ├── main            <-- main 分支自身的变迁历史
        │   └── dev             <-- dev 分支自身的变迁历史
        └── remotes/
            └── origin/
                └── main        <-- 远程分支的变迁历史
```

每当一个引用指针被修改时，Git 会触发一个事务：先写锁文件，然后写入新的引用值，同时向 `.git/logs/` 下对应的路径追加一条明文格式的日志记录。

### HEAD 指针移动日志

在所有日志文件中，`.git/logs/HEAD` 是最特殊且最繁忙的一个。因为无论是执行 `git checkout` 切换分支，还是通过 `git commit` 创建新提交，亦或是使用 `git reset` 强制改变当前分支指向，`.git/HEAD` 都会发生变动。

通过研究这一部分，我们将揭开 Git 指针移动背后的物理规律，理解 Git 如何在完全不破坏原有对象的情况下，原子地实现分支切换与回滚。
