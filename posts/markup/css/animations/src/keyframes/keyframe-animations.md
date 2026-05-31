# 第二章：CSS 关键帧动画设计与控制机制

要构建高度定制的复杂时序动画，如带有特定物理规律的抛物线轨迹、分段递进式逻辑、或是可被动态暂停/调整的动画，必须深入探索 CSS 关键帧（Keyframe）的底层运行时机制。本章将从 CSS 级联（Cascade）优先级、动画合成选项、时空正交解耦以及生产级物理建模等维度进行深度剖析。

---

## 1. `@keyframes` 的时空局部插值定理

很多开发者在编写动画时，容易在包含动画声明的选择器上写入全局 `animation-timing-function`，并期望它贯穿始终。但从浏览器的插值空间来看，这是一个严重的认知偏差。

> [!IMPORTANT]
> **局部插值定理**：在 CSS 关键帧动画中，插值函数（Timing Function）并不是作用于整个动画的 $0\%$ 到 $100\%$，而是作用于**当前关键帧与下一关键帧之间的局部时域区间**。

```css
/* 
  局部插值时序演化示例 
*/
@keyframes complex-sequence {
  0% {
    transform: translateX(0);
    /* 0% 到 40% 的区间使用 ease-in 加速插值 */
    animation-timing-function: ease-in;
  }
  40% {
    transform: translateX(100px);
    /* 40% 到 100% 的区间使用 cubic-bezier 减速曲线插值 */
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  100% {
    transform: translateX(300px);
    /* 100% 帧的 timing-function 无效，因为没有后续帧 */
  }
}
```

每个控制属性在特定时间点的值会被解析为该区间插值方程的控制边界，这使得我们可以在单个 `@keyframes` 声明中混合多种不同的运动节奏。

---

## 2. 动画核心属性的级联层级与内存机制

### 2.1 CSS 级联优先级中的 Animation 陷阱

许多人在使用 `animation-fill-mode: forwards` 后会发现，动画结束停留在最后一帧时，通过 JavaScript 直接修改该元素的 inline style（如 `element.style.transform`）或者触发 `:hover` 伪类样式，都无法改变元素的展示形态。这是由 CSS 级联规范（CSS Cascade Specification）中的层级决定的。

#### 规范定义的 CSS 级联优先级金字塔（从高到低）：

```text
 ┌────────────────────────────────────────────────────────────┐ ▲ 高优先级 (High)
 │ 1. !important 浏览器默认样式 (Important User Agent)       │ │
 ├────────────────────────────────────────────────────────────┤ │
 │ 2. !important 用户配置样式 (Important User)                │ │
 ├────────────────────────────────────────────────────────────┤ │
 │ 3. !important 开发者样式 (Important Author)                │ │
 ├────────────────────────────────────────────────────────────┤ │
 │ 4. 运行中与处于 Forwards 状态的动画 (Active Animations)    │ │ ◄── 强力压制普通的行内样式！
 ├────────────────────────────────────────────────────────────┤ │
 │ 5. 常规开发者样式 (Normal Author: 行内样式、Class、ID 等)    │ │
 ├────────────────────────────────────────────────────────────┤ │
 │ 6. 活跃中的过渡状态 (Active Transitions)                   │ │
 ├────────────────────────────────────────────────────────────┤ │
 │ 7. 常规用户自定义样式 (Normal User)                         │ │
 ├────────────────────────────────────────────────────────────┤ │
 │ 8. 常规浏览器默认样式 (Normal User Agent)                   │ │
 └────────────────────────────────────────────────────────────┘ ● 低优先级 (Low)
```

如上图所示，**处于运行或 Forwards 填充状态的动画样式（Active Animations）在级联树中具有高于普通行内样式（Normal Author）的优先级**。只要动画处于绑定状态且 `fill-mode` 被激活，普通的行内样式就无法覆盖它。

#### 💡 解决办法：
若要通过 JS 重写被动画冻结的样式，必须：
1.  临时将 `animation` 或 `animation-name` 属性清除。
2.  或者在 JavaScript 的 inline style 中使用 `!important` 强行将其提升至级联金字塔的第 3 层（Important Author）进行覆盖。

---

### 2.2 动画叠加合成：`animation-composition`

当多个动画规则同时作用在同一个 DOM 元素的同一个 CSS 属性上（例如不同 Class 叠加触发各自的 `transform`），会发生什么？在传统的 CSS 规范中，后声明的动画会直接覆盖（Replace）先声明的动画。

