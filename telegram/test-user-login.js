/**
 * 测试用户登录脚本
 * 自动登录现有用户并获取token
 */

const http = require('http');
const https = require('https');

async function loginTestUser() {
  console.log('🔑 测试用户登录\n');

  try {
    // 准备登录数据
    const loginData = JSON.stringify({
      usernameOrEmail: 'root',  // 使用现有用户
      password: '123456'
    });

    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData)
      }
    };

    const response = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({ statusCode: res.statusCode, data: result });
          } catch (error) {
            resolve({ statusCode: res.statusCode, data: data });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(loginData);
      req.end();
    });

    if (response.statusCode === 200) {
      console.log('✅ 登录成功');
      console.log('   用户名:', response.data.user?.username);
      console.log('   用户名:', response.data.user?.id);
      
      const token = response.data.token || response.data.tokens?.accessToken;
      if (token) {
        console.log('   Token:', token.substring(0, 50) + '...');
        console.log('\n🔗 完整Token (用于测试):');
        console.log(token);
        return token;
      } else {
        console.log('   ℹ️ Token不存在于响应中');
        console.log('   响应数据:', JSON.stringify(response.data, null, 2));
        return null;
      }
    } else {
      console.log('❌ 登录失败');
      console.log('   状态码:', response.statusCode);
      console.log('   响应:', response.data);
      return null;
    }

  } catch (error) {
    console.error('❌ 登录请求失败:', error.message);
    return null;
  }
}

// 运行登录测试
loginTestUser().then(token => {
  if (token) {
    console.log('\n✨ 可以使用此token进行Socket.IO连接测试');
  } else {
    console.log('\n💡 建议检查:');
    console.log('   • 后端服务器是否运行');
    console.log('   • 用户名和密码是否正确');
    console.log('   • 数据库中是否存在测试用户');
  }
  process.exit(0);
});
