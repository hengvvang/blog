# ARM Cortex-M 非对齐访问总线 Fault 与调试诊断

在嵌入式开发中，非对齐内存访问（Unaligned Access）不仅会导致严重的性能损失，更可能直接引发**系统硬件异常（Hardware Fault）**而导致 MCU 挂起或复位。尤其是在网络协议栈解析、串口数据流反序列化、或直接通过强制类型转换（Casting）操作指针对接字节流时，这种陷阱屡见不鲜。

本章将详细剖析 ARM Cortex-M 处理器在硬件层面对非对齐访问的底层处理逻辑、相关的系统控制寄存器配置，并提供一套生产级的 Fault 异常处理与诊断定位方案。

---

## 为什么非对齐访问会触发 Bus Fault？

不同的 ARM Cortex-M 处理器内核，对非对齐内存访问的处理策略有着本质区别：

### 1. Cortex-M0 / Cortex-M0+ / Cortex-M1 (严格对齐)
- **硬件限制：** 这些低功耗小内核在硬件设计上**完全不支持**任何非对齐访问。
- **故障行为：** 只要 CPU 试图执行非对齐地址的数据读写（例如通过 `LDR` 或 `STR` 指令读取奇数地址上的 32 位整型数据），处理器将**立即触发 HardFault 异常**。

### 2. Cortex-M3 / Cortex-M4 / Cortex-M7 (选择性支持)
- **硬件限制：** 硬件上包含了一个专门的地址校对和对齐单元，默认支持多数常规指令（如 `LDR`, `LDRH`, `STR`, `STRH` 等）的非对齐访问。
- **强制对齐的特殊指令：** 即便在这些支持非对齐的内核上，以下指令**依然强制要求地址对齐**，否则将引发 `UsageFault`：
  - **多数据加载/存储指令：** `LDM` (Load Multiple), `STM` (Store Multiple), `LDRD` (Load Doubleword), `STRD` (Store Doubleword)。这类指令多见于函数入口的寄存器压栈/出栈以及 `memcpy` 的高效汇编展开。
  - **同步独占访问指令：** `LDREX` (Load Exclusive), `STREX` (Store Exclusive)。这些指令常用于 RTOS 的原子锁或信号量实现。
- **陷阱使能（CCR.UNALIGN_TRP）：** 可以通过设置系统控制块（SCB）中的配置控制寄存器（CCR）强制开启非对齐捕获。开启后，任何非对齐访问都将触发异常，用于在软件开发阶段排查隐患。

---

## CCR 寄存器配置：开启非对齐访问陷阱

在 Cortex-M3/M4/M7 上，可以通过修改 **Configuration and Control Register (CCR)** 来开启对所有非对齐访问的实时捕获。该寄存器的地址为 `0xE000ED14`，其 **第 3 位 (UNALIGN_TRP)** 控制着该行为：

```
CCR (地址: 0xE000ED14)
+-----------------------------------------------------------+
| 31 ... 5 |     4     |      3      | 2 |     1     |  0   |
| Reserved | STKALIGN  | UNALIGN_TRP | . | DIV_0_TRP | ...  |
+-----------------------------------------------------------+
```
- `DIV_0_TRP` (Bit 4)：除以 0 捕获使能。
- `UNALIGN_TRP` (Bit 3)：非对齐访问捕获使能。若置 1，任何非对齐访问将产生 `UsageFault`。

### 开启捕获的代码示例

在系统初始化（如 `SystemInit()`）或 `main()` 的开头，加入如下代码：

```c
#include <stdint.h>

#define SCB_CCR_ADDR        ((volatile uint32_t*)0xE000ED14)
#define SCB_CCR_UNALIGN_TRP (1UL << 3)

void Enable_Unalignment_Trap(void) {
    // 读取-修改-写回，使能非对齐捕获
    *SCB_CCR_ADDR |= SCB_CCR_UNALIGN_TRP;
}
```

---

## 异常进入时的硬件行为与栈帧结构

当 Cortex-M 处理器触发 Fault 异常（如 `HardFault` 或 `UsageFault`）时，硬件会自动完成以下动作：
1. **决定使用哪个堆栈指针：** 如果当前代码运行在特权级且使用**主堆栈指针（MSP）**，则继续使用 MSP；如果是用户级线程且使用**进程堆栈指针（PSP）**，则使用 PSP。
2. **硬件压栈（Auto-Stacking）：** 处理器自动将 8 个核心寄存器压入当前使用的堆栈中。这个压入的结构体称为**栈帧（Stack Frame）**，其物理布局如下：

```
SRAM 高地址
          |  ...                   |
          +------------------------+
          |  xPSR                  |  <-- 自动压入的寄存器
          +------------------------+
          |  PC (返回地址 / 故障指令) |  <-- 指向发生 Fault 的 C/汇编指令地址
          +------------------------+
          |  LR (Link Register)    |
          +------------------------+
          |  R12                   |
          +------------------------+
          |  R3                    |
          +------------------------+
          |  R2                    |
          +------------------------+
          |  R1                    |
          +------------------------+
 SP ----> |  R0                    |  <-- 硬件压栈后的栈顶位置
          +------------------------+
SRAM 低地址
```

