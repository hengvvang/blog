---
title: "ESP32 蓝牙 BLE GATT 服务器开发流程与原理"
publishTime: "2026-05-24 15:10"
author: "hengvvang"
summary: "使用 ESP-IDF 建立 GATT 结构，演示如何定义服务与特征，实现主机与从机间的高效蓝牙数据传输。"
---




# ESP32 蓝牙 BLE GATT 服务器开发流程与原理

ESP32 集成了低功耗蓝牙（BLE）功能，这为近距离无线控制提供了低成本、低功耗的解决方案。本文将拆解 BLE GATT 服务器的内部逻辑。

## BLE 通信架构

BLE 的核心是属性协议（Attribute Protocol, ATT）和通用属性配置文件（GATT）。
- **GATT Profile**：定义了服务器的整体配置。
- **Service（服务）**：逻辑单元，如“电池服务”。
- **Characteristic（特征）**：服务中的一个可读写数据通道，如“当前电量百分比”。

## ESP-IDF BLE 初始化

在 ESP-IDF 中，我们主要使用 Bluedroid 协议栈注册回调函数处理蓝牙堆栈事件：

```c
void ble_init(void) {
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    esp_bt_controller_init(&bt_cfg);
    esp_bt_controller_enable(ESP_BT_MODE_BLE);
    
    esp_bluedroid_init();
    esp_bluedroid_enable();
    
    // 注册 GATT 回调
    esp_ble_gatts_register_callback(gatts_event_handler);
}
```

通过处理 `ESP_GATTS_READ_EVT`（客户端请求读取特征）和 `ESP_GATTS_WRITE_EVT`（客户端写入控制指令）事件，ESP32 即可实现与手机 App 的智能双向绑定控制。