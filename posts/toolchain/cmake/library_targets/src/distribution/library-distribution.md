# 第三章：CMake 库的安装、导出与打包发布

在完成库目标的开发和属性配置后，软件开发生命周期的最后一个关键步骤是**打包与分发**。一个工业级的 C/C++ 库必须保证下游消费者能够通过 CMake 的原生查找机制（如 `find_package`）一键集成，且在发布部署到目标系统时，不会因动态库寻址失败而导致程序崩溃。

本章将详细解构动态库运行时的加载寻址机制（RPATH/RUNPATH），并提供一套完整的、生产级别的 CMake 库安装、导出与分发模板。

---

## 1. 动态库运行时加载寻址机制

在 Linux、macOS 等 Unix-like 系统上，可执行文件链接动态库后，系统动态链接器（如 Linux 上的 `ld.so`）在程序启动时需要定位并加载这些共享库（`.so`/`.dylib`）。

### 1.1 动态链接器搜索链条

动态链接器在定位动态库时，遵循严格的优先级搜索路径：

```
+-------------------------------------------------------+
| 1. 检查可执行文件的 RPATH (若设置且无 RUNPATH 存在时) |
+---------------------------┬---------------------------+
                            │ 未找到
                            v
+-------------------------------------------------------+
| 2. 检查环境变量 LD_LIBRARY_PATH                      |
+---------------------------┬---------------------------+
                            │ 未找到
                            v
+-------------------------------------------------------+
| 3. 检查可执行文件的 RUNPATH (若设置)                  |
+---------------------------┬---------------------------+
                            │ 未找到
                            v
+-------------------------------------------------------+
| 4. 检查系统缓存 /etc/ld.so.cache                      |
+---------------------------┬---------------------------+
                            │ 未找到
                            v
+-------------------------------------------------------+
| 5. 搜索系统默认库目录 (如 /lib, /usr/lib, /usr/local/lib) |
+---------------------------┬---------------------------+
                            │ 仍未找到
                            v
            +───────────────────────────────+
            | 运行时崩溃: Library Not Found |
            +───────────────────────────────+
```

### 1.2 RPATH 与 RUNPATH 的底层差异

为了控制搜索行为，编译器/链接器提供了两个核心属性：
*   **RPATH（Run Path）**：最早期的标准，被硬编码进二进制文件的 ELF 头中（键值为 `DT_RPATH`）。由于其优先级高于 `LD_LIBRARY_PATH`，一旦写死绝对路径，系统管理员就无法通过环境变量对其进行临时覆盖，缺乏灵活性。
*   **RUNPATH**：现代 Linux 发行版推荐的标准（键值为 `DT_RUNPATH`）。它的优先级低于 `LD_LIBRARY_PATH`，这允许下游使用者在需要时通过环境变量重定向依赖库。
    *   在现代 GCC/Clang 链接器中，默认会加入 `--enable-new-dtags` 选项，将指定的路径同时写入 RPATH 和 RUNPATH（或仅写入 RUNPATH），使 RPATH 失效。若想强制使用传统的 RPATH，可向链接器传递参数：`-Wl,--disable-new-dtags`。

### 1.3 相对寻址技术：`$ORIGIN` 与 `@loader_path`

如果在打包时将 RPATH 写死为开发机上的绝对路径（如 `/home/developer/projects/lib`），在用户机器上运行必然报错。因此，必须采用**基于相对路径的动态寻址定位**：

*   **Linux 平台 (`$ORIGIN`)**：`$ORIGIN` 是动态链接器识别的特殊变量，代表**当前可执行文件或动态库在文件系统中的绝对路径**。
    *   例如，若安装结构为：
        ```
        /opt/app/bin/my_executable
        /opt/app/lib/libmy_math.so
        ```
        我们可以将可执行文件的 RPATH 设置为 `\$ORIGIN/../lib`。程序在运行时，动态链接器会自动将其展开为 `/opt/app/bin/../lib` 即 `/opt/app/lib`，从而正确找到动态库。
*   **macOS 平台 (`@loader_path` / `@rpath`)**：
    *   `@loader_path` 类似于 Linux 的 `$ORIGIN`，指代加载当前模块的二进制文件所在路径。
    *   `@rpath` 则更为强大，允许动态库声明自己为 `@rpath/libfoo.dylib`，而由链接它的可执行文件提供具体的搜索路径列表（通过写入多个 RPATH 段）。

