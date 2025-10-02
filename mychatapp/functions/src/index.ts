// MyChatApp Cloud Functions
// 处理用户认证和推送通知

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import {SpeechClient} from '@google-cloud/speech';

// 导出推送通知相关函数
export * from './notifications';

// 初始化 Firebase Admin SDK
admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const speechClient = new SpeechClient();

/**
 * Auth onCreate 触发器
 * 当新用户在Firebase Authentication中创建时自动触发
 * 在Firestore的users集合中创建对应的用户文档
 */
export const onUserCreate = functions.auth.user().onCreate(async (user: functions.auth.UserRecord) => {
  try {
    functions.logger.info(`Creating user document for: ${user.uid}`);

    const userDoc = {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || null,
      photoUrl: user.photoURL || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      fcmToken: null, // 将在用户登录时更新
    };

    await db.collection("users").doc(user.uid).set(userDoc);

    functions.logger.info(`User document created successfully for: ${user.uid}`);
    return null;
  } catch (error) {
    functions.logger.error("Error creating user document:", error);
    throw error;
  }
});

/**
 * Auth onDelete 触发器
 * 当用户账户被删除时清理相关数据
 */
export const onUserDelete = functions.auth.user().onDelete(async (user: functions.auth.UserRecord) => {
  try {
    functions.logger.info(`Cleaning up data for deleted user: ${user.uid}`);

    // 删除用户文档
    await db.collection("users").doc(user.uid).delete();

    // 清理聊天室中的用户数据（可选，根据业务需求）
    const chatRoomsQuery = await db
      .collection("chat_rooms")
      .where("participantIds", "array-contains", user.uid)
      .get();

    const batch = db.batch();
    chatRoomsQuery.docs.forEach((doc) => {
      // 标记聊天室为已删除用户，而不是直接删除
      batch.update(doc.ref, {
        [`participantNames.${user.uid}`]: "[已删除用户]",
      });
    });

    await batch.commit();

    functions.logger.info(`Cleanup completed for user: ${user.uid}`);
    return null;
  } catch (error) {
    functions.logger.error("Error cleaning up user data:", error);
    throw error;
  }
});

/**
 * Firestore onCreate 触发器
 * 监听messages/{messageId}的创建事件
 * 向接收者发送推送通知
 */
export const sendNotificationOnMessage = functions.firestore.document('messages/{messageId}').onCreate(async (snapshot: functions.firestore.DocumentSnapshot, context: functions.EventContext) => {
    try {
      const messageData = snapshot.data();
      if (!messageData) {
        functions.logger.error('Message data is undefined');
        return null;
      }

      const messageId = context.params.messageId;
      const chatRoomId = messageData.chatRoomId;

      functions.logger.info(`New message: ${messageId}`);
      functions.logger.info(`New message in chat room ${chatRoomId}: ${messageId}`);

      // 获取消息信息
      const senderId = messageData.senderId;
      const messageText = messageData.text;
      const senderName = messageData.senderName || "未知用户";

      // 获取聊天室信息
      const chatRoomDoc = await db.collection("chat_rooms").doc(chatRoomId).get();
      if (!chatRoomDoc.exists) {
        functions.logger.error(`Chat room not found: ${chatRoomId}`);
        return null;
      }

      const chatRoomData = chatRoomDoc.data();
      const participantIds = chatRoomData?.participantIds || [];

      // 找到接收者ID（除了发送者之外的参与者）
      const receiverId = participantIds.find((id: string) => id !== senderId);
      if (!receiverId) {
        functions.logger.warn(`No receiver found for chat room ${chatRoomId}`);
        return null;
      }

      // 获取接收者信息
      const receiverDoc = await db.collection("users").doc(receiverId).get();
      if (!receiverDoc.exists) {
        functions.logger.warn(`Receiver ${receiverId} not found`);
        return null;
      }

      const receiverData = receiverDoc.data();
      const fcmToken = receiverData?.fcmToken;

      if (!fcmToken) {
        functions.logger.info(`No FCM token for receiver ${receiverId}`);
        return null;
      }

      // 构建推送通知消息
      const notificationPayload = {
        token: fcmToken,
        notification: {
          title: `来自 ${senderName} 的新消息`,
          body: messageText.length > 100 
            ? `${messageText.substring(0, 100)}...` 
            : messageText,
        },
        data: {
          type: "new_message",
          chatRoomId: chatRoomId,
          senderId: senderId,
          senderName: senderName,
          messageId: messageId,
        },
        android: {
          notification: {
            icon: "ic_notification",
            color: "#2196F3",
            channelId: "high_importance_channel",
            priority: "high" as const,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: `来自 ${senderName} 的新消息`,
                body: messageText.length > 100 
                  ? `${messageText.substring(0, 100)}...` 
                  : messageText,
              },
              badge: 1,
              sound: "default",
            },
          },
        },
      };

      // 发送推送通知
      await messaging.send(notificationPayload);

      functions.logger.info(`Push notification sent to ${receiverId} for message ${messageId}`);
      return null;

    } catch (error) {
      functions.logger.error("Error sending push notification:", error);
      // 不抛出错误，避免影响消息发送流程
      return null;
    }
  });

