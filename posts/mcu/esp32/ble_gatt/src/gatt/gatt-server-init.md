# 第二章：ESP32 蓝牙协议栈初始化与 GATT 服务构建

在 ESP32 平台上进行低功耗蓝牙 (BLE) 服务器开发，系统层面的首要任务是合理规划与配置有限的内存资源，依次初始化底层的蓝牙控制器 (Controller) 与主机协议栈 (Host)，并在物理内存中构建完整的 GATT 属性表数据库。

本章将从底层内存回收机制入手，深度剖析在生产环境中如何使用**静态表格式建表法 (`esp_gatts_create_attr_tab`)** 一次性构建安全、稳定的 GATT 属性数据库。

---

## 1. 蓝牙协议栈初始化与内存优化

ESP32 是一款高度集成的 SoC，其片上 SRAM 资源（通常为 520 KB）需要被用户业务、Wi-Fi 协议栈、蓝牙协议栈以及 FreeRTOS 堆栈共享。在启用蓝牙功能时，协议栈会申请可观的静态缓冲区和任务栈。因此，精细化控制蓝牙内存是保障系统不发生 OOM (Out Of Memory) 的关键。

### 1.1 释放未使用的经典蓝牙内存

如果你的设备仅需要低功耗蓝牙 (BLE)，而不需要经典蓝牙 (BR/EDR)（例如音频 A2DP、传统 SPP 等），必须在系统启动时立即调用 `esp_bt_controller_mem_release()`。该 API 将会彻底释放经典蓝牙控制器占用的 ROM 缓存区与物理 RAM（大约可回收 **50 KB ~ 70 KB** 的 SRAM），将其重新归还给系统的全局堆 (Heap) 供 FreeRTOS 使用：

```c
// 警告：此函数必须在初始化蓝牙控制器之前调用！
// 一旦调用并释放经典蓝牙内存，在当前系统运行周期内将无法再次启用经典蓝牙功能。
esp_err_t err = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
if (err != ESP_OK) {
    ESP_LOGE("BLE_INIT", "Release classic BT memory failed: %s", esp_err_to_name(err));
}
```

### 1.2 SDK 核心宏配置 (sdkconfig)

为了配合纯 BLE 开发并使能静态建表，你的 `sdkconfig` 必须启用以下核心配置项：
* `CONFIG_BT_ENABLED=y`：启用蓝牙物理外设支持。
* `CONFIG_BT_CONTROLLER_MODE_BLE_ONLY=y`：控制器模式强制设为纯 BLE，禁用经典蓝牙物理引擎。
* `CONFIG_BT_BLUEDROID_ENABLED=y`：启用 Bluedroid 协议栈作为主机层。
* `CONFIG_BT_GATTS_ENABLE=y`：使能 GATT 服务器功能。

### 1.3 完整的协议栈初始化时序

Controller 与 Host 的初始化和启用有着严苛的先后依赖关系。任何步骤的乱序调用都会直接导致内部状态机断言崩溃 (Assertion Fail)。

```
+------------------------------------------+
| 1. Release Classic BT RAM                | (esp_bt_controller_mem_release)
+------------------------------------------+
                     |
                     v
+------------------------------------------+
| 2. Initialize Bluetooth Controller       | (esp_bt_controller_init)
+------------------------------------------+
                     |
                     v
+------------------------------------------+
| 3. Enable Bluetooth Controller (BLE Mode)| (esp_bt_controller_enable)
+------------------------------------------+
                     |
                     v
+------------------------------------------+
| 4. Initialize Bluedroid Host Stack       | (esp_bluedroid_init)
+------------------------------------------+
                     |
                     v
+------------------------------------------+
| 5. Enable Bluedroid Host Stack           | (esp_bluedroid_enable)
+------------------------------------------+
```

下面是生产级的完整初始化实现代码：

