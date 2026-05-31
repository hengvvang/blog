# 第二章：基于现代 Target 的属性传播与可见性控制

现代 CMake（通常指 CMake 3.0 及更高版本）的核心设计哲学是**以目标（Target）为中心，以属性（Property）为驱动**。传统的 CMake 以全局变量和目录为导向（例如 `include_directories`、`link_libraries`），容易导致全局配置污染和依赖链条模糊。现代 CMake 提倡将每个组件（库或可执行程序）建模为一个具有独立封装边界的“目标”，并通过精确控制的属性传播链，自动管理依赖树的构建行为。

---

## 1. 目标属性与现代 API 映射

在现代 CMake 中，一个 Target 内部维护着两类核心属性：
1.  **内部构建属性（Build-time Properties）**：影响当前目标自身的编译或链接行为。
2.  **消费者接口属性（Usage Requirements）**：以 `INTERFACE_` 为前缀。当其他目标链接此目标时，这些属性会自动传递并合并到消费者的内部构建属性中。

CMake 的现代目标管理 API 正是基于这一属性映射机制设计的：

| 目标配置命令 | 内部构建属性 (仅自己使用) | 接口导出属性 (传递给下游) | 影响的具体构建行为 |
| :--- | :--- | :--- | :--- |
| `target_include_directories` | `INCLUDE_DIRECTORIES` | `INTERFACE_INCLUDE_DIRECTORIES` | 头文件搜索路径 (`-I` / `/I`) |
| `target_compile_definitions` | `COMPILE_DEFINITIONS` | `INTERFACE_COMPILE_DEFINITIONS` | 预编译宏定义 (`-D`) |
| `target_compile_options` | `COMPILE_OPTIONS` | `INTERFACE_COMPILE_OPTIONS` | 编译器参数选项 (如 `-Wall`) |
| `target_link_libraries` | `LINK_LIBRARIES` | `INTERFACE_LINK_LIBRARIES` | 链接的依赖库目标及路径 |
| `target_link_options` | `LINK_OPTIONS` | `INTERFACE_LINK_OPTIONS` | 链接器参数选项 (如 `-rpath`) |

---

## 2. 属性传播与可见性链条

调用这些目标 API 时，我们必须指定可见性关键字：`PRIVATE`、`PUBLIC` 或 `INTERFACE`。它们决定了属性在依赖网中的传递路径。

### 2.1 可见性控制物理模型

```
[ Target A (被链接目标) ]
├── 内部属性 (用于编译 A 自身)
│   ├── COMPILE_DEFINITIONS
│   └── INCLUDE_DIRECTORIES
└── 接口属性 (用于编译链接 A 的消费者)
    ├── INTERFACE_COMPILE_DEFINITIONS
    └── INTERFACE_INCLUDE_DIRECTORIES

            │
            ├─────── PRIVATE 链接 ───────> [ Target B ]
            │                              (B 仅继承 A 的接口属性到自身的内部属性，
            │                               但不将 A 的接口属性合并到 B 的接口属性中，
            │                               阻断向 B 的消费者传播)
            │
            ├─────── PUBLIC 链接 ────────> [ Target B ]
            │                              (B 继承 A 的接口属性到自身的内部属性，
            │                               且将 A 的接口属性合并到 B 的接口属性中，
            │                               继续向 B 的消费者传播)
            │
            └─────── INTERFACE 链接 ─────> [ Target B ]
                                           (B 不继承 A 的接口属性到自身的内部属性，
                                            但直接将 A 的接口属性合并到 B 的接口属性中，
                                            仅向 B 的消费者传播)
```

### 2.2 传播规则详解

*   **`PRIVATE`（私有依赖）**：
    *   **语义**：该依赖关系或编译配置属于目标的“内部实现细节”，不对外暴露。
    *   **传播行为**：依赖项 A 的接口属性会被载入目标 B 的内部属性。但当第三个目标 C 链接 B 时，C 不会继承 A 的任何属性。
*   **`INTERFACE`（接口依赖）**：
    *   **语义**：该依赖关系或编译配置纯粹是目标提供给消费者的“协议/接口”，目标自身的实现代码并不需要。
    *   **传播行为**：依赖项 A 的接口属性不会载入目标 B 的内部属性。但当 C 链接 B 时，C 会自动继承 A 的接口属性。常用于 Header-only 库或公共头文件中暴露的依赖项。
*   **`PUBLIC`（公共依赖）**：
    *   **语义**：该依赖关系既是目标自身的内部实现，同时又在公共接口（如对外导出的头文件）中显式暴露。
    *   **传播行为**：等同于同时执行 `PRIVATE` 与 `INTERFACE`。依赖项 A 的接口属性既载入目标 B 的内部属性，也载入目标 B 的接口属性。

