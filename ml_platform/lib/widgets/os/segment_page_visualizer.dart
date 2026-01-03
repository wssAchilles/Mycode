// 段页式内存管理可视化组件
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/segment_page_model.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '段表',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 12),
            
            if (segmentTable.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.glassBorder),
                ),
                child: const Center(
                  child: Text('段表为空', style: TextStyle(color: AppTheme.textSecondary)),
                ),
              )
            else
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Theme(
                  data: Theme.of(context).copyWith(
                    dividerColor: AppTheme.glassBorder,
                    dataTableTheme: DataTableThemeData(
                      headingRowColor: WidgetStateProperty.all(AppTheme.primary.withOpacity(0.1)),
                      dataRowColor: WidgetStateProperty.all(Colors.transparent),
                      headingTextStyle: const TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold),
                      dataTextStyle: const TextStyle(color: Colors.white70),
                    )
                  ),
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
                            ? WidgetStateProperty.all(AppTheme.accent.withOpacity(0.2))
                            : null,
                        cells: [
                          DataCell(Text('${entry.segmentNumber}', style: TextStyle(color: isHighlighted ? AppTheme.accent : Colors.white))),
                          DataCell(Text('0x${entry.baseAddress.toRadixString(16).toUpperCase()}', style: const TextStyle(fontFamily: AppTheme.codeFont))),
                          DataCell(Text('${entry.limit} 页')),
                          DataCell(
                            Icon(
                              entry.isValid ? Icons.check_circle : Icons.cancel,
                              color: entry.isValid ? AppTheme.success : AppTheme.error,
                              size: 20,
                            ),
                          ),
                          DataCell(
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: entry.access.color.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: entry.access.color.withOpacity(0.5)),
                              ),
                              child: Text(
                                entry.access.label,
                                style: TextStyle(fontSize: 12, color: entry.access.color),
                              ),
                            ),
                          ),
                        ],
                      );
                    }).toList(),
                  ),
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '段 $segmentNumber 的页表',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 12),
            
            if (pageTable.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.glassBorder),
                ),
                child: const Center(
                  child: Text('页表为空', style: TextStyle(color: AppTheme.textSecondary)),
                ),
              )
            else
              SingleChildScrollView(
                child: Theme(
                   data: Theme.of(context).copyWith(
                    dividerColor: AppTheme.glassBorder,
                    dataTableTheme: DataTableThemeData(
                      headingRowColor: WidgetStateProperty.all(AppTheme.secondary.withOpacity(0.1)),
                      dataRowColor: WidgetStateProperty.all(Colors.transparent),
                      headingTextStyle: const TextStyle(color: AppTheme.secondary, fontWeight: FontWeight.bold),
                      dataTextStyle: const TextStyle(color: Colors.white70),
                    )
                  ),
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
                            ? WidgetStateProperty.all(AppTheme.accent.withOpacity(0.2))
                            : null,
                        cells: [
                          DataCell(Text('${entry.pageNumber}', style: TextStyle(color: isHighlighted ? AppTheme.accent : Colors.white))),
                          DataCell(
                            Text(
                              entry.isValid 
                                  ? '${entry.frameNumber}'
                                  : '-',
                              style: TextStyle(
                                color: entry.isValid ? Colors.white : AppTheme.textSecondary,
                                fontFamily: AppTheme.codeFont,
                              ),
                            ),
                          ),
                          DataCell(
                            Icon(
                              entry.isValid ? Icons.check_circle : Icons.cancel,
                              color: entry.isValid ? AppTheme.success : AppTheme.error,
                              size: 16,
                            ),
                          ),
                          DataCell(
                            Icon(
                              entry.isDirty ? Icons.edit : Icons.check,
                              color: entry.isDirty ? Colors.orange : AppTheme.textSecondary,
                              size: 16,
                            ),
                          ),
                          DataCell(
                            Icon(
                              entry.isReferenced ? Icons.visibility : Icons.visibility_off,
                              color: entry.isReferenced ? Colors.blue : AppTheme.textSecondary,
                              size: 16,
                            ),
                          ),
                          DataCell(
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: entry.access.color.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: entry.access.color.withOpacity(0.5)),
                              ),
                              child: Text(
                                entry.access.label,
                                style: TextStyle(fontSize: 10, color: entry.access.color),
                              ),
                            ),
                          ),
                        ],
                      );
                    }).toList(),
                  ),
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '物理内存 (${system.frameCount} 页框)',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 12),
            
            // 页框网格
            Expanded(
              child: GridView.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 6,
                  crossAxisSpacing: 8,
                  mainAxisSpacing: 8,
                  childAspectRatio: 1,
                ),
                itemCount: system.frameCount,
                itemBuilder: (context, index) {
                  final isUsed = system.frameTable[index];
                  final isHighlighted = highlightFrame == index;
                  
                  return Container(
                    decoration: BoxDecoration(
                      color: isHighlighted 
                          ? AppTheme.accent.withOpacity(0.3)
                          : isUsed 
                              ? AppTheme.primary.withOpacity(0.3)
                              : Colors.white.withOpacity(0.05),
                      border: Border.all(
                        color: isHighlighted 
                            ? AppTheme.accent
                            : isUsed 
                               ? AppTheme.primary
                               : AppTheme.glassBorder,
                        width: isHighlighted ? 2 : 1,
                      ),
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: isHighlighted ? [BoxShadow(color: AppTheme.accent.withOpacity(0.5), blurRadius: 8)] : null,
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
                              color: isHighlighted ? AppTheme.accent : (isUsed ? Colors.white : AppTheme.textSecondary),
                              fontFamily: AppTheme.codeFont,
                            ),
                          ),
                          if (isUsed)
                            const Icon(
                              Icons.check,
                              color: Colors.white70,
                              size: 14,
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
                _buildLegendItem('空闲', AppTheme.textSecondary),
                _buildLegendItem('已分配', AppTheme.primary),
                _buildLegendItem('当前访问', AppTheme.accent),
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
            color: color.withOpacity(0.3),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: color),
          ),
        ),
        const SizedBox(width: 8),
        Text(label, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  result.success ? Icons.check_circle : Icons.error,
                  color: result.success ? AppTheme.success : AppTheme.error,
                ),
                const SizedBox(width: 8),
                Text(
                  '地址转换${result.success ? "成功" : "失败"}',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: result.success ? AppTheme.success : AppTheme.error,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
            
            if (!result.success) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.error.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.error.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: AppTheme.error),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        result.errorMessage,
                        style: const TextStyle(color: AppTheme.error),
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
                  color: AppTheme.success.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.success.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.location_on, color: AppTheme.success),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        result.physicalAddress.toString(),
                        style: const TextStyle(
                          color: AppTheme.success,
                          fontWeight: FontWeight.bold,
                          fontFamily: AppTheme.codeFont,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            
            const SizedBox(height: 16),
            
            // 转换步骤
            const Text(
              '转换步骤',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: Colors.white,
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
                          ? step.type.color.withOpacity(0.1)
                          : isPastStep
                              ? Colors.white.withOpacity(0.02)
                              : Colors.transparent,
                      border: Border.all(
                        color: isCurrentStep 
                            ? step.type.color
                            : isPastStep ? AppTheme.glassBorder : Colors.white10,
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
                            border: Border.all(color: step.type.color.withOpacity(0.5)),
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
                                style: const TextStyle(fontSize: 13, color: Colors.white70),
                              ),
                            ],
                          ),
                        ),
                        if (isPastStep)
                          const Icon(
                            Icons.check,
                            color: AppTheme.success,
                            size: 20,
                          ),
                        if (isCurrentStep)
                          const Icon(
                            Icons.arrow_forward,
                            color: Colors.white,
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '内存系统统计',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
            ),
            const SizedBox(height: 16),
            
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                Expanded(child: _buildStatItem(
                  '总页框',
                  '${stats.totalFrames}',
                  Icons.memory,
                  Colors.blue,
                )),
                Expanded(child: _buildStatItem(
                  '已使用',
                  '${stats.usedFrames}',
                  Icons.storage,
                  Colors.orange,
                )),
                Expanded(child: _buildStatItem(
                  '空闲',
                  '${stats.freeFrames}',
                  Icons.storage_outlined,
                  AppTheme.success,
                )),
                Expanded(child: _buildStatItem(
                  '利用率',
                  '${(stats.memoryUtilization * 100).toStringAsFixed(1)}%',
                  Icons.pie_chart,
                  Colors.purple,
                )),
              ],
            ),
            
            const SizedBox(height: 16),
            const Divider(color: Colors.white10),
            const SizedBox(height: 16),
            
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                Expanded(child: _buildStatItem(
                  '总段数',
                  '${stats.totalSegments}',
                  Icons.view_module,
                  Colors.teal,
                )),
                Expanded(child: _buildStatItem(
                  '总页数',
                  '${stats.totalPages}',
                  Icons.grid_view,
                  Colors.indigo,
                )),
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
            fontFamily: AppTheme.codeFont,
          ),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
        ),
      ],
    );
  }
}
