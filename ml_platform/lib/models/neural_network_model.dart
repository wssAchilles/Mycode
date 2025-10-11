import 'dart:math' as math;
import 'dart:math' show abs, exp;

/// 神经元
class Neuron {
  final String id;
  final int layer;
  final int index;
  double value;
  double bias;
  double activation;
  double gradient;
  final List<Connection> inputConnections;
  final List<Connection> outputConnections;

  Neuron({
    required this.id,
    required this.layer,
    required this.index,
    this.value = 0.0,
    this.bias = 0.0,
    this.activation = 0.0,
    this.gradient = 0.0,
    List<Connection>? inputConnections,
    List<Connection>? outputConnections,
  })  : inputConnections = inputConnections ?? [],
        outputConnections = outputConnections ?? [];

  void reset() {
    value = 0.0;
    activation = 0.0;
    gradient = 0.0;
  }
}

/// 连接（权重）
class Connection {
  final String id;
  final Neuron fromNeuron;
  final Neuron toNeuron;
  double weight;
  double gradient;
  double deltaWeight;

  Connection({
    required this.id,
    required this.fromNeuron,
    required this.toNeuron,
    double? weight,
    this.gradient = 0.0,
    this.deltaWeight = 0.0,
  }) : weight = weight ?? (math.Random().nextDouble() * 2 - 1) * 0.5;

  void reset() {
    gradient = 0.0;
    deltaWeight = 0.0;
  }
}

/// 网络层
class NetworkLayer {
  final int index;
  final List<Neuron> neurons;
  final ActivationFunction activationFunction;

  NetworkLayer({
    required this.index,
    required this.neurons,
    required this.activationFunction,
  });

  void reset() {
    for (final neuron in neurons) {
      neuron.reset();
    }
  }
}

/// 激活函数类型
enum ActivationFunction {
  linear,
  relu,
  sigmoid,
  tanh,
  softmax,
}

/// 激活函数实现
class Activation {
  static double compute(double x, ActivationFunction type) {
    switch (type) {
      case ActivationFunction.linear:
        return x;
      case ActivationFunction.relu:
        return math.max(0, x);
      case ActivationFunction.sigmoid:
        return 1 / (1 + math.exp(-x));
      case ActivationFunction.tanh:
        return math.tanh(x);
      case ActivationFunction.softmax:
        // Softmax需要整层计算，这里返回原值
        return x;
    }
  }

  static double derivative(double x, ActivationFunction type) {
    switch (type) {
      case ActivationFunction.linear:
        return 1.0;
      case ActivationFunction.relu:
        return x > 0 ? 1.0 : 0.0;
      case ActivationFunction.sigmoid:
        final sig = compute(x, ActivationFunction.sigmoid);
        return sig * (1 - sig);
      case ActivationFunction.tanh:
        final t = compute(x, ActivationFunction.tanh);
        return 1 - t * t;
      case ActivationFunction.softmax:
        return x * (1 - x);
    }
  }

  static List<double> softmax(List<double> values) {
    final max = values.reduce(math.max);
    final exps = values.map((v) => math.exp(v - max)).toList();
    final sum = exps.reduce((a, b) => a + b);
    return exps.map((e) => e / sum).toList();
  }
}

/// 数据集类型
enum DatasetType {
  linear,     // 线性可分
  xor,        // XOR问题
  circles,    // 同心圆
  moons,      // 月牙形
  spiral,     // 螺旋形
  gaussian,   // 高斯分布
}

/// 训练数据点
class DataPoint {
  final double x;
  final double y;
  final int label;

  DataPoint({
    required this.x,
    required this.y,
    required this.label,
  });
}

/// 神经网络模型
class NeuralNetwork {
  final List<NetworkLayer> layers;
  final List<Connection> connections;
  double learningRate;
  double momentum;
  final math.Random random;

  NeuralNetwork({
    required List<int> layerSizes,
    required List<ActivationFunction> activationFunctions,
    this.learningRate = 0.01,
    this.momentum = 0.0,
    math.Random? random,
  })  : layers = [],
        connections = [],
        random = random ?? math.Random() {
    // 创建网络层和神经元
    for (int i = 0; i < layerSizes.length; i++) {
      final neurons = <Neuron>[];
      for (int j = 0; j < layerSizes[i]; j++) {
        neurons.add(Neuron(
          id: 'n_${i}_$j',
          layer: i,
          index: j,
          bias: (this.random.nextDouble() * 2 - 1) * 0.1,
        ));
      }
      layers.add(NetworkLayer(
        index: i,
        neurons: neurons,
        activationFunction: i < activationFunctions.length
            ? activationFunctions[i]
            : ActivationFunction.linear,
      ));
    }

    // 创建连接
    for (int i = 0; i < layers.length - 1; i++) {
      final fromLayer = layers[i];
      final toLayer = layers[i + 1];

      for (final fromNeuron in fromLayer.neurons) {
        for (final toNeuron in toLayer.neurons) {
          final connection = Connection(
            id: 'c_${fromNeuron.id}_${toNeuron.id}',
            fromNeuron: fromNeuron,
            toNeuron: toNeuron,
            weight: (this.random.nextDouble() * 2 - 1) *
                math.sqrt(2.0 / fromLayer.neurons.length),
          );
          connections.add(connection);
          fromNeuron.outputConnections.add(connection);
          toNeuron.inputConnections.add(connection);
        }
      }
    }
  }

