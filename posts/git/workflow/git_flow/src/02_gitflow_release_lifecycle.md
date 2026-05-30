# Git Flow 发布生命周期详解

本章将通过具体的场景和完整的 Git 命令行，深度解析 **特性开发（Feature）**、**版本发布（Release）** 和 **紧急修复（Hotfix）** 这三大核心生命周期的运转机制。

---

## 1. 特性开发生命周期（Feature Branch Lifecycle）

特性开发是日常研发中频次最高的活动。其核心目标是保证单个特性的独立开发与测试，并在开发完成后干净、可追溯地合并回 `develop` 分支。

```mermaid
gitGraph
    commit id: "dev-base"
    branch feature/auth
    checkout feature/auth
    commit id: "auth-1"
    commit id: "auth-2"
    checkout develop
    commit id: "dev-other"
    checkout feature/auth
    merge develop id: "sync-dev"
    checkout develop
    merge feature/auth id: "merged-auth"
```

### 步骤 1：从 `develop` 创建特性分支
在开始新功能开发前，必须同步远程最新的 `develop` 代码，并创建以 `feature/` 为前缀的分支：

```bash
# 1. 切换到开发集成分支并拉取最新更改
git checkout develop
git pull origin develop

# 2. 创建并切换到特性分支（以开发用户鉴权功能为例）
git checkout -b feature/user-auth
```

### 步骤 2：迭代开发与本地提交
在特性分支上进行代码编写，并遵循小步快跑的原则进行本地提交：

```bash
# 添加变更并提交
git add src/auth/
git commit -m "feat(auth): implement JWT token generation"

# 编写单元测试并提交
git add tests/auth_test.go
git commit -m "test(auth): add unit tests for token validation"
```

### 步骤 3：保持特性分支与上游同步
若开发周期较长，`develop` 分支可能已被其他同事合并了新代码。为了防止最后合并时冲突过多，应定期拉取并同步 `develop` 分支：

```bash
# 将本地的 develop 分支更新
git fetch origin develop

# 在特性分支上合入最新的 develop 代码（或者采用 rebase 方式，视团队规范而定）
git merge origin/develop -m "chore: sync upstream develop changes"
```

### 步骤 4：完成开发并合并至 `develop` (关键的 `--no-ff` 参数)
特性开发并自测通过后，需要将其合并回 `develop` 分支。**在此步骤中，必须使用 `--no-ff`（No Fast-Forward，非快速向前）参数**。

```bash
# 1. 切换回 develop 分支
git checkout develop
git pull origin develop

# 2. 使用 --no-ff 参数合并特性分支
git merge --no-ff feature/user-auth -m "merge: feature/user-auth to develop"

# 3. 推送至远程仓库
git push origin develop

# 4. 安全删除本地和远程的特性分支
git branch -d feature/user-auth
git push origin --delete feature/user-auth
```

> [!IMPORTANT]
> **为什么要强制使用 `--no-ff`？**
>
> 默认情况下，如果分支没有分叉，Git 会执行 `Fast-Forward` 合并，即将 `develop` 指针直接指向特性分支的最新提交，而不产生新的合并节点。
>
> 这会导致特性分支的所有 Commit 混入 `develop` 的提交历史中，使得我们无法从历史图谱中直观地看出“哪些提交属于同一个特性”。而 `--no-ff` 强行生成一个“Merge Commit”，完美保留了该特性开发的聚合历史与拓扑边界。

---

## 2. 版本发布生命周期（Release Branch Lifecycle）

当 `develop` 分支累积了足够多的特性，且达到里程碑时，将进入版本发布阶段。创建发布分支标志着新版本进入“冷冻期”，只接受缺陷修复，不接受新特性。

```mermaid
gitGraph
    commit id: "dev-init"
    branch release/v1.1.0
    checkout release/v1.1.0
    commit id: "bump-version"
    commit id: "fix-bug-1"
    checkout main
    merge release/v1.1.0 id: "main-v1.1.0" tag: "v1.1.0"
    checkout develop
    merge release/v1.1.0 id: "dev-v1.1.0"
```

### 步骤 1：创建发布分支
从最新的 `develop` 分支创建 `release/*` 分支，并更新版本号等元数据。

```bash
# 1. 切换并同步 develop
git checkout develop
git pull origin develop

# 2. 创建发布分支（版本号为 v1.1.0）
git checkout -b release/v1.1.0
```

### 步骤 2：版本号升级与环境加固
在发布分支上修改项目的版本配置文件（如 `package.json`, `pom.xml`, `version.go`），并提交：

```bash
# 修改版本文件并将修改提交
echo "v1.1.0" > VERSION
git add VERSION
git commit -m "chore: bump version to v1.1.0"

# 将发布分支推送至远程，供 QA 团队拉取并进行灰度/预发布测试
git push -u origin release/v1.1.0
```

