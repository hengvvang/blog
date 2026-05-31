# 第二章：Grid 二维网格布局架构与对齐机制

CSS Grid Layout 是一种功能完备的二维网格系统，能够同时在水平与垂直轴向上划分空间。这赋予了开发者建立高度复杂的非对称排版、卡片重叠排版以及大型全局页面骨架的能力。

---

## 1. 核心心智模型：二维网格要素

与一维的 Flexbox 不同，Grid 的控制力完全居于容器本身。要精通 Grid，必须理解以下概念：

* **网格容器 (Grid Container)**：设置了 `display: grid` 或 `display: inline-grid` 的父元素。
* **网格项 (Grid Item)**：网格容器的直接子元素。
* **网格线 (Grid Line)**：划分网格结构的水平与垂直边界线。如果有 $N$ 个列网格轨道，则会有 $N+1$ 条垂直网格线，索引默认从 `1` 开始递增，或自右向左/自下向上使用负数索引从 `-1` 开始。
* **网格轨道 (Grid Track)**：相邻两条平行网格线之间的物理区域，即“列轨”或“行轨”。
* **网格单元格 (Grid Cell)**：相邻两条水平线和两条垂直线包围的最小相交区域，类似于表格的单元格。
* **网格区域 (Grid Area)**：由任意数量的单元格组成的矩形区域，可以通过坐标线范围或命名区域直接引用。

### 1.1 网格坐标线索引图示

```
           Col Line 1      Col Line 2      Col Line 3      Col Line 4 (or -1)
               │               │               │               │
 Row Line 1 ───▼───────────────▼───────────────▼───────────────▼───
               │               │               │               │
               │   Cell (1,1)  │   Cell (1,2)  │   Cell (1,3)  │  <-- Row Track 1
               │               │               │               │
 Row Line 2 ───┼───────────────┼───────────────┼───────────────┼───
               │               │               │               │
               │   Cell (2,1)  │   Cell (2,2)  │   Cell (2,3)  │  <-- Row Track 2
               │               │               │               │
 Row Line 3 ───┼───────────────┼───────────────┼───────────────┼───
               │               │               │               │
               │   Cell (3,1)  │   Cell (3,2)  │   Cell (3,3)  │  <-- Row Track 3
               │               │               │               │
 Row Line 4 ───▲───────────────▲───────────────▲───────────────▲───
 (or -1)       │               │               │
               └─ Col Track 1 ─┴─ Col Track 2 ─┴─ Col Track 3 ─┘
```

---

## 2. 定义网格轨道：单元与计算函数

在网格容器上，我们使用 `grid-template-columns` 和 `grid-template-rows` 显式划分列和行的轨道宽度。

### 2.1 `fr` 单位与百分比（%）单位的本质区别

* **百分比（%）单位**：始终相对于网格容器的最终内容区宽度。如果设定 `grid-template-columns: 50% 50%`，且容器存在 `gap: 20px` 的网格间距，最终网格必然发生**溢出**，溢出宽度正好等于 `20px`。这是因为 `50% + 50% + 20px = 100% + 20px`。
* **`fr` 单位（Fractional Unit）**：代表“剩余空间的分配份额”。如果在容器上定义 `grid-template-columns: 1fr 1fr` 并配合 `gap: 20px`，浏览器会首先减去 `20px` 的间距，然后将剩下所有的可用空间均分为两等份。使用 `fr` **永远不会引发意外的溢出**。

```css
/* 溢出风险设计：百分比与 gap 冲突 */
.bad-grid {
  display: grid;
  grid-template-columns: 33.33% 33.33% 33.33%;
  gap: 15px; /* 最终总宽度为 100% + 30px，造成容器意外溢出或出现滚动条 */
}

/* 安全弹性设计：fr 单位自适应分配 */
.good-grid {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 15px; /* 先扣除 30px (两处间隙) 的 gap 后，将剩余空间按 1:2:1 比例动态划分 */
}
```

### 2.2 核心轨道函数

1. **`repeat(count, track-list)`**：
   用于简化冗余的轨道定义。如 `repeat(12, 1fr)` 声明 12 等分轨道。`count` 除了可以用固定数字，还可以配合 `auto-fill` 或 `auto-fit` 关键字（详见第3章）。
2. **`minmax(min, max)`**：
   限制轨道的伸缩范围。例如 `grid-template-columns: 200px minmax(300px, 1fr)`，表示第一列固定 200px，第二列在空间充足时占满剩余空间，在空间受缩时最小不低于 300px。
