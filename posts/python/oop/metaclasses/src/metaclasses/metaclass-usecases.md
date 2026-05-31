# 第三章：子类契约验证与类注册器模式实战

元类在实际开发中虽然不需要高频编写，但在设计底层框架、中间件或开发企业级工具库时，它们能提供极强的生命周期钩子和抽象能力。

本章将通过三个工业级实战场景，展示如何利用元类实现**子类自动注册器**、**声明式字段校验框架（ORM 核心模型）**以及**代码规范与 API 契约审计**。

---

## 3.1 实战一：子类自动注册器（Registry Pattern）

在构建插件式系统、多协议处理器（如不同消息队列的 Driver）或 Web 路由分发器时，通常需要将各个具体实现类注册到一个全局映射表中。

如果依赖开发人员手动调用 `register()` 函数，很容易产生遗漏。通过元类，我们可以在子类被定义（即被 `import` 载入内存）的那一刻，**全自动、无侵入**地完成注册。

### 3.1.1 驱动注册表映射拓扑关系 (ASCII Map)

```
                            +--------------------------------+
                            |        DRIVER_REGISTRY         |
                            |  (全局驱动与实现类映射注册表)   |
                            +--------------------------------+
                               /            |             \
                              /             |              \
                   "mysql"   /    "postgres"|       "redis" \
                            v               v                v
                 +---------------+  +---------------+  +---------------+
                 |  MySQLDriver  |  |PostgresDriver |  |  RedisDriver  |
                 |  Class Object |  |  Class Object |  |  Class Object |
                 +---------------+  +---------------+  +---------------+
```

### 3.1.2 工业级自动注册器实现

```python
# 全局驱动注册表，用于存放驱动名到驱动类的映射
DRIVER_REGISTRY = {}


class DriverMeta(type):
    """
    自动注册驱动的元类。
    只有具体的子类会被注册，抽象基类（带有 is_abstract=True 参数的类）不进行注册。
    """
    def __new__(mcs, name, bases, attrs, **kwargs):
        # 1. 物理创建类对象
        cls = super().__new__(mcs, name, bases, attrs)
        
        # 2. 从类声明参数中读取是否为抽象类的标识
        is_abstract = kwargs.get("is_abstract", False)
        
        # 3. 拦截具体子类并注册
        if not is_abstract:
            # 默认使用类名的小写形式，或者显式定义的 driver_name 属性作为键
            driver_name = getattr(cls, "driver_name", name.lower())
            
            # 校验重复注册，防止名称冲突
            if driver_name in DRIVER_REGISTRY:
                raise ValueError(f"驱动冲突：名称 '{driver_name}' 已被 {DRIVER_REGISTRY[driver_name]} 占用！")
            
            DRIVER_REGISTRY[driver_name] = cls
            print(f"[DriverRegistry] 成功注册驱动: {driver_name} -> {cls.__name__}")
            
        return cls

    def __init__(cls, name, bases, attrs, **kwargs):
        # 重写 __init__ 以支持带有自定义参数的 class 声明
        super().__init__(name, bases, attrs)


# 声明抽象基类，指定 is_abstract=True 避免基类本身被注册到全局字典中
class BaseDriver(metaclass=DriverMeta, is_abstract=True):
    def connect(self):
        """定义连接接口"""
        raise NotImplementedError
    
    def send(self, data):
        """定义数据发送接口"""
        raise NotImplementedError


# --- 以下为具体驱动实现（分布在系统的各个独立模块中，只要导入就会自动触发注册） ---

class MySQLDriver(BaseDriver):
    driver_name = "mysql"
    
    def connect(self):
        return "Connected to MySQL database."
        
    def send(self, data):
        return f"Writing to MySQL: {data}"


class PostgresDriver(BaseDriver):
    driver_name = "postgres"
    
    def connect(self):
        return "Connected to PostgreSQL database."
        
    def send(self, data):
        return f"Writing to PostgreSQL: {data}"


class RedisDriver(BaseDriver):
    driver_name = "redis"
    
    def connect(self):
        return "Connected to Redis cache."
        
    def send(self, data):
        return f"Caching in Redis: {data}"


# --- 外部调用逻辑 ---
if __name__ == "__main__":
    print("\n--- 驱动加载完成，当前注册表内容： ---")
    for name, driver_cls in DRIVER_REGISTRY.items():
        print(f"[{name}] -> {driver_cls.__name__}")

    # 根据配置动态实例化驱动进行调用
    active_driver_name = "postgres"
    driver_class = DRIVER_REGISTRY.get(active_driver_name)
    if driver_class:
        driver = driver_class()
        print(f"\n[运行状态] 连接响应: {driver.connect()}")
        print(f"[运行状态] 发送响应: {driver.send({'user': 'admin'})}")
```

---

## 3.2 实战二：声明式字段校验框架（ORM 与描述符协同）

像 Django ORM、SQLAlchemy 或 Pydantic 这样的流行框架，允许我们用声明式的语法定义数据模型。例如：

```python
class User(Model):
    age = IntegerField(min_value=0, max_value=120)
```

这种开发模式之所以能工作，是因为**元类**与**描述符（Descriptors）**的强强联合：
1. **描述符**负责控制单个属性的读取、设置与校验逻辑（`__get__` 和 `__set__`）。
2. **元类**在类定义期扫描所有属性，找出所有描述符，自动为描述符注入字段名称（避免开发者重复书写 `age = IntegerField(name="age")`），并构建字段元数据字典。