---

## 2. 库的发布与分发周期管理

要将一个库规范地分发给下游，我们需要生成并安装四类文件：
1.  **物理二进制文件**：静态库（`.a`/`.lib`）、动态库（`.so`/`.dylib`/`.dll`）以及 Windows 平台下的动态库导入库（`.lib`）。
2.  **公共头文件**：下游编译所必需的外部接口声明。
3.  **Target 导出描述文件 (`*Targets.cmake`)**：将安装好的物理文件反向建模为 CMake 目标，包含其所有的 `INTERFACE_*` 属性和级联依赖。
4.  **包配置文件 (`*Config.cmake` 与 `*ConfigVersion.cmake`)**：提供给下游 `find_package` 调用时的入口与版本控制系统。

```
【 库的发布与分发周期 (Packaging & Distribution Cycle) 】

 [ 源码开发阶段 ]
     │  (编写 CMakeLists.txt 使用 install 声明导出与目录)
     ▼
 [ 构建与编译 (cmake --build) ] ──> 生成二进制文件 (.so / .dll / .a)
     │
     ▼  (执行 cmake --install)
 [ 安装导出阶段 ]
     ├─> 拷贝头文件到 /include
     ├─> 拷贝二进制到 /lib 或 /bin (擦除构建期绝对 RPATH，写入相对 RPATH)
     └─> 自动生成并安装自描述描述文件：
             ├── MyMathLibTargets.cmake (记录目标属性与传递关系)
             ├── MyMathLibConfigVersion.cmake (记录版本相容性)
             └── MyMathLibConfig.cmake (环境及次级依赖检查入口)
     │
     ▼  (打包发布为 SDK 或通过包管理器分发)
 [ 下游消费集成 ]
     │  (下游项目使用 find_package(MyMathLib CONFIG REQUIRED) 导入)
     ▼
 [ 编译下游可执行程序 ] ──> 自动继承 MyMathLib::my_math_lib 的所有接口属性
```

---

## 3. 生产级库分发完整工程模板

我们以一个名为 `MyMathLib` 的计算库项目为例，展示其完整、规范的 CMake 结构设计。

### 3.1 包配置文件模板 (`MyMathLibConfig.cmake.in`)

在项目根目录下创建此模板文件。在下游项目执行 `find_package` 时，此文件会被解析，用于还原目标定义并导入依赖。

```cmake
@PACKAGE_INIT@

# 引入 CMake 官方依赖导入宏工具
include(CMakeFindDependencyMacro)

# 如果本库内部依赖了其他第三方组件（例如操作系统线程库），必须在此处一并安全寻址并导入
# 避免下游链接本库时，由于找不到次级依赖而报未定义符号错误
find_dependency(Threads REQUIRED)

# 导入 CMake 自动生成的 Targets 导出描述文件
include("${CMAKE_CURRENT_LIST_DIR}/MyMathLibTargets.cmake")

# 检查下游请求的目标和组件是否齐备
check_required_components(MyMathLib)
```

### 3.2 核心 `CMakeLists.txt` 构建配置