```c
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_log.h"
#include "esp_err.h"

#define INIT_TAG "BT_INIT"

/**
 * @brief 系统蓝牙硬件与协议栈初始化入口
 */
void app_ble_stack_init(void)
{
    esp_err_t ret;

    // 1. 释放经典蓝牙所占用的硬件 Controller 内存，重新回收为通用 Heap RAM
    ret = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(INIT_TAG, "Release classic BT memory failed: %s", esp_err_to_name(ret));
        return;
    }

    // 2. 初始化蓝牙控制器底层的软件结构与硬件时钟驱动
    // BT_CONTROLLER_INIT_CONFIG_DEFAULT() 是系统预设宏，配置了默认的射频发射功率、时钟源及缓冲大小
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ret = esp_bt_controller_init(&bt_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(INIT_TAG, "Initialize controller failed: %s", esp_err_to_name(ret));
        return;
    }

    // 3. 启用控制器。必须传入 ESP_BT_MODE_BLE 运行模式，与释放经典蓝牙内存的操作相契合
    ret = esp_bt_controller_enable(ESP_BT_MODE_BLE);
    if (ret != ESP_OK) {
        ESP_LOGE(INIT_TAG, "Enable controller failed: %s", esp_err_to_name(ret));
        return;
    }

    // 4. 初始化 Bluedroid 协议栈主机层（包含 L2CAP, SMP, GATT, GAP 的核心内存申请与线程创建）
    ret = esp_bluedroid_init();
    if (ret != ESP_OK) {
        ESP_LOGE(INIT_TAG, "Initialize bluedroid failed: %s", esp_err_to_name(ret));
        return;
    }

    // 5. 启用 Bluedroid 协议栈主机层，激活相关的后台事件循环线程
    ret = esp_bluedroid_enable();
    if (ret != ESP_OK) {
        ESP_LOGE(INIT_TAG, "Enable bluedroid failed: %s", esp_err_to_name(ret));
        return;
    }

    ESP_LOGI(INIT_TAG, "Bluetooth controller and host stack initialized successfully.");
}
```

---

## 2. 传统链式建表 vs 生产级表格式建表

在绝大多数开源示例中，初学者常采用**链式 API 动态建表**。但在开发复杂的工业级或消费级 BLE 服务器时，这种方式存在极其严重的隐患。

### 2.1 传统动态链式建表

动态链式建表要求开发者通过一连串依赖回调状态机的异步接口，来逐步把服务、特征、描述符一个个“塞进”协议栈：

```c
// 脆弱的动态建表逻辑演示 (极其不推荐在商业级项目中使用)
esp_ble_gatts_create_service(gatts_if, &service_id, 4); // 异步调用

// 必须在回调函数中监听 ESP_GATTS_CREATE_EVT 事件：
void on_create_service_evt(...) {
    // 取得 Service Handle 后，才能继续添加 Characteristic
    esp_ble_gatts_add_char(service_handle, &char_uuid, perm, property, &value, &auto_rsp);
}

// 必须在回调函数中监听 ESP_GATTS_ADD_CHAR_EVT 事件：
void on_add_char_evt(...) {
    // 取得 Char Value Handle 后，才能添加 CCCD 描述符
    esp_ble_gatts_add_char_descr(service_handle, &descr_uuid, perm, &descr_val, &auto_rsp);
}
```

#### 链式建表的致命痛点：
1. **异步回调地狱 (Callback Hell)：** 每一个条目的添加都是一次独立的异步任务交互。如果你的 GATT 服务包含数十个特征，你的回调函数中必须编写一套复杂的、嵌套的顺序状态机。一旦某个中间节点失败，整个建表流程直接中断，系统恢复代价极高。
2. **句柄管理极其混乱：** 属性句柄 (Handle) 是由协议栈在运行时动态分配并逐个抛出的。开发者为了记录这些句柄，必须在全局定义大量的句柄变量。如果调整了特征定义顺序，往往会导致句柄变量错位，极易引发内存越界或发送错误的数据特征。

### 2.2 静态表格式建表

静态表格式建表（Static Attribute Table Construction）是通过调用 `esp_ble_gatts_create_attr_tab()` API，传入一个包含所有属性规范的只读数组 `esp_gatts_attr_db_t[]`。协议栈会根据数组的大小和内容，在底层一次性开辟完好的物理内存空间，并将整张属性表直接挂载。

```
                    +--------------------------------------------+
                    | 静态属性定义数组 (custom_gatt_db[])          |
                    +--------------------------------------------+
                                          |
                     通过单次系统调用      | esp_ble_gatts_create_attr_tab(...)
                                          v
+---------------------------------------------------------------------------------+
|                               GATT 属性物理数据库                                 |
|                                                                                 |
|  [Handle 0x0020] Service Declaration  <-- 主服务                                 |
|  [Handle 0x0021] Char A Declaration   <-- 特征A声明                              |
|  [Handle 0x0022] Char A Value         <-- 特征A的值                              |
|  [Handle 0x0023] Char B Declaration   <-- 特征B声明                              |
|  [Handle 0x0024] Char B Value         <-- 特征B的值                              |
|  [Handle 0x0025] CCCD (0x2902)        <-- 特征B的通知开关                         |
+---------------------------------------------------------------------------------+
                                          |
                      创建完毕后          | 触发单事件
                      一次性返回          | ESP_GATTS_CREAT_ATTR_TAB_EVT
                                          v
                    +--------------------------------------------+
                    | gatt_db_handles[] = {20, 21, 22, 23, 24, 25}|
                    +--------------------------------------------+
```

