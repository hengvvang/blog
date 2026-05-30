# 交互式变基 Todo 列表与核心指令详解

交互式变基（Interactive Rebase）的核心在于其交互式编辑器界面。当运行 `git rebase -i <commit-ish>` 时，Git 会生成一个文本清单（即 **Todo 列表**），该清单指示了 Git 在重放历史时需要对每一项提交执行什么操作。

本章将深度剖析这个 Todo 列表的结构设计，并详尽剖析现代 Git 所支持的每一项动作指令（Action Command），帮助你像乐团指挥家一样精准调度每一次历史回放。

---

## 1. 启动交互式变基

我们可以通过多种方式指定变基的“起点”（即**基底提交**，这个提交本身不会被修改，变基将应用于它**之后**的所有提交）：

```bash
# 针对最近的 4 次提交进行交互式变基
git rebase -i HEAD~4

# 针对某个特定的提交哈希值之后的所有提交进行变基
git rebase -i a1c2e3f

# 基于 main 分支的最新位置，对当前分支的独有提交进行变基
git rebase -i main
```

运行上述命令后，Git 会拉起你在系统或 Git 配置中设定的文本编辑器（如 VS Code、Vim、Nano 等），展示如下格式的 Todo 文本文件：

```text
pick a1b2c3d 增加用户登录界面
pick d4e5f6g 修复拼写错误
pick h7i8j9k 编写登录接口单元测试
pick l0m1n2o 优化文档

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
#
```

> [!IMPORTANT]
> **关键认知：时间线的颠倒**
> 当我们运行 `git log` 时，最新的提交通常显示在最顶部（逆序排列）。
> 然而，在 **Interactive Rebase Todo 列表** 中，提交是按**从旧到新（时间正序）** 从上到下排列的。第一行表示最老的提交（最先被应用），最后一行表示最新的提交（最后被应用）。

---

## 2. 核心动作指令详解

你可以通过修改每一行开头的单词（或其单字母缩写）来指定 Git 如何处理该提交。

### ① `pick` (p) —— 保留并应用提交
*   **作用**：默认指令。Git 会直接应用该提交，不作任何修改。
*   **应用场景**：当你只想重排提交顺序，或者只对其中某几个特定的提交做处理时，其余提交保持 `pick` 即可。

### ② `reword` (r) —— 修改提交日志信息
*   **作用**：应用该提交的内容，但会在重放到该提交时暂停，并弹出一个新的编辑器窗口，允许你修改此提交的日志信息。
*   **应用场景**：修复提交信息中的错别字，或者补充更符合规范的 Commit Message。
*   **示例**：
    ```text
    reword a1b2c3d 增加用户登录界面  # 变基启动后将在此暂停以编辑日志
    pick d4e5f6g 修复拼写错误
    ```

### ③ `edit` (e) —— 暂停处理以修改提交内容
*   **作用**：极其强大。Git 会在重放到该提交后**完全暂停变基流程**，并将控制权交还给终端。此时，你的工作区和暂存区会退回到该提交刚刚完成的状态。你可以：
    *   修改文件代码。
    *   使用 `git add` 暂存新修改。
    *   使用 `git commit --amend` 将修改并入该提交。
    *   将该提交拆分为多个提交（详情见第 3 章）。
*   **应用场景**：补充遗漏的代码、修改历史提交中的特定 Bug，或者进行提交拆分。
*   **操作命令流**：
    1.  当变基暂停在 `edit` 指定的提交时，修改文件 `src/auth.c`。
    2.  运行 `git add src/auth.c`。
    3.  运行 `git commit --amend` 覆盖当前提交。
    4.  运行 `git rebase --continue` 继续后续的变基过程。

### ④ `squash` (s) —— 合并提交至前一项（保留日志）
*   **作用**：将当前行的提交合并到**它上一行**的提交中。Git 会在重放完这些合并项后，弹出一个编辑器，将这几个提交的日志信息列在一起，供你重新整理和合并为一个完整的日志。
*   **应用场景**：将一系列连续的、针对同一功能单元的局部提交（例如功能开发、测试编写、文档补全）合并为一个意义完整的单一提交。
*   **示例**：
    ```text
    pick a1b2c3d 增加用户登录界面
    squash d4e5f6g 修复拼写错误
    squash h7i8j9k 编写登录接口单元测试
    ```
    *运行后，上述三个提交会合并为一个提交，包含三者的全部修改，并允许你把三行日志合并编辑为：`feat: 增加用户登录界面及单元测试`*。

### ⑤ `fixup` (f) —— 合并提交至前一项（丢弃日志）
*   **作用**：类似于 `squash`，将当前提交合并到上一个提交中。但它会**直接丢弃**当前提交的日志，只保留前一个提交的日志。
*   **应用场景**：清理零碎的临时修改（如 `fix typo`、`debug`），这些提交的修改是必需的，但其提交日志毫无保留价值。
*   **选项扩展（现代 Git 支持）**：
    *   `fixup -C <commit>`：使用指定提交的日志替换合并后的日志。
    *   `fixup -c <commit>`：与 `-C` 类似，但会拉起编辑器让你微调日志。
