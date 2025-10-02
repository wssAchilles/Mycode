import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../models/book.dart';
import '../services/book_service.dart';
import '../models/category.dart';
import '../services/category_service.dart';

/// 添加/编辑图书页面
class AddEditBookScreen extends StatefulWidget {
  final Book? book; // 如果是编辑模式，传入要编辑的图书

  const AddEditBookScreen({super.key, this.book});

  @override
  State<AddEditBookScreen> createState() => _AddEditBookScreenState();
}

class _AddEditBookScreenState extends State<AddEditBookScreen> {
  final _formKey = GlobalKey<FormState>();
  final _bookService = BookService();
  final _categoryService = CategoryService();
  final _titleController = TextEditingController();
  final _authorController = TextEditingController();
  final _locationController = TextEditingController();
  final _quantityController = TextEditingController(text: '1'); // 数量控制器，默认为1
  final _totalQuantityController = TextEditingController(); // 总库存控制器
  final _availableQuantityController = TextEditingController(); // 在馆数量控制器
  
  bool _isLoading = false;
  File? _selectedImage; // 新选择的图片文件
  String? _existingImageUrl; // 已存在的图片URL（编辑模式）
  final ImagePicker _picker = ImagePicker();
  
  // 分类相关状态
  List<Category> _categories = [];
  Category? _selectedCategory;
  bool _categoriesLoading = true;

  @override
  void initState() {
    super.initState();
    _loadCategories();
    // 如果是编辑模式，填充现有数据
    if (widget.book != null) {
      _titleController.text = widget.book!.title;
      _authorController.text = widget.book!.author ?? '';
      _locationController.text = widget.book!.location ?? '';
      _totalQuantityController.text = widget.book!.totalQuantity.toString();
      _availableQuantityController.text = widget.book!.availableQuantity.toString();
      _existingImageUrl = widget.book!.coverImageUrl;
    }
  }