### 3.2.1 描述符赋值与校验的生命周期 (ASCII Sequence)

当我们在模型实例上执行属性赋值时，其内部调用链路如下所示：

```
 [用户代码]                    [实例属性描述符 (Field)]                 [实例 __dict__ 容器]
     |                                   |                                     |
     |---- 1. user.age = 28 ------------>|                                     |
     |                                   |--- 2. 调用 validate(28) 校验 ------>|
     |                                   |       (验证通过)                    |
     |                                   |                                     |
     |                                   |--- 3. 写入属性 -------------------->|
     |                                   |       instance.__dict__["age"] = 28 |
     |                                   |<-- 4. 写入成功 ---------------------|
     |<--- 5. 赋值完成 ------------------|                                     |
```

### 3.2.2 工业级模型与校验器代码实现

```python
class ValidationError(Exception):
    """字段验证错误异常"""
    pass


class Field:
    """描述符基类：代表模型中的一个数据字段"""
    def __init__(self, required=True, default=None):
        self.required = required
        self.default = default
        # name 属性将由 ModelMeta 元类在定义期自动注入
        self.name = None

    def __set_name__(self, owner, name):
        # 兼容 Python 3.6+ 内置的自动命名钩子
        self.name = name

    def __get__(self, instance, owner):
        if instance is None:
            return self
        return instance.__dict__.get(self.name, self.default)

    def __set__(self, instance, value):
        if value is None:
            if self.required:
                raise ValidationError(f"字段 '{self.name}' 是必填项，不能为 None")
            instance.__dict__[self.name] = self.default
        else:
            # 触发各子类字段独特的校验逻辑
            self.validate(value)
            instance.__dict__[self.name] = value

    def validate(self, value):
        """子类必须覆盖此方法以实现具体的校验逻辑"""
        pass


class StringField(Field):
    def __init__(self, max_length=None, **kwargs):
        super().__init__(**kwargs)
        self.max_length = max_length

    def validate(self, value):
        if not isinstance(value, str):
            raise ValidationError(f"字段 '{self.name}' 必须为字符串类型 (str)，传入值为 {type(value)}")
        if self.max_length and len(value) > self.max_length:
            raise ValidationError(f"字段 '{self.name}' 长度不能超过 {self.max_length} 个字符")


class IntegerField(Field):
    def __init__(self, min_value=None, max_value=None, **kwargs):
        super().__init__(**kwargs)
        self.min_value = min_value
        self.max_value = max_value

    def validate(self, value):
        # 注意：bool 在 Python 中是 int 的子类，这里需要显式排除
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValidationError(f"字段 '{self.name}' 必须为整数类型 (int)")
        if self.min_value is not None and value < self.min_value:
            raise ValidationError(f"字段 '{self.name}' 的值不能小于 {self.min_value}")
        if self.max_value is not None and value > self.max_value:
            raise ValidationError(f"字段 '{self.name}' 的值不能大于 {self.max_value}")


# --- 模型元类 ---
class ModelMeta(type):
    def __new__(mcs, name, bases, attrs):
        # 1. 提取所有继承自 Field 的字段
        fields = {}
        for key, value in list(attrs.items()):
            if isinstance(value, Field):
                # 自动为描述符字段注入属性名称
                value.name = key
                fields[key] = value
                # 从原始类属性中移除，避免污染类实例字典
                # 数据将实际存储在实例的 __dict__ 中
        
        # 2. 将提取到的字段字典绑定到元数据中，便于后续反射
        attrs["_fields"] = fields
        
        # 3. 创建并返回类对象
        return super().__new__(mcs, name, bases, attrs)


# --- 声明式模型基类 ---
class Model(metaclass=ModelMeta):
    def __init__(self, **kwargs):
        # 批量初始化属性并调用描述符的校验逻辑
        for field_name, field_obj in self._fields.items():
            value = kwargs.get(field_name, field_obj.default)
            # 通过 setattr 触发描述符的 __set__ 机制进行属性绑定与数据验证
            setattr(self, field_name, value)

    def to_dict(self):
        """将模型对象序列化为普通的字典"""
        return {name: getattr(self, name) for name in self._fields}


# --- 用户自定义的数据模型 ---
class UserProfile(Model):
    username = StringField(max_length=20, required=True)
    age = IntegerField(min_value=18, max_value=150, default=18)
    score = IntegerField(min_value=0, required=False, default=0)


# --- 验证模型运作 ---
if __name__ == "__main__":
    print("\n--- 实例化合法用户模型 ---")
    user = UserProfile(username="hengvvang", age=28, score=100)
    print(f"数据字典: {user.to_dict()}")

    print("\n--- 测试校验触发错误一：类型不匹配 ---")
    try:
        # age 传入了字符串类型
        invalid_user = UserProfile(username="alex", age="twenty")
    except ValidationError as e:
        print(f"捕捉到验证异常: {e}")

    print("\n--- 测试校验触发错误二：超出范围限制 ---")
    try:
        # 年龄小于下限 18
        invalid_user2 = UserProfile(username="bob", age=16)
    except ValidationError as e:
        print(f"捕捉到验证异常: {e}")
