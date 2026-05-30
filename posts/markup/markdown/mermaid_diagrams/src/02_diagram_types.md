# 主流图表语法与多场景建模

在本章中，我们将深入探讨 Mermaid 中最常用的五种系统设计图表。所有示例均采用真实生产场景（如高并发架构、OAuth 2.0 认证流、订单状态机及电商数据模型），并附带详细的行级注释与设计考量。

---

## 1. 流程图（Flowcharts）

流程图是表达拓扑结构、业务决策控制流最直观的工具。在 Mermaid 中，流程图通过 `graph` 或 `flowchart` 声明。建议使用最新版本的 `flowchart`，它在渲染算法和节点边框连接上更具优化。

### 1.1 核心语法与形状速查
*   **布局方向**：`TB` (Top to Bottom), `BT` (Bottom to Top), `LR` (Left to Right), `RL` (Right to Left)。
*   **节点形状**：
    *   矩形：`id[Text]`
    *   圆角矩形：`id(Text)`
    *   体育场形：`id([Text])`
    *   圆柱形（数据库）：`id[(Text)]`
    *   菱形（决策分支）：`id{Text}`
    *   平行四边形：`id[\Text\]` 或 `id[/Text/]`
*   **连线样式**：
    *   实线带箭头：`A --> B`
    *   粗实线：`A ==> B`
    *   虚线：`A -.-> B`
    *   无箭头连线：`A --- B`
    *   带文本的连线：`A -->|描述| B` 或 `A -- 描述 --> B`

### 1.2 生产级案例：多级缓存与写穿透拓扑

以下是一个包含了子图（Subgraph）嵌套、多节点形状和自定义 CSS 类样式的微服务读取/写入缓存控制流程：

```mermaid
flowchart TD
    %% ----------------------------------------------------
    %% 定义全局样式类
    %% ----------------------------------------------------
    classDef clientClass fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1;
    classDef gateClass fill:#efebe9,stroke:#4e342e,stroke-width:2px,color:#3e2723;
    classDef cacheClass fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20;
    classDef dbClass fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:#e65100;
    classDef alertClass fill:#ffebee,stroke:#c62828,stroke-width:2px,color:#b71c1c;

    %% ----------------------------------------------------
    %% 客户端与网关层
    %% ----------------------------------------------------
    User([客户端浏览器]):::clientClass
    Gateway{API 网关决策}:::gateClass

    User -->|HTTPS Request| Gateway

    %% ----------------------------------------------------
    %% 子图：缓存系统
    %% ----------------------------------------------------
    subgraph CacheSystem["分布式缓存系统 (Redis Cluster)"]
        direction LR
        RedisMaster[(Redis 主节点)]:::cacheClass
        RedisSlave[(Redis 从节点)]:::cacheClass
        RedisMaster -->|主从复制| RedisSlave
    end

    %% ----------------------------------------------------
    %% 子图：持久化存储层
    %% ----------------------------------------------------
    subgraph StorageLayer["持久化数据层"]
        direction TB
        MySQL_Master[(MySQL 主库)]:::dbClass
        MySQL_Replica[(MySQL 只读库)]:::dbClass
        BinlogReceiver[Binlog 监听器]:::dbClass
        
        MySQL_Master -->|异步复制| MySQL_Replica
        MySQL_Master -->|日志变更| BinlogReceiver
    end

    %% ----------------------------------------------------
    %% 业务流转与判定
    %% ----------------------------------------------------
    Gateway -->|1. 读操作| RedisSlave
    RedisSlave -.->|2. Cache Hit| Gateway
    
    RedisSlave -->|3. Cache Miss| MySQL_Replica
    MySQL_Replica -.->|4. 返回数据并写入缓存| RedisMaster

    Gateway -->|5. 写操作| MySQL_Master
    MySQL_Master -.->|6. Write OK| Gateway
    
    BinlogReceiver -->|7. 触发缓存失效| RedisMaster:::alertClass

    %% 连线注释与样式微调
    linkStyle 4 stroke:#2e7d32,stroke-width:2px;
    linkStyle 7 stroke:#c62828,stroke-width:2px,stroke-dasharray: 5 5;
```

---

## 2. 时序图（Sequence Diagrams）

