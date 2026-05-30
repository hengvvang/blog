# 1. 库类型与链接深度剖析

在现代 C/C++ 构建中，构建系统必须准确配置源码的编译行为以及最终二进制文件的链接行为。CMake 通过 `add_library()` 提供了静态库（STATIC）、动态库（SHARED）、对象库（OBJECT）以及接口库（INTERFACE）四种核心库类型。

本章将从编译器与链接器的底层原理出发，剖析这四种库目标的生成机制、符号可见性控制以及在实际工程中的权衡选择。

---

## 1. 库目标的生成机制与底层原理

为了清晰呈现各类型库在构建流程中的位置，我们先通过下图直观了解源码到不同库文件的编译和链接轨迹：

```mermaid
graph TD
    subgraph 编译阶段 (Compiler)
        Src[源文件 *.cpp] -->|gcc -c / cl.exe| Obj[对象文件 *.o/*.obj]
    end

    subgraph 静态归档 (Archiver)
        Obj -->|ar / lib.exe| Static[静态库 *.a/*.lib]
    end

    subgraph 动态链接 (Linker)
        Obj -->|ld / link.exe| Shared[动态库 *.so/*.dll]
        DynamicLinker[动态链接器 ld.so] -->|运行时加载| Shared
    end

    subgraph 对象目标 (CMake Target)
        ObjTarget[对象库 Target] -->|不作归档与链接| Obj
    end

    subgraph 接口目标 (Header Only)
        Interface[接口库 Target] -->|无二进制输出| Headers[只分发头文件 *.h/*.hpp]
    end
```

### 1.1 静态库（STATIC）

静态库本质上是**对象文件（Object Files, `.o` / `.obj`）的归档包**。
在 Unix-like 系统下，通常使用 `ar` 命令打包；在 Windows 下，则使用 `lib.exe`。

*   **编译与链接特征**：
    *   在编译静态库时，编译器仅将各个源文件转化为中间对象文件，并不进行真正的链接。
    *   最终的可执行文件（或动态库）在与静态库链接时，链接器会解析静态库中的符号索引表，并将用到的对象文件“复制”合并到最终的二进制文件中。
*   **符号冲突与全局符号复制**：
    *   当多个静态库相互依赖或被同一个可执行文件引用时，如果未做好命名空间或符号可见性隔离，极易发生“重定义错误”（Duplicate Symbols）。
    *   **全归档导入（Whole Archive）**：在某些场景下（如 C++ 静态注册机制、自注册反射机制），链接器默认会剔除未显式引用的对象文件。此时，需使用特定链接参数（如 GCC/Clang 的 `-Wl,--whole-archive`，MSVC 的 `/WHOLEARCHIVE`）强制将静态库中的所有符号打入最终目标。
*   **CMake 定义示例**：
    ```cmake
    add_library(my_static STATIC src/core.cpp src/utils.cpp)
    ```

### 1.2 动态库（SHARED）

动态库在编译时不仅包含对象文件的编译，还需要通过链接器（`ld` 或 `link.exe`）进行符号重定位（Relocation）并生成最终的共享库文件（`.so` / `.dll` / `.dylib`）。

*   **位置无关代码（Position Independent Code, PIC）**：
    *   在 Linux/macOS 平台下，动态库的代码段必须在多个进程间共享，但它们被加载到各个进程的虚拟内存地址可能不同。因此，编译动态库时必须开启 `-fPIC` 编译选项。
    *   `-fPIC` 使得指令使用相对寻址，并通过**全局偏移表（Global Offset Table, GOT）**与**过程链接表（Procedure Linkage Table, PLT）**在运行时动态解析符号地址。
    *   CMake 会自动为 `SHARED` 目标开启 `POSITION_INDEPENDENT_CODE` 属性。
*   **动态链接器与运行时符号决议**：
    *   动态库在程序启动或运行时（通过 `dlopen`）被加载。
    *   操作系统的动态链接器（如 `ld.so`）负责在运行时根据库的查找路径搜索对应的动态库，并将其加载至内存，完成符号决议。
*   **CMake 定义示例**：
    ```cmake
    add_library(my_shared SHARED src/core.cpp src/utils.cpp)
    ```

### 1.3 对象库（OBJECT）

对象库是 CMake 特有的一种“伪”库目标。它**只进行编译阶段，不进行归档（Archive）与链接（Link）**。

*   **设计初衷与应用场景**：
    *   **避免重复编译**：在大型项目中，如果同一组源文件需要同时编译为静态库和动态库，常规做法会导致源文件被编译两次。使用对象库可以先编译出一组 `.obj`/`.o` 文件，然后直接供静态库和动态库目标复用。
    *   **大项目模块化解耦**：允许将大型单体目标拆分为多个轻量级对象库，最后合成一个大型的静态库或动态库，且不需要支付静态库二次解包链接的开销。
*   **链接与属性传播限制的演进**：
    *   在早期的 CMake（3.12 之前）中，对象库的使用非常受限，必须通过语法 `$<TARGET_OBJECTS:obj_target>` 显式将对象文件填充到其他目标。
    *   从 CMake 3.12 开始，对象库被赋予了与常规库几乎同等的地位，能够通过 `target_link_libraries` 直接与其他目标链接，并且其头文件路径、宏定义等依赖属性能正常向下游传播。
