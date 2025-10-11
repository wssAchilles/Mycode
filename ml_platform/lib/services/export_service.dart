// 数据导出服务
import 'dart:convert';
import 'dart:html' as html;
import 'package:ml_platform/models/comparison_model.dart';
import 'package:ml_platform/models/os/process_model.dart';
import 'package:ml_platform/models/os/memory_model.dart';
import 'package:ml_platform/models/os/banker_model.dart';

/// 导出格式
enum ExportFormat {
  json('JSON', 'json', 'application/json'),
  csv('CSV', 'csv', 'text/csv'),
  txt('TXT', 'txt', 'text/plain'),
  xml('XML', 'xml', 'application/xml');
  
  final String label;
  final String extension;
  final String mimeType;
  const ExportFormat(this.label, this.extension, this.mimeType);
}

/// 导出数据类型
enum ExportDataType {
  algorithmComparison('算法对比结果'),
  schedulingResult('调度算法结果'),
  memoryAnalysis('内存管理分析'),
  bankerAlgorithm('银行家算法'),
  userProgress('学习进度'),
  performanceReport('性能报告');
  
  final String label;
  const ExportDataType(this.label);
}

/// 数据导出服务
class ExportService {
  static final ExportService _instance = ExportService._internal();
  factory ExportService() => _instance;
  ExportService._internal();
  
  /// 导出算法对比结果
  void exportComparisonResult(
    ComparisonReport report,
    ExportFormat format, {
    String? customFileName,
  }) {
    final fileName = customFileName ?? 
        '算法对比_${report.type.label}_${_formatDateTime(report.timestamp)}';
    
    String content;
    switch (format) {
      case ExportFormat.json:
        content = _exportComparisonToJson(report);
        break;
      case ExportFormat.csv:
        content = _exportComparisonToCsv(report);
        break;
      case ExportFormat.txt:
        content = _exportComparisonToTxt(report);
        break;
      case ExportFormat.xml:
        content = _exportComparisonToXml(report);
        break;
    }
    
    _downloadFile(content, fileName, format);
  }
  
  /// 导出调度算法结果
  void exportSchedulingResult(
    SchedulingResult result,
    ExportFormat format, {
    String? customFileName,
  }) {
    final fileName = customFileName ?? 
        '调度算法_${result.algorithm.shortName}_${DateTime.now().millisecondsSinceEpoch}';
    
    String content;
    switch (format) {
      case ExportFormat.json:
        content = _exportSchedulingToJson(result);
        break;
      case ExportFormat.csv:
        content = _exportSchedulingToCsv(result);
        break;
      case ExportFormat.txt:
        content = _exportSchedulingToTxt(result);
        break;
      case ExportFormat.xml:
        content = _exportSchedulingToXml(result);
        break;
    }
    
    _downloadFile(content, fileName, format);
  }
  
  /// 导出内存管理分析
  void exportMemoryAnalysis(
    List<AllocationResult> results,
    MemoryStatistics stats,
    ExportFormat format, {
    String? customFileName,
  }) {
    final fileName = customFileName ?? 
        '内存管理分析_${DateTime.now().millisecondsSinceEpoch}';
    
    String content;
    switch (format) {
      case ExportFormat.json:
        content = _exportMemoryToJson(results, stats);
        break;
      case ExportFormat.csv:
        content = _exportMemoryToCsv(results, stats);
        break;
      case ExportFormat.txt:
        content = _exportMemoryToTxt(results, stats);
        break;
      case ExportFormat.xml:
        content = _exportMemoryToXml(results, stats);
        break;
    }
    
    _downloadFile(content, fileName, format);
  }
  
  /// 导出银行家算法结果
  void exportBankerResult(
    SafetyCheckResult safetyResult,
    BankerState state,
    ExportFormat format, {
    String? customFileName,
  }) {
    final fileName = customFileName ?? 
        '银行家算法_${DateTime.now().millisecondsSinceEpoch}';
    
    String content;
    switch (format) {
      case ExportFormat.json:
        content = _exportBankerToJson(safetyResult, state);
        break;
      case ExportFormat.csv:
        content = _exportBankerToCsv(safetyResult, state);
        break;
      case ExportFormat.txt:
        content = _exportBankerToTxt(safetyResult, state);
        break;
      case ExportFormat.xml:
        content = _exportBankerToXml(safetyResult, state);
        break;
    }
    
    _downloadFile(content, fileName, format);
  }
  
