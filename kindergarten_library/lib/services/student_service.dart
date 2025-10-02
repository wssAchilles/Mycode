import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/student.dart';

/// 学生数据服务层
class StudentService {
  static final StudentService _instance = StudentService._internal();
  factory StudentService() => _instance;
  StudentService._internal();

  final supabase = Supabase.instance.client;

  /// 获取所有学生列表流
  Stream<List<Student>> getStudentsStream() {
    return supabase
        .from('students')
        .stream(primaryKey: ['id'])
        .order('class_name')
        .order('full_name')
        .map((List<Map<String, dynamic>> data) {
          return data.map((json) => Student.fromJson(json)).toList();
        });
  }

  /// 获取所有学生列表（一次性）
  Future<List<Student>> getAllStudents() async {
    try {
      final response = await supabase
          .from('students')
          .select()
          .order('class_name')
          .order('full_name');
      
      return (response as List).map((json) => Student.fromJson(json)).toList();
    } catch (e) {
      print('获取学生列表失败: $e');
      rethrow;
    }
  }

  /// 按班级获取学生
  Future<List<Student>> getStudentsByClass(String className) async {
    try {
      final response = await supabase
          .from('students')
          .select()
          .eq('class_name', className)
          .order('full_name');
      
      return (response as List).map((json) => Student.fromJson(json)).toList();
    } catch (e) {
      print('按班级获取学生失败: $e');
      rethrow;
    }
  }

  /// 搜索学生
  Future<List<Student>> searchStudents(String query) async {
    try {
      final response = await supabase
          .from('students')
          .select()
          .or('full_name.ilike.%$query%,class_name.ilike.%$query%')
          .order('class_name')
          .order('full_name');
      
      return (response as List).map((json) => Student.fromJson(json)).toList();
    } catch (e) {
      print('搜索学生失败: $e');
      rethrow;
    }
  }

  /// 根据ID获取单个学生
  Future<Student?> getStudentById(int id) async {
    try {
      final response = await supabase
          .from('students')
          .select()
          .eq('id', id)
          .maybeSingle();
      
      if (response == null) return null;
      return Student.fromJson(response);
    } catch (e) {
      print('获取学生详情失败: $e');
      rethrow;
    }
  }

  /// 添加学生
  Future<void> addStudent(Student student) async {
    try {
      // 准备数据
      final data = {
        'full_name': student.fullName,
        'class_name': student.className,
      };

      await supabase.from('students').insert(data);
    } catch (e) {
      print('添加学生失败: $e');
      rethrow;
    }
  }

  /// 更新学生信息
  Future<void> updateStudent(Student student) async {
    if (student.id == null) {
      throw Exception('无法更新没有ID的学生');
    }

    try {
      final data = {
        'full_name': student.fullName,
        'class_name': student.className,
      };

      await supabase
          .from('students')
          .update(data)
          .eq('id', student.id!);
    } catch (e) {
      print('更新学生失败: $e');
      rethrow;
    }
  }

  /// 删除学生
  Future<void> deleteStudent(int studentId) async {
    try {
      // 检查是否有未归还的借阅记录
      final borrowRecords = await supabase
          .from('borrow_records')
          .select('id')
          .eq('student_id', studentId)
          .filter('return_date', 'is', null);
      
      if (borrowRecords.isNotEmpty) {
        throw Exception('该学生还有未归还的图书，无法删除');
      }

      // 删除学生
      await supabase
          .from('students')
          .delete()
          .eq('id', studentId);
    } catch (e) {
      print('删除学生失败: $e');
      rethrow;
    }
  }

  /// 获取所有班级列表
  Future<List<String>> getAllClasses() async {
    try {
      final response = await supabase
          .from('students')
          .select('class_name')
          .order('class_name');
      
      // 提取唯一的班级名称
      final classes = (response as List)
          .map((json) => json['class_name'] as String)
          .toSet()
          .toList();
      
      return classes;
    } catch (e) {
      print('获取班级列表失败: $e');
      return [];
    }
  }

  /// 批量导入学生
  Future<void> importStudents(List<Student> students) async {
    try {
      final data = students.map((student) => {
        'full_name': student.fullName,
        'class_name': student.className,
      }).toList();

      await supabase.from('students').insert(data);
    } catch (e) {
      print('批量导入学生失败: $e');
      rethrow;
    }
  }
}
