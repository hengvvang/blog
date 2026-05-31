# 第一章：Mermaid 语法格式与渲染引擎配置

要精通 Mermaid 绘图并解决生产环境下的渲染异常与性能瓶颈，首先必须洞悉其底层的编译原理、布局算法及 DOM 渲染管线。Mermaid 并非只是简单的图形拼接工具，而是一个完整的**“领域特定语言（DSL）编译器”**。

---

## 1. Mermaid 编译与渲染生命周期

当浏览器或 Markdown 渲染器加载包含 ` ```mermaid ` 的代码块时，Mermaid 的运行时（Runtime）会启动一条复杂的渲染流水线（Pipeline）。

### 1.1 渲染编译器数据流

```text
+-----------------------+
|  Mermaid Code (DSL)   |   <--- 开发者书写的声明式文本代码
+-----------------------+
            |
            v
  +-------------------+
  |   Lexer (词法)    |   <--- 根据正则扫描文本，转换为 Token 流
  +-------------------+
            |
            v
  +-------------------+
  |   Parser (语法)   |   <--- 基于 Jison 语法文件，校验 Token 拓扑并构建 AST
  +-------------------+
            |
            v
  +-------------------+
  |  AST (抽象语法树) |   <--- 内存中表示图拓扑结构的对象表示
  +-------------------+
            |
            v
  +-------------------+
  | Layout Engine     |   <--- Dagre/ELK/D3 进行多项多层几何坐标计算
  +-------------------+
            |
            v
  +-------------------+
  | SVG DOM Builder   |   <--- 结合 Theme Variables 生成真实的 SVG DOM
  +-------------------+
            |
            v
  +-------------------+
  |  Browser Sandbox  |   <--- DOMPurify 过滤危险属性，隔离执行并输出至宿主页面
  +-------------------+
```

### 1.2 词法分析与语法分析的实现细节
Mermaid 的解析器底层主要基于 **Jison**（一个用 JavaScript 编写的 LALR(1) 解析器生成器，类似于 Unix 的 Bison/Yacc）。
- **词法分析器（Lexer）**：扫描原始的 Markdown 文本块，过滤掉空格与换行，根据特定的正则表达式将诸如 `graph`, `-->`, `subgraph` 等关键字转换为内部的 Token（记号）。
- **语法分析器（Parser）**：根据预先定义好的语法规则（`.jison` 文件），校验 Token 流的物理结构是否合法。如果符合规则，解析器将构建出对应的 **AST（Abstract Syntax Tree，抽象语法树）**。

例如，对于以下声明：
```text
graph LR
    A[Client] -->|HTTP| B(Server)
```
其生成的 AST 在内存中呈现为一个树状/图状数据结构，其中包含了节点列表与连线拓扑：
```json
{
  "type": "flowchart",
  "direction": "LR",
  "nodes": [
    { "id": "A", "label": "Client", "shape": "rect" },
    { "id": "B", "label": "Server", "shape": "round" }
  ],
  "edges": [
    { "start": "A", "end": "B", "text": "HTTP", "type": "arrow" }
  ]
}
```

---

## 2. 布局引擎与坐标计算（Layout Engines）

在得到图的拓扑结构（即哪些节点相连）后，最大的挑战是如何决定每个节点在二维空间中的具体坐标 `(x, y)`，以及连接它们的贝塞尔曲线路径（Edges）。Mermaid 依赖于以下几种主流的布局计算库：

### 2.1 Dagre 布局引擎与 Sugiyama 框架
对于**流程图（Flowchart）**，Mermaid 默认使用 **Dagre**。Dagre 是一个基于 Sugiyama 框架的有向图分层排版算法实现。整个算法分为五个关键阶段：

```text
+--------------+     +--------------+     +--------------+     +--------------+     +--------------+
| 1. 去环阶段  | --> | 2. 节点分层  | --> | 3. 节点排序  | --> | 4. 坐标分配  | --> | 5. 边线路径  |
| (Cycle Rem)  |     |   (Ranking)  |     | (Ordering)   |     | (Coord Assign)     |  (Routing)   |
+--------------+     +--------------+     +--------------+     +--------------+     +--------------+
```

1. **去环（Cycle Removal）**：如果输入的拓扑结构中存在循环回路（环），算法会临时反转某些边的方向，将其转变为一个临时性的有向无环图（DAG），从而确保后续算法能收敛。
2. **分层（Layer Assignment / Ranking）**：利用**网络单纯形算法（Network Simplex）**，决定每个节点应该处在图的第几层（例如，在 TB 布局下，输入节点在最上层，输出在最下层），确保所有的边尽可能朝向相同的方向，并且连线跨度最小。
3. **节点排序（Node Ordering）**：在层级确定的情况下，通过**重心启发式（Barycenter Heuristic）**或中位数算法，对每一层内的节点左右顺序进行迭代排序，以最大程度地减少连线交叉（Crossings）。
4. **坐标分配（Coordinate Assignment）**：分配具体的 `x` 和 `y` 像素坐标，确保节点与节点、层与层之间有足够的安全间距，并且边尽可能呈现直线。
5. **边线路径生成（Edge Routing）**：计算贝塞尔曲线的控制点，用 B 样条曲线（B-splines）绘制避开节点的优雅连线。

### 2.2 ELK (Eclipse Layout Kernel) 布局引擎
在较新版本的 Mermaid 中，引入了对 **ELK** 布局引擎的支持（通过在配置中声明 `layout: elk`）。ELK 提供了比 Dagre 更为高级的排版选项，如支持**正交布局（Orthogonal Layout）**和更强的大图排版能力。当微服务节点数量超过 100 时，Dagre 引擎的计算开销呈指数级上升且容易产生线缆交错的“面条图”；此时切换到 ELK 引擎可大幅改善布局整洁度并缩短排版时间。

---

## 3. DOM 渲染与运行时安全性（Security Sandbox）

由于 Mermaid 输出的是可以直接插入浏览器的 SVG 代码，这引入了严重的**跨站脚本攻击（XSS）**隐患。例如，恶意的图表代码可能尝试在节点 Label 中注入 `<script>` 标签或 HTML 属性事件监听器：
```text
graph TD
    A["<img src=x onerror='alert(document.cookie)'>"]
