import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:gal/gal.dart';

import 'theme/app_theme.dart';
import 'theme/enhanced_theme.dart';
import 'theme/theme_provider.dart' as theme_provider;
import 'widgets/responsive_layout.dart';
import 'widgets/animated_card.dart';
import 'config/tencent_cloud_config.dart';
import 'widgets/qr_style_template_selector.dart';
import 'widgets/modern_buttons.dart';
import 'widgets/modern_progress_indicator.dart';
import 'widgets/notification_manager.dart';
import 'services/debug_service.dart';
import 'pages/settings_page.dart';
import 'widgets/user_guide.dart';
import 'services/history_manager.dart';
import 'services/tencent_cos_service.dart';

import 'models/history_item.dart';
import 'models/qr_style.dart';
import 'pages/history_page.dart';
import 'widgets/qr_style_editor.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 初始化调试服务
  DebugService.logAppStart();
  DebugService.logSystemInfo();
  
  // 初始化历史记录管理器
  final historyManager = HistoryManager();
  await historyManager.initialize();
  
  runApp(MyApp(historyManager: historyManager));
}

class MyApp extends StatelessWidget {
  final HistoryManager historyManager;
  
  const MyApp({super.key, required this.historyManager});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (context) => theme_provider.ThemeProvider()),
        ChangeNotifierProvider.value(value: historyManager),
      ],
      child: Consumer<theme_provider.ThemeProvider>(
        builder: (context, themeProvider, child) {
          return MaterialApp(
            title: '音频二维码生成器',
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: _getThemeMode(themeProvider.themeMode),
            home: const HomeScreen(),
            debugShowCheckedModeBanner: false,
          );
        },
      ),
    );
  }
  
  ThemeMode _getThemeMode(theme_provider.ThemeMode mode) {
    switch (mode) {
      case theme_provider.ThemeMode.light:
        return ThemeMode.light;
      case theme_provider.ThemeMode.dark:
        return ThemeMode.dark;
      case theme_provider.ThemeMode.system:
        return ThemeMode.system;
    }
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

enum UIState { initial, fileSelected, uploading, success, error }

class _HomeScreenState extends State<HomeScreen> {
  final GlobalKey _qrBoundaryKey = GlobalKey();
  final GlobalKey _filePickerKey = GlobalKey();
  final GlobalKey _uploadButtonKey = GlobalKey();

  UIState _currentState = UIState.initial;
  PlatformFile? _selectedFile;
  String? _selectedFilePath;
  String? _qrData;
  String? _errorMessage;
  QRStyle _currentQRStyle = QRStyle.classic;

  Future<void> _pickAndProcessFile() async {
    final hasPermission = await _ensurePermissions();
    if (!hasPermission) {
      // 权限对话框已经在 _ensurePermissions 中处理
      return;
    }

    try {
      final result = await FilePicker.platform.pickFiles(type: FileType.audio);
      if (result == null || result.files.isEmpty) {
        return;
      }

      final filePath = result.files.single.path;
      if (filePath == null) {
        _showSnackBar('无法获取文件路径', isError: true);
        return;
      }

      if (mounted) {
        setState(() {
          _selectedFile = result.files.single;
          _selectedFilePath = filePath;
          _qrData = null;
          _errorMessage = null;
          _currentState = UIState.fileSelected;
        });
      }
    } on PlatformException catch (e) {
      _handleUploadError(e.message ?? e.code);
    } catch (e) {
      _handleUploadError('发生未知错误：$e');
    }
  }

  Future<void> _startUpload() async {
    if (_selectedFilePath == null) {
      _showSnackBar('请先选择音频文件', isError: true);
      return;
    }

    // 验证腾讯云配置
    if (!TencentCOSService.validateConfig()) {
      final errors = TencentCOSService.getConfigErrors();
      _showSnackBar('腾讯云配置错误: ${errors.join(', ')}', isError: true);
      return;
    }

    if (mounted) {
      setState(() {
        _currentState = UIState.uploading;
        _errorMessage = null;
      });
    }

    try {
      // 使用腾讯云COS上传
      final result = await TencentCOSService.uploadFile(
        _selectedFilePath!,
        onProgress: (progress) {
          // 可以在这里更新上传进度UI
          // 暂时不实现进度条更新
        },
      );

      if (!mounted) return;

      if (result.success && result.url != null) {
        // 上传成功，保存到历史记录
        // 生成微信友好的播放页面URL用于二维码
        final wechatPlayUrl = await TencentCloudConfig.buildWechatPlayUrl(
          _selectedFile!.name,
          result.url!,
        );
        
        final historyItem = HistoryItem(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          fileName: _selectedFile!.name,
          filePath: _selectedFilePath!,
          fileExtension: _selectedFile!.extension ?? '',
          fileSize: _selectedFile!.size,
          downloadUrl: result.url!,
          qrData: wechatPlayUrl, // 使用微信友好的播放页面URL
          createdAt: DateTime.now(),
        );
        
        if (context.mounted) {
          context.read<HistoryManager>().addItem(historyItem);
        }

        if (mounted) {
          setState(() {
            _qrData = wechatPlayUrl; // 使用微信友好的播放页面URL
            _currentState = UIState.success;
          });
        }

        _showSnackBar('上传成功！文件已上传到腾讯云', title: '操作成功');
      } else {
        // 上传失败
        _handleUploadError(result.error ?? '上传失败，未知错误');
      }
    } catch (e) {
      _handleUploadError('发生未知错误：$e');
    }
  }

  void _handleUploadError(String message) {
    if (!mounted) return;
    setState(() {
      _errorMessage = message;
      _currentState = UIState.error;
    });
    
    // 使用更好的错误处理
    if (message.contains('网络') || message.contains('连接')) {
      ErrorHandler.handleNetworkError(context);
    } else if (message.contains('文件')) {
      ErrorHandler.handleFileError(context, _selectedFile?.name ?? '未知文件');
    } else {
      ErrorHandler.handleError(
        context,
        title: '上传失败',
        message: message,
        severity: ErrorSeverity.error,
        actions: [
          ErrorAction(
            text: '重试',
            isPrimary: true,
            onPressed: () {
              Navigator.of(context).pop();
              _startUpload();
            },
          ),
          ErrorAction(
            text: '取消',
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      );
    }
  }

  Future<bool> _ensurePermissions() async {
    if (Platform.isAndroid) {
      // 尝试请求多种权限以兼容不同Android版本
      List<Permission> permissions = [
        Permission.storage,
        Permission.audio,
        Permission.manageExternalStorage,
      ];

      final statuses = await permissions.request();
      
      // 检查是否有任何权限被授予
      bool hasPermission = false;
      for (var permission in permissions) {
        final status = statuses[permission];
        if (status?.isGranted == true || status?.isLimited == true) {
          hasPermission = true;
          break;
        }
      }

      // 如果权限被拒绝，提供引导到设置的选项
      if (!hasPermission) {
        final shouldOpenSettings = await _showPermissionDialog();
        if (shouldOpenSettings) {
          await openAppSettings();
        }
      }

      return hasPermission;
    } else {
      // iOS doesn't require explicit permissions for file picker
      // FilePicker handles permissions internally
      return true;
    }
  }

  Future<bool> _showPermissionDialog() async {
    return await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('需要存储权限'),
          content: const Text('应用需要访问存储权限来选择音频文件。请在系统设置中允许存储权限。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('去设置'),
            ),
          ],
        );
      },
    ) ?? false;
  }



  Future<void> _saveQrCode() async {
    if (_qrData == null) {
      _showSnackBar('请先生成二维码', isError: true);
      return;
    }

    try {
      // 获取设备像素比率（在异步操作之前）
      final pixelRatio = MediaQuery.of(context).devicePixelRatio;
      
      // 检查并请求存储权限
      final hasPermission = await _requestStoragePermission();
      if (!hasPermission) {
        _showSnackBar('需要存储权限才能保存到相册', isError: true);
        return;
      }

      final boundary = _qrBoundaryKey.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      if (boundary == null) {
        _showSnackBar('二维码视图暂不可用，请稍后重试', isError: true);
        return;
      }

      // 生成高质量的二维码图片
      final image = await boundary.toImage(pixelRatio: pixelRatio * 2);
      final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      if (byteData == null) {
        _showSnackBar('二维码生成失败', isError: true);
        return;
      }

      final pngBytes = byteData.buffer.asUint8List();
      
      // 保存到相册
      final fileName = 'AudioQR_${DateTime.now().millisecondsSinceEpoch}';
      
      try {
        await Gal.putImageBytes(pngBytes, name: '$fileName.png');
        _showSnackBar('二维码已保存到相册 📱', title: '保存成功');
      } catch (e) {
        // 如果保存到相册失败，尝试保存到文件系统作为备用方案
        _showSnackBar('保存到相册失败，正在尝试其他方式...', isError: true);
        await _saveQrCodeToFile(pngBytes, fileName);
      }

    } catch (e) {
      _showSnackBar('保存失败：$e', isError: true);
    }
  }

  // 备用保存方案：保存到文件系统
  Future<void> _saveQrCodeToFile(Uint8List pngBytes, String fileName) async {
    try {
      if (Platform.isAndroid) {
        // Android: 尝试保存到Pictures目录
        final dir = Directory('/storage/emulated/0/Pictures/AudioQR');
        if (!await dir.exists()) {
          await dir.create(recursive: true);
        }
        final file = File('${dir.path}/$fileName.png');
        await file.writeAsBytes(pngBytes);
        _showSnackBar('二维码已保存到 Pictures/AudioQR 文件夹');
      } else {
        // iOS: 保存到应用文档目录
        final appDir = await Directory.systemTemp.createTemp('audio_qr');
        final tempFile = File('${appDir.path}/$fileName.png');
        await tempFile.writeAsBytes(pngBytes);
        _showSnackBar('二维码已保存（权限受限）');
      }
    } catch (e) {
      _showSnackBar('保存失败：$e', isError: true);
    }
  }

  // 请求存储权限
  Future<bool> _requestStoragePermission() async {
    if (Platform.isAndroid) {
      // Android 13+ 需要photos权限，之前版本需要storage权限
      final androidInfo = await Permission.storage.request();
      final photosPermission = await Permission.photos.request();
      
      return androidInfo.isGranted || photosPermission.isGranted;
    } else if (Platform.isIOS) {
      // iOS需要photos权限
      final status = await Permission.photos.request();
      return status.isGranted;
    }
    return false;
  }

  Future<void> _shareQrCode() async {
    if (_qrData == null) {
      _showSnackBar('请先生成二维码', isError: true);
      return;
    }

    Directory? tempDir;
    try {
      final boundary = _qrBoundaryKey.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      if (boundary == null) {
        _showSnackBar('二维码视图暂不可用，请稍后重试', isError: true);
        return;
      }

      final pixelRatio = MediaQuery.of(context).devicePixelRatio;
      final image = await boundary.toImage(pixelRatio: pixelRatio);
      final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      if (byteData == null) {
        _showSnackBar('二维码生成失败', isError: true);
        return;
      }

      final pngBytes = byteData.buffer.asUint8List();
      
      // 创建临时文件用于分享
      tempDir = await Directory.systemTemp.createTemp('audio_qr_share');
      final tempFile = File('${tempDir.path}/audio_qr_code.png');
      await tempFile.writeAsBytes(pngBytes);
      
      // 分享二维码图片和音频链接
      await Share.shareXFiles(
        [XFile(tempFile.path)],
        text: '扫描二维码获取音频文件：$_qrData',
        subject: '音频二维码分享',
      );
      
      _showSnackBar('二维码已分享');
      
    } catch (e) {
      _showSnackBar('分享失败：$e', isError: true);
    } finally {
      // 确保清理临时文件
      if (tempDir != null) {
        try {
          if (await tempDir.exists()) {
            await tempDir.delete(recursive: true);
          }
        } catch (cleanupError) {
          // 清理失败时记录日志，但不影响用户体验
          print('清理临时文件失败: $cleanupError');
        }
      }
    }
  }

  Widget _buildQrCodeWidget() {
    try {
      // 检查QR数据长度限制（大约2953字符对于QrVersions.auto）
      if (_qrData != null && _qrData!.length > 2000) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(PhosphorIcons.warning(), size: 48, color: Colors.orange),
              const SizedBox(height: 8),
              const Text('链接过长，无法生成二维码', 
                   style: TextStyle(color: Colors.orange)),
            ],
          ),
        );
      }
      
      return Container(
        decoration: BoxDecoration(
          color: _currentQRStyle.backgroundColor,
          borderRadius: BorderRadius.circular(_currentQRStyle.borderRadius),
          border: _currentQRStyle.hasBorder
              ? Border.all(
                  color: _currentQRStyle.borderColor ?? Colors.grey,
                  width: _currentQRStyle.borderWidth,
                )
              : null,
          boxShadow: _currentQRStyle.hasShadow
              ? [
                  BoxShadow(
                    color: _currentQRStyle.shadowColor,
                    blurRadius: _currentQRStyle.shadowBlur,
                    offset: _currentQRStyle.shadowOffset,
                  ),
                ]
              : null,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_currentQRStyle.borderRadius),
          child: QrImageView(
            data: _qrData!,
            version: QrVersions.auto,
            size: 200.0,
            backgroundColor: _currentQRStyle.backgroundColor,
            foregroundColor: _currentQRStyle.hasGradient && 
                              _currentQRStyle.gradientColors != null && 
                              _currentQRStyle.gradientColors!.isNotEmpty
                ? _currentQRStyle.gradientColors!.first
                : _currentQRStyle.foregroundColor,
            eyeStyle: QrEyeStyle(
              eyeShape: _convertEyeShape(_currentQRStyle.eyeShape),
              color: _currentQRStyle.eyeColor ?? _currentQRStyle.foregroundColor,
            ),
            dataModuleStyle: QrDataModuleStyle(
              dataModuleShape: _convertDataShape(_currentQRStyle.shapeType),
              color: _currentQRStyle.hasGradient && 
                     _currentQRStyle.gradientColors != null && 
                     _currentQRStyle.gradientColors!.isNotEmpty
                  ? _currentQRStyle.gradientColors!.first
                  : _currentQRStyle.foregroundColor,
            ),
            errorCorrectionLevel: QrErrorCorrectLevel.M,
            errorStateBuilder: (context, err) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(PhosphorIcons.warning(), size: 48, color: Colors.red),
                    const SizedBox(height: 8),
                    const Text('二维码生成失败', style: TextStyle(color: Colors.red)),
                  ],
                ),
              );
            },
          ),
        ),
      );
    } catch (e) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(PhosphorIcons.warning(), size: 48, color: Colors.red),
            const SizedBox(height: 8),
            const Text('二维码生成出错', style: TextStyle(color: Colors.red)),
          ],
        ),
      );
    }
  }

  void _showSnackBar(String message, {bool isError = false, String? title}) {
    NotificationManager.show(
      context,
      message: message,
      title: title,
      type: isError ? NotificationType.error : NotificationType.success,
      duration: const Duration(seconds: 3),
    );
  }

  void _showQRStyleEditor() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => QRStyleEditor(
          qrData: _qrData!,
          initialStyle: _currentQRStyle,
          onStyleChanged: (style) {
            if (mounted) {
              setState(() {
                _currentQRStyle = style;
              });
            }
          },
        ),
      ),
    );
  }
  
  void _showStyleTemplateSelector() {
    if (_qrData == null) return;
    
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => QRStyleTemplateSelector(
          qrData: _qrData!,
          selectedStyle: _currentQRStyle,
          onStyleSelected: (style) {
            if (mounted) {
              setState(() {
                _currentQRStyle = style;
              });
            }
          },
          onCustomStyle: () {
            Navigator.of(context).pop();
            _showQRStyleEditor();
          },
        ),
      ),
    );
  }
  
  /// 转换眼部形状
  QrEyeShape _convertEyeShape(QREyeShape eyeShape) {
    switch (eyeShape) {
      case QREyeShape.square:
        return QrEyeShape.square;
      case QREyeShape.circle:
        return QrEyeShape.circle;
      case QREyeShape.roundedSquare:
        return QrEyeShape.square;
    }
  }

  /// 转换数据模块形状
  QrDataModuleShape _convertDataShape(QRShapeType shapeType) {
    switch (shapeType) {
      case QRShapeType.square:
        return QrDataModuleShape.square;
      case QRShapeType.circle:
        return QrDataModuleShape.circle;
      case QRShapeType.roundedSquare:
        return QrDataModuleShape.square;
    }
  }

  void _resetWorkflow() {
    if (mounted) {
      setState(() {
        _selectedFile = null;
        _selectedFilePath = null;
        _qrData = null;
        _errorMessage = null;
        _currentState = UIState.initial;
      });
    }
  }

  String _formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }
  
  PreferredSizeWidget _buildAppBar(BuildContext context) {
    return AppBar(
      leading: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Container(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primary,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            PhosphorIcons.qrCode(),
            color: Colors.white,
            size: 20,
          ),
        ),
      ),
      title: const Text(
        '音频二维码',
        overflow: TextOverflow.ellipsis,
      ),
      actions: [
        IconButton(
          icon: Icon(PhosphorIcons.clockCounterClockwise()),
          onPressed: () {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (context) => const HistoryPage()),
            );
          },
          tooltip: '历史记录',
        ),
        IconButton(
          icon: Icon(PhosphorIcons.question()),
          onPressed: _showUserGuide,
          tooltip: '使用指南',
        ),
        IconButton(
          icon: Icon(
            Provider.of<theme_provider.ThemeProvider>(context).themeModeIcon,
          ),
          onPressed: () {
            Provider.of<theme_provider.ThemeProvider>(context, listen: false)
                .toggleTheme();
          },
          tooltip: '切换主题',
        ),
        IconButton(
          icon: Icon(PhosphorIcons.gear()),
          onPressed: () {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (context) => const SettingsPage(),
              ),
            );
          },
          tooltip: '设置',
        ),
      ],
    );
  }



  Widget _buildHeaderSection() {
    return AnimatedCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(
              PhosphorIcons.musicNote(),
              size: 48,
              color: Theme.of(context).colorScheme.onPrimaryContainer,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            '音频二维码生成器',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            '轻松将音频文件转换为二维码，随时随地分享您的音乐',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
  
  Widget _buildMainContentSection() {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 500),
      transitionBuilder: (child, animation) {
        return FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0, 0.2),
              end: Offset.zero,
            ).animate(animation),
            child: child,
          ),
        );
      },
      child: _buildMainContent(),
    );
  }
  
  Widget _buildMainContent() {
    switch (_currentState) {
      case UIState.initial:
        return _buildInitialState();
      case UIState.fileSelected:
        return _buildFileSelectedState();
      case UIState.uploading:
        return _buildUploadingState();
      case UIState.success:
        return _buildSuccessState();
      case UIState.error:
        return _buildErrorState();
    }
  }
  
  Widget _buildInitialState() {
    return Center(
      child: AnimatedCard(
        key: const ValueKey('initial'),
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    EnhancedTheme.primaryColor.withOpacity(0.1),
                    EnhancedTheme.accentColor.withOpacity(0.05),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: EnhancedTheme.primaryColor.withOpacity(0.2),
                  width: 1.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: EnhancedTheme.primaryColor.withOpacity(0.1),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Icon(
                PhosphorIcons.folder(),
                size: 48,
                color: EnhancedTheme.primaryColor,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              '选择音频文件',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            Text(
              '支持 MP3, WAV, AAC, M4A 等格式',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: Container(
                decoration: EnhancedTheme.getGradientDecoration(
                  EnhancedTheme.primaryGradient,
                  borderRadius: 18,
                ),
                child: ElevatedButton.icon(
                  onPressed: _pickAndProcessFile,
                  icon: Icon(PhosphorIcons.file()),
                  label: const Text('选择文件'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 24),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildFileSelectedState() {
    return AnimatedCard(
      key: const ValueKey('fileSelected'),
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 文件信息卡片
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Theme.of(context).colorScheme.primaryContainer,
                  Theme.of(context).colorScheme.primaryContainer.withOpacity(0.8),
                ],
              ),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: Theme.of(context).colorScheme.primary.withOpacity(0.2),
                width: 1,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  PhosphorIcons.file(),
                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                  size: 24,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _selectedFile?.name ?? '未知文件',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _formatFileSize(_selectedFile?.size ?? 0),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onPrimaryContainer.withOpacity(0.7),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          
          // 提示信息
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.secondaryContainer.withOpacity(0.5),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(
                  PhosphorIcons.info(),
                  color: Theme.of(context).colorScheme.onSecondaryContainer,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '文件将上传到腾讯云COS，生成的二维码包含下载链接',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildUploadingState() {
    return AnimatedCard(
      key: const ValueKey('uploading'),
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          ModernProgressIndicator(
            size: 120,
            strokeWidth: 6,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 24),
          Text(
            '正在上传到腾讯云...',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '请保持网络连接稳定，上传完成后将自动生成二维码',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
  
  Widget _buildSuccessState() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
      child: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
            // 成功提示
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    EnhancedTheme.successColor.withOpacity(0.15),
                    EnhancedTheme.successColor.withOpacity(0.05),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: EnhancedTheme.successColor.withOpacity(0.2),
                  width: 1.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: EnhancedTheme.successColor.withOpacity(0.1),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: EnhancedTheme.successColor,
                      borderRadius: BorderRadius.circular(12),
                      boxShadow: [
                        BoxShadow(
                          color: EnhancedTheme.successColor.withOpacity(0.3),
                          blurRadius: 4,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Icon(
                      PhosphorIcons.checkCircle(),
                      color: Colors.white,
                      size: 18,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '上传成功！二维码已生成',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: EnhancedTheme.successColor,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            
            // 二维码显示 - 增强视觉效果
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: Theme.of(context).colorScheme.primary.withOpacity(0.1),
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Theme.of(context).colorScheme.primary.withOpacity(0.1),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                  BoxShadow(
                    color: Colors.black.withOpacity(0.05),
                    blurRadius: 10,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Column(
                children: [
                  RepaintBoundary(
                    key: _qrBoundaryKey,
                    child: Container(
                      width: 200,
                      height: 200,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: Theme.of(context).colorScheme.outline.withOpacity(0.1),
                          width: 1,
                        ),
                      ),
                      child: _qrData != null
                          ? _buildQrCodeWidget()
                          : Center(
                              child: ModernProgressIndicator(
                                size: 36,
                                strokeWidth: 3,
                                color: EnhancedTheme.primaryColor,
                              ),
                            ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '扫描二维码获取音频文件',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Colors.black54,
                    ),
                  ),
                ],
              ),
            ),
            
            const SizedBox(height: 18),
            
            // 样式选择按钮
            Container(
              width: double.infinity,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    EnhancedTheme.accentColor.withOpacity(0.1),
                    EnhancedTheme.primaryColor.withOpacity(0.05),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: EnhancedTheme.accentColor.withOpacity(0.2),
                  width: 1.5,
                ),
              ),
              child: OutlinedButton.icon(
                onPressed: _showStyleTemplateSelector,
                icon: Icon(PhosphorIcons.palette(), size: 18),
                label: Text('选择样式 (${_currentQRStyle.name})'),
                style: OutlinedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  foregroundColor: EnhancedTheme.accentColor,
                  padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  side: BorderSide.none,
                  textStyle: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            
            const SizedBox(height: 18),
            
            // 操作按钮
            Row(
              children: [
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        width: 1.5,
                        color: EnhancedTheme.primaryColor.withOpacity(0.3),
                      ),
                      gradient: LinearGradient(
                        colors: [
                          EnhancedTheme.primaryColor.withOpacity(0.1),
                          Colors.transparent,
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                    child: OutlinedButton.icon(
                      onPressed: _resetWorkflow,
                      icon: Icon(PhosphorIcons.arrowsClockwise(), size: 18),
                      label: const Text('重新开始'),
                      style: OutlinedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        foregroundColor: EnhancedTheme.primaryColor,
                        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 18),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        side: BorderSide.none,
                        textStyle: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Container(
                    decoration: EnhancedTheme.getGradientDecoration(
                      EnhancedTheme.successGradient,
                      borderRadius: 16,
                    ),
                    child: ElevatedButton.icon(
                      onPressed: _saveQrCode,
                      icon: Icon(PhosphorIcons.download(), size: 18),
                      label: const Text('保存到相册'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        shadowColor: Colors.transparent,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 18),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            // 添加底部安全区域
            const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
  
  Widget _buildErrorState() {
    return AnimatedCard(
      key: const ValueKey('error'),
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  EnhancedTheme.dangerColor.withOpacity(0.1),
                  EnhancedTheme.dangerColor.withOpacity(0.05),
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: EnhancedTheme.dangerColor.withOpacity(0.2),
                width: 1.5,
              ),
              boxShadow: [
                BoxShadow(
                  color: EnhancedTheme.dangerColor.withOpacity(0.1),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Icon(
              PhosphorIcons.warning(),
              size: 60,
              color: EnhancedTheme.dangerColor,
            ),
          ),
          const SizedBox(height: 24),
          Text(
            '上传失败',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.error,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            _errorMessage ?? '发生未知错误，请重试',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
  
  Widget _buildActionSection() {
    return _buildActionButtons();
  }
  
  Widget _buildActionButtons() {
    switch (_currentState) {
      case UIState.initial:
        return ModernButton(
          text: '选择音频文件',
          icon: PhosphorIcons.fileAudio(),
          onPressed: _pickAndProcessFile,
        );
      case UIState.fileSelected:
        return Row(
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    width: 1.5,
                    color: EnhancedTheme.primaryColor.withOpacity(0.3),
                  ),
                  gradient: LinearGradient(
                    colors: [
                      EnhancedTheme.primaryColor.withOpacity(0.1),
                      Colors.transparent,
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: OutlinedButton.icon(
                  onPressed: _pickAndProcessFile,
                  icon: Icon(PhosphorIcons.arrowsClockwise()),
                  label: const Text('重新选择'),
                  style: OutlinedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    foregroundColor: EnhancedTheme.primaryColor,
                    padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                    side: BorderSide.none,
                    textStyle: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: Container(
                decoration: EnhancedTheme.getGradientDecoration(
                  EnhancedTheme.primaryGradient,
                  borderRadius: 18,
                ),
                child: ElevatedButton.icon(
                  key: _uploadButtonKey,
                  onPressed: _startUpload,
                  icon: Icon(PhosphorIcons.cloudArrowUp()),
                  label: const Text('开始上传'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      case UIState.uploading:
        return const SizedBox.shrink();
      case UIState.success:
        return const SizedBox.shrink(); // 成功状态的按钮在内容区域内
      case UIState.error:
        return ResponsiveGrid(
          spacing: 12,
          forceColumns: 2,
          children: [
            ModernButton(
              text: '重试上传',
              icon: PhosphorIcons.arrowClockwise(),
              onPressed: _startUpload,
            ),
            ModernOutlinedButton(
              text: '重新选择',
              icon: PhosphorIcons.fileAudio(),
              onPressed: _pickAndProcessFile,
            ),
          ],
        );
    }
  }
  
  Widget? _buildFloatingActions() {
    if (_currentState == UIState.success) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ModernFAB(
            icon: PhosphorIcons.share(),
            tooltip: '分享二维码',
            onPressed: _shareQrCode,
            backgroundColor: EnhancedTheme.secondaryGradient.first,
            foregroundColor: Colors.white,
            elevation: 0,
          ),
          const SizedBox(height: 12),
          ModernFAB(
            icon: PhosphorIcons.copy(),
            tooltip: '复制链接',
            backgroundColor: EnhancedTheme.accentGradient.first,
            foregroundColor: Colors.white,
            elevation: 0,
            onPressed: () {
              if (_qrData != null) {
                Clipboard.setData(ClipboardData(text: _qrData!));
                _showSnackBar('链接已复制到剪贴板');
              }
            },
          ),
        ],
      );
    }
    return null;
  }
  
  void _showUserGuide() {
    final steps = [
      GuideStep(
        title: '欢迎使用音频二维码生成器',
        description: '这个引导将帮助您了解如何使用应用的主要功能。让我们开始吧！',
        icon: PhosphorIcons.handWaving(),
        cardTop: 100,
        cardLeft: 0,
        cardRight: 0,
      ),
      GuideStep(
        targetKey: _filePickerKey,
        title: '选择音频文件',
        description: '点击这里选择您要分享的音频文件。支持 MP3、WAV、AAC 等多种格式。',
        icon: PhosphorIcons.fileAudio(),
        cardBottom: 100,
        cardLeft: 0,
        cardRight: 0,
      ),
      GuideStep(
        targetKey: _uploadButtonKey,
        title: '上传到云端',
        description: '选择文件后，点击上传按钮将文件上传到腾讯云COS，然后生成二维码。',
        icon: PhosphorIcons.cloudArrowUp(),
        cardTop: 100,
        cardLeft: 0,
        cardRight: 0,
      ),
      GuideStep(
        title: '分享二维码',
        description: '生成二维码后，您可以保存到相册或直接分享给朋友。他们扫描二维码就能下载音频文件！',
        icon: PhosphorIcons.share(),
        cardTop: 200,
        cardLeft: 0,
        cardRight: 0,
      ),
    ];
    
    // 创建新的引导覆层
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => UserGuideOverlay(
        steps: steps,
        onComplete: () {
          Navigator.of(context).pop();
          _showSnackBar('引导完成！开始体验应用吧', title: '欢迎使用');
        },
        child: Container(),
      ),
    );
  }



  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: _buildAppBar(context),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            children: [
              // 头部区域 - 只在非成功状态显示
              if (_currentState != UIState.success) ...[
                _buildHeaderSection(),
                const SizedBox(height: 24),
              ],
              
              // 主内容区域
              Expanded(
                child: _buildMainContentSection(),
              ),
              
              // 操作区域 - 只在非成功状态显示，成功状态的按钮在内容区域内
              if (_currentState != UIState.success) ...[
                const SizedBox(height: 24),
                _buildActionSection(),
                const SizedBox(height: 16),
              ],
            ],
          ),
        ),
      ),
      floatingActionButton: _buildFloatingActions(),
    );
  }
}
