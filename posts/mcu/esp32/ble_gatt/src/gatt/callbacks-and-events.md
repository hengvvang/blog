# 第三章：GATT 读写回调事件处理与吞吐量优化

在 ESP-IDF 开发框架中，蓝牙协议栈底层的运行逻辑本质上是一个高度异步的、由空口事件驱动的状态机。应用程序与蓝牙主机协议栈 (Bluedroid) 的核心交互完全依赖于注册的回调函数。

本章将深入剖析 ESP-IDF Bluedroid 的事件分发机制与回调线程上下文，并展示如何通过 **FreeRTOS 队列机制**实现协议栈与业务逻辑的完全解耦，最终给出一份生产级、线程安全的双向数据流完整 C 语言应用架构。

---

## 1. 异步事件循环与回调线程上下文解耦

### 1.1 Bluedroid 回调的底层流转路径

当客户端向 ESP32 GATT 服务器发起写入或读取操作时，数据包通过天线被控制器层 (PHY/LL) 接收。控制器通过 **VHCI 接口**向上层主机协议栈发送软件中断。主机协议栈在专门的后台线程（在 Bluedroid 中常称为 `BTU_TASK` 或 `BT_SYS_TASK`）中解析数据，并直接调用用户在应用层注册的回调函数。

下图展示了这一核心事件分发及线程解耦的完整流程：

```
+-----------------------------------------------------------------------------------+
|                              蓝牙控制器与主机层 (BTU_TASK)                          |
+-----------------------------------------------------------------------------------+
  1. 空口收到写命令/请求 ---> [LL 链路层] ---> [L2CAP 逻辑通道]
                                                      |
                                                      v
  2. [BTU_TASK] 线程执行 ---> 触发用户注册的事件回调函数 gatts_event_handler(...)
                                                      |
                    +---------------------------------+---------------------------------+
                    |                                                                   |
                    | (错误路径：直接在回调中执行耗时业务)                                   | (正确路径：利用队列向外解耦)
                    v                                                                   v
     +-----------------------------------------+                       +----------------------------------+
     | 阻塞 BTU_TASK 线程 (如 vTaskDelay 等)    |                       | 1. 将数据深拷贝至结构体             |
     +-----------------------------------------+                       +----------------------------------+
                    |                                                                   |
                    v (导致底层ACK包无法按时调度)                                          v (毫秒级非阻塞压入队列)
     +-----------------------------------------+                       +----------------------------------+
     | 手机报 status 8 (Supervision Timeout)   |                       | 2. xQueueSend() 发送给外部队列     |
     | 连接强制断开，或系统触发 WDT 软件复位       |                       +----------------------------------+
     +-----------------------------------------+                                        |
                                                                                        v (回调迅速返回，释放 BTU_TASK)
                                                                       +----------------------------------+
                                                                       | 3. gatts_event_handler(...) 结束 |
                                                                       +----------------------------------+
                                                                                        |
                                                                                        v (触发 FreeRTOS 任务调度)
                                                       +----------------------------------------------------+
                                                       |         应用层业务任务 (App Worker Task)            |
                                                       +----------------------------------------------------+
                                                       | 4. xQueueReceive() 阻塞式获取控制数据包             |
                                                       | 5. 在用户上下文安全执行 GPIO 控制/I2C/Flash 写入等逻辑|
                                                       +----------------------------------------------------+
```

### 1.2 黄金法则：绝不能在蓝牙回调中执行阻塞操作

因为回调函数是**直接运行在蓝牙协议栈自身的物理线程 `BTU_TASK` 上下文中**的，如果在此上下文中调用任何导致当前任务挂起或长耗时运行的函数（如 `vTaskDelay`、阻塞等待信号量、复杂的 Flash 读写操作、慢速 I2C 传感器采集等），都将直接导致整个蓝牙协议栈停止调度。
* 结果是：底层的链路层 (LL) 无法在约定的连接事件 (Connection Event) 内向主机进行应答。
* 客户端设备会在数秒后判定为 **连接超时 (Supervision Timeout)** 并强制将连接链路切断。
* 同时，主 CPU 的中断监视器也会因为系统任务长期得不到释放而触发**中断看门狗复位 (WDT Reset)**。