  /// 导出学习进度报告
  void exportLearningProgress(
    Map<String, dynamic> progressData,
    ExportFormat format, {
    String? customFileName,
  }) {
    final fileName = customFileName ?? 
        '学习进度报告_${_formatDateTime(DateTime.now())}';
    
    String content;
    switch (format) {
      case ExportFormat.json:
        content = jsonEncode(progressData);
        break;
      case ExportFormat.csv:
        content = _progressMapToCsv(progressData);
        break;
      case ExportFormat.txt:
        content = _progressMapToTxt(progressData);
        break;
      case ExportFormat.xml:
        content = _progressMapToXml(progressData);
        break;
    }
    
    _downloadFile(content, fileName, format);
  }
  
  // ============= JSON导出方法 =============
  
  String _exportComparisonToJson(ComparisonReport report) {
    return jsonEncode({
      'type': report.type.label,
      'timestamp': report.timestamp.toIso8601String(),
      'config': {
        'algorithms': report.config.selectedAlgorithms,
        'dataSize': report.config.testDataSize,
        'rounds': report.config.testRounds,
      },
      'results': report.results.map((r) => {
        'algorithm': r.algorithmName,
        'metrics': r.metrics,
        'executionTime': r.executionTime.inMicroseconds,
        'dataSize': r.dataSize,
      }).toList(),
      'summary': report.summary,
      'ranking': report.getPerformanceRanking(),
    });
  }
  
  String _exportSchedulingToJson(SchedulingResult result) {
    return jsonEncode({
      'algorithm': result.algorithm.label,
      'totalTime': result.totalTime,
      'processes': result.processes.map((p) => {
        'pid': p.pid,
        'arrivalTime': p.arrivalTime,
        'burstTime': p.burstTime,
        'waitingTime': p.waitingTime,
        'turnaroundTime': p.turnaroundTime,
        'responseTime': p.responseTime,
      }).toList(),
      'ganttChart': result.ganttChart.map((g) => {
        'pid': g.pid,
        'startTime': g.startTime,
        'endTime': g.endTime,
      }).toList(),
      'metrics': {
        'averageWaitingTime': result.averageWaitingTime,
        'averageTurnaroundTime': result.averageTurnaroundTime,
        'cpuUtilization': result.cpuUtilization,
        'contextSwitches': result.contextSwitches,
      },
    });
  }
  
  String _exportMemoryToJson(List<AllocationResult> results, MemoryStatistics stats) {
    return jsonEncode({
      'statistics': {
        'totalMemory': stats.totalMemory,
        'usedMemory': stats.usedMemory,
        'freeMemory': stats.freeMemory,
        'utilizationRate': stats.utilizationRate,
        'externalFragmentation': stats.externalFragmentation,
      },
      'allocations': results.map((r) => {
        'success': r.success,
        'message': r.message,
        'allocatedSize': r.allocatedSize,
        'allocatedAddress': r.allocatedAddress,
      }).toList(),
    });
  }
  
  String _exportBankerToJson(SafetyCheckResult safetyResult, BankerState state) {
    return jsonEncode({
      'isSafe': safetyResult.isSafe,
      'safeSequence': safetyResult.safeSequence,
      'message': safetyResult.message,
      'state': {
        'processCount': state.processCount,
        'resourceCount': state.resourceCount,
        'max': state.max,
        'allocation': state.allocation,
        'need': state.need,
        'available': state.available,
      },
      'steps': safetyResult.steps.map((s) => {
        'stepNumber': s.stepNumber,
        'description': s.description,
        'type': s.type.label,
      }).toList(),
    });
  }
  
  // ============= CSV导出方法 =============
  
  String _exportComparisonToCsv(ComparisonReport report) {
    final buffer = StringBuffer();
    
    // 表头
    buffer.writeln('算法名称,${ComparisonMetric.getMetricsForType(report.type).map((m) => m.name).join(',')}');
    
    // 数据行
    for (final result in report.results) {
      final metrics = ComparisonMetric.getMetricsForType(report.type);
      final values = metrics.map((m) => result.metrics[m.name]?.toString() ?? '').toList();
      buffer.writeln('${result.algorithmName},${values.join(',')}');
    }
    
    return buffer.toString();
  }
  
  String _exportSchedulingToCsv(SchedulingResult result) {
    final buffer = StringBuffer();
    
    // 进程信息
    buffer.writeln('进程ID,到达时间,服务时间,等待时间,周转时间,响应时间');
    for (final process in result.processes) {
      buffer.writeln('${process.pid},${process.arrivalTime},${process.burstTime},'
          '${process.waitingTime},${process.turnaroundTime},${process.responseTime}');
    }
    
    buffer.writeln();
    
    // 甘特图
    buffer.writeln('进程ID,开始时间,结束时间');
    for (final item in result.ganttChart) {
      buffer.writeln('${item.pid},${item.startTime},${item.endTime}');
    }
    
    return buffer.toString();
  }
  
