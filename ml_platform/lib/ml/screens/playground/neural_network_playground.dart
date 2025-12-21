import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'dart:async';
import 'dart:math' as math;
import 'dart:math' show abs;
import '../../models/neural_network_model.dart';

/// 神经网络游乐场
class NeuralNetworkPlayground extends StatefulWidget {
  const NeuralNetworkPlayground({Key? key}) : super(key: key);

  @override
  State<NeuralNetworkPlayground> createState() => _NeuralNetworkPlaygroundState();
}

class _NeuralNetworkPlaygroundState extends State<NeuralNetworkPlayground>
    with TickerProviderStateMixin {
  // 网络配置
  List<int> _layerSizes = [2, 4, 4, 2];
  List<ActivationFunction> _activationFunctions = [
    ActivationFunction.linear,
    ActivationFunction.relu,
    ActivationFunction.relu,
    ActivationFunction.softmax,
  ];
  
  // 训练参数
  double _learningRate = 0.01;
  int _batchSize = 10;
  
  // 数据集
  DatasetType _datasetType = DatasetType.xor;
  List<DataPoint> _trainingData = [];
  
  // 神经网络
  NeuralNetwork? _network;
  
  // 训练状态
  bool _isTraining = false;
  Timer? _trainingTimer;
  int _epoch = 0;
  double _currentLoss = 0.0;
  double _currentAccuracy = 0.0;
  List<double> _lossHistory = [];
  List<double> _accuracyHistory = [];
  
  // 决策边界
  List<List<double>>? _decisionBoundary;

  @override
  void initState() {
    super.initState();
    _initializeNetwork();
    _generateDataset();
  }

  @override
  void dispose() {
    _trainingTimer?.cancel();
    super.dispose();
  }

  void _initializeNetwork() {
    setState(() {
      _network = NeuralNetwork(
        layerSizes: _layerSizes,
        activationFunctions: _activationFunctions,
        learningRate: _learningRate,
      );
      _epoch = 0;
      _lossHistory.clear();
      _accuracyHistory.clear();
      _updateDecisionBoundary();
    });
  }

  void _generateDataset() {
    setState(() {
      _trainingData = DatasetGenerator.generate(_datasetType, samples: 200);
      final maxLabel = _trainingData.map((d) => d.label).reduce(math.max);
      _layerSizes[_layerSizes.length - 1] = maxLabel > 0 ? maxLabel + 1 : 1;
      _initializeNetwork();
    });
  }

  void _startTraining() {
    if (_isTraining) return;
    setState(() => _isTraining = true);
    _trainingTimer = Timer.periodic(const Duration(milliseconds: 50), (_) => _trainStep());
  }

  void _stopTraining() {
    setState(() => _isTraining = false);
    _trainingTimer?.cancel();
  }

  void _trainStep() {
    if (_network == null || _trainingData.isEmpty) return;
    
    final batchData = <DataPoint>[];
    final batchTargets = <List<double>>[];
    
    for (int i = 0; i < _batchSize && i < _trainingData.length; i++) {
      final point = _trainingData[math.Random().nextInt(_trainingData.length)];
      batchData.add(point);
      
      if (_layerSizes.last == 1) {
        batchTargets.add([point.label.toDouble()]);
      } else {
        final target = List<double>.filled(_layerSizes.last, 0.0);
        target[point.label] = 1.0;
        batchTargets.add(target);
      }
    }
    
    final result = _network!.trainBatch(batchData, batchTargets);
    
    setState(() {
      _epoch++;
      _currentLoss = result.loss;
      _currentAccuracy = result.accuracy;
      _lossHistory.add(_currentLoss);
      _accuracyHistory.add(_currentAccuracy);
      
      if (_lossHistory.length > 100) {
        _lossHistory.removeAt(0);
        _accuracyHistory.removeAt(0);
      }
      
      if (_epoch % 10 == 0) {
        _updateDecisionBoundary();
      }
    });
  }

  void _updateDecisionBoundary() {
    if (_network == null) return;
    setState(() {
      _decisionBoundary = _network!.predictGrid(
        minX: -1.5,
        maxX: 1.5,
        minY: -1.5,
        maxY: 1.5,
        resolution: 30,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('神经网络游乐场'),
        centerTitle: true,
      ),
      body: Row(
        children: [
          // 控制面板
          Container(
            width: 280,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.1),
                  blurRadius: 4,
                ),
              ],
            ),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('数据集', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<DatasetType>(
                    value: _datasetType,
                    decoration: const InputDecoration(
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(),
                    ),
                    items: DatasetType.values.map((type) {
                      return DropdownMenuItem(
                        value: type,
                        child: Text(_getDatasetName(type)),
                      );
                    }).toList(),
                    onChanged: (type) {
                      if (type != null) {
                        setState(() => _datasetType = type);
                        _generateDataset();
                      }
                    },
                  ),
                  
                  const SizedBox(height: 16),
                  const Text('学习率', style: TextStyle(fontWeight: FontWeight.bold)),
                  Slider(
                    value: _learningRate,
                    min: 0.001,
                    max: 0.1,
                    onChanged: (value) {
                      setState(() {
                        _learningRate = value;
                        _network?.learningRate = value;
                      });
                    },
                  ),
                  Text('值: ${_learningRate.toStringAsFixed(3)}'),
                  
                  const SizedBox(height: 16),
                  const Text('训练控制', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _isTraining ? null : _startTraining,
                          icon: const Icon(Icons.play_arrow),
                          label: const Text('开始'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _isTraining ? _stopTraining : null,
                          icon: const Icon(Icons.pause),
                          label: const Text('暂停'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ElevatedButton.icon(
                    onPressed: _initializeNetwork,
                    icon: const Icon(Icons.refresh),
                    label: const Text('重置网络'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                    ),
                  ),
                  
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Epoch: $_epoch'),
                        Text('损失: ${_currentLoss.toStringAsFixed(4)}'),
                        Text('准确率: ${(_currentAccuracy * 100).toStringAsFixed(1)}%'),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          
          // 主视图
          Expanded(
            child: Column(
              children: [
                // 可视化区域
                Expanded(
                  child: Row(
                    children: [
                      // 数据集可视化
                      Expanded(
                        child: Container(
                          margin: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(8),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.1),
                                blurRadius: 4,
                              ),
                            ],
                          ),
                          child: Column(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(12),
                                child: const Text(
                                  '数据集与决策边界',
                                  style: TextStyle(fontWeight: FontWeight.bold),
                                ),
                              ),
                              Expanded(
                                child: CustomPaint(
                                  painter: DatasetPainter(
                                    trainingData: _trainingData,
                                    decisionBoundary: _decisionBoundary,
                                  ),
                                  size: Size.infinite,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      // 网络结构可视化
                      Expanded(
                        child: Container(
                          margin: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(8),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.1),
                                blurRadius: 4,
                              ),
                            ],
                          ),
                          child: Column(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(12),
                                child: const Text(
                                  '网络结构',
                                  style: TextStyle(fontWeight: FontWeight.bold),
                                ),
                              ),
                              Expanded(
                                child: _network != null
                                    ? CustomPaint(
                                        painter: NetworkPainter(network: _network!),
                                        size: Size.infinite,
                                      )
                                    : const Center(child: Text('初始化网络中...')),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                // 训练曲线
                Container(
                  height: 180,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border(
                      top: BorderSide(color: Colors.grey[300]!),
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: _buildChart('损失', _lossHistory, Colors.red),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: _buildChart('准确率', _accuracyHistory, Colors.green),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChart(String title, List<double> data, Color color) {
    if (data.isEmpty) {
      return Center(child: Text('$title: 暂无数据'));
    }
    
    return Column(
      children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Expanded(
          child: LineChart(
            LineChartData(
              gridData: FlGridData(show: false),
              titlesData: FlTitlesData(show: false),
              borderData: FlBorderData(show: true),
              minX: 0,
              maxX: data.length.toDouble() - 1,
              minY: 0,
              maxY: title == '损失' ? 1 : 1,
              lineBarsData: [
                LineChartBarData(
                  spots: data.asMap().entries.map((e) {
                    return FlSpot(e.key.toDouble(), e.value);
                  }).toList(),
                  isCurved: true,
                  color: color,
                  barWidth: 2,
                  dotData: FlDotData(show: false),
                  belowBarData: BarAreaData(
                    show: true,
                    color: color.withOpacity(0.1),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  String _getDatasetName(DatasetType type) {
    switch (type) {
      case DatasetType.linear: return '线性可分';
      case DatasetType.xor: return 'XOR问题';
      case DatasetType.circles: return '同心圆';
      case DatasetType.moons: return '月牙形';
      case DatasetType.spiral: return '螺旋形';
      case DatasetType.gaussian: return '高斯分布';
    }
  }
}

/// 数据集绘制器
class DatasetPainter extends CustomPainter {
  final List<DataPoint> trainingData;
  final List<List<double>>? decisionBoundary;

  DatasetPainter({
    required this.trainingData,
    this.decisionBoundary,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final scale = math.min(size.width, size.height) / 3;

    // 绘制决策边界
    if (decisionBoundary != null) {
      final resolution = decisionBoundary!.length;
      final cellWidth = size.width / resolution;
      final cellHeight = size.height / resolution;

      for (int i = 0; i < resolution; i++) {
        for (int j = 0; j < resolution; j++) {
          final value = decisionBoundary![i][j];
          final color = value < 0.5 ? Colors.blue : Colors.red;
          
          canvas.drawRect(
            Rect.fromLTWH(j * cellWidth, i * cellHeight, cellWidth, cellHeight),
            Paint()..color = color.withOpacity(0.3),
          );
        }
      }
    }

    // 绘制数据点
    for (final point in trainingData) {
      final x = center.dx + point.x * scale;
      final y = center.dy - point.y * scale;
      final color = point.label == 0 ? Colors.blue : Colors.red;
      
      canvas.drawCircle(
        Offset(x, y),
        4,
        Paint()..color = color,
      );
    }
  }

  @override
  bool shouldRepaint(DatasetPainter oldDelegate) => true;
}

/// 网络结构绘制器
class NetworkPainter extends CustomPainter {
  final NeuralNetwork network;

  NetworkPainter({required this.network});

  @override
  void paint(Canvas canvas, Size size) {
    final layerSpacing = size.width / (network.layers.length + 1);
    
    // 计算神经元位置
    final neuronPositions = <Neuron, Offset>{};
    
    for (int i = 0; i < network.layers.length; i++) {
      final layer = network.layers[i];
      final x = layerSpacing * (i + 1);
      final neuronSpacing = size.height / (layer.neurons.length + 1);
      
      for (int j = 0; j < layer.neurons.length; j++) {
        final y = neuronSpacing * (j + 1);
        neuronPositions[layer.neurons[j]] = Offset(x, y);
      }
    }

    // 绘制连接
    for (final connection in network.connections) {
      final from = neuronPositions[connection.fromNeuron];
      final to = neuronPositions[connection.toNeuron];
      
      if (from != null && to != null) {
        final weight = connection.weight;
        final color = weight > 0 ? Colors.blue : Colors.red;
        final opacity = math.min(weight.abs() * 0.5, 1.0);
        
        canvas.drawLine(
          from,
          to,
          Paint()
            ..color = color.withOpacity(opacity)
            ..strokeWidth = weight.abs() * 2,
        );
      }
    }

    // 绘制神经元
    for (final entry in neuronPositions.entries) {
      final neuron = entry.key;
      final position = entry.value;
      final activation = neuron.activation;
      
      canvas.drawCircle(
        position,
        12,
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.fill,
      );
      
      canvas.drawCircle(
        position,
        12,
        Paint()
          ..color = _getActivationColor(activation)
          ..strokeWidth = 2
          ..style = PaintingStyle.stroke,
      );
    }
  }

  Color _getActivationColor(double activation) {
    if (activation > 0.5) {
      return Colors.green;
    } else if (activation < -0.5) {
      return Colors.red;
    } else {
      return Colors.grey;
    }
  }

  @override
  bool shouldRepaint(NetworkPainter oldDelegate) => true;
}
