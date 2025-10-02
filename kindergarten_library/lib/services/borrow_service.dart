import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/borrow_record.dart';
import '../models/book.dart';
import '../models/student.dart';

/// 借阅服务层
class BorrowService {
  static final BorrowService _instance = BorrowService._internal();
  factory BorrowService() => _instance;
  BorrowService._internal();

  final supabase = Supabase.instance.client;

  /// 借出图书给学生（事务性操作）
  Future<void> borrowBookToStudent({
    required Book book,
    required Student student,
    int quantity = 1, // 本次借阅的数量，默认为1
    int borrowDays = 14, // 默认借阅期14天
  }) async {
    // 检查数量参数有效性
    if (quantity <= 0) {
      throw Exception('借阅数量必须大于0');
    }
    
    if (book.availableQuantity < quantity) {
      throw Exception('库存不足，当前可借数量：${book.availableQuantity}，需要数量：$quantity');
    }

    final currentUser = supabase.auth.currentUser;
    if (currentUser == null) {
      throw Exception('用户未登录');
    }

    try {
      // 获取经办老师姓名
      final profileResponse = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', currentUser.id)
          .single();
      
      final handlerName = profileResponse['full_name'] ?? currentUser.email?.split('@')[0];

      // 准备借阅记录数据
      final borrowRecord = {
        'book_id': book.id,
        'student_id': student.id,
        'borrow_date': DateTime.now().toIso8601String(),
        'due_date': DateTime.now().add(Duration(days: borrowDays)).toIso8601String(),
        'borrowed_by_user_id': currentUser.id,
        'quantity': quantity, // 添加数量字段
      };

      // 事务性操作：创建借阅记录 + 减少可借数量
      await supabase.rpc('borrow_book_with_quantity', params: {
        'p_book_id': book.id,
        'p_quantity': quantity,
        'p_borrow_record': borrowRecord,
      }).catchError((error) async {
        // 如果RPC不存在，使用两步操作（注意：这不是真正的事务）
        // 1. 先检查并递减可借数量
        final updateResult = await supabase
            .from('books')
            .update({
              'available_quantity': book.availableQuantity - quantity,
              'last_updated_by': currentUser.id,
            })
            .eq('id', book.id!)
            .gte('available_quantity', quantity)  // 确保可借数量足够
            .select();
        
        if (updateResult.isEmpty) {
          throw Exception('借书失败：库存不足，当前可借数量：${book.availableQuantity}，需要数量：$quantity');
        }
        
        // 2. 创建借阅记录
        await supabase.from('borrow_records').insert(borrowRecord);
      });
    } catch (e) {
      print('借出图书失败: $e');
      rethrow;
    }
  }

  /// 借出图书给老师自己（事务性操作）
  Future<void> borrowBookToTeacher({
    required Book book,
    int quantity = 1, // 本次借阅的数量，默认为1
    int borrowDays = 30, // 老师默认借阅期30天
  }) async {
    // 检查数量参数有效性
    if (quantity <= 0) {
      throw Exception('借阅数量必须大于0');
    }
    
    if (book.availableQuantity < quantity) {
      throw Exception('库存不足，当前可借数量：${book.availableQuantity}，需要数量：$quantity');
    }

    final currentUser = supabase.auth.currentUser;
    if (currentUser == null) {
      throw Exception('用户未登录');
    }

    try {
      // 获取老师姓名
      final profileResponse = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', currentUser.id)
          .single();
      
      final teacherName = profileResponse['full_name'] ?? currentUser.email?.split('@')[0];

      // 准备借阅记录数据
      final borrowRecord = {
        'book_id': book.id,
        'profile_id': currentUser.id,  // 老师借阅时使用profile_id
        'borrow_date': DateTime.now().toIso8601String(),
        'due_date': DateTime.now().add(Duration(days: borrowDays)).toIso8601String(),
        'borrowed_by_user_id': currentUser.id,
        'quantity': quantity, // 添加数量字段
      };

      // 事务性操作：创建借阅记录 + 减少可借数量
      await supabase.rpc('borrow_book_with_quantity', params: {
        'p_book_id': book.id,
        'p_quantity': quantity,
        'p_borrow_record': borrowRecord,
      }).catchError((error) async {
        // 如果RPC不存在，使用两步操作
        // 1. 先检查并递减可借数量
        final updateResult = await supabase
            .from('books')
            .update({
              'available_quantity': book.availableQuantity - quantity,
              'last_updated_by': currentUser.id,
            })
            .eq('id', book.id!)
            .gte('available_quantity', quantity)  // 确保可借数量足够
            .select();
        
        if (updateResult.isEmpty) {
          throw Exception('借书失败：库存不足，当前可借数量：${book.availableQuantity}，需要数量：$quantity');
        }
        
        // 2. 创建借阅记录
        await supabase.from('borrow_records').insert(borrowRecord);
      });
    } catch (e) {
      print('借出图书失败: $e');
      rethrow;
    }
  }

