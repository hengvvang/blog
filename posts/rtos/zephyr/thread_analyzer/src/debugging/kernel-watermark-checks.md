# 第二章：栈高水位计算与 MPU 硬件保护机制

当系统在恶劣多变的工业现场运行时，瞬时的高频中断嵌套、长数据链解析或未被充分验证的深层递归，随时可能导致栈溢出。一旦栈溢出，将破坏邻近内存中的关键控制结构，导致难以复现的诡异崩溃。

本章将详细剖析 Zephyr 内部是如何通过**硬件内存保护单元（MPU）**和**软件哨兵（Canary）**来构建全方位的防线，并重点讲解当保护被触发时，如何通过硬故障（HardFault）现场的底层寄存器快速定位到故障源头。

---

## 2.1 MPU 硬件栈保护机制 (CONFIG_HW_STACK_PROTECTION)

硬件栈保护是最高效、最可靠的检测手段。在启用 `CONFIG_HW_STACK_PROTECTION=y` 后，Zephyr 将利用处理器的 **内存保护单元 (MPU - Memory Protection Unit)** 或物理内存管理单元 (MMU)，为每一个活动线程的栈底构筑物理意义上的“禁写入屏障”。

### 2.1.1 MPU 警戒区 (MPU Guard Region) 对齐与保护原理

在递减栈结构中，栈从高地址向低地址方向增长。为了在物理层拦截溢出行为，内核会在栈的最低地址端（即栈限 Stack Limit 之下）划定一个固定大小的内存页作为 **MPU 警戒区**。

#### MPU 警戒区物理映射与对齐图解

```text
               SRAM 物理地址空间 (Physical Address Space)
               +-----------------------------------------+ High Address
               |                                         |
               |       线程正常运行栈区 (Normal Stack)   |
               |       (允许读写: Read / Write)          |
               |                                         |
               +-----------------------------------------+ <--- 栈限制 (Stack Limit / Guard Base)
               |:::::::::::::::::::::::::::::::::::::::::| (物理地址必须符合 MPU 对齐对齐线)
               |:::::::::::::::::::::::::::::::::::::::::|
               |       MPU 警戒区 (MPU Guard Region)     |
               |       (禁止读写: No Access / Fault On)  |
               |:::::::::::::::::::::::::::::::::::::::::|
               |:::::::::::::::::::::::::::::::::::::::::|
               +-----------------------------------------+ <--- 警戒区终点 (Guard End / Aligned Boundary)
               |                                         |
               |       其他线程的栈空间 或 线程控制块 TCB | (受到警戒区的保护，不被踩坏)
               |                                         |
               +-----------------------------------------+ Low Address
```

#### 底层工作逻辑：

1.  **静态对齐与声明**：
    由于经典的 ARMv7-M 架构对 MPU Region 具有严格的**地址对齐与大小限制**（Region 大小必须为 $2^N$ 字节且物理起始地址必须是 Region 大小的整数倍，例如 32B/64B/128B/1KB 对齐），Zephyr 的栈分配宏会在链接期自动计算对齐边界，以保证物理栈底（Stack Limit）能够恰好匹配 MPU 的起始边界。
2.  **动态重映射 (Context Switch Context Updates)**：
    当内核调度器（`_Swap`）执行线程切换时，CPU 会切入特权态。内核会更新 MPU 寄存器配置，将切入线程对应的 Guard 区域设置为 **无特权及特权均不可访问 (No Access)**。
3.  **零延迟硬件拦截 (Zero-latency Catch)**：
    当线程发生栈溢出，导致 `PSP` 指针压栈或进行局部变量写入试图踏入 Guard 区域的瞬间，处理器的内部硬件总线解码器会立刻截获这一非法访问行为。此时，**数据还没有被物理写入 SRAM**，硬件已经向内核抛出 **MemManage Fault** 中断。这种拦截是“机器周期级”的，完全杜绝了数据踩踏的可能。