3. **进入异常服务例程：** 此时 `LR` 寄存器会被赋予一个特殊的特征值，称为 **EXC_RETURN**（通常为 `0xFFFFFFF9`、`0xFFFFFFFD` 等）。
   - `EXC_RETURN` 的 **Bit 2** 指示了异常发生前使用的是哪个堆栈：`0` 代表 `MSP`，`1` 代表 `PSP`。

---

## 生产级 Fault 异常处理与诊断定位实现

为了精确诊断故障发生时的 CPU 状态，我们需要分两步编写 Fault 处理器：
1. **汇编入口（Wrapper）：** 读取当前的堆栈指针（MSP 或 PSP），作为参数传递给 C 语言解析函数，并从 `LR` 中读出 `EXC_RETURN`。
2. **C 解析器（Decoder）：** 提取栈帧中保存的数据，并结合内核故障状态寄存器（SCB CFSR, HFSR, BFAR）输出诊断结果。

### 1. 汇编入口（GCC/ARM 编译器通用）

```assembly
.global HardFault_Handler
.type HardFault_Handler, %function

HardFault_Handler:
    /* 1. 检测异常发生时使用的是 MSP 还是 PSP */
    tst lr, #4
    ite eq
    mrseq r0, msp    /* 若 LR Bit 2 为 0，说明发生异常时使用的是 MSP，将其赋给 R0 作为 C 函数 of 第一个参数 */
    mrsne r0, psp    /* 若 LR Bit 2 为 1，说明发生异常时使用的是 PSP，将其赋给 R0 作为 C 函数 of 第一个参数 */
    
    /* 2. 将当前 LR (EXC_RETURN) 的值赋给 R1 作为 C 函数的第二个参数 */
    mov r1, lr
    
    /* 3. 跳转到 C 语言实现的故障诊断函数 */
    ldr r2, =HardFault_Decoder
    bx r2
```

### 2. C 语言故障解码器实现

```c
#include <stdint.h>
#include <stdio.h>

// 寄存器映射定义
#define SCB_CFSR  (*((volatile uint32_t*)0xE000ED28))  // 可配置状态寄存器
#define SCB_HFSR  (*((volatile uint32_t*)0xE000ED2C))  // 硬故障状态寄存器
#define SCB_MMFAR (*((volatile uint32_t*)0xE000ED34))  // 内存管理故障地址寄存器
#define SCB_BFAR  (*((volatile uint32_t*)0xE000ED38))  // 总线故障地址寄存器

// 自动压栈的 8 个寄存器结构体
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

// 故障解码核心函数（不要在其中再次进行可能引发故障的读写操作）
void HardFault_Decoder(uint32_t *stack_pointer, uint32_t exc_return) {
    StackFrame_t *frame = (StackFrame_t *)stack_pointer;
    
    // 1. 读取故障状态寄存器
    uint32_t cfsr = SCB_CFSR;
    uint32_t hfsr = SCB_HFSR;
    
    // 拆分 CFSR 为三个子状态寄存器
    uint8_t mmfsr = (uint8_t)(cfsr & 0xFF);          // MemManage Fault Status
    uint8_t bfsr  = (uint8_t)((cfsr >> 8) & 0xFF);   // Bus Fault Status
    uint16_t ufsr = (uint16_t)((cfsr >> 16) & 0xFFFF); // Usage Fault Status

    printf("\n============= HARD FAULT DIAGNOSTICS =============\n");
    printf("Stack Pointer Used: %s (0x%08X)\n", (exc_return & 0x4) ? "PSP" : "MSP", (uint32_t)stack_pointer);
    printf("EXC_RETURN Val:    0x%08X\n", exc_return);
    
    // 2. 打印压栈寄存器值
    printf("\n[Stacked Registers]\n");
    printf("R0   = 0x%08X\n", frame->r0);
    printf("R1   = 0x%08X\n", frame->r1);
    printf("R2   = 0x%08X\n", frame->r2);
    printf("R3   = 0x%08X\n", frame->r3);
    printf("R12  = 0x%08X\n", frame->r12);
    printf("LR   = 0x%08X (Caller Link Address)\n", frame->lr);
    printf("PC   = 0x%08X (Offending Instruction Address)\n", frame->pc);
    printf("xPSR = 0x%08X\n", frame->xpsr);

    // 3. 打印故障状态寄存器原因
    printf("\n[SCB Fault Status Registers]\n");
    printf("HFSR = 0x%08X\n", hfsr);
    printf("CFSR = 0x%08X\n", cfsr);
    
    // 4. 分析具体故障类型
    if (hfsr & (1UL << 30)) {
        printf(" -> Forced HardFault: 硬件故障升级（如 UsageFault 未被使能而升级为 HardFault）\n");
    }
    
    // 检查 Usage Fault (CFSR.UFSR)
    if (ufsr != 0) {
        printf("[Usage Fault Detected] ");
        if (ufsr & (1U << 8)) {
            printf("原因: UNALIGNED - 尝试了非对齐的内存访问！\n");
        }
        if (ufsr & (1U << 0)) {
            printf("原因: UNDEFINSTR - 尝试执行未知/未定义的指令！\n");
        }
        if (ufsr & (1U << 1)) {
            printf("原因: INVSTATE - 尝试切入无效的状态（例如在非Thumb模式下执行代码，EPSR.T == 0）\n");
        }
        if (ufsr & (1U << 9)) {
            printf("原因: DIVBYZERO - 尝试了除以 0 运算！\n");
        }
    }
    
    // 检查 Bus Fault (CFSR.BFSR)
    if (bfsr != 0) {
        printf("[Bus Fault Detected] ");
        if (bfsr & (1U << 7)) { // BFARVALID
            printf("原因: 精确总线故障，引发故障的物理访问目标内存地址: 0x%08X\n", SCB_BFAR);
        } else {
            printf("原因: 非精确总线故障 (地址未知)\n");
        }
    }

    // 检查 MemManage Fault (CFSR.MMFSR)
    if (mmfsr != 0) {
        printf("[Memory Manage Fault Detected] ");
        if (mmfsr & (1U << 7)) { // MMFARVALID
            printf("原因: 触碰了 MPU 保护的内存空间！违规地址: 0x%08X\n", SCB_MMFAR);
        } else {
            printf("原因: 试图执行不可执行的数据内存 (NX) 或栈溢出越界\n");
        }
    }
    printf("==================================================\n");

    // 工业级复位处理或进入断点调试
    __asm("BKPT #0"); // 触发调试器断点。若未挂接调试器，则会卡死或复位
    while (1);
}
```

