# 第三章：自定义 CSS 样式覆写与特殊字体配置

mdBook 默认的 Web 主题（如 Light, Coal, Navy 等）在结构上十分清晰，但针对现代中文排版以及多维内容表现力（如警告框、代码框滚动条、斑马纹表格等）略显单一。本章将详细讲解如何通过 mdBook 的编译挂载机制，注入自定义的 CSS 样式文件，实现高级排版与组件美化。

---

## 1. mdBook 样式挂载机制

在 mdBook 中，样式定制不需要修改编译引擎源码，而是通过配置文件 `book.toml` 挂载外部 CSS 和 JS 资源。

### 1.1 配置文件 `book.toml` 的路径定义

在项目的根配置中，我们通过 `[output.html]` 选项定义 `additional-css` 和 `additional-js` 的相对路径。这些路径是相对于 `book.toml` 所在目录计算的。但是在我们的自动化流水线中，为了维持代码的通用性与自动化部署，**在本地开发与最终发布时，实际路径会在构建阶段被中央脚本重写**。因此，我们在本地无需硬编码，直接依靠构建系统绑定即可。

在最终渲染的 HTML 中，编译器会自动读取配置好的样式文件，并将其复制到输出的 HTML 静态目录中，同时在生成的所有 HTML 页面的 `<head>` 中插入对应的 `<link>` 标签，确保定制样式在全局生效：

```html
<!-- mdBook 编译生成的 HTML 头部片段引用 -->
<link rel="stylesheet" href="theme/custom-mdbook.css">
```

---

## 2. 侧边栏与主内容区 CSS 盒模型覆写

mdBook 的页面布局采用侧边栏（`.sidebar`）固定定位，主内容区（`.page-wrapper`）通过外边距（`margin-left`）进行响应式偏移的结构。

为了优化大屏幕下的阅读体验，我们需要对这两个核心容器的盒模型进行微调。下图展示了重置后的 CSS 盒模型与空间布局关系：

```
+-------------------------------------------------------------------+
|                        Viewport 浏览器视口                          |
|                                                                   |
|   +--------------------+---------------------------------------+  |
|   |   .sidebar         |   .page-wrapper                       |  |
|   |   (左侧导航栏)      |   (右侧主内容容器)                     |  |
|   |                    |                                       |  |
|   |   position: fixed; |   margin-left: 300px;                 |  |
|   |   width: 300px;    |   padding: 0 15px;                    |  |
|   |   left: 0;         |   +--------------------------------+  |  |
|   |                    |   |  .content main                 |  |  |
|   |   +------------+   |   |  (Markdown 文章正文)           |  |  |
|   |   |  Margin: 0 |   |   |                                |  |  |
|   |   +------------+   |   |  max-width: 820px;             |  |  |
|   |   |Border: 1px |   |   |  margin: 0 auto;               |  |  |
|   |   +------------+   |   |                                |  |  |
|   |   |Padding:15px|   |   |  +--------------------------+  |  |  |
|   |   +------------+   |   |  |       正文盒模型          |  |  |  |
|   |   |  Content   |   |   |  |  Margin: 0 auto (水平居中) |  |  |  |
|   |   |  (目录树)  |   |   |  |  Border: 0                  |  |  |  |
|   |   +------------+   |   |  |  Padding: 15px (内边距)     |  |  |  |
|   |                    |   |  |  Width: 100% (自适应)       |  |  |  |
|   |                    |   |  +--------------------------+  |  |  |
|   |                    |   +--------------------------------+  |  |
|   +--------------------+---------------------------------------+  |
+-------------------------------------------------------------------+
```

---

## 3. 全局排版与中文优化 CSS

中文的字符密度和视觉重量与英文字体有很大不同。以下 CSS 规则主要解决行宽限制、中文字体栈优雅降级以及行距调优。

