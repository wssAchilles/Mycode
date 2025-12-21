import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'dart:math' as math;

/// 反向传播可视化器
class BackpropagationVisualizer extends StatefulWidget {
  const BackpropagationVisualizer({Key? key}) : super(key: key);

  @override
  State<BackpropagationVisualizer> createState() => _BackpropagationVisualizerState();
}

class _BackpropagationVisualizerState extends State<BackpropagationVisualizer>
    with TickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _animation;
  
  // 网络结构
  final List<int> _networkLayers = [3, 4, 2]; // 输入层3个，隐藏层4个，输出层2个
  List<List<List<double>>> _weights = []; // 三维数组：[层][神经元][权重]
  List<List<double>> _biases = [];
  List<List<double>> _activations = [];
  List<List<double>> _errors = [];
  
  // 训练数据
  final List<double> _inputData = [0.5, 0.8, 0.3];
  final List<double> _targetData = [0.9, 0.1];
  
  bool _isTraining = false;
  int _currentStep = 0;
  double _learningRate = 0.1;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    );
    _animation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    );
    
    _initializeNetwork();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  void _initializeNetwork() {
    // 初始化权重和偏置
    _weights = [];
    _biases = [];
    _activations = [];
    _errors = [];
    
    for (int i = 0; i < _networkLayers.length; i++) {
      _activations.add(List.filled(_networkLayers[i], 0.0));
      _errors.add(List.filled(_networkLayers[i], 0.0));
      
      if (i > 0) {
        // 权重矩阵
        _weights.add(List.generate(_networkLayers[i], (j) =>
            List.generate(_networkLayers[i-1], (k) =>
                (math.Random().nextDouble() - 0.5) * 2)));
        
        // 偏置
        _biases.add(List.generate(_networkLayers[i], (j) =>
            (math.Random().nextDouble() - 0.5) * 2));
      }
    }
    
    // 设置输入层激活值
    for (int i = 0; i < _inputData.length; i++) {
      _activations[0][i] = _inputData[i];
    }
  }

  void _startTraining() async {
    setState(() {
      _isTraining = true;
      _currentStep = 0;
    });
    
    // 前向传播
    await _forwardPropagation();
    
    // 反向传播
    await _backwardPropagation();
    
    setState(() {
      _isTraining = false;
    });
  }

  Future<void> _forwardPropagation() async {
    for (int layer = 1; layer < _networkLayers.length; layer++) {
      await Future.delayed(const Duration(milliseconds: 800));
      
      for (int neuron = 0; neuron < _networkLayers[layer]; neuron++) {
        double sum = _biases[layer-1][neuron];
        
        for (int prevNeuron = 0; prevNeuron < _networkLayers[layer-1]; prevNeuron++) {
          sum += _activations[layer-1][prevNeuron] * _weights[layer-1][neuron][prevNeuron];
        }
        
        // Sigmoid激活函数
        _activations[layer][neuron] = 1.0 / (1.0 + math.exp(-sum));
      }
      
      setState(() {
        _currentStep++;
      });
      
      _animationController.forward().then((_) => _animationController.reset());
    }
  }

  Future<void> _backwardPropagation() async {
    // 计算输出层误差
    int outputLayer = _networkLayers.length - 1;
    for (int i = 0; i < _networkLayers[outputLayer]; i++) {
      double output = _activations[outputLayer][i];
      _errors[outputLayer][i] = (output - _targetData[i]) * output * (1 - output);
    }
    
    setState(() {
      _currentStep++;
    });
    await Future.delayed(const Duration(milliseconds: 800));
    
    // 反向传播误差
    for (int layer = outputLayer - 1; layer > 0; layer--) {
      for (int neuron = 0; neuron < _networkLayers[layer]; neuron++) {
        double error = 0.0;
        
        for (int nextNeuron = 0; nextNeuron < _networkLayers[layer + 1]; nextNeuron++) {
          error += _errors[layer + 1][nextNeuron] * _weights[layer][nextNeuron][neuron];
        }
        
        double output = _activations[layer][neuron];
        _errors[layer][neuron] = error * output * (1 - output);
      }
      
      setState(() {
        _currentStep++;
      });
      await Future.delayed(const Duration(milliseconds: 800));
    }
    
    // 更新权重和偏置
    for (int layer = 0; layer < _weights.length; layer++) {
      for (int neuron = 0; neuron < _weights[layer].length; neuron++) {
        for (int prevNeuron = 0; prevNeuron < _weights[layer][neuron].length; prevNeuron++) {
          _weights[layer][neuron][prevNeuron] -= 
              _learningRate * _errors[layer + 1][neuron] * _activations[layer][prevNeuron];
        }
        _biases[layer][neuron] -= _learningRate * _errors[layer + 1][neuron];
      }
    }
    
    setState(() {
      _currentStep++;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('反向传播可视化'),
        backgroundColor: Theme.of(context).primaryColor,
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            // 控制面板
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  children: [
                    Row(
                      children: [
                        const Text('学习率: '),
                        Expanded(
                          child: Slider(
                            value: _learningRate,
                            min: 0.01,
                            max: 1.0,
                            divisions: 99,
                            label: _learningRate.toStringAsFixed(2),
                            onChanged: (value) {
                              setState(() {
                                _learningRate = value;
                              });
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        ElevatedButton(
                          onPressed: _isTraining ? null : _initializeNetwork,
                          child: const Text('重置网络'),
                        ),
                        ElevatedButton(
                          onPressed: _isTraining ? null : _startTraining,
                          child: Text(_isTraining ? '训练中...' : '开始训练'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            
            const SizedBox(height: 20),
            
            // 网络可视化
            Expanded(
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: CustomPaint(
                    size: Size.infinite,
                    painter: NetworkPainter(
                      networkLayers: _networkLayers,
                      activations: _activations,
                      errors: _errors,
                      weights: _weights,
                      animation: _animation,
                      currentStep: _currentStep,
                    ),
                  ),
                ),
              ),
            ),
            
            // 训练信息
            if (_isTraining || _currentStep > 0)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('训练步骤: $_currentStep'),
                      const SizedBox(height: 8),
                      if (_activations.isNotEmpty && _activations.last.isNotEmpty)
                        Text('输出: ${_activations.last.map((a) => a.toStringAsFixed(3)).join(', ')}'),
                      const SizedBox(height: 4),
                      Text('目标: ${_targetData.map((t) => t.toStringAsFixed(3)).join(', ')}'),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 网络绘制器
class NetworkPainter extends CustomPainter {
  final List<int> networkLayers;
  final List<List<double>> activations;
  final List<List<double>> errors;
  final List<List<List<double>>> weights;
  final Animation<double> animation;
  final int currentStep;

  NetworkPainter({
    required this.networkLayers,
    required this.activations,
    required this.errors,
    required this.weights,
    required this.animation,
    required this.currentStep,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..style = PaintingStyle.fill;
    final linePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    final double layerWidth = size.width / networkLayers.length;
    
    // 绘制连接线
    for (int layer = 0; layer < networkLayers.length - 1; layer++) {
      final double x1 = (layer + 0.5) * layerWidth;
      final double x2 = (layer + 1.5) * layerWidth;
      
      for (int neuron = 0; neuron < networkLayers[layer]; neuron++) {
        final double y1 = (neuron + 0.5) * (size.height / networkLayers[layer]);
        
        for (int nextNeuron = 0; nextNeuron < networkLayers[layer + 1]; nextNeuron++) {
          final double y2 = (nextNeuron + 0.5) * (size.height / networkLayers[layer + 1]);
          
          // 根据权重设置线条颜色和粗细
          if (weights.isNotEmpty && layer < weights.length && 
              nextNeuron < weights[layer].length &&
              neuron < weights[layer][nextNeuron].length) {
            final double weight = weights[layer][nextNeuron][neuron];
            linePaint.color = weight > 0 ? Colors.blue : Colors.red;
            linePaint.strokeWidth = (weight.abs() * 3).clamp(0.5, 3.0);
          } else {
            linePaint.color = Colors.grey;
            linePaint.strokeWidth = 1.0;
          }
          
          canvas.drawLine(Offset(x1, y1), Offset(x2, y2), linePaint);
        }
      }
    }
    
    // 绘制神经元
    for (int layer = 0; layer < networkLayers.length; layer++) {
      final double x = (layer + 0.5) * layerWidth;
      
      for (int neuron = 0; neuron < networkLayers[layer]; neuron++) {
        final double y = (neuron + 0.5) * (size.height / networkLayers[layer]);
        
        // 根据激活值设置颜色
        if (activations.isNotEmpty && layer < activations.length && neuron < activations[layer].length) {
          final double activation = activations[layer][neuron];
          paint.color = Color.lerp(Colors.white, Colors.blue, activation) ?? Colors.white;
        } else {
          paint.color = Colors.grey;
        }
        
        canvas.drawCircle(Offset(x, y), 20, paint);
        
        // 绘制边框
        paint
          ..color = Colors.black
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2;
        canvas.drawCircle(Offset(x, y), 20, paint);
        paint.style = PaintingStyle.fill;
        
        // 绘制激活值
        if (activations.isNotEmpty && layer < activations.length && neuron < activations[layer].length) {
          final textPainter = TextPainter(
            text: TextSpan(
              text: activations[layer][neuron].toStringAsFixed(2),
              style: const TextStyle(color: Colors.black, fontSize: 10),
            ),
            textDirection: TextDirection.ltr,
          )..layout();
          
          textPainter.paint(
            canvas,
            Offset(x - textPainter.width / 2, y - textPainter.height / 2),
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(NetworkPainter oldDelegate) {
    return oldDelegate.animation.value != animation.value ||
        oldDelegate.currentStep != currentStep;
  }
}
