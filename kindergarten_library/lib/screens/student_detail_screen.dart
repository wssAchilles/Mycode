import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/student.dart';
import '../models/borrow_record.dart';
import '../services/borrow_service.dart';
import 'add_edit_student_screen.dart';
import '../utils/page_transitions.dart';
import 'package:intl/intl.dart';

/// 学生详情页面
class StudentDetailScreen extends StatefulWidget {
  final Student student;
  
  const StudentDetailScreen({
    Key? key,
    required this.student,
  }) : super(key: key);

  @override
  State<StudentDetailScreen> createState() => _StudentDetailScreenState();
}

class _StudentDetailScreenState extends State<StudentDetailScreen> with TickerProviderStateMixin {
  final BorrowService _borrowService = BorrowService();
  final supabase = Supabase.instance.client;
  
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  
  List<BorrowRecord> _borrowHistory = [];
  List<BorrowRecord> _currentBorrows = [];
  bool _isLoading = true;
  int _totalBorrows = 0;
  int _overdueBooks = 0;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );
    _fadeAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeIn,
    );
    _loadStudentBorrows();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  Future<void> _loadStudentBorrows() async {
    setState(() => _isLoading = true);
    
    try {
      final response = await supabase
          .from('borrow_records')
          .select('''
            *,
            books!borrow_records_book_id_fkey(id, title, author, cover_image_url)
          ''')
          .eq('student_id', widget.student.id!)
          .order('borrow_date', ascending: false);
      
      final records = (response as List)
          .map((data) => BorrowRecord.fromJson(data))
          .toList();
      
      setState(() {
        _borrowHistory = records;
        _currentBorrows = records.where((r) => r.returnDate == null).toList();
        _totalBorrows = records.length;
        _overdueBooks = _currentBorrows
            .where((r) => r.dueDate != null && r.dueDate!.isBefore(DateTime.now()))
            .length;
        _isLoading = false;
      });
      
      _animationController.forward();
    } catch (e) {
      setState(() => _isLoading = false);
      _showSnackBar('加载借阅记录失败: $e');
    }
  }

  Future<void> _returnBook(int recordId) async {
    try {
      await _borrowService.returnBook(recordId);
      _showSnackBar('还书成功！');
      _loadStudentBorrows(); // 重新加载数据
    } catch (e) {
      _showSnackBar('还书失败: $e');
    }
  }

  void _showReturnDialog(BorrowRecord record) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认还书'),
        content: Text('确认归还《${record.bookTitle}》吗？'),
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

  void _editStudent() {
    Navigator.push(
      context,
      SlidePageRoute(
        page: AddEditStudentScreen(student: widget.student),
      ),
    ).then((result) {
      if (result == true) {
        // 学生信息已更新，重新加载页面
        Navigator.pop(context, true);
      }
    });
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: Text(widget.student.fullName),
        backgroundColor: Colors.blue.shade600,
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: _editStudent,
            tooltip: '编辑学生信息',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : FadeTransition(
              opacity: _fadeAnimation,
              child: CustomScrollView(
                slivers: [
                  // 学生基本信息卡片
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: _buildStudentInfoCard(),
                    ),
                  ),
                  
                  // 统计信息卡片
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: _buildStatisticsCard(),
                    ),
                  ),
                  
                  // 当前借阅
                  if (_currentBorrows.isNotEmpty) ...[
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(16, 24, 16, 8),
                        child: Text(
                          '当前借阅',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) => Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                          child: _buildBorrowRecordCard(_currentBorrows[index], true),
                        ),
                        childCount: _currentBorrows.length,
                      ),
                    ),
                  ],
                  
                  // 借阅历史
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(16, 24, 16, 8),
                      child: Text(
                        '借阅历史',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  
                  _borrowHistory.isEmpty
                      ? SliverToBoxAdapter(
                          child: Padding(
                            padding: const EdgeInsets.all(32),
                            child: Center(
                              child: Column(
                                children: [
                                  Icon(
                                    Icons.history,
                                    size: 64,
                                    color: Colors.grey[300],
                                  ),
                                  const SizedBox(height: 16),
                                  Text(
                                    '暂无借阅记录',
                                    style: TextStyle(
                                      color: Colors.grey[500],
                                      fontSize: 16,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        )
                      : SliverList(
                          delegate: SliverChildBuilderDelegate(
                            (context, index) => Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                              child: _buildBorrowRecordCard(_borrowHistory[index], false),
                            ),
                            childCount: _borrowHistory.length,
                          ),
                        ),
                  
                  const SliverToBoxAdapter(
                    child: SizedBox(height: 80),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildStudentInfoCard() {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: LinearGradient(
            colors: [Colors.blue.shade500, Colors.blue.shade700],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Column(
          children: [
            CircleAvatar(
              radius: 40,
              backgroundColor: Colors.white,
              child: Text(
                widget.student.fullName.isNotEmpty ? widget.student.fullName[0] : '?',
                style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.bold,
                  color: Colors.blue.shade600,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              widget.student.fullName,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            if (widget.student.className != null)
              Text(
                widget.student.className!,
                style: const TextStyle(
                  fontSize: 16,
                  color: Colors.white70,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatisticsCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: _buildStatItem(
                '总借阅',
                _totalBorrows.toString(),
                Icons.book,
                Colors.blue,
              ),
            ),
            const VerticalDivider(),
            Expanded(
              child: _buildStatItem(
                '当前在借',
                _currentBorrows.length.toString(),
                Icons.book_outlined,
                Colors.green,
              ),
            ),
            const VerticalDivider(),
            Expanded(
              child: _buildStatItem(
                '逾期图书',
                _overdueBooks.toString(),
                Icons.warning,
                Colors.red,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatItem(String title, String value, IconData icon, Color color) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, color: color, size: 24),
        ),
        const SizedBox(height: 8),
        Text(
          value,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Colors.grey[800],
          ),
        ),
        Text(
          title,
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey[600],
          ),
        ),
      ],
    );
  }

  Widget _buildBorrowRecordCard(BorrowRecord record, bool isCurrent) {
    final isOverdue = isCurrent && record.dueDate != null && record.dueDate!.isBefore(DateTime.now());
    
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: isOverdue ? Colors.red : (isCurrent ? Colors.orange : Colors.green),
          child: Icon(
            isCurrent ? Icons.book_outlined : Icons.check,
            color: Colors.white,
          ),
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(record.bookTitle ?? '未知图书'),
            ),
            // 显示借阅数量
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.blue[100],
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '×${record.quantity}',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: Colors.blue[700],
                ),
              ),
            ),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('借阅日期: ${DateFormat('yyyy-MM-dd').format(record.borrowDate)}'),
                const SizedBox(width: 12),
                Text(
                  '数量: ${record.quantity} 本',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey[600],
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
            if (isCurrent) ...[
              Text(
                isOverdue 
                    ? '已逾期 ${DateTime.now().difference(record.dueDate!).inDays} 天'
                    : '应还日期: ${DateFormat('yyyy-MM-dd').format(record.dueDate!)}',
                style: TextStyle(
                  color: isOverdue ? Colors.red : Colors.grey[600],
                  fontWeight: isOverdue ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ] else if (record.returnDate != null) ...[
              Text('归还日期: ${DateFormat('yyyy-MM-dd').format(record.returnDate!)}'),
            ],
          ],
        ),
        trailing: isCurrent
            ? ElevatedButton(
                onPressed: () => _showReturnDialog(record),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isOverdue ? Colors.red : Colors.green,
                ),
                child: const Text(
                  '还书',
                  style: TextStyle(color: Colors.white),
                ),
              )
            : null,
        isThreeLine: true,
      ),
    );
  }
}
