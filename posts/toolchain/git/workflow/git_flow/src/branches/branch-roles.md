# 第一章：主干、开发、特性与修补分支角色定义与命名规范

在 Git Flow 模型中，通过严密的物理分支隔离与明确的逻辑角色划分，使得并行软件开发与版本稳定交付得以有机结合。本章将从 Git 底层引用机制（Refs）出发，深度解析**双核心长期分支**与**三大短期辅助分支**的内部拓扑逻辑、安全准入机制以及命名规范。

---

## 1. Git Flow 核心分支映射层级与流向拓扑

在深入每个分支的细节之前，我们可以通过下面的 ASCII 拓扑图直观了解分支之间的拉取与合并流向。这一层级关系保证了生产环境代码的极高稳定性，同时赋予开发团队高度的灵活性。

```text
                       +-------------------------+
                       |   hotfix/vX.Y.Z         | <--- 紧急修复分支 (基于 main Tag 检出)
                       +-------------------------+
                         /                     \
            (拉取自 Tag) /                       \ (双向合并：带 Tag 释放)
                        v                         v
  [ main ] <=======================================================> 生产分支 (绝对稳定)
                        ^                         ^
                         \                       / (双向合并：合并后删除)
                          \                     /
                       +-------------------------+
                       |   release/vX.Y.Z        | <--- 预发布分支 (测试冷冻期)
                       +-------------------------+
                            ^               /
               (开发完成拉取) |              / (若有 Bug 修复，回合开发主线)
                            |             v
  [ develop ] <====================================================> 开发分支 (持续集成)
                        \                 ^
           (功能迭代拉取) \               / (完成合并，必须使用 --no-ff)
                          v             /
                       +-------------------------+
                       |   feature/JIRA-XXXX     | <--- 特性分支 (本地沙箱)
                       +-------------------------+
```

---

## 2. 双核心长期分支设计解析

长期分支在项目的整个生命周期中永远存在，代表了软件演进的两个基准状态。在 Git 内部，分支实际上只是一个指向特定 commit 对象的引用（指向 `.git/refs/heads/` 目录下的一个 40 字符哈希文件）。但这两种引用在 Git Flow 工作流中被赋予了截然不同的安全属性。

### 2.1 `main` 分支（生产发布分支）
`main` 分支（历史遗留项目或特定基础设施中可能命名为 `master`）是**线上运行环境的物理映射**。

* **终极原则**：`main` 分支代表了随时能够进行线上无缝部署的稳定就绪代码。任何处于破坏状态或未通过完整端到端测试的代码都不允许进入 `main`。
* **物理机制与准入保护**：
  * **零直接修改**：禁止任何开发者在此分支直接执行 `git commit` 或 `git push` 操作。
  * **唯一合并源**：只接受来自 `release/*`（日常发布）和 `hotfix/*`（紧急热修复）分支的合并请求。
  * **语义化标签 (Semantic Tags)**：每一次 `main` 分支的变更合并后，必须立即在对应的 Merge Commit 上打上 annotated tag（带附注的标签，存储在 `.git/refs/tags/` 下，包含签名、作者及时间戳信息），作为生产部署的版本标识，例如 `v1.2.0`。
* **Git 底层存储解析**：
  在 `.git/refs/heads/main` 文件中，仅保存一个 40 位 SHA-1 值（对应当前最新发布的 Commit）。当打上 `v1.2.0` 标签时，`.git/refs/tags/v1.2.0` 文件会被创建，该文件包含指向该 Commit 的指针及附加的发布元数据：
  ```bash
  # 查看 main 分支当前指向的哈希值
  cat .git/refs/heads/main
  # 示例输出: 5c7ad5b50d53cfa7fa9b4cfb036577889e1b212f
  ```

### 2.2 `develop` 分支（持续集成分支）
`develop` 分支是**所有开发特性的集成主线**。