---

## 2.2 ARMv8-M 架构下的硬件栈限制寄存器

在现代的 ARMv8-M 架构（如 Cortex-M33、Cortex-M55 等）中，ARM 在处理器核心内部直接集成了**栈限制寄存器（Stack Limit Registers）**，Zephyr 能够利用该寄存器实现更为优雅的硬件防御。

### 核心寄存器：
*   `MSPLIM`：主栈指针限制寄存器（Main Stack Pointer Limit Register）
*   `PSPLIM`：进程栈指针限制寄存器（Process Stack Pointer Limit Register）

### 硬件对比流程：

```text
               [ CPU 执行 PUSH / 栈指针更新操作 ]
                              │
                              ▼
               [ 硬件自动比较: PSP_new < PSPLIM ? ]
                              │
               ┌──────────────┴──────────────┐
            是 │                           否 │
               ▼                              ▼
      [ 立即抛出 UsageFault ]          [ 写入 SRAM ]
      (零内存对齐/零大小浪费)          (正常代码执行)
```

1.  **运行状态更新**：
    在上下文切换期间，内核不再需要重新配置复杂的 MPU Region 控制块，而仅仅需执行一条汇编指令，将目标线程的物理栈底地址（`Stack Limit`）写入到寄存器 `PSPLIM` 中：
    ```assembly
    MSR PSPLIM, R0  ; R0 中存放即将运行线程的最低栈物理边界
    ```
2.  **零碎片与零对齐损耗**：
    `PSPLIM` 支持以**任意字节边界**进行硬件拦截，彻底摆脱了 ARMv7-M MPU 强制要求 $2^N$ 字节对齐所带来的 RAM 碎片浪费。因此，在 ARMv8-M 平台上，`CONFIG_HW_STACK_PROTECTION` 的 RAM 开销降为零。

---

## 2.3 软件哨兵金丝雀检测 (CONFIG_STACK_SENTINEL)

针对不支持 MPU 或受硬件设计局限无法开启 MPU 功能的极低端 MCU，Zephyr 提供了软件级别防御方案：**Canary 哨兵值检测**。

### 工作机制与 Canary 设计

1.  **安全金丝雀（Canary Byte）**：
    在线程被创建时，内核会在其物理栈的最底端（栈生长方向的临界点）强行埋入一个 32 位的特殊魔术常数（金丝雀字节），默认值为 `0xDEADBEEF`。
2.  **调度期例行巡检**：
    每次系统调用内核调度器执行线程上下文切换时，内核会在切换前的最后一步执行一段极轻量级的 C 语言检查逻辑：
    ```c
    /* 内核上下文切换时的哨兵校验伪代码 */
    if (*(volatile uint32_t *)current_thread->stack_info.start != 0xDEADBEEF) {
        /* 金丝雀被踩死，判定栈发生过越界踩踏 */
        k_panic(K_ERR_STACK_SENTINEL);
    }
    ```
3.  **致命缺陷（Why Software Check is Weak）**：
    软件哨兵**不具有实时性**。如果线程声明了一个 256 字节的局部数组 `char data[256]`，当对其写入越界时，指针可能会直接“跳过”这 4 字节的哨兵位置，写到更低的内存区（比如踩坏了邻近线程的变量）。此时哨兵位仍然是 `0xDEADBEEF`，软件巡检完全无法察觉。直到以后发生严重的运行时逻辑异常时才暴露，调试成本极高。

---

## 2.4 异常现场定位与寄存器分析 (HardFault Debugging)

当硬件 MPU 检测到栈溢出抛出 Fault，或者软件哨兵触发内核 Panic 后，系统通常会通过调试串口输出一系列硬件寄存器快照。在没有仿真器的情况下，掌握对这些寄存器状态的逆向解码技能，是解决栈溢出的必备修养。

### 2.4.1 CFSR 寄存器结构与多维解码 (Configurable Fault Status Register)

