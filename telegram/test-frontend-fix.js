/**
 * 测试前端修复效果的脚本
 * 验证注册和登录流程是否正常工作
 */

const http = require('http');
const { URL } = require('url');

const API_BASE_URL = 'http://localhost:5000';

// 简单的HTTP请求封装
function makeRequest(method, url, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testRegisterAndLogin() {
  console.log('🧪 开始测试前端修复效果...\n');
  
  // 测试数据
  const testUser = {
    username: `test_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    password: '123456'
  };

  try {
    // 1. 测试注册API
    console.log('📝 测试注册API...');
    const registerResponse = await makeRequest('POST', `${API_BASE_URL}/api/auth/register`, testUser);
    
    if (registerResponse.status === 201) {
      console.log('✅ 注册API工作正常');
      console.log('   返回数据包含:', Object.keys(registerResponse.data));
      
      // 检查是否返回了必要的字段
      const { user, tokens } = registerResponse.data;
      if (user && tokens && tokens.accessToken && tokens.refreshToken) {
        console.log('✅ 注册响应格式正确');
        console.log(`   用户ID: ${user.id}`);
        console.log(`   用户名: ${user.username}`);
        console.log('   包含访问令牌和刷新令牌');
      } else {
        console.log('❌ 注册响应格式不完整');
        return false;
      }
    } else {
      console.log('❌ 注册API返回异常状态码:', registerResponse.status);
      return false;
    }

    // 2. 测试登录API
    console.log('\n🔐 测试登录API...');
    const loginResponse = await makeRequest('POST', `${API_BASE_URL}/api/auth/login`, {
      usernameOrEmail: testUser.username, // 使用正确的字段名
      password: testUser.password
    });
    
    if (loginResponse.status === 200) {
      console.log('✅ 登录API工作正常');
      
      // 检查返回格式
      const { user, tokens } = loginResponse.data;
      if (user && tokens && tokens.accessToken && tokens.refreshToken) {
        console.log('✅ 登录响应格式正确');
      } else {
        console.log('❌ 登录响应格式不完整');
        return false;
      }
    } else {
      console.log('❌ 登录API返回异常状态码:', loginResponse.status);
      console.log('   错误详情:', loginResponse.data);
      return false;
    }

    // 3. 测试认证状态检查
    console.log('\n🔍 测试认证状态检查...');
    const token = loginResponse.data.tokens.accessToken;
    const meResponse = await makeRequest('GET', `${API_BASE_URL}/api/auth/me`, null, {
      'Authorization': `Bearer ${token}`
    });
    
    if (meResponse.status === 200) {
      console.log('✅ 认证状态检查正常');
      console.log(`   当前用户: ${meResponse.data.user.username}`);
    } else {
      console.log('❌ 认证状态检查失败');
      return false;
    }

    console.log('\n🎉 所有后端API测试通过！');
    console.log('\n📋 测试总结:');
    console.log('   - 注册API: ✅ 正常');
    console.log('   - 登录API: ✅ 正常');
    console.log('   - 认证检查: ✅ 正常');
    console.log('   - 响应格式: ✅ 正确');
    
    return true;

  } catch (error) {
    console.error('❌ 测试过程中出现错误:', error.message);
    if (error.response) {
      console.error('   响应状态:', error.response.status);
      console.error('   响应数据:', error.response.data);
    }
    return false;
  }
}

// 运行测试
testRegisterAndLogin().then(success => {
  if (success) {
    console.log('\n✅ 前端应该可以正常使用后端API了');
    console.log('💡 建议在浏览器中测试注册和登录流程');
  } else {
    console.log('\n❌ 后端API存在问题，需要进一步检查');
  }
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('❌ 测试脚本执行失败:', error);
  process.exit(1);
});
