// 银行家算法可视化组件
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/banker_model.dart';

/// 银行家算法矩阵可视化器
class BankerMatrixVisualizer extends StatelessWidget {
  final BankerState state;
  final int? highlightProcess;
  final bool showNeedCalculation;
  
  const BankerMatrixVisualizer({
    Key? key,
    required this.state,
    this.highlightProcess,
    this.showNeedCalculation = false,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Max矩阵
        Expanded(
          child: _buildMatrix(
            theme,
            'Max (最大需求)',
            state.max,
            Colors.blue,
          ),
        ),
        if (showNeedCalculation) ...[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 40),
            child: Icon(Icons.remove, color: theme.primaryColor, size: 24),
          ),
        ],
        // Allocation矩阵
        Expanded(
          child: _buildMatrix(
            theme,
            'Allocation (已分配)',
            state.allocation,
            Colors.green,
          ),
        ),
        if (showNeedCalculation) ...[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 40),
            child: Icon(Icons.arrow_forward, color: theme.primaryColor, size: 24),
          ),
        ],
        // Need矩阵
        Expanded(
          child: _buildMatrix(
            theme,
            'Need (需求)',
            state.need,
            Colors.orange,
          ),
        ),
      ],
    );
  }
  
  Widget _buildMatrix(
    ThemeData theme,
    String title,
    List<List<int>> matrix,
    Color color,
  ) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            const SizedBox(height: 12),
            Table(
              border: TableBorder.all(
                color: Colors.grey.shade300,
                width: 1,
              ),
              defaultColumnWidth: const IntrinsicColumnWidth(),
              children: [
                // 表头
                TableRow(
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                  ),
                  children: [
                    _buildCell('进程', isHeader: true),
                    ...state.resourceNames.map((name) => 
                        _buildCell(name, isHeader: true)),
                  ],
                ),
                // 数据行
                ...List.generate(state.processCount, (i) {
                  final isHighlighted = highlightProcess == i;
                  return TableRow(
                    decoration: BoxDecoration(
                      color: isHighlighted 
                          ? Colors.yellow.withOpacity(0.3)
                          : null,
                    ),
                    children: [
                      _buildCell(
                        state.processNames[i],
                        isHeader: true,
                        color: isHighlighted ? Colors.orange : null,
                      ),
                      ...matrix[i].map((value) => 
                          _buildCell(
                            value.toString(),
                            color: isHighlighted ? Colors.orange : null,
                          )),
                    ],
                  );
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildCell(String text, {bool isHeader = false, Color? color}) {
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(
          fontWeight: isHeader ? FontWeight.bold : FontWeight.normal,
          color: color,
        ),
      ),
    );
  }
}

/// Available向量可视化器
class AvailableVectorVisualizer extends StatelessWidget {
  final BankerState state;
  final List<int>? workVector;
  final bool showAnimation;
  