/**
 * 定期清理过期的FCM令牌
 * 每天运行一次，清理无效的FCM令牌
 */
export const cleanupExpiredTokens = functions.pubsub
  .schedule("0 2 * * *") // 每天凌晨2点运行
  .timeZone("Asia/Shanghai")
  .onRun(async (context: functions.EventContext) => {
    try {
      functions.logger.info("Starting FCM token cleanup");

      const usersSnapshot = await db.collection("users")
        .where("fcmToken", "!=", null)
        .get();

      const batch = db.batch();
      let cleanupCount = 0;

      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const fcmToken = userData.fcmToken;

        if (fcmToken) {
          try {
            // 尝试发送测试消息来验证令牌
            await messaging.send({
              token: fcmToken,
              data: { test: "token_validation" },
              apns: { payload: { aps: { "content-available": 1 } } },
              android: { priority: "normal" },
            }, true); // dryRun = true，只验证不实际发送
          } catch (error: any) {
            if (error.code === "messaging/registration-token-not-registered" ||
                error.code === "messaging/invalid-registration-token") {
              // 令牌无效，清理它
              batch.update(userDoc.ref, { fcmToken: null });
              cleanupCount++;
              functions.logger.info(`Cleaned up invalid token for user: ${userDoc.id}`);
            }
          }
        }
      }

      if (cleanupCount > 0) {
        await batch.commit();
        functions.logger.info(`Cleaned up ${cleanupCount} expired FCM tokens`);
      } else {
        functions.logger.info("No expired FCM tokens found");
      }

      return null;
    } catch (error) {
      functions.logger.error("Error during FCM token cleanup:", error);
      throw error;
    }
  });

/**
 * 语音转文字函数
 * 使用Google Cloud Speech-to-Text API转录音频文件
 */
export const transcribeAudio = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  // 验证用户是否已认证
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  try {
    const storagePath = data.storagePath;
    const languageCode = data.languageCode || 'zh-CN';
    
    if (!storagePath) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "storagePath is required"
      );
    }

    functions.logger.info(`Transcribing audio at path: ${storagePath}`);

    // 构建Google Cloud Storage URI
    const gcsUri = `gs://${admin.app().options.storageBucket}/${storagePath}`;

    // 配置Speech-to-Text请求
    const request = {
      audio: {
        uri: gcsUri,
      },
      config: {
        encoding: 'WEBM_OPUS' as const, // 默认编码，支持多种格式
        sampleRateHertz: 48000,
        languageCode: languageCode,
        alternativeLanguageCodes: ['en-US', 'ja-JP'], // 备选语言
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: false,
        model: 'latest_long', // 适合长音频
      },
    };

    // 调用Speech-to-Text API
    const [operation] = await speechClient.longRunningRecognize(request);
    const [response] = await operation.promise();

    if (!response.results || response.results.length === 0) {
      return { transcribedText: '', confidence: 0 };
    }

    // 提取转录文本和置信度
    let transcribedText = '';
    let totalConfidence = 0;
    let alternativeCount = 0;

    response.results.forEach((result) => {
      if (result.alternatives && result.alternatives.length > 0) {
        const alternative = result.alternatives[0];
        transcribedText += alternative.transcript || '';
        totalConfidence += alternative.confidence || 0;
        alternativeCount++;
      }
    });

    const averageConfidence = alternativeCount > 0 ? totalConfidence / alternativeCount : 0;

    functions.logger.info(`Transcription completed. Text length: ${transcribedText.length}, Confidence: ${averageConfidence}`);

    return {
      transcribedText: transcribedText.trim(),
      confidence: averageConfidence,
      languageCode: languageCode,
    };

  } catch (error) {
    functions.logger.error("Error transcribing audio:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to transcribe audio."
    );
  }
});

/**
 * 图像内容分析函数
 * 当图片上传到Storage时自动触发，进行OCR和安全检测
 */
