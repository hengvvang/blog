# 第三章：分支线性整理与冲突解决实战

在掌握了交互式变基（Interactive Rebase）的基本 Todo 指令之后，开发人员通常需要面对更复杂的工程实践难题：如何拆分庞大的单次提交、如何高效且正确地解决变基过程中的代码冲突、如何在复杂的嵌套分支中移植提交（`--onto`）、如何配置自动清理流，以及在操作失误破坏历史时进行无损恢复。

本章将通过详细的步骤演练、命令行实战及拓扑图解，全面攻克这些高级应用场景。

---

## 1. 拆分提交 (Splitting Commits)

在持续交付的工程规范中，**原子提交（Atomic Commits）** 是至关重要的原则：每个提交应该只包含一个逻辑变更，且该提交下的代码能够正常通过构建和测试。
如果你在本地开发时，不小心将“注册功能”和“密码找回功能”打包进了一个大提交，通过 `edit` 动作可以优雅地将其拆分为多个独立的小提交。

### A. 拆分操作核心原理
利用 `edit` 指令暂停变基后，工作区会停留在目标提交处。此时我们可以通过**混合重置（`git reset HEAD^`）**，将 HEAD 指针向后退一步，但**保留**所有文件修改在工作区中，然后分批次进行暂存（`add`）并提交。

### B. 详细拆分步骤演练
假设我们要拆分最近的第 2 次提交：

1. **启动变基**：
   ```bash
   # 针对最近的 3 次提交进行变基
   git rebase -i HEAD~3
   ```
2. **设置动作为 `edit`**：
   在弹出的 Todo 清单中，将需要拆分的提交前的 `pick` 修改为 `edit`（或 `e`），然后保存退出：
   ```text
   pick a1b2c3d feat: 增加用户登录界面
   edit d4e5f6g feat: 增加注册功能与密码找回功能  # 将此行改为 edit
   pick h7i8j9k feat: 编写登录接口单元测试
   ```
3. **变基中途暂停**：
   Git 运行到该提交并暂停，终端返回提示：
   ```text
   Stopped at d4e5f6g...  feat: 增加注册功能与密码找回功能
   You can amend the commit now, with ...
   Once you are satisfied with your changes, run ... git rebase --continue
   ```
4. **撤销提交，保留工作区**：
   执行 `git reset` 撤销刚刚应用的 `d4e5f6g` 提交，此时所有修改过的代码文件都将变为未暂存（unstaged）状态：
   ```bash
   # 撤销当前提交，工作区内容保持不变
   git reset HEAD^
   ```
5. **分批暂存与提交（原子化提交）**：
   - **第一步：提取注册功能并提交**
     ```bash
     # 仅暂存与注册相关的代码文件
     git add src/register.c src/register.h
     
     # 创建第一个精细化提交
     git commit -m "feat: 增加用户注册功能"
     ```
   - **第二步：提取密码找回功能并提交**
     ```bash
     # 暂存剩余的修改文件
     git add src/password_recovery.c src/password_recovery.h
     
     # 创建第二个精细化提交
     git commit -m "feat: 增加密码找回及验证功能"
     ```
6. **完成变基流程**：
   确认 `git status` 中工作区已干净，通知 Git 继续后续的变基重放：
   ```bash
   # 继续应用后面的 pick 提交
   git rebase --continue
   ```

---

## 2. 冲突解决流程 (Conflict Resolution)

由于变基是在新的基底上依次重新应用补丁，如果基底代码与你的补丁修改了同一文件的相同区域，就会触发冲突，导致变基暂停。

### A. ⚠️ 核心心智模型：变基冲突时的 HEAD 指向
在普通的 `git merge` 冲突中：
- `HEAD` 指向的是你当前所在的分支（如 `feature`）。
- 冲突下方指向的是你尝试合入的分支（如 `main`）。

但在 **`git rebase` 冲突中，这个方向刚好相反**：
- `<<<<<<< HEAD` 指向的是**当前的基底分支**（即你正在把修改往上挂的那个分支，例如主干 `main` 上的最新代码）。
- `>>>>>>> <commit_summary>` 指向的则是**你正在重放的本地提交**（即你自己的 feature 分支上的修改）。

