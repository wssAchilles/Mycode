import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:path/path.dart' as path;
import 'dart:typed_data'; // Added for Uint8List

import '../../models/emoji_model.dart';
import '../../services/emoji_service.dart';
import '../../config/filebase_config.dart';

/// 表情包管理页面
/// 
/// 允许用户添加、删除和管理自定义表情包
class EmojiManagerScreen extends StatefulWidget {
  const EmojiManagerScreen({Key? key}) : super(key: key);

  @override
  _EmojiManagerScreenState createState() => _EmojiManagerScreenState();
}

class _EmojiManagerScreenState extends State<EmojiManagerScreen> {
  // 当前选中的分类
  String _selectedCategory = '自定义';
  // 正在添加表情
  bool _isAddingEmoji = false;
  // 表情名称控制器
  final TextEditingController _nameController = TextEditingController();
  
  // 分类列表
  final List<String> _availableCategories = ['自定义', '基础', '动物', '食物', '活动', '新增分类'];
  
  // 用于添加新分类的控制器
  final TextEditingController _categoryController = TextEditingController();
  
  @override
  void dispose() {
    _nameController.dispose();
    _categoryController.dispose();
    super.dispose();
  }
  
  // 添加新表情包
  Future<void> _addNewEmoji() async {
    try {
      // 提示用户选择创建方式（在Web平台上限制相机功能）
      final choice = await showDialog<String>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('选择创建表情方式'),
          children: [
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, 'text'),
              child: const Text('输入文字创建表情'),
            ),
            if (!kIsWeb) // 仅在非Web平台显示相机选项
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, 'photo'),
                child: const Text('拍照创建表情'),
              ),
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, 'gallery'),
              child: Text(kIsWeb ? '选择图片创建表情' : '从相册选择图片'),
            ),
          ],
        ),
      );
      
      if (choice == null) return;
      
      setState(() {
        _isAddingEmoji = true;
      });
      
      // 获取名称
      final emojiName = await _showNameDialog();
      if (emojiName == null || emojiName.trim().isEmpty) {
        setState(() {
          _isAddingEmoji = false;
        });
        return;
      }
      
      // 根据选择执行不同操作
      Uint8List? imageBytes;
      
      if (choice != 'text') {
        // 选择图片源（在Web平台上限制相机功能）
        final ImageSource source = 
          choice == 'photo' ? ImageSource.camera : ImageSource.gallery;
        final ImageSource actualSource = kIsWeb && source == ImageSource.camera ? ImageSource.gallery : source;
        
        // 选择或拍照获取图片
        final ImagePicker picker = ImagePicker();
        final XFile? image = await picker.pickImage(
          source: actualSource,
          maxWidth: 512,
          maxHeight: 512,
          imageQuality: 85,
        );
        
        if (image == null) {
          setState(() {
            _isAddingEmoji = false;
          });
          return;
        }
        
        // 读取图片文件（兼容Web平台）
        imageBytes = await image.readAsBytes();
      }
      
      // 获取EmojiService
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      
      // 如果没有选择图片，创建一个简单的占位图像数据
      if (imageBytes == null) {
        imageBytes = Uint8List.fromList(List.generate(10, (index) => 0));
      }
      
      // 上传并添加到表情库
      final newEmoji = await emojiService.uploadNewEmoji(
        imageBytes: imageBytes,
        name: emojiName,
        category: _selectedCategory,
      );
      
      if (newEmoji != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('表情包"$emojiName"添加成功')),
        );
        
        // 刷新状态
        setState(() {});
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('表情包添加失败')),
        );
      }
    } catch (e) {
      print('添加表情包错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('添加表情包失败: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isAddingEmoji = false;
        });
      }
    }
  }
  
  // 显示名称输入对话框
  Future<String?> _showNameDialog() async {
    _nameController.text = '';
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('表情包名称'),
        content: TextField(
          controller: _nameController,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: '请输入表情包名称',
            hintText: '例如：微笑、点赞',
          ),
        ),
        actions: [
          TextButton(
            child: const Text('取消'),
            onPressed: () => Navigator.pop(context),
          ),
          TextButton(
            child: const Text('确定'),
            onPressed: () => Navigator.pop(context, _nameController.text),
          ),
        ],
      ),
    );
  }
  
  // 删除表情包
  Future<void> _deleteEmoji(EmojiModel emoji) async {
    // 显示确认对话框
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除表情包'),
        content: Text('确定要删除表情包"${emoji.name}"吗？'),
        actions: [
          TextButton(
            child: const Text('取消'),
            onPressed: () => Navigator.pop(context, false),
          ),
          TextButton(
            child: const Text('确定'),
            onPressed: () => Navigator.pop(context, true),
          ),
        ],
      ),
    );
    
    if (confirmed != true) return;
    
    try {
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      final result = await emojiService.deleteEmoji(emoji.id);
      
      if (result) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('表情包"${emoji.name}"已删除')),
        );
        setState(() {});
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('删除表情包失败')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('删除表情包错误: $e')),
      );
    }
  }
  
  // 清除所有自定义表情包
  Future<void> _clearAllCustomEmojis() async {
    // 显示确认对话框
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('清除所有自定义表情包'),
        content: const Text('确定要清除所有自定义表情包吗？\n\n该操作不可撤销，仅保留系统基础表情包。'),
        actions: [
          TextButton(
            child: const Text('取消'),
            onPressed: () => Navigator.pop(context, false),
          ),
          TextButton(
            child: const Text('确定清除', style: TextStyle(color: Colors.red)),
            onPressed: () => Navigator.pop(context, true),
          ),
        ],
      ),
    );
    
    if (confirmed != true) return;
    
    try {
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      final result = await emojiService.clearCustomEmojis();
      
      if (result) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('所有自定义表情包已清除')),
        );
        setState(() {
          _selectedCategory = '基础'; // 切换到基础分类
        });
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('清除表情包失败')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('清除表情包错误: $e')),
      );
    }
  }
  
  @override
  Widget build(BuildContext context) {
    final emojiService = Provider.of<EmojiService>(context);
    final theme = Theme.of(context);
    
    // 根据当前分类过滤表情包
    final filteredEmojis = emojiService.emojis
        .where((emoji) => emoji.category == _selectedCategory)
        .toList();
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('表情包管理'),
        elevation: 0,
        actions: [
          // 清除所有自定义表情包按钮
          IconButton(
            icon: const Icon(Icons.clear_all),
            tooltip: '清除所有自定义表情包',
            onPressed: () => _clearAllCustomEmojis(),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => setState(() {}),
            tooltip: '刷新表情库',
          ),
        ],
      ),
      body: Column(
        children: [
          // 分类选择
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: _availableCategories.map((category) => 
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: FilterChip(
                    label: Text(category),
                    selected: _selectedCategory == category,
                    onSelected: (selected) {
                      if (selected) {
                        setState(() {
                          _selectedCategory = category;
                        });
                      }
                    },
                    backgroundColor: Colors.grey[200],
                    selectedColor: theme.primaryColor.withOpacity(0.2),
                    checkmarkColor: theme.primaryColor,
                  ),
                )
              ).toList(),
            ),
          ),
          
          // 表情包网格
          Expanded(
            child: GridView.builder(
              padding: const EdgeInsets.all(16),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 4, // 每行4个
                crossAxisSpacing: 16,
                mainAxisSpacing: 16,
                childAspectRatio: 1.0,
              ),
              itemCount: filteredEmojis.length + 1, // +1 用于添加按钮
              itemBuilder: (context, index) {
                if (index == 0) {
                  // 添加按钮
                  return _buildAddButton();
                }
                
                // 表情项
                final emoji = filteredEmojis[index - 1];
                return _buildEmojiItem(emoji);
              },
            ),
          ),
        ],
      ),
    );
  }
  
  // 构建添加按钮
  Widget _buildAddButton() {
    return InkWell(
      onTap: _isAddingEmoji ? null : _addNewEmoji,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.grey[200],
          borderRadius: BorderRadius.circular(12),
        ),
        child: _isAddingEmoji
            ? const Center(child: CircularProgressIndicator())
            : const Center(
                child: Icon(
                  Icons.add_circle_outline,
                  size: 36,
                  color: Colors.grey,
                ),
              ),
      ),
    );
  }
  
  // 构建表情项
  Widget _buildEmojiItem(EmojiModel emoji) {
    return Stack(
      children: [
        // 表情图片
        InkWell(
          onTap: () {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('表情包: ${emoji.name}')),
            );
          },
          borderRadius: BorderRadius.circular(12),
          child: Container(
            decoration: BoxDecoration(
              color: Colors.grey[200],
              borderRadius: BorderRadius.circular(12),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: emoji.isLocal
                ? emoji.assetPath != null && emoji.assetPath!.length <= 2
                  // 文本表情直接显示
                  ? Center(
                      child: Text(
                        emoji.assetPath!,
                        style: const TextStyle(fontSize: 40),
                      ),
                    )
                  // 图片表情
                  : Image.asset(
                    emoji.assetPath!,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Center(
                      child: Text(
                        emoji.name.isNotEmpty ? emoji.name[0] : '?',
                        style: const TextStyle(fontSize: 20),
                      ),
                    ),
                  )
                : Image.network(
                    emoji.remoteUrl!,
                    fit: BoxFit.cover,
                    loadingBuilder: (context, child, loadingProgress) {
                      if (loadingProgress == null) return child;
                      return Center(
                        child: CircularProgressIndicator(
                          value: loadingProgress.expectedTotalBytes != null
                              ? loadingProgress.cumulativeBytesLoaded /
                                  loadingProgress.expectedTotalBytes!
                              : null,
                          strokeWidth: 2,
                        ),
                      );
                    },
                    errorBuilder: (context, error, stackTrace) => Center(
                      child: Text(
                        emoji.name.isNotEmpty ? emoji.name[0] : '?',
                        style: const TextStyle(fontSize: 20),
                      ),
                    ),
                  ),
            ),
          ),
        ),
        
        // 删除按钮
        Positioned(
          top: 0,
          right: 0,
          child: IconButton(
            icon: const Icon(Icons.close, size: 20),
            color: Colors.white,
            style: IconButton.styleFrom(
              backgroundColor: Colors.black.withOpacity(0.5),
              padding: const EdgeInsets.all(4),
              minimumSize: const Size(24, 24),
            ),
            onPressed: () => _deleteEmoji(emoji),
          ),
        ),
      ],
    );
  }
} 