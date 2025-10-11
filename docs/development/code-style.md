# 📝 代码规范

本文档定义了 ML Platform 项目的代码风格和最佳实践。遵循这些规范可以提高代码质量和可维护性。

## 🎯 总体原则

1. **可读性优先** - 代码是写给人看的
2. **保持一致** - 统一的风格
3. **简单明了** - 避免过度设计
4. **有意义的命名** - 见名知意

## 🗂️ Dart 代码规范

### 命名规范

#### 类名 - UpperCamelCase

```dart
// ✅ 好
class AlgorithmVisualizer { }
class UserProfile { }
class BubbleSortAnimation { }

// ❌ 不好
class algorithmVisualizer { }
class user_profile { }
class BUBBLESORT { }
```

#### 文件名 - snake_case

```dart
// ✅ 好
algorithm_visualizer.dart
user_profile.dart
bubble_sort_animation.dart

// ❌ 不好
AlgorithmVisualizer.dart
userProfile.dart
BubbleSort-Animation.dart
```

#### 变量/函数 - lowerCamelCase

```dart
// ✅ 好
String userName = 'John';
int totalCount = 0;
void calculateTotal() { }
Future<void> fetchUserData() async { }

// ❌ 不好
String user_name = 'John';
int TotalCount = 0;
void CalculateTotal() { }
```

#### 常量 - lowerCamelCase

```dart
// ✅ 好
const int maxRetries = 3;
const String apiEndpoint = 'https://api.example.com';
const double pi = 3.14159;

// ❌ 不好
const int MAX_RETRIES = 3;
const String API_ENDPOINT = 'https://api.example.com';
```

#### 私有成员 - 以 _ 开头

```dart
class UserProfile {
  // ✅ 公开成员
  String name;
  int age;
  
  // ✅ 私有成员
  String _password;
  int _userId;
  
  void _validatePassword() { }
}
```

### 注释规范

#### 文档注释 - 使用 ///

```dart
/// 冒泡排序算法的可视化实现
///
/// 提供了动画演示和分步执行功能,帮助理解冒泡排序的工作原理。
///
/// 示例:
/// ```dart
/// final visualizer = BubbleSortVisualizer([3, 1, 4, 1, 5]);
/// await visualizer.start();
/// ```
class BubbleSortVisualizer {
  /// 待排序的数组
  final List<int> array;
  
  /// 创建一个冒泡排序可视化器
  ///
  /// [array] 必须是非空的整数列表
  /// [speed] 动画速度,范围 0.1-10.0
  BubbleSortVisualizer(this.array, {double speed = 1.0});
  
  /// 开始排序动画
  ///
  /// 返回一个 Future,完成时数组已排序
  /// 
  /// 抛出 [StateError] 如果可视化器已在运行
  Future<void> start() async { }
}
```

#### 单行注释 - 使用 //

```dart
// 计算数组的平均值
double average = sum / count;

// TODO: 优化算法性能
// FIXME: 修复边界情况的 bug
// HACK: 临时解决方案,需要重构
```

### 代码格式

#### 行长度

```dart
// ✅ 好 - 单行不超过 80 字符
final String message = 
    'This is a very long message that needs to be '
    'split into multiple lines';

// ✅ 好 - 方法链换行
final result = users
    .where((user) => user.isActive)
    .map((user) => user.name)
    .toList();

// ❌ 不好 - 单行太长
final String message = 'This is a very long message that should really be split into multiple lines for better readability';
```

#### 缩进 - 2 空格

```dart
// ✅ 好
class Example {
  void method() {
    if (condition) {
      doSomething();
    }
  }
}

// ❌ 不好 - 使用 tab 或 4 空格
class Example {
    void method() {
        if (condition) {
            doSomething();
        }
    }
}
```

#### 空行

```dart
// ✅ 好 - 适当使用空行分隔逻辑块
class UserService {
  final FirebaseAuth _auth;
  final Firestore _db;
  
  UserService(this._auth, this._db);
  