*   **CMake 定义示例**：
    ```cmake
    # 定义对象库
    add_library(my_obj_parts OBJECT src/part_a.cpp src/part_b.cpp)
    # 将其头文件路径暴露出来
    target_include_directories(my_obj_parts PUBLIC include/)

    # 复用对象库构建静态库与动态库
    add_library(my_final_static STATIC $<TARGET_OBJECTS:my_obj_parts>)
    add_library(my_final_shared SHARED $<TARGET_OBJECTS:my_obj_parts>)
    ```

### 1.4 接口库（INTERFACE）

接口库在**物理上不产生任何编译产物**（不产生 `.a`、`.so`、`.lib` 或 `.dll`）。它纯粹是一个“逻辑目标”，用于承载并传播头文件路径、宏定义、编译选项等接口属性。

*   **头文件库（Header-only Library）封装**：
    *   现代 C++（尤其是高度模板化的库，如 Eigen, Boost 的部分模块）通常完全实现在头文件中，无需编译任何源文件。
    *   接口库是包装此类 Header-only 库的标准手段。
*   **虚拟配置目标（Conceptual Targets）**：
    *   可用于定义项目全局的“编译特征包”。例如定义一个名为 `compiler_flags_war` 的接口库，将 `-Wall -Wextra -Werror` 绑定到该目标上，其他所有子项目目标链接该接口库，即可自动继承这些编译选项。
*   **CMake 定义示例**：
    ```cmake
    add_library(my_header_only INTERFACE)
    target_include_directories(my_header_only INTERFACE include/)
    target_compile_definitions(my_header_only INTERFACE USING_HEADER_ONLY=1)
    ```

---

## 2. 动态库符号可见性（Visibility）控制

在编写跨平台动态库时，管理符号的导出（Export）是至关重要的。在默认情况下：
*   **GCC/Clang**：默认将源文件中的所有函数与类符号标记为 `default`（即向外部全部导出），这会导致生成的动态库体积庞大，增加运行时加载的重定位耗时，并引入符号命名冲突的隐患。
*   **MSVC**：默认情况下不导出任何符号。若想从 DLL 中使用某个符号，必须显式将其标记为 `__declspec(dllexport)`；而客户端代码在使用该 DLL 时，需要将其标记为 `__declspec(dllimport)`。

### 2.1 推荐的最佳实践

为了统一跨平台开发体验，业界标准做法是：**在 GCC/Clang 下默认隐藏所有符号，只导出带有特定标记的符号**。

通过在 CMake 中配置以下变量，可以强制开启全局符号隐藏：

```cmake
# 默认隐藏所有符号（相当于 GCC 开启 -fvisibility=hidden）
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
# 默认隐藏内联函数的符号（相当于 GCC 开启 -fvisibility-inlines-hidden）
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
```

### 2.2 使用 `GenerateExportHeader` 自动生成跨平台导出宏

CMake 官方提供了 `GenerateExportHeader` 模块，它能根据当前库的名称，自动生成一个包含平台特化导出宏（如 `__declspec(dllexport)`、`__attribute__((visibility("default")))`）的头文件。

#### 完整配置示例

下面演示如何为动态库目标 `my_awesome_lib` 生成并集成跨平台导出头文件：

```cmake
cmake_minimum_required(VERSION 3.15)
project(ExportHeaderDemo CXX)

# 1. 强制设定符号隐藏策略
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

# 2. 定义动态库目标
add_library(my_awesome_lib SHARED 
    src/awesome_api.cpp
)

target_include_directories(my_awesome_lib 
    PUBLIC 
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

# 3. 引入生成导出头文件的模块
include(GenerateExportHeader)

# 4. 生成导出头文件
# 该命令会在 CMAKE_CURRENT_BINARY_DIR 下生成 "awesome_lib_export.h"
# 头文件中会定义宏 MY_AWESOME_LIB_EXPORT
generate_export_header(my_awesome_lib
    BASE_NAME awesome_lib
    EXPORT_FILE_NAME "${CMAKE_CURRENT_BINARY_DIR}/include/awesome_lib/awesome_lib_export.h"
)

# 5. 将生成的头文件所在目录添加到编译期包含路径
target_include_directories(my_awesome_lib 
    PUBLIC 
        $<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}/include>
)
```

在库的 C++ 源码中，我们便可使用自动生成的 `awesome_lib_export.h` 来控制导出行为：

##### 头文件 (`include/awesome_api.h`)

```cpp
#pragma once

#include <awesome_lib/awesome_lib_export.h>
#include <string>

// 使用自动生成的导出宏来修饰类或函数
class MY_AWESOME_LIB_EXPORT AwesomeAPI {
public:
    AwesomeAPI() = default;
    ~AwesomeAPI() = default;

    std::string get_version() const;
    
    // 该函数不会被导出到动态库的符号表中，仅在库内部可用
    void internal_setup();
};

// 导出的全局函数
extern "C" MY_AWESOME_LIB_EXPORT void run_computation();
```

##### 源文件 (`src/awesome_api.cpp`)

```cpp
#include "awesome_api.h"
#include <iostream>

std::string AwesomeAPI::get_version() const {
    return "v1.0.0-rc1";
}

void AwesomeAPI::internal_setup() {
    // 内部逻辑，对外部使用者不可见
}

void run_computation() {
    std::cout << "Computing on hardware..." << std::endl;
}
```

通过这一套流程，编译生成的动态库中只有 `AwesomeAPI` 的公有成员方法和 `run_computation` 符号是向外暴露的。这不仅保证了良好的二进制兼容性（Application Binary Interface, ABI），也避免了内部辅助符号对外污染，从而提升了程序启动性能并减小了二进制文件的大小。