  /// 归还图书（通过借阅记录ID）
  Future<void> returnBook(int recordId) async {
    try {
      final currentUser = supabase.auth.currentUser;
      if (currentUser == null) {
        throw Exception('用户未登录');
      }

      // 获取借阅记录
      final recordResponse = await supabase
          .from('borrow_records')
          .select('*, books!borrow_records_book_id_fkey(id, available_quantity, total_quantity)')
          .eq('id', recordId)
          .single();

      if (recordResponse['return_date'] != null) {
        throw Exception('该图书已经归还');
      }

      final bookId = recordResponse['books']['id'];
      final currentAvailable = recordResponse['books']['available_quantity'];
      final totalQuantity = recordResponse['books']['total_quantity'];
      final returnQuantity = recordResponse['quantity'] as int? ?? 1; // 获取借阅数量

      // 更新借阅记录
      await supabase
          .from('borrow_records')
          .update({
            'return_date': DateTime.now().toIso8601String(),
          })
          .eq('id', recordId);
      
      // 增加可借数量
      await supabase
          .from('books')
          .update({
            'available_quantity': (currentAvailable + returnQuantity).clamp(0, totalQuantity),  // 按实际借阅数量归还
            'last_updated_by': currentUser.id,
          })
          .eq('id', bookId);

    } catch (e) {
      print('归还图书失败: $e');
      rethrow;
    }
  }

  /// 归还图书（通过图书对象）
  Future<void> returnBookByBook({
    required Book book,
  }) async {
    final currentUser = supabase.auth.currentUser;
    if (currentUser == null) {
      throw Exception('用户未登录');
    }

    try {
      // 查找未归还的借阅记录
      final borrowRecordResponse = await supabase
          .from('borrow_records')
          .select()
          .eq('book_id', book.id!)
          .filter('return_date', 'is', null)
          .maybeSingle();
      
      if (borrowRecordResponse == null) {
        throw Exception('未找到该图书的借阅记录');
      }

      final borrowRecordId = borrowRecordResponse['id'];

      // 事务性操作：更新借阅记录 + 增加可借数量
      await supabase.rpc('return_book_with_quantity', params: {
        'p_book_id': book.id,
        'p_borrow_record_id': borrowRecordId,
        'p_returned_at': DateTime.now().toIso8601String(),
        'p_handler_id': currentUser.id,
      }).catchError((error) async {
        // 如果RPC不存在，使用两步操作
        // 1. 更新借阅记录
        await supabase
            .from('borrow_records')
            .update({
              'return_date': DateTime.now().toIso8601String(),
            })
            .eq('id', borrowRecordId);
        
        // 2. 增加可借数量（使用借阅记录中的数量）
        final returnQuantity = borrowRecordResponse['quantity'] as int? ?? 1;
        await supabase
            .from('books')
            .update({
              'available_quantity': (book.availableQuantity + returnQuantity).clamp(0, book.totalQuantity),
              'last_updated_by': currentUser.id,
            })
            .eq('id', book.id!);
      });
    } catch (e) {
      print('归还图书失败: $e');
      rethrow;
    }
  }

