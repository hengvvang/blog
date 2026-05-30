# 第二章：Keyframe 动画深度解析与数学建模

虽然简单的过渡效果足以应对普通的悬浮反馈，但要实现复杂的叙事动效、多阶段状态变更或与物理规律贴合的动态轨迹，则必须深度驾驭 CSS Keyframe 动画。本章将对 `@keyframes` 的语法机理、核心控制属性的渲染树行为，以及多轨道复杂动画的数学建模进行深度解构。

---

## 1. `@keyframes` 运行机理与插值空间

`@keyframes` 规则并不是简单的样式声明集合，而是对一个参数化时间轴（Parametric Timeline）的定义。浏览器在解析 `@keyframes` 时，会为其构建一个**关键帧插值映射表**。

### 1.1 局部时域插值定理
很多开发者错误地认为，在包含 `@keyframes` 的选择器上声明的 `animation-timing-function` 会作用于整个动画的起点到终点。实际上：

> [!IMPORTANT]
> 在 CSS 动画中，插值曲线（Timing Function）是应用在**当前关键帧与下一关键帧之间的时域区间**内，而不是整个动画的全局生命周期。

```css
@keyframes complex-move {
  0% {
    transform: translateY(0);
    /* 0% 到 50% 之间使用 ease-in 曲线进行插值 */
    animation-timing-function: ease-in; 
  }
  50% {
    transform: translateY(-100px);
    /* 50% 到 100% 之间使用 cubic-bezier 曲线进行插值 */
    animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1); 
  }
  100% {
    transform: translateY(100px);
  }
}
```

在上面的代码中：
- 从 $t = 0\%$ 到 $t = 50\%$，浏览器使用 `ease-in` 算法计算元素的 `translateY` 坐标。
- 从 $t = 50\%$ 到 $t = 100\%$，浏览器切换为 `cubic-bezier(0.19, 1, 0.22, 1)`（超强减速曲线）计算坐标。
- 在 $100\%$ 帧声明的 `animation-timing-function` 是无效的，因为其后没有下一帧。

---

## 2. 动画核心属性的渲染树行为与内存模型

### 2.1 `animation-fill-mode` 的底层渲染状态
`animation-fill-mode` 决定了元素在动画非激活期（延迟期间与结束之后）的 CSS 样式应用行为。我们可以从**渲染状态树（Render Style Tree）**的叠加态来理解它的四种行为：

```
时间轴线：
[ 声明动画 ] ----------------- [ 动画开始 (0%) ] ----------------- [ 动画结束 (100%) ] ---------------->
  |<------- 延迟期 (delay) ------->|<----------- 执行期 ----------->|<---------- 结束期 ----------->|
```

| 填充模式 | 延迟期 (Delay Period) 的状态应用 | 结束期 (Finished Period) 的状态应用 |
| :--- | :--- | :--- |
| **`none`** | 应用元素本来的 CSS 样式（Base Style） | 恢复应用元素本来的 CSS 样式 |
| **`forwards`** | 应用元素本来的 CSS 样式（Base Style） | 冻结并应用 $100\%$（或 $to$）关键帧的计算值 |
| **`backwards`**| 立即应用 $0\%$（或 $from$）关键帧的计算值 | 恢复应用元素本来的 CSS 样式 |
| **`both`** | 立即应用 $0\%$（或 $from$）关键帧的计算值 | 冻结并应用 $100\%$（或 $to$）关键帧的计算值 |

#### 内存与合成器开销提示
使用 `forwards` 或 `both` 时，虽然给开发带来了便利，但元素的状态会被无限期保留在合成层（Composited Layer）中，直到动画类名或样式被显式移除。这在拥有成千上万个元素的复杂页面中，可能会导致 GPU 内存碎片化与性能降级。

### 2.2 `animation-play-state` 与 CSS 自定义属性的无缝集成
在实际交互中，如果需要通过 JavaScript 暂停动画，常规做法是修改 class。但是，这会导致动画直接“跳跃”回初始状态或中断，无法实现**原位暂停与平滑恢复**。

利用 `animation-play-state: paused` 可以实现原位挂起。结合 CSS 变量（CSS Variables），我们甚至能动态改变动画的执行速率：

```css
:root {
  /* 全局动画速度系数，可通过 JS 动态修改 */
  --global-anim-speed: 1s; 
  --pulse-scale: 1.2;
}

.radar-ping {
  width: 100px;
  height: 100px;
  border: 2px solid #00ffcc;
  border-radius: 50%;
  
  /* 使用 CSS 变量控制持续时间 */
  animation: ping-sweep var(--global-anim-speed) cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  
  /* 默认为运行状态 */
  animation-play-state: running;
}

/* 悬停时原位挂起，不销毁当前渲染上下文 */
.radar-ping:hover {
  animation-play-state: paused;
}

@keyframes ping-sweep {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(var(--pulse-scale));
    opacity: 0;
  }
}
```

---

## 3. 多轨道复杂动画组合与拆解（Nested & Composite Animations）

在三维空间或复杂的二维曲线（如抛物线、李萨如图形）中运动时，如果只在单个 DOM 元素的 `transform` 属性中混合编写 `rotate`、`translate` 和 `scale`，很容易因为变换矩阵（Transformation Matrix）的相乘顺序问题，导致动画轨迹产生非预期的扭曲（例如，旋转后再平移，平移的方向会跟随旋转角度而改变）。

