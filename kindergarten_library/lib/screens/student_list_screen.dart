import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/student.dart';
import '../services/student_service.dart';
import 'add_edit_student_screen.dart';
import 'student_detail_screen.dart';
import '../utils/page_transitions.dart';

/// 学生列表管理页面
class StudentListScreen extends StatefulWidget {
  const StudentListScreen({super.key});

  @override
  State<StudentListScreen> createState() => _StudentListScreenState();
}

class _StudentListScreenState extends State<StudentListScreen> {
  final StudentService _studentService = StudentService();
  final supabase = Supabase.instance.client;
  
  List<Student> _allStudents = [];
  List<Student> _filteredStudents = [];
  String _searchQuery = '';
  String _selectedClass = '全部';
  List<String> _classes = ['全部'];
  bool _isLoading = true;

  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadStudents();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// 加载学生列表
  Future<void> _loadStudents() async {
    setState(() => _isLoading = true);
    
    try {
      final students = await _studentService.getAllStudents();
      final classes = await _studentService.getAllClasses();
      
      setState(() {
        _allStudents = students;
        _classes = ['全部', ...classes];
        _filterStudents();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('加载学生列表失败: $e')),
      );
    }
  }

  /// 过滤学生列表
  void _filterStudents() {
    _filteredStudents = _allStudents.where((student) {
      final matchesSearch = _searchQuery.isEmpty ||
          student.fullName.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          (student.className?.toLowerCase() ?? '').contains(_searchQuery.toLowerCase());
      
      final matchesClass = _selectedClass == '全部' ||
          student.className == _selectedClass;
      
      return matchesSearch && matchesClass;
    }).toList();
  }

  /// 删除学生
  Future<void> _deleteStudent(Student student) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认删除'),
        content: Text('确定要删除学生 "${student.fullName}" 吗？此操作无法撤销。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('删除', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await _studentService.deleteStudent(student.id!);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('学生删除成功')),
        );
        _loadStudents();
      } catch (e) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('删除失败: $e')),
        );
      }
    }
  }

  /// 导航到添加/编辑学生页面
  void _navigateToAddEdit([Student? student]) {
    Navigator.push(
      context,
      student == null 
        ? ScalePageRoute(page: AddEditStudentScreen(student: student))
        : SlidePageRoute(page: AddEditStudentScreen(student: student)),
    ).then((_) => _loadStudents());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('学生管理'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(120),
          child: Container(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                // 搜索框
                TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: '搜索学生姓名或班级...',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _searchQuery.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () {
                              setState(() {
                                _searchController.clear();
                                _searchQuery = '';
                                _filterStudents();
                              });
                            },
                          )
                        : null,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(30),
                      borderSide: BorderSide.none,
                    ),
                    filled: true,
                    fillColor: Colors.white,
                  ),
                  onChanged: (value) {
                    setState(() {
                      _searchQuery = value;
                      _filterStudents();
                    });
                  },
                ),
                const SizedBox(height: 12),
                
                // 班级筛选
                Row(
                  children: [
                    const Icon(Icons.filter_list, size: 20),
                    const SizedBox(width: 8),
                    const Text('班级:', style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: _classes.map((className) {
                            final isSelected = _selectedClass == className;
                            return Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: FilterChip(
                                label: Text(className),
                                selected: isSelected,
                                onSelected: (selected) {
                                  setState(() {
                                    _selectedClass = className;
                                    _filterStudents();
                                  });
                                },
                                backgroundColor: Colors.grey[200],
                                selectedColor: Theme.of(context).primaryColor.withOpacity(0.2),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadStudents,
              child: _buildStudentList(),
            ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _navigateToAddEdit(),
        tooltip: '添加学生',
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildStudentList() {
    if (_filteredStudents.isEmpty) {
      return _buildEmptyState();
    }

    return _buildStudentGroupList(_getGroupedStudents());
  }

  /// 获取学生分组数据
  Map<String, List<Student>> _getGroupedStudents() {
    final Map<String, List<Student>> groupedStudents = {};
    for (var student in _filteredStudents) {
      final className = student.className ?? '未分配班级';
      groupedStudents.putIfAbsent(className, () => []).add(student);
    }
    return groupedStudents;
  }

  /// 构建空状态显示
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.group_outlined,
            size: 100,
            color: Colors.grey[300],
          ),
          const SizedBox(height: 20),
          Text(
            _searchQuery.isNotEmpty ? '没有找到匹配的学生' : '暂无学生信息',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: Colors.grey[700],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _searchQuery.isNotEmpty 
                ? '请尝试其他搜索关键词' 
                : '添加学生后即可开始借阅管理',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[500],
            ),
          ),
          const SizedBox(height: 20),
          if (_searchQuery.isEmpty)
            ElevatedButton.icon(
              onPressed: () => _navigateToAddEdit(),
              icon: const Icon(Icons.person_add),
              label: const Text('添加第一个学生'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
              ),
            ),
        ],
      ),
    );
  }

  /// 构建学生分组列表
  Widget _buildStudentGroupList(Map<String, List<Student>> groupedStudents) {
    final sortedClasses = groupedStudents.keys.toList()..sort();
    
    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 80),
      itemCount: sortedClasses.length,
      itemBuilder: (context, index) {
        final className = sortedClasses[index];
        final classStudents = groupedStudents[className]!;
        
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 班级标题
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Icon(
                    Icons.class_,
                    color: Theme.of(context).colorScheme.primary,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    className,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${classStudents.length} 人',
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.grey[600],
                    ),
                  ),
                ],
              ),
            ),
            // 学生列表
            ...classStudents.map((student) => ListTile(
              leading: CircleAvatar(
                backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                child: Text(
                  student.fullName.isNotEmpty ? student.fullName[0] : '?',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              title: Text(student.fullName),
              subtitle: student.className != null
                  ? Row(
                      children: [
                        Icon(Icons.school, size: 14, color: Colors.grey[600]),
                        const SizedBox(width: 4),
                        Text(student.className!),
                      ],
                    )
                  : null,
              trailing: PopupMenuButton(
                itemBuilder: (context) => [
                  const PopupMenuItem(
                    value: 'edit',
                    child: Row(
                      children: [
                        Icon(Icons.edit, size: 20),
                        SizedBox(width: 8),
                        Text('编辑'),
                      ],
                    ),
                  ),
                  const PopupMenuItem(
                    value: 'delete',
                    child: Row(
                      children: [
                        Icon(Icons.delete, size: 20, color: Colors.red),
                        SizedBox(width: 8),
                        Text('删除', style: TextStyle(color: Colors.red)),
                      ],
                    ),
                  ),
                ],
                onSelected: (value) {
                  if (value == 'edit') {
                    _navigateToAddEdit(student);
                  } else if (value == 'delete') {
                    _deleteStudent(student);
                  }
                },
              ),
              onTap: () {
                Navigator.push(
                  context,
                  SlidePageRoute(
                    page: StudentDetailScreen(student: student),
                  ),
                ).then((_) => _loadStudents());
              },
            )).toList(),
          ],
        );
      },
    );
  }
}