  Future<User> login(String email, String password) async {
    // 验证输入
    _validateEmail(email);
    _validatePassword(password);
    
    // 执行登录
    final credential = await _auth.signInWithEmailAndPassword(
      email: email,
      password: password,
    );
    
    // 获取用户数据
    return _fetchUserData(credential.user!.uid);
  }
}
```

### 类型注解

```dart
// ✅ 好 - 明确的类型注解
final String name = 'John';
final List<int> numbers = [1, 2, 3];
final Map<String, dynamic> data = {};

String getUserName() {
  return 'John';
}

// ❌ 不好 - 省略类型(特殊情况除外)
final name = 'John';  // 类型不明确
var numbers = [1, 2, 3];  // 可能是 List<dynamic>
```

### 集合字面量

```dart
// ✅ 好 - 使用字面量
final list = <int>[];
final set = <String>{};
final map = <String, int>{};

// ❌ 不好 - 使用构造函数
final list = List<int>();
final set = Set<String>();
final map = Map<String, int>();
```

### Async/Await

```dart
// ✅ 好 - 使用 async/await
Future<User> fetchUser(String id) async {
  final response = await http.get('/users/$id');
  return User.fromJson(response.data);
}

// ❌ 不好 - 使用 then
Future<User> fetchUser(String id) {
  return http.get('/users/$id').then((response) {
    return User.fromJson(response.data);
  });
}
```

## 🎨 Flutter 代码规范

### Widget 组织

```dart
// ✅ 好 - 清晰的结构
class UserProfilePage extends StatefulWidget {
  final String userId;
  
  const UserProfilePage({
    Key? key,
    required this.userId,
  }) : super(key: key);
  
  @override
  State<UserProfilePage> createState() => _UserProfilePageState();
}

class _UserProfilePageState extends State<UserProfilePage> {
  // 1. 成员变量
  late Future<User> _userFuture;
  
  // 2. 生命周期方法
  @override
  void initState() {
    super.initState();
    _userFuture = _fetchUser();
  }
  
  @override
  void dispose() {
    // 清理资源
    super.dispose();
  }
  
  // 3. build 方法
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _buildAppBar(),
      body: _buildBody(),
    );
  }
  
  // 4. 私有辅助方法
  AppBar _buildAppBar() {
    return AppBar(title: Text('Profile'));
  }
  
  Widget _buildBody() {
    return FutureBuilder<User>(
      future: _userFuture,
      builder: _buildContent,
    );
  }
  
  Widget _buildContent(BuildContext context, AsyncSnapshot<User> snapshot) {
    if (snapshot.hasData) {
      return _buildUserInfo(snapshot.data!);
    }
    return CircularProgressIndicator();
  }
  
  Widget _buildUserInfo(User user) {
    return Column(
      children: [
        Text(user.name),
        Text(user.email),
      ],
    );
  }
  
  // 5. 业务逻辑方法
  Future<User> _fetchUser() async {
    return UserService().getUser(widget.userId);
  }
}
```

### Widget 拆分

```dart
// ✅ 好 - 拆分成小 Widget
class ProfilePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Profile')),
      body: Column(
        children: [
          UserAvatar(),
          UserInfo(),
          UserStats(),
        ],
      ),
    );
  }
}

class UserAvatar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return CircleAvatar(/* ... */);
  }
}

// ❌ 不好 - 全部写在一个 Widget
class ProfilePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Profile')),
      body: Column(
        children: [
          CircleAvatar(/* 很多代码 */),
          Container(/* 很多代码 */),
          Row(/* 很多代码 */),
        ],
      ),
    );
  }
}
```

### const 构造函数

```dart
// ✅ 好 - 尽可能使用 const
const SizedBox(height: 16),
const Divider(),
const Text('Hello'),

// ✅ 好 - 定义 const 构造函数
class MyWidget extends StatelessWidget {
  final String title;
  
  const MyWidget({
    Key? key,
    required this.title,
  }) : super(key: key);
}
```

### Key 的使用

```dart
// ✅ 好 - 在列表中使用 Key
ListView.builder(
  itemCount: items.length,
  itemBuilder: (context, index) {
    final item = items[index];
    return ListTile(
      key: ValueKey(item.id),  // 使用唯一标识
      title: Text(item.name),
    );
  },
)

