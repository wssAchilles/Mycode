import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../models/borrow_record.dart';

/// 超级管理员专属：查看所有借阅记录页面
/// 仅管理员角色可以访问，显示系统中所有用户的借阅历史
class AllBorrowRecordsScreen extends StatefulWidget {
  const AllBorrowRecordsScreen({super.key});

  @override
  State<AllBorrowRecordsScreen> createState() => _AllBorrowRecordsScreenState();
}

class _AllBorrowRecordsScreenState extends State<AllBorrowRecordsScreen> {
  final SupabaseClient _supabase = Supabase.instance.client;
  
  List<Map<String, dynamic>> _allRecords = [];
  List<Map<String, dynamic>> _filteredRecords = [];
  bool _isLoading = true;
  String _searchQuery = '';
  String _selectedFilter = '全部'; // 全部、已归还、未归还、逾期
  
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadAllBorrowRecords();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// 加载所有借阅记录（深度关联查询）
  Future<void> _loadAllBorrowRecords() async {
    setState(() => _isLoading = true);
    
    try {
      final response = await _supabase
          .from('borrow_records')
          .select('''
            *,
            books!borrow_records_book_id_fkey(title, author),
            students!borrow_records_student_id_fkey(full_name, class_name),
            borrower_profile:profiles!borrow_records_profile_id_fkey(full_name),
            handler_profile:profiles!borrow_records_borrowed_by_user_id_fkey(full_name)
          ''')
          .order('borrow_date', ascending: false);

      setState(() {
        _allRecords = List<Map<String, dynamic>>.from(response);
        _filteredRecords = _allRecords;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('加载借阅记录失败: $e')),
        );
      }
    }
  }

  /// 应用搜索和筛选
  void _applyFilters() {
    List<Map<String, dynamic>> filtered = _allRecords;

    // 应用状态筛选
    if (_selectedFilter != '全部') {
      filtered = filtered.where((record) {
        switch (_selectedFilter) {
          case '已归还':
            return record['return_date'] != null;
          case '未归还':
            return record['return_date'] == null && 
                   (record['due_date'] == null || 
                    DateTime.parse(record['due_date']).isAfter(DateTime.now()));
          case '逾期':
            return record['return_date'] == null && 
                   record['due_date'] != null && 
                   DateTime.parse(record['due_date']).isBefore(DateTime.now());
          default:
            return true;
        }
      }).toList();
    }

    // 应用搜索筛选
    if (_searchQuery.isNotEmpty) {
      filtered = filtered.where((record) {
        final bookTitle = record['books']['title']?.toString().toLowerCase() ?? '';
        final studentName = record['students']?['full_name']?.toString().toLowerCase() ?? '';
        final borrowerTeacher = record['borrower_profile']?['full_name']?.toString().toLowerCase() ?? '';
        final handlerTeacher = record['handler_profile']?['full_name']?.toString().toLowerCase() ?? '';
        final query = _searchQuery.toLowerCase();
        
        return bookTitle.contains(query) || 
               studentName.contains(query) || 
               borrowerTeacher.contains(query) ||
               handlerTeacher.contains(query);
      }).toList();
    }

    setState(() {
      _filteredRecords = filtered;
    });
  }

  /// 格式化日期显示
  String _formatDate(String? dateStr) {
    if (dateStr == null) return '-';
    try {
      final date = DateTime.parse(dateStr);
      return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    } catch (e) {
      return '-';
    }
  }

  /// 获取记录状态显示
  Widget _getStatusChip(Map<String, dynamic> record) {
    if (record['return_date'] != null) {
      return Chip(
        label: const Text('已归还'),
        backgroundColor: Colors.green.shade100,
        labelStyle: TextStyle(color: Colors.green.shade800),
      );
    } else if (record['due_date'] != null && 
               DateTime.parse(record['due_date']).isBefore(DateTime.now())) {
      return Chip(
        label: const Text('逾期'),
        backgroundColor: Colors.red.shade100,
        labelStyle: TextStyle(color: Colors.red.shade800),
      );
    } else {
      return Chip(
        label: const Text('借阅中'),
        backgroundColor: Colors.blue.shade100,
        labelStyle: TextStyle(color: Colors.blue.shade800),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('所有借阅记录'),
            Text(
              '共 ${_filteredRecords.length} 条记录',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.normal),
            ),
          ],
        ),
        backgroundColor: Colors.deepPurple,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadAllBorrowRecords,
            tooltip: '刷新数据',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // 搜索和筛选栏
                _buildFilterSection(),
                
                // 记录列表
                Expanded(
                  child: _filteredRecords.isEmpty
                      ? const Center(
                          child: Text(
                            '暂无符合条件的借阅记录',
                            style: TextStyle(fontSize: 16, color: Colors.grey),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _filteredRecords.length,
                          itemBuilder: (context, index) {
                            final record = _filteredRecords[index];
                            return _buildRecordCard(record);
                          },
                        ),
                ),
              ],
            ),
    );
  }

  /// 构建筛选区域
  Widget _buildFilterSection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        border: Border(bottom: BorderSide(color: Colors.grey.shade300)),
      ),
      child: Column(
        children: [
          // 搜索框
          TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: '搜索图书名称、学生姓名或借阅老师',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _searchController.clear();
                        setState(() => _searchQuery = '');
                        _applyFilters();
                      },
                    )
                  : null,
              border: const OutlineInputBorder(),
            ),
            onChanged: (value) {
              setState(() => _searchQuery = value);
              _applyFilters();
            },
          ),
          const SizedBox(height: 12),
          
          // 状态筛选
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: ['全部', '已归还', '未归还', '逾期'].map((filter) {
                final isSelected = _selectedFilter == filter;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(filter),
                    selected: isSelected,
                    onSelected: (_) {
                      setState(() => _selectedFilter = filter);
                      _applyFilters();
                    },
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  /// 构建借阅记录卡片
  Widget _buildRecordCard(Map<String, dynamic> record) {
    final book = record['books'] as Map<String, dynamic>;
    final student = record['students'] as Map<String, dynamic>?;
    final borrowerProfile = record['borrower_profile'] as Map<String, dynamic>?;
    final handlerProfile = record['handler_profile'] as Map<String, dynamic>?;

    // 确定借阅人：如果有学生信息显示学生，否则显示老师
    final borrowerName = student?['full_name'] ?? borrowerProfile?['full_name'] ?? '未知借阅人';
    final borrowerType = student != null ? '学生' : '老师';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 头部：图书和状态
            Row(
              children: [
                Expanded(
                  child: Text(
                    book['title'] ?? '未知图书',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                _getStatusChip(record),
              ],
            ),
            const SizedBox(height: 8),
            
            // 图书作者
            if (book['author'] != null)
              Text(
                '作者：${book['author']}',
                style: TextStyle(color: Colors.grey.shade600),
              ),
            const SizedBox(height: 8),
            
            // 借阅信息
            _buildInfoRow('借阅人', '$borrowerName ($borrowerType)'),
            if (student != null)
              _buildInfoRow('学生班级', student['class_name'] ?? '-'),
            _buildInfoRow('借阅数量', '${record['quantity'] ?? 1} 本'),
            _buildInfoRow('借阅日期', _formatDate(record['borrow_date'])),
            
            if (record['due_date'] != null)
              _buildInfoRow('应还日期', _formatDate(record['due_date'])),
            
            if (record['return_date'] != null)
              _buildInfoRow('实还日期', _formatDate(record['return_date'])),
            
            _buildInfoRow('经办老师', handlerProfile?['full_name'] ?? '未知老师'),
            
            if (record['notes'] != null && record['notes'].toString().isNotEmpty)
              _buildInfoRow('备注', record['notes']),
          ],
        ),
      ),
    );
  }

  /// 构建信息行
  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label：',
              style: TextStyle(
                color: Colors.grey.shade600,
                fontSize: 14,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}
