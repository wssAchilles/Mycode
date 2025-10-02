import 'package:flutter/material.dart';
import '../services/dashboard_service.dart';
import 'package:intl/intl.dart';

class OverdueRecordsScreen extends StatefulWidget {
  const OverdueRecordsScreen({Key? key}) : super(key: key);

  @override
  State<OverdueRecordsScreen> createState() => _OverdueRecordsScreenState();
}

class _OverdueRecordsScreenState extends State<OverdueRecordsScreen> {
  final DashboardService _dashboardService = DashboardService();
  List<Map<String, dynamic>> _overdueRecords = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadOverdueRecords();
  }

  Future<void> _loadOverdueRecords() async {
    setState(() => _isLoading = true);
    
    try {
      final records = await _dashboardService.getOverdueRecords();
      setState(() {
        _overdueRecords = records;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('加载逾期记录失败: $e')),
      );
    }
  }

  int _calculateOverdueDays(String dueDate) {
    final due = DateTime.parse(dueDate);
    final now = DateTime.now();
    return now.difference(due).inDays;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('逾期未还图书'),
        backgroundColor: Colors.red.shade600,
        elevation: 0,
      ),
      body: RefreshIndicator(
        onRefresh: _loadOverdueRecords,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _overdueRecords.isEmpty
                ? _buildEmptyState()
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _overdueRecords.length,
                    itemBuilder: (context, index) {
                      final record = _overdueRecords[index];
                      return _buildOverdueCard(record);
                    },
                  ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.celebration,
            size: 80,
            color: Colors.green[300],
          ),
          const SizedBox(height: 16),
          Text(
            '太棒了！',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: Colors.grey[800],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '目前没有逾期未还的图书',
            style: TextStyle(
              fontSize: 16,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.arrow_back),
            label: const Text('返回仪表盘'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOverdueCard(Map<String, dynamic> record) {
    final overdueDays = _calculateOverdueDays(record['due_date']);
    final bookInfo = record['books'] as Map<String, dynamic>;
    final studentInfo = record['students'] as Map<String, dynamic>?;
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 3,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.red.shade200, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 逾期天数标签
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.red.shade100,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.warning,
                        size: 16,
                        color: Colors.red.shade700,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '已逾期 $overdueDays 天',
                        style: TextStyle(
                          color: Colors.red.shade700,
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  '借阅编号: ${record['id']}',
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            
            const SizedBox(height: 12),
            
            // 图书信息
            Row(
              children: [
                Icon(Icons.book, color: Colors.blue[600], size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        bookInfo['title'] ?? '未知书名',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        '作者: ${bookInfo['author'] ?? '未知'}',
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.grey[600],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            
            const SizedBox(height: 8),
            
            // 学生信息
            if (studentInfo != null)
              Row(
                children: [
                  Icon(Icons.person, color: Colors.green[600], size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${studentInfo['full_name']} - ${studentInfo['class_name'] ?? '未分配班级'}',
                      style: const TextStyle(fontSize: 14),
                    ),
                  ),
                ],
              ),
            
            const SizedBox(height: 8),
            
            // 日期信息
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.grey[100],
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildDateInfo(
                    '借阅日期',
                    DateFormat('yyyy-MM-dd').format(DateTime.parse(record['borrow_date'])),
                  ),
                  Container(
                    width: 1,
                    height: 30,
                    color: Colors.grey[300],
                  ),
                  _buildDateInfo(
                    '应还日期',
                    DateFormat('yyyy-MM-dd').format(DateTime.parse(record['due_date'])),
                    isOverdue: true,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDateInfo(String label, String date, {bool isOverdue = false}) {
    return Column(
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey[600],
          ),
        ),
        const SizedBox(height: 4),
        Text(
          date,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: isOverdue ? Colors.red[600] : Colors.grey[800],
          ),
        ),
      ],
    );
  }
}
