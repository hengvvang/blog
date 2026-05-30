# ESP32 GATT 服务器初始化与数据库建表

在 ESP32 上开发低功耗蓝牙 (BLE) 服务器，首要任务是合理规划内存、初始化底层的蓝牙控制器 (Controller) 与主机协议栈 (Bluedroid)，并构建 GATT 属性数据库。

本章将详细讲解蓝牙底层的内存回收与初始化流程，并深度剖析在生产环境下如何使用**属性表建表法 (`esp_gatts_create_attr_tab`)** 来替代繁琐且不稳定的链式 API 动态建表。

---

## 1. 蓝牙协议栈初始化与内存回收

在 ESP32 这种 RAM 资源受限的 SoC 中，运行蓝牙协议栈会消耗可观的内存。因此，精细化的内存管理是开发第一步。

### 1.1 释放未使用内存 (`esp_bt_controller_mem_release`)
如果你的设备仅需要低功耗蓝牙 (BLE)，而不需要经典蓝牙 (BR/EDR)，可以通过调用 `esp_bt_controller_mem_release()` 释放经典蓝牙所占用的硬件控制器内存，将其归还给系统堆 (Heap)：

```c
// 必须在初始化控制器之前调用，一旦调用，经典蓝牙功能在当前生命周期内将无法再被启用
esp_err_t err = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
if (err != ESP_OK) {
    ESP_LOGE("BLE_INIT", "Release classic BT memory failed: %s", esp_err_to_name(err));
}
```

### 1.2 控制器与 Bluedroid 初始化链

Controller 与 Host 的初始化和启用必须严格遵循特定的调用顺序：

```
+----------------------------------------+
| 1. Release Classic BT Memory           | (esp_bt_controller_mem_release)
+----------------------------------------+
                   |
+----------------------------------------+
| 2. Initialize BT Controller            | (esp_bt_controller_init)
+----------------------------------------+
                   |
+----------------------------------------+
| 3. Enable BT Controller (BLE Mode)     | (esp_bt_controller_enable)
+----------------------------------------+
                   |
+----------------------------------------+
| 4. Initialize Bluedroid Host Stack     | (esp_bluedroid_init)
+----------------------------------------+
                   |
+----------------------------------------+
| 5. Enable Bluedroid Host Stack         | (esp_bluedroid_enable)
+----------------------------------------+
```

下面是完整的初始化配置代码：

```c
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_log.h"

void app_ble_hardware_init(void)
{
    esp_err_t ret;

    // 1. 释放经典蓝牙内存，优化 RAM 空间
    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));

    // 2. 初始化蓝牙控制器
    // BT_CONTROLLER_INIT_CONFIG_DEFAULT() 是一个宏，定义了默认的时钟源、缓冲大小及射频参数
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ret = esp_bt_controller_init(&bt_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE("BLE_INIT", "Initialize controller failed: %s", esp_err_to_name(ret));
        return;
    }

    // 3. 启用蓝牙控制器，运行在 BLE 单模模式下
    ret = esp_bt_controller_enable(ESP_BT_MODE_BLE);
    if (ret != ESP_OK) {
        ESP_LOGE("BLE_INIT", "Enable controller failed: %s", esp_err_to_name(ret));
        return;
    }

    // 4. 初始化 Bluedroid 协议栈主机层
    ret = esp_bluedroid_init();
    if (ret != ESP_OK) {
        ESP_LOGE("BLE_INIT", "Initialize bluedroid failed: %s", esp_err_to_name(ret));
        return;
    }

    // 5. 启用 Bluedroid 协议栈主机层
    ret = esp_bluedroid_enable();
    if (ret != ESP_OK) {
        ESP_LOGE("BLE_INIT", "Enable bluedroid failed: %s", esp_err_to_name(ret));
        return;
    }

    ESP_LOGI("BLE_INIT", "Bluetooth stack initialized successfully.");
}
```

---

## 2. 传统链式建表 vs 生产级表格式建表

在早期或简单的 ESP32 BLE 示例代码中，通常能看到如下的代码结构（链式建表）：

```c
// 极其脆弱且繁琐的链式调用伪代码
esp_ble_gatts_create_service(gatts_if, &service_id, 4);
// 在回调事件 ESP_GATTS_CREATE_EVT 中：
esp_ble_gatts_add_char(service_handle, &char_uuid, perm, property, &char_val, &auto_rsp);
// 在回调事件 ESP_GATTS_ADD_CHAR_EVT 中：
esp_ble_gatts_add_char_descr(service_handle, &descr_uuid, perm, &descr_val, &auto_rsp);
```