```cmake
cmake_minimum_required(VERSION 3.15)
project(MyMathLib 
    VERSION 1.2.3 
    DESCRIPTION "A production-grade math calculation library"
    LANGUAGES CXX
)

# 1. 强制设定 C++ 编译标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 2. 生产级 RPATH 机制控制
# 在构建期和安装期动态重写 RPATH，避免直接写入硬编码绝对路径
set(CMAKE_BUILD_WITH_INSTALL_RPATH OFF) # 仅在安装阶段重写二进制的 RPATH 字段
set(CMAKE_INSTALL_RPATH_USE_LINK_PATH ON) # 保留链接的其他外部库路径

if(APPLE)
    # macOS 下使用 @loader_path 寻址同级或上一级目录
    set(CMAKE_INSTALL_RPATH "@loader_path/../lib")
else()
    # Linux 下使用 $ORIGIN，必须对 $ 进行转义防止 CMake 在配置期解析它
    set(CMAKE_INSTALL_RPATH "\$ORIGIN/../lib")
endif()

# 3. 引入外部依赖库作为演示
find_package(Threads REQUIRED)

# 4. 创建动态共享库目标
add_library(my_math_lib SHARED
    src/adder.cpp
    src/multiplier.cpp
)

# 5. 配置 Target 属性与接口路径解耦
target_include_directories(my_math_lib
    PUBLIC
        # 构建期：使用本地工作区的头文件目录
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        # 安装期：使用安装包根目录下的 include 相对目录
        $<INSTALL_INTERFACE:include>
)

# 链接线程依赖库（PUBLIC 表示下游使用本库时也必须链接线程库）
target_link_libraries(my_math_lib
    PUBLIC
        Threads::Threads
)

# 6. 导入官方 GNU 目录规范定义模块 (定义 CMAKE_INSTALL_BINDIR, CMAKE_INSTALL_LIBDIR 等)
include(GNUInstallDirs)

# 7. 安装库物理二进制文件，并归属到名为 "MyMathLibTargets" 的导出目标集合中
# 注意 Windows 下 DLL 文件的特殊性：
# - 静态库与导入库 (.lib) 属于 ARCHIVE
# - 动态链接库自身 (.dll) 属于 RUNTIME，应安装到 bin/ 目录下，以便系统寻址
install(TARGETS my_math_lib
    EXPORT MyMathLibTargets
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}  # 安装静态库与 Windows 导入库 (lib/)
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}  # 安装 Linux 共享库 (lib/)
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}  # 安装可执行二进制与 Windows DLL (bin/)
    INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR} # 告知下游安装包的头文件目录前缀
)

# 8. 规范拷贝公共接口头文件
install(DIRECTORY include/
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
    FILES_MATCHING PATTERN "*.h" PATTERN "*.hpp"
)

# 9. 安装并生成 Target 描述信息文件
# 该步骤会在指定路径生成 MyMathLibTargets.cmake，下游通过该文件获得 my_math_lib 及其所有接口属性
install(EXPORT MyMathLibTargets
    FILE MyMathLibTargets.cmake
    NAMESPACE MyMathLib::            # 命名空间，防止与其他库发生名称冲突
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/MyMathLib
)

# 10. 自动生成并配置 find_package 包配置文件
include(CMakePackageConfigHelpers)

# 生成版本匹配规则文件 (以 SameMajorVersion 为主版本兼容控制)
write_basic_package_version_file(
    "${CMAKE_CURRENT_BINARY_DIR}/MyMathLibConfigVersion.cmake"
    VERSION ${PROJECT_VERSION}
    COMPATIBILITY SameMajorVersion
)

# 生成自描述包配置文件
configure_package_config_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/MyMathLibConfig.cmake.in"
    "${CMAKE_CURRENT_BINARY_DIR}/MyMathLibConfig.cmake"
    INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/MyMathLib
)

# 安装生成的配置文件到 CMake 查找路径中
install(FILES
    "${CMAKE_CURRENT_BINARY_DIR}/MyMathLibConfig.cmake"
    "${CMAKE_CURRENT_BINARY_DIR}/MyMathLibConfigVersion.cmake"
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/MyMathLib
)
```

---

## 4. 下游集成测试

当上游的 `MyMathLib` 被执行安装（例如：`cmake --install build --prefix C:/MySDK`）后，下游项目便可以极其优雅、安全地导入该模块。

### 4.1 下游项目 `CMakeLists.txt`
```cmake
cmake_minimum_required(VERSION 3.15)
project(AppRunner CXX)

set(CMAKE_CXX_STANDARD 17)

# 1. 寻找第三方包 (可以通过 -DMyMathLib_DIR=C:/MySDK/lib/cmake/MyMathLib 显式提供路径)
find_package(MyMathLib 1.2 CONFIG REQUIRED)

# 2. 定义下游可执行文件
add_executable(app_runner main.cpp)

# 3. 链接导入目标
# 此命令会自动让 app_runner 继承 MyMathLib 的包含路径、线程依赖库以及共享二进制目标路径
target_link_libraries(app_runner PRIVATE MyMathLib::my_math_lib)
```

### 4.2 下游项目源码 `main.cpp`
```cpp
#include <iostream>
#include <my_math/adder.h> // 无需手动配置本地 include 路径，CMake 已自动导入

int main() {
    // 调用导出的库方法
    int result = my_math::add(15, 25);
    std::cout << "Calculation Result from MyMathLib: 15 + 25 = " << result << std::endl;
    return 0;
}
```

通过这一整套标准化的安装与导出流程，我们成功地为 C/C++ 项目组件化搭建了一条高可靠、规范化的分发管道。
