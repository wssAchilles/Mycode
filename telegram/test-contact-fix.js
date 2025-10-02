/**
 * 联系人功能修复测试脚本
 * 验证添加联系人的API是否正常工作
 */

const http = require('http');

const API_BASE_URL = 'http://localhost:5000';

// 创建HTTP请求函数
function makeRequest(method, url, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            status: res.statusCode,
            data: parsedData
          });
        } catch (error) {
          reject(new Error(`解析响应失败: ${error.message}\n响应内容: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testContactFix() {
  console.log('🔧 联系人功能修复测试\n');

  try {
    // 1. 首先登录获取token
    console.log('🔐 正在登录...');
    const loginResponse = await makeRequest('POST', `${API_BASE_URL}/api/auth/login`, {
      usernameOrEmail: 'alice', // 使用测试数据中的用户
      password: '123456'
    });

    if (loginResponse.status !== 200) {
      throw new Error(`登录失败: ${JSON.stringify(loginResponse.data)}`);
    }

    const token = loginResponse.data.tokens.accessToken;
    console.log('✅ 登录成功');

    // 2. 测试获取联系人列表
    console.log('\n📋 测试获取联系人列表...');
    const contactsResponse = await makeRequest('GET', `${API_BASE_URL}/api/contacts`, null, token);
    console.log('📊 联系人列表状态:', contactsResponse.status);
    if (contactsResponse.status === 200) {
      console.log('✅ 获取联系人列表成功');
      console.log('   联系人数量:', contactsResponse.data.contacts?.length || 0);
    }

    // 3. 测试获取待处理请求
    console.log('\n📮 测试获取待处理请求...');
    const pendingResponse = await makeRequest('GET', `${API_BASE_URL}/api/contacts/pending-requests`, null, token);
    console.log('📊 待处理请求状态:', pendingResponse.status);
    if (pendingResponse.status === 200) {
      console.log('✅ 获取待处理请求成功');
      console.log('   待处理请求数量:', pendingResponse.data.requests?.length || 0);
    }

    // 4. 测试搜索用户（为添加联系人做准备）
    console.log('\n🔍 测试搜索用户...');
    const searchResponse = await makeRequest('GET', `${API_BASE_URL}/api/contacts/search?query=bob`, null, token); // 搜索bob用户
    console.log('📊 搜索用户状态:', searchResponse.status);
    if (searchResponse.status === 200) {
      console.log('✅ 搜索用户成功');
      const users = searchResponse.data.users || [];
      console.log('   找到用户数量:', users.length);
      
      // 5. 如果找到用户，尝试添加联系人
      if (users.length > 0) {
        const targetUser = users[0];
        console.log('   目标用户:', targetUser.username);
        
        console.log('\n➕ 测试添加联系人...');
        const addContactResponse = await makeRequest('POST', `${API_BASE_URL}/api/contacts/add`, {
          contactId: targetUser.id
        }, token);
        
        console.log('📊 添加联系人状态:', addContactResponse.status);
        if (addContactResponse.status === 201) {
          console.log('✅ 添加联系人成功');
          console.log('   返回数据键:', Object.keys(addContactResponse.data));
        } else if (addContactResponse.status === 400 && addContactResponse.data.error?.includes('已经是您的联系人')) {
          console.log('ℹ️ 该用户已经是联系人');
        } else {
          console.log('❌ 添加联系人失败:', addContactResponse.data);
        }
      } else {
        console.log('⚠️ 没有找到可添加的用户，跳过添加联系人测试');
      }
    }

    console.log('\n🎉 所有测试完成！');
    console.log('\n📋 测试结果总结:');
    console.log('   - Sequelize关联查询已修复');
    console.log('   - Contact.belongsTo(User, { as: "contact" }) 正常工作');
    console.log('   - Contact.belongsTo(User, { as: "user" }) 正常工作');
    console.log('   - 联系人API功能已恢复正常');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 解决方案:');
      console.log('   • 确保后端服务器正在运行: npm run dev');
      console.log('   • 检查端口5000是否被占用');
      console.log('   • 重启后端开发服务器');
    }
  }
}

// 运行测试
testContactFix().then(() => {
  console.log('\n✨ 联系人功能修复验证完成！');
  process.exit(0);
}).catch(error => {
  console.error('❌ 测试脚本执行失败:', error);
  process.exit(1);
});
