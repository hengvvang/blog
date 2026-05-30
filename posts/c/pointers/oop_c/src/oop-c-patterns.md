# 第二章：C 语言面向对象（OOP-C）设计模式

尽管 C 语言是一门面向过程的结构化编程语言，但其强大的指针机制与灵活的结构体定义赋予了它极强的表现力。通过精心设计的模式，我们完全可以在 C 语言中实现面向对象的三大核心要素：**封装**、**继承**和**多态**。

---

## 1. 封装（Encapsulation）与不透明指针（Opaque Pointers）

封装的本质是“信息隐藏”，即将对象的内部数据结构和私有状态保护起来，只允许通过预先定义的公共接口进行访问和修改。这有助于减少系统各个模块之间的耦合度。

### 1.1 前置声明与接口隔离

在 C 语言中，最彻底的封装手段是使用**不透明指针（Opaque Pointers）**，也常被称为 **Pimpl（Pointer to Implementation）** 模式。

基本原理如下：
1. 在公共头文件（`.h`）中，我们仅提供结构体类型的**前置声明（Forward Declaration）**，而不给出其具体字段定义。此时对于调用者而言，该结构体是一个**不完整类型（Incomplete Type）**。
2. 调用者无法得知该结构体的大小，无法直接声明该结构体的栈变量，也无法通过 `.` 或 `->` 访问其成员。调用者只能声明指向该结构体的指针。
3. 结构体的具体字段定义被完全隐藏在实现文件（`.c`）中。

```mermaid
graph TD
    subgraph Public Interface (socket.h)
        A["typedef struct socket_t socket_t; (前置声明)"]
        B["socket_t* socket_create(void);"]
        C["int socket_connect(socket_t *self, const char *ip);"]
    end
    subgraph Private Implementation (socket.c)
        D["struct socket_t { int fd; int state; char ip[16]; }; (具体定义)"]
        E["socket_create() { malloc(sizeof(struct socket_t)); }"]
    end
    Public_User -->|只能使用指针| A
    Public_User -->|调用公开 API| B
    Public_User -->|调用公开 API| C
    B --> D
    C --> D
```

### 1.2 生产级封装代码实现

下面是一个工业级的网络套接字（Socket）模块示例。

#### 接口定义：`socket.h`
```c
#ifndef SOCKET_H
#define SOCKET_H

#include <stddef.h>
#include <stdbool.h>

/* 1. 声明不完整类型 socket_t */
typedef struct socket_t socket_t;

/* 2. 导出公共生命周期管理接口 */
socket_t* socket_create(void);
void socket_destroy(socket_t **self);

/* 3. 导出公共操作接口 */
bool socket_connect(socket_t *self, const char *ip, int port);
void socket_disconnect(socket_t *self);
int socket_send(socket_t *self, const char *data, size_t len);

#endif /* SOCKET_H */
```

#### 私有实现：`socket.c`
```c
#include "socket.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* 1. 在实现文件中定义具体的结构体内容 */
struct socket_t {
    int fd;                 // 模拟系统文件描述符
    char ip[16];            // 连接的 IP 地址
    int port;               // 连接的端口号
    bool is_connected;      // 连接状态
};

/* 2. 实现构造函数：负责在堆上分配内存 */
socket_t* socket_create(void) {
    socket_t *self = (socket_t *)malloc(sizeof(struct socket_t));
    if (!self) {
        perror("Failed to allocate socket_t");
        return NULL;
    }
    // 初始化私有字段
    self->fd = -1;
    memset(self->ip, 0, sizeof(self->ip));
    self->port = 0;
    self->is_connected = false;
    return self;
}

/* 3. 实现析构函数：负责释放内存并对指针清零，避免悬空指针 */
void socket_destroy(socket_t **self) {
    if (self && *self) {
        // 关闭可能依然打开的连接
        if ((*self)->is_connected) {
            socket_disconnect(*self);
        }
        free(*self);
        *self = NULL; // 破坏调用者的指针变量
    }
}

/* 4. 成员方法的实现：直接访问私有数据 */
bool socket_connect(socket_t *self, const char *ip, int port) {
    if (!self || !ip) return false;
    
    // 模拟底层的连接过程
    self->fd = 10; // 模拟系统分配的文件描述符
    strncpy(self->ip, ip, sizeof(self->ip) - 1);
    self->port = port;
    self->is_connected = true;
    
    printf("[Socket] Connected to %s:%d (fd=%d)\n", self->ip, self->port, self->fd);
    return true;
}

void socket_disconnect(socket_t *self) {
    if (!self || !self->is_connected) return;
    
    printf("[Socket] Disconnected from %s:%d (fd=%d)\n", self->ip, self->port, self->fd);
    self->fd = -1;
    self->is_connected = false;
}

int socket_send(socket_t *self, const char *data, size_t len) {
    if (!self || !self->is_connected || !data) return -1;
    
    printf("[Socket] Sending %zu bytes: %s\n", len, data);
    return (int)len;
}
```

