// 银行家算法可视化组件 - Academic Tech Dark 风格优化
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/banker_model.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

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
    // 适配移动端和桌面端
    return LayoutBuilder(
      builder: (context, constraints) {
        final isNarrow = constraints.maxWidth < 800;
        
        if (isNarrow) {
          return Column(
            children: [
              _buildMatrix(
                context,
                'Max (最大需求)',
                state.max,
                AppTheme.primary,
              ),
              const SizedBox(height: 16),
              _buildMatrix(
                context,
                'Allocation (已分配)',
                state.allocation,
                AppTheme.secondary,
              ),
              const SizedBox(height: 16),
              _buildMatrix(
                context,
                'Need (需求)',
                state.need,
                AppTheme.accent,
              ),
            ],
          );
        }
        
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _buildMatrix(
                context,
                'Max (最大需求)',
                state.max,
                AppTheme.primary,
              ),
            ),
            if (showNeedCalculation) ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 60),
                child: Icon(Icons.remove, color: AppTheme.textSecondary, size: 24),
              ),
            ] else 
              const SizedBox(width: 8),
            
            Expanded(
              child: _buildMatrix(
                context,
                'Allocation (已分配)',
                state.allocation,
                AppTheme.secondary,
              ),
            ),
            if (showNeedCalculation) ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 60),
                child: Icon(Icons.arrow_forward, color: AppTheme.textSecondary, size: 24),
              ),
            ] else 
              const SizedBox(width: 8),
            
            Expanded(
              child: _buildMatrix(
                context,
                'Need (需求)',
                state.need,
                AppTheme.accent,
              ),
            ),
          ],
        );
      },
    );
  }
  
  Widget _buildMatrix(
    BuildContext context,
    String title,
    List<List<int>> matrix,
    Color color,
  ) {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 3,
                  height: 16,
                  color: color,
                ),
                const SizedBox(width: 8),
                Text(
                  title,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: color,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Table(
              border: TableBorder.all(
                color: AppTheme.glassBorder,
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
                    _buildCell('Proc', isHeader: true),
                    ...state.resourceNames.map((name) => 
                        _buildCell(name, isHeader: true, color: color)),
                  ],
                ),
                // 数据行
                ...List.generate(state.processCount, (i) {
                  final isHighlighted = highlightProcess == i;
                  return TableRow(
                    decoration: BoxDecoration(
                      color: isHighlighted 
                          ? color.withOpacity(0.3)
                          : (i % 2 == 0 ? Colors.white.withOpacity(0.02) : Colors.transparent),
                    ),
                    children: [
                      _buildCell(
                        state.processNames[i],
                        isHeader: true,
                        color: isHighlighted ? Colors.white : AppTheme.textSecondary,
                      ),
                      ...matrix[i].map((value) => 
                          _buildCell(
                            value.toString(),
                            color: isHighlighted ? Colors.white : Colors.white70,
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(
          fontWeight: isHeader ? FontWeight.bold : FontWeight.normal,
          color: color ?? Colors.white,
          fontFamily: isHeader ? null : AppTheme.codeFont,
          fontSize: 13,
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
    final vector = workVector ?? state.available;
    final color = workVector != null ? AppTheme.accent : AppTheme.secondary;
    final title = workVector != null ? 'Work 向量 (动态)' : 'Available 向量 (初始)';
    
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.storage, color: color, size: 18),
                const SizedBox(width: 8),
                Text(
                  title,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: color,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: List.generate(state.resourceCount, (i) {
                return _buildResourceItem(
                  state.resourceNames[i],
                  vector[i],
                  color,
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildResourceItem(String name, int value, Color color) {
    return Container(
      width: 70, // Fixed width for alignment
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: color.withOpacity(0.5),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.2),
            blurRadius: 12,
          )
        ],
      ),
      child: Column(
        children: [
          Text(
            name,
            style: TextStyle(
              fontSize: 12,
              color: color.withOpacity(0.8),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value.toString(),
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Colors.white,
              fontFamily: AppTheme.codeFont,
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
    final color = _getStepColor(step.type);
    
    return GlassCard(
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
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: color.withOpacity(0.5)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _getStepIcon(step.type),
                        color: color,
                        size: 14,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Step ${step.stepNumber}',
                        style: TextStyle(
                          color: color,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    step.description,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Divider(color: AppTheme.glassBorder, height: 1),
            const SizedBox(height: 16),
            
            // Work向量
            _buildVectorDisplay('Work', step.work, AppTheme.accent),
            const SizedBox(height: 12),
            
            // Finish向量
            _buildFinishVector(step.finish),
            
            // 安全序列
            if (step.safeSequence.isNotEmpty) ...[
              const SizedBox(height: 16),
              _buildSafeSequence(step.safeSequence),
            ],
          ],
        ),
      ),
    );
  }
  
  Widget _buildVectorDisplay(String label, List<int> vector, Color color) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 60,
          child: Text(
            '$label:',
            style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
          ),
        ),
        Expanded(
          child: Wrap(
            spacing: 8,
            children: List.generate(vector.length, (i) {
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: color.withOpacity(0.3)),
                ),
                child: Text(
                  '${state.resourceNames[i]}:${vector[i]}',
                  style: const TextStyle(fontSize: 12, fontFamily: AppTheme.codeFont, color: Colors.white),
                ),
              );
            }),
          ),
        ),
      ],
    );
  }
  
  Widget _buildFinishVector(List<bool> finish) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(
          width: 60,
          child: Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'Finish:',
              style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
            ),
          ),
        ),
        Expanded(
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: List.generate(finish.length, (i) {
              final isFinished = finish[i];
              return Container(
                 padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                 decoration: BoxDecoration(
                   color: isFinished ? AppTheme.primary.withOpacity(0.2) : Colors.transparent,
                   borderRadius: BorderRadius.circular(4),
                   border: Border.all(
                     color: isFinished ? AppTheme.primary : AppTheme.glassBorder,
                   ),
                 ),
                 child: Text(
                    state.processNames[i],
                    style: TextStyle(
                      fontSize: 11,
                      color: isFinished ? AppTheme.primary : AppTheme.textSecondary,
                      fontWeight: isFinished ? FontWeight.bold : FontWeight.normal,
                    ),
                 ),
              );
            }),
          ),
        ),
      ],
    );
  }
  
  Widget _buildSafeSequence(List<int> sequence) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.green.withOpacity(0.05),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.green.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
           const Text('安全序列:', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green, fontSize: 13)),
           const SizedBox(height: 8),
           Row(
              children: [
                 ...sequence.map((i) {
                  final index = sequence.indexOf(i);
                  return Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.green.withOpacity(0.8),
                          borderRadius: BorderRadius.circular(4),
                          boxShadow: [
                            BoxShadow(color: Colors.green.withOpacity(0.4), blurRadius: 6)
                          ]
                        ),
                        child: Text(
                          state.processNames[i],
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        ),
                      ),
                      if (index < sequence.length - 1)
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 4),
                          child: Icon(
                            Icons.arrow_right_alt,
                            size: 20,
                            color: Colors.green,
                          ),
                        ),
                    ],
                  );
                }),
              ],
           ),
        ],
      ),
    );
  }
  
  Color _getStepColor(StepType type) {
    switch (type) {
      case StepType.initialize: return AppTheme.textSecondary;
      case StepType.check: return AppTheme.primary;
      case StepType.allocate: return AppTheme.secondary;
      case StepType.skip: return AppTheme.textSecondary;
      case StepType.success: return AppTheme.accent;
      case StepType.fail: return AppTheme.error;
    }
  }

  IconData _getStepIcon(StepType type) {
    switch (type) {
      case StepType.initialize: return Icons.start;
      case StepType.check: return Icons.search;
      case StepType.allocate: return Icons.check_circle_outline;
      case StepType.skip: return Icons.skip_next;
      case StepType.success: return Icons.verified;
      case StepType.fail: return Icons.error_outline;
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '模拟资源请求',
              style: AppTheme.darkTheme.textTheme.titleMedium?.copyWith(
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),
            
            // 选择进程
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                border: Border.all(color: AppTheme.glassBorder),
                borderRadius: BorderRadius.circular(8),
                color: Colors.white.withOpacity(0.05),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<int>(
                  value: _selectedProcess,
                  isExpanded: true,
                  dropdownColor: AppTheme.surface,
                  style: const TextStyle(color: Colors.white),
                  items: List.generate(widget.state.processCount, (i) {
                    return DropdownMenuItem(
                      value: i,
                      child: Text(
                        widget.state.processNames[i],
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                    );
                  }),
                  onChanged: (value) {
                    setState(() {
                      _selectedProcess = value!;
                    });
                  },
                ),
              ),
            ),
            const SizedBox(height: 16),
            
            // 输入资源请求
            Text(
              '请求数量',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
            ),
            const SizedBox(height: 8),
            Row(
              children: List.generate(widget.state.resourceCount, (i) {
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: TextField(
                      controller: _controllers[i],
                      style: const TextStyle(color: Colors.white, fontFamily: AppTheme.codeFont),
                      decoration: InputDecoration(
                        labelText: widget.state.resourceNames[i],
                        labelStyle: TextStyle(color: AppTheme.textSecondary),
                        enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                        focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.primary)),
                        isDense: true,
                        filled: true,
                        fillColor: Colors.white.withOpacity(0.05),
                      ),
                      keyboardType: TextInputType.number,
                    ),
                  ),
                );
              }),
            ),
            const SizedBox(height: 12),
            
            // 显示当前进程的Need
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AppTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: AppTheme.primary.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: AppTheme.primary),
                  const SizedBox(width: 8),
                  Text(
                    'Need[${widget.state.processNames[_selectedProcess]}]: [${widget.state.need[_selectedProcess].join(', ')}]',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Colors.white,
                      fontFamily: AppTheme.codeFont,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            
            // 提交按钮
            NeonButton(
              onPressed: _submitRequest,
              text: '发起请求',
              icon: Icons.send,
              isPrimary: true,
              height: 48,
              width: double.infinity,
            ),
          ],
        ),
      ),
    );
  }
}
