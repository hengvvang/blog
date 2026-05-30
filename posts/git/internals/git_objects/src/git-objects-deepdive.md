# Git 四大核心对象深度剖析

Git 绝非一个黑盒，它的底层对象数据库极其透明且极具工业美感。在 Git 的世界中，所有的数据（包括文件内容、目录结构、提交记录、发布标签）都存储为**内容寻址对象（Content-Addressable Objects）**。

本章将深入探讨这四大对象（Blob、Tree、Commit、Tag）的物理存储格式、二进制报文协议、SHA-1 计算细节，并最终编写一个纯 Python 脚本，在不依赖 Git 原生命令行工具的情况下直接对 `.git/objects/` 进行读取解析与写入。

---

## 1. 内容寻址存储与 SHA-1 计算机制

在 Git 中，对象的名称是一个 40 位的十六进制字符串（例如：`bd6f9a0c...`），它是对对象内容执行 **SHA-1** 哈希算法生成的校验和（Checksum）。

### 1.1 为什么是“内容寻址”？
在传统文件系统中，我们通过文件的“路径”或“名称”来寻找文件（例如 `C:\Users\doc\notes.txt`）。而在 Git 中，我们只关心文件的**内容**。
*   如果两个完全不同路径下的文件内容一模一样，Git 只会在 `objects/` 目录下存储**一份** Blob 对象。
*   文件路径、文件名以及权限等元数据，由上层的 Tree 对象负责管理，与文件内容本身完全解耦。

### 1.2 SHA-1 校验和的计算公式
Git 在对数据进行 SHA-1 计算时，并不是直接对原始文件字节流做哈希，而是必须在前面拼装一个**标准对象头部（Object Header）**。头部格式为：

$$\text{header} = \text{type} + \text{" "} + \text{size\_in\_bytes} + \text{"\textbackslash 0"}$$

其中：
*   `type`：对象类型，可取值为 `blob`、`tree` , `commit` 或 `tag`。
*   ` `：一个空格字符。
*   `size_in_bytes`：对象实际内容（Payload）的字节长度，用十进制 ASCII 字符串表示。
*   `\0`：即 `0x00`（Null 字符），作为头部结束与内容开始的二进制分隔符。

因此，Git 计算出的 SHA-1 实际为：

$$\text{SHA-1} = \text{SHA-1}(\text{type} + \text{" "} + \text{size} + \text{0x00} + \text{payload})$$

这种设计确保了：
1.  **类型防混淆**：相同内容的文件（Blob）与相同内容的提交信息（Commit）计算出的哈希值截然不同。
2.  **内容完整性**：头部的长度与内容长度必须一致，任何一处发生比特翻转都会彻底改变哈希值。

---

## 2. 四大核心对象的二进制报文格式

接下来，我们依次拆解这四类对象在解压后的实际字节流布局。

### 2.1 Blob 对象：最纯粹的文件内容包裹

Blob（Binary Large Object）是最基础的对象，它只包含文件数据，不包含任何文件名、修改时间或权限信息。

```text
+-----------------------------+------------------------------------+
| blob <size_in_bytes>\0      | <raw file contents>                |
+-----------------------------+------------------------------------+
|<-------- Header ----------->|<----------- Payload -------------->|
```

*   **特点**：纯文本、图片、音视频等任何格式的文件在 Git 看来都是一个 Blob。
*   **重用性**：如果你把文件 `a.txt` 重命名为 `b.txt` 且内容不变，Git 只会增加一个指向原 Blob 哈希的 Tree 记录，而不需要重新存储这个文件。

---

### 2.2 Tree 对象：目录结构的映射

Tree 对象对应文件系统中的**目录**。它记录了当前目录下所有子文件（Blob）和子目录（Tree）的元数据。

#### Tree 对象的 Payload 结构
Tree 对象的 Payload 由一个或多个“记录条目（Directory Entries）”紧密排列组成。**每个条目的结构非常特殊**，采用文本与二进制混合的模式：

