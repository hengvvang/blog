# 第三章：Polonius 分析器原理与路径敏感分析

尽管非词法生命周期（NLL）极大改善了 Rust 程序员的编码体验，但它在处理跨越不同控制流分支的借用时，仍保留着部分“区段（Region）合并”的保守缺陷。

为了从根本上消除编译期的误判，并为 Rust 借用检查构建更严谨的形式化数学基石，Rust 官方团队推出了下一代借用检查器引擎——**Polonius**。

---

## 1. NLL 的局限与“条件分支借用返回”难题

NLL 的核心理论依然是将生命周期抽象为**控制流图（CFG）中节点集合（即区段 Region）**。这意味着，即使在控制流的某一条分支路径上某个借用早已死掉，由于其他分支对生命周期的长寿约束要求，这个生命周期在合并计算后仍会强行“侵入”那些安全的空闲分支，造成**生命周期过度膨胀**。

### 1.1 经典难题：条件分支借用返回 (The Conditional Return Problem)

我们来看一段在 Rust 中十分常见、语义绝对安全、但在当前的 NLL 检查器下无法通过编译的经典代码：

```rust
struct Node {
    value: String,
    next: Option<Box<Node>>,
}

fn get_or_insert(node: &mut Node) -> &String {
    // 借用 A：尝试以只读方式借用 node.next，获取内部节点的引用
    if let Some(ref next_node) = node.next {
        // 分支 1：如果存在 next，则返回其只读引用 (借用 A 随返回值逃逸出函数)
        return &next_node.value; 
    }
    
    // 借用 B：如果不存在 next，则修改 node 自身的 value，并返回
    node.value = String::from("default"); 
    // ^ NLL 报错：cannot borrow `node.value` as mutable because it is also borrowed as immutable
    
    &node.value
}
```

### 1.2 为什么 NLL 会误报？

我们跟踪 NLL 的推导逻辑：
1. `get_or_insert` 函数的返回签名绑定了生命周期 `'a`，即 `fn get_or_insert(node: &'a mut Node) -> &'a String`。
2. 借用 A（`node.next`）被提取并作为返回值。因此，借用 A 的生命周期必须被扩充，以完全包含 `'a` 的生命周期范围。
3. 由于返回值 `'a` 在函数退出后依然需要在调用者作用域中存活，这意味着 `'a` 的 CFG 区段必须**覆盖整个函数的退出节点**。
4. **NLL 的空间膨胀局限**：NLL 对生命周期的 Region 集合计算是全局合并的。因为 `'a` 在“成功返回”路径上被强行扩充为覆盖整个函数，导致在“未找到 next 节点”的失败 fallback 路径上，`'a` 的区段也被认为处于存活状态。
5. 当执行到 `node.value = String::from("default")` 时，NLL 认为只读借用 A 依旧跨越了这个点，与新发生的可变借用 B 发生了写读冲突，从而报出著名的“三心二意”冲突错。

#### NLL 与 Polonius 控制流对比图

```
NLL 的区段膨胀思路：
                        [ 1. 进入函数 ]
                               |
                   { 2. 是否存在 next 节点? }
                     /                  \
             (Yes)  /                    \ (No)  <-- 被强行扩充的 'a 侵入此分支
                   v                      v
        [ 3. 产生返回引用 'a ]     [ 4. 尝试可变操作 node.value ]
        (覆盖函数退出节点)          (NLL 误判 'a 依旧存活 -> 报错拒绝)

==================================================================

Polonius 的路径敏感思路：
                        [ 1. 进入函数 ]
                               |
                   { 2. 是否存在 next 节点? }
                     /                  \
             (Yes)  /                    \ (No)
                   v                      v
        [ 3. 产生返回引用 'a ]     [ 4. 尝试可变操作 node.value ]
        (Loan A 沿此路径流出)      (Loan A 未流经此路径，已死 -> 正常编译)
```

---

## 2. 基于 Datalog 的声明式借用检查

为了从根源上摆脱 NLL 繁杂的“区段集合求交集”问题，Polonius 将借用检查重新定义为了一个**关系型数据库的递归推理问题**。它使用逻辑编程语言 **Datalog** 来形式化表达所有的所有权与借用规则。

### 2.1 什么是 Datalog？