*   **示例**：
    ```text
    pick a1b2c3d 增加用户登录界面
    fixup d4e5f6g 修复拼写错误        # 该提交的修改并入 a1b2c3d，但日志被丢弃
    ```

### ⑥ `exec` (x) —— 执行 Shell 脚本/命令
*   **作用**：在上一行提交被应用后，Git 会在终端执行该行指定的任意 Shell 命令。如果命令执行成功（退出状态码为 0），变基继续；如果命令失败（退出状态码非 0），变基将自动挂起，允许你检查现场并修复代码。
*   **应用场景**：在重写历史的每一步自动运行单元测试或静态扫描，确保历史重写没有破坏代码的编译或测试。
*   **示例**：
    ```text
    pick a1b2c3d 增加用户登录界面
    exec npm run test                  # 执行测试，若失败则暂停变基
    pick h7i8j9k 编写登录接口单元测试
    exec npm run test                  # 再次执行测试
    ```

### ⑦ `drop` (d) —— 彻底丢弃提交
*   **作用**：完全删除该提交及其引入的所有代码修改。
*   **应用场景**：放弃某个已经提交的不成熟的试验性功能。
*   **等效操作**：在 Todo 列表中**直接删除该行**，保存退出后，Git 同样会彻底丢弃该提交。
*   **示例**：
    ```text
    pick a1b2c3d 增加用户登录界面
    drop d4e5f6g 垃圾代码提交          # 这一行代表的修改和提交将被彻底抹去
    pick h7i8j9k 编写登录接口单元测试
    ```

### ⑧ `break` (b) —— 手动插入断点暂停变基
*   **作用**：在执行到这一行时，变基流程会立刻暂停，类似于调试器中的断点（Breakpoint）。
*   **应用场景**：在两个提交之间进行复杂的现场检查或环境部署，不需要绑定在特定的 Commit 上。运行 `git rebase --continue` 恢复。

### ⑨ `label`, `reset`, `merge` —— 拓扑变基指令
*   这些指令通常是 Git 在使用 `--rebase-merges`（旧版为 `--preserve-merges`）选项时自动生成的。
    *   `label <name>`：在当前变基的临时 HEAD 上标记一个虚拟标签。
    *   `reset <label>`：将当前 HEAD 重置到之前标记的标签位置。
    *   `merge -C <commit> <label>`：使用指定的提交信息，将标记的标签分支与当前 HEAD 合并。
*   它们共同配合，使得 Git 可以在变基过程中**重构复杂的非线性分支网络（保留分支的合并拓扑关系）**，而不仅是单线重放。

---

## 3. 提交顺序的重排与删除

在交互式变基中，调整提交的历史顺序极其简单。你只需要在编辑器中**直接移动整行的位置**即可。

### 示例：改变提交顺序
原 Todo 清单：
```text
pick a1b2c3d 增加用户登录界面
pick d4e5f6g 修复拼写错误
pick h7i8j9k 编写登录接口单元测试
```

修改后的 Todo 清单：
```text
pick h7i8j9k 编写登录接口单元测试
pick a1b2c3d 增加用户登录界面
pick d4e5f6g 修复拼写错误
```

### 潜在风险与注意事项
当你将 `h7i8j9k`（编写登录接口单元测试）移动到 `a1b2c3d`（增加用户登录界面）之前应用时，如果测试代码中引用了登录界面里定义的新函数，或者两份提交修改了同一文件的相同区域，Git 会在重放 `h7i8j9k` 时由于失去上下文而报出**合并冲突**（Merge Conflict）。
因此，重排提交顺序时，需确保提交之间具有较低的物理耦合度。

---

## 4. 变基生命周期状态管理

当你保存并关闭 Todo 编辑器后，Git 会正式接管并开始按照动作清单逐步执行。

### 状态暂存目录
在变基执行期间，Git 会在工作区根目录下创建名为 `.git/rebase-merge/` 的隐藏目录。该目录保存了：
*   `git-rebase-todo`：尚未执行的剩余 Todo 动作清单。
*   `done`：已经成功执行的动作清单。
*   `head-name`：变基结束后需要更新的原始分支名称。
*   `onto`：目标基底提交的哈希值。

### 驱动控制命令
在变基中途因 `edit`、`break` 或冲突而暂停时，你可以通过以下命令控制生命周期：

*   `git rebase --continue`：在完成当前步骤的修改或解决冲突后，指示 Git 继续读取剩余的 Todo 列表。
*   `git rebase --abort`：**绝对安全的撤销药水**。立即终止变基操作，清理所有临时状态，并将你的工作区、暂存区及分支指针完美还原到**执行 `git rebase -i` 之前的状态**。
*   `git rebase --skip`：跳过当前暂停的提交，继续应用后面的提交。**注意**：这会导致当前提交的所有独有修改丢失，应谨慎使用。