```
如果不加防范，当用户浏览到该图表时，浏览器会立即执行注入的恶意 JavaScript。为此，Mermaid 引入了多层防御机制：

### 3.1 安全级别（Security Levels）

Mermaid 的 `securityLevel` 配置参数控制了渲染时的安全屏障等级：

* **`strict`（默认值）**：拒绝任何形式的 HTML 标签注入。所有的 HTML 实体代码（如 `<` 和 `>`）在渲染前都会被强行转义为纯文本字符串。这是生产环境推荐的安全级别。
* **`antiscript`**：允许使用部分安全的 HTML 标签（例如换行符 `<br>`、加粗 `<b>`、斜体 `<i>`）以实现基本的富文本排版。但在输出到 DOM 树之前，会强制通过 **DOMPurify** 库进行过滤，剔除所有危险属性（如 `onload`, `onclick`, `onerror` 等）及 `javascript:` 伪协议链接。
* **`loose`**：完全不设防，信任所有输入的 HTML 内容。仅适用于受信任的本地编辑环境或静态文档构建期，严禁用于承载用户生成内容（UGC）的在线平台。
* **`sandbox`**：在一个不可见的、受保护的 `<iframe>` 沙箱中执行整个渲染流程，并将生成的静态 SVG 序列化后拷贝回宿主页面。由于 iframe 处于隔离的安全域，即使发生了脚本注入，恶意脚本也无法窃取主域的 Cookie 或访问父窗口的敏感 DOM。

---

## 4. 生产级初始化配置参考

在实际的 mdBook、Docusaurus 或企业内部技术平台集成中，不推荐使用无参的 `mermaid.initialize({})`。以下是一份经过工业级验证的、兼顾安全性与排版美学的初始化配置，包含了详细的参数讲解：

```javascript
// mermaid_config.js
// 生产级 Mermaid 初始化配置示例

mermaid.initialize({
  // 1. 启动与解析选项
  startOnLoad: true,             // 页面加载完成后是否自动寻找具有 .mermaid 类的元素进行渲染
  maxTextSize: 50000,            // 限制单张图表的最大字符数，防止超大文本导致浏览器 CPU 耗尽（防御拒绝服务攻击）
  securityLevel: 'strict',       // 开启严格模式，防御恶意 DOM 注入与 XSS 攻击
  
  // 2. 主题与视觉样式自定义
  theme: 'forest',               // 选用默认主题：default, dark, forest, neutral, base
  themeVariables: {
    fontFamily: '"Fira Code", "PingFang SC", "Microsoft YaHei", sans-serif', // 自定义全局等宽及中文字体
    fontSize: '14px',            // 基准字号大小
    primaryColor: '#e1f5fe',     // 节点默认背景色（浅蓝色）
    primaryBorderColor: '#0288d1',// 节点边框颜色（深蓝色）
    lineColor: '#607d8b'         // 连线边框颜色
  },

  // 3. 流程图（Flowchart）专项排版微调
  flowchart: {
    htmlLabels: false,           // 禁用 HTML Label，强迫改用纯 SVG Text 渲染，能完美防止跨浏览器排版对齐漂移
    curve: 'basis',              // 曲线弯折算法：basis (贝塞尔平滑), linear (直折线), cardinal (折角微弯)
    useMaxWidth: true,           // 开启响应式缩放，SVG 将带有 viewBox 并自适应容器宽度
    diagramPadding: 8,           // 图表四周的外边距
    rankSpacing: 50,             // 层级之间的纵向距离（TB 布局下）
    nodeSpacing: 40              // 同一层内节点之间的左右横向距离
  },

  // 4. 时序图（Sequence Diagram）专项优化
  sequence: {
    actorMargin: 50,             // 参与者（Actor）水平方向的间距
    width: 150,                  // 参与者盒子的默认宽度
    height: 65,                  // 参与者盒子的默认高度
    boxMargin: 10,               // 消息箭头的上下垂直间距
    messageFontSize: 12,         // 消息连线上的文本字号
    mirrorActors: true,          // 当时序图纵向很长时，是否在底部自动追加渲染一份 Actor 列表以方便阅读
    showSequenceNumbers: false,  // 是否在消息线前显示递增的序号（1, 2, 3...）
    wrap: true                   // 参与者名称文本过长时是否自动换行
  },

  // 5. 状态图（State Diagram）专项优化
  state: {
    dividerWidth: 2,             // 并发状态（Concurrent State）分隔线的物理宽度
    dividerMargin: 8,            // 并发分隔线与边界的边距
    animationDefs: ''            // 禁用不必要的 CSS 过渡动画以提升移动端设备渲染性能
  }
});
```

通过这一套底层渲染流水线以及精细化参数控制，我们可以大幅提高图表渲染的稳定性和页面加载性能。在下一部分中，我们将深入剖析具体图表类型的语法与建模规范。