---

## 实战演练：非对齐访问故障复现与日志分析

我们来看一个导致非对齐崩溃的具体 C 语言场景。

### 复现代码

```c
#include <stdint.h>
#include <string.h>

void Enable_Unalignment_Trap(void);

// 故意定义一个 1 字节对齐的全局字节数组
uint8_t buffer[16] __attribute__((aligned(4))) = {
    0x00, 
    0x11, 0x22, 0x33, 0x44, // 偏移 [1]..[4] 存放非对齐的 32 位数据
    0x55, 0x66, 0x77, 0x88, 
    0x99, 0xAA, 0xBB, 0xCC, 
    0xDD, 0xEE, 0xFF
};

void trigger_unaligned_fault(void) {
    // 1. 开启非对齐捕获
    Enable_Unalignment_Trap();

    // 2. 构造一个奇数地址指针
    uint8_t *odd_ptr = &buffer[1]; // 此时 odd_ptr 为 0x20000001 (奇数地址)

    // 3. 强制转换成 32 位整型指针并解引用写入
    volatile uint32_t *pInt = (volatile uint32_t *)odd_ptr;
    
    // 执行此行操作时，由于 CCR.UNALIGN_TRP = 1 且 pInt 为非 4 字节对齐，硬件会立刻抛出 UsageFault 异常
    *pInt = 0xAABBCCDD; 
}
```

### 调试串口诊断日志输出

当程序执行到 `*pInt = 0xAABBCCDD` 时，系统自动跳转到汇编包装器，最后进入 `HardFault_Decoder` 打印出如下信息：

```text
============= HARD FAULT DIAGNOSTICS =============
Stack Pointer Used: MSP (0x2001FFB8)
EXC_RETURN Val:    0xFFFFFFF9

[Stacked Registers]
R0   = 0x20000001 (odd_ptr 的值，指向奇数物理地址)
R1   = 0xAABBCCDD (准备写入的数据)
R2   = 0x08001F20
R3   = 0x20000001
R12  = 0x00000000
LR   = 0x080002F5 (调用 trigger_unaligned_fault 的上一级函数返回地址)
PC   = 0x080003AC (触发异常的指令：即 *pInt = 0xAABBCCDD 的汇编行)
xPSR = 0x61000000

[SCB Fault Status Registers]
HFSR = 0x40000000
CFSR = 0x01000000 (其中第 24 位为 1，即 UFSR.UNALIGNED = 1)

[Usage Fault Detected] 原因: UNALIGNED - 尝试了非对齐的内存访问！
==================================================
```

### 如何利用诊断数据精准还原源码位置？

1. **查阅 PC 值（`0x080003AC`）：**
   使用 GNU 工具链中的 `addr2line` 工具或查阅编译后生成的 `.map` 文件和反汇编文件（`.list` / `.asm`）：
   ```bash
   arm-none-eabi-addr2line -e your_firmware.elf -a 0x080003AC -f
   ```
   输出结果将直接显示：
   ```text
   0x080003ac
   trigger_unaligned_fault
   c:/path/to/main.c:26
   ```
   指向源码中对 `*pInt = ...` 执行解引用的具体行。
2. **查阅错误地址（R0 / R3）：**
   从日志中看到 `R0 = 0x20000001`，这表明引发错误的总线访问目标地址逆向末尾为 `1`，这明显偏离了 32 位整型数据（4 字节自然对齐）的 `0`、`4`、`8`、`C` 尾数要求。由此可立即确认，是因试图在奇数内存地址读写 32 位字而引发的非对齐访问故障。
