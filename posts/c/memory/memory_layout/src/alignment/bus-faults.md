# 第三章：非对齐内存访问限制与总线异常分析

在嵌入式开发中，非对齐内存访问（Unaligned Access）不仅会导致严重的性能损失，更可能直接引发**系统硬件异常（Hardware Fault）**而导致微控制器（MCU）死锁、异常复位或死机。特别是在解析复杂的网络协议帧、接收 UART 字节流并进行强制结构体指针转换（Casting）时，这一安全隐患非常高。

本章将详细剖析 ARM Cortex-M 处理器内核在底层对非对齐访问的硬件逻辑差异、CCR 系统控制寄存器的配置，并提供一套生产级的 Fault 异常捕获汇编及 C 解码诊断方案。

---

## ARM 内核对非对齐访问的支持差异

不同的 ARM Cortex-M 内核，其内部总线接口和指令译码单元对非对齐内存地址访问的支持程度存在根本性差异：

### 1. Cortex-M0 / Cortex-M0+ / Cortex-M1
* **硬件设计：**
  为了追求极致的低功耗与小面积芯片体积，这些小内核在硬件层面**完全不支持**任何非对齐访问。
* **异常行为：**
  只要 CPU 试图执行非对齐物理地址的数据读写（例如使用 `LDR` 或 `STR` 指令读取奇数物理地址上的 32 位整型数据），处理器会**立刻丢弃当前总线传输并触发 HardFault 异常**。

### 2. Cortex-M3 / Cortex-M4 / Cortex-M7 / Cortex-M33
* **硬件设计：**
  硬件上包含了一个专门的地址校对和对齐单元，默认支持多数常规指令（如 `LDR`, `LDRH`, `STR`, `STRH` 等）的非对齐访问。
* **强制对齐的特殊指令：**
  即便在这些支持非对齐的内核上，以下指令**依然强制要求地址必须满足自然对齐**，否则将引发 `UsageFault`：
  - **多数据加载/存储指令：** `LDM` (Load Multiple), `STM` (Store Multiple), `LDRD` (Load Doubleword), `STRD` (Store Doubleword)。这类指令多见于函数入口的寄存器压栈/出栈以及 `memcpy` 的高效汇编展开。
  - **同步独占访问指令：** `LDREX` (Load Exclusive), `STREX` (Store Exclusive)。这些指令常用于 RTOS 的原子锁或信号量实现。
* **陷阱使能（CCR.UNALIGN_TRP）：**
  可以通过设置系统控制块（SCB）中的配置控制寄存器（CCR）强制开启非对齐捕获。开启后，任何非对齐访问都将触发异常，用于在软件开发阶段排查隐患。

---

## CCR 寄存器控制：强制开启非对齐访问捕获

在支持非对齐访问的 Cortex-M3/M4/M7 内核上，系统控制块（SCB）提供了一个配置控制寄存器——**Configuration and Control Register (CCR)**，其物理映射地址为 `0xE000ED14`。

该寄存器的 **第 3 位 (UNALIGN_TRP)** 决定了是否捕获所有的非对齐访问行为：

```
           SCB CCR 寄存器 (地址: 0xE000ED14, 宽度: 32-bit)
+-------------------------------------------------------------------------+
| 31 ... 10 |    9     | 8 ... 5 |     4     |      3      | 2 ... 1 |  0  |
| Reserved  | STKALIGN | Res...  | DIV_0_TRP | UNALIGN_TRP |  Res... | ... |
+-------------------------------------------------------------------------+
```

* **`STKALIGN` (Bit 9)：** 强迫进入异常时栈指针对齐到 8 字节边界（为符合 ABI 规范，Cortex-M 默认使能该位）。
* **`DIV_0_TRP` (Bit 4)：** 除以 0 捕获使能位。若置 1，代码中执行整除 0 运算时将抛出 `UsageFault` 异常。
* **`UNALIGN_TRP` (Bit 3)：** 非对齐访问陷阱使能位。若置 1，任何非对齐访问（即便是支持非对齐的内核）都会直接触发 `UsageFault` 异常。

### 开启非对齐陷阱的 C 语言实现

在底层的系统初始化阶段（如 `SystemInit()`），或者在主函数 `main()` 的最前端，我们可以通过直接修改寄存器来使能非对齐捕获：

```c
#include <stdint.h>

/* SCB 寄存器定义 */
#define SCB_CCR_REG             (*((volatile uint32_t*)0xE000ED14))
#define SCB_CCR_UNALIGN_TRP_MSK (1UL << 3)  /* 非对齐陷阱控制位 */
#define SCB_CCR_DIV_0_TRP_MSK   (1UL << 4)  /* 除0陷阱控制位 */

/**
 * @brief 开启 MCU 的非对齐访问与除以0的硬件中断捕获
 */
void System_Exception_Trap_Enable(void) {
    // 读改写控制 CCR 寄存器
    uint32_t ccr_val = SCB_CCR_REG;
    ccr_val |= (SCB_CCR_UNALIGN_TRP_MSK | SCB_CCR_DIV_0_TRP_MSK);
    SCB_CCR_REG = ccr_val;
}
```

