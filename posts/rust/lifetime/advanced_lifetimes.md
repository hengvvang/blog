---
title: "Rust 高级生命周期约束与 HRTB 详解"
publishTime: "2026-05-24 14:20"
---
# Rust 高级生命周期约束与 HRTB 详解

当我们在 Rust 中编写高度通用的泛型代码、闭包或 trait 约束时，普通的生命周期标记可能无法满足需求。

## 生命周期子类型化 (Subtyping)

在 Rust 中，生命周期也具有子类型关系。如果 `'a` 生命周期长于 `'b`，则称 `'a` 是 `'b` 的子类型，记作 `'a: 'b`（读作 `'a` 至少活得和 `'b` 一样长）：

```rust
struct Ref<'a, T: 'a> {
    r: &'a T,
}
```

## 高阶生命周期约束 (HRTB)

有些时候，我们希望限制一个闭包能接受**任意**生命周期的引用，而不是某个**特定**生命周期。这就需要高阶生命周期约束（Higher-Rank Trait Bounds, HRTB）：

```rust
// for<'a> 表示对任意生存期 'a 均成立
fn call_with_ref<F>(f: F)
where
    F: for<'a> Fn(&'a i32),
{
    let val = 10;
    f(&val);
}
```

这保证了不管传入的引用生命周期有多短，函数内部的闭包调用都是合法的。