> [!NOTE]
> 使用不透明指针后，任何对私有字段的修改（例如在 `socket_t` 中添加一个新的 `timeout` 字段）都不会改变 `socket.h` 头文件的内容。这意味着，**依赖该头文件的调用者代码无需重新编译**，这极大地缩短了大型 C 项目的编译链条。

---

## 2. 继承（Inheritance）与结构体嵌套（Struct Nesting）

继承允许我们基于一个已存在的类（基类）来定义一个新类（子类），从而复用基类的代码和属性。在 C 语言中，继承是通过**结构体嵌套（Struct Nesting）**来实现的。

### 2.1 内存对齐与布局

为了在 C 语言中安全地实现继承，**子类结构体的第一个成员必须是基类结构体**。

C 语言标准（ISO/IEC 9899）明确保证了以下两点：
1. 结构体变量的首地址与其第一个成员变量的首地址是完全相同的。不存在前导填充字节。
2. 指向结构体的指针在强制类型转换后，可以安全地转换为指向其第一个成员的指针。

这意味着，如果我们把基类结构体作为子类结构体的第一个字段，子类在内存中的布局就会天然地将基类的数据放在起始部分。

```
子类（Child Struct）内存布局：
+------------------------------------------+
|  +------------------------------------+  |
|  |           基类成员 (Parent)        |  |  <--- 结构体起始地址
|  |           - int x                  |  |       (Parent* 与 Child* 地址重合)
|  |           - int y                  |  |
|  +------------------------------------+  |
|  子类特有成员 (Child Private)            |
|  - int radius                            |
+------------------------------------------+
```

由于这种内存布局的对称性，我们可以非常安全地将子类指针 `Child *` 强制类型转换为基类指针 `Parent *`。这一操作在面向对象中称为**向上转型（Upcasting）**。

### 2.2 生产级继承代码实现

下面我们实现一个基础的二维几何图形继承体系：`shape_t` 是基类，`circle_t` 是派生出的子类。

```c
#include <stdio.h>
#include <stdlib.h>

/* ================= 基类定义 ================= */
typedef struct {
    int x;
    int y;
} shape_t;

/* 基类构造函数 */
void shape_init(shape_t *self, int x, int y) {
    if (self) {
        self->x = x;
        self->y = y;
    }
}

/* 基类方法 */
void shape_move(shape_t *self, int dx, int dy) {
    if (self) {
        self->x += dx;
        self->y += dy;
        printf("Shape moved to (%d, %d)\n", self->x, self->y);
    }
}

/* ================= 子类定义 ================= */
typedef struct {
    shape_t super;  /* 必须作为第一个成员！用于保存基类数据结构 */
    int radius;     /* 子类特有属性 */
} circle_t;

/* 子类构造函数 */
circle_t* circle_create(int x, int y, int radius) {
    circle_t *self = (circle_t *)malloc(sizeof(circle_t));
    if (!self) return NULL;
    
    // 初始化基类部分
    shape_init(&self->super, x, y);
    // 初始化子类部分
    self->radius = radius;
    return self;
}

void circle_destroy(circle_t **self) {
    if (self && *self) {
        free(*self);
        *self = NULL;
    }
}

/* 子类特有方法 */
void circle_print_info(const circle_t *self) {
    if (self) {
        // 子类可以通过 .super 显式访问基类成员
        printf("Circle at (%d, %d), radius = %d\n", self->super.x, self->super.y, self->radius);
    }
}

int main(void) {
    circle_t *my_circle = circle_create(10, 20, 5);
    if (!my_circle) return 1;

    circle_print_info(my_circle);

    /* 向上转型（Upcasting）：子类指针转换为基类指针 */
    // 强制转换为 shape_t* 是安全的，因为 super 位于首部
    shape_t *base_shape = (shape_t *)my_circle;

    // 直接调用基类方法
    shape_move(base_shape, 5, -10);

    // 再次打印子类信息以验证基类状态被同步修改
    circle_print_info(my_circle);

    circle_destroy(&my_circle);
    return 0;
}
```