在开启该功能后，开发阶段中任何由于指针强转或协议解析导致的非对齐内存读写，都会被立刻捕捉并中断，防止隐藏的 Bug 流入生产环境。

---

## 异常进入时的硬件栈帧结构与机制

当 Cortex-M 处理器触发硬件异常（如 `HardFault`、`UsageFault`、`MemManage`）时，硬件在跳转到异常中断服务程序（ISR）前，会自动完成以下两个动作：

### 1. 硬件自动压栈（Auto-Stacking）
CPU 会自动将 8 个核心寄存器压入当前使用的堆栈中。如果是中断嵌套或运行于特权级下，通常压入主堆栈（MSP）；如果是普通的 RTOS 线程任务中引发异常，则压入进程堆栈（PSP）。

被压入的这组寄存器排布称为**栈帧（Stack Frame）**，物理结构如下所示：

```
                    SRAM 高地址 (堆栈增长反方向)
                      |                      |
                      +----------------------+
                      | xPSR (状态寄存器)    |  <-- 栈帧最高边界
                      +----------------------+
                      | PC (返回地址/异常PC)  |  <-- 【关键】指向触发 Fault 的那条汇编指令
                      +----------------------+
                      | LR (Link Register)   |  <-- 触发 Fault 之前的调用返回地址
                      +----------------------+
                      | R12 (IP)             |
                      +----------------------+
                      | R3                   |
                      +----------------------+
                      | R2                   |
                      +----------------------+
                      | R1                   |
                      +----------------------+
       SP 指针 -----> | R0                   |  <-- 栈帧最低边界 (硬件压栈后的新 SP 位置)
                      +----------------------+
                    SRAM 低地址 (堆栈增长方向)
```

### 2. 加载 EXC_RETURN 状态值到 LR
在进入 Fault 中断服务函数时，`LR`（链接寄存器）会被硬件自动赋予一个特殊的预留值，称为 **EXC_RETURN**（如 `0xFFFFFFF9`、`0xFFFFFFFD` 等）。
* `EXC_RETURN` 的 **Bit 2** 指示了刚才发生异常的现场使用的是哪个堆栈指针：
  - `0` 代表异常发生前正在使用**主堆栈（MSP）**。
  - `1` 代表异常发生前正在使用**进程堆栈（PSP）**。

---

## 生产级 Fault 异常处理与诊断定位

为了在系统崩溃时保留完整的寄存器现场并输出直观的故障报告，我们需要采用“汇编第一入口”+“C 语言解码器”的联合设计。

### 1. 汇编入口 Wrapper 编写 (GCC/ARM CC 兼容)

汇编代码的主要职责是：识别异常发生的堆栈（MSP 或 PSP），并提取其指针的值作为第一个参数传给 C 语言函数，同时提取 EXC_RETURN 作为第二个参数。

```assembly
.syntax unified
.cpu cortex-m4
.thumb

.global HardFault_Handler
.type HardFault_Handler, %function

HardFault_Handler:
    /* 1. 检测 EXC_RETURN (LR) 的 Bit 2 (4) */
    tst lr, #4
    ite eq
    mrseq r0, msp    /* 若 Bit 2 为 0，说明异常发生前使用的是 MSP，将其放入 R0 作为 C 接口的第 1 个参数 */
    mrsne r0, psp    /* 若 Bit 2 为 1，说明异常发生前使用的是 PSP，将其放入 R0 作为 C 接口的第 1 个参数 */
    
    /* 2. 将当前 LR 的 EXC_RETURN 值作为第 2 个参数传入 R1 */
    mov r1, lr
    
    /* 3. 跳转到 C 解码函数 */
    ldr r2, =HardFault_C_Decoder
    bx r2
```

### 2. C 语言故障现场解码器实现