时序图用于描述对象或系统之间依时间顺序进行的交互。它极其适合分析微服务间的同步 RPC 调用和异步消息队列（MQ）推送。

### 2.1 核心语法要素
*   **参与者声明**：`participant` 或 `actor`，可通过 `as` 关键字定义别名。
*   **消息箭头**：
    *   实线带实心箭头（同步调用）：`->>`
    *   虚线带实心箭头（同步返回）：`-->>`
    *   实线带非实心箭头（异步调用）：`->`
    *   虚线带非实心箭头（异步返回）：`-->`
*   **激活区间**：在发送端或接收端使用 `activate` 和 `deactivate`，或直接在箭头后追加 `+` 和 `-`。
*   **条件分支与循环**：使用 `alt/else` 表示分支逻辑，使用 `loop` 表示循环逻辑，使用 `opt` 表示可选步骤。
*   **并行计算**：使用 `par` 块包围并发操作。

### 2.2 生产级案例：OAuth 2.0 授权码模式交互流

以下详细刻画了用户、第三方客户端、后端网关以及授权服务器之间的 Token 获取全生命周期：

```mermaid
sequenceDiagram
    autonumber
    
    %% 声明参与者并自定义显示标签
    actor User as 用户 (User Agent)
    participant Client as 客户端 (Frontend app)
    participant Backend as 业务后端 (Backend Server)
    participant AuthServer as 授权服务器 (Auth Server)

    %% 流程开始
    User->>Client: 1. 点击“使用第三方账号登录”
    activate Client
    Client-->>User: 2. 重定向至授权登录页 (带 Client_ID, Redirect_URI)
    deactivate Client

    User->>AuthServer: 3. 输入凭证并同意授权
    activate AuthServer
    AuthServer-->>User: 4. 发送授权码 (Authorization Code) 并重定向
    deactivate AuthServer

    User->>Client: 5. 携带 Authorization Code 访问 Redirect_URI
    activate Client
    Client->>Backend: 6. 传递 Authorization Code 至后端
    activate Backend
    
    note over Backend, AuthServer: 后端使用 Code 与 AppSecret 向授权服务发起请求
    
    Backend->>AuthServer: 7. POST /oauth/token (code, client_secret)
    activate AuthServer
    
    alt 授权码校验成功
        AuthServer-->>Backend: 8a. 返回 Access Token & Refresh Token
        Backend-->>Client: 9a. 创建本地 Session，返回自定义 JWT
    else 授权码过期或不匹配
        AuthServer-->>Backend: 8b. 返回 400 Bad Request (invalid_grant)
        Backend-->>Client: 9b. 登录失败，提示重新授权
    end
    deactivate AuthServer
    deactivate Backend
    deactivate Client

    loop 维持心跳与会话
        Client->>Backend: 10. 带有 JWT 的业务请求 (Authorization Header)
        activate Client
        activate Backend
        Backend-->>Client: 11. 返回数据 (HTTP 200 OK)
        deactivate Backend
        deactivate Client
    end
```

---

## 3. 状态图（State Diagrams）

状态图是设计复杂业务实体（如订单状态、交易链路、工作流审批）生命周期的核心利器，能有效防止非法状态转移漏洞。

### 3.1 核心语法要素
*   **初始与终态**：用 `[*]` 表示。
*   **状态转移**：`State1 --> State2 : TriggerEvent`。
*   **复合状态**：在一个状态内定义子状态，形成嵌套结构。
*   **并发状态**：在一个复合状态内部，使用 `--` 分割多个同时运行的并行状态线。

### 3.2 生产级案例：微服务订单生命周期状态机

下面是一个结合了并发状态（支付与物流跟踪并行）和复合状态的典型电商订单状态图：

