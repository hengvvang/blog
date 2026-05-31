# 第二章：交互式变基 Todo 文件操作规范

在 Git 的高级版本控制体系中，交互式变基（Interactive Rebase）是开发人员进行分支清理和提交历史重塑的最强武器。它提供了一个基于文本清单的交互式运行脚本——即 **Todo 列表**，允许我们像调度员一样，对分支历史中的每一次提交进行单独的控制。

本章将详细剖析交互式变基的启动机制、Todo 文件的内部构造、现代 Git 支持的各项动作指令，以及整个变基生命周期的状态管理。

---

## 1. 启动交互式变基

进行交互式变基时，我们需要指定一个**基底提交（Base Commit）**。特别需要注意的是：**变基操作只应用于该基底提交之后的提交，基底提交本身是不受影响的。**

### A. 常用启动命令
```bash
# 1. 针对当前分支最近的 4 次提交进行变基
git rebase -i HEAD~4

# 2. 针对某个特定的提交哈希（例如 a1c2e3f）之后的所有提交进行变基
git rebase -i a1c2e3f

# 3. 基于 main 分支的最新位置，整理当前分支特有的本地提交
git rebase -i main

# 4. 针对某个分支的根提交执行变基（通常用于整理项目初始历史）
git rebase -i --root
```

### B. Todo 编辑器界面剖析
启动命令后，Git 会拉起你系统配置的默认文本编辑器（如 Vim、VS Code、Nano），展示一个名为 `git-rebase-todo` 的临时文件。该文件的物理内容结构如下：

```text
pick a1b2c3d 增加用户登录界面
pick d4e5f6g 修复拼写错误
pick h7i8j9k 编写登录接口单元测试
pick l0m1n2o 优化文档说明

# 变基项将被从上到下依次执行。
#
# Commands:
# p, pick <commit> = use commit
# r, reword <commit> = use commit, but edit the commit message
# e, edit <commit> = use commit, but stop for amending
# s, squash <commit> = use commit, but meld into previous commit
# f, fixup [-C | -c] <commit> = like "squash" but keep only the previous
#                    commit's log message, unless -C is used to recreate
#                    the commit message from scratch, or -c with -C;
#                    -c is same as -C but opens the editor
# x, exec <command> = run command (the rest of the line) using shell
# b, break = stop here (the rebase will continue later with 'git rebase --continue')
# d, drop <commit> = remove commit
# l, label <label> = label current HEAD with a name
# t, reset <label> = reset HEAD to a label
# m, merge [-C <commit> | -c <commit>] <label> [# <oneline>]
#                    create a merge commit using the original merge commit's
#                    message (or the oneline, if no original merge commit was
#                    specified). Use -c <commit> to reword the commit message.
#
# These lines can be re-ordered; they are executed from top to bottom.
#
# If you remove a line here THAT COMMIT WILL BE LOST.
#
# However, if you remove everything, the rebase will be aborted.
```

> [!IMPORTANT]
> **关键认知：时间线的颠倒**
> 当我们运行 `git log` 时，最新提交（Newest）显示在最顶部（时间逆序）。
> 然而，在 **Interactive Rebase Todo 列表** 中，提交是按照**从旧到新（时间正序）** 从上到下排列的。第一行代码代表最老的提交（最先应用），最后一行代表最新的提交（最后应用）。

---

## 2. 核心动作指令（Action Commands）详解

你可以通过修改 Todo 文件中每一行开头的单词（或其单字母缩写）来决定 Git 重新应用该提交时的动作。以下是全套指令的深度解密及应用场景：

### ① `pick` (p) —— 保留并应用提交
- **语义**：直接应用该提交，不作任何内容或信息的改变。
- **示例**：
  ```text
  pick a1b2c3d 增加用户登录界面
  ```

---

### ② `reword` (r) —— 修改提交日志信息
- **语义**：应用该提交的内容变更，但在应用时，Git 会暂停变基流程并拉起文本编辑器，允许你修改此提交的日志消息（Commit Message）。
- **应用场景**：修复 Commit 消息中的拼写错误，或者根据团队的 Commit 规范（如 Angular 规范）重新格式化历史提交信息。
- **示例**：
  ```text
  reword d4e5f6g fix typo in config -> 变基在此处会暂停，弹出窗口供你重新编辑日志
  ```