**生产级解决方案：** 回调函数中仅执行最基本的指针提取与数据“深拷贝”，随后将拷贝出的数据包通过非阻塞的 FreeRTOS 队列直接推送到应用层任务 (Worker Task) 中去，然后立即 return 结束回调。

---

## 2. MTU 协商机制与大包分片策略

BLE 默认的 ATT MTU（最大传输单元）大小为 **23 字节**。除去 1 字节的操作码 (Opcode) 和 2 字节的属性句柄 (Attribute Handle) 后，**实际留给应用层单次传输的净有效载荷 (Payload) 仅为 20 字节**。

### 2.1 MTU 自动协商

为了实现大文件或高速率数据传输，主机连接成功后通常会主动向外设发起 MTU 协商请求（MTU Exchange Request）。
* ESP32 默认支持的最大 MTU 可达 **517 字节**（有效载荷最高 514 字节）。
* 协商完成后，协议栈会抛出 `ESP_GATTS_MTU_EVT` 事件。应用程序必须捕获此事件，记录协商后的 MTU 限制，以便动态调整上行或下行数据分包的边界。

### 2.2 净有效载荷计算公式

$$\text{Max Payload Size} = \text{Negotiated MTU} - 3$$

在向客户端发送 Notification 推送大包数据时，单次传入的长度决不能超过该限制，否则会导致协议栈内部发生截断或内存申请失败。

---

## 3. GAP 与 GATT 回调状态机

在整个系统运转中，GAP 和 GATT 分别管理设备的不同状态。

* **GAP 回调：** 负责处理广播参数设置完成、广播启动结果、连接参数更新事件等。
* **GATT 回调：** 负责处理 App 注册、属性建表完成、客户端物理连接/断开事件、读写事件等。

---

## 4. 生产级双向数据流完整 C 语言代码实现

下面是经过完全重构的、具备生产级容错机制和线程安全特性的完整 C 语言代码实现。该示例展示了一个可以对板载 LED（如 GPIO 2）进行非阻塞指令控制，并通过周期任务异步向手机推送模拟传感器数据的 BLE 应用：

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* FreeRTOS 内核与 IPC 队列 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

/* ESP 系统与外设驱动 */
#include "esp_log.h"
#include "nvs_flash.h"
#include "driver/gpio.h"

/* 蓝牙核心 API */
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"

/* 引入上一章定义的句柄索引头文件 */
#include "ble_gatt_db.h"

#define APP_TAG "BLE_PRODUCTION"

#define PROFILE_NUM            1
#define PROFILE_APP_ID         0
#define DEVICE_NAME            "ESP32_PROD_BLE"
#define SYSTEM_LED_GPIO        2    // 假设板载 LED 引脚为 GPIO 2

/* 全局连接控制状态区 */
static bool      g_is_connected = false;
static uint16_t  g_conn_id      = 0;
static esp_gatt_if_t g_gatts_if = ESP_GATT_IF_NONE;

/* 协商后的 MTU 大小，初始置为默认值 23 */
static uint16_t  g_negotiated_mtu = 23;

/* CCCD (Client Characteristic Configuration Descriptor) 的本地状态值 */
// 0x0001 代表开启 Notification；0x0002 代表开启 Indication；0x0000 代表关闭
static uint16_t  g_sensor_cccd_value = 0x0000;

/* FreeRTOS 队列句柄，用于解耦控制写指令 */
static QueueHandle_t g_cmd_queue = NULL;

/* 控制命令数据包结构体 */
typedef struct {
    uint32_t len;
    uint8_t  *data;
} ble_cmd_packet_t;

/* 广播控制状态位 */
static uint8_t g_adv_config_done = 0;
#define ADV_CONFIG_FLAG             (1 << 0)
#define SCAN_RSP_CONFIG_FLAG        (1 << 1)

