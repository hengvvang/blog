---
title: "现代 CSS 页面排版：Flexbox 与 Grid 综合实践"
publishTime: "2026-05-24 15:30"
author: "hengvvang"
---
# 现代 CSS 页面排版：Flexbox 与 Grid 综合实践

在现代网页构建中，Flexbox（弹性盒子）与 Grid（网格）是处理响应式排版的黄金组合。它们分别擅长一维线性布局和二维平面网格布局。

## 弹性一维空间布局：Flexbox

Flexbox 专注于在单一轴向上（水平或垂直）对齐子元素：

```css
.flex-container {
  display: flex;
  justify-content: space-between; /* 两端对齐，中间留白 */
  align-items: center; /* 垂直居中对齐 */
  flex-direction: row; /* 水平排布 */
}
```

在我们的导航栏中，为了让文字项能够水平自适应拉伸并紧凑排列，使用 Flexbox 是最优解。

## 二维网格布局：Grid

Grid 专为实现行列规整的板块结构设计，能精确定义行数和列数：

```css
.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}
```

上面这行声明不仅规定了每列的最小宽度是 300px，还能随窗口拉伸自动填充合适列数，是构建网格式博客卡片最简洁的方案。