  /// 获取某本书的当前借阅记录（未归还的）
  Future<BorrowRecord?> getCurrentBorrowRecord(int bookId) async {
    try {
      final response = await supabase
          .from('borrow_records')
          .select('''
            *,
            students!borrow_records_student_id_fkey ( full_name ),
            profiles!borrow_records_profile_id_fkey ( full_name )
          ''')
          .eq('book_id', bookId)
          .filter('return_date', 'is', null)
          .maybeSingle();

      if (response == null) return null;
      
      // 调试：打印查询返回的原始数据
      print('getCurrentBorrowRecord 原始数据: $response');
      
      final borrowRecord = BorrowRecord.fromJson(response);
      
      // 调试：打印解析后的借阅人信息
      print('解析后的学生姓名: ${borrowRecord.studentName}');
      print('解析后的老师姓名: ${borrowRecord.teacherName}');
      
      return borrowRecord;
    } catch (e) {
      print('获取借阅记录失败: $e');
      return null;
    }
  }

  /// 获取学生的借阅历史
  Future<List<BorrowRecord>> getStudentBorrowHistory(int studentId) async {
    try {
      final response = await supabase
          .from('borrow_records')
          .select()
          .eq('student_id', studentId)
          .order('borrow_date', ascending: false);

      return (response as List).map((json) => BorrowRecord.fromJson(json)).toList();
    } catch (e) {
      print('获取学生借阅历史失败: $e');
      return [];
    }
  }

  /// 获取老师的借阅历史
  Future<List<BorrowRecord>> getTeacherBorrowHistory(String teacherId) async {
    try {
      final response = await supabase
          .from('borrow_records')
          .select()
          .eq('profile_id', teacherId)
          .order('borrow_date', ascending: false);

      return (response as List).map((json) => BorrowRecord.fromJson(json)).toList();
    } catch (e) {
      print('获取老师借阅历史失败: $e');
      return [];
    }
  }

  /// 获取所有未归还的借阅记录
  Stream<List<BorrowRecord>> getActiveBorrowsStream() {
    return supabase
        .from('borrow_records')
        .stream(primaryKey: ['id'])
        .order('due_date')
        .map((List<Map<String, dynamic>> data) {
          // 在内存中过滤未归还的记录
          return data
              .where((json) => json['return_date'] == null)
              .map((json) => BorrowRecord.fromJson(json))
              .toList();
        });
  }

  /// 获取逾期未还的借阅记录
  Future<List<BorrowRecord>> getOverdueRecords() async {
    try {
      final response = await supabase
          .from('borrow_records')
          .select()
          .lt('due_date', DateTime.now().toIso8601String())
          .order('due_date');

      // 在内存中过滤未归还的记录
      final filteredResponse = (response as List)
          .where((json) => json['return_date'] == null)
          .toList();

      return filteredResponse.map((json) => BorrowRecord.fromJson(json)).toList();
    } catch (e) {
      print('获取逾期记录失败: $e');
      return [];
    }
  }

  /// 续借（延长归还期限）
  Future<void> renewBorrow({
    required BorrowRecord record,
    int extraDays = 7,
  }) async {
    if (record.isReturned) {
      throw Exception('该图书已归还，无需续借');
    }

    try {
      final newDueDate = record.dueDate?.add(Duration(days: extraDays)) ?? DateTime.now().add(Duration(days: extraDays));
      
      await supabase
          .from('borrow_records')
          .update({
            'due_date': newDueDate.toIso8601String(),
          })
          .eq('id', record.id);
    } catch (e) {
      print('续借失败: $e');
      rethrow;
    }
  }

  /// 获取借阅统计信息
  Future<Map<String, dynamic>> getBorrowStatistics() async {
    try {
      // 获取总借阅次数
      final totalBorrows = await supabase
          .from('borrow_records')
          .select('*')
          .count(CountOption.exact);

      // 获取当前借出数量
      final activeBorrows = await supabase
          .from('borrow_records')
          .select('*')
          .filter('return_date', 'is', null)
          .count(CountOption.exact);

      // 获取逾期数量
      final overdueBorrows = await supabase
          .from('borrow_records')
          .select('*')
          .filter('return_date', 'is', null)
          .lt('due_date', DateTime.now().toIso8601String())
          .count(CountOption.exact);

      return {
        'total_borrows': totalBorrows.count,
        'active_borrows': activeBorrows.count,
        'overdue_borrows': overdueBorrows.count,
      };
    } catch (e) {
      print('获取统计信息失败: $e');
      return {
        'total_borrows': 0,
        'active_borrows': 0,
        'overdue_borrows': 0,
      };
    }
  }
}