> [!WARNING]
> 向上转型是绝对安全的，但**向下转型（Downcasting，即将基类指针强制转换为子类指针）是不安全且极度危险的**。在强制转换之前，程序必须有某种机制（如类型标记枚举 `type_tag`）来确保被转换的基类指针确实指向一个子类实例。

---

## 3. 多态（Polymorphism）与虚函数表（vtable）

多态是面向对象编程的灵魂。它允许将子类类型的指针赋值给父类类型的指针，并在运行时根据具体的子类类型调用正确的成员函数。这一特性在 C 语言中通常通过手动构建**虚函数表（Virtual Table，简称 vtable）**来实现。

### 3.1 虚函数表的底层原理与 vptr 机制

在 C++ 中，如果类包含虚函数，编译器会自动为该类生成一个全局唯一的虚函数表（`vtable`），并在每个对象实例的首部插入一个指向该表的虚表指针（`vptr`）。
在 C 语言中，我们需要手动复现这一过程：

1. **定义虚函数表结构体**：包含一组函数指针，对应所有的多态方法。
2. **在基类结构体中定义一个虚表指针**：作为基类的第一个成员。
3. **全局唯一的虚表实例**：为每个类定义一个全局静态的虚函数表，并在其中填入该类具体实现的方法指针。
4. **绑定指针**：在子类实例化（构造函数）时，将基类部分的虚表指针指向该子类的全局静态虚表。

```
对象实例 (circle_t)                       全局共享虚函数表 (vtable)
+-------------------------+              +------------------------------+
| vptr (指向虚函数表) ------+------------> | - speak  --> circle_speak()  |
+-------------------------+              | - area   --> circle_area()   |
| super.x                 |              +------------------------------+
| super.y                 |
| radius                  |
+-------------------------+
```

### 3.2 生产级多态代码实现

下面我们实现一个多媒体播放器接口 `media_player_t`。它是一个抽象基类，拥有 `play` 和 `stop` 两个多态接口，并由 `audio_player_t` 和 `video_player_t` 两个具体子类进行实例化。

#### 1. 定义抽象基类及虚函数表

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* 前置声明 */
typedef struct media_player_t media_player_t;

/* 定义虚函数表结构体：包含所有虚函数指针 */
typedef struct {
    void (*play)(media_player_t *self);
    void (*stop)(media_player_t *self);
} media_player_vtable_t;

/* 定义抽象基类 */
struct media_player_t {
    const media_player_vtable_t *vptr; /* 必须是第一个成员！指向虚表 */
    char name[64];                     /* 基类公共字段 */
};

/* 基类提供统一的公共接口 */
void media_player_play(media_player_t *self) {
    if (self && self->vptr && self->vptr->play) {
        self->vptr->play(self); // 动态绑定：通过虚表派发调用
    }
}

void media_player_stop(media_player_t *self) {
    if (self && self->vptr && self->vptr->stop) {
        self->vptr->stop(self); // 动态绑定
    }
}
```

#### 2. 实现具体的子类：音频播放器（AudioPlayer）

```c
/* 音频播放器结构体 */
typedef struct {
    media_player_t super;  /* 继承自基类 */
    int sample_rate;       /* 音频特有属性 */
} audio_player_t;