Datalog 是一种面向数据关系推导的声明式逻辑语言。它的执行过程分为两部分：
*   **事实（Facts）**：从 MIR 中静态提取的初始表结构数据。
*   **规则（Rules）**：逻辑推导公式，基于已有事实通过演绎推理递归生成新的事实。

### 2.2 Polonius 关系数据库的核心输入表（Facts）

Polonius 首先将 Rust 源码编译出的 MIR 控制流拆解为若干张基础关系表：

1.  `cfg_edge(Point1, Point2)`：声明控制流图（CFG）中，程序可以从 `Point1` 执行跳转到 `Point2`。
2.  `loan_issued_at(Origin, Loan, Point)`：声明在 `Point` 处，编译器向生命周期 `Origin` 签发了名为 `Loan` 的借用。
3.  `loan_killed_at(Loan, Point)`：声明在 `Point` 处，被借用的物理对象被改写或重新赋值（意味着 `Loan` 在此点被物理杀除）。
4.  `subset(OriginA, OriginB, Point)`：声明在 `Point` 处，由于赋值或约束，关系约束 $\text{OriginA} \subseteq \text{OriginB}$ 生效。
5.  `var_defined_at(Variable, Point)` / `var_used_at(Variable, Point)`：声明变量在某点被定义或被使用（用于计算活性）。

### 2.3 Polonius 的 Datalog 推导规则（Rules）

在拥有 Facts 的基础上，Polonius 通过 Datalog 规则递归地推导借用是否有效。以下是 Polonius 用以判定“在特定控制流点，哪些生命周期包含了哪些借用”的三个核心公式：

```prolog
% 规则 1：初始化引入。如果在 Point 处，Loan 被签发给 Origin，则在该点 Origin 包含该 Loan
origin_contains_loan_on_entry(Origin, Loan, Point) :-
    loan_issued_at(Origin, Loan, Point).

% 规则 2：子类型约束传播。若 OriginA 在 Point 处包含 Loan，且在该点 OriginA 是 OriginB 的子集，
% 则 OriginB 同样必须包含该 Loan
origin_contains_loan_on_entry(OriginB, Loan, Point) :-
    origin_contains_loan_on_entry(OriginA, Loan, Point),
    subset(OriginA, OriginB, Point).

% 规则 3：沿控制流图传递。如果 Origin 在 Point1 包含 Loan，且程序可以从 Point1 跳转到 Point2，
% 并且 Loan 并没有在 Point1 处被 Killed 摧毁，则 Origin 在 Point2 处继续包含该 Loan
origin_contains_loan_on_entry(Origin, Loan, Point2) :-
    origin_contains_loan_on_entry(Origin, Loan, Point1),
    cfg_edge(Point1, Point2),
    !loan_killed_at(Loan, Point1).
```

这三条清爽的逻辑推导公式，将 NLL 中晦涩的区间计算彻底降解为了标准的**图的连通性判定**。

---

## 3. 事实生成与路径敏感性（Path-Sensitivity）的本质

Polonius 能够完美征服“条件分支借用返回”的关键，在于其具备**路径敏感性（Path-Sensitivity）**。

### 3.1 `get_or_insert` 生成事实的推导链路

当编译器运行 Polonius 并解析 `get_or_insert` 函数的 MIR 时，两路分支生成的事实呈现出如下拓扑形态：

#### 路径一：成功分支（Some 路径）
1. 在 MIR 基本块 `bb1` 处，由于发生了 `if let Some(ref next_node) = node.next`，编译器录入：
   `loan_issued_at('origin_next, Loan_NodeNext, bb1)`
2. 因为该值被返回，编译器检测到返回值类型转换，在 `bb1` 出口建立约束：
   `subset('origin_next, 'origin_return, bb1)`
3. 根据 **Datalog 规则 2**，Polonius 演绎推理出：`origin_contains_loan_on_entry('origin_return, Loan_NodeNext, bb1)`。
4. 由于 `bb1` 最终直接跳往函数退出基本块，这个包含关系沿此路径顺利传播出函数。