```c
#include <stdint.h>
#include <stdio.h>

/* SCB 内核寄存器映射 */
#define SCB_CFSR_REG   (*((volatile uint32_t*)0xE000ED28)) /* 可配置故障状态寄存器 */
#define SCB_HFSR_REG   (*((volatile uint32_t*)0xE000ED2C)) /* 硬故障状态寄存器 */
#define SCB_MMFAR_REG  (*((volatile uint32_t*)0xE000ED34)) /* 内存管理故障物理地址寄存器 */
#define SCB_BFAR_REG   (*((volatile uint32_t*)0xE000ED38)) /* 总线故障物理地址寄存器 */

/* 栈帧结构体 */
typedef struct {
    uint32_t r0;
    uint32_t r1;
    uint32_t r2;
    uint32_t r3;
    uint32_t r12;
    uint32_t lr;
    uint32_t pc;
    uint32_t xpsr;
} StackFrame_t;

/**
 * @brief C 语言故障现场解码器
 * @param pStack 指向刚才发生硬件压栈后的栈顶指针 (MSP 或 PSP)
 * @param exc_return 进入 Fault 异常时硬件自动赋予 LR 的 EXC_RETURN 值
 */
void HardFault_C_Decoder(uint32_t *pStack, uint32_t exc_return) {
    // 将无类型指针转换为栈帧结构指针
    StackFrame_t *frame = (StackFrame_t *)pStack;
    
    // 读取内核故障状态寄存器的值
    uint32_t cfsr = SCB_CFSR_REG;
    uint32_t hfsr = SCB_HFSR_REG;
    
    // 解构 CFSR 寄存器 (由 MemManage, BusFault, UsageFault 三个子寄存器拼接而成)
    uint8_t  mmfsr = (uint8_t)(cfsr & 0xFF);          /* 内存管理故障状态 */
    uint8_t  bfsr  = (uint8_t)((cfsr >> 8) & 0xFF);   /* 总线故障状态 */
    uint16_t ufsr  = (uint16_t)((cfsr >> 16) & 0xFFFF);/* 使用故障状态 */

    // 开始输出致命异常现场诊断日志
    printf("\n====================!!! MCU HARD FAULT DIAGNOSTICS !!!====================\n");
    printf("Faulting Stack Type : %s\n", (exc_return & 0x04) ? "PSP (Process Stack Pointer)" : "MSP (Main Stack Pointer)");
    printf("Stack Pointer Value : 0x%08X\n", (uint32_t)pStack);
    printf("EXC_RETURN Value    : 0x%08X\n", exc_return);
    
    printf("\n[Register Snapshot from Stack Frame]\n");
    printf("  R0   = 0x%08X\n", frame->r0);
    printf("  R1   = 0x%08X\n", frame->r1);
    printf("  R2   = 0x%08X\n", frame->r2);
    printf("  R3   = 0x%08X\n", frame->r3);
    printf("  R12  = 0x%08X\n", frame->r12);
    printf("  LR   = 0x%08X (Link Register - Function Return Address)\n", frame->lr);
    printf("  PC   = 0x%08X (Program Counter - Offending Instruction Address)\n", frame->pc);
    printf("  xPSR = 0x%08X\n", frame->xpsr);

    printf("\n[SCB Exception Registers]\n");
    printf("  HFSR = 0x%08X\n", hfsr);
    printf("  CFSR = 0x%08X\n", cfsr);

    // 1. 解析 HFSR (硬故障状态)
    if (hfsr & (1UL << 30)) {
        printf("  -> Forced HardFault: 硬件故障升级 (如本已引发 UsageFault，但由于未使能该中断而被迫升级为 HardFault)\n");
    }
    
    // 2. 解析 CFSR 子项：UsageFault
    if (ufsr != 0) {
        printf("\n[Usage Fault Details]\n");
        if (ufsr & (1U << 8)) {
            printf("  -> 原因: UNALIGNED. 尝试了非对齐内存访问！\n");
        }
        if (ufsr & (1U << 0)) {
            printf("  -> 原因: UNDEFINSTR. 试图执行未定义或非法的指令操作码！\n");
        }
        if (ufsr & (1U << 1)) {
            printf("  -> 原因: INVSTATE. 试图切换到非 Thumb 状态执行代码（EPSR.T 必须为 1）！\n");
        }
        if (ufsr & (1U << 9)) {
            printf("  -> 原因: DIVBYZERO. 试图执行整除以 0 运算！\n");
        }
    }
    
    // 3. 解析 CFSR 子项：BusFault
    if (bfsr != 0) {
        printf("\n[Bus Fault Details]\n");
        if (bfsr & (1U << 7)) { // BFARVALID 有效标志
            printf("  -> 原因: 精确总线异常。导致总线崩溃的物理访问地址: 0x%08X\n", SCB_BFAR_REG);
        } else {
            printf("  -> 原因: 非精确总线异常 (物理访问目标地址不可查)\n");
        }
    }

    // 4. 解析 CFSR 子项：MemManage
    if (mmfsr != 0) {
        printf("\n[Memory Manage Fault Details]\n");
        if (mmfsr & (1U << 7)) { // MMFARVALID 有效标志
            printf("  -> 原因: 试图访问未被 MPU 授权的非法存储区域！违规物理地址: 0x%08X\n", SCB_MMFAR_REG);
        } else {
            printf("  -> 原因: 试图向禁止写（NX）的段执行代码或者栈溢出破坏了内核隔离\n");
        }
    }
    printf("=========================================================================\n");

    // 触发调试器断点（在仿真器调试状态下会停在此处）
    __asm("BKPT #0");
    
    // 挂起或执行软复位
    while (1);
}
```