/* 广播中的 128-bit 服务 UUID */
static uint8_t service_uuid[16] = {
    0xfb, 0x34, 0x9b, 0x5f, 0x80, 0x00, 0x00, 0x80,
    0x00, 0x10, 0x00, 0x00, 0xF0, 0xFF, 0x00, 0x00
};

/* 广播参数配置 */
static esp_ble_adv_params_t adv_params = {
    .adv_int_min         = 0x20, // 20ms 广播间隔 (0x20 * 0.625ms)
    .adv_int_max         = 0x40, // 40ms 广播间隔
    .adv_type            = ADV_TYPE_IND,
    .own_addr_type       = BLE_ADDR_TYPE_PUBLIC,
    .channel_map         = ADV_CHNL_ALL,
    .adv_filter_policy   = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
};

/* 广播数据内容定义 */
static esp_ble_adv_data_t adv_data = {
    .set_scan_rsp        = false,
    .include_name        = true,
    .include_txpower     = true,
    .min_interval        = 0x0006, // 建议客户端连接的最小间隔 (7.5ms)
    .max_interval        = 0x0010, // 建议客户端连接的最大间隔 (20ms)
    .appearance          = 0x00,
    .manufacturer_len    = 0,
    .p_manufacturer_data = NULL,
    .service_data_len    = 0,
    .p_service_data      = NULL,
    .service_uuid_len    = sizeof(service_uuid),
    .p_service_uuid      = service_uuid,
    .flag                = (ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SUPPORT),
};

/* 扫描响应数据内容定义 */
static esp_ble_adv_data_t scan_rsp_data = {
    .set_scan_rsp        = true,
    .include_name        = true,
    .service_uuid_len    = sizeof(service_uuid),
    .p_service_uuid      = service_uuid,
};

/* 引用外部静态属性表声明 */
extern const esp_gatts_attr_db_t custom_gatt_db[IDX_NB_ATTRIBUTES];

/**
 * @brief GAP 事件回调处理
 */
static void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param)
{
    switch (event) {
    case ESP_GAP_BLE_ADV_DATA_SET_COMPLETE_EVT:
        g_adv_config_done |= ADV_CONFIG_FLAG;
        if (g_adv_config_done == (ADV_CONFIG_FLAG | SCAN_RSP_CONFIG_FLAG)) {
            // 当广播包与扫描响应包配置完毕后，启动广播
            esp_ble_gap_start_advertising(&adv_params);
        }
        break;

    case ESP_GAP_BLE_SCAN_RSP_DATA_SET_COMPLETE_EVT:
        g_adv_config_done |= SCAN_RSP_CONFIG_FLAG;
        if (g_adv_config_done == (ADV_CONFIG_FLAG | SCAN_RSP_CONFIG_FLAG)) {
            esp_ble_gap_start_advertising(&adv_params);
        }
        break;

    case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
        if (param->adv_start_cmpl.status != ESP_BT_STATUS_SUCCESS) {
            ESP_LOGE(APP_TAG, "Advertising launch failed: status = %d", param->adv_start_cmpl.status);
        } else {
            ESP_LOGI(APP_TAG, "Advertising successfully active.");
        }
        break;

    case ESP_GAP_BLE_UPDATE_CONN_PARAMS_EVT:
        ESP_LOGI(APP_TAG, "Connection parameters updated: Interval = %.2f ms, Latency = %d, Timeout = %d ms, Status = %d",
                 param->update_conn_params.conn_int * 1.25,
                 param->update_conn_params.latency,
                 param->update_conn_params.timeout * 10,
                 param->update_conn_params.status);
        break;

    default:
        break;
    }
}

/**
 * @brief GATT 服务器事件回调处理
 */
