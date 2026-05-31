# 第二章：基于 Reflog 的误删分支与丢失 Commit 灾难恢复

在理解了 Reflog 的物理存储格式后，本章我们将切入实际应用场景，系统学习如何在遭遇灾难性误操作时进行数据抢救。

无论是执行了破坏性的重置（`git reset --hard`），还是强行删除了未合并的分支（`git branch -D`），只要了解 Git 的对象模型和引用日志，都可以将其完好无损地恢复。

---

## 2.1 恢复的核心理论：不可达提交与悬空对象

在 Git 底层，所有版本历史都是通过一系列不可变的对象（Commit、Tree、Blob）以有向无环图（DAG）的拓扑结构连接起来的。

```text
               ┌───► [ Commit C1 ] ───► [ Commit C0 (Root) ]
               │
[ 分支指针 ] ──┼───► [ Commit C2 ] (工作树当前指向)
               │
               ▼ (由于 reset --hard，指向被扯断)
             [ Commit C3 (悬空/不可达) ] ───► [ Commit C4 (悬空/不可达) ]
```

* **可达提交（Reachable Commit）**：从当前任意一个有效引用（本地分支、远程分支、标签、HEAD 指针）出发，能够沿着 `parent` 指针链条逆向追溯到的提交。
* **不可达提交/悬空对象（Unreachable Commit / Dangling Object）**：不属于任何分支或标签的历史链路，从外部引用无法触及的对象。

**Git 的写安全保障**：当你执行 `git reset --hard HEAD~1` 时，Git 仅仅是将分支指针和 HEAD 文件中的 SHA-1 值修改为前一个提交的哈希，并更新工作区。**原提交对象（如上面的 C3、C4）在磁盘上的物理文件并不会被删除**。它们只是失去了引用的冠名，变成“不可达提交”。

在被垃圾回收（GC）物理清除之前，这些悬空对象会一直存留在 `.git/objects/` 中。而本地的 Reflog，则是记录这些不可达提交哈希值的唯一时序索引。

---

## 2.2 核心审计与检索命令

在抢救数据时，有三个核心命令是必须熟练掌握的：

### 1. `git reflog show`（或 `git reflog`）
这是 `git log -g --abbrev-commit --pretty=oneline` 的快捷方式。它能够快速列出 HEAD 指针的物理跳变轨迹。

```bash
# 查看本地 HEAD 历史变迁记录，限制显示前 15 条
$ git reflog HEAD -n 15
```

### 2. `git log -g` (`--walk-reflogs`)
如果需要看更详细的提交元数据（如完整的作者姓名、邮箱、精确的提交日期、以及多行提交注释），可以使用此命令。它会像遍历提交历史一样遍历 Reflog 链表。

```bash
# 以常规详细日志形式展示 Reflog 中的提交信息，配合 -p 还可以查看代码差异
$ git log -g --oneline -p
```

### 3. `git fsck` (File System Consistency Check)
如果某引用的日志已经丢失，或者你误执行了 `git reflog delete` 删除了日志，我们可以直接使用 `git fsck` 工具扫描磁盘上的所有松散对象，找出所有的“悬空（Dangling）”节点。

```bash
# 扫描数据库，检查对象一致性，并将所有悬空对象的哈希值及其类型输出
$ git fsck --lost-found
```

---

## 2.3 三大灾难恢复实战演练

### 场景一：找回因 `git reset --hard` 丢失的本地提交

**灾难模拟**：你在本地 `main` 分支上开发，不小心执行了强力重置，回滚了 3 个提交，且清空了工作区与暂存区：

```bash
# 误操作：强行回滚 3 个提交
$ git reset --hard HEAD~3
# 输出提示：HEAD 已经指向了 3 个版本前的哈希值
HEAD is now at 8b4a2d1 feat: initialize project structure
```
你刚才辛苦编写并提交的 3 个 Commit 在普通的 `git log` 中瞬间消失了。

#### 恢复步骤：