* **核心定位**：它反映了团队为了准备下一个版本发布而做出的最新技术积累。虽然它是开发的主轨道，但在企业级协作中，同样需要受到保护。
* **准入保护**：
  * **禁止直接推送**：虽然在小团队中直接向 `develop` 提交代码较为常见，但在高安全性团队中，必须通过 `feature/*` 分支提交 Merge Request 合入，以便触发自动化测试流水线。
  * **部署映射**：`develop` 分支的代码通常与测试或集成环境（Integration/Alpha Staging）自动挂钩。每当 `develop` 发生更新，CI/CD 引擎会自动编译、构建镜像并部署至测试集群，用于内部的自动化测试。

---

## 3. 三大短期/辅助分支设计与生命周期管理

辅助分支根据任务的引入而创建，任务完成后必须通过规范流程被清理，以避免本地和远程仓库中堆积无用的“僵尸分支”。

### 3.1 `feature/*` 特性分支：功能沙箱化
特性分支旨在对日常研发功能或架构重构提供完全隔离的环境。

* **上游依赖**：必须源于 `develop` 的最新提交。
* **合并去向**：功能开发完毕并完成单元测试后，只能合入 `develop`。**严禁直接将 `feature` 合入 `main`**。
* **生命周期**：开发活动结束，其 Merge Request 被 `develop` 接受后，本地和远程分支均应立即删除。
* **命名规范**：
  * 推荐使用 JIRA 或其他项目管理工具的 Task ID 作为前缀，便于追踪历史。
  * 格式：`feature/<Issue-ID>-<description>`
  * 示例：`feature/JIRA-1024-jwt-blacklist`

### 3.2 `release/*` 发布分支：版本加固冷冻
当 `develop` 中的功能累积已达到预定里程碑时，将拉取 `release` 分支。它的存在是为了建立一个“测试冷冻缓冲区”。

* **上游依赖**：源于 `develop`。此时 `develop` 已经合并了该版本计划内的所有特性分支。
* **职能受限**：
  * **禁止特性追加**：此分支绝对不允许合并任何新的特性分支（New Feature Commit）。
  * **只允许回归修复**：仅接受针对 QA 提交的 bug 修复（Bugfix Commit）、文档补充以及版本号更改（如修改 `package.json` 中的 `version` 字段）。
* **关闭分支路径（双向合并）**：
  * **主干释放**：合入 `main` 分支，并在此打上对应的版本 tag（如 `v1.1.0`）。
  * **开发线同步**：合入 `develop` 分支，使得发布期间修复的所有 bug 能够在后续的日常开发中继续生效。
* **命名规范**：
  * 格式：`release/v<Major>.<Minor>.<Patch>`
  * 示例：`release/v1.1.0`

### 3.3 `hotfix/*` 紧急修补分支：生产快速通道
当线上环境（`main` 分支代码）被检测出严重缺陷（如内存泄漏、安全漏洞）时，常规的 `develop` 路径因包含大量未发布的新特性而无法直接上线。此时必须启动紧急修补分支。

* **上游依赖**：必须从 `main` 分支上的对应受灾 Tag 节点（通常为当前线上最新 Tag）拉取。
* **隔离策略**：该分支代表了一条绕过日常研发线路的“快速通道”，能保证补丁以最快速度进入生产。
* **关闭分支路径（双向合并）**：
  * **主干释放**：合入 `main` 分支，打上修订版 tag（如原版本为 `v1.1.0`，热修复版本为 `v1.1.1`）。
  * **开发线同步**：合入 `develop` 分支。
  * **冲突规避特殊规则**：如果当前正存在一个活跃的 `release/*` 分支（即下个版本正在加固测试），则 `hotfix` 应当合并到该 `release/*` 分支中，而不是直接合入 `develop`。因为当前 `release` 分支在加固完成后最终也会双向合并到 `main` 和 `develop` 中，这就确保了修复可以带入未来版本，且避免了 `develop` 产生多重合并冲突。
* **命名规范**：
  * 格式：`hotfix/v<Major>.<Minor>.<Patch>`
  * 示例：`hotfix/v1.1.1`

---

## 4. 分支安全准入与强制约束策略

为了在实际工程中杜绝人为误操作（如在 `main` 直接提交、不规范的分支命名等），我们可以借助服务端的 Git Hooks（钩子）进行物理限制。