  // 加载分类列表
  Future<void> _loadCategories() async {
    try {
      final categories = await _categoryService.getAllCategories();
      setState(() {
        _categories = categories;
        _categoriesLoading = false;
        
        // 如果是编辑模式且图书有分类，找到对应的分类对象
        if (widget.book?.categoryId != null) {
          _selectedCategory = categories.firstWhere(
            (category) => category.id == widget.book!.categoryId,
            orElse: () => categories.first,
          );
        }
      });
    } catch (e) {
      setState(() => _categoriesLoading = false);
      print('加载分类失败: $e');
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _authorController.dispose();
    _locationController.dispose();
    _quantityController.dispose();
    _totalQuantityController.dispose();
    _availableQuantityController.dispose();
    super.dispose();
  }

  /// 选择图片
  Future<void> _pickImage(ImageSource source) async {
    try {
      final XFile? pickedFile = await _picker.pickImage(
        source: source,
        maxWidth: 800, // 限制图片宽度，减少存储空间
        maxHeight: 1200,
        imageQuality: 85, // 压缩质量
      );

      if (pickedFile != null) {
        setState(() {
          _selectedImage = File(pickedFile.path);
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('选择图片失败: $e')),
        );
      }
    }
  }

  /// 显示图片选择对话框
  void _showImagePickerDialog() {
    showModalBottomSheet(
      context: context,
      builder: (BuildContext context) {
        return SafeArea(
          child: Wrap(
            children: [
              ListTile(
                leading: const Icon(Icons.photo_library),
                title: const Text('从相册选择'),
                onTap: () {
                  Navigator.pop(context);
                  _pickImage(ImageSource.gallery);
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_camera),
                title: const Text('拍摄照片'),
                onTap: () {
                  Navigator.pop(context);
                  _pickImage(ImageSource.camera);
                },
              ),
              if (_selectedImage != null || _existingImageUrl != null)
                ListTile(
                  leading: const Icon(Icons.delete, color: Colors.red),
                  title: const Text('删除图片', style: TextStyle(color: Colors.red)),
                  onTap: () {
                    Navigator.pop(context);
                    setState(() {
                      _selectedImage = null;
                      _existingImageUrl = null;
                    });
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  /// 显示删除确认对话框
  void _showDeleteConfirmDialog() {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('确认删除'),
          content: Text('您确定要永久删除《${widget.book!.title}》吗？此操作将无法恢复。'),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(context).pop(); // 关闭对话框
              },
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () {
                Navigator.of(context).pop(); // 关闭对话框
                _deleteBook(); // 执行删除
              },
              style: TextButton.styleFrom(
                foregroundColor: Colors.red,
              ),
              child: const Text('确认删除'),
            ),
          ],
        );
      },
    );
  }

  /// 删除图书
  Future<void> _deleteBook() async {
    setState(() {
      _isLoading = true;
    });

    try {
      await _bookService.deleteBook(widget.book!.id!);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('《${widget.book!.title}》已删除'),
            backgroundColor: Colors.green,
          ),
        );
        
        // 返回到图书列表页
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('删除失败: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  /// 保存图书
  Future<void> _saveBook() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
    });

    try {
      String? coverImageUrl = _existingImageUrl;

      // 如果选择了新图片，先上传
      if (_selectedImage != null) {
        coverImageUrl = await _bookService.uploadBookCover(
          _selectedImage!,
          oldImageUrl: _existingImageUrl, // 如果有旧图片，会被删除
        );
      }

      // 创建或更新图书对象
      final book = Book(
        id: widget.book?.id,
        title: _titleController.text.trim(),
        author: _authorController.text.trim(),
        location: _locationController.text.trim(),
        coverImageUrl: coverImageUrl,
        categoryId: _selectedCategory?.id, // 添加分类ID
        categoryName: _selectedCategory?.name, // 添加分类名称
        totalQuantity: widget.book != null 
            ? int.tryParse(_totalQuantityController.text) ?? widget.book!.totalQuantity
            : int.tryParse(_quantityController.text) ?? 1,
        availableQuantity: widget.book != null 
            ? int.tryParse(_availableQuantityController.text) ?? widget.book!.availableQuantity
            : int.tryParse(_quantityController.text) ?? 1,
      );

      // 根据是新增还是编辑调用不同的方法
      if (widget.book == null) {
        // 新增时使用输入的数量
        final quantity = int.tryParse(_quantityController.text) ?? 1;
        await _bookService.addBook(book, quantity: quantity);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('成功添加 $quantity 本《${book.title}》')),
          );
        }
      } else {
        await _bookService.updateBook(book);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('更新成功')),
          );
        }
      }

      // 返回列表页
      if (mounted) {
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('保存失败: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEditMode = widget.book != null;

    return Scaffold(
      appBar: AppBar(
        title: Text(isEditMode ? '编辑图书' : '添加新书'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 图书封面
              GestureDetector(
                onTap: _showImagePickerDialog,
                child: Container(
                  height: 200,
                  decoration: BoxDecoration(
                    color: Colors.grey[200],
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: Colors.grey[400]!,
                      width: 1,
                    ),
                  ),
                  child: _buildImagePreview(),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '点击选择或拍摄图书封面',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey[600],
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),

              // 书名输入框
              TextFormField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: '书名 *',
                  hintText: '请输入图书名称',
                  prefixIcon: Icon(Icons.book),
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return '书名不能为空';
                  }
                  return null;
                },
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),

              // 作者输入框
              TextFormField(
                controller: _authorController,
                decoration: const InputDecoration(
                  labelText: '作者 *',
                  hintText: '请输入作者姓名',
                  prefixIcon: Icon(Icons.person),
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return '作者不能为空';
                  }
                  return null;
                },
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),

              // 存放位置输入框
              TextFormField(
                controller: _locationController,
                decoration: const InputDecoration(
                  labelText: '存放位置 *',
                  hintText: '例如：A架3层',
                  prefixIcon: Icon(Icons.location_on),
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return '存放位置不能为空';
                  }
                  return null;
                },
                textInputAction: isEditMode ? TextInputAction.done : TextInputAction.next,
                onFieldSubmitted: isEditMode ? (_) => _saveBook() : null,
              ),
              const SizedBox(height: 16),

              // 数量输入框（仅在添加模式显示）
              if (!isEditMode) ...[  
                TextFormField(
                  controller: _quantityController,
                  decoration: const InputDecoration(
                    labelText: '采购数量 *',
                    hintText: '请输入图书数量',
                    prefixIcon: Icon(Icons.inventory_2),
                    border: OutlineInputBorder(),
                    helperText: '请输入本次采购的图书数量',
                  ),
                  keyboardType: TextInputType.number,
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return '数量不能为空';
                    }
                    final quantity = int.tryParse(value.trim());
                    if (quantity == null || quantity < 1) {
                      return '请输入有效的数量（至少1本）';
                    }
                    if (quantity > 999) {
                      return '数量不能超过999';
                    }
                    return null;
                  },
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _saveBook(),
                ),
                const SizedBox(height: 8),
                // 数量提示信息
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.amber[50],
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.amber[200]!),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.tips_and_updates, size: 16, color: Colors.amber[700]),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '如果您采购了多本相同的图书，请在此输入总数量',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.amber[900],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // 分类选择下拉框
              DropdownButtonFormField<Category>(
                value: _selectedCategory,
                decoration: const InputDecoration(
                  labelText: '图书分类',
                  hintText: '请选择图书分类',
                  prefixIcon: Icon(Icons.category),
                  border: OutlineInputBorder(),
                  helperText: '为图书选择合适的分类',
                ),
                items: _categoriesLoading 
                    ? [] 
                    : [
                        // 添加"无分类"选项
                        const DropdownMenuItem<Category>(
                          value: null,
                          child: Text('无分类'),
                        ),
                        // 添加所有分类选项
                        ..._categories.map((category) => DropdownMenuItem<Category>(
                          value: category,
                          child: Text(category.name),
                        )),
                      ],
                onChanged: _categoriesLoading 
                    ? null 
                    : (Category? category) {
                        setState(() {
                          _selectedCategory = category;
                        });
                      },
                validator: (value) {
                  // 分类为可选项，不做必填验证
                  return null;
                },
              ),
              const SizedBox(height: 16),

              // 编辑模式下的库存管理输入框
              if (isEditMode && widget.book != null) ...[  
                Card(
                  color: Colors.amber[50],
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '库存管理',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: Colors.amber[900],
                          ),
                        ),
                        const SizedBox(height: 16),
                        // 总库存输入框
                        TextFormField(
                          controller: _totalQuantityController,
                          decoration: InputDecoration(
                            labelText: '总库存 *',
                            hintText: '请输入图书总数量',
                            prefixIcon: const Icon(Icons.inventory_2),
                            border: const OutlineInputBorder(),
                            helperText: '图书馆中该书目的总数量（包含已借出和在馆的）',
                          ),
                          keyboardType: TextInputType.number,
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return '总库存不能为空';
                            }
                            final totalQuantity = int.tryParse(value.trim());
                            if (totalQuantity == null || totalQuantity < 1) {
                              return '请输入有效的总数量（至少1本）';
                            }
                            if (totalQuantity > 9999) {
                              return '总数量不能超过9999';
                            }
                            final availableQuantity = int.tryParse(_availableQuantityController.text.trim()) ?? 0;
                            if (totalQuantity < availableQuantity) {
                              return '总库存不能小于在馆数量';
                            }
                            return null;
                          },
                          textInputAction: TextInputAction.next,
                        ),
                        const SizedBox(height: 16),
                        // 在馆数量输入框
                        TextFormField(
                          controller: _availableQuantityController,
                          decoration: InputDecoration(
                            labelText: '在馆数量 *',
                            hintText: '请输入当前在馆可借数量',
                            prefixIcon: const Icon(Icons.check_circle),
                            border: const OutlineInputBorder(),
                            helperText: '当前在馆可供借阅的数量，用于纠正库存差错',
                          ),
                          keyboardType: TextInputType.number,
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return '在馆数量不能为空';
                            }
                            final availableQuantity = int.tryParse(value.trim());
                            if (availableQuantity == null || availableQuantity < 0) {
                              return '请输入有效的在馆数量（不能为负数）';
                            }
                            final totalQuantity = int.tryParse(_totalQuantityController.text.trim()) ?? 0;
                            if (availableQuantity > totalQuantity) {
                              return '在馆数量不能大于总库存';
                            }
                            return null;
                          },
                          textInputAction: TextInputAction.done,
                          onFieldSubmitted: (_) => _saveBook(),
                        ),
                        const SizedBox(height: 12),
                        // 库存状态显示
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.blue[50],
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.blue[200]!),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.info, size: 16, color: Colors.blue[700]),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  '已借出数量 = 总库存 - 在馆数量',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Colors.blue[700],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              
              const SizedBox(height: 16),

              // 删除图书按钮（仅编辑模式显示）
              if (isEditMode) ...[
                OutlinedButton(
                  onPressed: _isLoading ? null : _showDeleteConfirmDialog,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    side: const BorderSide(color: Colors.red),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: const Text(
                    '删除图书',
                    style: TextStyle(
                      fontSize: 16,
                      color: Colors.red,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],

              // 保存按钮
              ElevatedButton(
                onPressed: _isLoading ? null : _saveBook,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: _isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        isEditMode ? '保存修改' : '添加图书',
                        style: const TextStyle(fontSize: 16),
                      ),
              ),

              // 提示信息
              const SizedBox(height: 16),
              Card(
                color: Colors.blue[50],
                child: Padding(
                  padding: const EdgeInsets.all(12.0),
                  child: Row(
                    children: [
                      Icon(Icons.info_outline, size: 20, color: Colors.blue[700]),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          isEditMode
                              ? '修改后的信息将立即同步到所有设备'
                              : '新添加的图书将立即在图书列表中显示',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.blue[700],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 构建图片预览组件
  Widget _buildImagePreview() {
    // 如果有新选择的图片
    if (_selectedImage != null) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(11),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.file(
              _selectedImage!,
              fit: BoxFit.cover,
            ),
            Positioned(
              top: 8,
              right: 8,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Icon(
                  Icons.edit,
                  color: Colors.white,
                  size: 20,
                ),
              ),
            ),
          ],
        ),
      );
    }
    
    // 如果有已存在的图片URL
    if (_existingImageUrl != null && _existingImageUrl!.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(11),
        child: Stack(
          fit: StackFit.expand,
          children: [
            CachedNetworkImage(
              imageUrl: _existingImageUrl!,
              fit: BoxFit.cover,
              placeholder: (context, url) => const Center(
                child: CircularProgressIndicator(),
              ),
              errorWidget: (context, url, error) => _buildPlaceholder(),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Icon(
                  Icons.edit,
                  color: Colors.white,
                  size: 20,
                ),
              ),
            ),
          ],
        ),
      );
    }
    
    // 默认占位符
    return _buildPlaceholder();
  }

  /// 构建默认占位符
  Widget _buildPlaceholder() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          Icons.add_photo_alternate,
          size: 60,
          color: Colors.grey[400],
        ),
        const SizedBox(height: 8),
        Text(
          '添加封面图片',
          style: TextStyle(
            color: Colors.grey[600],
            fontSize: 14,
          ),
        ),
      ],
    );
  }
}
