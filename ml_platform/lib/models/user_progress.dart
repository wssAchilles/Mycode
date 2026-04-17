// 用户学习进度模型
import 'package:cloud_firestore/cloud_firestore.dart';

/// 用户学习进度
class UserProgress {
  final String userId;
  final Map<String, AlgorithmProgress> algorithmProgress;
  final Map<String, DataStructureProgress> dataStructureProgress;
  final List<SavedCase> savedCases;
  final DateTime lastUpdated;
  final int totalStudyTime; // 分钟
  final Map<String, int> dailyStudyTime; // 日期 -> 分钟
  
  UserProgress({
    required this.userId,
    required this.algorithmProgress,
    required this.dataStructureProgress,
    required this.savedCases,
    required this.lastUpdated,
    this.totalStudyTime = 0,
    Map<String, int>? dailyStudyTime,
  }) : dailyStudyTime = dailyStudyTime ?? {};
  
  factory UserProgress.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    
    return UserProgress(
      userId: data['userId'] ?? '',
      algorithmProgress: _parseAlgorithmProgress(data['algorithmProgress'] ?? {}),
      dataStructureProgress: _parseDataStructureProgress(data['dataStructureProgress'] ?? {}),
      savedCases: _parseSavedCases(data['savedCases'] ?? []),
      lastUpdated: (data['lastUpdated'] as Timestamp?)?.toDate() ?? DateTime.now(),
      totalStudyTime: data['totalStudyTime'] ?? 0,
      dailyStudyTime: Map<String, int>.from(data['dailyStudyTime'] ?? {}),
    );
  }
  
  Map<String, dynamic> toFirestore() {
    return {
      'userId': userId,
      'algorithmProgress': _algorithmProgressToMap(),
      'dataStructureProgress': _dataStructureProgressToMap(),
      'savedCases': savedCases.map((c) => c.toMap()).toList(),
      'lastUpdated': FieldValue.serverTimestamp(),
      'totalStudyTime': totalStudyTime,
      'dailyStudyTime': dailyStudyTime,
    };
  }
  
  static Map<String, AlgorithmProgress> _parseAlgorithmProgress(Map<String, dynamic> data) {
    final result = <String, AlgorithmProgress>{};
    data.forEach((key, value) {
      result[key] = AlgorithmProgress.fromMap(value);
    });
    return result;
  }
  
  static Map<String, DataStructureProgress> _parseDataStructureProgress(Map<String, dynamic> data) {
    final result = <String, DataStructureProgress>{};
    data.forEach((key, value) {
      result[key] = DataStructureProgress.fromMap(value);
    });
    return result;
  }
  
  static List<SavedCase> _parseSavedCases(List<dynamic> data) {
    return data.map((item) => SavedCase.fromMap(item)).toList();
  }
  
  Map<String, dynamic> _algorithmProgressToMap() {
    final result = <String, dynamic>{};
    algorithmProgress.forEach((key, value) {
      result[key] = value.toMap();
    });
    return result;
  }
  
  Map<String, dynamic> _dataStructureProgressToMap() {
    final result = <String, dynamic>{};
    dataStructureProgress.forEach((key, value) {
      result[key] = value.toMap();
    });
    return result;
  }
}

/// 算法学习进度
class AlgorithmProgress {
  final String algorithmName;
  final int completedSteps;
  final int totalSteps;
  final int practiceCount;
  final double averageSpeed;
  final List<int> practiceScores;
  final DateTime lastPracticed;
  final bool isCompleted;
  
  AlgorithmProgress({
    required this.algorithmName,
    this.completedSteps = 0,
    this.totalSteps = 0,
    this.practiceCount = 0,
    this.averageSpeed = 1.0,
    List<int>? practiceScores,
    DateTime? lastPracticed,
    this.isCompleted = false,
  }) : practiceScores = practiceScores ?? [],
        lastPracticed = lastPracticed ?? DateTime.now();
  
  factory AlgorithmProgress.fromMap(Map<String, dynamic> data) {
    return AlgorithmProgress(
      algorithmName: data['algorithmName'] ?? '',
      completedSteps: data['completedSteps'] ?? 0,
      totalSteps: data['totalSteps'] ?? 0,
      practiceCount: data['practiceCount'] ?? 0,
      averageSpeed: (data['averageSpeed'] ?? 1.0).toDouble(),
      practiceScores: List<int>.from(data['practiceScores'] ?? []),
      lastPracticed: (data['lastPracticed'] as Timestamp?)?.toDate() ?? DateTime.now(),
      isCompleted: data['isCompleted'] ?? false,
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'algorithmName': algorithmName,
      'completedSteps': completedSteps,
      'totalSteps': totalSteps,
      'practiceCount': practiceCount,
      'averageSpeed': averageSpeed,
      'practiceScores': practiceScores,
      'lastPracticed': Timestamp.fromDate(lastPracticed),
      'isCompleted': isCompleted,
    };
  }
  
  double get completionRate => totalSteps > 0 ? completedSteps / totalSteps : 0;
  
  int get averageScore => practiceScores.isEmpty 
      ? 0 
      : practiceScores.reduce((a, b) => a + b) ~/ practiceScores.length;
}