```mermaid
stateDiagram-v2
    %% 初始状态至创建中
    [*] --> Created : 1. 用户提交购物车
    
    %% 状态：未支付
    state Created {
        [*] --> Unpaid
        Unpaid --> Expired : 30分钟超时未支付
        Unpaid --> Paid : 2. 用户完成支付
    }

    Expired --> [*] : 自动取消订单并归还库存

    %% 状态：已支付，开启并行分支处理
    state Paid {
        %% 分支一：财务入账与发票开具
        state FinancialTracking {
            [*] --> AwaitingInvoice
            AwaitingInvoice --> InvoiceIssued : 系统自动开具电子发票
        }
        
        --
        
        %% 分支二：物理仓储与物流状态
        state LogisticsTracking {
            [*] --> WarehouseProcessing : 派单至 WMS 系统
            WarehouseProcessing --> Shipped : 库房出库打单
            Shipped --> InTransit : 顺丰揽件更新
            InTransit --> Delivered : 客户签收完成
        }
    }

    Created --> Paid : 支付回调通知
    Paid --> Completed : 3. 财务与物流均确认完成
    Completed --> [*] : 归档

    %% 异常流转：已支付但用户申请退款
    Paid --> Refunding : 4. 申请售后退款
    Refunding --> Refunded : 5. 财务原路退款成功
    Refunded --> [*]
```

---

## 4. 实体关系图（ER Diagrams）

在设计关系型数据库时，ER 图用于表示数据表之间的物理或逻辑关系。

### 4.1 关系基数符号
*   `||--||`：一且仅有一（One and only one）
*   `||--o{`：零个或多个（Zero or many）
*   `||--|{`：一个或多个（One or many）
*   `o|--|{`：一个或多个（非强依赖）

### 4.2 生产级案例：电商交易系统核心模型

此案例描述了用户、订单、订单项与商品之间的关联性，并列出了关键字段及约束属性：

```mermaid
erDiagram
    %% ----------------------------------------------------
    %% 定义实体属性与类型
    %% ----------------------------------------------------
    USER {
        bigint user_id PK "用户全局唯一标识"
        varchar username "用户名"
        varchar email "邮箱"
        timestamp created_at "创建时间"
    }

    ORDER {
        bigint order_id PK "订单全局主键"
        bigint user_id FK "关联用户ID"
        varchar order_no UK "订单流水号"
        decimal total_amount "订单总金额"
        integer status "订单状态"
        timestamp created_at "创建时间"
    }

    ORDER_ITEM {
        bigint item_id PK "订单行项ID"
        bigint order_id FK "关联订单主表"
        bigint product_id FK "关联商品表"
        integer quantity "商品购买数量"
        decimal unit_price "购买时单价"
    }

    PRODUCT {
        bigint product_id PK "商品全局唯一标识"
        varchar sku_code UK "库存保存单位编码"
        varchar product_name "商品名称"
        decimal price "当前售价"
        integer stock "剩余库存"
    }

    %% ----------------------------------------------------
    %% 定义实体间映射关系
    %% ----------------------------------------------------
    USER ||--o{ ORDER : "一个用户可以拥有0个或多个订单"
    ORDER ||--|{ ORDER_ITEM : "一个订单必须包含1个或多个商品行项"
    PRODUCT ||--o{ ORDER_ITEM : "一个商品可以被包含在0个或多个订单行项中"
```

---

## 5. 类图（Class Diagrams）

对于静态代码结构以及设计模式的讲解，类图是不可或缺的表达方式。

### 5.1 生产级案例：策略设计模式（Strategy Pattern）的实现

以下是一个支付系统中使用策略模式（Strategy Pattern）进行结算的面向对象类图设计：

```mermaid
classDiagram
    direction BT
    
    %% 定义接口与抽象类
    class PaymentContext {
        -PaymentStrategy strategy
        +setStrategy(PaymentStrategy strategy) void
        +executePayment(double amount) boolean
    }
    
    class PaymentStrategy {
        <<interface>>
        +pay(double amount) boolean
    }
    
    class AlipayStrategy {
        -String alipayUserId
        -String signType
        +pay(double amount) boolean
    }
    
    class WechatPayStrategy {
        -String openId
        -String mchId
        +pay(double amount) boolean
    }

    class CreditCardStrategy {
        -String cardNumber
        -String cvv
        -String expiryDate
        +pay(double amount) boolean
    }

    %% 实现与依赖关系表达
    AlipayStrategy ..|> PaymentStrategy : "实现"
    WechatPayStrategy ..|> PaymentStrategy : "实现"
    CreditCardStrategy ..|> PaymentStrategy : "实现"
    PaymentContext --> PaymentStrategy : "关联 (Association)"
```

通过这一章的代码实例，你可以直接拷贝这些结构模板到你的 Markdown 文件中，并根据实际业务快速替换节点信息。在下一章，我们将讨论在大型项目中文档可视化排版的最优工程实践。