static void gatts_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param)
{
    switch (event) {
    case ESP_GATTS_REG_EVT:
        ESP_LOGI(APP_TAG, "GATT app registered, registering device name...");
        esp_ble_gap_set_device_name(DEVICE_NAME);
        
        // 装载广播数据与扫描数据
        esp_ble_gap_config_adv_data(&adv_data);
        esp_ble_gap_config_adv_data(&scan_rsp_data);
        
        // 批量向物理内存构建属性表
        esp_ble_gatts_create_attr_tab(custom_gatt_db, gatts_if, IDX_NB_ATTRIBUTES, PROFILE_APP_ID);
        break;

    case ESP_GATTS_CREAT_ATTR_TAB_EVT:
        if (param->add_attr_tab.status == ESP_GATT_OK) {
            // 将建表生成的物理句柄拷贝入全局变量
            memcpy(g_gatt_db_handles, param->add_attr_tab.handles, sizeof(g_gatt_db_handles));
            ESP_LOGI(APP_TAG, "Database initialized. Activating main service...");
            
            // 必须手动使能 Service 句柄，否则客户端无法访问
            esp_ble_gatts_start_service(g_gatt_db_handles[IDX_SVC]);
        } else {
            ESP_LOGE(APP_TAG, "GATT static build table failed: status = %x", param->add_attr_tab.status);
        }
        break;

    case ESP_GATTS_CONNECT_EVT:
        g_is_connected = true;
        g_conn_id = param->connect.conn_id;
        g_gatts_if = gatts_if;
        ESP_LOGI(APP_TAG, "Client connected. Connection ID: %d, Remote MAC: %02x:%02x:%02x:%02x:%02x:%02x",
                 g_conn_id,
                 param->connect.remote_bda[0], param->connect.remote_bda[1],
                 param->connect.remote_bda[2], param->connect.remote_bda[3],
                 param->connect.remote_bda[4], param->connect.remote_bda[5]);
        
        // 建立连接后，申请更新更低时延的连接参数以提升交互效率
        esp_ble_gap_conn_params_t conn_params = {0};
        memcpy(conn_params.bda, param->connect.remote_bda, sizeof(esp_bd_addr_t));
        conn_params.latency = 0;
        conn_params.max_int = 0x20;    // 40ms
        conn_params.min_int = 0x10;    // 20ms
        conn_params.timeout = 400;     // 4s
        esp_ble_gap_update_conn_params(&conn_params);
        break;

    case ESP_GATTS_DISCONNECT_EVT:
        g_is_connected = false;
        g_sensor_cccd_value = 0x0000; // 重置本地 CCCD 状态
        g_negotiated_mtu = 23;        // 恢复默认 MTU 长度
        ESP_LOGI(APP_TAG, "Client disconnected, reason: %d. Restarting advertising...", param->disconnect.reason);
        esp_ble_gap_start_advertising(&adv_params);
        break;

    case ESP_GATTS_MTU_EVT:
        g_negotiated_mtu = param->mtu.mtu;
        ESP_LOGI(APP_TAG, "ATT MTU negotiated successfully. Size = %d bytes. Max Payload = %d bytes.",
                 g_negotiated_mtu, g_negotiated_mtu - 3);
        break;

    case ESP_GATTS_WRITE_EVT: {
        uint16_t handle = param->write.handle;
        
        // 1. 判断是否是客户端写入控制特征值 (RSP_BY_APP 模式)
        if (handle == g_gatt_db_handles[IDX_CHAR_VAL_CTRL]) {
            if (param->write.len > 0) {
                // 进行内存深拷贝，避免 BTU_TASK 线程退出后数据指针失效
                uint8_t *copied_buf = malloc(param->write.len);
                if (copied_buf != NULL) {
                    memcpy(copied_buf, param->write.value, param->write.len);
                    
                    ble_cmd_packet_t packet = {
                        .len  = param->write.len,
                        .data = copied_buf
                    };
                    
                    // 将结构体压入 FreeRTOS 队列中去。设置等待时间为 0，防止阻塞回调线程
                    if (xQueueSend(g_cmd_queue, &packet, (TickType_t)0) != pdPASS) {
                        ESP_LOGW(APP_TAG, "Command queue full! Drop incoming package.");
                        free(copied_buf);
                    }
                }
            }

            // 发送应用层响应包 (GATT Write Response)
            if (param->write.need_rsp) {
                esp_gatt_rsp_t rsp = {0};
                rsp.attr_value.len = 0;
                rsp.attr_value.handle = handle;
                rsp.attr_value.offset = param->write.offset;
                rsp.attr_value.auth_req = ESP_GATT_AUTH_REQ_NONE;
                
                // 响应客户端，状态为 ESP_GATT_OK
                esp_ble_gatts_send_response(gatts_if, param->write.conn_id, param->write.trans_id, ESP_GATT_OK, &rsp);
            }
        }
        // 2. 判断是否是客户端写入修改 CCCD 描述符 (由协议栈 AUTO_RSP 响应，但应用层需记录状态)
        else if (handle == g_gatt_db_handles[IDX_CHAR_CFG_SENSOR]) {
            if (param->write.len == 2) {
                g_sensor_cccd_value = (param->write.value[1] << 8) | param->write.value[0];
                ESP_LOGI(APP_TAG, "Client updated CCCD: 0x%04x", g_sensor_cccd_value);
            }
        }
        break;
    }

    default:
        break;
    }
}