在 Cortex-M 内核中，位于 `0xE000ED28` 的 **CFSR** 是诊断的核心，它由三个子寄存器拼接而成：

```text
  CFSR (32-Bit Register at 0xE000ED28)
  ┌───────────────────────────────┬───────────────────────────────┬───────────────────────────────┐
  │      UFSR (Usage Fault)       │      BFSR (Bus Fault)         │     MMFSR (MemManage Fault)   │
  │        Bits [31:16]           │        Bits [15:8]            │          Bits [7:0]           │
  └───────────────────────────────┴───────────────────────────────┴───────────────────────────────┘
```

#### MMFSR (MemManage Fault Status Register) 位域明细：

*   **Bit 0 (IACCVIOL)**：指令访问违规。通常因代码试图在禁止执行（No Execute）的 RAM 警戒区执行代码导致。
*   **Bit 1 (DACCVIOL)**：**数据访问违规**。当 CPU 执行数据加载/存储操作，且目标地址落入被 MPU 限制的禁区（如 Guard Page）时，此位置 1。
*   **Bit 3 (MUNSTKERR)**：从栈中恢复寄存器（Unstacking）时引发的 MemManage Fault。
*   **Bit 4 (MSTKERR)**：**入栈（Stacking）时引发的 MemManage Fault**。当发生异常或中断，硬件电路自动将当前 CPU 寄存器压入物理栈底时击中了 MPU Guard，该位置 1。
*   **Bit 7 (MMARVALID)**：**MMFAR 地址有效指示位**。若该位为 1，代表位于 `0xE000ED34` 的 `MMFAR` 寄存器已经锁定了非法的物理内存访问地址。

---

### 2.4.2 案例实战：硬故障 Panic 日志解析与逆向定位

以下是一个典型的 Zephyr 系统硬故障串口 Dump 现场：

```text
*** ARCH OOPS CHARGER/SYSTEM FAULT ***
Faulting instruction address (PC): 0x080034a2
Fatal fault in thread 0x20004a20 (sensor_collector)
Current thread ID: 0x20004a20, name: sensor_collector
Halting system

cfsr:  0x00000092 (MSTKERR, DACCVIOL, MMARVALID)
mmfar: 0x200021c0
psp:   0x200021c8
msp:   0x20007bc0
```

#### 诊断推导步骤：

1.  **解码 CFSR 状态**：
    `CFSR = 0x00000092`。其低 8 位 MMFSR = `0x92`。
    *   `Bit 7 (MMARVALID) = 1`：判定 `mmfar` 寄存器内的物理地址有效。
    *   `Bit 4 (MSTKERR) = 1`：入栈过程中触发了 MPU 访问违规。
    *   `Bit 1 (DACCVIOL) = 1`：数据读写违规。
2.  **读取物理越界地址**：
    `mmfar = 0x200021c0`。这代表引发总线拒绝写入的精确 SRAM 地址。
3.  **比对崩溃线程栈定义**：
    我们在代码中通过 `K_THREAD_STACK_DEFINE` 静态声明了该线程的栈大小：
    ```c
    K_THREAD_STACK_DEFINE(sensor_stack, 1024);
    ```
    查阅链接器生成的 `build/zephyr/zephyr.map` 文件，搜索 `sensor_stack`：
    ```text
    .noinit.struct_sensor_stack
                   0x200021c0        0x420 build/zephyr/app/libapp.a(sensor.o)
    ```
    这表明该线程栈的起始物理低地址为 `0x200021c0`，栈总大小为 1024 字节加上对齐占用的 Guard 区域。由于 MPU 警戒区正配置在 `0x200021c0 - 0x200021DF`（32字节范围），`mmfar = 0x200021c0` 完美落在了警戒区的首字节，印证了栈溢出。