### 2.1 传统链式建表的痛点
1.  **回调地狱 (Callback Hell)：** 每一个服务、特征、描述符的创建都是一个异步操作，协议栈完成当前创建后才会抛出对应的事件，开发者必须在回调函数里编写级联状态机才能按顺序将所有属性添加完毕。
2.  **句柄管理混乱：** 每一个属性的句柄 (`handle`) 都是由协议栈在运行时动态分配的，在编写逻辑代码时，极难干净地跟踪和绑定各个特征的句柄。
3.  **重构困难：** 如果要增加或调整一个特征，必须彻底修改回调事件中的嵌套逻辑，极其容易破坏原有的句柄时序，导致程序崩溃或通信异常。

### 2.2 表格式建表 (`esp_gatts_create_attr_tab`) 的核心优势
表格式建表允许开发者在代码中声明一个静态只读的属性表数组 (`esp_gatts_attr_db_t`)，通过一次调用 `esp_ble_gatts_create_attr_tab(gatt_db, gatts_if, HRS_IDX_NB, SVC_INST_ID)`，将完整的 GATT 数据库一次性注册到协议栈。
*   **声明式编程：** 代码即文档，GATT 结构一目了然。
*   **单事件回调：** 创建完毕后只触发一次回调事件 `ESP_GATTS_CREAT_ATTR_TAB_EVT`，并返回一个句柄数组，完全杜绝了回调嵌套。
*   **完美的句柄映射：** 通过在代码中定义与属性表一一对应的 `enum` 索引，可以用极低的成本精准找到每个特征值对应的 Handle。

---

## 3. 深入解析属性表数据结构 `esp_gatts_attr_db_t`

属性表是由 `esp_gatts_attr_db_t` 结构体组成的数组，其核心定义位于 `esp_gatts_api.h`。我们来剖析它的成员：

```c
typedef struct {
    esp_attr_control_t      attr_control; /* 属性响应控制 */
    esp_attr_desc_t         att_desc;     /* 属性描述符核心元数据 */
} esp_gatts_attr_db_t;
```

### 3.1 属性响应控制 `esp_attr_control_t`
决定当收到主机（客户端）发起的读写请求时，是由蓝牙协议栈底层自动回复，还是向应用层抛出回调事件让用户自己处理：
*   **`ESP_GATT_AUTO_RSP` (自动响应)：** 只要客户端发起读/写请求，协议栈直接根据属性在内存中的 buffer 自动处理，不会打扰主 CPU，性能极高。
*   **`ESP_GATT_RSP_BY_APP` (应用层响应)：** 客户端发起读写时，协议栈会抛出 `ESP_GATTS_READ_EVT` 或 `ESP_GATTS_WRITE_EVT` 事件，应用程序必须手动调用 `esp_ble_gatts_send_response()` 完成响应。这适用于读取传感器实时数据、执行硬件操作（如控制 GPIO 或写 flash）等场景。

### 3.2 属性描述元数据 `esp_attr_desc_t`
描述了具体的 UUID、读写权限以及数据缓冲区大小等：

```c
typedef struct {
    uint16_t                uuid_length;  /* UUID 的字节长度：ESP_UUID_LEN_16 或 ESP_UUID_LEN_128 */
    uint8_t                 *uuid_p;      /* 指向 UUID 字节数组的指针 */
    uint16_t                perm;         /* 读写权限属性，例如 ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE */
    uint16_t                max_length;   /* 该特征允许写入的最大有效载荷长度 */
    uint16_t                length;       /* 当前初始有效载荷的实际长度 */
    uint8_t                 *value;       /* 指向包含初始值的缓冲区的指针 */
} esp_attr_desc_t;
```

> [!TIP]
> **关于权限控制 (`perm`) 的最佳实践：**
> *   `ESP_GATT_PERM_READ` / `ESP_GATT_PERM_WRITE`: 普通明文读写。
> *   `ESP_GATT_PERM_READ_ENCRYPTED` / `ESP_GATT_PERM_WRITE_ENCRYPTED`: 要求链路必须是经过配对加密 (Authenticated / Encrypted) 的，否则主机会被拒绝，适用于敏感的配置信息保护。

---

