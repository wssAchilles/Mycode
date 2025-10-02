import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/borrow_record.dart';
import '../services/borrow_service.dart';
import 'package:intl/intl.dart';

/// 还书页面
class ReturnBookScreen extends StatefulWidget {
  const ReturnBookScreen({Key? key}) : super(key: key);

  @override
  State<ReturnBookScreen> createState() => _ReturnBookScreenState();
}

class _ReturnBookScreenState extends State<ReturnBookScreen> {
  final BorrowService _borrowService = BorrowService();
  final supabase = Supabase.instance.client;
  
  List<BorrowRecord> _borrowRecords = [];
  String _searchQuery = '';
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadBorrowRecords();
  }

  Future<void> _loadBorrowRecords() async {
    setState(() => _isLoading = true);
    
    try {
      final response = await supabase
          .from('borrow_records')
          .select('''
            *,
            books!borrow_records_book_id_fkey(id, title, author, cover_image_url),
            students!borrow_records_student_id_fkey(id, full_name, class_name)
          ''')
          .isFilter('return_date', null)
          .order('borrow_date', ascending: false);
      
      setState(() {
        _borrowRecords = (response as List)
            .map((data) => BorrowRecord.fromJson(data))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      _showSnackBar('加载借阅记录失败: $e');
    }
  }

  Future<void> _returnBook(int recordId) async {
    try {
      await _borrowService.returnBook(recordId);
      _showSnackBar('还书成功！');
      _loadBorrowRecords(); // 重新加载数据
    } catch (e) {
      _showSnackBar('还书失败: $e');
    }
  }

  void _showReturnDialog(BorrowRecord record) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认还书'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('书名: ${record.bookTitle}'),
            Text('借阅人: ${record.studentName}'),
            Text('借阅日期: ${DateFormat('yyyy-MM-dd').format(record.borrowDate)}'),
            Text('应还日期: ${record.dueDate != null ? DateFormat('yyyy-MM-dd').format(record.dueDate!) : '未设定'}'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              _returnBook(record.id!);
            },
            child: const Text('确认还书'),
          ),
        ],
      ),
    );
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  List<BorrowRecord> get _filteredRecords {
    if (_searchQuery.isEmpty) return _borrowRecords;
    
    return _borrowRecords.where((record) {
      return (record.bookTitle?.toLowerCase() ?? '').contains(_searchQuery.toLowerCase()) ||
          (record.studentName?.toLowerCase() ?? '').contains(_searchQuery.toLowerCase());
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('归还图书'),
        backgroundColor: Colors.green.shade600,
      ),
      body: Column(
        children: [
          // 搜索栏
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              decoration: InputDecoration(
                hintText: '搜索书名或借阅人...',
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(30),
                ),
                filled: true,
                fillColor: Colors.grey[100],
              ),
              onChanged: (value) {
                setState(() => _searchQuery = value);
              },
            ),
          ),
          
          // 借阅记录列表
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _filteredRecords.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.assignment_return_outlined,
                              size: 80,
                              color: Colors.grey[400],
                            ),
                            const SizedBox(height: 16),
                            Text(
                              _searchQuery.isEmpty ? '暂无借阅记录' : '未找到匹配的记录',
                              style: TextStyle(
                                fontSize: 16,
                                color: Colors.grey[600],
                              ),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _filteredRecords.length,
                        itemBuilder: (context, index) {
                          final record = _filteredRecords[index];
                          final isOverdue = record.dueDate != null && record.dueDate!.isBefore(DateTime.now());
                          final daysOverdue = isOverdue && record.dueDate != null
                              ? DateTime.now().difference(record.dueDate!).inDays
                              : 0;
                          
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor: isOverdue ? Colors.red : Colors.green,
                                child: Icon(
                                  Icons.book,
                                  color: Colors.white,
                                ),
                              ),
                              title: Text(record.bookTitle ?? '未知图书'),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('借阅人: ${record.studentName}'),
                                  Text('借阅日期: ${DateFormat('yyyy-MM-dd').format(record.borrowDate)}'),
                                  Text(
                                    isOverdue 
                                        ? '已逾期 $daysOverdue 天'
                                        : '应还日期: ${record.dueDate != null ? DateFormat('yyyy-MM-dd').format(record.dueDate!) : '未设定'}',
                                    style: TextStyle(
                                      color: isOverdue ? Colors.red : Colors.grey[600],
                                      fontWeight: isOverdue ? FontWeight.bold : FontWeight.normal,
                                    ),
                                  ),
                                ],
                              ),
                              trailing: ElevatedButton(
                                onPressed: () => _showReturnDialog(record),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: isOverdue ? Colors.red : Colors.green,
                                ),
                                child: const Text(
                                  '还书',
                                  style: TextStyle(color: Colors.white),
                                ),
                              ),
                              isThreeLine: true,
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
