# Reflog 维护与过期策略解析

随着本地开发的推进，每一次代码修改、分支切换、重置、变基都会不断向引用日志中追加新记录。如果不加节制地保留，`.git/logs/` 目录将无休止地膨胀。此外，那些已经“废弃”的提交对象因为被 Reflog 指向而无法被垃圾回收，导致仓库体积不断变大。

为了解决这一问题，Git 提供了一套自动与手动的 Reflog 过期与维护机制。本章将对这些机制的内部原理及配置参数进行全面剖析。

---

## Git 垃圾回收（GC）与 Reflog 的关系

当我们执行 `git gc`（Garbage Collection）时，Git 会执行一系列清理工作：
1. 压缩松散对象（Loose Objects）为打包文件（Packfiles）以节省空间并提升性能；
2. 清理悬空且已过期的对象。

**但 `git gc` 能否顺利回收一个悬空提交，完全取决于该提交是否还在 Reflog 的保护期内。**

即使某个提交在当前所有的分支和标签中都不可达（即“逻辑悬空”），只要在 `.git/logs/` 的任何一个日志文件中依然记录着这个提交的哈希值，Git 就认为该提交是“被 Reflog 引用的”，因而不会将其标记为垃圾。只有当该条 Reflog 记录本身过期并被清除后，对应的 Commit 才会失去所有的引用保护，在下一次垃圾回收时被物理清除。

---

## 核心配置参数详解

Git 提供了细粒度的配置来控制 Reflog 的生命周期。以下是控制过期的两个关键配置项：

### 1. `gc.reflogExpire`
- **默认值**：`90 days`（90天）
- **适用对象**：**可达提交（Reachable Commits）**对应的日志记录。
- **含义**：如果一条日志记录中涉及的提交依然可以从当前分支或标签追溯到，那么该条日志记录默认保留 90 天。

### 2. `gc.reflogExpireUnreachable`
- **默认值**：`30 days`（30天）
- **适用对象**：**不可达提交（Unreachable Commits）**对应的日志记录。
- **含义**：如果一条日志记录中涉及的提交已经是悬空的（例如被 `reset --hard` 踢掉的旧提交），为了安全起见，Git 会将其日志记录再保留 30 天，给开发者留出 30 天的后悔药时间。

---

## 更改保留期限的命令示例

你可以通过以下命令自定义本地仓库或全局的过期策略：

```bash
# 将全局的可达提交 Reflog 保留期延长至 180 天
$ git config --global gc.reflogExpire "180 days"

# 将当前仓库的不可达（悬空）提交 Reflog 保留期缩短至 14 天（适合磁盘紧张的项目）
$ git config gc.reflogExpireUnreachable "14 days"
```

> [!NOTE]
> 设定的值可以是非常直观的时间描述，例如 `"never"`（永不过期）、`"now"`（立即过期）、`"2 weeks"` 等。

---

## 手动触发过期与清理命令

在某些紧急情况下（例如不小心提交了包含私钥、密码或超大临时文件的代码，且已经通过 `reset` 将其移出历史），你可能需要**立即彻底删除**这些悬空数据。此时可以通过手动调用 `git reflog expire` 和 `git gc` 来实现。

### 命令语法与选项

```bash
git reflog expire [--expire=<time>] [--expire-unreachable=<time>] [--all | <refs>...]
```

- `--expire=<time>`：强行废弃早于该时间的日志记录。
- `--expire-unreachable=<time>`：强行废弃早于该时间的悬空日志记录。
- `--all`：对所有引用的日志进行操作。
- `--dry-run`（`-n`）：演练模式，仅输出将被删除的记录，不真正修改文件。

### 紧急物理净化实战（清除敏感数据）

如果需要彻底抹去某个提交的痕迹，使其无法通过 Reflog 找回，并且立即释放磁盘空间，请依次执行以下命令：

```bash
# 1. 演练：查看哪些 Reflog 记录将被清除（可选）
$ git reflog expire --expire=now --expire-unreachable=now --all --dry-run --verbose

# 2. 立即废弃所有的引用日志记录
$ git reflog expire --expire=now --expire-unreachable=now --all

# 3. 物理清空悬空对象数据库并即时修剪
$ git gc --prune=now
```

