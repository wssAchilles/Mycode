import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/category.dart';

class CategoryService {
  final _supabase = Supabase.instance.client;

  // 添加新分类
  Future<void> addCategory(String name) async {
    try {
      await _supabase.from('categories').insert({
        'name': name.trim(),
      });
    } catch (e) {
      print('添加分类失败: $e');
      rethrow;
    }
  }

  // 获取所有分类列表
  Future<List<Category>> getAllCategories() async {
    try {
      final response = await _supabase
          .from('categories')
          .select('*')
          .order('created_at', ascending: true);
      
      return (response as List)
          .map((json) => Category.fromJson(json))
          .toList();
    } catch (e) {
      print('获取分类列表失败: $e');
      return [];
    }
  }

  // 获取分类流（用于实时更新）
  Stream<List<Category>> getCategoriesStream() {
    return _supabase
        .from('categories')
        .stream(primaryKey: ['id'])
        .order('created_at', ascending: true)
        .map((data) => data.map((json) => Category.fromJson(json)).toList());
  }

  // 更新分类名称
  Future<void> updateCategory(Category category) async {
    try {
      await _supabase
          .from('categories')
          .update({
            'name': category.name.trim(),
          })
          .eq('id', category.id);
    } catch (e) {
      print('更新分类失败: $e');
      rethrow;
    }
  }

  // 删除分类
  // 注意：由于数据库设置了ON DELETE SET NULL，删除分类时关联的图书不会被删除
  // 只是它们的category_id会被设置为null
  Future<void> deleteCategory(int categoryId) async {
    try {
      // 首先检查是否有图书使用此分类
      final booksCount = await _getBooksCountByCategory(categoryId);
      
      if (booksCount > 0) {
        // 如果有图书使用此分类，给用户提示
        throw Exception('无法删除分类：还有 $booksCount 本图书属于此分类');
      }

      await _supabase
          .from('categories')
          .delete()
          .eq('id', categoryId);
    } catch (e) {
      print('删除分类失败: $e');
      rethrow;
    }
  }

  // 强制删除分类（即使有关联图书）
  Future<void> forceDeleteCategory(int categoryId) async {
    try {
      await _supabase
          .from('categories')
          .delete()
          .eq('id', categoryId);
    } catch (e) {
      print('强制删除分类失败: $e');
      rethrow;
    }
  }

  // 获取某个分类下的图书数量
  Future<int> _getBooksCountByCategory(int categoryId) async {
    try {
      final response = await _supabase
          .from('books')
          .select('id')
          .eq('category_id', categoryId);
      
      return (response as List).length;
    } catch (e) {
      print('获取分类图书数量失败: $e');
      return 0;
    }
  }

  // 根据ID获取单个分类
  Future<Category?> getCategoryById(int categoryId) async {
    try {
      final response = await _supabase
          .from('categories')
          .select('*')
          .eq('id', categoryId)
          .single();
      
      return Category.fromJson(response);
    } catch (e) {
      print('获取分类详情失败: $e');
      return null;
    }
  }

  // 检查分类名称是否已存在
  Future<bool> isCategoryNameExists(String name, {int? excludeId}) async {
    try {
      var query = _supabase
          .from('categories')
          .select('id')
          .eq('name', name.trim());
      
      // 如果是更新操作，排除当前分类的ID
      if (excludeId != null) {
        query = query.neq('id', excludeId);
      }
      
      final response = await query;
      return (response as List).isNotEmpty;
    } catch (e) {
      print('检查分类名称失败: $e');
      return false;
    }
  }
}