  String _exportMemoryToCsv(List<AllocationResult> results, MemoryStatistics stats) {
    final buffer = StringBuffer();
    
    // 统计信息
    buffer.writeln('指标,数值');
    buffer.writeln('总内存,${stats.totalMemory}');
    buffer.writeln('已使用内存,${stats.usedMemory}');
    buffer.writeln('空闲内存,${stats.freeMemory}');
    buffer.writeln('利用率,${stats.utilizationRate}');
    
    buffer.writeln();
    
    // 分配结果
    buffer.writeln('序号,成功,消息,分配大小,分配地址');
    for (int i = 0; i < results.length; i++) {
      final result = results[i];
      buffer.writeln('${i + 1},${result.success},${result.message},'
          '${result.allocatedSize ?? ''},${result.allocatedAddress ?? ''}');
    }
    
    return buffer.toString();
  }
  
  String _exportBankerToCsv(SafetyCheckResult safetyResult, BankerState state) {
    final buffer = StringBuffer();
    
    // 基本信息
    buffer.writeln('安全状态,${safetyResult.isSafe ? "安全" : "不安全"}');
    buffer.writeln('安全序列,${safetyResult.safeSequence?.join(" -> ") ?? "无"}');
    buffer.writeln();
    
    // Max矩阵
    buffer.writeln('Max矩阵');
    buffer.writeln('进程,${state.resourceNames.join(',')}');
    for (int i = 0; i < state.processCount; i++) {
      buffer.writeln('${state.processNames[i]},${state.max[i].join(',')}');
    }
    
    buffer.writeln();
    
    // Allocation矩阵
    buffer.writeln('Allocation矩阵');
    buffer.writeln('进程,${state.resourceNames.join(',')}');
    for (int i = 0; i < state.processCount; i++) {
      buffer.writeln('${state.processNames[i]},${state.allocation[i].join(',')}');
    }
    
    return buffer.toString();
  }
  
  // ============= TXT导出方法 =============
  
  String _exportComparisonToTxt(ComparisonReport report) {
    final buffer = StringBuffer();
    
    buffer.writeln('算法对比报告');
    buffer.writeln('=' * 50);
    buffer.writeln('算法类型: ${report.type.label}');
    buffer.writeln('测试时间: ${_formatDateTime(report.timestamp)}');
    buffer.writeln('测试轮次: ${report.config.testRounds}');
    buffer.writeln('数据规模: ${report.config.testDataSize}');
    buffer.writeln();
    
    buffer.writeln('测试结果:');
    buffer.writeln('-' * 30);
    
    for (final result in report.results) {
      buffer.writeln('${result.algorithmName}:');
      for (final entry in result.metrics.entries) {
        buffer.writeln('  ${entry.key}: ${entry.value}');
      }
      buffer.writeln();
    }
    
    final ranking = report.getPerformanceRanking();
    if (ranking.isNotEmpty) {
      buffer.writeln('性能排名:');
      for (int i = 0; i < ranking.length; i++) {
        buffer.writeln('${i + 1}. ${ranking[i]}');
      }
    }
    
    return buffer.toString();
  }
  
  String _exportSchedulingToTxt(SchedulingResult result) {
    final buffer = StringBuffer();
    
    buffer.writeln('进程调度算法结果报告');
    buffer.writeln('=' * 40);
    buffer.writeln('算法: ${result.algorithm.label}');
    buffer.writeln('总时间: ${result.totalTime} ms');
    buffer.writeln();
    
    buffer.writeln('进程信息:');
    buffer.writeln('PID\t到达\t服务\t等待\t周转\t响应');
    for (final process in result.processes) {
      buffer.writeln('P${process.pid}\t${process.arrivalTime}\t${process.burstTime}\t'
          '${process.waitingTime}\t${process.turnaroundTime}\t${process.responseTime}');
    }
    
    buffer.writeln();
    buffer.writeln('性能指标:');
    buffer.writeln('平均等待时间: ${result.averageWaitingTime.toStringAsFixed(2)} ms');
    buffer.writeln('平均周转时间: ${result.averageTurnaroundTime.toStringAsFixed(2)} ms');
    buffer.writeln('CPU利用率: ${(result.cpuUtilization * 100).toStringAsFixed(2)}%');
    buffer.writeln('上下文切换: ${result.contextSwitches} 次');
    
    return buffer.toString();
  }
  