---

### ③ `edit` (e) —— 暂停处理以修改提交内容
- **语义**：变基会在应用完该提交的内容后**立即暂停**，并将控制权交还给终端。此时，工作区将回退到该提交完成时的状态。你可以对文件进行修改、重新暂存、执行 `git commit --amend`，甚至将此提交拆分为多个提交。
- **操作生命周期命令流**：
  1. 变基暂停在 `edit` 指定的提交处。
  2. 在工作区中修改文件，例如修改 `src/auth.c`。
  3. 执行 `git add src/auth.c`。
  4. 执行 `git commit --amend` 覆盖该提交。
  5. 运行 `git rebase --continue` 恢复后续的变基过程。

---

### ④ `squash` (s) —— 合并提交至前一项（合并日志）
- **语义**：将当前提交的代码修改并入**上一行**的提交中。Git 会在重放完这些合并项后，拉起编辑器，将这些提交的原始日志合并在一起，由你编辑整理为一个完整的 Commit 消息。
- **应用场景**：把一系列细碎的、为了实现某一独立特性的本地多次临时提交，合并为一个原子提交。
- **示例**：
  ```text
  pick a1b2c3d 增加用户登录界面
  squash d4e5f6g 修复拼写错误
  squash h7i8j9k 编写登录接口单元测试
  ```
  *执行结果：上述三个提交将被压缩为一个提交，Git 会让你把三行日志编辑为：`feat: 增加登录界面并补全测试与拼写修复`*。

---

### ⑤ `fixup` (f) —— 合并提交至前一项（丢弃日志）
- **语义**：类似于 `squash`，将当前提交并入上一个提交中，但它会**直接丢弃**当前提交的 Commit 消息，只保留前一个提交的 Commit 消息。
- **扩展用法**：现代 Git 支持额外的子选项：
  - `fixup -C <commit>`：使用指定提交的日志替换合并后的日志。
  - `fixup -c <commit>`：与 `-C` 类似，但会拉起编辑器让你微调日志。
- **示例**：
  ```text
  pick a1b2c3d 增加用户登录界面
  fixup d4e5f6g 修正临时 debug 打印 -> 该提交的修改并入 a1b2c3d，但此处的 debug 日志被无声丢弃
  ```

---

### ⑥ `exec` (x) —— 执行 Shell 命令
- **语义**：在上一行提交被应用后，Git 会在你的系统终端（Shell）中执行该行指定的任意命令。如果命令执行退出码为 0，变基继续；如果退出码非 0，变基自动暂停，便于你检查代码。
- **应用场景**：在整理历史提交的过程中，自动逐个构建项目或运行单元测试，确保你的重构没有破坏代码库的编译和测试完整性。
- **示例**：
  ```text
  pick a1b2c3d 增加用户登录界面
  exec make test                  # 检查该提交是否能通过单元测试
  pick h7i8j9k 编写单元测试
  exec make test                  # 再次检查
  ```

---

### ⑦ `drop` (d) —— 彻底丢弃提交
- **语义**：将该提交及其引入的所有代码修改彻底删除。
- **注意**：在 Todo 文件中**直接删除整行提交**，其效果完全等同于将该行命令改为 `drop`。
- **示例**：
  ```text
  pick a1b2c3d 增加用户登录界面
  drop d4e5f6g 误提交的敏感配置文件  # 该提交的代码及痕迹将被彻底清除
  ```

---

### ⑧ `break` (b) —— 手动插入断点暂停变基
- **语义**：在此处立即暂停变基，相当于在变基的脚本执行流中打上断点。开发人员可以在终端检查当前文件结构，修改完成后执行 `git rebase --continue` 恢复。

---

### ⑨ `label` (l) / `reset` (t) / `merge` (m) —— 拓扑变基指令
- **语义**：这组指令一般不由用户手动编写，而是 Git 在使用 `--rebase-merges` 选项变基时，为保留并重建原分支网络中的非线性合并网络拓扑而自动生成的。
  - `label <name>`：在当前临时 HEAD 位置做一个别名标记。
  - `reset <label>`：将 HEAD 重置到之前标记的位置。
  - `merge -C <commit> <label>`：将指定标记的分支与当前 HEAD 进行合并。

---

