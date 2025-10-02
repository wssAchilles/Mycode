import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

// 导入服务
import 'services/filebase_service.dart';
import 'services/auth_service.dart';
import 'services/chat_service.dart';
import 'services/websocket_service.dart';
import 'services/notification_service.dart';
import 'services/friend_service.dart';
import 'services/emoji_service.dart';

// 导入页面
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/chat/chat_list_screen.dart';
import 'screens/chat/chat_detail_screen.dart';
import 'screens/profile/profile_screen.dart';
import 'screens/friends/friends_list_screen.dart';
import 'screens/friends/add_friend_screen.dart';
import 'screens/friends/friend_request_screen.dart';
import 'screens/group/create_group_screen.dart';
import 'screens/group/group_info_screen.dart';
import 'screens/chat/group_chat_detail_screen.dart';
import 'screens/profile/emoji_manager_screen.dart';
import 'services/group_service.dart';

// 全局导航键，用于通知导航
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

// WebSocket服务器URL
const String websocketServerUrl = 'http://localhost:3000';
void main() async {
  // 确保Flutter初始化
  WidgetsFlutterBinding.ensureInitialized();
  
  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    // 创建 Filebase 服务实例
    final filebaseService = FilebaseService();
    
    // 创建认证服务实例
    final authService = AuthService(filebaseService);
    
    // 创建聊天服务实例
    final chatService = ChatService(filebaseService, authService);
    
    // 创建通知服务实例
    final notificationService = NotificationService(authService);
    
    // 创建好友服务实例
    final friendService = FriendService(filebaseService, null); // Pass null for WebSocketService for now
    
    // 创建WebSocket服务实例
    final websocketService = WebSocketService(
      authService, 
      chatService,
      notificationService,
      serverUrl: websocketServerUrl
    );
    
    // 设置ChatService的WebSocketService
    chatService.setWebSocketService(websocketService);
    
    // 设置FriendService的WebSocketService
    websocketService.setFriendService(friendService);
    
    // 创建群组服务实例
    final groupService = GroupService(filebaseService, authService, websocketService);
    
    // 创建表情包服务实例
    final emojiService = EmojiService(filebaseService);
    
    return MultiProvider(
      providers: [
        // 注册 Filebase 服务
        Provider<FilebaseService>.value(value: filebaseService),
        
        // 注册认证服务
        ChangeNotifierProvider<AuthService>.value(value: authService),
        
        // 注册聊天服务
        ChangeNotifierProvider<ChatService>.value(value: chatService),
        
        // 注册WebSocket服务
        ChangeNotifierProvider<WebSocketService>.value(value: websocketService),
        
        // 注册通知服务
        Provider<NotificationService>.value(value: notificationService),
        
        // 注册好友服务
        Provider<FriendService>.value(value: friendService),
        
        // 注册群组服务
        ChangeNotifierProvider<GroupService>.value(value: groupService),
        
        // 注册表情包服务
        ChangeNotifierProvider<EmojiService>.value(value: emojiService),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: '微聊',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: Color(0xFF07C160), // 微信绿
            brightness: Brightness.light,
            primary: Color(0xFF07C160),
            secondary: Color(0xFF2591F8), // 轻蓝色连接元素
            tertiary: Color(0xFFF6F6F6), // 浅灰背景
            surface: Colors.white,
            background: Color(0xFFF6F6F6),
          ),
          useMaterial3: true,
          visualDensity: VisualDensity.adaptivePlatformDensity,
          fontFamily: 'PingFang SC',  // 类微信字体
          elevatedButtonTheme: ElevatedButtonThemeData(
            style: ElevatedButton.styleFrom(
              backgroundColor: Color(0xFF07C160),
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
              minimumSize: Size(88, 44),
            ),
          ),
          outlinedButtonTheme: OutlinedButtonThemeData(
            style: OutlinedButton.styleFrom(
              foregroundColor: Color(0xFF07C160),
              side: BorderSide(color: Color(0xFF07C160)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
              minimumSize: Size(88, 44),
            ),
          ),
          textButtonTheme: TextButtonThemeData(
            style: TextButton.styleFrom(
              foregroundColor: Color(0xFF07C160),
            ),
          ),
          appBarTheme: AppBarTheme(
            backgroundColor: Colors.white,
            foregroundColor: Colors.black,
            elevation: 0,
            centerTitle: true,
          ),
          inputDecorationTheme: InputDecorationTheme(
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(4)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(4),
              borderSide: BorderSide(color: Color(0xFF07C160), width: 1.5),
            ),
            contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          ),
          cardTheme: CardThemeData(
            elevation: 0.5,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(8))),
            clipBehavior: Clip.antiAlias,
          ),
          dividerTheme: DividerThemeData(
            color: Colors.grey.shade200,
            thickness: 0.5,
          ),
        ),
        // 自定义页面过渡动画
        onGenerateRoute: (settings) {
          // 获取页面构建器
          Widget? page;
          
          // 根据路由名称构建页面
          switch (settings.name) {
            case '/login':
              page = LoginScreen();
              break;
            case '/register':
              page = RegisterScreen();
              break;
            case '/chat_list':
              page = ChatListScreen();
              break;
            case '/profile':
              page = ProfileScreen();
              break;
            case '/friends':
              page = FriendsListScreen();
              break;
            case '/friends/add':
              page = AddFriendScreen();
              break;
            case '/friends/requests':
              page = FriendRequestScreen();
              break;
            case '/chat/detail':
              // 处理聊天详情页的参数
              final args = settings.arguments as Map<String, dynamic>?;
              page = ChatDetailScreen(
                otherUserId: args?['otherUserId'] ?? '',
                otherUsername: args?['otherUsername'] ?? 'User',
                otherUserAvatarUrl: args?['otherUserAvatarUrl'],
              );
              break;
            case '/emoji_manager':
              page = EmojiManagerScreen();
              break;
            default:
              return null;
          }
          
          // 返回带有流畅动画的页面路由
          return PageRouteBuilder(
            settings: settings,
            pageBuilder: (context, animation, secondaryAnimation) => page!,
            transitionsBuilder: (context, animation, secondaryAnimation, child) {
              // 根据路由选择不同的动画
              if (settings.name == '/login' || settings.name == '/register') {
                // 渐变动画
                return FadeTransition(opacity: animation, child: child);
              } else {
                // 滑动动画
                const begin = Offset(0.05, 0);
                const end = Offset.zero;
                const curve = Curves.easeInOut;
                
                var tween = Tween(begin: begin, end: end)
                  .chain(CurveTween(curve: curve));
                  
                return SlideTransition(
                  position: animation.drive(tween),
                  child: FadeTransition(
                    opacity: animation,
                    child: child,
                  ),
                );
              }
            },
            transitionDuration: Duration(milliseconds: 250),
          );
        },
        home: SplashScreen(),
        routes: {
          '/login': (context) => LoginScreen(),
          '/register': (context) => RegisterScreen(),
          '/chat_list': (context) => ChatListScreen(),
          '/profile': (context) => ProfileScreen(),
          '/friends': (context) => FriendsListScreen(),
          '/friends/add': (context) => AddFriendScreen(),
          '/friends/requests': (context) => FriendRequestScreen(),
          '/groups/create': (context) => CreateGroupScreen(),
          '/emoji_manager': (context) => EmojiManagerScreen(),
        },
        debugShowCheckedModeBanner: false,
      ),
    );
  }
}