```text
[file_mode] [file/directory_name]\0[20-byte binary SHA-1]
```

详细拆解：
1.  **`file_mode`**：文件模式，用八进制 ASCII 字符串表示（非固定长度，如 `100644` 代表普通文件，`100755` 代表可执行文件，`40000` 代表子目录/树，`120000` 代表符号链接）。
2.  **` `**（空格）：分隔符。
3.  **`file/directory_name`**：文件名或目录名。
4.  **`\0`**（Null 字节）：分隔符，表示文件名的结束。
5.  **`20-byte binary SHA-1`**：**注意！** 这里的 SHA-1 哈希值不是我们平时看到的 40 位十六进制字符，而是**原始的 20 字节二进制数据**。这是为了节省空间（1 字节可以表示 2 个十六进制字符）。

#### Tree 对象的内存布局图

```text
+-----------------------------------------------------------------------------------+
| tree <size>\0                                                                     |
+-----------+-----------------+----+------------------------+-----------------------+
| File Mode | Name            | \0 | Binary SHA-1 (20B)     | Next Entry File Mode...
+-----------+-----------------+----+------------------------+-----------------------+
| 100644    | main.c          | 00 | \x1a\xbf\x3c...        | 40000...
+-----------+-----------------+----+------------------------+-----------------------+
```

由于 20 字节二进制 SHA-1 往往包含不可读字符，因此如果直接在终端中 `cat` 一个 Tree 对象文件，屏幕上会出现大量乱码。

---

### 2.3 Commit 对象：版本快照的元数据

Commit 对象记录了某次提交的所有上下文信息。它的格式为纯文本，结构如下：

```text
tree <40-char hex SHA-1 of root tree>
parent <40-char hex SHA-1 of parent commit 1>
parent <40-char hex SHA-1 of parent commit 2> (若为 Merge 提交则有多行)
author <Name> <Email> <unix_timestamp> <timezone_offset>
committer <Name> <Email> <unix_timestamp> <timezone_offset>

<Commit Message>
```

#### 关键字段剖析：
*   **`tree`**：指向该提交所对应项目根目录的 Tree 对象（40 位十六进制）。
*   **`parent`**：指向父提交的哈希。首次提交（Root Commit）没有 parent 行；常规提交有 1 行 parent；合并提交（Merge Commit）会有 2 行或更多 parent 行。
*   **时间戳格式**：采用 Unix 时间戳（自 1970-01-01 以来的秒数）加时区偏移量。例如 `1685412345 +0800`，代表北京时间 2023-05-30 10:05:45。
*   **双空行分隔**：头部元数据与下方的 Commit Message 之间用一个连续的换行符（`\n\n`）进行分隔。

---

### 2.4 Tag 对象：附注标签

Tag 对象用于对某个特定的提交（或其它任意对象）打上一个不可变的“附注标签（Annotated Tag）”。其结构与 Commit 非常相似：

```text
object <40-char hex SHA-1 of target object>
type <commit|tree|blob|tag>
tag <tag_name>
tagger <Name> <Email> <unix_timestamp> <timezone_offset>

<Tag Message>
```

*   **对象指针的泛化**：虽然 99% 的标签都指向一个 `commit` 对象，但从协议层面上，Tag 对象的 `type` 字段可以是 `tree` 或 `blob`，甚至可以让一个 Tag 指向另一个 Tag（嵌套标签）。

---

## 3. 松散对象（Loose Objects）的 zlib 压缩与落盘

为避免磁盘碎片并提升读写吞吐，Git 会在写入对象之前，将经过拼接后的完整字节流使用 **zlib 算法（Deflate 压缩，默认级别为 6）** 进行压缩，然后将其写入物理文件。