  String _exportMemoryToTxt(List<AllocationResult> results, MemoryStatistics stats) {
    final buffer = StringBuffer();
    
    buffer.writeln('内存管理分析报告');
    buffer.writeln('=' * 40);
    buffer.writeln('总内存: ${stats.totalMemory} KB');
    buffer.writeln('已使用: ${stats.usedMemory} KB');
    buffer.writeln('空闲: ${stats.freeMemory} KB');
    buffer.writeln('利用率: ${(stats.utilizationRate * 100).toStringAsFixed(2)}%');
    buffer.writeln('外部碎片: ${stats.externalFragmentation} KB');
    buffer.writeln();
    
    buffer.writeln('分配记录:');
    for (int i = 0; i < results.length; i++) {
      final result = results[i];
      buffer.writeln('${i + 1}. ${result.success ? "成功" : "失败"}: ${result.message}');
      if (result.success && result.allocatedSize != null) {
        buffer.writeln('   分配大小: ${result.allocatedSize} KB');
        buffer.writeln('   分配地址: ${result.allocatedAddress}');
      }
    }
    
    return buffer.toString();
  }
  
  String _exportBankerToTxt(SafetyCheckResult safetyResult, BankerState state) {
    final buffer = StringBuffer();
    
    buffer.writeln('银行家算法分析报告');
    buffer.writeln('=' * 40);
    buffer.writeln('安全状态: ${safetyResult.isSafe ? "安全" : "不安全"}');
    buffer.writeln('分析消息: ${safetyResult.message}');
    
    if (safetyResult.safeSequence != null) {
      final sequenceNames = safetyResult.safeSequence!
          .map((i) => state.processNames[i])
          .join(' → ');
      buffer.writeln('安全序列: $sequenceNames');
    }
    
    buffer.writeln();
    buffer.writeln('系统状态:');
    buffer.writeln('进程数: ${state.processCount}');
    buffer.writeln('资源种类: ${state.resourceCount}');
    buffer.writeln('可用资源: ${state.available}');
    
    return buffer.toString();
  }
  
  // ============= XML导出方法 =============
  
  String _exportComparisonToXml(ComparisonReport report) {
    final buffer = StringBuffer();
    
    buffer.writeln('<?xml version="1.0" encoding="UTF-8"?>');
    buffer.writeln('<AlgorithmComparison>');
    buffer.writeln('  <Type>${report.type.label}</Type>');
    buffer.writeln('  <Timestamp>${report.timestamp.toIso8601String()}</Timestamp>');
    
    buffer.writeln('  <Results>');
    for (final result in report.results) {
      buffer.writeln('    <Result>');
      buffer.writeln('      <Algorithm>${result.algorithmName}</Algorithm>');
      buffer.writeln('      <Metrics>');
      for (final entry in result.metrics.entries) {
        buffer.writeln('        <${entry.key}>${entry.value}</${entry.key}>');
      }
      buffer.writeln('      </Metrics>');
      buffer.writeln('    </Result>');
    }
    buffer.writeln('  </Results>');
    
    buffer.writeln('</AlgorithmComparison>');
    return buffer.toString();
  }
  
  String _exportSchedulingToXml(SchedulingResult result) {
    final buffer = StringBuffer();
    
    buffer.writeln('<?xml version="1.0" encoding="UTF-8"?>');
    buffer.writeln('<SchedulingResult>');
    buffer.writeln('  <Algorithm>${result.algorithm.label}</Algorithm>');
    
    buffer.writeln('  <Processes>');
    for (final process in result.processes) {
      buffer.writeln('    <Process>');
      buffer.writeln('      <PID>${process.pid}</PID>');
      buffer.writeln('      <ArrivalTime>${process.arrivalTime}</ArrivalTime>');
      buffer.writeln('      <BurstTime>${process.burstTime}</BurstTime>');
      buffer.writeln('      <WaitingTime>${process.waitingTime}</WaitingTime>');
      buffer.writeln('    </Process>');
    }
    buffer.writeln('  </Processes>');
    
    buffer.writeln('</SchedulingResult>');
    return buffer.toString();
  }
  
  String _exportMemoryToXml(List<AllocationResult> results, MemoryStatistics stats) {
    final buffer = StringBuffer();
    
    buffer.writeln('<?xml version="1.0" encoding="UTF-8"?>');
    buffer.writeln('<MemoryAnalysis>');
    buffer.writeln('  <Statistics>');
    buffer.writeln('    <TotalMemory>${stats.totalMemory}</TotalMemory>');
    buffer.writeln('    <UsedMemory>${stats.usedMemory}</UsedMemory>');
    buffer.writeln('    <UtilizationRate>${stats.utilizationRate}</UtilizationRate>');
    buffer.writeln('  </Statistics>');
    buffer.writeln('</MemoryAnalysis>');
    
    return buffer.toString();
  }
  