---

## 3. 多级依赖传播实战场景分析

为了展示属性如何在依赖网中自动流动，我们以一个三级模块集成结构为例：

```
[ 基础加密库 Crypto ] ───> [ 网络通讯库 HttpClient ] ───> [ 业务应用程序 App ]
```

### 3.1 场景一：HttpClient 以 PRIVATE 方式链接 Crypto
当 `HttpClient` 的内部实现使用了 `Crypto` 库，但在 `HttpClient` 导出的公共头文件（如 `http_client.h`）中**没有**包含任何 `Crypto` 的头文件时：

```cmake
# HttpClient 的配置
add_library(http_client SHARED src/http_client.cpp)
target_link_libraries(http_client PRIVATE crypto_lib)
```

此时：
*   在编译 `http_client.cpp` 时，编译器会自动获取 `crypto_lib` 的头文件搜索路径，并链接其二进制文件。
*   在编译 `App` 并链接 `http_client` 时：
    ```cmake
    add_executable(app main.cpp)
    target_link_libraries(app PRIVATE http_client)
    ```
    由于是 `PRIVATE` 链接，`crypto_lib` 的包含路径**不会**传播给 `app`。这保证了 `app` 的编译参数清爽，防止了不必要的依赖泄漏。

### 3.2 场景二：HttpClient 以 PUBLIC 方式链接 Crypto
如果 `HttpClient` 的公共头文件 `http_client.h` 中包含或继承了 `Crypto` 库的数据类型（例如，定义了公开的 `struct HttpSession { CryptoContext ctx; };`）：

```cmake
# HttpClient 的配置
add_library(http_client SHARED src/http_client.cpp)
target_link_libraries(http_client PUBLIC crypto_lib)
```

此时：
*   由于使用了 `PUBLIC` 关键字，`crypto_lib` 的 `INTERFACE_INCLUDE_DIRECTORIES` 会被自动写入 `http_client` 的 `INTERFACE_INCLUDE_DIRECTORIES`。
*   当下游 `App` 链接 `http_client` 时，CMake 在生成构建规则时会自动将 `crypto_lib` 的头文件搜索路径合并到 `app` 中。下游无需多写一行 `find_package` 或 `target_include_directories`，即可通过编译。

---

## 4. 生成器表达式（Generator Expressions）与路径解耦

在设计面向分发的现代库时，头文件搜索目录（Include Directories）在两个阶段的路径完全不同：

1.  **构建期（Build Tree）**：项目尚未安装，头文件位于开发者的本地工作区源码目录下（如 `/path/to/my_library/include`）。
2.  **安装期（Install Tree）**：项目被安装到系统或指定的发布路径，头文件已被拷贝至相对于安装前缀的标准位置（如 `<prefix>/include`）。

如果我们直接将开发路径硬编码进 `target_include_directories`：
```cmake
# 严重错误：此绝对路径会被固化并导出，在其他人电脑上编译时会由于路径不存在而报错
target_include_directories(my_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
```

为了完美解决这一“一库两路径”的冲突，现代 CMake 引入了**生成器表达式**中的构建/安装接口修饰符：

*   **`$<BUILD_INTERFACE:...>`**：仅在当前 CMake 构建树中生效（编译本项目，或作为 `add_subdirectory` 的子模块时）。
*   **`$<INSTALL_INTERFACE:...>`**：仅在目标被安装并导出，且被外部通过 `find_package` 引入时生效。

### 4.1 规范的最佳实践配置

```cmake
# 声明目标
add_library(my_core_lib SHARED src/core.cpp)

# 精确隔离构建期与安装期的依赖目录
target_include_directories(my_core_lib
    PUBLIC
        # 1. 在开发者工作区构建时，指向本地绝对源文件头文件路径
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        
        # 2. 在生成的文件安装后，指向安装目录下的相对路径（相对于 CMAKE_INSTALL_PREFIX）
        $<INSTALL_INTERFACE:include>
)
```

当执行导出动作（Export）时，CMake 会智能处理此生成器表达式：
*   对于构建树导出的文件，它仅保留 `$<BUILD_INTERFACE>`。
*   对于安装包导出的文件，它会自动剔除带有本地绝对路径的 `$<BUILD_INTERFACE>` 分支，仅保留 `$<INSTALL_INTERFACE>` 分支并将其重写为简洁的 `include` 相对路径。这保证了发布包在任意目标机器上均可直接导入运行，实现了彻底的环境与路径解耦。
