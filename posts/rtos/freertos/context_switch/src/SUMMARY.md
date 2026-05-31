# Summary

[引言](README.md)

# 第一部分：任务调度与堆栈布局

- [任务调度器与 TCB](scheduling/README.md)
    - [第一章：TCB 结构体与任务堆栈初始化](scheduling/tcb-stack-layout.md)

# 第二部分：上下文切换底层实现

- [上下文切换原理](context/README.md)
    - [第二章：PendSV 异常与上下文切换汇编实现](context/pendsv-handler.md)

# 第三部分：优先级反转与互斥锁

- [优先级反转与防范](hazards/README.md)
    - [第三章：优先级反转成因与互斥锁优先级继承机制](hazards/priority-inversion-mutexes.md)
