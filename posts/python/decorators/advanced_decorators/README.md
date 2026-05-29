# Python 带参数的高阶装饰器与类装饰器

当基础装饰器无法满足传递定制化配置参数的需求时，我们需要编写带参数的“三层嵌套”高阶装饰器，或是使用类（Class）来封装装饰器逻辑。

## 1. 带参数的装饰器

为了能给装饰器传参，我们需要最外层再包裹一个专门接收参数的函数：

```python
def repeat(num_times):
    def decorator_repeat(func):
        def wrapper(*args, **kwargs):
            for _ in range(num_times):
                result = func(*args, **kwargs)
            return result
        return wrapper
    return decorator_repeat

@repeat(num_times=3)
def greet(name):
    print(f"Hello {name}")

greet("Alice") # 会打印 3 次
```

## 2. 类装饰器

利用类的 `__call__` 魔术方法，我们可以像调用函数一样调用类实例，这使得类能够完美用作装饰器，非常适合用来维护一些内部计数器或复杂状态：

```python
class CountCalls:
    def __init__(self, func):
        self.func = func
        self.num_calls = 0

    def __call__(self, *args, **kwargs):
        self.num_calls += 1
        print(f"函数 {self.func.__name__} 已被调用 {self.num_calls} 次")
        return self.func(*args, **kwargs)

@CountCalls
def my_func():
    pass

my_func()
my_func()
```

通过这些进阶语法，你能在 Python 项目中编写出极具扩展性和高度复用性的底层控制模块。