```css
/* ==========================================================================
   1. 全局排版与字体系统优化
   ========================================================================== */

:root {
    /* 自定义主要内容区域的最大宽度，避免行宽过长导致视线大范围漂移，引发阅读疲劳 */
    --content-max-width: 820px;
    
    /* 优雅降级的中文/英文字体栈：
       优先使用系统内置的现代无衬线字体，在苹果和微软系统下均有良好呈现 */
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                 "Helvetica Neue", Arial, "Noto Sans", sans-serif, 
                 "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
                 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC";
    
    /* 等宽字体栈（针对代码块），优先调用 Fira Code 与 Source Code Pro */
    --font-mono: "Fira Code", "Source Code Pro", Consolas, Monaco, 
                 "Andale Mono", "Ubuntu Mono", monospace;
}

/* 应用全局字体设置，并微调字距与行高 */
.content main {
    font-family: var(--font-sans);
    line-height: 1.8; /* 推荐中文行高为 1.8，消除纯文字段落的压迫感 */
    letter-spacing: 0.02em; /* 稍微拉开字距，提高低分辨率屏幕下中文字体的清晰度 */
    color: var(--fg, #333333);
}

/* 标题样式微调：增加字重，优化上下外边距以强化段落层次 */
.content main h1, 
.content main h2, 
.content main h3, 
.content main h4 {
    font-family: var(--font-sans);
    font-weight: 700;
    letter-spacing: -0.01em;
    margin-top: 2em;
    margin-bottom: 0.8em;
}
```

---

## 4. 高级组件与样式覆写

以下是生产环境级别的 CSS 定制模块，可写入你的 `custom-mdbook.css` 中。

### 4.1 块级引用 `blockquote` 质感优化

默认的 mdBook 引用框左边框颜色较淡，且没有背景底色。我们将其重构为更加内敛优雅的现代风格：

```css
/* ==========================================================================
   2. 块级引用 (Blockquote) 样式定制
   ========================================================================== */
.content main blockquote {
    margin: 1.8em 0;
    padding: 14px 24px;
    /* 采用左侧高亮边框以区别正文，边框使用文档主题色 */
    border-left: 4px solid var(--theme-color, #b79773);
    /* 浅色半透明背景增强视觉容器层级 */
    background-color: var(--quote-bg, rgba(183, 151, 115, 0.06));
    color: var(--fg, #555555);
    border-top-right-radius: 4px;
    border-bottom-right-radius: 4px;
}

/* 引用块内部首尾段落边距微调，防止高度被撑开 */
.content main blockquote > :first-child {
    margin-top: 0;
}
.content main blockquote > :last-child {
    margin-bottom: 0;
}
```

### 4.2 警告框与提示框 (Callouts / Alert Boxes)

在编写技术手册时，经常需要“注意”、“提示”、“建议”等强醒目容器。这里采用 HTML 结构内嵌的形式，在 Markdown 中快速调用：

```css
/* ==========================================================================
   3. 高级提示框 (Alert / Callout Box) 样式
   ========================================================================== */

/* 基础提示框容器 */
.alert-box {
    margin: 1.5em 0;
    padding: 16px 20px;
    border-left: 4px solid #cccccc;
    border-radius: 4px;
    background-color: var(--alert-bg-default, #f8f9fa);
}

/* 提示级 (Info/Note) */
.alert-box.info {
    border-left-color: #2196F3;
    background-color: rgba(33, 150, 243, 0.05);
}
.alert-box.info::before {
    content: "ℹ️ 提示";
    font-weight: bold;
    color: #1976D2;
    display: block;
    margin-bottom: 6px;
}

/* 成功级 (Success/Tip) */
.alert-box.success {
    border-left-color: #4CAF50;
    background-color: rgba(76, 175, 80, 0.05);
}
.alert-box.success::before {
    content: "💡 建议 / 技巧";
    font-weight: bold;
    color: #388E3C;
    display: block;
    margin-bottom: 6px;
}

/* 警告级 (Warning/Caution) */
.alert-box.warning {
    border-left-color: #FF9800;
    background-color: rgba(255, 152, 0, 0.05);
}
.alert-box.warning::before {
    content: "⚠️ 警告";
    font-weight: bold;
    color: #F57C00;
    display: block;
    margin-bottom: 6px;
}
```

```html
<!-- HTML 结构示例：用于在 Markdown 源码中嵌入 -->
<div class="alert-box info">
    这是一个提示信息容器。你可以在这里书写任何重要的系统注意事项。
</div>
```

### 4.3 响应式表格与斑马纹 (Tables)

