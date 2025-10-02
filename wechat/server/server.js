const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const AWS = require('aws-sdk');
const cron = require('node-cron');
const cors = require('cors');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

// 初始化Express
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 配置Filebase S3连接
const s3 = new AWS.S3({
  endpoint: 'https://s3.filebase.com',
  accessKeyId: process.env.FILEBASE_ACCESS_KEY,
  secretAccessKey: process.env.FILEBASE_SECRET_KEY,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

// 存储用户Socket连接
const userSockets = {};
// 存储聊天文件哈希，用于检测更改
const chatFileHashes = {};

// 监听连接
io.on('connection', (socket) => {
  console.log('新客户端连接', socket.id);
  
  // 用户认证
  socket.on('authenticate', (data) => {
    const userId = data.userId;
    if (!userId) return;
    
    console.log(`用户${userId}认证`);
    
    // 保存用户Socket连接
    userSockets[userId] = socket.id;
    
    // 订阅此用户可能参与的聊天
    socket.join(`user_${userId}`);
  });
  
  // 监听新消息
  socket.on('message', async (data) => {
    const { senderId, receiverId, message } = data;
    
    if (!senderId || !receiverId || !message) {
      return socket.emit('error', { message: '无效的消息数据' });
    }
    
    try {
      // 保存消息的逻辑保留在客户端，服务器仅负责实时通知
      // 向接收者发送新消息通知
      if (userSockets[receiverId]) {
        io.to(userSockets[receiverId]).emit('new_message', {
          senderId,
          messagePreview: message.messageType === 'text' ? message.content : '[图片]',
          timestamp: new Date().toISOString()
        });
      }
      
      // 同时通知发送者消息已发送成功
      socket.emit('message_sent', { messageId: message.messageId });
      
    } catch (error) {
      console.error('发送消息错误:', error);
      socket.emit('error', { message: '消息发送失败' });
    }
  });
  
  // 监听断开连接
  socket.on('disconnect', () => {
    console.log('客户端断开连接', socket.id);
    // 从userSockets中删除断开的用户
    Object.keys(userSockets).forEach(userId => {
      if (userSockets[userId] === socket.id) {
        delete userSockets[userId];
      }
    });
  });
});

// 定期检查Filebase中的聊天文件变化 (每30秒)
cron.schedule('*/30 * * * * *', async () => {
  try {
    const bucketName = 'chatmssages';
    const params = {
      Bucket: bucketName,
      Prefix: 'chats/'
    };
    
    const data = await s3.listObjectsV2(params).promise();
    
    for (const item of data.Contents) {
      const fileKey = item.Key;
      const eTag = item.ETag; // 文件的哈希值
      
      // --- 第一层：最基本的 fileKey 验证 (保持在最前面) ---
      if (!fileKey || typeof fileKey !== 'string' || fileKey.trim() === '') {
        console.warn('警告: 跳过空或无效的文件键:', fileKey);
        continue;
      }
      // 新增：精确诊断并跳过字面量 'null' 的键 (即使它可能通过了其他验证)
      if (fileKey === 'null') { // 专门针对 'null' 字符串键
        console.error(`严重错误：发现Filebase返回的fileKey为字面量 'null'，跳过此项。原始item:`, item);
        continue;
      }
      // 检查是否为目录占位符
      if (fileKey.endsWith('/')) {
        console.log(`跳过目录占位符: ${fileKey}`);
        continue;
      }
      // 检查是否为JSON文件
      if (!fileKey.endsWith('.json')) {
        console.log(`跳过非JSON文件: ${fileKey}`);
        continue;
      }
      
      // 4. 提取并验证基础文件名
      // 格式应为: chats/userA_userB.json 或 chats/group_groupId.json
      const pathParts = fileKey.split('/');
      if (pathParts.length !== 2) {
        console.warn('警告: 文件路径格式不符合预期:', fileKey);
        continue;
      }
      
      const fileName = pathParts[1];
      const baseName = fileName.split('.')[0]; // 去掉扩展名，例如 userA_userB
      
      // 5. 检查基础名称是否为字面量 "null"
      if (baseName === "null") {
        console.error('严重警告: 文件名包含字面量 "null"，这将导致 NoSuchKey 错误:', fileKey);
        continue;
      }
      
      // 6. 检查基础名称是否为空
      if (!baseName || baseName.trim() === '') {
        console.warn('警告: 文件基础名称为空:', fileKey);
        continue;
      }
      
      // 7. 检查基础名称是否包含特殊字符
      if (baseName.includes('/') || baseName.includes('\\') || baseName.includes('.')) {
        console.warn('警告: 文件基础名称包含特殊字符:', fileKey);
        continue;
      }
      
      // 8. 验证文件名格式
      const parts = baseName.split('_');
      const isPrivateChatFormat = parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
      const isGroupChatFormat = baseName.startsWith('group_') && parts.length === 2 && parts[1].length > 0;
      
      if (!isPrivateChatFormat && !isGroupChatFormat) {
        console.warn('警告: 文件名格式不符合私聊或群聊格式:', fileKey);
        continue;
      }
      
      // --- 第二层：检查文件是否已更新或为新文件 ---
      // 如果文件哈希没有变化，且文件不是第一次被检查，则跳过后续处理
      if (chatFileHashes.hasOwnProperty(fileKey) && chatFileHashes[fileKey] === eTag) {
          // 仅更新哈希值，然后跳过内容处理和通知发送，因为文件未更改
          chatFileHashes[fileKey] = eTag; // 确保哈希被记录
          continue;
      }

      // --- 第三层：获取文件内容并处理 (现在始终在 try-catch 中) ---
      try {
          const fileData = await s3.getObject({
            Bucket: bucketName,
          Key: fileKey // <-- 这里的 fileKey 仍然是导致 NoSuchKey 错误的根源
          }).promise();
          
          // 解析文件内容
          const chatDataString = fileData.Body.toString();
        let chatData;
        try {
            chatData = JSON.parse(chatDataString);
        } catch (parseError) {
            console.error(`WARN: 文件内容不是有效的JSON，跳过: ${fileKey}. 错误: ${parseError.message}`);
            chatFileHashes[fileKey] = eTag; // 记录哈希，防止重复解析
            continue; // 跳过此文件，因为它不是有效JSON
        }

        // 确保chatData是一个对象，并且包含一个名为'messages'的数组属性
        if (typeof chatData === 'object' && chatData !== null && Array.isArray(chatData.messages) && chatData.messages.length > 0) {
          // 现在，将消息数组赋值给一个新变量
          const messagesArray = chatData.messages; // 获取实际的消息数组
          
          // 提取聊天用户ID（此部分保持不变，因为它依赖于文件名，而不是文件内容）
            const chatFileName = baseName; // 已经在前面验证过的基础名称
            const userIds = chatFileName.split('_');
            
          // 仅对私聊或群聊格式正确的文件发送通知
          const isPrivateChatFormat = userIds.length === 2 && userIds[0].length > 0 && userIds[1].length > 0;
          const isGroupChatFormat = chatFileName.startsWith('group_') && userIds.length === 2 && userIds[1].length > 0;

          if (isPrivateChatFormat) {
            userIds.forEach(userId => {
                  if (userId && userSockets[userId]) { // 确保userId有效且用户在线
                io.to(userSockets[userId]).emit('chat_updated', {
                  chatId: chatFileName,
                          lastMessage: messagesArray[messagesArray.length - 1] // 使用messagesArray
                });
              }
            });
          } else if (isGroupChatFormat) {
              const groupId = userIds[1]; // 对于 group_ID.json
              // 需要获取群组成员列表才能通知所有成员
              // 简化的处理：发送给所有在线成员
              Object.keys(userSockets).forEach(userId => { // Notify all active sockets for group chat update
                  io.to(userSockets[userId]).emit('chat_updated', {
                      chatId: chatFileName,
                      lastMessage: messagesArray[messagesArray.length - 1] // 使用messagesArray
                  });
              });
              console.log(`群聊 ${groupId} 更新，通知所有在线用户`);
          } else {
              console.warn(`警告: 未能识别的文件格式，跳过通知发送: ${fileKey}`);
          }

        } else {
          console.warn('警告: 文件内容不是有效的聊天数据对象或消息数组为空:', fileKey);
          }

        } catch (innerError) {
        // --- 错误日志强化 ---
        console.error('处理Filebase文件时出错:', {
          fileKey: fileKey, // 打印出具体导致错误的 fileKey
          errorCode: innerError.code || 'UNKNOWN_ERROR_CODE',
          errorMessage: innerError.message || 'UNKNOWN_ERROR_MESSAGE',
          stack: innerError.stack || 'NO_STACK_TRACE',
          // 额外信息：
          bucket: bucketName,
          // 如果需要，可以打印原始 item
          // originalItem: item
          });
        // 不 rethrow，允许 cron job 继续处理其他文件
      }
      
      // --- 第四层：更新文件哈希 (始终在循环末尾) ---
      // 无论是否处理内容，只要尝试了获取文件，就更新哈希
      chatFileHashes[fileKey] = eTag;
    }
  } catch (error) {
    console.error('检查Filebase更新错误:', error);
  }
});

// API路由
app.get('/', (req, res) => {
  res.send('微聊WebSocket服务器正在运行');
});

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', connections: Object.keys(userSockets).length });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