class SplashScreen extends StatefulWidget {
  @override
  _SplashScreenState createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  // 检查用户是否已登录
  Future<void> _checkAuth() async {
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      
      // 检查当前用户
      final user = authService.currentUser;
      
      // 获取WebSocket服务和聊天服务
      final websocketService = Provider.of<WebSocketService>(context, listen: false);
      final chatService = Provider.of<ChatService>(context, listen: false);
      
      // 如果用户已登录
      if (user != null) {
        print('用户已登录: ${user.username}，准备初始化服务');
        
        // 初始化聊天服务，确保必要的目录结构存在
        try {
          final chatService = Provider.of<ChatService>(context, listen: false);
          await chatService.initializeChatService(user.userId);
          print('聊天服务初始化完成');
        } catch (e) {
          print('初始化聊天服务时出错: $e');
          // 错误不阻止应用继续运行
        }
        
        // 在后台连接WebSocket，不等待连接完成
        Future.microtask(() {
          try {
            websocketService.connect();
          } catch (e) {
            print('WebSocket连接错误: $e');
            // 错误不阻止应用继续运行
          }
        });
      }
      
      // 等待一段时间以显示启动屏幕
      await Future.delayed(Duration(seconds: 1));
      
      // 导航到适当的页面
      if (user != null) {
        print('准备导航到聊天列表页面');
        // 用户已登录，导航到聊天列表
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (context) => ChatListScreen()),
        );
      } else {
        // 用户未登录，导航到登录页面
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (context) => LoginScreen()),
        );
      }
    } catch (e) {
      // 出错时导航到登录页面
      print('检查认证状态失败: $e');
      await Future.delayed(Duration(seconds: 1));
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (context) => LoginScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // App Logo
            Icon(
              Icons.chat,
              size: 80,
              color: Theme.of(context).primaryColor,
            ),
            SizedBox(height: 24),
            
            // App 名称
            Text(
              '微聊',
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.bold,
                color: Theme.of(context).primaryColor,
              ),
            ),
            SizedBox(height: 48),
            
            // 加载指示器
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}

// 临时类，后面可以删除
// 实际的 ChatService 类已经在 services/chat_service.dart 中实现

// ChatListScreen 已经在 screens/chat/chat_list_screen.dart 中实现
