import 'dart:math' as math;

/// 激活函数枚举
enum ActivationFunction {
  linear,
  relu,
  sigmoid,
  tanh,
  softmax
}

/// 数据集类型枚举
enum DatasetType {
  linear,
  xor,
  circles,
  moons,
  spiral,
  gaussian
}

/// 数据点
class DataPoint {
  final double x;
  final double y;
  final int label;

  DataPoint(this.x, this.y, this.label);
}

/// 神经元连接
class Connection {
  final Neuron fromNeuron;
  final Neuron toNeuron;
  double weight;
  double gradient = 0.0;

  Connection(this.fromNeuron, this.toNeuron, this.weight);
}

/// 神经元
class Neuron {
  double output = 0.0;
  double totalInput = 0.0;
  double bias;
  double error = 0.0;
  double biasGradient = 0.0;
  final int layerIndex;
  final int index;
  final ActivationFunction activationFunction;

  Neuron({
    required this.layerIndex,
    required this.index,
    required this.activationFunction,
  }) : bias = (math.Random().nextDouble() * 2 - 1) * 0.1;
}

/// 神经网络层
class Layer {
  final List<Neuron> neurons;
  final int index;

  Layer(this.index, this.neurons);
}

/// 神经网络模型
class NeuralNetwork {
  final List<Layer> layers;
  final List<Connection> connections;
  double learningRate;

  NeuralNetwork({
    required List<int> layerSizes,
    required List<ActivationFunction> activationFunctions,
    this.learningRate = 0.01,
  }) : layers = [], connections = [] {
    // 构建层和神经元
    for (int i = 0; i < layerSizes.length; i++) {
      final neurons = <Neuron>[];
      for (int j = 0; j < layerSizes[i]; j++) {
        neurons.add(Neuron(
          layerIndex: i,
          index: j,
          activationFunction: activationFunctions[i],
        ));
      }
      layers.add(Layer(i, neurons));
    }

    // 构建连接 (全连接)
    for (int i = 0; i < layers.length - 1; i++) {
      final currentLayer = layers[i];
      final nextLayer = layers[i + 1];
      
      for (var fromNeuron in currentLayer.neurons) {
        for (var toNeuron in nextLayer.neurons) {
          connections.add(Connection(
            fromNeuron, 
            toNeuron, 
            (math.Random().nextDouble() * 2 - 1) * 0.5, // 随机权重
          ));
        }
      }
    }
  }

  /// 前向传播
  List<double> forward(List<double> inputs) {
    // 设置输入层
    final inputLayer = layers.first;
    for (int i = 0; i < inputLayer.neurons.length; i++) {
      inputLayer.neurons[i].output = inputs[i];
    }

    // 逐层传播
    for (int i = 1; i < layers.length; i++) {
      final layer = layers[i];
      final prevLayer = layers[i - 1];

      for (var neuron in layer.neurons) {
        double sum = neuron.bias;
        
        // 查找所有指向该神经元的连接
        // 优化: 预先索引连接可以提高性能，这里简单遍历验证逻辑
        for (var conn in connections) {
          if (conn.toNeuron == neuron) {
            sum += conn.fromNeuron.output * conn.weight;
          }
        }
        
        neuron.totalInput = sum;
        neuron.output = _activate(sum, neuron.activationFunction);
      }
      
      // 如果是 Softmax，需要在层级别进行处理
      if (layer.neurons.isNotEmpty && 
          layer.neurons.first.activationFunction == ActivationFunction.softmax) {
        double sumExp = 0.0;
        for (var n in layer.neurons) {
          sumExp += math.exp(n.totalInput);
        }
        for (var n in layer.neurons) {
          n.output = math.exp(n.totalInput) / sumExp;
        }
      }
    }

    return layers.last.neurons.map((n) => n.output).toList();
  }