#### 表格式建表的核心优势：
* **声明式物理布局：** 开发者在代码中通过一个静态数组以“直观声明”的方式定义属性结构。代码即文档，GATT 树状层级极其清晰。
* **单事件安全交付：** 建表只需要发生一次异步交互。协议栈在建表完成后，只会触发一次 `ESP_GATTS_CREAT_ATTR_TAB_EVT` 事件，并将全套的句柄以数组形式打包递交给应用层。
* **完美的枚举对齐映射：** 在代码中利用 `enum` 声明索引。因为 `enum` 的物理自增顺序与 `gatt_db` 静态数组下标严格一致，所以在后续的读写回调中，可以使用 `enum` 索引作为完美的下标来操作 `gatt_db_handles`。

---

## 3. 深入解析属性表数据结构

表格式建表的核心是 `esp_gatts_attr_db_t` 结构体，它定义在 `esp_gatts_api.h` 头文件中：

```c
typedef struct {
    esp_attr_control_t      attr_control; /* 属性响应控制模式 */
    esp_attr_desc_t         att_desc;     /* 属性描述元数据 */
} esp_gatts_attr_db_t;
```

### 3.1 属性响应控制 `esp_attr_control_t`

该结构体控制了当客户端发起读写请求时，蓝牙协议栈底层的软件行为：

```c
typedef struct {
    uint8_t auto_rsp; /* 可配置为 ESP_GATT_AUTO_RSP 或 ESP_GATT_RSP_BY_APP */
} esp_attr_control_t;
```

* **`ESP_GATT_AUTO_RSP` (自动响应)：**
  当客户端发起 Read 或 Write 请求时，蓝牙协议栈会直接读取或写入其在内部为该属性分配的数据缓冲区。**这一过程完全发生在 Bluedroid 协议栈内部，不会打扰主应用程序核心**。这种响应模式时延最低，可靠性极高。
* **`ESP_GATT_RSP_BY_APP` (应用层响应)：**
  当客户端发起读写时，协议栈会立刻暂停数据交互，并向应用层抛出 `ESP_GATTS_READ_EVT` 或 `ESP_GATTS_WRITE_EVT` 回调事件。**主应用程序必须接管该事件，处理完毕后显式调用 `esp_ble_gatts_send_response()` 给予答复。** 如果在规定时间内没有响应，手机端会报错超时。适用于读取动态传感器物理数据、硬件控制（如控制 GPIO 或写 Flash）等需要业务逻辑干预的场景。

### 3.2 属性描述元数据 `esp_attr_desc_t`

这部分结构体精确定义了一个属性在 ATT 协议中的报头及访问规则：

```c
typedef struct {
    uint16_t                uuid_length;  /* UUID 的字节长度：ESP_UUID_LEN_16 或 ESP_UUID_LEN_128 */
    uint8_t                 *uuid_p;      /* 指向特定 UUID 字节数组的指针 */
    uint16_t                perm;         /* 访问安全控制权限位，例如可读、可写、配对加密等 */
    uint16_t                max_length;   /* 该特征值缓冲区分配的最大字节上限 */
    uint16_t                length;       /* 初始时特征值的物理有效字节长度 */
    uint8_t                 *value;       /* 指向包含初始数据的字节缓冲区的指针（常驻内存） */
} esp_attr_desc_t;
```

---

## 4. 生产级静态属性表构建实例

下面我们构建一个包含以下特征的自定义控制服务 (Custom Device Service, UUID: `0xFFF0`)：
1. **主服务声明：** `0xFFF0` 服务实体。
2. **特征 A (Device Control Characteristic, UUID: `0xFFF1`)：** 允许主机写入灯光或继电器控制指令。该属性的值配置为 `RSP_BY_APP` 模式，确保应用层能在写入发生的瞬间获得通知。
3. **特征 B (Sensor Telemetry Characteristic, UUID: `0xFFF2`)：** 允许主机读取传感器值，并支持 Notification 异步主动推送。附带一个 CCCD (`0x2902`) 描述符。配置为 `AUTO_RSP` 以保证读取性能。

### 4.1 句柄索引枚举对齐

在头文件中定义属性的物理索引。**这里的每个枚举项的声明顺序必须与后续定义 static 数据库数组时的顺序保持绝对一致！**