  String _exportBankerToXml(SafetyCheckResult safetyResult, BankerState state) {
    final buffer = StringBuffer();
    
    buffer.writeln('<?xml version="1.0" encoding="UTF-8"?>');
    buffer.writeln('<BankerAlgorithm>');
    buffer.writeln('  <IsSafe>${safetyResult.isSafe}</IsSafe>');
    buffer.writeln('  <Message>${safetyResult.message}</Message>');
    
    if (safetyResult.safeSequence != null) {
      buffer.writeln('  <SafeSequence>');
      for (final index in safetyResult.safeSequence!) {
        buffer.writeln('    <Process>${state.processNames[index]}</Process>');
      }
      buffer.writeln('  </SafeSequence>');
    }
    
    buffer.writeln('</BankerAlgorithm>');
    return buffer.toString();
  }
  
  // ============= 辅助方法 =============
  
  String _progressMapToCsv(Map<String, dynamic> data) {
    final buffer = StringBuffer();
    buffer.writeln('项目,数值');
    
    void processMap(Map<String, dynamic> map, [String prefix = '']) {
      for (final entry in map.entries) {
        final key = prefix.isEmpty ? entry.key : '$prefix.${entry.key}';
        if (entry.value is Map<String, dynamic>) {
          processMap(entry.value as Map<String, dynamic>, key);
        } else {
          buffer.writeln('$key,${entry.value}');
        }
      }
    }
    
    processMap(data);
    return buffer.toString();
  }
  
  String _progressMapToTxt(Map<String, dynamic> data) {
    final buffer = StringBuffer();
    buffer.writeln('学习进度报告');
    buffer.writeln('=' * 40);
    
    void processMap(Map<String, dynamic> map, [int indent = 0]) {
      final indentStr = '  ' * indent;
      for (final entry in map.entries) {
        if (entry.value is Map<String, dynamic>) {
          buffer.writeln('$indentStr${entry.key}:');
          processMap(entry.value as Map<String, dynamic>, indent + 1);
        } else {
          buffer.writeln('$indentStr${entry.key}: ${entry.value}');
        }
      }
    }
    
    processMap(data);
    return buffer.toString();
  }
  
  String _progressMapToXml(Map<String, dynamic> data) {
    final buffer = StringBuffer();
    buffer.writeln('<?xml version="1.0" encoding="UTF-8"?>');
    buffer.writeln('<LearningProgress>');
    
    void processMap(Map<String, dynamic> map, [int indent = 1]) {
      final indentStr = '  ' * indent;
      for (final entry in map.entries) {
        final tag = entry.key.replaceAll(RegExp(r'[^a-zA-Z0-9_]'), '_');
        if (entry.value is Map<String, dynamic>) {
          buffer.writeln('$indentStr<$tag>');
          processMap(entry.value as Map<String, dynamic>, indent + 1);
          buffer.writeln('$indentStr</$tag>');
        } else {
          buffer.writeln('$indentStr<$tag>${entry.value}</$tag>');
        }
      }
    }
    
    processMap(data);
    buffer.writeln('</LearningProgress>');
    return buffer.toString();
  }
  
  void _downloadFile(String content, String fileName, ExportFormat format) {
    final blob = html.Blob([content], format.mimeType);
    final url = html.Url.createObjectUrlFromBlob(blob);
    
    final anchor = html.AnchorElement()
      ..href = url
      ..download = '$fileName.${format.extension}'
      ..style.display = 'none';
    
    html.document.body?.append(anchor);
    anchor.click();
    anchor.remove();
    
    html.Url.revokeObjectUrl(url);
  }
  
  String _formatDateTime(DateTime dateTime) {
    return '${dateTime.year}${dateTime.month.toString().padLeft(2, '0')}'
        '${dateTime.day.toString().padLeft(2, '0')}_'
        '${dateTime.hour.toString().padLeft(2, '0')}'
        '${dateTime.minute.toString().padLeft(2, '0')}';
  }
  
  /// 获取支持的导出格式
  List<ExportFormat> getSupportedFormats() {
    return ExportFormat.values;
  }
  
  /// 获取支持的数据类型
  List<ExportDataType> getSupportedDataTypes() {
    return ExportDataType.values;
  }
}
