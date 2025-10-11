// 段页式内存管理可视化组件
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/segment_page_model.dart';

/// 段表可视化器
class SegmentTableVisualizer extends StatelessWidget {
  final List<SegmentTableEntry> segmentTable;
  final int? highlightSegment;
  
  const SegmentTableVisualizer({
    Key? key,
    required this.segmentTable,
    this.highlightSegment,
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
            Text(
              '段表',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            
            if (segmentTable.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(
                  child: Text('段表为空'),
                ),
              )
            else
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  columns: const [
                    DataColumn(label: Text('段号')),
                    DataColumn(label: Text('基址')),
                    DataColumn(label: Text('长度')),
                    DataColumn(label: Text('有效位')),
                    DataColumn(label: Text('访问权限')),
                  ],
                  rows: segmentTable.map((entry) {
                    final isHighlighted = highlightSegment == entry.segmentNumber;
                    return DataRow(
                      color: isHighlighted 
                          ? WidgetStateProperty.all(Colors.yellow.shade200)
                          : null,
                      cells: [
                        DataCell(Text('${entry.segmentNumber}')),
                        DataCell(Text('0x${entry.baseAddress.toRadixString(16).toUpperCase()}')),
                        DataCell(Text('${entry.limit} 页')),
                        DataCell(
                          Icon(
                            entry.isValid ? Icons.check_circle : Icons.cancel,
                            color: entry.isValid ? Colors.green : Colors.red,
                            size: 20,
                          ),
                        ),
                        DataCell(
                          Chip(
                            label: Text(
                              entry.access.label,
                              style: const TextStyle(fontSize: 12),
                            ),
                            backgroundColor: entry.access.color.withOpacity(0.2),
                          ),
                        ),
                      ],
                    );
                  }).toList(),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 页表可视化器
class PageTableVisualizer extends StatelessWidget {
  final int segmentNumber;
  final List<PageTableEntry> pageTable;
  final int? highlightPage;
  
  const PageTableVisualizer({
    Key? key,
    required this.segmentNumber,
    required this.pageTable,
    this.highlightPage,
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
            Text(
              '段 $segmentNumber 的页表',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            
            if (pageTable.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(
                  child: Text('页表为空'),
                ),
              )
            else
              SingleChildScrollView(
                child: DataTable(
                  columns: const [
                    DataColumn(label: Text('页号')),
                    DataColumn(label: Text('页框号')),
                    DataColumn(label: Text('有效位')),
                    DataColumn(label: Text('修改位')),
                    DataColumn(label: Text('访问位')),
                    DataColumn(label: Text('权限')),
                  ],
                  rows: pageTable.map((entry) {
                    final isHighlighted = highlightPage == entry.pageNumber;
                    return DataRow(
                      color: isHighlighted 
                          ? WidgetStateProperty.all(Colors.yellow.shade200)
                          : null,
                      cells: [
                        DataCell(Text('${entry.pageNumber}')),
                        DataCell(
                          Text(
                            entry.isValid 
                                ? '${entry.frameNumber}'
                                : '-',
                            style: TextStyle(
                              color: entry.isValid ? Colors.black : Colors.grey,
                            ),
                          ),
                        ),
                        DataCell(
                          Icon(
                            entry.isValid ? Icons.check_circle : Icons.cancel,
                            color: entry.isValid ? Colors.green : Colors.red,
                            size: 16,
                          ),
                        ),
                        DataCell(
                          Icon(
                            entry.isDirty ? Icons.edit : Icons.check,
                            color: entry.isDirty ? Colors.orange : Colors.grey,
                            size: 16,
                          ),
                        ),
                        DataCell(
                          Icon(
                            entry.isReferenced ? Icons.visibility : Icons.visibility_off,
                            color: entry.isReferenced ? Colors.blue : Colors.grey,
                            size: 16,
                          ),
                        ),
                        DataCell(
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: entry.access.color.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              entry.access.label,
                              style: const TextStyle(fontSize: 10),
                            ),
                          ),
                        ),
                      ],
                    );
                  }).toList(),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 物理内存可视化器
class PhysicalMemoryVisualizer extends StatelessWidget {
  final SegmentPageMemorySystem system;
  final int? highlightFrame;
  
  const PhysicalMemoryVisualizer({
    Key? key,
    required this.system,
    this.highlightFrame,
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
            Text(
              '物理内存 (${system.frameCount} 页框)',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            
            // 页框网格
            Expanded(
              child: GridView.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 8,
                  crossAxisSpacing: 4,
                  mainAxisSpacing: 4,
                  childAspectRatio: 1,
                ),
                itemCount: system.frameCount,
                itemBuilder: (context, index) {
                  final isUsed = system.frameTable[index];
                  final isHighlighted = highlightFrame == index;
                  
                  return Container(
                    decoration: BoxDecoration(
                      color: isHighlighted 
                          ? Colors.yellow
                          : isUsed 
                              ? Colors.blue.shade200
                              : Colors.grey.shade200,
                      border: Border.all(
                        color: isHighlighted 
                            ? Colors.orange
                            : Colors.grey.shade400,
                        width: isHighlighted ? 2 : 1,
                      ),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            '$index',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: isUsed ? Colors.white : Colors.black54,
                            ),
                          ),
                          if (isUsed)
                            Icon(
                              Icons.check,
                              color: Colors.white,
                              size: 12,
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            
            const SizedBox(height: 12),
            
            // 图例
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildLegendItem('空闲', Colors.grey.shade200),
                _buildLegendItem('已分配', Colors.blue.shade200),
                _buildLegendItem('当前访问', Colors.yellow),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildLegendItem(String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
            border: Border.all(color: Colors.grey.shade400),
          ),
        ),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 12)),
      ],
    );
  }
}

/// 地址转换步骤可视化器
class AddressTranslationVisualizer extends StatelessWidget {
  final AddressTranslationResult result;
  final int currentStepIndex;
  
  const AddressTranslationVisualizer({
    Key? key,
    required this.result,
    this.currentStepIndex = 0,
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
            Row(
              children: [
                Icon(
                  result.success ? Icons.check_circle : Icons.error,
                  color: result.success ? Colors.green : Colors.red,
                ),
                const SizedBox(width: 8),
                Text(
                  '地址转换${result.success ? "成功" : "失败"}',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: result.success ? Colors.green : Colors.red,
                  ),
                ),
              ],
            ),
            
            if (!result.success) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.red.shade200),
                ),
                child: Row(
                  children: [
                    Icon(Icons.error_outline, color: Colors.red.shade700),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        result.errorMessage,
                        style: TextStyle(color: Colors.red.shade700),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            
            if (result.physicalAddress != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.green.shade50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.green.shade200),
                ),
                child: Row(
                  children: [
                    Icon(Icons.location_on, color: Colors.green.shade700),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        result.physicalAddress.toString(),
                        style: TextStyle(
                          color: Colors.green.shade700,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            
            const SizedBox(height: 16),
            
            // 转换步骤
            Text(
              '转换步骤',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            
            Expanded(
              child: ListView.builder(
                itemCount: result.steps.length,
                itemBuilder: (context, index) {
                  final step = result.steps[index];
                  final isCurrentStep = index == currentStepIndex;
                  final isPastStep = index < currentStepIndex;
                  
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isCurrentStep 
                          ? Colors.blue.shade50
                          : isPastStep
                              ? Colors.grey.shade50
                              : Colors.white,
                      border: Border.all(
                        color: isCurrentStep 
                            ? Colors.blue.shade300
                            : Colors.grey.shade300,
                        width: isCurrentStep ? 2 : 1,
                      ),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 24,
                          height: 24,
                          decoration: BoxDecoration(
                            color: step.type.color.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Center(
                            child: Text(
                              '${index + 1}',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: step.type.color,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                step.type.label,
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: step.type.color,
                                  fontSize: 12,
                                ),
                              ),
                              Text(
                                step.description,
                                style: const TextStyle(fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                        if (isPastStep)
                          Icon(
                            Icons.check,
                            color: Colors.green,
                            size: 20,
                          ),
                        if (isCurrentStep)
                          Icon(
                            Icons.arrow_forward,
                            color: Colors.blue,
                            size: 20,
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 内存系统统计信息可视化器
class MemorySystemStatsVisualizer extends StatelessWidget {
  final MemorySystemStatistics stats;
  
  const MemorySystemStatsVisualizer({
    Key? key,
    required this.stats,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '内存系统统计',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildStatItem(
                  '总页框',
                  '${stats.totalFrames}',
                  Icons.memory,
                  Colors.blue,
                ),
                _buildStatItem(
                  '已使用',
                  '${stats.usedFrames}',
                  Icons.storage,
                  Colors.orange,
                ),
                _buildStatItem(
                  '空闲',
                  '${stats.freeFrames}',
                  Icons.storage_outlined,
                  Colors.green,
                ),
                _buildStatItem(
                  '利用率',
                  '${(stats.memoryUtilization * 100).toStringAsFixed(1)}%',
                  Icons.pie_chart,
                  Colors.purple,
                ),
              ],
            ),
            
            const SizedBox(height: 16),
            
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildStatItem(
                  '总段数',
                  '${stats.totalSegments}',
                  Icons.view_module,
                  Colors.teal,
                ),
                _buildStatItem(
                  '总页数',
                  '${stats.totalPages}',
                  Icons.grid_view,
                  Colors.indigo,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildStatItem(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 24),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12),
        ),
      ],
    );
  }
}