1. **查看 HEAD 的引用历史**：
   运行 `git reflog HEAD`，查找发生 `reset` 操作前的最后一次提交：
   ```bash
   $ git reflog HEAD
   8b4a2d1 HEAD@{0}: reset: moving to HEAD~3 # 当前位置，即回滚后的起点
   f29dca4 HEAD@{1}: commit: fix: handle null pointer in network loop # 丢失的最新提交
   d4c1b92 HEAD@{2}: commit: feat: integrate task watermarks scheduler
   a1b8c22 HEAD@{3}: commit: feat: design hardware register layouts
   ```
   *分析：根据时序，`HEAD@{0}` 是你刚才执行重置的记录。而在重置之前，HEAD 指向的最新提交是 `HEAD@{1}`，其对应哈希值为 `f29dca4`。*

2. **验证丢失提交的内容**：
   在执行恢复前，先用 `git show` 确认该哈希的内容是否确实是你要找回的修改：
   ```bash
   # 查看哈希为 f29dca4 的提交详情
   $ git show f29dca4
   commit f29dca4b76e1a491e8432a11883bfd12cd4e0621
   Author: hengvvang <hengvvang@example.com>
   Date:   Sat May 30 19:40:00 2026 +0800
   
       fix: handle null pointer in network loop
   ...
   ```

3. **执行数据恢复**：
   根据实际开发需求，有三种不同的恢复策略：

   * **策略 A：将当前分支直接重置回丢失的提交**（适合需要完整保留刚才的提交历史，直接在此基础上继续开发）：
     ```bash
     # 强行将分支指针重置回 f29dca4，恢复工作区和暂存区
     $ git reset --hard f29dca4
     HEAD is now at f29dca4 fix: handle null pointer in network loop
     ```

   * **策略 B：在丢失的提交上新建临时分支**（最安全，推荐，不会影响当前分支状态）：
     ```bash
     # 以 f29dca4 为基准创建名为 recovery-branch 的新分支
     $ git branch recovery-branch f29dca4
     # 此时可以切换到新分支检查或与原分支进行合并
     $ git checkout recovery-branch
     ```

   * **策略 C：仅仅摘取特定的单个提交（Cherry-pick）**（如果只想挽回误删历史中的某一个特性）：
     ```bash
     # 将特定的 commit 捡选并合并到当前分支
     $ git cherry-pick d4c1b92
     ```

---

### 场景二：找回误删的未合并本地分支

**灾难模拟**：由于本地特性开发完毕或需求变更，你使用 `-D` 强行删除了一个未被合并的本地分支：

```bash
# 误操作：强行删除分支
$ git branch -D feature/leak-detector
Deleted branch feature/leak-detector (was 5e1a2f4).
```
随后项目经理告诉你该分支上还有些未合并的代码需要找回，而此时你执行 `git branch` 已经看不到它。

#### 恢复步骤：

1. **通过 HEAD 历史查找分支指针的最后位置**：
   因为你在那个分支上工作过，HEAD 指针必然停留过该分支的尖端提交。
   ```bash
   # 查看 reflog，寻找 feature/leak-detector 分支活动轨迹
   $ git reflog
   8b4a2d1 HEAD@{0}: checkout: moving from feature/leak-detector to master
   5e1a2f4 HEAD@{1}: commit: test: add stack overflow simulation cases
   ```
   *分析：`HEAD@{0}` 记录了你从 `feature/leak-detector` 切换回 `master`。而 `HEAD@{1}` 则说明在 `feature/leak-detector` 分支上进行的最后一次操作是提交了哈希为 `5e1a2f4` 的 Commit。这就是该分支删除前的尖端。*

2. **重建分支指针**：
   使用 `git branch <分支名> <哈希值>` 在目标哈希上重建分支：
   ```bash
   # 重建 feature/leak-detector 分支
   $ git branch feature/leak-detector 5e1a2f4
   ```
   分支指针重建后，不仅该分支的历史全部找回，且其整个父节点链条也完全被接回了 DAG 中。

