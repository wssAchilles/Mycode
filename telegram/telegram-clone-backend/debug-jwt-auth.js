const axios = require('axios');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

// 加载环境变量
dotenv.config();

const BASE_URL = 'http://localhost:5000';

async function debugJWTAuth() {
  console.log('🔍 开始调试 JWT 认证问题...\n');

  try {
    // 步骤1: 登录获取Token
    console.log('🔐 步骤1: 用户登录...');
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      usernameOrEmail: 'root',
      password: '123456'
    });
    
    console.log('✅ 登录成功');
    console.log('📋 完整登录响应:', JSON.stringify(loginResponse.data, null, 2));
    
    const token = loginResponse.data.tokens?.accessToken || loginResponse.data.token || loginResponse.data.accessToken || loginResponse.data.data?.token;
    
    if (!token) {
      console.log('❌ Token未找到在登录响应中');
      console.log('📋 可用字段:', Object.keys(loginResponse.data));
      return;
    }
    
    console.log('📄 JWT Token长度:', token.length);
    console.log('🔑 JWT Token开头:', token.substring(0, 50) + '...');
    
    // 步骤2: 解析JWT Token
    console.log('\n🔍 步骤2: 解析JWT Token...');
    try {
      const decoded = jwt.decode(token, { complete: true });
      console.log('✅ Token解码成功');
      console.log('📋 Token Header:', JSON.stringify(decoded.header, null, 2));
      console.log('📋 Token Payload:', JSON.stringify(decoded.payload, null, 2));
    } catch (error) {
      console.log('❌ Token解码失败:', error.message);
    }

    // 步骤3: 验证JWT Token
    console.log('\n🔐 步骤3: 验证JWT Token...');
    try {
      const JWT_SECRET = process.env.JWT_SECRET;
      console.log('🔑 JWT_SECRET存在:', !!JWT_SECRET);
      console.log('🔑 JWT_SECRET长度:', JWT_SECRET ? JWT_SECRET.length : 0);
      
      const verified = jwt.verify(token, JWT_SECRET, {
        issuer: 'telegram-clone',
        audience: 'telegram-clone-users',
      });
      console.log('✅ Token验证成功');
      console.log('📋 验证后的Payload:', JSON.stringify(verified, null, 2));
    } catch (error) {
      console.log('❌ Token验证失败:', error.name, '-', error.message);
      
      // 尝试不验证issuer和audience
      try {
        const verifiedSimple = jwt.verify(token, process.env.JWT_SECRET);
        console.log('✅ 简单验证成功 (不验证issuer/audience)');
        console.log('📋 简单验证Payload:', JSON.stringify(verifiedSimple, null, 2));
      } catch (simpleError) {
        console.log('❌ 简单验证也失败:', simpleError.message);
      }
    }

    // 步骤4: 测试API调用
    console.log('\n🌐 步骤4: 测试API调用...');
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    console.log('📨 请求头:', JSON.stringify(headers, null, 2));
    
    try {
      const response = await axios.get(`${BASE_URL}/api/ai/info`, { headers });
      console.log('✅ API调用成功:', response.data);
    } catch (error) {
      console.log('❌ API调用失败:', error.response?.data || error.message);
      
      if (error.response?.status === 401) {
        console.log('🔍 详细分析认证错误...');
        
        // 手动模拟认证中间件的处理
        const authHeader = headers.Authorization;
        const extractedToken = authHeader && authHeader.split(' ')[1];
        
        console.log('🎯 提取的Token:', extractedToken === token ? '匹配' : '不匹配');
        console.log('🎯 Token是否存在:', !!extractedToken);
      }
    }

    // 步骤5: 检查用户数据库
    console.log('\n👤 步骤5: 检查用户数据库连接...');
    try {
      // 这里可以添加直接数据库查询来验证用户是否存在
      console.log('ℹ️  需要检查 PostgreSQL 数据库中的用户记录');
    } catch (error) {
      console.log('❌ 数据库检查失败:', error.message);
    }

  } catch (error) {
    console.error('❌ 调试过程出错:', error.message);
  }

  console.log('\n🎯 调试建议:');
  console.log('1. 检查JWT_SECRET环境变量是否正确');
  console.log('2. 确认Token的issuer和audience设置');
  console.log('3. 验证用户是否在PostgreSQL数据库中存在');
  console.log('4. 检查认证中间件的错误处理逻辑');
}

// 运行调试
if (require.main === module) {
  debugJWTAuth().catch(console.error);
}

module.exports = { debugJWTAuth };
