import 'package:supabase_flutter/supabase_flutter.dart';

class DashboardService {
  final _supabase = Supabase.instance.client;

  // 获取当前在借图书总册数（使用数量字段求和）
  Future<int> getCurrentBorrowedCount() async {
    try {
      final count = await _supabase.rpc('get_total_currently_borrowed_count');
      return count as int? ?? 0;
    } catch (e) {
      print('获取在借图书数量失败: $e');
      return 0;
    }
  }

  // 获取逾期未还的图书数量
  Future<int> getOverdueCount() async {
    try {
      final now = DateTime.now();
      final response = await _supabase
          .from('borrow_records')
          .select('id')
          .isFilter('return_date', null)
          .lte('due_date', now.toIso8601String());
      
      return (response as List).length;
    } catch (e) {
      print('获取逾期图书数量失败: $e');
      return 0;
    }
  }

  // 获取本月最受欢迎的图书Top 5
  Future<List<Map<String, dynamic>>> getTopBorrowedBooks() async {
    try {
      final firstDayOfMonth = DateTime(DateTime.now().year, DateTime.now().month, 1);
      
      // 使用RPC调用或复杂查询获取本月借阅次数最多的图书
      final response = await _supabase
          .from('borrow_records')
          .select('book_id, books!borrow_records_book_id_fkey(id, title, author, cover_image_url)')
          .gte('borrow_date', firstDayOfMonth.toIso8601String());
      
      // 统计每本书的借阅次数
      final Map<int, Map<String, dynamic>> bookCount = {};
      for (var record in response as List) {
        final bookId = record['book_id'] as int;
        final bookInfo = record['books'] as Map<String, dynamic>;
        
        if (bookCount.containsKey(bookId)) {
          bookCount[bookId]!['count'] = (bookCount[bookId]!['count'] as int) + 1;
        } else {
          bookCount[bookId] = {
            'book_id': bookId,
            'title': bookInfo['title'],
            'author': bookInfo['author'],
            'cover_image_url': bookInfo['cover_image_url'],
            'count': 1,
          };
        }
      }
      
      // 排序并取前5
      final sortedBooks = bookCount.values.toList()
        ..sort((a, b) => (b['count'] as int).compareTo(a['count'] as int));
      
      return sortedBooks.take(5).toList();
    } catch (e) {
      print('获取热门图书失败: $e');
      return [];
    }
  }

  // 获取本月借阅最活跃的学生Top 5
  Future<List<Map<String, dynamic>>> getTopActiveStudents() async {
    try {
      final firstDayOfMonth = DateTime(DateTime.now().year, DateTime.now().month, 1);
      
      // 获取本月所有借阅记录
      final response = await _supabase
          .from('borrow_records')
          .select('student_id, students!borrow_records_student_id_fkey(id, full_name, class_name)')
          .gte('borrow_date', firstDayOfMonth.toIso8601String())
          .not('student_id', 'is', null);
      
      // 统计每个学生的借阅次数
      final Map<int, Map<String, dynamic>> studentCount = {};
      for (var record in response as List) {
        final studentId = record['student_id'] as int;
        final studentInfo = record['students'] as Map<String, dynamic>;
        
        if (studentCount.containsKey(studentId)) {
          studentCount[studentId]!['count'] = (studentCount[studentId]!['count'] as int) + 1;
        } else {
          studentCount[studentId] = {
            'student_id': studentId,
            'full_name': studentInfo['full_name'],
            'class_name': studentInfo['class_name'],
            'count': 1,
          };
        }
      }
      
      // 排序并取前5
      final sortedStudents = studentCount.values.toList()
        ..sort((a, b) => (b['count'] as int).compareTo(a['count'] as int));
      
      return sortedStudents.take(5).toList();
    } catch (e) {
      print('获取活跃学生失败: $e');
      return [];
    }
  }

  // 获取逾期借阅记录详情
  Future<List<Map<String, dynamic>>> getOverdueRecords() async {
    try {
      final now = DateTime.now();
      final response = await _supabase
          .from('borrow_records')
          .select('''
            id,
            borrow_date,
            due_date,
            book_id,
            student_id,
            books!borrow_records_book_id_fkey(title, author),
            students!borrow_records_student_id_fkey(full_name, class_name)
          ''')
          .isFilter('return_date', null)
          .lte('due_date', now.toIso8601String())
          .order('due_date', ascending: true);
      
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      print('获取逾期记录失败: $e');
      return [];
    }
  }

  // 获取图书馆统计摘要
  Future<Map<String, dynamic>> getDashboardSummary() async {
    try {
      // 调用数据库函数来获取总册数
      final totalBooks = await _supabase.rpc('get_total_book_quantity') as int? ?? 0;

      // 获取学生总数
      final studentsResponse = await _supabase
          .from('students')
          .select('id')
          .count();
      final totalStudents = studentsResponse.count ?? 0;

      // 获取本月借阅总数
      final firstDayOfMonth = DateTime(DateTime.now().year, DateTime.now().month, 1);
      final monthlyBorrowsResponse = await _supabase
          .from('borrow_records')
          .select('id')
          .gte('borrow_date', firstDayOfMonth.toIso8601String());
      final monthlyBorrows = (monthlyBorrowsResponse as List).length;

      return {
        'total_books': totalBooks,
        'total_students': totalStudents,
        'monthly_borrows': monthlyBorrows,
        'current_borrowed': await getCurrentBorrowedCount(),
        'overdue_count': await getOverdueCount(),
      };
    } catch (e) {
      print('获取统计摘要失败: $e');
      return {
        'total_books': 0,
        'total_students': 0,
        'monthly_borrows': 0,
        'current_borrowed': 0,
        'overdue_count': 0,
      };
    }
  }
}