#### 冲突标记物理示意图：
```text
<<<<<<< HEAD
// 目标分支（例如 main）上的最新代码（基底）
int get_port() { return 8080; }
=======
// 你正在尝试重放的本地提交（例如 d4e5f6g... feat: add login logic）中的代码
int get_port() { return 9090; }
>>>>>>> d4e5f6g... feat: add login logic
```

### B. 冲突排查与解决闭环
当变基由于冲突暂停时，终端会输出明显的冲突警告。此时你应当按照以下流程处理：

1. **查看冲突状态**：
   ```bash
   # 运行 status，Git 会用红字标出 "Both modified:" 的冲突文件
   git status
   ```
2. **手动解决冲突**：
   打开冲突文件（如 `src/main.c`），决定保留哪部分代码，并**删除冲突标记行**（`<<<<<<<`, `=======`, `>>>>>>>`）。
3. **标记冲突已解决**：
   ```bash
   # 将解决冲突后的文件暂存，告诉 Git 该冲突已处理完毕
   git add src/main.c
   ```
4. **推进变基（切忌使用 commit）**：
   > [!WARNING]
   > 在暂存已解决冲突的文件后，**绝对不要运行 `git commit`**。因为运行 `git commit` 会在当前的中间状态创建一个新的独立提交，从而导致变基工作流脱轨。你必须且只能使用 `continue` 推进：
   ```bash
   # 让 Git 继续重放下一个提交的补丁
   git rebase --continue
   ```
5. **安全退出的退路**：
   如果在解决冲突时场面过于混乱，或者担心代码改坏，你可以随时通过以下命令一键恢复到变基前的状态：
   ```bash
   # 彻底终止变基，回滚工作区与暂存区
   git rebase --abort
   ```

---

## 3. 跨越基底的变基：`git rebase --onto`

`git rebase --onto` 是 Git 变基指令中极其强悍的高级特技。它允许你将一个分支中的特定提交段“嫁接”到一个完全无关的基底上。

### A. 适用场景：三层嵌套分支脱钩
假设开发中存在这样的依赖关系：
- 团队基于 `main` 开发。
- 同事拉出了 `feature-A` 开发分支。
- 你为了开发自己的功能，直接基于小张的 `feature-A` 分支拉出了你的 `feature-B` 分支。
- 现在，`feature-A` 分支被废弃了，或者以另一种方式直接合入了 `main`。你希望将你的 `feature-B` 分支上的修改直接移植到最新的 `main` 上，避开 `feature-A` 的历史。

#### 变基前分支拓扑关系：
```text
      C3 --- C4 (main)
     /
C1 - C2
     \
      C5 --- C6 (feature-A)
             \
              C7 --- C8 (feature-B)
```

我们的目标是：将属于 `feature-B` 但排除 `feature-A` 的提交（即 C7, C8）完整的移植并挂载到 `main`（C4）的顶端。

### B. 命令格式与执行
```bash
# 格式：git rebase --onto <新基底分支> <旧基底/排除范围> <需要移动的分支>
git rebase --onto main feature-A feature-B
```
该命令的语义是：“找出存在于 `feature-B` 且不存在于 `feature-A` 的所有提交（即 C7, C8），将它们重放到 `main` 的顶端。”

#### 变基后分支拓扑关系：
```text
C1 --- C2 --- C3 --- C4 (main) --- C7' --- C8' (feature-B)
     \
      C5 --- C6 (feature-A)
```
原有的 `feature-B` 完美脱离了对 `feature-A` 的物理依赖，挂载到了主干上。

---

## 4. 自动变基流 (Auto-squashing)

在本地高频迭代开发时，我们经常需要在稍后合并某个临时修改到早先的某个提交中。如果每次都通过手动 `git rebase -i` 并搜寻提交来修改动作，效率很低。Git 提供了 `autosquash` 机制来自动化这个过程。

### A. 实战步骤演示

#### 步骤 1：使用 `--fixup` 创建标记提交
假设我们运行 `git log --oneline` 发现早先的提交 `a1b2c3d` 中有个错字。修改完代码后，运行：
```bash
# 自动提取 a1b2c3d 的提交日志，生成一条名为 "fixup! [原始提交日志]" 的提交
git commit --fixup a1b2c3d
```

