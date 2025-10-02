import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/models.dart';

/// 消息气泡组件
class MessageBubble extends StatelessWidget {
  final MessageModel message;
  final bool isCurrentUser;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  const MessageBubble({
    Key? key,
    required this.message,
    required this.isCurrentUser,
    this.onTap,
    this.onLongPress,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        alignment: isCurrentUser ? Alignment.centerRight : Alignment.centerLeft,
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: isCurrentUser ? Colors.blue : Colors.grey[300],
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (message.text?.isNotEmpty == true)
                Text(
                  message.text!,
                  style: TextStyle(
                    color: isCurrentUser ? Colors.white : Colors.black,
                  ),
                ),
              const SizedBox(height: 4),
              Text(
                _formatTime(message.timestamp),
                style: TextStyle(
                  fontSize: 12,
                  color: isCurrentUser ? Colors.white70 : Colors.black54,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatTime(Timestamp timestamp) {
    final DateTime dateTime = timestamp.toDate();
    final now = DateTime.now();
    
    if (dateTime.day == now.day && 
        dateTime.month == now.month && 
        dateTime.year == now.year) {
      return '${dateTime.hour.toString().padLeft(2, '0')}:${dateTime.minute.toString().padLeft(2, '0')}';
    } else {
      return '${dateTime.month}/${dateTime.day} ${dateTime.hour.toString().padLeft(2, '0')}:${dateTime.minute.toString().padLeft(2, '0')}';
    }
  }
}
