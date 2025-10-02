// Test script to create a user and get authentication token for testing Socket.IO
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const BASE_URL = 'http://localhost:5000';

async function testAuthentication() {
  try {
    console.log('🔐 Testing user authentication for Socket.IO...');
    
    // Test user credentials
    const testUser = {
      username: 'ai_test_user',
      email: 'aitest@example.com',
      password: 'test123456'
    };
    
    console.log('\n1️⃣ Testing user registration...');
    try {
      const registerResponse = await axios.post(`${BASE_URL}/api/auth/register`, testUser);
      console.log('✅ User registered successfully');
      console.log('📝 User info:', {
        id: registerResponse.data.user.id,
        username: registerResponse.data.user.username,
        email: registerResponse.data.user.email
      });
      console.log('🔑 Access Token:', registerResponse.data.tokens.accessToken.substring(0, 20) + '...');
      
      return registerResponse.data.tokens.accessToken;
    } catch (registerError) {
      if (registerError.response?.status === 400 && registerError.response?.data?.message?.includes('已存在')) {
        console.log('ℹ️ User already exists, trying login...');
      } else {
        throw registerError;
      }
    }
    
    console.log('\n2️⃣ Testing user login...');
    try {
      const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
        usernameOrEmail: testUser.username,
        password: testUser.password
      });
      
      console.log('✅ Login successful');
      console.log('📝 User info:', {
        id: loginResponse.data.user.id,
        username: loginResponse.data.user.username,
        email: loginResponse.data.user.email
      });
      console.log('🔑 Access Token:', loginResponse.data.tokens.accessToken.substring(0, 20) + '...');
      
      return loginResponse.data.tokens.accessToken;
    } catch (loginError) {
      console.error('❌ Login failed:', loginError.response?.data || loginError.message);
      throw loginError;
    }
    
  } catch (error) {
    console.error('❌ Authentication test failed:', error.response?.data || error.message);
    return null;
  }
}

// Run the test
testAuthentication().then(token => {
  if (token) {
    console.log('\n🎉 Authentication test completed successfully!');
    console.log('\n💡 How to use this token for Socket.IO testing:');
    console.log('1. Save this token in localStorage as "accessToken"');
    console.log('2. Use it in the frontend Socket.IO authentication');
    console.log('3. The token can be used to test AI chat messages through main Socket.IO');
    console.log('\n🔑 Token for manual testing:', token);
  } else {
    console.log('\n❌ Authentication test failed - no token received');
  }
});