## 3. 提交顺序的重排与物理机制

在 Todo 文件中，调整提交的历史顺序极其简单直观——**你只需在编辑器中直接调换代码行的上下物理顺序即可**。

```text
[调整前]
pick a1b2c3d 增加用户登录界面
pick d4e5f6g 修复拼写错误
pick h7i8j9k 编写登录接口单元测试

[调整后 - 将测试提交挪到最前面应用]
pick h7i8j9k 编写登录接口单元测试
pick a1b2c3d 增加用户登录界面
pick d4e5f6g 修复拼写错误
```

### ⚠️ 重排的潜在冲突风险
当你在 Todo 文件中改变了提交的顺序时，Git 会试图将补丁按新顺序应用。如果 `h7i8j9k`（测试代码）中使用了 `a1b2c3d`（登录界面）中定义的新函数，那么在第一步应用 `h7i8j9k` 时，就会因为缺少前置函数定义而导致**合并冲突**或**编译失败**。
因此，进行顺序重排前，务必评估提交之间的内容耦合度。

---

## 4. 变基生命周期的底层状态管理

当你保存并关闭 Todo 文件编辑器后，Git 开始进入自动变基重放阶段。在这期间，Git 会在工作区根目录下创建名为 `.git/rebase-merge/`（在某些早前版本中为 `.git/rebase-apply/`）的隐藏文件夹。

### A. 状态跟踪文件夹内部构造
- **`git-rebase-todo`**：保存着当前变基流程中尚未执行的剩余 Todo 动作清单。
- **`done`**：记录已经成功执行完的动作清单。
- **`head-name`**：保存变基前原始分支的完整引用名称（例如 `refs/heads/feature`）。
- **`onto`**：保存变基的目标基底 Commit 哈希值。
- **`msgnum`** / **`end`**：用于跟踪当前正在执行第几个提交的计数器。

---

### B. 核心控制命令
如果在变基过程中因为 `edit`、`break` 动作或发生冲突导致变基暂停，你必须通过以下生命周期命令向 Git 发出后续驱动指令：

```bash
# 1. 恢复运行：在解决冲突或完成 edit 修改后，指示 Git 继续读取并执行剩下的 Todo 列表
git rebase --continue

# 2. 终止并撤销：立即放弃本次变基操作，清理所有临时状态，完美还原到运行 git rebase -i 之前的状态
git rebase --abort

# 3. 跳过当前步骤：跳过当前引发冲突或暂停的提交，继续应用后面的提交
# 警告：这会导致当前这个提交所引入的所有代码修改彻底丢失，极少在生产环境中使用！
git rebase --skip
```

### C. 典型变基生命周期状态转换图

```text
                   [ 运行 git rebase -i ]
                             │
                             ▼
                   ┌───────────────────┐
                   │  编辑 Todo 清单   │
                   └─────────┬─────────┘
                             │ (保存并退出)
                             ▼
                    [ 开始逐个重放提交 ] ◄─────────────────────────┐
                             │                                    │
               ┌─────────────┴─────────────┐                      │
               ▼                           ▼                      │
         [ 遇到 edit/break ]        [ 遭遇合并冲突 ]              │
               │                           │                      │
               ▼                           ▼                      │
         ┌───────────┐               ┌───────────┐                │
         │ 终端暂停  │               │ 冲突挂起  │                │
         └─────┬─────┘               └─────┬─────┘                │
               │                           │                      │
       (修改代码/拆分提交)           (手动合并冲突文件)           │
               │                           │                      │
         ┌─────▼─────┐               ┌─────▼─────┐                │
         │  git add  │               │  git add  │                │
       (暂存最新修改)                (标记冲突已解决)              │
               │                           │                      │
         ┌─────▼─────┐                     │                      │
         │--amend提交│                     │                      │
         └─────┬─────┘                     │                      │
               │                           │                      │
               └─────────────┬─────────────┘                      │
                             │                                    │
                             ▼                                    │
                 [ git rebase --continue ] ───────────────────────┘
                             │
                      (所有提交处理完毕)
                             │
                             ▼
                 [ 变基圆满结束，更新指针 ]
```

通过掌握这一套结构化的动作命令与生命周期管控机制，你就可以在变基执行时保持百分之百的掌控力，沉着应对任何复杂的分支重构场景。