> [!CAUTION]
> **危险操作**：一旦运行了 `git reflog expire --expire=now --all` 加上 `git gc --prune=now`，所有未被当前有效分支/标签指向的提交和文件将被**永久且不可逆地物理删除**。在执行该操作前，请务必确认已经备份了所有必要的数据。

---

## 控制 Reflog 是否启用的开关

在极少数场景下（例如持续集成 CI 系统、极度受限的嵌入式系统或超大规模的 Mono-repo 部署），为了减少磁盘 I/O 写入频率或节省微小的空间，你可以选择完全禁用 Reflog。

这由 `core.logAllRefUpdates` 配置项控制：

- **`true`（默认值）**：在有工作区的仓库中，自动为 `refs/heads/`、`refs/remotes/`、`refs/notes/` 以及 `HEAD` 记录日志。
- **`false`**：关闭所有自动引用日志记录。
- **`always`**：强制对所有引用更改进行日志记录，无论当前仓库是普通仓库还是裸仓库（Bare Repository）。

```bash
# 全局关闭引用日志记录功能（通常不建议在常规开发机上执行）
$ git config --global core.logAllRefUpdates false
```

---

## 引用日志清理与审计维护脚本

以下是一个用于审计本地仓库中 Reflog 文件大小、并提供交互式安全清理机制的 Shell 脚本：

```bash
#!/usr/bin/env bash
# reflog_audit_clean.sh - 审计本地 Reflog 文件占用大小并进行安全修剪

set -euo pipefail

GIT_DIR=$(git rev-parse --git-dir)
LOGS_DIR="$GIT_DIR/logs"

echo "=== 开始审计 Git Reflog ==="

if [ ! -d "$LOGS_DIR" ]; then
    echo "提示: 当前仓库未启用或无引用日志目录: $LOGS_DIR"
    exit 0
fi

# 1. 统计引用日志占用的物理空间
total_bytes=$(du -sb "$LOGS_DIR" 2>/dev/null | cut -f1 || du -sh "$LOGS_DIR" | cut -f1)
echo "引用日志物理大小: $total_bytes"

# 2. 统计日志行数（以 HEAD 为例）
if [ -f "$LOGS_DIR/HEAD" ]; then
    head_lines=$(wc -l < "$LOGS_DIR/HEAD")
    echo "HEAD 日志总记录行数: $head_lines 条"
else
    echo "HEAD 日志文件尚不存在。"
fi

echo "--------------------------------------------------"
echo "请选择清理模式:"
echo "1) 仅清理 30 天以前的悬空（Unreachable）记录 [安全]"
echo "2) 立即清除所有 Reflog 并进行物理垃圾回收 [危险/物理擦除]"
echo "3) 取消退出"
read -rp "输入选项 (1/2/3): " choice

case $choice in
    1)
        echo "正在执行安全清理..."
        git reflog expire --expire-unreachable="30.days.ago" --all
        git gc --auto
        echo "清理完成。"
        ;;
    2)
        read -rp "警告：这将永久删除所有历史回滚点！确认要继续吗？(y/N): " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            echo "正在擦除所有 Reflog 并强制回收空间..."
            git reflog expire --expire=now --expire-unreachable=now --all
            git gc --prune=now --aggressive
            echo "物理擦除成功。"
        else
            echo "操作已取消。"
        fi
        ;;
    3|*)
        echo "操作已取消。"
        exit 0
        ;;
esac
```

---

## 垃圾回收与过期配置项总结表

| 配置键 | 默认值 | 推荐设定值 | 作用描述 |
| :--- | :--- | :--- | :--- |
| **`gc.reflogExpire`** | `90 days` | `90 days` 到 `180 days` | 保留可达分支上的每一次指针变迁日志，时间越长历史审计越全面。 |
| **`gc.reflogExpireUnreachable`** | `30 days` | `14 days` 到 `30 days` | 保留已被解绑的悬空提交日志，此配置是防止 `reset --hard` 后悔的生命线。 |
| **`core.logAllRefUpdates`** | `true` | `true` | 控制是否写日志。除非是在只读的 CI 环境或存储极其敏感的裸仓库中，否则必须保持为 `true`。 |
| **`gc.pruneExpire`** | `2 weeks` | `2 weeks` | 当 `git gc` 运行时，任何未被引用的松散对象只有早于该时间才会被真正物理删除。 |
