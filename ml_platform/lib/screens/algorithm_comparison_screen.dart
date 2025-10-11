// 算法对比页面
import 'package:flutter/material.dart';
import 'package:ml_platform/widgets/algorithm_comparison.dart';

class AlgorithmComparisonScreen extends StatelessWidget {
  const AlgorithmComparisonScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('算法性能对比'),
        elevation: 0,
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: const AlgorithmComparison(),
    );
  }
}
