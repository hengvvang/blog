---
title: 静态博客 Front Matter 头部数据段语法指南
publishTime: 2026-05-24 16:00
author: hengvvang
summary: 规范阐述如何在 Markdown 顶部配置 YAML 参数，实现主题样式、发布日期和自定义分类信息的结构化管理。
readingTime: 1 min
tags:
  - MARKUP
  - MARKDOWN
lastUpdated: 2026-05-25 02:30
cover:
  image: https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop
  position: center
  text: MARKUP | MARKDOWN
---




 作为起始和结束的分界标识。"
---

# 静态博客 Front Matter 头部数据段语法指南

Front Matter 是位于 Markdown 文档最顶部的一块 YAML 或 JSON 格式的元数据定义区块，使用三个短横线 `---` 作为起始和结束的分界标识。

## YAML 语法基础

下面是一个典型的 YAML Front Matter 数据结构：

```yaml
---
title: "深入探讨生命周期"
category: "rust"
subcategory: "lifetime"
publishTime: "2026-05-24 12:00"
draft: false
tags:
  - compiler
  - advanced
---
```

## 在后端中解析它

后端代码读取文件后，只需匹配前两个 `---` 并提取中间的键值对，即可为博客文章数据库注入结构化的排序与分类特征，这是无数据库纯静态发布架构中的灵魂所在。