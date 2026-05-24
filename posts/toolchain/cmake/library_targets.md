---
title: "CMake 生成静态库与动态库目标规范管理"
publishTime: "2026-05-24 17:00"
author: "hengvvang"
description: "现代 CMake 的核心思想是基于目标（Target-based）的架构。不要使用全局的命令，而应该把每个编译产物定义为一个独立 Target。"
---

# CMake 生成静态库与动态库目标规范管理

现代 CMake 的核心思想是**基于目标（Target-based）的架构**。不要使用全局的命令，而应该把每个编译产物定义为一个独立 Target。

## 定义一个静态库目标

```cmake
# 引入源文件创建名为 my_math 的静态库
add_library(my_math STATIC src/add.c src/sub.c)

# 显式说明头文件搜索路径（PUBLIC 表示链接它的目标也能继承这一包含路径）
target_include_directories(my_math PUBLIC include/)
```

## 定义一个动态库目标

```cmake
# 在不同系统下创建 .so 或 .dll 动态库
add_library(my_utils SHARED src/utils.c)
```

## 规范的链接依赖管理

```cmake
add_executable(my_app main.c)

# 声明链接关系，自动继承头文件包含关系
target_link_libraries(my_app PRIVATE my_math)
```

利用 Target 封装，我们可以将项目分解为多个小型高內聚的静态/动态库，大大提升中大型软件的可维护性。