4.  **精确定位代码物理行**：
    已知引发 Fault 的 CPU 指令指针（PC）值为 `0x080034a2`。在开发主机上启动交叉编译工具链中的 `addr2line` 工具：
    ```bash
    $ arm-none-eabi-addr2line -e build/zephyr/zephyr.elf -f -e 0x080034a2
    sensor_process_data
    c:/my_project/src/sensor.c:118
    ```
    打开 `sensor.c` 第 118 行：
    ```c
    void sensor_process_data(void) {
        uint8_t temp_buffer[512]; /* ⚠️ 致命错误：在总容量仅 1024 字节的线程栈中申请了 512 字节局部数组 */
        ...
        memset(temp_buffer, 0, sizeof(temp_buffer));
    }
    ```
    至此，故障原因清晰定位：因函数内申请了过大的局部变量数组，瞬间冲破了剩余栈空间并踏入了 MPU 保护警戒页。

---

## 2.5 编写自定义致命错误处理 Hook

为了使物联网设备具备现场诊断和异常恢复（异常下线前通知云端）的能力，我们可以在 Zephyr 中自定义系统致命错误处理程序，利用 `k_sys_fatal_error_handler` 回调捕获栈溢出等致命事件：

```c
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(fatal_handler, LOG_LEVEL_INF);

/* 
 * 覆盖内核默认的致命错误处理函数
 */
void k_sys_fatal_error_handler(unsigned int reason, const struct arch_esf *esf)
{
    LOG_ERR("=================================================");
    LOG_ERR("!!! CRITICAL SYSTEM FATAL FAULT DETECTED !!!");
    
    switch (reason) {
    case K_ERR_KERNEL_OOPS:
        LOG_ERR("Reason: Kernel Oops (Internal Kernel Fault)");
        break;
    case K_ERR_KERNEL_PANIC:
        LOG_ERR("Reason: Kernel Panic");
        break;
    case K_ERR_STACK_SENTINEL:
        LOG_ERR("Reason: [STACK OVERFLOW] Software Sentinel Canary corrupted!");
        break;
    case K_ERR_HW_EXCEPTION:
        LOG_ERR("Reason: Hardware Exception (HardFault/MemManageFault)");
        /* 
         * 如果能确定是 MPU 保护事件导致的硬件异常，
         * 此处可根据 arch_esf 提取出崩溃时的 PC, SP 等寄存器值
         */
        if (esf != NULL) {
#if defined(CONFIG_ARM64) || defined(CONFIG_ARM)
            /* 打印 ARM 架构的核心寄存器状态 */
            LOG_ERR("Register State Dump at Crash Time:");
            LOG_ERR("  PC  : 0x%08lx", (unsigned long)esf->basic.pc);
            LOG_ERR("  LR  : 0x%08lx", (unsigned long)esf->basic.lr);
            LOG_ERR("  xPSR: 0x%08lx", (unsigned long)esf->basic.xpsr);
#endif
        }
        break;
    default:
        LOG_ERR("Reason: Unknown Fatal Reason Code (%u)", reason);
        break;
    }

    LOG_ERR("Current Thread: %s (%p)", 
            k_thread_name_get(k_current_get()) ? k_thread_name_get(k_current_get()) : "unnamed", 
            k_current_get());
    LOG_ERR("=================================================");

    /*
     * 生产级的防护操作：
     * 1. 尝试保存故障 Trace 信息到非易失闪存中。
     * 2. 执行网络下线通知，向网关或云服务器报告设备即将重启。
     * 3. 在完成故障归档后，调用内核复位命令，执行系统安全硬重启。
     */
    
    /* 强行挂起系统或进行复位 */
#if defined(CONFIG_REBOOT)
    LOG_INF("Initiating hardware system reset in 3 seconds...");
    k_busy_wait(3000000); /* 忙等待 3 秒保证日志能够通过 DMA/UART 发送完毕 */
    sys_reboot(SYS_REBOOT_COLD);
#else
    LOG_ERR("System halted. Please reset manually.");
    while (1) {
        /* 陷入死循环 */
    }
#endif
}
```
