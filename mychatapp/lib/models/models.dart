/// MyChatApp 数据模型库
/// 
/// 统一导出所有数据模型类，作为项目的单一事实来源(Single Source of Truth)
/// 严格遵循项目铁律，所有模型均按最终规范重新生成

// 核心数据模型
export 'user_model.dart';
export 'message_model.dart'; 
export 'chat_room_model.dart';
export 'group_model.dart';
export 'group_role.dart';
export 'media_attachment_model.dart';
export 'notification_model.dart';
export 'presence_model.dart';
export 'location_model.dart';

// 好友系统模型
export 'friend_request_model.dart';