  const AvailableVectorVisualizer({
    Key? key,
    required this.state,
    this.workVector,
    this.showAnimation = false,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final vector = workVector ?? state.available;
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              workVector != null ? 'Work 向量' : 'Available 向量',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: Colors.purple,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(state.resourceCount, (i) {
                return _buildResourceItem(
                  state.resourceNames[i],
                  vector[i],
                  theme,
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildResourceItem(String name, int value, ThemeData theme) {
    return AnimatedContainer(
      duration: Duration(milliseconds: showAnimation ? 500 : 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.purple.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: Colors.purple.shade300,
          width: 2,
        ),
      ),
      child: Column(
        children: [
          Text(
            name,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value.toString(),
            style: theme.textTheme.headlineSmall?.copyWith(
              color: Colors.purple,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

/// 安全性检查步骤可视化器
class SafetyCheckStepVisualizer extends StatelessWidget {
  final SafetyCheckStep step;
  final BankerState state;
  
  const SafetyCheckStepVisualizer({
    Key? key,
    required this.step,
    required this.state,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 步骤标题
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: step.type.color.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _getStepIcon(step.type),
                        color: step.type.color,
                        size: 16,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '步骤 ${step.stepNumber}',
                        style: TextStyle(
                          color: step.type.color,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    step.description,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            
            // Work向量
            _buildVectorDisplay('Work', step.work),
            const SizedBox(height: 12),
            
            // Finish向量
            _buildFinishVector(step.finish),
            
            // 安全序列
            if (step.safeSequence.isNotEmpty) ...[
              const SizedBox(height: 12),
              _buildSafeSequence(step.safeSequence),
            ],
          ],
        ),
      ),
    );
  }
  
  Widget _buildVectorDisplay(String label, List<int> vector) {
    return Row(
      children: [
        SizedBox(
          width: 80,
          child: Text(
            '$label:',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
        Expanded(
          child: Wrap(
            spacing: 8,
            children: List.generate(vector.length, (i) {
              return Chip(
                label: Text(
                  '${state.resourceNames[i]}: ${vector[i]}',
                  style: const TextStyle(fontSize: 12),
                ),
                backgroundColor: Colors.blue.shade50,
              );
            }),
          ),
        ),
      ],
    );
  }
  
  Widget _buildFinishVector(List<bool> finish) {
    return Row(
      children: [
        const SizedBox(
          width: 80,
          child: Text(
            'Finish:',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
        Expanded(
          child: Wrap(
            spacing: 8,
            children: List.generate(finish.length, (i) {
              return Chip(
                label: Text(
                  state.processNames[i],
                  style: TextStyle(
                    fontSize: 12,
                    color: finish[i] ? Colors.white : Colors.black87,
                  ),
                ),
                backgroundColor: finish[i] ? Colors.green : Colors.grey.shade300,
              );
            }),
          ),
        ),
      ],
    );
  }
  
  Widget _buildSafeSequence(List<int> sequence) {
    return Row(
      children: [
        const SizedBox(
          width: 80,
          child: Text(
            '安全序列:',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
        Expanded(
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.green.shade50,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.green.shade300),
            ),
            child: Row(
              children: [
                ...sequence.map((i) {
                  final index = sequence.indexOf(i);
                  return Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.green,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          state.processNames[i],
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      if (index < sequence.length - 1)
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 4),
                          child: Icon(
                            Icons.arrow_forward,
                            size: 16,
                            color: Colors.green,
                          ),
                        ),
                    ],
                  );
                }),
              ],
            ),
          ),
        ),
      ],
    );
  }
  
  IconData _getStepIcon(StepType type) {
    switch (type) {
      case StepType.initialize:
        return Icons.start;
      case StepType.check:
        return Icons.search;
      case StepType.allocate:
        return Icons.check_circle;
      case StepType.skip:
        return Icons.skip_next;
      case StepType.success:
        return Icons.verified;
      case StepType.fail:
        return Icons.error;
    }
  }
}

/// 资源请求输入组件
class ResourceRequestInput extends StatefulWidget {
  final BankerState state;
  final Function(ResourceRequest) onRequest;
  
  const ResourceRequestInput({
    Key? key,
    required this.state,
    required this.onRequest,
  }) : super(key: key);
  
  @override
  State<ResourceRequestInput> createState() => _ResourceRequestInputState();
}

class _ResourceRequestInputState extends State<ResourceRequestInput> {
  int _selectedProcess = 0;
  late List<TextEditingController> _controllers;
  
  @override
  void initState() {
    super.initState();
    _controllers = List.generate(
      widget.state.resourceCount,
      (_) => TextEditingController(text: '0'),
    );
  }
  
  @override
  void dispose() {
    for (var controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }
  
  void _submitRequest() {
    List<int> request = [];
    for (var controller in _controllers) {
      int value = int.tryParse(controller.text) ?? 0;
      request.add(value);
    }
    
    widget.onRequest(ResourceRequest(
      processIndex: _selectedProcess,
      request: request,
    ));
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '资源请求',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            
            // 选择进程
            DropdownButtonFormField<int>(
              value: _selectedProcess,
              decoration: const InputDecoration(
                labelText: '选择进程',
                border: OutlineInputBorder(),
              ),
              items: List.generate(widget.state.processCount, (i) {
                return DropdownMenuItem(
                  value: i,
                  child: Text(widget.state.processNames[i]),
                );
              }),
              onChanged: (value) {
                setState(() {
                  _selectedProcess = value!;
                });
              },
            ),
            const SizedBox(height: 16),
            
            // 输入资源请求
            Text(
              '请求资源数量',
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Row(
              children: List.generate(widget.state.resourceCount, (i) {
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: TextField(
                      controller: _controllers[i],
                      decoration: InputDecoration(
                        labelText: widget.state.resourceNames[i],
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      keyboardType: TextInputType.number,
                    ),
                  ),
                );
              }),
            ),
            const SizedBox(height: 8),
            
            // 显示当前进程的Need
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, size: 16, color: Colors.blue),
                  const SizedBox(width: 8),
                  Text(
                    'Need[${widget.state.processNames[_selectedProcess]}]: [${widget.state.need[_selectedProcess].join(', ')}]',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.blue.shade700,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            
            // 提交按钮
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _submitRequest,
                icon: const Icon(Icons.send),
                label: const Text('发起请求'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