  /// 批量训练
  /// 返回 {loss, accuracy}
  TrainingResult trainBatch(List<DataPoint> data, List<List<double>> targets) {
    double totalLoss = 0.0;
    int correctCount = 0;

    // 清零梯度
    for (var conn in connections) conn.gradient = 0.0;
    for (var layer in layers) {
      for (var neuron in layer.neurons) neuron.biasGradient = 0.0;
    }

    for (int i = 0; i < data.length; i++) {
      final point = data[i];
      final target = targets[i];
      
      // 前向传播
      final outputs = forward([point.x, point.y]);
      
      // 计算损失 (Cross Entropy or MSE)
      // 简单起见，这里假设是分类任务，使用 Cross Entropy
      // 如果输出层是 Softmax，通常配合 Cross Entropy
      // 如果输出层是 Linear，通常配合 MSE
      
      // 这里的实现简化，假设分类任务取最大值判断准确率
      int predictedLabel = 0;
      double maxVal = outputs[0];
      for(int k=1; k<outputs.length; k++) {
        if(outputs[k] > maxVal) {
          maxVal = outputs[k];
          predictedLabel = k;
        }
      }
      if (predictedLabel == point.label) correctCount++;
      
      // 计算误差并反向传播
      _backpropagate(target);
      
      // 累加梯度 (Batch Gradient Descent)
      // 注意: _backpropagate 中已经计算了每个神经元的 error
      // 我们需要将梯度累加到 connection.gradient 和 neuron.biasGradient
      _accumulateGradients();
      
      // 简单计算 MSE 作为 Loss 用于显示
      double sampleLoss = 0.0;
      for (int k = 0; k < outputs.length; k++) {
        sampleLoss += 0.5 * math.pow(outputs[k] - target[k], 2);
      }
      totalLoss += sampleLoss;
    }

    // 更新权重
    _updateWeights(data.length);

    return TrainingResult(
      loss: totalLoss / data.length,
      accuracy: correctCount / data.length,
    );
  }
  
  void _backpropagate(List<double> target) {
    // 输出层误差
    final outputLayer = layers.last;
    for (int i = 0; i < outputLayer.neurons.length; i++) {
        final neuron = outputLayer.neurons[i];
        // 假设损失函数是 MSE: dLoss/dOutput = (Output - Target)
        // dOutput/dInput = activation_derivative(totalInput)
        // Error = (Output - Target) * derivative
        
        // 如果是 Softmax + CrossEntropy，此时 error 简化为 (Output - Target)
        // 这里为了通用性，暂时使用 MSE 推导
        double derivative = _activateDerivative(neuron.totalInput, neuron.activationFunction);
        neuron.error = (neuron.output - target[i]) * derivative;
    }

    // 隐藏层误差
    for (int i = layers.length - 2; i > 0; i--) {
        final layer = layers[i];
        final nextLayer = layers[i + 1];
        
        for (var neuron in layer.neurons) {
            double sumError = 0.0;
            for (var conn in connections) {
                if (conn.fromNeuron == neuron) {
                    sumError += conn.toNeuron.error * conn.weight;
                }
            }
            double derivative = _activateDerivative(neuron.totalInput, neuron.activationFunction);
            neuron.error = sumError * derivative;
        }
    }
  }

  void _accumulateGradients() {
      for (var conn in connections) {
          conn.gradient += conn.toNeuron.error * conn.fromNeuron.output;
      }
      for (var layer in layers) {
          for (var neuron in layer.neurons) {
              neuron.biasGradient += neuron.error;
          }
      }
  }
  
  void _updateWeights(int batchSize) {
      for (var conn in connections) {
          conn.weight -= learningRate * (conn.gradient / batchSize);
      }
      for (var layer in layers) {
          for (var neuron in layer.neurons) {
              neuron.bias -= learningRate * (neuron.biasGradient / batchSize);
          }
      }
  }
  

  /// 生成网格预测 (用于决策边界)
  List<List<double>> predictGrid({
    required double minX,
    required double maxX,
    required double minY,
    required double maxY,
    required int resolution,
  }) {
    final grid = List.generate(resolution, (_) => List.filled(resolution, 0.0));
    final stepX = (maxX - minX) / resolution;
    final stepY = (maxY - minY) / resolution;

    for (int i = 0; i < resolution; i++) {
      for (int j = 0; j < resolution; j++) {
        final x = minX + j * stepX;
        final y = maxY - i * stepY; // 注意索引方向，通常图像坐标 y 向下
        
        final outputs = forward([x, y]);
        // 假设是二分类，取第一个输出或者 softmax 的最大类
        // 如果输出层只有一个神经元，阈值为 0.5
        // 如果有两个神经元，取 outputs[1] 或做 diff
        if (outputs.length == 1) {
            grid[i][j] = outputs[0];
        } else {
            // 简单的热力图可视化: 使用第一类的概率，或者 (P(class1) - P(class0) + 1)/2
            grid[i][j] = outputs[0]; // 简化
        }
      }
    }
    return grid;
  }