  /// 前向传播
  List<double> forward(List<double> inputs) {
    // 设置输入层
    final inputLayer = layers.first;
    for (int i = 0; i < inputLayer.neurons.length && i < inputs.length; i++) {
      inputLayer.neurons[i].value = inputs[i];
      inputLayer.neurons[i].activation = inputs[i];
    }

    // 逐层传播
    for (int i = 1; i < layers.length; i++) {
      final layer = layers[i];
      
      for (final neuron in layer.neurons) {
        // 计算加权和
        double sum = neuron.bias;
        for (final connection in neuron.inputConnections) {
          sum += connection.fromNeuron.activation * connection.weight;
        }
        neuron.value = sum;

        // 应用激活函数
        if (layer.activationFunction == ActivationFunction.softmax &&
            i == layers.length - 1) {
          // Softmax需要特殊处理
          continue;
        } else {
          neuron.activation = Activation.compute(sum, layer.activationFunction);
        }
      }

      // 处理Softmax
      if (layer.activationFunction == ActivationFunction.softmax &&
          i == layers.length - 1) {
        final values = layer.neurons.map((n) => n.value).toList();
        final softmaxValues = Activation.softmax(values);
        for (int j = 0; j < layer.neurons.length; j++) {
          layer.neurons[j].activation = softmaxValues[j];
        }
      }
    }

    // 返回输出
    return layers.last.neurons.map((n) => n.activation).toList();
  }

  /// 反向传播
  void backward(List<double> targets) {
    // 计算输出层误差
    final outputLayer = layers.last;
    for (int i = 0; i < outputLayer.neurons.length; i++) {
      final neuron = outputLayer.neurons[i];
      final error = targets[i] - neuron.activation;
      
      if (outputLayer.activationFunction == ActivationFunction.softmax) {
        // Softmax的导数已经包含在误差中
        neuron.gradient = error;
      } else {
        neuron.gradient = error * Activation.derivative(
          neuron.value,
          outputLayer.activationFunction,
        );
      }
    }

    // 反向传播误差
    for (int i = layers.length - 2; i >= 0; i--) {
      final layer = layers[i];
      
      for (final neuron in layer.neurons) {
        double error = 0.0;
        for (final connection in neuron.outputConnections) {
          error += connection.weight * connection.toNeuron.gradient;
        }
        
        if (i > 0) {  // 输入层不需要计算梯度
          neuron.gradient = error * Activation.derivative(
            neuron.value,
            layer.activationFunction,
          );
        }
      }
    }

    // 更新权重和偏置
    for (final connection in connections) {
      final gradient = connection.fromNeuron.activation *
          connection.toNeuron.gradient;
      connection.gradient = gradient;
      
      // 使用动量
      connection.deltaWeight = learningRate * gradient +
          momentum * connection.deltaWeight;
      connection.weight += connection.deltaWeight;
    }

    // 更新偏置
    for (int i = 1; i < layers.length; i++) {
      for (final neuron in layers[i].neurons) {
        neuron.bias += learningRate * neuron.gradient;
      }
    }
  }

  /// 训练一个批次
  TrainingResult trainBatch(List<DataPoint> data, List<List<double>> targets) {
    double totalLoss = 0.0;
    int correct = 0;

    for (int i = 0; i < data.length; i++) {
      final input = [data[i].x, data[i].y];
      final target = targets[i];
      
      // 前向传播
      final output = forward(input);
      
      // 计算损失
      double loss = 0.0;
      for (int j = 0; j < output.length; j++) {
        loss += math.pow(target[j] - output[j], 2);
      }
      totalLoss += loss / output.length;
      
      // 计算准确率
      if (output.length == 1) {
        // 二分类
        final predicted = output[0] > 0.5 ? 1 : 0;
        if (predicted == data[i].label) correct++;
      } else {
        // 多分类
        int maxIndex = 0;
        double maxValue = output[0];
        for (int j = 1; j < output.length; j++) {
          if (output[j] > maxValue) {
            maxValue = output[j];
            maxIndex = j;
          }
        }
        if (maxIndex == data[i].label) correct++;
      }
      
      // 反向传播
      backward(target);
    }

    return TrainingResult(
      loss: totalLoss / data.length,
      accuracy: correct / data.length,
    );
  }