而在现代 CSS 中，可以通过 `animation-composition` 属性声明叠加算法：
*   **`replace`**：默认行为。后定义的关键帧计算值直接覆盖先前的计算值。
*   **`add`**：将当前关键帧的计算值与先前层级的动画计算值进行**求和拼接**。例如先前动画计算出的 transform 是 `scale(1.2)`，当前动画是 `translateX(50px)`，则合成为 `scale(1.2) translateX(50px)`。
*   **`accumulate`**：累加合并。对于数值型属性（如宽度、位移），会进行代数求和。例如先前宽度为 `100px`，当前累加 `50px`，结果为 `150px`。

---

### 2.3 `animation-play-state` 与 CSS 自定义变量的运动控制

相较于直接增删 Class 导致动画强行复位，将 `animation-play-state` 设为 `paused` 能将元素的所有物理渲染纹理原位挂起在合成线程中，且保持当前的级联状态不变。

此外，结合 CSS 变量（CSS Variables），我们能够将动画的生命周期控制权交还给 CSS：

```css
:root {
  /* 定义动画全局运行速度，可通过 JS 动态修改 (如 speed-range-slider) */
  --animation-speed-factor: 1.5s;
  --bounce-target-y: -120px;
}

.physics-particle {
  width: 40px;
  height: 40px;
  background-color: #f59e0b;
  border-radius: 8px;
  
  /* 动态计算持续时间 */
  animation: dynamic-bounce var(--animation-speed-factor) infinite alternate cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}

/* 鼠标悬停时原位暂停，完全保留显存中的纹理，免去重排开销 */
.physics-particle:hover {
  animation-play-state: paused;
}

@keyframes dynamic-bounce {
  0% {
    transform: translateY(0);
  }
  100% {
    /* 引用 CSS 自定义变量，使得轨迹振幅也能被 JS 动态介入 */
    transform: translateY(var(--bounce-target-y));
  }
}
```

---

## 3. 多轨道空间正交解耦法则（Orthogonal Decoupling）

在设计带有复杂物理轨迹的动效（例如同时沿 X 轴匀速推进和沿 Y 轴自由落体的抛物线）时，如果试图在一个关键帧时间轴内混合编写 `transform: translate(x, y)`，由于 $x$ 和 $y$ 的时间分配共享同一个 `animation-timing-function`，我们将不得不使用极其复杂的矩阵公式（如 `matrix3d`）才能完成逼近。

### 3.1 嵌套 Wrapper 正交分解方案

物理学中，抛物线运动可以通过正交基分解为：
*   **水平方向（X 轴）**：不受重力影响，做匀速直线运动。
*   **垂直方向（Y 轴）**：受重力加速度影响，做带缓动的加速下落与反弹运动。

为了将这种数学解耦映射到前端，我们应当采用**双图层嵌套结构**：

```text
 场景可视区域 (Viewport)
 ┌────────────────────────────────────────────────────────┐
 │  [水平运动容器 gravity-x-axis] ──> 仅控制 X 轴匀速位移    │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │  [垂直渲染主体 gravity-y-axis] ──> 仅控制 Y 轴物理回弹 │  │
 │  │  ┌──────────┐                                    │  │
 │  │  │  物理小球  │                                    │  │
 │  │  └──────────┘                                    │  │
 │  └──────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────┘
```

这种正交嵌套能够完美规避矩阵乘法带来的坐标系翻转和速度混叠，使得两轴动效的调优完全互不干扰。

---

## 4. 生产级复杂动效实战案例

### 4.1 案例一：多阶段步进式进度条（Multi-stage Stepped Loader）

此案例模拟了一个复杂的页面载入进度反馈：
1.  **阶段 1 (0% ~ 30%)**：极速启动加载，模拟静态文件（HTML/CSS）快速解析完成。
2.  **阶段 2 (30% ~ 75%)**：进入漫长的网络握手与服务端渲染等待期（API 握手延时），进度条呈匀速爬坡。
3.  **阶段 3 (75% ~ 100%)**：API 数据返回，瞬间大马力冲刺至终点，并在末尾段产生明显的减速阻尼效果。

```html
<!-- Stepped Loader Container -->
<div class="stepped-loader-container" role="progressbar" aria-valuemin="0" aria-valuemax="100">
  <div class="stepped-loader-bar"></div>
</div>
```