---

## 调试实战：非对齐 Fault 现象重现与日志解析

接下来我们编写一段复现非对齐访问引发崩溃的代码，并演示如何逆向追溯源代码位置。

### 1. 故障复现代码设计

```c
#include <stdint.h>

void System_Exception_Trap_Enable(void);

// 定义一个 4 字节对齐的全局字节缓冲区
uint8_t test_buffer[16] __attribute__((aligned(4))) = {
    0x00, 
    0xAA, 0xBB, 0xCC, 0xDD, // 偏移量 [1] 到 [4] 存放非对齐的数据
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
};

void Trigger_Unaligned_Access_Fault(void) {
    // 1. 开启系统的非对齐和除以0捕获机制
    System_Exception_Trap_Enable();

    // 2. 指向奇数地址（非 4 字节自然对齐）
    uint8_t *pUnalignedAddr = &test_buffer[1]; // 地址：例如 0x20000005

    // 3. 强制类型转换为指向 32 位无符号整型的指针
    volatile uint32_t *pUnaligned32 = (volatile uint32_t *)pUnalignedAddr;

    // 4. 【致命操作】：对非对齐的 32 位指针执行解引用写操作
    // 由于 CCR.UNALIGN_TRP 位已被置 1，在 CPU 试图访问非4字节边界地址时，硬件会瞬间捕获此错误并生成 UsageFault 中断
    *pUnaligned32 = 0x99887766;
}
```

### 2. 诊断控制台日志输出

当执行上述代码时，CPU 会触发中断，控制台输出如下解码日志：

```text
====================!!! MCU HARD FAULT DIAGNOSTICS !!!====================
Faulting Stack Type : MSP (Main Stack Pointer)
Stack Pointer Value : 0x2001FFC0
EXC_RETURN Value    : 0xFFFFFFF9

[Register Snapshot from Stack Frame]
  R0   = 0x20000005
  R1   = 0x99887766
  R2   = 0x080012A4
  R3   = 0x20000005 (pUnaligned32 指向的非对齐物理地址)
  R12  = 0x00000000
  LR   = 0x08000A1F (上一级函数的返回地址)
  PC   = 0x080004BC (发生 Fault 时正在执行的机器指令地址！)
  xPSR = 0x61000000

[SCB Exception Registers]
  HFSR = 0x40000000
  CFSR = 0x01000000

[Usage Fault Details]
  -> 原因: UNALIGNED. 尝试了非对齐内存访问！
=========================================================================
```

### 3. 如何利用诊断数据精确定位源码？

在拿到上述控制台日志后，我们可以使用以下两种方法直接定位到发生故障的 C 语言行：

#### 方法 A：使用 GNU arm-none-eabi-addr2line 工具
如果在编译时开启了调试信息（使用 `-g` 参数），可以直接在电脑控制台运行 `addr2line` 工具，将栈帧中保存的 PC 地址（`0x080004BC`）作为输入：

```bash
arm-none-eabi-addr2line -e build/my_firmware.elf -a 0x080004BC -f
```

控制台会立刻返回出错的代码文件、函数名以及具体的行号：

```text
Trigger_Unaligned_Access_Fault
C:/projects/main.c:26
```
打开 `main.c` 发现第 26 行正是 `*pUnaligned32 = 0x99887766;`，这就锁定了故障源头。

#### 方法 B：反汇编（Listing）查阅
如果没有 `addr2line` 工具，可以使用 `objdump` 工具导出程序的反汇编文件：

```bash
arm-none-eabi-objdump -S build/my_firmware.elf > firmware.asm
```

打开 `firmware.asm` 并搜索物理地址 `80004bc`，可以看到对应的 C 代码与汇编对照：

```assembly
    // *pUnaligned32 = 0x99887766;
    080004b8:   ldr     r1, [pc, #20]   ; 装载 0x99887766 到 R1
    080004ba:   ldr     r3, [r7, #4]    ; 从局部变量栈装载 pUnaligned32 (0x20000005) 到 R3
    080004bc:   str     r1, [r3, #0]    ; 【崩溃指令】试图将 R1(0x99887766) 写入 R3(0x20000005) 指向的地址
```

汇编语言清晰地展示了，当执行 `STR` 存储指令时，寄存器 `R3` 中存储的写入目标地址为 `0x20000005`。因为其不是 4 的倍数且非对齐捕获处于开启状态，从而导致了本次总线访问崩溃。