为了防止表格列宽超出正文宽度时把页面强行撑开，我们采用 `overflow-x: auto`，并加入斑马纹及表头悬停高亮：

```css
/* ==========================================================================
   4. 表格样式与响应式设计
   ========================================================================== */

/* 全局表格外层容器，自适应宽度并启用横向滚动条 */
.content main table {
    width: 100%;
    border-collapse: collapse;
    margin: 2em 0;
    overflow-x: auto;
    display: block; /* 核心属性：允许块级渲染和滚动 */
    font-size: 0.95em;
}

/* 表头背景色与下边框强化 */
.content main th {
    background-color: var(--table-header-bg, #f2f2f2);
    color: var(--table-header-fg, #333333);
    font-weight: 600;
    padding: 10px 16px;
    border-bottom: 2px solid var(--table-border, #dddddd);
}

/* 单元格细边框与内边距 */
.content main td {
    padding: 10px 16px;
    border-bottom: 1px solid var(--table-border, #eeeeee);
    color: var(--fg, #444444);
}

/* 斑马纹交替底色 */
.content main tr:nth-child(even) {
    background-color: var(--table-zebra-bg, rgba(0, 0, 0, 0.015));
}

/* 鼠标悬停的高亮反馈效果 */
.content main tr:hover {
    background-color: var(--table-hover-bg, rgba(0, 0, 0, 0.03));
    transition: background-color 0.2s ease;
}
```

### 4.4 代码块与 Webkit 滚动条优化

代码块是技术文档的核心。除了字体，滚动条的宽度与颜色也会对页面整洁度产生显著影响：

```css
/* ==========================================================================
   5. 代码块 (Pre / Code) 与滚动条定制
   ========================================================================== */

/* 代码块容器样式 */
.content main pre {
    border-radius: 6px;
    border: 1px solid var(--table-border, #e5e5e5);
    padding: 1.2em;
    overflow: auto;
    font-size: 0.9em;
    line-height: 1.5;
    background-color: var(--theme-card-bg, #fcfcfc);
}

/* 针对 Webkit 内核浏览器（Chrome, Safari, Edge）的轻量滚动条定制 */
.content main pre::-webkit-scrollbar {
    width: 6px;
    height: 6px; /* 控制横向及纵向滚动条的粗细 */
}

/* 滚动条滑轨背景色 */
.content main pre::-webkit-scrollbar-track {
    background: transparent;
    border-radius: 4px;
}

/* 滚动条滑块颜色与圆角 */
.content main pre::-webkit-scrollbar-thumb {
    background: var(--scrollbar-color, #cccccc);
    border-radius: 4px;
}

/* 滑块悬停高亮 */
.content main pre::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-hover-color, #999999);
}

/* 行内代码样式，防止默认背景色在字里行间显得突兀 */
.content main :not(pre) > code {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: var(--font-mono);
    background-color: var(--inline-code-bg, rgba(27, 31, 35, 0.05));
    color: var(--inline-code-fg, #d63200);
}
```

---

## 5. 打印媒介样式优化 (Print Media CSS)

很多读者会有将技术文档打印为 PDF 的需求。我们需要确保打印输出时，导航栏隐藏、页宽拉满，且代码块不会被截断。

```css
/* ==========================================================================
   6. 打印媒介样式定义 (@media print)
   ========================================================================== */
@media print {
    /* 隐藏所有网页交互组件、页眉、侧边栏及导航控件 */
    .sidebar,
    .nav-chapters,
    #menu-bar,
    .theme-icon,
    .nav-wrapper {
        display: none !important;
    }
    
    /* 铺满纸张宽度，重置侧边栏预留的左边距 */
    .page-wrapper {
        margin-left: 0 !important;
        padding-left: 0 !important;
    }
    
    .content main {
        max-width: 100% !important;
        font-size: 12pt; /* 设定最适合纸张打印的字号大小 */
    }
    
    /* 保证打印时代码块和表格自动换行，避免被纸张物理边缘截断 */
    pre, table {
        page-break-inside: avoid; /* 避免表格或代码块中途跨页断开 */
        word-wrap: break-word;
        white-space: pre-wrap !important;
    }
}
```
