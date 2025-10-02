import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/emoji_model.dart';
import '../services/emoji_service.dart';
import '../screens/profile/emoji_manager_screen.dart';

/// 表情选择器组件
/// 
/// 提供一个界面让用户选择表情包
class EmojiPicker extends StatefulWidget {
  /// 当用户选择表情时的回调
  final void Function(EmojiModel emoji) onEmojiSelected;
  
  /// 是否显示表情分类
  final bool showCategories;
  
  /// 构造函数
  const EmojiPicker({
    Key? key,
    required this.onEmojiSelected,
    this.showCategories = true,
  }) : super(key: key);

  @override
  State<EmojiPicker> createState() => _EmojiPickerState();
}

class _EmojiPickerState extends State<EmojiPicker> with SingleTickerProviderStateMixin {
  /// 当前选中的分类
  String _selectedCategory = '基础';
  
  @override
  void initState() {
    super.initState();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final emojiService = Provider.of<EmojiService>(context);
    final categories = emojiService.categories.keys.toList();
    
    // 如果表情服务尚未初始化，显示加载指示器
    if (!emojiService.isInitialized) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }
    
    // 如果没有分类，显示提示
    if (categories.isEmpty) {
      return const Center(
        child: Text('暂无表情包'),
      );
    }
    
    return DefaultTabController(
      length: categories.length,
      initialIndex: categories.contains('基础') ? categories.indexOf('基础') : 0,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 顶部操作栏
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // 快速创建表情包按钮
              TextButton.icon(
                icon: Icon(Icons.add, size: 18),
                label: Text('快速创建'),
                style: TextButton.styleFrom(
                  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                ),
                onPressed: () {
                  _showQuickCreateDialog();
                },
              ),
              
              // 管理表情包按钮
              TextButton.icon(
                icon: Icon(Icons.settings, size: 18),
                label: Text('管理表情包'),
                style: TextButton.styleFrom(
                  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                ),
                onPressed: () {
                  // 导航到表情包管理页面
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => const EmojiManagerScreen(),
                    ),
                  ).then((_) {
                    // 返回后刷新表情选择器
                    if (mounted) {
                      setState(() {});
                    }
                  });
                },
              ),
            ],
          ),
          
          // 表情分类标签
          if (widget.showCategories)
            TabBar(
              isScrollable: true,
              tabs: categories.map((category) => Tab(text: category)).toList(),
              labelColor: theme.primaryColor,
              unselectedLabelColor: Colors.grey,
              indicatorColor: theme.primaryColor,
            ),
            
          // 表情网格
          SizedBox(
            height: 200, // 表情面板高度
            child: TabBarView(
              children: categories.map((category) {
                final emojis = emojiService.getEmojisByCategory(category);
                
                return GridView.builder(
                  padding: EdgeInsets.all(8),
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 5, // 每行5个表情
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                  ),
                  itemCount: emojis.length,
                  itemBuilder: (context, index) {
                    final emoji = emojis[index];
                    
                    return InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => widget.onEmojiSelected(emoji),
                      child: _buildEmojiItem(emoji),
                    );
                  },
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
  
  /// 显示快速创建表情包对话框
  void _showQuickCreateDialog() {
    showDialog(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('快速创建表情包'),
        children: [
          SimpleDialogOption(
            onPressed: () {
              Navigator.pop(context);
              _createTextEmoji();
            },
            child: ListTile(
              leading: Icon(Icons.text_fields, color: Colors.green),
              title: Text('输入文字创建表情'),
              dense: true,
            ),
          ),
          SimpleDialogOption(
            onPressed: () {
              Navigator.pop(context);
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => const EmojiManagerScreen(),
                ),
              ).then((_) {
                if (mounted) {
                  setState(() {});
                }
              });
            },
            child: ListTile(
              leading: Icon(Icons.settings, color: Colors.blue),
              title: Text('打开表情包管理'),
              dense: true,
            ),
          ),
        ],
      ),
    );
  }
  
  /// 创建文本表情包
  Future<void> _createTextEmoji() async {
    final TextEditingController nameController = TextEditingController();
    
    try {
      final emojiName = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('创建文本表情包'),
          content: TextField(
            controller: nameController,
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
              child: const Text('创建'),
              onPressed: () => Navigator.pop(context, nameController.text),
            ),
          ],
        ),
      );
      
      if (emojiName == null || emojiName.isEmpty) return;
      
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      
      // 创建一个简单的占位图像数据
      final List<int> placeholderImageBytes = List.generate(10, (index) => 0);
      
      final newEmoji = await emojiService.uploadNewEmoji(
        imageBytes: placeholderImageBytes,
        name: emojiName,
        category: '自定义',
      );
      
      if (newEmoji != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('表情包"$emojiName"创建成功')),
        );
        
        // 刷新表情选择器
        setState(() {});
        
        // 立即选择新创建的表情包
        widget.onEmojiSelected(newEmoji);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('创建表情包失败')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('创建表情包失败: $e')),
      );
    } finally {
      nameController.dispose();
    }
  }
  
  /// 构建表情项
  Widget _buildEmojiItem(EmojiModel emoji) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.grey.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Tooltip(
        message: emoji.name,
        child: emoji.isLocal
          ? emoji.assetPath != null && emoji.assetPath!.length <= 2
            // 如果assetPath是短字符串(表情符号)，直接显示为文本
            ? Center(
                child: Text(
                  emoji.assetPath!,
                  style: const TextStyle(fontSize: 30),
                ),
              )
            // 否则尝试加载资源图片
            : Image.asset(
                emoji.assetPath!,
                fit: BoxFit.contain,
                width: 40,
                height: 40,
                errorBuilder: (context, error, stackTrace) {
                  print('表情加载失败: ${emoji.assetPath}: $error');
                  return Container(
                    color: Colors.grey.withOpacity(0.2),
                    child: Center(
                      child: Text(
                        emoji.name.isNotEmpty ? emoji.name[0] : '?', 
                        style: TextStyle(fontSize: 16),
                      ),
                    ),
                  );
                },
              )
          : Image.network(
              emoji.remoteUrl!,
              fit: BoxFit.contain,
              width: 40,
              height: 40,
              errorBuilder: (context, error, stackTrace) {
                print('表情加载失败: ${emoji.remoteUrl}: $error');
                return Container(
                  color: Colors.grey.withOpacity(0.2),
                  child: Center(
                    child: Text(
                      emoji.name.isNotEmpty ? emoji.name[0] : '?', 
                      style: TextStyle(fontSize: 16),
                    ),
                  ),
                );
              },
              loadingBuilder: (context, child, loadingProgress) {
                if (loadingProgress == null) return child;
                return Center(
                  child: CircularProgressIndicator(
                    value: loadingProgress.expectedTotalBytes != null
                        ? loadingProgress.cumulativeBytesLoaded /
                            loadingProgress.expectedTotalBytes!
                        : null,
                    strokeWidth: 2.0,
                  ),
                );
              },
            ),
      ),
    );
  }
} 