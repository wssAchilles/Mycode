import 'package:flutter/material.dart';
import '../models/category.dart';
import '../services/category_service.dart';

class CategoryManagementScreen extends StatefulWidget {
  const CategoryManagementScreen({super.key});

  @override
  State<CategoryManagementScreen> createState() => _CategoryManagementScreenState();
}

class _CategoryManagementScreenState extends State<CategoryManagementScreen> {
  final CategoryService _categoryService = CategoryService();
  List<Category> _categories = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final categories = await _categoryService.getAllCategories();
      setState(() {
        _categories = categories;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      _showErrorSnackBar('加载分类失败: $e');
    }
  }

  // 添加新分类对话框
  Future<void> _showAddCategoryDialog() async {
    final TextEditingController controller = TextEditingController();
    
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('添加新分类'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: '分类名称',
            hintText: '请输入分类名称',
            border: OutlineInputBorder(),
          ),
          maxLength: 50,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('添加'),
          ),
        ],
      ),
    );

    if (result != null && result.isNotEmpty) {
      await _addCategory(result);
    }
  }

  // 添加分类
  Future<void> _addCategory(String name) async {
    try {
      // 检查分类名称是否已存在
      final exists = await _categoryService.isCategoryNameExists(name);
      if (exists) {
        _showErrorSnackBar('分类名称已存在');
        return;
      }

      await _categoryService.addCategory(name);
      await _loadCategories();
      _showSuccessSnackBar('分类添加成功');
    } catch (e) {
      _showErrorSnackBar('添加分类失败: $e');
    }
  }

  // 编辑分类对话框
  Future<void> _showEditCategoryDialog(Category category) async {
    final TextEditingController controller = TextEditingController(text: category.name);
    
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('编辑分类'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: '分类名称',
            border: OutlineInputBorder(),
          ),
          maxLength: 50,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('保存'),
          ),
        ],
      ),
    );

    if (result != null && result.isNotEmpty && result != category.name) {
      await _updateCategory(category, result);
    }
  }

  // 更新分类
  Future<void> _updateCategory(Category category, String newName) async {
    try {
      // 检查分类名称是否已存在（排除当前分类）
      final exists = await _categoryService.isCategoryNameExists(newName, excludeId: category.id);
      if (exists) {
        _showErrorSnackBar('分类名称已存在');
        return;
      }

      final updatedCategory = category.copyWith(name: newName);
      await _categoryService.updateCategory(updatedCategory);
      await _loadCategories();
      _showSuccessSnackBar('分类更新成功');
    } catch (e) {
      _showErrorSnackBar('更新分类失败: $e');
    }
  }

  // 删除分类确认对话框
  Future<void> _showDeleteCategoryDialog(Category category) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除分类'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('确定要删除分类"${category.name}"吗？'),
            const SizedBox(height: 8),
            const Text(
              '注意：如果有图书属于此分类，删除操作将失败。',
              style: TextStyle(
                color: Colors.orange,
                fontSize: 12,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('删除'),
          ),
        ],
      ),
    );

    if (result == true) {
      await _deleteCategory(category);
    }
  }

  // 删除分类
  Future<void> _deleteCategory(Category category) async {
    try {
      await _categoryService.deleteCategory(category.id);
      await _loadCategories();
      _showSuccessSnackBar('分类删除成功');
    } catch (e) {
      if (e.toString().contains('还有') && e.toString().contains('本图书')) {
        // 如果有关联图书，提供强制删除选项
        _showForceDeleteDialog(category, e.toString());
      } else {
        _showErrorSnackBar('删除分类失败: $e');
      }
    }
  }

  // 强制删除对话框
  Future<void> _showForceDeleteDialog(Category category, String errorMessage) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('强制删除分类'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(errorMessage),
            const SizedBox(height: 16),
            const Text(
              '是否强制删除此分类？\n强制删除后，属于此分类的图书将变为"未分类"状态。',
              style: TextStyle(color: Colors.red),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('强制删除'),
          ),
        ],
      ),
    );

    if (result == true) {
      try {
        await _categoryService.forceDeleteCategory(category.id);
        await _loadCategories();
        _showSuccessSnackBar('分类强制删除成功');
      } catch (e) {
        _showErrorSnackBar('强制删除分类失败: $e');
      }
    }
  }

  void _showSuccessSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _showErrorSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('分类管理'),
        backgroundColor: Colors.blue,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _categories.isEmpty
              ? _buildEmptyState()
              : _buildCategoryList(),
      floatingActionButton: FloatingActionButton(
        onPressed: _showAddCategoryDialog,
        backgroundColor: Colors.blue,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  // 空状态界面
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.category_outlined,
            size: 80,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 16),
          Text(
            '暂无分类',
            style: TextStyle(
              fontSize: 18,
              color: Colors.grey[600],
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '点击右下角的 + 按钮添加第一个分类',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[500],
            ),
          ),
        ],
      ),
    );
  }

  // 分类列表
  Widget _buildCategoryList() {
    return RefreshIndicator(
      onRefresh: _loadCategories,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _categories.length,
        itemBuilder: (context, index) {
          final category = _categories[index];
          return _buildCategoryCard(category);
        },
      ),
    );
  }

  // 分类卡片
  Widget _buildCategoryCard(Category category) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 2,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          backgroundColor: Colors.blue.shade100,
          child: Icon(
            Icons.category,
            color: Colors.blue.shade700,
          ),
        ),
        title: Text(
          category.name,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 16,
          ),
        ),
        subtitle: Text(
          '创建时间: ${_formatDateTime(category.createdAt)}',
          style: TextStyle(
            color: Colors.grey[600],
            fontSize: 12,
          ),
        ),
        trailing: PopupMenuButton<String>(
          onSelected: (value) {
            switch (value) {
              case 'edit':
                _showEditCategoryDialog(category);
                break;
              case 'delete':
                _showDeleteCategoryDialog(category);
                break;
            }
          },
          itemBuilder: (context) => [
            const PopupMenuItem(
              value: 'edit',
              child: ListTile(
                leading: Icon(Icons.edit),
                title: Text('编辑'),
                contentPadding: EdgeInsets.zero,
              ),
            ),
            const PopupMenuItem(
              value: 'delete',
              child: ListTile(
                leading: Icon(Icons.delete, color: Colors.red),
                title: Text('删除', style: TextStyle(color: Colors.red)),
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ],
        ),
        onTap: () => _showEditCategoryDialog(category),
      ),
    );
  }

  // 格式化日期时间
  String _formatDateTime(DateTime dateTime) {
    return '${dateTime.year}-${dateTime.month.toString().padLeft(2, '0')}-${dateTime.day.toString().padLeft(2, '0')}';
  }
}
