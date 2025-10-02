import 'dart:io';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/book.dart';
import '../main.dart';

/// 图书服务层 - 处理所有与books表相关的数据库操作
class BookService {
  static final BookService _instance = BookService._internal();
  factory BookService() => _instance;
  BookService._internal();

  /// 获取所有图书的实时流（包含分类信息）
  /// 使用Stream可以让任何图书的改动都自动刷新
  Stream<List<Book>> getBooksStream() {
    return supabase
        .from('books')
        .stream(primaryKey: ['id'])
        .order('created_at', ascending: false)
        .map((data) {
          return data.map((json) => Book.fromJson(json)).toList();
        });
  }

  /// 获取包含分类信息的图书列表（用于需要分类信息的场景）
  Future<List<Book>> getBooksWithCategories() async {
    try {
      final response = await supabase
          .from('books')
          .select('*, categories!books_category_id_fk(name)')
          .order('created_at', ascending: false);
      
      return (response as List)
          .map((json) => Book.fromJson(json))
          .toList();
    } catch (e) {
      print('获取图书和分类信息失败: $e');
      return [];
    }
  }

  /// 添加新书（支持指定数量）
  Future<void> addBook(Book newBook, {int quantity = 1}) async {
    try {
      // 获取当前用户ID
      final userId = supabase.auth.currentUser?.id;
      
      // 准备要插入的数据
      final bookData = newBook.toJson();
      bookData['last_updated_by'] = userId;
      // 设置总数量和可借数量
      bookData['total_quantity'] = quantity;
      bookData['available_quantity'] = quantity;
      
      await supabase
          .from('books')
          .insert(bookData);
    } catch (e) {
      throw Exception('添加图书失败: $e');
    }
  }

  /// 更新图书信息
  Future<void> updateBook(Book updatedBook) async {
    try {
      if (updatedBook.id == null) {
        throw Exception('更新失败：图书ID不能为空');
      }
      
      // 获取当前用户ID
      final userId = supabase.auth.currentUser?.id;
      
      // 准备更新数据
      final bookData = updatedBook.toJson();
      bookData['last_updated_by'] = userId;
      
      await supabase
          .from('books')
          .update(bookData)
          .eq('id', updatedBook.id!);
    } catch (e) {
      throw Exception('更新图书失败: $e');
    }
  }

  /// 删除图书
  Future<void> deleteBook(int bookId) async {
    try {
      // 首先检查图书是否有被借出的副本
      final response = await supabase
          .from('books')
          .select('total_quantity, available_quantity')
          .eq('id', bookId)
          .single();
      
      final totalQuantity = response['total_quantity'] as int;
      final availableQuantity = response['available_quantity'] as int;
      
      if (availableQuantity < totalQuantity) {
        throw Exception('无法删除：该图书有 ${totalQuantity - availableQuantity} 本正在被借阅中');
      }
      
      // 如果有封面图片，先删除存储中的图片
      final bookResponse = await supabase
          .from('books')
          .select('cover_image_url')
          .eq('id', bookId)
          .single();
      
      final coverUrl = bookResponse['cover_image_url'] as String?;
      if (coverUrl != null && coverUrl.isNotEmpty) {
        await _deleteBookCover(coverUrl);
      }
      
      // 删除数据库记录
      await supabase
          .from('books')
          .delete()
          .eq('id', bookId);
    } catch (e) {
      throw Exception('删除图书失败: $e');
    }
  }

  /// 上传图书封面到Supabase Storage
  Future<String?> uploadBookCover(File imageFile, {String? oldImageUrl}) async {
    try {
      // 如果有旧图片，先删除
      if (oldImageUrl != null && oldImageUrl.isNotEmpty) {
        await _deleteBookCover(oldImageUrl);
      }
      
      // 生成唯一文件名
      final fileName = '${DateTime.now().millisecondsSinceEpoch}_${imageFile.path.split('/').last}';
      final filePath = 'book_covers/$fileName';
      
      // 上传文件到Supabase Storage
      await supabase.storage
          .from('book_covers') // 修正：使用正确的bucket名称
          .uploadBinary(
            filePath,
            await imageFile.readAsBytes(),
            fileOptions: const FileOptions(
              cacheControl: '3600',
              upsert: true,
            ),
          );
      
      // 获取公开URL
      final publicUrl = supabase.storage
          .from('book_covers')
          .getPublicUrl(filePath);
      
      return publicUrl;
    } catch (e) {
      throw Exception('上传图片失败: $e');
    }
  }

  /// 删除图书封面
  Future<void> _deleteBookCover(String imageUrl) async {
    try {
      // 从URL中提取文件路径
      final uri = Uri.parse(imageUrl);
      final pathSegments = uri.pathSegments;
      
      // 找到book_covers后面的路径
      final coverIndex = pathSegments.indexOf('book_covers');
      if (coverIndex != -1 && coverIndex < pathSegments.length - 1) {
        final filePath = pathSegments.sublist(coverIndex + 1).join('/');
        
        await supabase.storage
            .from('book_covers')
            .remove(['book_covers/$filePath']);
      }
    } catch (e) {
      // 删除失败不影响主流程，只记录错误
      print('删除旧图片失败: $e');
    }
  }

  /// 搜索图书
  Future<List<Book>> searchBooks(String query) async {
    try {
      final response = await supabase
          .from('books')
          .select()
          .or('title.ilike.%$query%,author.ilike.%$query%,location.ilike.%$query%')
          .order('created_at', ascending: false);
      
      return (response as List)
          .map((json) => Book.fromJson(json))
          .toList();
    } catch (e) {
      throw Exception('搜索图书失败: $e');
    }
  }

  /// 根据ID获取单本图书（包含分类信息）
  Future<Book?> getBookById(int id) async {
    try {
      final response = await supabase
          .from('books')
          .select('*, categories(name)')
          .eq('id', id)
          .single();
      
      return Book.fromJson(response);
    } catch (e) {
      return null;
    }
  }

  /// 检查Storage bucket是否存在，如果不存在则创建
  Future<void> ensureStorageBucketExists() async {
    try {
      // 尝试获取bucket信息
      final buckets = await supabase.storage.listBuckets();
      
      final bucketExists = buckets.any((bucket) => bucket.id == 'book_covers');
      
      if (!bucketExists) {
        // 创建bucket
        await supabase.storage.createBucket(
          'book_covers',
          const BucketOptions(
            public: true,
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
          ),
        );
      }
    } catch (e) {
      print('检查Storage bucket失败: $e');
    }
  }
}