```c
#ifndef BLE_GATT_DB_H
#define BLE_GATT_DB_H

#include "esp_gatts_api.h"

// 属性表物理条目枚举索引
enum {
    IDX_SVC = 0,             // 服务声明条目

    IDX_CHAR_DEVICE_CTRL,    // 特征 A 声明
    IDX_CHAR_VAL_CTRL,       // 特征 A 的值物理条目 (LED 控制)

    IDX_CHAR_SENSOR_DATA,    // 特征 B 声明
    IDX_CHAR_VAL_SENSOR,     // 特征 B 的值物理条目 (传感器)
    IDX_CHAR_CFG_SENSOR,     // 特征 B 的 CCCD 描述符条目 (0x2902)

    IDX_NB_ATTRIBUTES        // 属性库中的条目总数
};

// 运行时用于保存协议栈分配的 16 位 Handle 数组
extern uint16_t g_gatt_db_handles[IDX_NB_ATTRIBUTES];

#endif // BLE_GATT_DB_H
```

### 4.2 静态 GATT 数据库表定义

在 C 源文件中，我们定义静态只读的属性表数组：

```c
#include "ble_gatt_db.h"
#include <string.h>

// 全局句柄分配表存放处
uint16_t g_gatt_db_handles[IDX_NB_ATTRIBUTES];

// 1. 定义蓝牙 SIG 官方的标准特殊 UUID
static const uint16_t primary_service_uuid         = ESP_GATT_UUID_PRI_SERVICE;   // 0x2800 (服务类型定义)
static const uint16_t char_declaration_uuid        = ESP_GATT_UUID_CHAR_DECLARE;  // 0x2803 (特征类型定义)
static const uint16_t character_client_config_uuid = ESP_GATT_UUID_CHAR_CLIENT_CONFIG; // 0x2902 (CCCD类型定义)

// 2. 自定义 16 位服务和特征 UUID
static const uint16_t custom_service_uuid          = 0xFFF0;
static const uint16_t char_ctrl_uuid               = 0xFFF1;
static const uint16_t char_sensor_uuid             = 0xFFF2;

// 3. 特征描述属性位（表示本特征公开声明了哪些能力，写入特征声明 Value 中，告诉手机怎么用它）
static const uint8_t char_prop_write               = ESP_GATT_CHAR_PROP_BIT_WRITE;
static const uint8_t char_prop_read_notify         = ESP_GATT_CHAR_PROP_BIT_READ | ESP_GATT_CHAR_PROP_BIT_NOTIFY;

// 4. 特征物理初始值与缓冲区
static const uint8_t sensor_initial_val[4]         = {0x00, 0x00, 0x00, 0x00}; // 传感器 4 字节数据
static const uint8_t sensor_cccd_initial_val[2]    = {0x00, 0x00};             // CCCD 初始关闭通知

// 5. 核心：静态 GATT 属性物理数据库描述数组 (常驻内存，只读)
const esp_gatts_attr_db_t custom_gatt_db[IDX_NB_ATTRIBUTES] = {
    
    // [IDX_SVC]: 注册服务宣告属性。访问权限设为只读。
    [IDX_SVC] = {
        .attr_control = {ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&primary_service_uuid,
            .perm        = ESP_GATT_PERM_READ,
            .max_length  = sizeof(custom_service_uuid),
            .length      = sizeof(custom_service_uuid),
            .value       = (uint8_t *)&custom_service_uuid
        }
    },

    // [IDX_CHAR_DEVICE_CTRL]: 宣告特征 A (设备控制端口) 的元数据声明条目
    [IDX_CHAR_DEVICE_CTRL] = {
        .attr_control = {ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_declaration_uuid,
            .perm        = ESP_GATT_PERM_READ,
            .max_length  = sizeof(uint8_t),
            .length      = sizeof(uint8_t),
            .value       = (uint8_t *)&char_prop_write // 告诉客户端：本特征支持 Write 写入
        }
    },

    // [IDX_CHAR_VAL_CTRL]: 特征 A 的具体值物理条目，用来接收控制命令
    [IDX_CHAR_VAL_CTRL] = {
        .attr_control = {ESP_GATT_RSP_BY_APP}, // 生产实践：设置由 APP 响应，实时捕获 GPIO 动作
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_ctrl_uuid,
            .perm        = ESP_GATT_PERM_WRITE, // 物理权限：客户端拥有写入权限
            .max_length  = 32,                 // 控制报文上限设定为 32 字节
            .length      = 0,
            .value       = NULL                // 初始化为空，直接依赖回调的数据区获取
        }
    },

    // [IDX_CHAR_SENSOR_DATA]: 宣告特征 B (传感器通道) 的元数据声明条目
    [IDX_CHAR_SENSOR_DATA] = {
        .attr_control = {ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_declaration_uuid,
            .perm        = ESP_GATT_PERM_READ,
            .max_length  = sizeof(uint8_t),
            .length      = sizeof(uint8_t),
            .value       = (uint8_t *)&char_prop_read_notify // 声明支持 Read 及 Notify 主动推送
        }
    },

    // [IDX_CHAR_VAL_SENSOR]: 特征 B 的具体物理值条目，存放传感器数值
    [IDX_CHAR_VAL_SENSOR] = {
        .attr_control = {ESP_GATT_AUTO_RSP}, // 采用自动响应，传感器任务周期刷新此内存，客户端读写极速
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_sensor_uuid,
            .perm        = ESP_GATT_PERM_READ, // 允许客户端直接读取
            .max_length  = sizeof(sensor_initial_val),
            .length      = sizeof(sensor_initial_val),
            .value       = (uint8_t *)sensor_initial_val // 绑定常驻内存的初始数组
        }
    },

    // [IDX_CHAR_CFG_SENSOR]: 特征 B 对应的 CCCD。控制主动通知的物理开关。
    [IDX_CHAR_CFG_SENSOR] = {
        .attr_control = {ESP_GATT_AUTO_RSP}, // 自动响应：客户端对通知开关的配置自动存入协议栈内存
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&character_client_config_uuid,
            .perm        = ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE, // 必须可读可写
            .max_length  = sizeof(sensor_cccd_initial_val),
            .length      = sizeof(sensor_cccd_initial_val),
            .value       = (uint8_t *)sensor_cccd_initial_val
        }
    }
};
```