/* 子类重写的具体虚函数实现 */
static void audio_play(media_player_t *self) {
    // 强制转换为子类指针以访问其特有属性
    audio_player_t *audio = (audio_player_t *)self;
    printf("[AudioPlayer '%s'] Playing audio. Sample Rate: %d Hz\n", 
           self->name, audio->sample_rate);
}

static void audio_stop(media_player_t *self) {
    printf("[AudioPlayer '%s'] Audio playback stopped\n", self->name);
}

/* 全局静态的音频播放器虚函数表 */
static const media_player_vtable_t audio_vtable = {
    .play = audio_play,
    .stop = audio_stop
};

/* 构造函数 */
audio_player_t* audio_player_create(const char *name, int sample_rate) {
    audio_player_t *self = (audio_player_t *)malloc(sizeof(audio_player_t));
    if (!self) return NULL;
    
    // 初始化基类公共字段
    strncpy(self->super.name, name, sizeof(self->super.name) - 1);
    
    // 绑定虚表指针为音频播放器的专属虚表
    self->super.vptr = &audio_vtable;
    
    // 初始化子类私有属性
    self->sample_rate = sample_rate;
    return self;
}
```

#### 3. 实现另一个具体的子类：视频播放器（VideoPlayer）

```c
/* 视频播放器结构体 */
typedef struct {
    media_player_t super;
    int width;
    int height;
} video_player_t;

/* 子类重写的虚函数实现 */
static void video_play(media_player_t *self) {
    video_player_t *video = (video_player_t *)self;
    printf("[VideoPlayer '%s'] Rendering video frame. Resolution: %dx%d\n", 
           self->name, video->width, video->height);
}

static void video_stop(media_player_t *self) {
    printf("[VideoPlayer '%s'] Video playback stopped\n", self->name);
}

/* 全局静态的视频播放器虚函数表 */
static const media_player_vtable_t video_vtable = {
    .play = video_play,
    .stop = video_stop
};

/* 构造函数 */
video_player_t* video_player_create(const char *name, int width, int height) {
    video_player_t *self = (video_player_t *)malloc(sizeof(video_player_t));
    if (!self) return NULL;
    
    strncpy(self->super.name, name, sizeof(self->super.name) - 1);
    self->super.vptr = &video_vtable; // 绑定视频播放器专属虚表
    
    self->width = width;
    self->height = height;
    return self;
}
```

#### 4. 客户端调用：展示运行时的动态绑定多态性

```c
int main(void) {
    // 实例化不同的子类
    audio_player_t *my_audio = audio_player_create("Hi-Res Audio", 96000);
    video_player_t *my_video = video_player_create("4K Movie", 3840, 2160);

    /* 声明一个抽象基类指针数组，用于保存各种不同类型的子类实例 */
    media_player_t *playlist[2];
    playlist[0] = (media_player_t *)my_audio; // 向上转型
    playlist[1] = (media_player_t *)my_video; // 向上转型

    printf("--- Playlist Polimorphic Playback ---\n");
    for (int i = 0; i < 2; ++i) {
        // 调用统一的基类接口，底层会利用 vptr 自动跳转到对应的子类重写函数
        media_player_play(playlist[i]);
    }

    printf("\n--- Playlist Polimorphic Stop ---\n");
    for (int i = 0; i < 2; ++i) {
        media_player_stop(playlist[i]);
    }

    // 释放资源
    free(my_audio);
    free(my_video);

    return 0;
}
```

### 3.3 手动 vtable 的优劣势分析

**优势**：
1. **完全可控**：虚表分配与跳转时机非常清晰，无隐式性能损耗，易于在汇编和仿真层精确测量调用开销。
2. **极佳的解耦性**：模块间调用通过抽象虚接口进行，极易实现单元测试（Unit Test）中的 Mock 注入。

**劣势**：
1. **样板代码（Boilerplate Code）较多**：每次新增派生类，均需要手动编写构造函数、重写虚函数并静态初始化虚表结构体。
2. **类型不安全**：强制类型转换（向上/向下转型）缺乏编译器原生支持，如果类型强转错误，编译器无法在编译期给出警告。