例如，一个内容为 "hello world\n" 的文件：
1.  拼接头部：`blob 12\0hello world\n`，长度为 17 字节。
2.  对这 17 字节计算 SHA-1，得到 `3b18e512dba79e4c8300dd08aeb37f8e728b8dad`。
3.  将这 17 字节用 zlib 压缩，得到约 25 字节的压缩数据。
4.  在磁盘上创建 `.git/objects/3b/` 目录，将压缩数据保存为 `18e512dba79e4c8300dd08aeb37f8e728b8dad` 文件。

---

## 4. 实践：Python 纯脚本解析与生成 Git 对象

下面我们将编写一个无需调用任何 `git` 命令行、纯 Python 标准库编写的工具。它能够：
1.  **读取并解析** 任意一个松散对象文件（支持 Blob, Commit, Tree, Tag）。
2.  **手动生成** 一个标准的 Blob 对象并安全写入 `.git/objects/`。

### 4.1 Python 解析器代码 (`git_parser.py`)

将以下代码保存为 `git_parser.py`。

```python
#!/usr/bin/env python3
"""
Git 松散对象解析与构建工具
基于 Python 3 标准库，无外部依赖。
"""

import os
import zlib
import hashlib
import sys

def parse_loose_object(filepath: str):
    """
    读取并解析指定的 Git 松散对象二进制文件
    """
    if not os.path.exists(filepath):
        print(f"[-] 错误: 文件不存在 {filepath}", file=sys.stderr)
        return

    # 1. 读取 zlib 压缩的文件内容
    with open(filepath, 'rb') as f:
        compressed_data = f.read()

    # 2. 解压缩
    try:
        raw_data = zlib.decompress(compressed_data)
    except zlib.error as e:
        print(f"[-] 错误: zlib 解压失败. 可能不是有效的松散对象文件. 原因: {e}", file=sys.stderr)
        return

    # 3. 解析 Header (格式: type size\0)
    null_byte_idx = raw_data.find(b'\0')
    if null_byte_idx == -1:
        print("[-] 错误: 对象报文中未找到 Null 字节分隔符", file=sys.stderr)
        return

    header_bytes = raw_data[:null_byte_idx]
    payload_bytes = raw_data[null_byte_idx + 1:]

    try:
        header_str = header_bytes.decode('utf-8')
        obj_type, obj_size_str = header_str.split(' ')
        obj_size = int(obj_size_str)
    except ValueError:
        print(f"[-] 错误: 无法解析的 Header 格式: {header_bytes}", file=sys.stderr)
        return

    print("=" * 60)
    print(f"[*] 对象类型: {obj_type.upper()}")
    print(f"[*] 数据大小: {obj_size} 字节 (实际 Payload 大小: {len(payload_bytes)} 字节)")
    print("=" * 60)

    # 4. 根据类型进行 Payload 结构化展示
    if obj_type == 'blob':
        print("[Blob 内容预览]:")
        try:
            print(payload_bytes.decode('utf-8'))
        except UnicodeDecodeError:
            # 可能是二进制文件（图片、编译文件等）
            print(f"<二进制数据 - 前 100 字节十六进制: {payload_bytes[:100].hex()}>")

    elif obj_type in ('commit', 'tag'):
        print("[文本元数据与报文]:")
        print(payload_bytes.decode('utf-8'))

    elif obj_type == 'tree':
        print("[Tree 目录项列表]:")
        idx = 0
        while idx < len(payload_bytes):
            # 寻找空格 (file_mode 与 filename 的分隔)
            space_idx = payload_bytes.find(b' ', idx)
            if space_idx == -1:
                break
            file_mode = payload_bytes[idx:space_idx].decode('utf-8')

            # 寻找 \0 (filename 与 20-byte SHA-1 的分隔)
            null_idx = payload_bytes.find(b'\0', space_idx)
            if null_idx == -1:
                break
            filename = payload_bytes[space_idx + 1:null_idx].decode('utf-8')

            # 读取 20 字节的二进制 SHA-1
            sha_binary = payload_bytes[null_idx + 1: null_idx + 21]
            sha_hex = sha_binary.hex()

            print(f"  Mode: {file_mode:<6} | Name: {filename:<20} | SHA-1: {sha_hex}")
            idx = null_idx + 21


def create_git_blob(content_str: str, repo_root: str = "."):
    """
    手动封装一个 Blob 对象，计算 SHA-1，对其进行 zlib 压缩并存盘，返回 40 位哈希。
    """
    payload = content_str.encode('utf-8')
    size = len(payload)

    # 构建头部
    header = f"blob {size}\0".encode('utf-8')
    full_data = header + payload

    # 计算 SHA-1 作为对象名
    sha1_hash = hashlib.sha1(full_data).hexdigest()

    # zlib 压缩
    compressed = zlib.compress(full_data)

    # 计算目标路径 (.git/objects/xx/xxxxxxxxxxxx)
    dir_name = sha1_hash[:2]
    file_name = sha1_hash[2:]
    target_dir = os.path.join(repo_root, ".git", "objects", dir_name)
    target_file = os.path.join(target_dir, file_name)

    # 写入文件系统
    os.makedirs(target_dir, exist_ok=True)
    with open(target_file, 'wb') as f:
        f.write(compressed)

    print(f"[+] 成功生成松散 Blob 对象!")
    print(f"    哈希值: {sha1_hash}")
    print(f"    写入路径: {target_file}")
    return sha1_hash


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("使用说明:")
        print("  解析对象: python git_parser.py parse <path_to_loose_file>")
        print("  生成 Blob: python git_parser.py write <text_content>")
        sys.exit(1)

    action = sys.argv[1].lower()
    if action == "parse":
        parse_loose_object(sys.argv[2])
    elif action == "write":
        create_git_blob(sys.argv[2])
    else:
        print(f"[-] 未知动作: {action}", file=sys.stderr)
        sys.exit(1)
```