## 4. 生产级 GATT 属性表构建实例

下面我们构建一个包含以下功能的自定义设备控制服务 (Device Control Service, UUID: `0xFFF0`)：
1.  **特征 A (Device Control Characteristic, UUID: `0xFFF1`)：** 允许主机写入指令（控制 GPIO 灯），应用层响应模式（`RSP_BY_APP`）。
2.  **特征 B (Sensor Read Characteristic, UUID: `0xFFF2`)：** 允许主机读取传感器值，同时支持 Notification 推送（包含对应的 `0x2902` CCCD 描述符）。

### 4.1 声明句柄枚举映射
为了将属性表数组中的物理下标与运行时分配的句柄对应起来，我们需要定义一个严格对齐的枚举结构：

```c
// 每一个枚举成员对应属性数据库中的一个条目，其物理顺序必须与后文定义 static 属性数组时完全一致
enum {
    IDX_SVC = 0,            // 服务声明 (Service Declaration)
    
    IDX_CHAR_DEVICE_CTRL,   // 特征 A 声明 (Characteristic A Declaration)
    IDX_CHAR_VAL_CTRL,      // 特征 A 实际的值 (Value)
    
    IDX_CHAR_SENSOR_DATA,   // 特征 B 声明 (Characteristic B Declaration)
    IDX_CHAR_VAL_SENSOR,    // 特征 B 实际的值 (Value)
    IDX_CHAR_CFG_SENSOR,    // 特征 B 的客户端特征配置描述符 (CCCD, 0x2902)
    
    IDX_NB_ATTRIBUTES       // 总属性个数，用于静态数组边界定义
};

// 全局数组，用于在运行时保存协议栈为我们实际分配的 16 位属性句柄
uint16_t gatt_db_handles[IDX_NB_ATTRIBUTES];
```

### 4.2 定义属性表

我们利用宏和静态结构体一次性将所有服务、特征及其权限规范定义完整：

```c
#include "esp_gatts_api.h"

// 蓝牙 SIG 标准定义的特殊 UUID
static const uint16_t primary_service_uuid         = ESP_GATT_UUID_PRI_SERVICE;   // 0x2800 (服务声明)
static const uint16_t char_declaration_uuid        = ESP_GATT_UUID_CHAR_DECLARE;  // 0x2803 (特征声明)
static const uint16_t character_client_config_uuid = ESP_GATT_UUID_CHAR_CLIENT_CONFIG; // 0x2902 (CCCD)

// 我们的自定义服务与特征的 16 位 UUID
static const uint16_t custom_service_uuid          = 0xFFF0;
static const uint16_t char_ctrl_uuid               = 0xFFF1;
static const uint16_t char_sensor_uuid             = 0xFFF2;

// 特征属性（只读、可写、通知等性质描述，用于特征声明条目中指示主机的访问方式）
static const uint8_t char_prop_write               = ESP_GATT_CHAR_PROP_BIT_WRITE;
static const uint8_t char_prop_read_notify         = ESP_GATT_CHAR_PROP_BIT_READ | ESP_GATT_CHAR_PROP_BIT_NOTIFY;

// 初始化值与默认配置缓冲
static const uint8_t sensor_initial_val[4]         = {0x00, 0x00, 0x00, 0x00};
static const uint8_t sensor_cccd_initial_val[2]    = {0x00, 0x00}; // 默认关闭通知与指示

// 核心：静态 GATT 属性数据库表
static const esp_gatts_attr_db_t custom_gatt_db[IDX_NB_ATTRIBUTES] = {
    
    // 1. 服务声明 (IDX_SVC)
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

    // 2. 特征 A 声明：设备控制特征 (IDX_CHAR_DEVICE_CTRL)
    [IDX_CHAR_DEVICE_CTRL] = {
        .attr_control = {ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_declaration_uuid,
            .perm        = ESP_GATT_PERM_READ,
            .max_length  = sizeof(uint8_t),
            .length      = sizeof(uint8_t),
            .value       = (uint8_t *)&char_prop_write
        }
    },

    // 3. 特征 A 值：用于接收控制指令的物理属性值 (IDX_CHAR_VAL_CTRL)
    [IDX_CHAR_VAL_CTRL] = {
        .attr_control = {ESP_GATT_RSP_BY_APP}, // 写入时必须抛出回调给 APP 来开关 GPIO 硬件
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_ctrl_uuid,
            .perm        = ESP_GATT_PERM_WRITE, // 客户端可写
            .max_length  = 32,                 // 控制指令最大 32 字节
            .length      = 0,
            .value       = NULL                // 无需初始值，实时读写
        }
    },

    // 4. 特征 B 声明：传感器读取与推送特征 (IDX_CHAR_SENSOR_DATA)
    [IDX_CHAR_SENSOR_DATA] = {
        .attr_control = {ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_declaration_uuid,
            .perm        = ESP_GATT_PERM_READ,
            .max_length  = sizeof(uint8_t),
            .length      = sizeof(uint8_t),
            .value       = (uint8_t *)&char_prop_read_notify
        }
    },

    // 5. 特征 B 值：包含传感器读取缓冲区 (IDX_CHAR_VAL_SENSOR)
    [IDX_CHAR_VAL_SENSOR] = {
        .attr_control = {ESP_GATT_AUTO_RSP}, // 使用自动响应，传感器更新后直接写入此内存，客户端可直接读取最新值
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&char_sensor_uuid,
            .perm        = ESP_GATT_PERM_READ, // 客户端可读
            .max_length  = sizeof(sensor_initial_val),
            .length      = sizeof(sensor_initial_val),
            .value       = (uint8_t *)sensor_initial_val
        }
    },

    // 6. 特征 B 的 CCCD 描述符：控制 Notification 推送开关 (IDX_CHAR_CFG_SENSOR)
    [IDX_CHAR_CFG_SENSOR] = {
        .attr_control = {ESP_GATT_AUTO_RSP}, // 自动响应：客户端对 CCCD 的读写直接由协议栈管理
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p      = (uint8_t *)&character_client_config_uuid,
            .perm        = ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE, // 读写配置必须同时打开
            .max_length  = sizeof(sensor_cccd_initial_val),
            .length      = sizeof(sensor_cccd_initial_val),
            .value       = (uint8_t *)sensor_cccd_initial_val
        }
    }
};
```