// ✅ 好 - 在动态 Widget 中使用 Key
if (showDetails)
  DetailsPanel(key: ValueKey('details'))
else
  SummaryPanel(key: ValueKey('summary'))
```

## 📦 项目结构规范

### 目录组织

```
lib/
├── main.dart                    # 应用入口
├── app.dart                     # App 主类
├── config/                      # 配置文件
│   ├── app_router.dart
│   ├── app_theme.dart
│   └── constants.dart
├── models/                      # 数据模型
│   ├── user.dart
│   ├── algorithm.dart
│   └── learning_path.dart
├── screens/                     # 页面
│   ├── home/
│   │   ├── home_screen.dart
│   │   └── widgets/
│   ├── algorithm/
│   └── profile/
├── widgets/                     # 通用组件
│   ├── buttons/
│   ├── cards/
│   └── dialogs/
├── services/                    # 业务服务
│   ├── auth_service.dart
│   ├── database_service.dart
│   └── analytics_service.dart
└── utils/                       # 工具类
    ├── validators.dart
    ├── formatters.dart
    └── extensions.dart
```

### 文件组织

```dart
// ✅ 好 - 一个文件一个类
// user.dart
class User {
  // ...
}

// user_repository.dart
class UserRepository {
  // ...
}

// ❌ 不好 - 一个文件多个不相关的类
// models.dart
class User { }
class Product { }
class Order { }
```

## 🧪 测试规范

### 测试文件命名

```
test/
├── unit/
│   └── services/
│       └── auth_service_test.dart
├── widget/
│   └── screens/
│       └── home_screen_test.dart
└── integration/
    └── user_flow_test.dart
```

### 测试结构

```dart
void main() {
  group('BubbleSort', () {
    late BubbleSort sorter;
    
    setUp(() {
      sorter = BubbleSort();
    });
    
    tearDown(() {
      // 清理
    });
    
    test('should sort empty array', () {
      // Arrange
      final input = <int>[];
      
      // Act
      final result = sorter.sort(input);
      
      // Assert
      expect(result, isEmpty);
    });
    
    test('should sort array with duplicates', () {
      // Arrange
      final input = [3, 1, 4, 1, 5];
      final expected = [1, 1, 3, 4, 5];
      
      // Act
      final result = sorter.sort(input);
      
      // Assert
      expect(result, equals(expected));
    });
  });
}
```

## 🔧 Git 规范

### Commit Message

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型(type)**:
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

**示例**:

```
feat(algorithm): add merge sort visualization

- Implement merge sort algorithm
- Add step-by-step animation
- Include time complexity analysis

Closes #123
```

### 分支命名

```bash
feature/add-merge-sort
bugfix/fix-memory-leak
docs/update-readme
refactor/simplify-auth
```

## 📋 代码检查清单

提交代码前,请确保:

- [ ] 代码已格式化 (`dart format .`)
- [ ] 通过静态分析 (`flutter analyze`)
- [ ] 所有测试通过 (`flutter test`)
- [ ] 添加了必要的注释
- [ ] 更新了相关文档
- [ ] 没有警告或错误
- [ ] 遵循了代码规范

## 🛠️ 工具配置

### analysis_options.yaml

```yaml
include: package:flutter_lints/flutter.yaml

linter:
  rules:
    - always_declare_return_types
    - always_require_non_null_named_parameters
    - avoid_print
    - prefer_const_constructors
    - prefer_const_literals_to_create_immutables
    - sort_child_properties_last
```

### .editorconfig

```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

## 📚 参考资源

- [Effective Dart](https://dart.dev/guides/language/effective-dart)
- [Flutter 代码规范](https://flutter.dev/docs/development/ui/widgets/best-practices)
- [Material Design Guidelines](https://material.io/design)

---

**记住**: 好的代码不仅能运行,更要易读、易维护!