---

### 4.2 验证我们的 Python 脚本

让我们在一个 Git 仓库中测试这个脚本：

#### 步骤一：使用脚本手动写入一个 Blob
```bash
# 在之前创建的 git-internals-demo 仓库中运行
python git_parser.py write "Hello, this is a custom raw object!"
```
输出：
```text
[+] 成功生成松散 Blob 对象!
    哈希值: d7f06536cf2a2559b152d80d2cf93ebdfef5520e
    写入路径: ./.git/objects/d7/f06536cf2a2559b152d80d2cf93ebdfef5520e
```

#### 步骤二：使用原生 Git 命令检查我们写入的 Blob
```bash
# 使用 Git 原生底层命令检查该哈希的类型
git cat-file -t d7f06536cf2a2559b152d80d2cf93ebdfef5520e
# 输出: blob

# 读取该哈希的内容
git cat-file -p d7f06536cf2a2559b152d80d2cf93ebdfef5520e
# 输出: Hello, this is a custom raw object!
```
这证明我们绕过了 `git add`，成功纯手工向 Git 对象数据库中插入了一个合法的 Blob！

#### 步骤三：使用脚本解析一个由 Git 原生生成的 Tree 对象
我们在仓库中做一次正式的提交：
```bash
git add file.txt
git commit -m "Commit for tree test"
```
使用 `git log` 获取刚刚生成的提交中对应的 Tree 对象的哈希值（可以通过 `git cat-file -p HEAD` 查看 Tree 哈希）。
假设 Tree 的哈希为 `8c3b2f...`，那么它在文件系统中的路径为：
`.git/objects/8c/3b2f...`

运行我们的脚本来解析它：
```bash
python git_parser.py parse .git/objects/8c/3b2f... (补全哈希剩余部分)
```
输出：
```text
============================================================
[*] 对象类型: TREE
[*] 数据大小: 37 字节 (实际 Payload 大小: 37 字节)
============================================================
[Tree 目录项列表]:
  Mode: 100644 | Name: file.txt            | SHA-1: a1b2c3d...
```

通过这一章的细致研究，我们已经掌握了 Git 对象的物理面貌。在下一章中，我们将进一步释放底层命令（Plumbing）的威力，完全手动模拟一次真实的提交流程。