---

### 场景三：找回“未提交”但已暂存（git add）的代码

**灾难模拟**：这是一个极端的考验——**代码尚未执行 `git commit`，但执行过 `git add` 将修改存入了暂存区。随后你误执行了 `git reset --hard HEAD`。**

*由于没有 Commit，所有的 `.git/logs/` 的 Reflog 日志中根本没有该操作记录！这还能救吗？*

**答案是：可以！**
当文件被 `git add` 放入暂存区时，Git 会根据文件内容计算哈希并立即将其作为“松散对象”（Loose Object）写入磁盘上的 `.git/objects/` 中（即写入 Blob 对象）。虽然重置清空了暂存区索引，但磁盘上的物理 Blob 对象依然存在，它只是成了没有 Commit 或 Tree 指向的**悬空 Blob（Dangling Blob）**。

#### 恢复步骤：

1. **通过 `git fsck` 扫描悬空对象**：
   ```bash
   # 扫描数据库，找出所有悬空的对象
   $ git fsck --lost-found
   Checking object directories: 100% (256/256), done.
   dangling blob 3c01a2f8b4d1c4e99f0e1c5f8b9d03c2718e38d4
   dangling commit 5e1a2f4b23c...
   ```
   在输出中，你会看到形如 `dangling blob <SHA>` 的记录。Git 同时还会贴心地将这些悬空对象拷贝到 `.git/lost-found/other/` 目录下（如果是 commit 对象，会放到 `.git/lost-found/commit/` 下）。

2. **查看悬空 Blob 的内容**：
   使用管道命令 `git cat-file -p` 打印内容，找出我们丢失的源码：
   ```bash
   # 查看该悬空 Blob 的具体文本内容
   $ git cat-file -p 3c01a2f8b4d1c4e99f0e1c5f8b9d03c2718e38d4
   #include <stdio.h>
   // 丢失的未提交代码：栈深度监控核心逻辑
   void monitor_stack_depth() {
       ...
   }
   ```

3. **还原文件**：
   重定向输出，重新拉回工作区：
   ```bash
   # 将悬空 Blob 重新写回源码文件
   $ git cat-file -p 3c01a2f8b4d1c4e99f0e1c5f8b9d03c2718e38d4 > src/monitor.c
   ```

---

## 2.4 恢复过程的拓扑关系变化展示（找回悬空 Commit）

下面这个图清晰展示了被 `reset` 后的悬空提交（Orphan Commit）是如何通过 Reflog 寻获哈希并以 `git branch` 重新接回主图谱的：

```text
1. 发生重置后的孤立状态 (C3、C4 失去外部引用指向，成为 Dangling)

   [ refs/heads/master ] ──► [ C2 ] ──► [ C1 ] ──► [ C0 ]
                              ░
                              ░ (逻辑上断裂)
                              ▼
                           [ C3 ] ◄─── [ C4 ] (悬空，无法在常规 log 中看到)
                                         ▲
                                         │ (Reflog 中记录的最后落脚点: HEAD@{1})
                                  [.git/logs/HEAD]


2. 运行 git branch recovery-branch C4 后 (重建指向 C4 的分支指针)

   [ refs/heads/recovery-branch ] ──────┐
                                         │
                                         ▼
   [ refs/heads/master ] ──► [ C2 ] ◄── [ C3 ] ◄── [ C4 ]
                              │
                              ▼
                            [ C1 ] ──► [ C0 ]
```

> [!CAUTION]
> **Reflog 恢复的局限性**：如果文件从未执行过 `git add`（也即从未进入过 Git 的暂存区/对象数据库），那么这些修改仅存在于操作系统的内存或磁盘未分配扇区中。在这种情况下，Git 对此无能为力，必须借助底层操作系统的文件恢复软件进行处理。因此，**频繁执行 `git add` 或临时 commit 是个极佳的防丢习惯。**