/**
 * @brief GPIO 控制器硬件工作任务 (从蓝牙回调线程解耦)
 */
static void app_gpio_worker_task(void *pvParameters)
{
    ESP_LOGI(APP_TAG, "GPIO worker task launched.");
    
    // 初始化板载 LED 的 GPIO 配置
    gpio_reset_pin(SYSTEM_LED_GPIO);
    gpio_set_direction(SYSTEM_LED_GPIO, GPIO_MODE_OUTPUT);

    ble_cmd_packet_t packet;
    while (1) {
        // 阻塞式等待来自蓝牙写入事件的指令包
        if (xQueueReceive(g_cmd_queue, &packet, portMAX_DELAY) == pdPASS) {
            if (packet.len > 0 && packet.data != NULL) {
                uint8_t command = packet.data[0];
                ESP_LOGI(APP_TAG, "Processing command payload, length = %d. First Byte = 0x%02x", (int)packet.len, command);
                
                // 协议定义：0x01 表示开灯；0x00 表示关灯
                if (command == 0x01) {
                    gpio_set_level(SYSTEM_LED_GPIO, 1);
                    ESP_LOGI(APP_TAG, "LED set to HIGH (ON)");
                } else if (command == 0x00) {
                    gpio_set_level(SYSTEM_LED_GPIO, 0);
                    ESP_LOGI(APP_TAG, "LED set to LOW (OFF)");
                } else {
                    ESP_LOGW(APP_TAG, "Invalid control code: 0x%02x", command);
                }
                
                // 务必手动释放拷贝出来的物理堆空间，防止内存泄漏！
                free(packet.data);
            }
        }
    }
}

/**
 * @brief 周期性传感器遥测与推送任务
 */
static void sensor_telemetry_task(void *pvParameters)
{
    ESP_LOGI(APP_TAG, "Sensor telemetry task launched.");
    uint32_t sensor_raw_counter = 0;

    while (1) {
        // 每 1 秒读取并推送一次数据
        vTaskDelay(pdMS_TO_TICKS(1000));

        if (g_is_connected) {
            sensor_raw_counter++;
            
            // 将 32 位传感器数据转换为大端字节流
            uint8_t payload[4];
            payload[0] = (sensor_raw_counter >> 24) & 0xFF;
            payload[1] = (sensor_raw_counter >> 16) & 0xFF;
            payload[2] = (sensor_raw_counter >> 8)  & 0xFF;
            payload[3] = (sensor_raw_counter)       & 0xFF;
            
            // 首先更新本地 GATT 属性值缓冲区，即使手机关闭 Notification，主动发起 Read 也能读到最新值
            esp_ble_gatts_set_attr_value(g_gatt_db_handles[IDX_CHAR_VAL_SENSOR], sizeof(payload), payload);

            // 如果客户端使能了 Notification (即 CCCD 为 0x0001)
            if (g_sensor_cccd_value == 0x0001) {
                // 向客户端主动发送数据推送。最后一个参数 indicate 设为 false 表示使用不带确认的 Notification 模式
                esp_err_t err = esp_ble_gatts_send_indicate(g_gatts_if, g_conn_id, 
                                                           g_gatt_db_handles[IDX_CHAR_VAL_SENSOR], 
                                                           sizeof(payload), payload, false);
                if (err != ESP_OK) {
                    ESP_LOGE(APP_TAG, "Failed to send notification: %s", esp_err_to_name(err));
                } else {
                    ESP_LOGI(APP_TAG, "Telemetry Notification Sent: %d", (int)sensor_raw_counter);
                }
            }
        }
    }
}

