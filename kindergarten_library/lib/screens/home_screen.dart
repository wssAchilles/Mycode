import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/book.dart';
import '../services/book_service.dart';
import 'add_edit_book_screen.dart';
import 'book_detail_screen.dart';
import 'student_list_screen.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../utils/page_transitions.dart';
import '../models/category.dart';
import '../services/category_service.dart';

/// 主页界面 - 图书列表页面
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final BookService _bookService = BookService();
  final CategoryService _categoryService = CategoryService();
  final supabase = Supabase.instance.client;
  String? _userName;
  String? _userEmail;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();
  
  // 分类筛选相关状态
  List<Category> _categories = [];
  int? _selectedCategoryId; // null表示显示全部
  bool _categoriesLoading = true;

  @override
  void initState() {
    super.initState();
    _loadUserInfo();
    _loadCategories();
    _bookService.ensureStorageBucketExists();
  }

  // 加载分类列表
  Future<void> _loadCategories() async {
    try {
      final categories = await _categoryService.getAllCategories();
      setState(() {
        _categories = categories;
        _categoriesLoading = false;
      });
    } catch (e) {
      setState(() => _categoriesLoading = false);
      print('加载分类失败: $e');
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// 加载用户信息
  Future<void> _loadUserInfo() async {
    final user = supabase.auth.currentUser;
    if (user != null) {
      setState(() {
        _userEmail = user.email;
      });
      
      try {
        final profile = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();
        
        if (mounted) {
          setState(() {
            _userName = profile['full_name'] ?? user.email?.split('@')[0];
          });
        }
      } catch (e) {
        setState(() {
          _userName = user.email?.split('@')[0];
        });
      }
    }
  }

  /// 处理登出逻辑
  Future<void> _handleLogout() async {
    try {
      await supabase.auth.signOut();
      // Navigator不需要手动导航，AuthGate会自动处理
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('登出失败: $e')),
        );
      }
    }
  }

  /// 删除图书
  Future<void> _deleteBook(Book book) async {
    // 显示确认对话框
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('确认删除'),
          content: Text('确定要删除《${book.title}》吗？\n此操作不可恢复。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('删除', style: TextStyle(color: Colors.red)),
            ),
          ],
        );
      },
    );

    if (confirmed == true) {
      try {
        await _bookService.deleteBook(book.id!);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('删除成功')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('删除失败: $e')),
          );
        }
      }
    }
  }

  /// 构建侧边栏
  Widget _buildDrawer() {
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          DrawerHeader(
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primaryContainer,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: Theme.of(context).colorScheme.primary,
                  child: Text(
                    _userName?.isNotEmpty == true ? _userName![0].toUpperCase() : 'U',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  _userName ?? '加载中...',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  _userEmail ?? '',
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.grey[700],
                  ),
                ),
              ],
            ),
          ),
          ListTile(
            leading: const Icon(Icons.book),
            title: const Text('图书管理'),
            selected: true,
            onTap: () {
              Navigator.pop(context);
            },
          ),
          ListTile(
            leading: const Icon(Icons.group),
            title: const Text('学生管理'),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => StudentListScreen(),
                ),
              );
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: const Text('退出登录', style: TextStyle(color: Colors.red)),
            onTap: () => _handleLogout(),
          ),
        ],
      ),
    );
  }

  /// 导航到图书详情页
  void _navigateToBookDetail(Book book) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => BookDetailScreen(book: book),
      ),
    );
  }

  /// 构建图书网格项
  Widget _buildBookGridItem(Book book) {
    return GestureDetector(
      onTap: () => _navigateToBookDetail(book),
      child: Card(
        elevation: 4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 图书封面 - 使用缓存图片组件
            Expanded(
              flex: 3,
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.grey[200],
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(12),
                  ),
                ),
                child: book.coverImageUrl != null
                    ? ClipRRect(
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(12),
                        ),
                        child: CachedNetworkImage(
                          imageUrl: book.coverImageUrl!,
                          fit: BoxFit.cover,
                          fadeInDuration: const Duration(milliseconds: 300),
                          placeholder: (context, url) => Container(
                            color: Colors.grey[200],
                            child: Center(
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                  Colors.blue.shade300,
                                ),
                              ),
                            ),
                          ),
                          errorWidget: (context, url, error) => Container(
                            color: Colors.grey[200],
                            child: const Icon(
                              Icons.book,
                              size: 50,
                              color: Colors.grey,
                            ),
                          ),
                        ),
                      )
                    : Center(
                        child: Icon(
                          Icons.book,
                          size: 50,
                          color: Colors.grey[400],
                        ),
                      ),
              ),
            ),
            // 图书信息
            Expanded(
              flex: 2,
              child: Padding(
                padding: const EdgeInsets.all(8.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // 书名
                    Text(
                      book.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    // 作者
                    if (book.author != null)
                      Text(
                        book.author!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey[600],
                        ),
                      ),
                    const Spacer(),
                    // 库存信息和状态
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // 库存信息
                        Text(
                          book.stockInfo,
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.grey[700],
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        // 状态标签
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: book.isAvailable
                                ? Colors.green[100]
                                : Colors.orange[100],
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            book.statusText,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: book.isAvailable
                                  ? Colors.green[800]
                                  : Colors.orange[800],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[100],
      drawer: _buildDrawer(),
      appBar: AppBar(
        title: const Text('图书管理'),
        actions: [
          IconButton(
            icon: const Icon(Icons.person),
            tooltip: _userName ?? '用户',
            onPressed: () {
              // 显示用户信息对话框
              showDialog(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('用户信息'),
                  content: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('姓名: ${_userName ?? "未设置"}'),
                      const SizedBox(height: 8),
                      Text('邮箱: ${_userEmail ?? "未知"}'),
                    ],
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('关闭'),
                    ),
                    TextButton(
                      onPressed: () async {
                        Navigator.pop(context);
                        await _handleLogout();
                      },
                      child: const Text('登出', style: TextStyle(color: Colors.red)),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // 搜索栏
          Container(
            padding: const EdgeInsets.all(16.0),
            color: Colors.grey[100],
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: '搜索书名、作者或位置...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          setState(() {
                            _searchController.clear();
                            _searchQuery = '';
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
                });
              },
            ),
          ),

          // 分类筛选栏
          if (!_categoriesLoading && _categories.isNotEmpty)
            Container(
              height: 60,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  // "全部"筛选芯片
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: const Text('全部'),
                      selected: _selectedCategoryId == null,
                      onSelected: (_) {
                        setState(() {
                          _selectedCategoryId = null;
                        });
                      },
                      backgroundColor: Colors.grey[200],
                      selectedColor: Colors.blue[100],
                      checkmarkColor: Colors.blue[700],
                    ),
                  ),
                  // 分类筛选芯片
                  ..._categories.map((category) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text(category.name),
                      selected: _selectedCategoryId == category.id,
                      onSelected: (_) {
                        setState(() {
                          _selectedCategoryId = category.id;
                        });
                      },
                      backgroundColor: Colors.grey[200],
                      selectedColor: Colors.blue[100],
                      checkmarkColor: Colors.blue[700],
                    ),
                  )),
                ],
              ),
            ),

          // 图书列表
          Expanded(
            child: StreamBuilder<List<Book>>(
              stream: _bookService.getBooksStream(),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(
                    child: Text('加载失败: ${snapshot.error}'),
                  );
                }

                if (!snapshot.hasData) {
                  return const Center(
                    child: CircularProgressIndicator(),
                  );
                }

                // 根据搜索条件和分类过滤图书
                List<Book> books = snapshot.data!;
                
                // 按分类筛选
                if (_selectedCategoryId != null) {
                  books = books.where((book) {
                    return book.categoryId == _selectedCategoryId;
                  }).toList();
                }
                
                // 按搜索关键词筛选
                if (_searchQuery.isNotEmpty) {
                  books = books.where((book) {
                    return book.title.toLowerCase().contains(_searchQuery.toLowerCase()) ||
                        (book.author?.toLowerCase() ?? '').contains(_searchQuery.toLowerCase()) ||
                        (book.location?.toLowerCase() ?? '').contains(_searchQuery.toLowerCase()) ||
                        (book.categoryName?.toLowerCase() ?? '').contains(_searchQuery.toLowerCase());
                  }).toList();
                }

                if (books.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.library_books,
                          size: 100,
                          color: Colors.grey[300],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _searchQuery.isEmpty ? '暂无图书' : '未找到匹配的图书',
                          style: TextStyle(
                            fontSize: 18,
                            color: Colors.grey[600],
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (_searchQuery.isEmpty)
                          const Text(
                            '点击右下角按钮添加第一本图书',
                            style: TextStyle(color: Colors.grey),
                          ),
                      ],
                    ),
                  );
                }

                return GridView.builder(
                  padding: const EdgeInsets.all(16),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    childAspectRatio: 0.75,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                  ),
                  itemCount: books.length,
                  itemBuilder: (context, index) {
                    final book = books[index];
                    return _buildBookGridItem(book);
                  },
                );
              },
            ),
          ),
        ],
      ),
      // 悬浮按钮 - 添加新书
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          Navigator.push(
            context,
            ScalePageRoute(
              page: const AddEditBookScreen(),
            ),
          );
        },
        tooltip: '添加新书',
        child: const Icon(Icons.add),
        heroTag: 'add_book_fab',
      ),
    );
  }

}