### 步骤 3：在发布分支上修复测试缺陷
测试团队在预发布环境（Staging）发现 Bug 后，开发人员直接在 `release/v1.1.0` 上进行修复并提交：

```bash
# 修复缺陷并提交
git add src/auth/jwt.go
git commit -m "fix(auth): fix null pointer dereference in token validation"
git push origin release/v1.1.0
```

### 步骤 4：完成发布并关闭分支（双向合并）
当预发布测试完全通过后，必须将该分支同时合入 `main` 和 `develop`，以保证生产和开发分支的代码同步。

#### 1) 合并至 `main` 分支并打上版本标签 (Tag)
```bash
# 切换到 main 分支并拉取最新
git checkout main
git pull origin main

# 以非快速向前方式合入发布分支
git merge --no-ff release/v1.1.0 -m "merge: release/v1.1.0 to main"

# 创建带有批注的签名 Tag
git tag -a v1.1.0 -m "Release version 1.1.0"

# 推送 main 和对应的 Tag 到远程
git push origin main
git push origin v1.1.0
```

#### 2) 回合至 `develop` 分支
为了让后续在 `develop` 上的开发工作包含这次发布期间所做的所有 Bug 修复，必须将发布分支回合：

```bash
# 切换到 develop 分支
git checkout develop
git pull origin develop

# 将发布分支合并回 develop
git merge --no-ff release/v1.1.0 -m "merge: sync release/v1.1.0 bugfixes to develop"
git push origin develop
```

#### 3) 清理发布分支
发布任务圆满完成，删除本地和远程的临时发布分支：

```bash
git branch -d release/v1.1.0
git push origin --delete release/v1.1.0
```

---

## 3. 紧急热修复生命周期（Hotfix Branch Lifecycle）

当线上生产环境发生不可容忍的故障（如 core dump、内存泄漏、安全漏洞）时，必须以最快速度从 `main` 分支拉取 `hotfix` 分支。

```mermaid
gitGraph
    commit id: "main-v1.1.0" tag: "v1.1.0"
    branch hotfix/v1.1.1
    checkout hotfix/v1.1.1
    commit id: "patch-security-hole"
    checkout main
    merge hotfix/v1.1.1 id: "main-v1.1.1" tag: "v1.1.1"
    checkout develop
    merge hotfix/v1.1.1 id: "dev-v1.1.1"
```

### 步骤 1：从 `main` 分支（或特定 Tag）创建热修复分支
热修复必须基于当前正在运行的生产版本，以确保不会将 `develop` 上未成熟的代码带入线上。

```bash
# 1. 切换至 main 并拉取最新代码
git checkout main
git pull origin main

# 2. 从 main 检出热修复分支（版本号升级为 v1.1.1）
git checkout -b hotfix/v1.1.1
```

### 步骤 2：修复问题并升级版本号
在 `hotfix/v1.1.1` 分支上进行最小限度的修改，避免引入不相关代码。

```bash
# 1. 修复代码漏洞
git add src/server/http.go
git commit -m "fix(security): resolve HTTP header injection vulnerability"

# 2. 修改版本元数据并提交
echo "v1.1.1" > VERSION
git add VERSION
git commit -m "chore: bump version to v1.1.1"
```

### 步骤 3：完成修复并关闭分支（双向合并）
与发布分支类似，热修复验证无误后也必须进行双向合并。

#### 1) 合并至 `main` 并打 Tag
```bash
git checkout main
git pull origin main
git merge --no-ff hotfix/v1.1.1 -m "merge: hotfix/v1.1.1 to main"
git tag -a v1.1.1 -m "Hotfix release version 1.1.1 for security patch"
git push origin main
git push origin v1.1.1
```

#### 2) 合并至 `develop`
```bash
git checkout develop
git pull origin develop
git merge --no-ff hotfix/v1.1.1 -m "merge: sync hotfix/v1.1.1 fixes to develop"
git push origin develop
```

> [!NOTE]
> **如果当前存在活跃的 `release/*` 分支怎么办？**
>
> 如果此时团队正在筹备 `release/v1.2.0` 分支，那么 `hotfix/v1.1.1` 应当合并回 `main` 和 `release/v1.2.0`，而不是直接合回 `develop`。
>
> 这样可以保证即将发布的 `v1.2.0` 包含此修复，而 `release/v1.2.0` 最终合回 `develop` 时，变更会自然流回 `develop`，从而避免了 `develop` 遭到双重合并产生的冲突。

#### 3) 清理热修复分支
```bash
git branch -d hotfix/v1.1.1
git push origin --delete hotfix/v1.1.1
```