3. **`fit-content(limit)`**：
   相当于 `min(max-content, max(min-content, limit))`。当轨道内容较少时，轨道尺寸自适应内容；当内容极长时，轨道大小被锁定在 `limit` 上限值。

---

## 3. 网格定位与命名区域

一旦划分好网格线，我们可以通过多种方式将子项精准定位到对应的网格区域。

### 3.1 基于网格线索引（Grid Lines）

子项可以通过指定物理网格线坐标跨越行与列：

```css
.grid-item-featured {
  /* 从第 1 条列网格线开始，到第 3 条列线结束（跨越 2 个列轨道） */
  grid-column-start: 1;
  grid-column-end: 3;
  
  /* 简写形式：start / end */
  grid-row: 2 / 4; /* 从第 2 条行线开始，到第 4 条行线结束（跨越 2 个行轨道） */
}
```

除了指定绝对终点，还可以使用 `span` 关键字表示“跨越”的轨道数量：

```css
.grid-item-span {
  grid-column: 2 / span 3; /* 从第 2 条列线开始，向后跨越 3 个列轨（即到第 5 条列线） */
}
```

### 3.2 具名网格线（Named Grid Lines）

我们可以在定义轨道时，用中括号 `[]` 显式命名网格线，以此增强 CSS 的语义可读性：

```css
.grid-container {
  display: grid;
  grid-template-columns: [main-start] 1fr [content-start] 3fr [content-end] 1fr [main-end];
}

.main-content {
  grid-column: content-start / content-end; /* 直接使用线名称定位，无需关心物理索引 */
}
```

---

### 3.3 网格模板区域定位 (`grid-template-areas`)

这是 CSS Grid 最具革命性的直观排版特性。它允许使用类似 ASCII 字符画的可视化方式定义整个页面布局结构。

#### 3.3.1 网格区域映射坐标关系

```
    +---------------------------------------------------------------+
    |                           [header]                            |
    | (1,1) 到 (1,3) 的区域 ──> 对应模板中的 "header"                 |
    +-------------------------------+-------------------------------+
    |                               |                               |
    |           [sidebar]           |            [main]             |
    | (2,1) ──> 对应 "sidebar"      | (2,2) 到 (2,3) ──> 对应 "main" |
    |                               |                               |
    +-------------------------------+-------------------------------+
    |                           [footer]                            |
    | (3,1) 到 (3,3) 的区域 ──> 对应模板中的 "footer"                 |
    +---------------------------------------------------------------+
```

#### 3.3.2 属性配置示例

```css
.page-layout {
  display: grid;
  grid-template-columns: 240px 1fr 200px;
  grid-template-rows: 60px auto 50px;
  /* 每一个字符串代表网格的一行，词与词之间空格分隔代表列单元格 */
  grid-template-areas:
    "header  header  header"
    "sidebar main    ads"
    "footer  footer  footer";
  gap: 16px;
}

/* 子项通过声明 grid-area 指向模板区域名称 */
.header-widget  { grid-area: header; }
.sidebar-widget { grid-area: sidebar; }
.main-widget    { grid-area: main; }
.ads-widget     { grid-area: ads; }
.footer-widget  { grid-area: footer; }
```

如果要留出空白单元格，可以在对应位置使用英文点号 `.`：
```css
grid-template-areas:
  "header  header header"
  "sidebar main   ."
  "footer  footer footer"; /* 右下角网格为空置单元格，不摆放任何指定元素 */
```

---

## 4. 网格对齐规范 (Box Alignment in Grid)

Grid 实现了 W3C 完整的盒对齐规范（Box Alignment）。对齐可以分为**容器级别（轨道分布与项目默认对齐）**与**项目自身级别（自我修正）**。

### 4.1 容器级对齐

1. **整体轨道对齐 (Content Alignment)**：
   仅在网格轨道的总物理尺寸小于网格容器物理尺寸时生效。
   * `justify-content`：控制网格总轨道在**水平方向**上如何分布。
   * `align-content`：控制网格总轨道在**垂直方向**上如何分布。
2. **单元格内元素对齐 (Items Alignment)**：
   用于设置所有网格项在各自所属单元格范围内的默认对齐方式。
   * `justify-items`：控制网格项在单元格水平方向上的默认对齐（可选 `stretch`、`start`、`end`、`center`）。
   * `align-items`：控制网格项在单元格垂直方向上的默认对齐。

