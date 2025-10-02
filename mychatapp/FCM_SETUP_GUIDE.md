# Firebase Cloud Messaging (FCM) 配置指南

## 📱 Android 配置

### 1. 修改 android/app/build.gradle
在 `android/app/build.gradle` 文件中添加以下依赖：

```gradle
dependencies {
    // ... 其他依赖
    implementation 'com.google.firebase:firebase-messaging:23.0.0'
}
```

### 2. 修改 android/app/src/main/AndroidManifest.xml
在 `<application>` 标签内添加以下服务和权限：

```xml
<!-- FCM 相关权限 -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.VIBRATE" />

<application>
    <!-- 其他配置 -->
    
    <!-- FCM 消息服务 -->
    <service
        android:name=".MyFirebaseMessagingService"
        android:exported="false">
        <intent-filter>
            <action android:name="com.google.firebase.MESSAGING_EVENT" />
        </intent-filter>
    </service>

    <!-- FCM 默认图标和颜色 -->
    <meta-data
        android:name="com.google.firebase.messaging.default_notification_icon"
        android:resource="@drawable/ic_notification" />
    <meta-data
        android:name="com.google.firebase.messaging.default_notification_color"
        android:resource="@color/notification_color" />
    <meta-data
        android:name="com.google.firebase.messaging.default_notification_channel_id"
        android:value="high_importance_channel" />
</application>
```

## 📱 iOS 配置

### 1. 启用推送通知能力
在 Xcode 中：
1. 打开 `ios/Runner.xcworkspace`
2. 选择 Runner 项目
3. 点击 Signing & Capabilities
4. 点击 "+ Capability"
5. 添加 "Push Notifications"

### 2. 修改 ios/Runner/AppDelegate.swift
```swift
import UIKit
import Flutter
import Firebase
import UserNotifications

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    FirebaseApp.configure()
    
    if #available(iOS 10.0, *) {
      UNUserNotificationCenter.current().delegate = self as UNUserNotificationCenterDelegate
    }
    
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
```

## 📦 pubspec.yaml 依赖

确保在 `pubspec.yaml` 中添加以下依赖：

```yaml
dependencies:
  flutter:
    sdk: flutter
  firebase_core: ^2.24.2
  firebase_auth: ^4.15.3
  cloud_firestore: ^4.13.6
  firebase_messaging: ^14.7.10  # FCM 插件
```

## 🔧 Flutter 集成步骤

1. 运行 `flutter pub get` 安装依赖
2. 确保 Firebase 项目已启用 Cloud Messaging
3. 在 Firebase Console 中生成 APNs 证书（iOS）
4. 测试推送通知功能

## ⚠️ 重要提醒

- Android 需要添加通知图标到 `android/app/src/main/res/drawable/`
- iOS 需要在真机上测试推送通知（模拟器不支持）
- 确保在 Firebase Console 中正确配置推送证书
- 测试时建议使用 Firebase Console 的 Cloud Messaging 测试工具