#### 步骤 2：启动自动变基
当你在准备将代码推送到远端前，进行历史整理时，运行：
```bash
# 启动交互式变基，并开启 --autosquash 选项（基于 main 分支）
git rebase -i --autosquash main
```

此时，Git 在弹出的 Todo 列表中，会自动将带有 `fixup!` 前缀的临时提交移动到 `a1b2c3d` 的**正下方**，并将开头的动作自动从 `pick` 改为 `fixup`：
```text
pick a1b2c3d feat: 增加用户登录界面
fixup 9e8d7c6 fixup! feat: 增加用户登录界面  # Git 自动重排并设为 fixup
pick d4e5f6g feat: 修复拼写错误
```
你只需要直接保存退出，Git 会静默完成合并，不再需要手动调整行顺序。

### B. ⚙️ 全局配置自动变基
为了避免每次变基都手动输入 `--autosquash`，你可以通过配置全局变量默认开启此功能：
```bash
git config --global rebase.autoSquash true
```

---

## 5. 灾难恢复 (Safety Recovery via Reflog)

很多开发者害怕 Rebase，最主要的原因是担心操作失误导致写好的代码“凭空消失”。
**请牢记 Git 的第一容灾铁律：只要你的代码曾经被 `git commit` 追踪过，它就绝对不会轻易丢失。**
因为 Git 拥有一个本地操作日志系统 —— **Reflog**。

### 实战演练：挽救一次彻底失败的变基

假设你在交互式变基中，不小心错用了 `drop` 丢弃了关键提交，或者在解决冲突时搞砸了，最后还错用了 `git rebase --continue` 完成了变基。此时你的分支历史已经被完全破坏。

#### 恢复步骤：

1. **查看 HEAD 指针移动日志**：
   运行 `git reflog` 命令，你会看到类似下方的历史账本（从新到旧排列）：
   ```text
   8b2a3c1 HEAD@{0}: rebase (finish): returning to refs/heads/feature
   8b2a3c1 HEAD@{1}: rebase (pick): feat: add recovery logic
   f5d6c7b HEAD@{2}: rebase (pick): feat: add register logic
   c2d3e4f HEAD@{3}: rebase (start): checkout main
   a1c2e3f HEAD@{4}: commit: feat: critical work (被你不小心删掉的那个提交!)
   ```
2. **定位黄金切入点**：
   从日志中可以看出，`HEAD@{3}` 是执行 `rebase (start)` 的那一刻，而 `HEAD@{4}` 则是变基开始前，我们在 `feature` 分支上的最后一个完美状态。
3. **时空回溯**：
   执行硬重置，强行将分支 HEAD 指针重置回变基前的哈希值：
   ```bash
   # 绝对安全的重置，将当前分支指针、暂存区及工作区全部回滚到变基前的完美现场
   git reset --hard a1c2e3f
   ```
4. **确认恢复**：
   再次运行 `git log`，你会发现变基产生的垃圾历史全部消失，所有丢失的提交完好无损地回到了你的分支中！

---

## 6. 在变基过程中自动执行测试 (`--exec`)

为了确保你在 Rebase 过程中进行的任何 `squash`、`reword` 或 `edit` 操作没有破坏已有代码的功能，可以利用 `exec` 选项在重放的每一步自动运行测试：

```bash
# 在重放每个提交后，都自动在终端后台运行一次 npm test。若某一步测试失败，变基立即暂停
git rebase -i main --exec "npm test"
```

这对于维护高质量、高可靠性的提交历史而言，是生产环境下的最佳工程实践。

---

## 7. 保留合并提交的变基 (`--rebase-merges`)

在默认情况下，`git rebase` 会将所有的历史**扁平化（Flatten）**，丢弃所有的 Merge Commit。如果你在一个复杂的 Feature 分支中包含了多条并行的开发子支线，扁平化变基会破坏原有的开发脉络。

为了保留分支的拓扑结构，你可以在变基时加入 `--rebase-merges` 选项：

```bash
# 启动变基，并在 Todo 列表中生成 label, reset, merge 动作以重建分支图结构
git rebase -i --rebase-merges main
```

这会允许你在重整各个子支线提交的同时，依然保持整个功能分支内部完美的合并网络拓扑。