### 4.2 项目级自我修正对齐

若某个特定子项需要特立独行，可使用：
* **`justify-self`**：重写当前网格项在所属单元格内的水平对齐。
* **`align-self`**：重写当前网格项在所属单元格内的垂直对齐。

---

## 5. 显式网格与隐式网格 (Explicit vs Implicit Grid)

* **显式网格（Explicit Grid）**：由 `grid-template-rows` / `grid-template-columns` 明确声明的轨道。
* **隐式网格（Implicit Grid）**：当网格项的数量超出了显式定义的网格单元数，或者网格项定位在显式网格边界之外时，浏览器会自动创建新的轨道来容纳它们。

### 5.1 控制隐式网格的尺寸

我们可以使用以下属性定义隐式自动生成的轨道大小：
* **`grid-auto-rows`**：定义隐式行轨的默认高度（例如 `grid-auto-rows: minmax(100px, auto)`）。
* **`grid-auto-columns`**：定义隐式列轨的默认宽度。

### 5.2 排列流方向与紧密排列算法 (`grid-auto-flow`)

`grid-auto-flow` 控制子项在未指定位置时的自动放置顺序：

* **`row`（默认值）**：依次按行填充，一行填满后换到下一行。
* **`column`**：依次按列填充，一列填满后换到下一列。
* **`dense`（紧密填充/密集算法）**：
  若部分子项因跨越行/列（如设置了较大的 `span`）无法塞入当前的小缝隙中，浏览器默认会留白并将该子项推至下一行。若开启了 `dense`（如 `grid-auto-flow: row dense`），浏览器在后续遇到尺寸较小能够塞进之前缝隙的元素时，会**打乱原有 DOM 的渲染顺序**，强行把小元素塞回空闲的缝隙处。这对于构建瀑布流卡片或不规则照片墙非常有用。

---

## 6. 生产级 Grid 布局模版

### 6.1 经典 12 列栅格系统 (Responsive 12-Column Grid)

```html
<!-- HTML 结构 -->
<div class="twelve-col-grid">
  <div class="col-12">整行标题栏 (span 12)</div>
  <div class="col-8">主要图文区 (span 8)</div>
  <div class="col-4">侧边侧栏广告 (span 4)</div>
  <div class="col-4 col-offset-2">缩进定位区 (span 4 offset 2)</div>
</div>
```

```css
/* CSS 样式定义 */
.twelve-col-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr); /* 声明 12 等分列轨 */
  gap: 24px;
}

/* 跨度类定义 */
.col-12 { grid-column: span 12; }
.col-8  { grid-column: span 8; }
.col-6  { grid-column: span 6; }
.col-4  { grid-column: span 4; }
.col-3  { grid-column: span 3; }

/* 偏移类定义：利用 grid-column-start 跳过轨道 */
.col-offset-2 {
  grid-column-start: 3; /* 将当前项目的起始线推至第 3 条网格线，空出前两格 */
}
```

### 6.2 报纸排版风格的复杂错位网格 (Asymmetric News Grid)

```html
<!-- HTML 结构 -->
<div class="news-grid-container">
  <div class="news-item-lead">头条大图聚焦报道</div>
  <div class="news-item-secondary">次席深度专题分析</div>
  <div class="news-item-sub-left">业界热点短讯一</div>
  <div class="news-item-sub-right">业界热点短讯二</div>
</div>
```

```css
/* CSS 样式定义 */
.news-grid-container {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: 250px 250px;
  gap: 20px;
}

/* 头条大图占据左侧，跨越 2 行 1 列 */
.news-item-lead {
  grid-column: 1 / 2;
  grid-row: 1 / 3;
  background-color: #0f172a;
  color: #ffffff;
}

/* 次席头条占据中上，跨越 1 行 2 列（覆盖中、右两个列轨） */
.news-item-secondary {
  grid-column: 2 / 4;
  grid-row: 1 / 2;
  background-color: #3b82f6;
  color: #ffffff;
}

/* 普通子项 1 占中下 */
.news-item-sub-left {
  grid-column: 2 / 3;
  grid-row: 2 / 3;
  background-color: #f1f5f9;
}

/* 普通子项 2 占右下 */
.news-item-sub-right {
  grid-column: 3 / 4;
  grid-row: 2 / 3;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
}
```
