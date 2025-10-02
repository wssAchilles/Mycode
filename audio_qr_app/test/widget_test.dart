// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:audio_qr_app/main.dart';
import 'package:audio_qr_app/services/history_manager.dart';

void main() {
  testWidgets('Audio QR App widget test', (WidgetTester tester) async {
    // 创建历史记录管理器
    final historyManager = HistoryManager();
    await historyManager.initialize();
    
    // Build our app and trigger a frame.
    await tester.pumpWidget(MyApp(historyManager: historyManager));

    // Verify that the app title is displayed
    expect(find.text('音频二维码生成器'), findsOneWidget);
    
    // Verify that the file picker section is displayed
    expect(find.text('选择音频文件'), findsOneWidget);
  });
}
