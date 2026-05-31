# Summary

[引言](README.md)

# 第一部分：队列机制与线程安全

- [队列底层机制](queue/README.md)
    - [第一章：FreeRTOS 队列底层控制结构与内存布局](queue/queue-mechanics.md)
    - [第二章：线程安全机制与中断级 (ISR) 队列通信](queue/thread-safety-usecases.md)

# 第二部分：数据传递模式与性能优化

- [数据拷贝与传递](transfer/README.md)
    - [第三章：值拷贝 (Copy-by-Value) 开销与延迟剖析](transfer/data-copying-overhead.md)
    - [第四章：引用拷贝 (Copy-by-Reference) 指针传递与安全生命周期](transfer/pointer-passing-efficiency.md)