```css
/* 进度条外壳 */
.stepped-loader-container {
  width: 100%;
  max-width: 500px;
  height: 8px;
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 渲染进度主体 */
.stepped-loader-bar {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%);
  /* 
    使用 scaleX(0) 配合左侧变换锚点 (transform-origin)
    相比于直接改变 width 属性，scaleX 可以完全由 GPU 合成线程渲染，规避 Layout 性能惩罚。
  */
  transform-origin: left center;
  transform: scaleX(0);
  
  /* 绑定 6 秒动画，结束后保持最终 100% 的展示状态 */
  animation: stepped-progress-calc 6s forwards;
}

@keyframes stepped-progress-calc {
  /* 阶段 1：极速起步 (0% 至 30% 进度) */
  0% {
    transform: scaleX(0);
    animation-timing-function: cubic-bezier(0.12, 0.8, 0.35, 1);
  }
  
  /* 阶段 2：长途跋涉缓慢爬坡 (30% 至 75% 进度) */
  35% {
    transform: scaleX(0.3);
    animation-timing-function: linear; /* 线性平稳过渡，模拟后台握手 */
  }
  
  /* 阶段 3：接口数据到达，冲刺至终点 */
  80% {
    transform: scaleX(0.75);
    animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1); /* 强力减速，完美收尾 */
  }
  
  100% {
    transform: scaleX(1);
  }
}
```

---

### 4.2 案例二：重力衰减抛物线物理轨迹（Parabolic Gravity Bounce）

此案例使用上一节介绍的“多轴嵌套正交解耦”方案，实现一个小球沿抛物线轨迹运动，并在触地时进行高度逐渐衰减的物理回弹。

```html
<!-- 物理小球仿真场景 -->
<div class="gravity-viewport">
  <div class="gravity-x-axis">
    <div class="gravity-y-axis"></div>
  </div>
</div>
```

```css
/* 仿真场景视区 */
.gravity-viewport {
  position: relative;
  width: 100%;
  height: 350px;
  background-color: #0b0f19;
  border-bottom: 4px solid #1f2937;
  overflow: hidden;
}

/* X 轴恒速推进轨道 (水平方向) */
.gravity-x-axis {
  position: absolute;
  left: 0;
  bottom: 280px; /* 初始抛出高度 */
  
  /* 4秒完成一趟水平抛出过程 */
  animation: travel-horizontal 4s linear infinite;
  will-change: transform;
}

/* Y 轴受重力加速度与回弹衰减影响的渲染主体 (垂直方向) */
.gravity-y-axis {
  width: 24px;
  height: 24px;
  background-color: #f43f5e;
  border-radius: 50%;
  box-shadow: 0 4px 14px rgba(244, 63, 94, 0.5);
  
  /* 
    Y 轴物理回弹动画。
    利用不同的贝塞尔曲线在下降和上升段拟合重力加速度和能量损失。
  */
  animation: bounce-vertical 4s cubic-bezier(0.35, 0.03, 0.7, 0.15) infinite;
  will-change: transform;
}

/* 水平匀速位移 */
@keyframes travel-horizontal {
  0% {
    transform: translateX(0);
  }
  100% {
    /* 抛出至 600px 处 */
    transform: translateX(600px);
  }
}

/* 垂直方向重力加速度与回弹 */
@keyframes bounce-vertical {
  /* t=0: 从 280px 高度静止释放，受重力影响开始下落 */
  0% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.35, 0.03, 0.7, 0.15); /* 加速下坠 */
  }
  
  /* t=25%: 第一次触地 (下落 220px)，发生弹性碰撞，能量衰减 */
  25% {
    transform: translateY(220px);
    animation-timing-function: cubic-bezier(0.25, 1, 0.5, 1); /* 反弹减速上升 */
  }
  
  /* t=45%: 首次反弹顶点，反弹高度损失 50% (最高反弹至 110px) */
  45% {
    transform: translateY(110px);
    animation-timing-function: cubic-bezier(0.35, 0.03, 0.7, 0.15); /* 再次加速下降 */
  }
  
  /* t=65%: 第二次触地，能量进一步损失 */
  65% {
    transform: translateY(220px);
    animation-timing-function: cubic-bezier(0.25, 1, 0.5, 1); /* 反弹减速上升 */
  }
  
  /* t=80%: 第二次反弹顶点，高度再次腰斩 (反弹至 165px) */
  80% {
    transform: translateY(165px);
    animation-timing-function: cubic-bezier(0.35, 0.03, 0.7, 0.15);
  }
  
  /* t=92%: 第三次触地 */
  92% {
    transform: translateY(220px);
    animation-timing-function: cubic-bezier(0.25, 1, 0.5, 1);
  }
  
  /* t=97%: 第三次极其微弱的反弹 */
  97% {
    transform: translateY(205px);
    animation-timing-function: cubic-bezier(0.35, 0.03, 0.7, 0.15);
  }
  
  /* t=100%: 滚动至稳定静止状态 */
  100% {
    transform: translateY(220px);
  }
}
```

通过这一物理轨道的实现，开发者能在无任何 JavaScript 周期性干预下，产出极其生动的拟真物理动效。在下一章节中，我们将直面 CSS 动效优化中最核心的硬核课题——渲染管道与 GPU 硬件加速调优。
