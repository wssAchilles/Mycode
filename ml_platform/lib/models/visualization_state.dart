// 可视化状态管理模型
import 'package:flutter/foundation.dart';

/// 播放状态枚举
enum PlaybackState {
  idle('空闲'),
  playing('播放中'),
  paused('暂停'),
  finished('完成');

  final String displayName;
  const PlaybackState(this.displayName);
}

/// 可视化配置
class VisualizationConfig {
  final double animationSpeed; // 动画速度倍数 0.1x - 5x
  final int dataSize; // 数据规模
  final bool showStepDescription; // 是否显示步骤描述
  final bool showMetrics; // 是否显示性能指标
  final bool enableSound; // 是否启用音效
  final bool autoReplay; // 是否自动重播

  const VisualizationConfig({
    this.animationSpeed = 1.0,
    this.dataSize = 50,
    this.showStepDescription = true,
    this.showMetrics = true,
    this.enableSound = false,
    this.autoReplay = false,
  });

  VisualizationConfig copyWith({
    double? animationSpeed,
    int? dataSize,
    bool? showStepDescription,
    bool? showMetrics,
    bool? enableSound,
    bool? autoReplay,
  }) {
    return VisualizationConfig(
      animationSpeed: animationSpeed ?? this.animationSpeed,
      dataSize: dataSize ?? this.dataSize,
      showStepDescription: showStepDescription ?? this.showStepDescription,
      showMetrics: showMetrics ?? this.showMetrics,
      enableSound: enableSound ?? this.enableSound,
      autoReplay: autoReplay ?? this.autoReplay,
    );
  }
}

/// 可视化状态
class VisualizationState extends ChangeNotifier {
  // 当前播放状态
  PlaybackState _playbackState = PlaybackState.idle;
  PlaybackState get playbackState => _playbackState;

  // 当前步骤索引
  int _currentStep = 0;
  int get currentStep => _currentStep;

  // 总步骤数
  int _totalSteps = 0;
  int get totalSteps => _totalSteps;

  // 配置
  VisualizationConfig _config = const VisualizationConfig();
  VisualizationConfig get config => _config;

  // 当前选择的算法或数据结构类型
  String? _selectedType;
  String? get selectedType => _selectedType;

  // 输入数据
  List<int> _inputData = [];
  List<int> get inputData => _inputData;

  // 是否正在加载
  bool _isLoading = false;
  bool get isLoading => _isLoading;

  // 错误信息
  String? _errorMessage;
  String? get errorMessage => _errorMessage;

  /// 设置播放状态
  void setPlaybackState(PlaybackState state) {
    _playbackState = state;
    notifyListeners();
  }

  /// 设置当前步骤
  void setCurrentStep(int step) {
    if (step >= 0 && step <= _totalSteps) {
      _currentStep = step;
      notifyListeners();
    }
  }

  /// 下一步
  void nextStep() {
    if (_currentStep < _totalSteps - 1) {
      _currentStep++;
      notifyListeners();
    } else {
      setPlaybackState(PlaybackState.finished);
    }
  }

  /// 上一步
  void previousStep() {
    if (_currentStep > 0) {
      _currentStep--;
      notifyListeners();
    }
  }

  /// 重置到第一步
  void resetSteps() {
    _currentStep = 0;
    _playbackState = PlaybackState.idle;
    notifyListeners();
  }

  /// 设置总步骤数
  void setTotalSteps(int total) {
    _totalSteps = total;
    notifyListeners();
  }

  /// 更新配置
  void updateConfig(VisualizationConfig newConfig) {
    _config = newConfig;
    notifyListeners();
  }

  /// 设置选中的类型
  void setSelectedType(String type) {
    _selectedType = type;
    notifyListeners();
  }

  /// 设置输入数据
  void setInputData(List<int> data) {
    _inputData = List<int>.from(data);
    notifyListeners();
  }

  /// 生成随机数据
  void generateRandomData(int size) {
    _inputData = List.generate(size, (index) => (index + 1) * 10);
    _inputData.shuffle();
    notifyListeners();
  }

  /// 设置加载状态
  void setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  /// 设置错误信息
  void setError(String? error) {
    _errorMessage = error;
    notifyListeners();
  }

  /// 清空状态
  void clear() {
    _playbackState = PlaybackState.idle;
    _currentStep = 0;
    _totalSteps = 0;
    _selectedType = null;
    _inputData = [];
    _errorMessage = null;
    notifyListeners();
  }
}
