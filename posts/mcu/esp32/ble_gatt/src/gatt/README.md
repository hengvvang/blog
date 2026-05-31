# GATT 服务器开发

在深入学习了 BLE 的协议层与物理机制后，本部分我们将目光投向具体的工程实践 —— 基于乐鑫 ESP-IDF 官方开发框架与 Bluedroid 协议栈构建生产级的 GATT 服务器。

---

## 1. GATT Profile 层次与服务规划

GATT (Generic Attribute Profile) 通用属性配置文件是应用层直接打交道的逻辑层次。在 ESP-IDF 开发中，一个蓝牙应用（Profile）通常包含一个或多个 **服务 (Service)**，每个服务包含多个 **特征 (Characteristic)**，每个特征又可以拥有若干个 **描述符 (Descriptor)**。

```
+-------------------------------------------------------------+
|                        GATT Profile                         |
+-------------------------------------------------------------+
                            |
         +------------------+------------------+
         v                                     v
+-----------------+                   +-----------------+
|   Service 1     |                   |   Service 2     |
| (如: 设备信息)   |                   | (如: 传感器数据)  |
+-----------------+                   +-----------------+
         |                                     |
    +----+----+                           +----+----+
    v         v                           v         v
[Char 1]   [Char 2]                    [Char 3]   [Char 4]
              |                                     |
              v                                     v
           [Descr]                               [CCCD]
```

在系统级设计中，我们应当根据业务的逻辑归属划分服务。例如：
- 设备基本信息（只读，标准服务）
- 系统控制端点（可写，自定义服务）
- 数据遥测通道（只读/通知，自定义服务）

---

## 2. 静态表格式服务构建（Static Table Construction）

传统的 ESP-IDF BLE 开发教程经常采用“动态链式建表”方式，即调用一个 API 创建 Service，在触发的回调事件中调用 API 创建 Characteristic，再在后续事件中添加 Descriptor。这种方法在商业级开发中极易引发“回调地狱 (Callback Hell)”，导致句柄乱序、多线程死锁等高风险问题。

为此，ESP-IDF 提供了高效、可靠的**表格式建表 API (`esp_ble_gatts_create_attr_tab`)**。我们只需要在内存中预先定义好一个描述整个 GATT 树状结构的只读结构体数组：

```c
static const esp_gatts_attr_db_t gatt_db[IDX_NB] = {
    // 定义 Service
    [IDX_SVC] = { ... },
    // 定义 Characteristic Declaration
    [IDX_CHAR] = { ... },
    // 定义 Characteristic Value
    [IDX_CHAR_VAL] = { ... },
    // 定义 CCCD
    [IDX_CHAR_CCCD] = { ... }
};
```

通过这种定义形式，我们可以实现**“代码即文档”**。协议栈只需要进行一次系统调用即可自动解析并生成整张属性表，这极大地简化了系统设计，使得句柄的定位和映射在编译期即可通过 `enum` 完全确定。

---

## 3. ESP-IDF Bluedroid 事件循环与回调机制

ESP-IDF 中的 Bluedroid 协议栈运行在独立的 FreeRTOS 任务上下文中。当有客户端发起连接、进行读取、更新 CCCD 或者空口接收到写入指令时，底层 Controller 会通过 VHCI 向上层 Host 抛出异步事件。

Host 接收到这些事件后，会在其自身的任务上下文（`BTU_TASK` / `BT_SYS_TASK`）中直接执行我们在应用层注册的回调函数。其逻辑流转如下：

```
[底层的硬件射频包] ---> [Controller 任务] 
                             |
                      (VHCI 软件中断)
                             v
                       [Host 任务 (BTU)]
                             |
                    (触发应用层回调函数)
                             v
           [gatts_profile_a_event_handler(...)]
```

由于回调函数是直接运行在蓝牙协议栈自身的任务上下文中的，这意味着：
- **绝对不能在回调函数中调用任何导致任务挂起或延迟的 API（如 `vTaskDelay`、阻塞的信号量等待、耗时的 Flash/I2C 操作）。**
- 如果回调函数被阻塞，底层的连接保活事件（Connection Event）将无法按时调度，直接导致手机端报 `status 8 (Connection Timeout)` 并强制断开连接。
- 生产级的做法是利用 **FreeRTOS Queue (队列)**。回调函数仅负责将事件和数据块提取并压入队列，随后立刻返回。而专门的业务工作任务 (Worker Task) 从队列中读取数据，并在低优先级的应用层上下文里安全地执行耗时逻辑。

在接下来的章节中，我们将详细展开初始化、静态表格式建表的定义细节，并编写一个完整的双向数据流应用来演示这个高稳定性的架构。