---

## 5. 在 GATT 注册事件中创建表

在下一章中，我们将深入讨论完整的事件状态机。这里我们先看如何与 `esp_ble_gatts_create_attr_tab` 衔接：

```c
#define PROFILE_APP_ID  0   // 定义当前 Profile 的应用 ID

void gatts_profile_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param) 
{
    switch (event) {
    case ESP_GATTS_REG_EVT:
        // 当 APP 注册完成时，第一步就是触发建表逻辑
        if (param->reg.status == ESP_GATT_OK) {
            ESP_LOGI("BLE_INIT", "App registered, creating attribute table...");
            esp_err_t err = esp_ble_gatts_create_attr_tab(custom_gatt_db, gatts_if, IDX_NB_ATTRIBUTES, PROFILE_APP_ID);
            if (err != ESP_OK) {
                ESP_LOGE("BLE_INIT", "Create attribute table failed: %s", esp_err_to_name(err));
            }
        } else {
            ESP_LOGE("BLE_INIT", "App register failed, status %d", param->reg.status);
        }
        break;

    case ESP_GATTS_CREAT_ATTR_TAB_EVT: {
        // 建表结果事件：在这里我们可以获得协议栈分配给所有属性条目的句柄
        if (param->add_attr_tab.status == ESP_GATT_OK) {
            if (param->add_attr_tab.num_handle == IDX_NB_ATTRIBUTES) {
                ESP_LOGI("BLE_INIT", "Attribute table created successfully.");
                // 将分配好的句柄拷贝到我们的全局句柄映射表中，供业务逻辑中发送 Notification 等使用
                memcpy(gatt_db_handles, param->add_attr_tab.handles, sizeof(gatt_db_handles));
                
                // 启用我们的主服务
                esp_ble_gatts_start_service(gatt_db_handles[IDX_SVC]);
            } else {
                ESP_LOGE("BLE_INIT", "Create attribute tab handle number mismatch: expected %d, got %d",
                         IDX_NB_ATTRIBUTES, param->add_attr_tab.num_handle);
            }
        } else {
            ESP_LOGE("BLE_INIT", "Create attribute table failed, status %d", param->add_attr_tab.status);
        }
        break;
    }
    
    default:
        break;
    }
}
```

通过这一套流程，所有属性一次性完成创建与分配，代码清晰、逻辑解耦。接下来我们将以这些核心句柄为出发点，深入探索如何处理连接、读写以及断开事件。
