import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authUtils } from '../services/apiClient';

const SimpleChatPage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('🔄 SimpleChatPage 初始化开始');
    
    // 检查认证状态
    if (!authUtils.isAuthenticated()) {
      console.log('❌ 用户未认证，重定向到登录页面');
      navigate('/login', { replace: true });
      return;
    }

    // 从本地存储获取用户信息
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const userData = JSON.parse(userStr);
        console.log('✅ 从本地存储获取用户信息:', userData.username);
        setUser(userData);
      } catch (error) {
        console.error('❌ 解析用户信息失败:', error);
      }
    }

    setLoading(false);
    console.log('✅ SimpleChatPage 初始化完成');
  }, [navigate]);

  const handleLogout = () => {
    console.log('🚪 用户登出');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    navigate('/login', { replace: true });
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#1a1a1a',
        color: '#ffffff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            fontSize: '32px', 
            marginBottom: '16px',
            animation: 'spin 1s linear infinite'
          }}>
            ⏳
          </div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh',
      backgroundColor: '#1a1a1a',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%'
      }}>
        {/* 顶部导航栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          backgroundColor: '#2d2d2d',
          borderBottom: '1px solid #404040'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px' }}>
              💬 Telegram Clone
            </h1>
            {user && (
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#a0a0a0' }}>
                欢迎回来，{user.username}
              </p>
            )}
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              backgroundColor: '#ff3b30',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            登出
          </button>
        </div>

        {/* 主要内容区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          textAlign: 'center',
          padding: '40px'
        }}>
          <div style={{ fontSize: '64px', marginBottom: '24px' }}>
            💬
          </div>
          <h2 style={{ fontSize: '28px', marginBottom: '16px', color: '#ffffff' }}>
            欢迎来到 Telegram Clone！
          </h2>
          <p style={{ fontSize: '16px', color: '#a0a0a0', marginBottom: '32px', lineHeight: '1.5' }}>
            您已成功登录到聊天应用！<br />
            这是一个简化版本的聊天页面，用于验证React DOM错误修复效果。
          </p>
          
          <div style={{
            background: 'rgba(103, 126, 234, 0.1)',
            border: '1px solid rgba(103, 126, 234, 0.3)',
            borderRadius: '8px',
            padding: '20px',
            maxWidth: '400px',
            width: '100%'
          }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#677eea' }}>
              ✅ 测试状态
            </h3>
            <div style={{ textAlign: 'left', fontSize: '14px', color: '#a0a0a0' }}>
              <div style={{ marginBottom: '8px' }}>
                ✅ React严格模式已禁用
              </div>
              <div style={{ marginBottom: '8px' }}>
                ✅ 错误边界已添加
              </div>
              <div style={{ marginBottom: '8px' }}>
                ✅ 简化组件渲染逻辑
              </div>
              <div>
                ✅ 避免复杂的useEffect链
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default SimpleChatPage;