  /// 预测决策边界
  List<List<double>> predictGrid({
    required double minX,
    required double maxX,
    required double minY,
    required double maxY,
    required int resolution,
  }) {
    final grid = <List<double>>[];
    final stepX = (maxX - minX) / resolution;
    final stepY = (maxY - minY) / resolution;

    for (int i = 0; i < resolution; i++) {
      final row = <double>[];
      for (int j = 0; j < resolution; j++) {
        final x = minX + j * stepX;
        final y = minY + i * stepY;
        final output = forward([x, y]);
        
        // 转换为概率或类别
        if (output.length == 1) {
          row.add(output[0]);
        } else {
          // 多分类，返回最大概率的类别索引
          int maxIndex = 0;
          double maxValue = output[0];
          for (int k = 1; k < output.length; k++) {
            if (output[k] > maxValue) {
              maxValue = output[k];
              maxIndex = k;
            }
          }
          row.add(maxIndex.toDouble());
        }
      }
      grid.add(row);
    }

    return grid;
  }

  /// 重置网络
  void reset() {
    for (final layer in layers) {
      layer.reset();
    }
    for (final connection in connections) {
      connection.reset();
    }
  }
}

/// 训练结果
class TrainingResult {
  final double loss;
  final double accuracy;

  TrainingResult({
    required this.loss,
    required this.accuracy,
  });
}

/// 数据集生成器
class DatasetGenerator {
  static List<DataPoint> generate(DatasetType type, {int samples = 200}) {
    final random = math.Random();
    final points = <DataPoint>[];

    switch (type) {
      case DatasetType.linear:
        // 线性可分数据
        for (int i = 0; i < samples; i++) {
          final x = random.nextDouble() * 2 - 1;
          final y = random.nextDouble() * 2 - 1;
          final label = y > x * 0.5 + 0.2 ? 1 : 0;
          points.add(DataPoint(x: x, y: y, label: label));
        }
        break;

      case DatasetType.xor:
        // XOR问题
        for (int i = 0; i < samples; i++) {
          final x = random.nextDouble() * 2 - 1;
          final y = random.nextDouble() * 2 - 1;
          final label = (x * y > 0) ? 1 : 0;
          points.add(DataPoint(x: x, y: y, label: label));
        }
        break;

      case DatasetType.circles:
        // 同心圆
        for (int i = 0; i < samples; i++) {
          final angle = random.nextDouble() * 2 * math.pi;
          final r = i < samples / 2
              ? random.nextDouble() * 0.4
              : 0.6 + random.nextDouble() * 0.4;
          final x = r * math.cos(angle);
          final y = r * math.sin(angle);
          final label = i < samples / 2 ? 0 : 1;
          points.add(DataPoint(x: x, y: y, label: label));
        }
        break;

      case DatasetType.moons:
        // 月牙形
        for (int i = 0; i < samples; i++) {
          if (i < samples / 2) {
            final angle = random.nextDouble() * math.pi;
            final x = math.cos(angle) + random.nextGaussian() * 0.1;
            final y = math.sin(angle) + random.nextGaussian() * 0.1;
            points.add(DataPoint(x: x, y: y, label: 0));
          } else {
            final angle = random.nextDouble() * math.pi;
            final x = 1 - math.cos(angle) + random.nextGaussian() * 0.1;
            final y = 0.5 - math.sin(angle) + random.nextGaussian() * 0.1;
            points.add(DataPoint(x: x, y: y, label: 1));
          }
        }
        break;

      case DatasetType.spiral:
        // 螺旋形
        for (int i = 0; i < samples; i++) {
          final n = i % 2;
          final r = i / samples * 0.8 + random.nextDouble() * 0.1;
          final angle = (i / samples) * 4 * math.pi + n * math.pi;
          final x = r * math.cos(angle) + random.nextGaussian() * 0.02;
          final y = r * math.sin(angle) + random.nextGaussian() * 0.02;
          points.add(DataPoint(x: x, y: y, label: n));
        }
        break;

      case DatasetType.gaussian:
        // 高斯分布
        for (int i = 0; i < samples; i++) {
          final label = i % 2;
          final centerX = label == 0 ? -0.5 : 0.5;
          final centerY = label == 0 ? 0.5 : -0.5;
          final x = centerX + random.nextGaussian() * 0.3;
          final y = centerY + random.nextGaussian() * 0.3;
          points.add(DataPoint(x: x, y: y, label: label));
        }
        break;
    }

    // 归一化到[-1, 1]
    double minX = points.first.x, maxX = points.first.x;
    double minY = points.first.y, maxY = points.first.y;
    
    for (final point in points) {
      minX = math.min(minX, point.x);
      maxX = math.max(maxX, point.x);
      minY = math.min(minY, point.y);
      maxY = math.max(maxY, point.y);
    }

    final normalizedPoints = <DataPoint>[];
    for (final point in points) {
      normalizedPoints.add(DataPoint(
        x: 2 * (point.x - minX) / (maxX - minX) - 1,
        y: 2 * (point.y - minY) / (maxY - minY) - 1,
        label: point.label,
      ));
    }

    return normalizedPoints;
  }
}

// 扩展Random类以支持高斯分布
extension RandomExtension on math.Random {
  double nextGaussian() {
    double u1 = nextDouble();
    double u2 = nextDouble();
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2);
  }
}