/// 数据结构学习进度
class DataStructureProgress {
  final String structureName;
  final Map<String, bool> operationsCompleted;
  final int practiceCount;
  final DateTime lastPracticed;
  final List<String> completedExercises;
  
  DataStructureProgress({
    required this.structureName,
    Map<String, bool>? operationsCompleted,
    this.practiceCount = 0,
    DateTime? lastPracticed,
    List<String>? completedExercises,
  }) : operationsCompleted = operationsCompleted ?? {},
        lastPracticed = lastPracticed ?? DateTime.now(),
        completedExercises = completedExercises ?? [];
  
  factory DataStructureProgress.fromMap(Map<String, dynamic> data) {
    return DataStructureProgress(
      structureName: data['structureName'] ?? '',
      operationsCompleted: Map<String, bool>.from(data['operationsCompleted'] ?? {}),
      practiceCount: data['practiceCount'] ?? 0,
      lastPracticed: (data['lastPracticed'] as Timestamp?)?.toDate() ?? DateTime.now(),
      completedExercises: List<String>.from(data['completedExercises'] ?? []),
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'structureName': structureName,
      'operationsCompleted': operationsCompleted,
      'practiceCount': practiceCount,
      'lastPracticed': Timestamp.fromDate(lastPracticed),
      'completedExercises': completedExercises,
    };
  }
  
  double get completionRate {
    if (operationsCompleted.isEmpty) return 0;
    final completed = operationsCompleted.values.where((v) => v).length;
    return completed / operationsCompleted.length;
  }
}

/// 保存的案例
class SavedCase {
  final String id;
  final String type; // 'algorithm' or 'dataStructure'
  final String name;
  final List<dynamic> inputData;
  final Map<String, dynamic> configuration;
  final DateTime savedAt;
  final String? description;
  final List<String> tags;
  
  SavedCase({
    required this.id,
    required this.type,
    required this.name,
    required this.inputData,
    required this.configuration,
    required this.savedAt,
    this.description,
    List<String>? tags,
  }) : tags = tags ?? [];
  
  factory SavedCase.fromMap(Map<String, dynamic> data) {
    return SavedCase(
      id: data['id'] ?? '',
      type: data['type'] ?? 'algorithm',
      name: data['name'] ?? '',
      inputData: data['inputData'] ?? [],
      configuration: data['configuration'] ?? {},
      savedAt: (data['savedAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      description: data['description'],
      tags: List<String>.from(data['tags'] ?? []),
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'type': type,
      'name': name,
      'inputData': inputData,
      'configuration': configuration,
      'savedAt': Timestamp.fromDate(savedAt),
      'description': description,
      'tags': tags,
    };
  }
}

/// 学习统计
class StudyStatistics {
  final int totalAlgorithmsCompleted;
  final int totalDataStructuresCompleted;
  final int totalPracticeCount;
  final int totalStudyDays;
  final int currentStreak;
  final int longestStreak;
  final Map<String, int> algorithmPracticeCount;
  final Map<String, double> algorithmMastery;
  final DateTime accountCreated;
  
  StudyStatistics({
    this.totalAlgorithmsCompleted = 0,
    this.totalDataStructuresCompleted = 0,
    this.totalPracticeCount = 0,
    this.totalStudyDays = 0,
    this.currentStreak = 0,
    this.longestStreak = 0,
    Map<String, int>? algorithmPracticeCount,
    Map<String, double>? algorithmMastery,
    DateTime? accountCreated,
  }) : algorithmPracticeCount = algorithmPracticeCount ?? {},
        algorithmMastery = algorithmMastery ?? {},
        accountCreated = accountCreated ?? DateTime.now();
  
  factory StudyStatistics.fromMap(Map<String, dynamic> data) {
    return StudyStatistics(
      totalAlgorithmsCompleted: data['totalAlgorithmsCompleted'] ?? 0,
      totalDataStructuresCompleted: data['totalDataStructuresCompleted'] ?? 0,
      totalPracticeCount: data['totalPracticeCount'] ?? 0,
      totalStudyDays: data['totalStudyDays'] ?? 0,
      currentStreak: data['currentStreak'] ?? 0,
      longestStreak: data['longestStreak'] ?? 0,
      algorithmPracticeCount: Map<String, int>.from(data['algorithmPracticeCount'] ?? {}),
      algorithmMastery: Map<String, double>.from(data['algorithmMastery'] ?? {}),
      accountCreated: (data['accountCreated'] as Timestamp?)?.toDate() ?? DateTime.now(),
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'totalAlgorithmsCompleted': totalAlgorithmsCompleted,
      'totalDataStructuresCompleted': totalDataStructuresCompleted,
      'totalPracticeCount': totalPracticeCount,
      'totalStudyDays': totalStudyDays,
      'currentStreak': currentStreak,
      'longestStreak': longestStreak,
      'algorithmPracticeCount': algorithmPracticeCount,
      'algorithmMastery': algorithmMastery,
      'accountCreated': Timestamp.fromDate(accountCreated),
    };
  }
}