下面是一个生产级的 Python 版 Git `pre-receive` 钩子脚本示例，将其部署于自建 Git 服务器（如基于 Linux 搭建的裸仓库环境）的 `hooks/pre-receive` 路径下，可自动强制阻断非规范的推送请求。

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Git 服务端 pre-receive 钩子
功能：
1. 强制禁止任何用户向 main / master 分支执行直接推送（仅允许服务端 Merge Request 操作合并）
2. 强制校验推送的分支名称是否符合 Git Flow 规范
"""

import sys
import re

# 允许的标准分支命名正则表达式
ALLOWED_BRANCH_PATTERNS = [
    r"^refs/heads/main$",
    r"^refs/heads/master$",
    r"^refs/heads/develop$",
    r"^refs/heads/feature/JIRA-\d+-[a-zA-Z0-9_\-]+$",
    r"^refs/heads/release/v\d+\.\d+\.\d+$",
    r"^refs/heads/hotfix/v\d+\.\d+\.\d+$",
    r"^refs/tags/v\d+\.\d+\.\d+$" # 允许语义化 Tag 推送
]

def check_branch_policy(old_rev, new_rev, ref_name):
    # 1. 检查是否为删除分支操作（全 0 代表删除）
    if new_rev == "0" * 40:
        # 保护 main 和 develop 分支不被删除
        if ref_name in ["refs/heads/main", "refs/heads/master", "refs/heads/develop"]:
            sys.stderr.write(f"[ERROR] 拒绝删除核心分支: {ref_name}\n")
            return False
        return True

    # 2. 验证分支命名规范
    matched = False
    for pattern in ALLOWED_BRANCH_PATTERNS:
        if re.match(pattern, ref_name):
            matched = True
            break
            
    if not matched:
        sys.stderr.write(f"[ERROR] 推送分支命名不规范: '{ref_name}'\n")
        sys.stderr.write("[ERROR] 必须符合以下规范之一:\n")
        sys.stderr.write(" - 长期分支: main, master, develop\n")
        sys.stderr.write(" - 特性分支: feature/JIRA-<ID>-<description>\n")
        sys.stderr.write(" - 发布分支: release/v<Major>.<Minor>.<Patch>\n")
        sys.stderr.write(" - 修补分支: hotfix/v<Major>.<Minor>.<Patch>\n")
        return False

    # 3. 限制直接向主干直接推送（假设只有管理员通过自动化系统拉取，这里普通 Push 直接拦截）
    # 在许多企业平台中，此项配置可直接在 GitLab UI 中配置 Protected Branches。
    # 这里在钩子层面拦截，如果推送的 ref_name 是 main/master 且检测到是外部 push 则拦截。
    if ref_name in ["refs/heads/main", "refs/heads/master"]:
        # 注意：此处通常可配合环境变量判断是否属于 Web-based merge 动作
        sys.stderr.write(f"[ERROR] 严禁直接推送至生产主干分支: {ref_name}。请使用 Pull Request 进行合并。\n")
        return False

    return True

def main():
    success = True
    # Git 从标准输入传入：<old-rev> <new-rev> <ref-name>
    for line in sys.stdin:
        parts = line.strip().split()
        if len(parts) == 3:
            old_rev, new_rev, ref_name = parts
            if not check_branch_policy(old_rev, new_rev, ref_name):
                success = False
                
    if not success:
        sys.exit(1) # 返回非零值拒绝本次 push
    sys.exit(0) # 接受 push

if __name__ == "__main__":
    main()
```

### 4.1 托管平台中的保护配置推荐
在 GitHub、GitLab 或企业云端 Git 仓库中，除了钩子外，应勾选以下保护属性：
1. **Require status checks to pass before merging**：必须通过 CI/CD 单元测试流水线，否则合并按钮置灰。
2. **Require a pull request before merging**：任何对受保护分支的变更必须提 PR。
3. **Restrict who can push to matching branches**：禁止除了构建账号/集成总监（Release Train Engineer）以外的任何人在 `main` 上有 Push 和 Merge 动作，实现发布控制。
