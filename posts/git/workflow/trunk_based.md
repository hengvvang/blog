---
title: "Trunk-Based 主干开发模式与 CI/CD 契合"
publishTime: "2026-05-24 18:15"
author: "hengvvang"
summary: "探究一种追求高频合并与持续集成的单主干开发流模式，分析其相较于传统分支开发流的优劣。"
readingTime: "2 min"
tags: ["GIT","WORKFLOW","VCS","Workflow"]
lastUpdated: "2026-05-25 02:30"
---






# Trunk-Based 主干开发模式与 CI/CD 契合

相比于繁重的 Git Flow，主干开发（Trunk-Based Development）是现代 DevOps 和持续集成（CI/CD）极其推崇的一种轻量级分支模式。

## 主干开发核心理念

在主干开发中，所有开发者都直接将代码提交到单一的“主干”（通常为 `main` 或 `master`）分支上。

- **小步快跑**：避免拉出长期存在的特性分支，分支生存期一般不超过 1-2 天。
- **频繁合并**：每天多次将本地修改合并回主干。
- **自动化测试保护**：主干分支受严格的自动化构建和集成测试流水线保护，任何错误的提交都会立即阻断部署。

## 关键技术：特性开关 (Feature Flags)

因为所有代码都直接合入主干，未开发完成的功能如果不加处理就会直接上线。我们使用**特性开关**在运行期动态控制新功能的开启与关闭：

```javascript
if (featureFlags.isEnabled("NEW_LOGIN_PAGE")) {
    showNewLogin();
} else {
    showOldLogin();
}
```

这使得我们可以安全地合并未完成的代码，实现了代码持续集成与功能持续发布的解耦。