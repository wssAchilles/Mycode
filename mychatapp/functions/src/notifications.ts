import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// 初始化Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 发送好友请求通知
 */
export const sendFriendRequestNotification = functions.https.onCall(async (data, context) => {
  // 验证用户身份
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '用户未认证');
  }

  const { receiverToken, senderName, senderId } = data;

  if (!receiverToken || !senderName || !senderId) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要参数');
  }

  try {
    const response = await admin.messaging().send({
      notification: {
        title: '好友请求',
        body: `${senderName} 向您发送了好友请求`,
      },
      data: {
        type: 'friend_request',
        senderId: senderId,
        senderName: senderName,
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
      token: receiverToken,
      android: {
        notification: {
          channelId: 'friend_requests',
          priority: 'high' as const,
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: '好友请求',
              body: `${senderName} 向您发送了好友请求`,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    functions.logger.info('好友请求通知发送成功', { messageId: response });
    return { success: true, messageId: response };
  } catch (error) {
    functions.logger.error('发送好友请求通知失败', { error });
    throw new functions.https.HttpsError('internal', '发送通知失败');
  }
});

/**
 * 发送新消息通知
 */
export const sendNewMessageNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '用户未认证');
  }

  const { receiverToken, senderName, messagePreview, chatRoomId, senderId } = data;

  if (!receiverToken || !senderName || !messagePreview || !chatRoomId || !senderId) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要参数');
  }

  try {
    const response = await admin.messaging().send({
      notification: {
        title: senderName,
        body: messagePreview,
      },
      data: {
        type: 'new_message',
        chatRoomId: chatRoomId,
        senderId: senderId,
        senderName: senderName,
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
      token: receiverToken,
      android: {
        notification: {
          channelId: 'chat_messages',
          priority: 'high' as const,
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: senderName,
              body: messagePreview,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    functions.logger.info('新消息通知发送成功', { messageId: response });
    return { success: true, messageId: response };
  } catch (error) {
    functions.logger.error('发送新消息通知失败', { error });
    throw new functions.https.HttpsError('internal', '发送通知失败');
  }
});

/**
 * 发送防沉迷通知
 */
export const sendAntiAddictionNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '用户未认证');
  }

  const { userToken, notificationType, customMessage } = data;

  if (!userToken || !notificationType) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要参数');
  }

  try {
    let title = '';
    let body = '';
    let action = '';

    switch (notificationType) {
      case 'usage_warning':
        title = '使用时间提醒';
        body = customMessage || '您已连续使用较长时间，建议适当休息';
        action = 'usage_warning';
        break;
      case 'daily_limit':
        title = '每日使用限制';
        body = customMessage || '今日使用时间已达上限，建议明天再使用';
        action = 'daily_limit';
        break;
      case 'rest_reminder':
        title = '休息提醒';
        body = customMessage || '建议起身活动，保护视力健康';
        action = 'rest_reminder';
        break;
      default:
        throw new functions.https.HttpsError('invalid-argument', '无效的通知类型');
    }

    const response = await admin.messaging().send({
      notification: {
        title: title,
        body: body,
      },
      data: {
        type: 'anti_addiction',
        action: action,
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
      token: userToken,
      android: {
        notification: {
          channelId: 'anti_addiction',
          priority: 'high' as const,
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: title,
              body: body,
            },
            sound: 'default',
          },
        },
      },
    });

    functions.logger.info('防沉迷通知发送成功', { messageId: response });
    return { success: true, messageId: response };
  } catch (error) {
    functions.logger.error('发送防沉迷通知失败', { error });
    throw new functions.https.HttpsError('internal', '发送通知失败');
  }
});