---

## 5. APP 注册与静态建表调用流转

为了使上述静态表在协议栈中生效，需要在系统初始化后注册我们的 GATT APP。当应用成功注册到 Host 层时，协议栈会自动向上层抛出 `ESP_GATTS_REG_EVT` 事件。在此事件中，我们调用 `esp_ble_gatts_create_attr_tab()` 进行建表操作：

```c
#define PROFILE_APP_ID  0   // 定义当前 Profile 的 App ID

/**
 * @brief Profile 事件注册与分发回调函数
 */
void gatts_profile_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param) 
{
    switch (event) {
    case ESP_GATTS_REG_EVT:
        if (param->reg.status == ESP_GATT_OK) {
            ESP_LOGI("BLE_INIT", "App registered, initiating database table creation...");
            
            // 核心调用：将静态 custom_gatt_db 数组直接提交给协议栈建表
            // 该函数是非阻塞的，建表结果会通过异步事件 ESP_GATTS_CREAT_ATTR_TAB_EVT 送回
            esp_err_t err = esp_ble_gatts_create_attr_tab(custom_gatt_db, gatts_if, IDX_NB_ATTRIBUTES, PROFILE_APP_ID);
            if (err != ESP_OK) {
                ESP_LOGE("BLE_INIT", "Create attribute table system call failed: %s", esp_err_to_name(err));
            }
        } else {
            ESP_LOGE("BLE_INIT", "App register failed, status %d", param->reg.status);
        }
        break;

    case ESP_GATTS_CREAT_ATTR_TAB_EVT: {
        if (param->add_attr_tab.status == ESP_GATT_OK) {
            // 确认协议栈为我们实际分配的句柄数量与我们声明的属性个数完全吻合
            if (param->add_attr_tab.num_handle == IDX_NB_ATTRIBUTES) {
                ESP_LOGI("BLE_INIT", "GATT database created successfully.");
                
                // 将协议栈分配的一连串物理句柄拷贝到我们的全局数组中，供业务层寻址
                memcpy(g_gatt_db_handles, param->add_attr_tab.handles, sizeof(g_gatt_db_handles));
                
                // 启动服务，激活该服务句柄所对应的所有特征，允许客户端扫描
                esp_ble_gatts_start_service(g_gatt_db_handles[IDX_SVC]);
            } else {
                ESP_LOGE("BLE_INIT", "Database handles count mismatch. Expected %d, got %d",
                         IDX_NB_ATTRIBUTES, param->add_attr_tab.num_handle);
            }
        } else {
            ESP_LOGE("BLE_INIT", "GATT table creation failed, error code %d", param->add_attr_tab.status);
        }
        break;
    }
    
    default:
        break;
    }
}
```

通过这一静态表定义与单事件回调句柄绑定机制，我们彻底规避了繁琐的“回调地狱”状态机，以极高的健壮性构建起整个 GATT 服务器的基本框架。在下一章中，我们将正式深入如何编写高并发、线程安全的读写事件处理代码，并实现数据的高吞吐量传输。
