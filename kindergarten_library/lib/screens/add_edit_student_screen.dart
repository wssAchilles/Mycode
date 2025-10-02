import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/student.dart';

/// 添加/编辑学生页面
class AddEditStudentScreen extends StatefulWidget {
  final Student? student;
  
  const AddEditStudentScreen({
    Key? key,
    this.student,
  }) : super(key: key);

  @override
  State<AddEditStudentScreen> createState() => _AddEditStudentScreenState();
}

class _AddEditStudentScreenState extends State<AddEditStudentScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _classController = TextEditingController();
  final supabase = Supabase.instance.client;
  
  bool _isLoading = false;
  bool get _isEditing => widget.student != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      _nameController.text = widget.student!.fullName;
      _classController.text = widget.student!.className ?? '';
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _classController.dispose();
    super.dispose();
  }

  Future<void> _saveStudent() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      final studentData = {
        'full_name': _nameController.text.trim(),
        'class_name': _classController.text.trim().isNotEmpty ? _classController.text.trim() : null,
      };

      if (_isEditing) {
        await supabase
            .from('students')
            .update(studentData)
            .eq('id', widget.student!.id!);
        _showSnackBar('学生信息更新成功！');
      } else {
        await supabase
            .from('students')
            .insert(studentData);
        _showSnackBar('学生添加成功！');
      }

      Navigator.pop(context, true);
    } catch (e) {
      _showSnackBar('操作失败: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? '编辑学生' : '添加学生'),
        backgroundColor: Colors.blue.shade600,
        actions: [
          TextButton(
            onPressed: _isLoading ? null : _saveStudent,
            child: Text(
              '保存',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // 学生姓名
            TextFormField(
              controller: _nameController,
              decoration: InputDecoration(
                labelText: '学生姓名 *',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                prefixIcon: const Icon(Icons.person),
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return '请输入学生姓名';
                }
                if (value.trim().length < 2) {
                  return '姓名至少需要2个字符';
                }
                return null;
              },
              textInputAction: TextInputAction.next,
            ),
            
            const SizedBox(height: 16),
            
            // 班级名称
            TextFormField(
              controller: _classController,
              decoration: InputDecoration(
                labelText: '班级名称',
                hintText: '如：大班、中班、小班等',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                prefixIcon: const Icon(Icons.class_),
              ),
              textInputAction: TextInputAction.next,
            ),
            
            const SizedBox(height: 32),
            
            // 保存按钮
            SizedBox(
              height: 50,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _saveStudent,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue.shade600,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: _isLoading
                    ? const CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2,
                      )
                    : Text(
                        _isEditing ? '更新学生信息' : '添加学生',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
              ),
            ),
            
            const SizedBox(height: 16),
            
            // 提示文本
            Text(
              '* 标记为必填项',
              style: TextStyle(
                color: Colors.grey[600],
                fontSize: 12,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
