import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/borrow_service.dart';
import '../models/book.dart';
import '../models/borrow_record.dart';
import 'category_management_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({Key? key}) : super(key: key);

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> with SingleTickerProviderStateMixin {
  final _supabase = Supabase.instance.client;
  final BorrowService _borrowService = BorrowService();
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  
  String? _userId;
  String? _userEmail;
  String? _userName;
  List<BorrowRecord> _myBorrows = [];
  int _myBorrowedTotalCount = 0; // 个人借阅总册数
  bool _isLoading = true;
  
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _currentPasswordController = TextEditingController();
  final TextEditingController _newPasswordController = TextEditingController();
  final TextEditingController _confirmPasswordController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );
    _fadeAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeIn,
    );
    _loadUserData();
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    _nameController.dispose();
    _currentPasswordController.dispose();
    _newPasswordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _loadUserData() async {
    setState(() => _isLoading = true);
    
    try {
      final user = _supabase.auth.currentUser;
      if (user != null) {
        _userId = user.id;
        _userEmail = user.email;
        
        // 加载用户名
        final profile = await _supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();
        
        setState(() {
          _userName = profile['full_name'];
          _nameController.text = _userName ?? '';
        });
        
        // 加载我的借阅记录
        await _loadMyBorrows();
        // 加载个人借阅总册数
        await _loadMyBorrowedCount();
      }
    } catch (e) {
      print('加载用户数据失败: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadMyBorrows() async {
    try {
      final response = await _supabase
          .from('borrow_records')
          .select('''
            *,
            books!borrow_records_book_id_fkey(title, author, cover_image_url, location)
          ''')
          .eq('profile_id', _userId!)
          .isFilter('return_date', null)
          .order('borrow_date', ascending: false);
      
      setState(() {
        _myBorrows = response
            .map((json) => BorrowRecord.fromJson(json as Map<String, dynamic>))
            .toList();
      });
    } catch (e) {
      print('加载借阅记录失败: $e');
    }
  }

  // 加载个人借阅总册数（使用RPC函数）
  Future<void> _loadMyBorrowedCount() async {
    try {
      final count = await _supabase.rpc('get_my_currently_borrowed_count', params: {
        'user_id': _userId!,
      });
      setState(() {
        _myBorrowedTotalCount = count as int? ?? 0;
      });
    } catch (e) {
      print('加载个人借阅总册数失败: $e');
      setState(() {
        _myBorrowedTotalCount = 0;
      });
    }
  }

  Future<void> _updateUserName() async {
    if (_nameController.text.trim().isEmpty) {
      _showSnackBar('姓名不能为空');
      return;
    }

    try {
      await _supabase
          .from('profiles')
          .update({
            'full_name': _nameController.text.trim(),
            'updated_at': DateTime.now().toIso8601String(),
          })
          .eq('id', _userId!);
      
      setState(() {
        _userName = _nameController.text.trim();
      });
      
      _showSnackBar('姓名更新成功', isError: false);
    } catch (e) {
      _showSnackBar('更新失败: $e');
    }
  }

  Future<void> _changePassword() async {
    if (_newPasswordController.text.length < 6) {
      _showSnackBar('新密码至少需要6个字符');
      return;
    }
    
    if (_newPasswordController.text != _confirmPasswordController.text) {
      _showSnackBar('两次输入的密码不一致');
      return;
    }

    try {
      await _supabase.auth.updateUser(
        UserAttributes(
          password: _newPasswordController.text,
        ),
      );
      
      _currentPasswordController.clear();
      _newPasswordController.clear();
      _confirmPasswordController.clear();
      
      _showSnackBar('密码修改成功', isError: false);
      Navigator.pop(context);
    } catch (e) {
      _showSnackBar('密码修改失败: $e');
    }
  }

  Future<void> _returnBook(int recordId) async {
    try {
      await _borrowService.returnBook(recordId);
      await _loadMyBorrows();
      await _loadMyBorrowedCount(); // 重新加载总册数
      _showSnackBar('还书成功', isError: false);
    } catch (e) {
      _showSnackBar('还书失败: $e');
    }
  }

  void _showSnackBar(String message, {bool isError = true}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red : Colors.green,
      ),
    );
  }

  Future<void> _handleLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('确认退出'),
          content: const Text('您确定要退出登录吗？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('确认', style: TextStyle(color: Colors.red)),
            ),
          ],
        );
      },
    );

    if (confirmed == true) {
      try {
        await _supabase.auth.signOut();
      } catch (e) {
        _showSnackBar('退出失败: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: const Text('个人中心'),
        centerTitle: true,
        backgroundColor: Colors.blue.shade600,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: _handleLogout,
            tooltip: '退出登录',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : FadeTransition(
              opacity: _fadeAnimation,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    // 用户头像和基本信息卡片
                    _buildProfileCard(),
                    const SizedBox(height: 20),
                    
                    // 账户信息卡片
                    _buildAccountInfoCard(),
                    const SizedBox(height: 20),
                    
                    // 我的借阅卡片
                    _buildMyBorrowsCard(),
                    const SizedBox(height: 20),
                    
                    // 安全设置卡片
                    _buildSecurityCard(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildProfileCard() {
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
              radius: 50,
              backgroundColor: Colors.white,
              child: Text(
                _userName?.isNotEmpty == true 
                    ? _userName![0].toUpperCase() 
                    : _userEmail?[0].toUpperCase() ?? 'U',
                style: TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.bold,
                  color: Colors.blue.shade600,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              _userName ?? '未设置姓名',
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _userEmail ?? '',
              style: TextStyle(
                fontSize: 16,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAccountInfoCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.person, color: Colors.blue.shade600),
                const SizedBox(width: 8),
                const Text(
                  '账户信息',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('姓名'),
              subtitle: Text(_userName ?? '未设置'),
              trailing: IconButton(
                icon: const Icon(Icons.edit, size: 20),
                onPressed: () {
                  _showEditNameDialog();
                },
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('邮箱'),
              subtitle: Text(_userEmail ?? ''),
              trailing: const Icon(Icons.email, size: 20, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMyBorrowsCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.book, color: Colors.orange.shade600),
                const SizedBox(width: 8),
                const Text(
                  '我的借阅',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.orange.shade100,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '$_myBorrowedTotalCount 本',
                    style: TextStyle(
                      color: Colors.orange.shade700,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            if (_myBorrows.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: Column(
                    children: [
                      Icon(
                        Icons.book_outlined,
                        size: 48,
                        color: Colors.grey[300],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '您当前没有借阅的图书',
                        style: TextStyle(
                          color: Colors.grey[500],
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              ...List.generate(
                _myBorrows.length > 3 ? 3 : _myBorrows.length,
                (index) => _buildBorrowItem(_myBorrows[index]),
              ),
            if (_myBorrows.length > 3)
              Center(
                child: TextButton(
                  onPressed: () {
                    _showAllBorrowsDialog();
                  },
                  child: Text('查看全部 ${_myBorrows.length} 本'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildBorrowItem(BorrowRecord record) {
    // 使用模型中的业务逻辑，避免空指针异常
    final isOverdue = record.isOverdue;
    final daysLeft = record.daysRemaining ?? 0;
    
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isOverdue ? Colors.red.shade200 : Colors.grey.shade200,
        ),
      ),
      child: Row(
        children: [
          // 图书封面
          Container(
            width: 50,
            height: 70,
            decoration: BoxDecoration(
              color: Colors.grey[200],
              borderRadius: BorderRadius.circular(4),
            ),
            child: record.bookCoverImageUrl != null
                ? ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Image.network(
                      record.bookCoverImageUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) {
                        return const Icon(Icons.book, color: Colors.grey);
                      },
                    ),
                  )
                : const Icon(Icons.book, color: Colors.grey),
          ),
          const SizedBox(width: 12),
          
          // 图书信息
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  record.bookTitle ?? '未知书名',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Text(
                  '作者: ${record.bookAuthor ?? '未知'}',
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '借阅数量: ${record.quantity} 本',
                  style: TextStyle(
                    color: Colors.blue[600],
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(
                      isOverdue ? Icons.warning : Icons.schedule,
                      size: 14,
                      color: isOverdue ? Colors.red : Colors.orange,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      isOverdue 
                          ? '已逾期 ${-daysLeft} 天'
                          : daysLeft > 0 
                              ? '剩余 $daysLeft 天'
                              : '今日到期',
                      style: TextStyle(
                        fontSize: 12,
                        color: isOverdue ? Colors.red : Colors.orange,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          
          // 还书按钮
          ElevatedButton(
            onPressed: () => _confirmReturn(record.id),
            style: ElevatedButton.styleFrom(
              backgroundColor: isOverdue ? Colors.red : Colors.green,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            ),
            child: const Text('还书', style: TextStyle(fontSize: 14)),
          ),
        ],
      ),
    );
  }

  void _confirmReturn(int recordId) {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('确认还书'),
          content: const Text('您确定要归还这本书吗？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.of(context).pop();
                _returnBook(recordId);
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              child: const Text('确认'),
            ),
          ],
        );
      },
    );
  }

  Widget _buildSecurityCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.security, color: Colors.green.shade600),
                const SizedBox(width: 8),
                const Text(
                  '安全设置',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.category),
              title: const Text('分类管理'),
              subtitle: const Text('管理图书分类，添加、编辑或删除分类'),
              trailing: const Icon(Icons.arrow_forward_ios, size: 16),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => const CategoryManagementScreen(),
                  ),
                );
              },
            ),
            const Divider(height: 16),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.lock),
              title: const Text('修改密码'),
              subtitle: const Text('定期更改密码以保护账户安全'),
              trailing: const Icon(Icons.arrow_forward_ios, size: 16),
              onTap: () {
                _showChangePasswordDialog();
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showEditNameDialog() {
    _nameController.text = _userName ?? '';
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('修改姓名'),
          content: TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              labelText: '姓名',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.person),
            ),
            autofocus: true,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.of(context).pop();
                _updateUserName();
              },
              child: const Text('保存'),
            ),
          ],
        );
      },
    );
  }

  void _showChangePasswordDialog() {
    _currentPasswordController.clear();
    _newPasswordController.clear();
    _confirmPasswordController.clear();
    
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('修改密码'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: _newPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '新密码',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.lock),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _confirmPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '确认新密码',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.lock_outline),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: _changePassword,
              child: const Text('确认修改'),
            ),
          ],
        );
      },
    );
  }

  void _showAllBorrowsDialog() {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return Dialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          child: Container(
            width: MediaQuery.of(context).size.width * 0.9,
            height: MediaQuery.of(context).size.height * 0.7,
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      '我的全部借阅',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
                const Divider(),
                Expanded(
                  child: ListView.builder(
                    itemCount: _myBorrows.length,
                    itemBuilder: (context, index) {
                      return _buildBorrowItem(_myBorrows[index]);
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