/**
 * @brief 应用全局主入口
 */
void app_main(void)
{
    esp_err_t ret;

    // 1. 初始化非易失性存储闪存 (NVS Flash)。蓝牙协议栈存放配对密钥和射频校准数据必须依赖 NVS
    ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // 2. 创建用于控制解耦的 FreeRTOS 队列
    g_cmd_queue = xQueueCreate(16, sizeof(ble_cmd_packet_t));
    if (g_cmd_queue == NULL) {
        ESP_LOGE(APP_TAG, "Failed to create control queue. Shutting down.");
        return;
    }

    // 3. 释放经典蓝牙控制器内存
    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));

    // 4. 初始化底层的硬件控制器
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_bt_controller_init(&bt_cfg));
    ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BLE));

    // 5. 初始化 Bluedroid Host 层
    ESP_ERROR_CHECK(esp_bluedroid_init());
    ESP_ERROR_CHECK(esp_bluedroid_enable());

    // 6. 注册事件分发回调函数
    ESP_ERROR_CHECK(esp_ble_gatts_register_callback(gatts_event_handler));
    ESP_ERROR_CHECK(esp_ble_gap_register_callback(gap_event_handler));
    
    // 7. 注册特定 App ID 的 Profile 触发 REG 事件完成后续建表
    ESP_ERROR_CHECK(esp_ble_gatts_app_register(PROFILE_APP_ID));

    // 8. 创建独立于蓝牙协议栈的 FreeRTOS 业务任务，优先级设为 5
    xTaskCreate(app_gpio_worker_task,   "gpio_worker",   2048, NULL, 5, NULL);
    xTaskCreate(sensor_telemetry_task,  "sensor_telemetry", 2048, NULL, 5, NULL);

    ESP_LOGI(APP_TAG, "Production BLE GATT Server system initialized successfully.");
}
```

---

## 5. 蓝牙低功耗模式与 Modem Sleep 优化

对于电池供电的嵌入式物联网设备，射频发射是整机的功耗大户（通常射频开启瞬间功耗可达 **80 mA ~ 130 mA**）。我们必须实施精细化低功耗管控：

### 5.1 调制解调器休眠 (Modem Sleep) 与自动轻度休眠 (Light Sleep)

ESP32 在初始化蓝牙后，可以通过启用**自动电源管理 (Power Management)** 来在射频空闲时自动降低 CPU 时钟或暂停射频单元。配置步骤如下：

```c
#include "esp_pm.h"

// 必须在 sdkconfig 中开启 CONFIG_PM_ENABLE 选项
esp_pm_config_t pm_config = {
    .max_freq_mhz = 160,       // 业务高负载时最大 CPU 频率
    .min_freq_mhz = 80,        // 空闲时 CPU 时钟自动降频以降低静态功耗
    .light_sleep_enable = true // 允许系统在蓝牙广播/连接窗口间隔中自动切入 Light Sleep 模式
};
ESP_ERROR_CHECK(esp_pm_configure(&pm_config));
```

一旦启用此配置，当外设不需要发送数据且连接的连接事件还未到达时，主控与蓝牙射频会自动进入休眠状态，**待机电流可由 80 mA 降至 2 mA 以下**，极大延长了电池供电设备的生命周期。