export const visionProcessor = functions.storage.object().onFinalize(async (object: any) => {
  try {
    const filePath = object.name;
    const contentType = object.contentType;

    // 只处理图片文件，且路径在 media/{userId}/images/ 下
    if (!contentType?.startsWith('image/') || !filePath?.includes('/media/') || !filePath?.includes('/images/')) {
      functions.logger.info(`Skipping non-image file or wrong path: ${filePath}`);
      return null;
    }

    functions.logger.info(`Processing image: ${filePath}`);

    // 动态导入Google Cloud Vision API
    const vision = require('@google-cloud/vision');
    const visionClient = new vision.ImageAnnotatorClient();

    const gcsUri = `gs://${object.bucket}/${filePath}`;

    // 并行执行OCR和安全检测
    const [textDetectionResponse, safeSearchResponse] = await Promise.all([
      visionClient.textDetection({ image: { source: { imageUri: gcsUri } } }),
      visionClient.safeSearchDetection({ image: { source: { imageUri: gcsUri } } })
    ]);

    // 提取OCR文本
    const textAnnotations = textDetectionResponse[0].textAnnotations || [];
    const ocrText = textAnnotations.length > 0 ? textAnnotations[0].description || '' : '';

    // 提取安全检测结果
    const safeSearchAnnotation = safeSearchResponse[0].safeSearchAnnotation || {};
    const moderation = {
      adult: safeSearchAnnotation.adult || 'UNKNOWN',
      violence: safeSearchAnnotation.violence || 'UNKNOWN',
      racy: safeSearchAnnotation.racy || 'UNKNOWN',
      medical: safeSearchAnnotation.medical || 'UNKNOWN',
      spoof: safeSearchAnnotation.spoof || 'UNKNOWN',
    };

    // 从filePath提取userId和attachmentId
    // 期望路径格式: media/{userId}/images/{attachmentId}.{ext}
    const pathParts = filePath.split('/');
    if (pathParts.length < 4 || pathParts[0] !== 'media' || pathParts[2] !== 'images') {
      functions.logger.error(`Invalid file path format: ${filePath}`);
      return null;
    }

    const userId = pathParts[1];
    const fileName = pathParts[3];
    const attachmentId = fileName.split('.')[0]; // 移除文件扩展名

    functions.logger.info(`Processing for user: ${userId}, attachment: ${attachmentId}`);

    try {
      // 查找对应的MessageModel文档
      const messagesQuery = await admin.firestore()
        .collection('messages')
        .where('attachmentId', '==', attachmentId)
        .where('senderId', '==', userId)
        .limit(1)
        .get();

      if (messagesQuery.empty) {
        functions.logger.error(`No message found for attachment: ${attachmentId}`);
        return null;
      }

      const messageDoc = messagesQuery.docs[0];
      const messageRef = messageDoc.ref;

      // 查找对应的MediaAttachmentModel文档
      const mediaAttachmentRef = admin.firestore()
        .collection('mediaAttachments')
        .doc(attachmentId);

      const mediaAttachmentDoc = await mediaAttachmentRef.get();
      if (!mediaAttachmentDoc.exists) {
        functions.logger.error(`No media attachment found for: ${attachmentId}`);
        return null;
      }

      // 更新消息文档，添加OCR文本
      if (ocrText) {
        await messageRef.update({
          ocrText: ocrText,
          ocrProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        functions.logger.info(`OCR text added to message ${messageDoc.id}: ${ocrText.substring(0, 100)}...`);
      }

      // 更新媒体附件文档，添加审核结果
      await mediaAttachmentRef.update({
        moderation: moderation,
        moderationProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      functions.logger.info(`Vision processing completed for ${filePath}`);
      functions.logger.info(`OCR text length: ${ocrText.length}, Moderation: ${JSON.stringify(moderation)}`);

      return null;
    } catch (innerError) {
      functions.logger.error(`Error updating documents for ${attachmentId}:`, innerError);
      return null;
    }
  } catch (error) {
    functions.logger.error("Error in vision processing:", error);
    return null; // 不抛出错误，避免影响文件上传
  }
});

/**
 * 用户统计函数
 * 获取应用的用户统计数据
 */
export const getUserStats = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  // 验证用户是否已认证
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  try {
    const usersSnapshot = await db.collection("users").get();
    const chatRoomsSnapshot = await db.collection("chat_rooms").get();

    const stats = {
      totalUsers: usersSnapshot.size,
      totalChatRooms: chatRoomsSnapshot.size,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    functions.logger.info(`User stats requested by ${context.auth.uid}:`, stats);
    return stats;
  } catch (error) {
    functions.logger.error("Error getting user stats:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to get user statistics."
    );
  }
});