  double _activate(double x, ActivationFunction func) {
    switch (func) {
      case ActivationFunction.linear: return x;
      case ActivationFunction.relu: return math.max(0, x);
      case ActivationFunction.sigmoid: return 1 / (1 + math.exp(-x));
      case ActivationFunction.tanh: return (math.exp(x) - math.exp(-x)) / (math.exp(x) + math.exp(-x));
      case ActivationFunction.softmax: return x; // Softmax 单独处理
    }
  }

  double _activateDerivative(double x, ActivationFunction func) {
    switch (func) {
      case ActivationFunction.linear: return 1;
      case ActivationFunction.relu: return x > 0 ? 1 : 0;
      case ActivationFunction.sigmoid: 
        final s = 1 / (1 + math.exp(-x));
        return s * (1 - s);
      case ActivationFunction.tanh:
        final t = (math.exp(x) - math.exp(-x)) / (math.exp(x) + math.exp(-x));
        return 1 - t * t;
      case ActivationFunction.softmax: return 1; // Softmax 导数复杂，通常结合 Loss 计算
    }
  }
}

class TrainingResult {
  final double loss;
  final double accuracy;
  TrainingResult({required this.loss, required this.accuracy});
}

/// 数据集生成器
class DatasetGenerator {
  static List<DataPoint> generate(DatasetType type, {int samples = 200}) {
    final points = <DataPoint>[];
    final random = math.Random();

    switch (type) {
      case DatasetType.linear:
        for (int i = 0; i < samples; i++) {
          final x = random.nextDouble() * 2 - 1;
          final y = random.nextDouble() * 2 - 1;
          final label = (y > x + 0.1) ? 1 : 0; // 增加间隔
          points.add(DataPoint(x, y, label));
        }
        break;
        
      case DatasetType.xor:
        for (int i = 0; i < samples; i++) {
          final x = random.nextDouble() * 2 - 1;
          final y = random.nextDouble() * 2 - 1;
          final label = (x > 0 && y > 0) || (x < 0 && y < 0) ? 1 : 0;
          points.add(DataPoint(x, y, label));
        }
        break;
        
      case DatasetType.circles:
        for (int i = 0; i < samples; i++) {
          final angle = random.nextDouble() * 2 * math.pi;
          final r1 = random.nextDouble() * 0.5;
          final r2 = random.nextDouble() * 0.5 + 0.8;
          
          if (i % 2 == 0) {
            points.add(DataPoint(r1 * math.cos(angle), r1 * math.sin(angle), 0));
          } else {
            points.add(DataPoint(r2 * math.cos(angle), r2 * math.sin(angle), 1));
          }
        }
        break;
        
      case DatasetType.moons:
        // 简化版双月
        for (int i = 0; i < samples ~/ 2; i++) {
            points.add(DataPoint(math.cos(i/10)*0.8 + 0.5, math.sin(i/10)*0.8, 0));
            points.add(DataPoint(math.cos(i/10)*0.8 - 0.5, 0.5 - math.sin(i/10)*0.8, 1));
        }
        break;
        
      case DatasetType.spiral:
        // 简化螺旋 (通常需要更复杂的公式)
         for (int i = 0; i < samples; i++) {
            final t = i / samples * 4 * math.pi;
            final r = i / samples;
            final group = i % 2;
            final offset = group * math.pi;
             points.add(DataPoint(
                 r * math.cos(t + offset), 
                 r * math.sin(t + offset),
                 group
             ));
         }
        break;
        
      default: // Gaussian
        for (int i = 0; i < samples; i++) {
             // 简单的高斯分布模拟
             final group = i % 2;
             final centerX = group == 0 ? -0.5 : 0.5;
             final centerY = group == 0 ? -0.5 : 0.5;
             points.add(DataPoint(
                 centerX + random.nextDouble()*0.6 - 0.3,
                 centerY + random.nextDouble()*0.6 - 0.3,
                 group
             ));
         }
    }
    
    return points;
  }
}