### 3.1 复合轨道的数学解耦法则
为了解除这种空间自由度上的耦合，企业级动效设计通常采用**嵌套 DOM 结构（DOM Nesting Wrapper）**。通过将不同维度或轴向的运动拆分到不同的图层实体上，实现数学意义上的“正交基分解”：

```
[父级包裹层 (Parent Wrapper)] ---> 控制 X 轴运动 (线性时间轴)
       |
       v
  [子级渲染层 (Child Renderer)] ---> 控制 Y 轴运动 (带物理缓动的时间轴，模拟重力)
```

通过这种正交分解，我们能非常轻松地实现一条标准的物理抛物线轨迹，而不需要编写任何复杂的 `matrix3d()` 变换。

---

## 4. 生产级实战案例

### 4.1 案例一：多阶段步进式进度条（Multi-stage Stepped Loader）
本案例展示了一个三阶段的阶梯式加载动效，每个阶段都有不同的时间分配和插值曲线。

```html
<!-- 进度条 HTML 结构 -->
<div class="stepped-loader-container">
  <div class="stepped-loader-bar"></div>
</div>
```

```css
.stepped-loader-container {
  width: 100%;
  max-width: 600px;
  height: 6px;
  background-color: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.stepped-loader-bar {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  transform-origin: left center;
  
  /* 挂载动画：5秒完成，保留最后一帧状态 */
  animation: step-loading-progress 5s forwards;
}

@keyframes step-loading-progress {
  /* 阶段 1：快速起步，加载至 30% (模拟静态资源加载完毕) */
  0% {
    transform: scaleX(0);
    animation-timing-function: cubic-bezier(0.1, 0.8, 0.3, 1);
  }
  
  /* 阶段 2：30% 至 70% 陷入缓慢爬坡期 (模拟网络握手与 API 网关响应) */
  30% {
    transform: scaleX(0.3);
    animation-timing-function: linear; /* 匀速爬坡 */
  }
  
  /* 阶段 3：70% 时数据返回，瞬间冲刺至 100% (模拟数据渲染及初始化) */
  75% {
    transform: scaleX(0.70);
    animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1); /* 强力减速收尾 */
  }
  
  100% {
    transform: scaleX(1);
  }
}
```

### 4.2 案例二：重力衰减抛物线物理轨迹（Parabolic Gravity Bounce）
本案例利用上一节介绍的“多轨道解耦”方案，实现一个受重力加速度影响并在落地时回弹的抛物线动画。

```html
<!-- 物理轨迹 HTML 结构 -->
<div class="scene">
  <div class="gravity-x-axis">
    <div class="gravity-y-axis"></div>
  </div>
</div>
```

```css
.scene {
  position: relative;
  width: 100%;
  height: 400px;
  background-color: #0f172a;
  border-bottom: 4px solid #1e293b;
  overflow: hidden;
}

/* X 轴控制轨道：恒定速度向前滑行 */
.gravity-x-axis {
  position: absolute;
  left: 0;
  bottom: 300px; /* 初始悬挂高度 */
  animation: move-x 4s linear infinite;
}

/* Y 轴控制轨道：应用重力加速度与回弹 */
.gravity-y-axis {
  width: 30px;
  height: 30px;
  background-color: #f43f5e;
  border-radius: 50%;
  box-shadow: 0 4px 12px rgba(244, 63, 94, 0.4);
  
  /* Y 轴动画的周期必须与 X 轴完全对齐或成倍数关系 */
  animation: bounce-y 4s cubic-bezier(0.3, 0.05, 0.7, 0.2) infinite;
}

/* X 轴：匀速向前推进 600 像素 */
@keyframes move-x {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(600px);
  }
}

/* Y 轴：模拟受重力影响产生的加速下落与回弹衰减 */
@keyframes bounce-y {
  /* 起始高度，静止下落 */
  0% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.45, 0, 1, 1); /* 加速下落 */
  }
  
  /* 首次触地 (下落 250px) */
  25% {
    transform: translateY(250px);
    animation-timing-function: cubic-bezier(0, 0, 0.35, 1); /* 减速反弹 */
  }
  
  /* 首次反弹顶点 (反弹高度损失 50%) */
  45% {
    transform: translateY(125px);
    animation-timing-function: cubic-bezier(0.45, 0, 1, 1); /* 再次加速坠落 */
  }
  
  /* 第二次触地 */
  65% {
    transform: translateY(250px);
    animation-timing-function: cubic-bezier(0, 0, 0.35, 1); /* 减速反弹 */
  }
  
  /* 第二次反弹顶点 (高度进一步衰减) */
  80% {
    transform: translateY(187px);
    animation-timing-function: cubic-bezier(0.45, 0, 1, 1);
  }
  
  /* 第三次触地并保持稳定 */
  95%, 100% {
    transform: translateY(250px);
  }
}
```

通过这一正交物理模型的实践，我们可以写出非常流畅的物理感动画。在接下来的章节中，我们将直面 Web 动效的核心痛点——浏览器渲染引擎的执行瓶颈与硬件加速调优。
