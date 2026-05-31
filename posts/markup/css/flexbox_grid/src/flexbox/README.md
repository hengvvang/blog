# Flexbox 弹性布局

本部分将深入探讨 CSS Flexible Box Layout (Flexbox) 的核心机制。作为现代 CSS 布局的两大基石之一，Flexbox 提供了一种在单维空间（单行或单列）中高效排列、对齐和分配容器内子元素空间的方法，特别适合处理组件级别的微观布局及流式内容排列。

## 核心技术要点

### 1. 双轴系统与控制
Flexbox 的所有对齐与空间分配均基于**主轴 (Main Axis)** 与**交叉轴 (Cross Axis)**。
- **主轴方向**通过 `flex-direction`（`row`、`row-reverse`、`column`、`column-reverse`）来决定。
- **换行行为**通过 `flex-wrap`（`nowrap`、`wrap`、`wrap-reverse`）来声明。

```
                     主轴 (Main Axis) ──>
        +-------------------------------------------+
        |  [Flex Item 1]   [Flex Item 2]   [Item 3] |  交叉轴 (Cross Axis)
        |  +-----------+   +-----------+   +------+ |  │
        |  |  Content  |   |  Content  |   | Text | |  │
        |  +-----------+   +-----------+   +------+ |  ▼
        +-------------------------------------------+
```

### 2. 双轴对齐控制
- **主轴对齐**：使用 `justify-content` 属性（支持 `flex-start`、`flex-end`、`center`、`space-between`、`space-around`、`space-evenly` 等），控制子项在主轴上的间距分配。
- **交叉轴单行对齐**：使用 `align-items` 属性（支持 `stretch`、`flex-start`、`flex-end`、`center`、`baseline` 等），控制单行子项在交叉轴方向上的定位。
- **交叉轴多行整体对齐**：使用 `align-content` 属性，定义多行 Flex 容器内行轨之间的空间分配。

### 3. 伸缩因子计算数学 (Flex Sizing Math)
Flex 项的最终尺寸由三个核心属性共同决定：
- **`flex-basis`**：定义分配空间前的基本大小（基准尺寸）。
- **`flex-grow`**：定义在容器存在正向剩余空间时，子项按比例放大的权重。
- **`flex-shrink`**：定义在容器空间不足导致溢出时，子项按比例收缩的加权权重。

其具体计算逻辑涉及到加权平均和剩余空间配额，我们将在本部分的后续章节中进行详细的数学推导与实战演示。

---

## 学习导览

在接下来的章节中，我们将通过 **第一章：Flexbox 轴向机制与伸缩因子计算原理** 深入底层，全面剖析：
1. 轴向受书写模式（Writing Modes）与阅读方向（LTR/RTL）影响的机制。
2. 伸缩计算公式的推导：包含正向空间膨胀（Grow）与负向空间收缩（Shrink）的加权算法。
3. 容器与子项属性的配合使用（如 `margin: auto` 吞噬剩余空间的奇技淫巧）。
4. 生产级高频 Flexbox 组件的 CSS 最佳实践与防爆指南。