#### 路径二：失败分支（None 路径）
1. 控制流在 `bb0` 处的判定条件失败后，直接跳转至 fallback 分支 `bb2`。
2. 关键点：在跳转到 `bb2` 的这条路径上，**根本没有执行任何与 `'origin_return` 相关的 subset 约束定义，也没有签发任何涉及 `Loan_NodeNext` 的借用**。
3. 因此，在计算 `bb2` 处的 `origin_contains_loan_on_entry` 时，在失败分支的路径上**没有任何源头事实能够证明 `'origin_return` 包含了 `Loan_NodeNext`**。
4. 结果：在 `node.value = String::from("default")` 这条控制路径上，只读借用 `Loan_NodeNext` 早已消亡，完全没有存活痕迹。

### 3.2 路径敏感子集包含流转图

```
                   [ subset('a, 'b, P) 的约束推导网 ]
                   
           Some 分支 (bb1)                  None 分支 (bb2)
      +-------------------------+      +-------------------------+
      | loan_issued('a, Loan_A) |      |      (没有 Loan_A)      |
      |          |              |      |                         |
      |          v              |      |                         |
      |  subset('a, 'return)    |      |                         |
      |          |              |      |                         |
      |          v              |      |                         |
      | 'return 包含 Loan_A     |      | 'return 保持干净         |
      +-------------------------+      +-------------------------+
                   |                                |
                   v (返回调用者)                    v (可变借用 node.value)
         [ 成功带走 Loan_A ]               [ 无冲突，完美编译通过 ]
```

NLL 之所以失败，是因为它采用的 Region 包含是全局的：如果 `'a: 'b` 在一处成立，则 `'a` 和 `'b` 的区间集合就会在整个控制流图上强制相交。而 Polonius 通过引入带有点信息（Point）的 `subset(OriginA, OriginB, Point)`，让约束在控制流中**只沿特定路径传递**。在不相关的路径上，没有约束，就没有限制。

---

## 4. NLL 与 Polonius 深度对比

| 维度 | NLL (当前借用检查器) | Polonius (新一代借用检查器) |
| :--- | :--- | :--- |
| **理论基石** | 语法扩展区域 + 基于 CFG 的集合迭代求交 | 关系代数 + Datalog 关系闭包求值 |
| **判定精度** | 较粗（在多分支复杂路径下易发生生命周期污染）| 极精（点对点路径敏感，彻底消除虚假冲突） |
| **条件返回难题**| 无法解决（必须借用重构或使用 Unsafe 规避） | 天然支持，无任何副作用 |
| **诊断排查** | 诊断信息主要依赖编译器在出错点做启发式猜测 | 能够根据 Datalog 的推导链给出精确的证据链路 |
| **编译性能** | 快（运行时间几乎呈线性） | 慢（处理大函数的关系闭包计算开销大） |

---

## 5. Polonius 的核心攻坚：性能优化与 Datafrog 引擎

Polonius 虽在精度上达到了无可挑剔的理论顶峰，但其面临的最大实际挑战是：**编译速度暴跌**。

由于关系代数中的传递闭包计算非常消耗计算资源，在遇到复杂的超长函数时，朴素的 Datalog 求解器会导致 Rust 编译时间暴涨数倍。

### 5.1 Datafrog 引擎

为了在 rustc 中实用化 Polonius，研究团队专门使用 Rust 开发了名为 **Datafrog** 的超轻量级、针对编译期静态分析优化的 Datalog 求解器引擎。

Datafrog 的两大核心优化法宝：
1.  **Leapjoin（增量连接）**：这是针对关系数据库的一种快速多路连接（multi-way join）算法。每次迭代时，Datafrog 仅对上一轮产生的新事实进行增量计算，绝不重复计算已知关系。
2.  **极致的内存紧凑性**：Datafrog 丢弃了所有花哨的对象模型，直接在高度压缩的、有序的 `Vec<u32>` 整数数组上执行底层的关系运算（如投影、连接、并集）。这极大提高了 CPU 缓存局部性，让现代 CPU 能够快速完成关系代数的跳转分析。

### 5.2 rustc 开发者体验

目前，Polonius 的开发工作仍在持续推进中。如果你使用 Nightly 版本的 Rust，可以通过在编译命令中加入不稳定的编译器标志来显式开启 Polonius 引擎进行测试：

```bash
# 使用 Nightly 编译器启用 polonius 借用分析器
rustc +nightly -Zpolonius main.rs
```

在 Polonius 被完全融入为 rustc 的默认核心之前，对它的持续优化将确保未来的 Rust 既能保持绝对的零成本抽象与高安全性，也能为广大开发者扫清一切生硬的借用检查障碍。
