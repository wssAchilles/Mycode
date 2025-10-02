<template>
  <div class="home-view">
    <!-- 导航栏 -->
    <nav class="top-nav">
      <div class="nav-brand">
        <h1>城市环境智能分析平台</h1>
      </div>
      <div class="nav-links">
        <router-link to="/home" class="nav-link active">
          <span class="nav-icon">🏠</span>
          首页
        </router-link>
        <router-link to="/map" class="nav-link">
          <span class="nav-icon">🗺️</span>
          地图视图
        </router-link>
        <router-link to="/dashboard" class="nav-link">
          <span class="nav-icon">📊</span>
          异常检测
        </router-link>
      </div>
    </nav>

    <!-- 主要内容 -->
    <main class="main-content">
      <div class="hero-section">
        <div class="hero-content">
          <h2>智能环境监测与异常检测系统</h2>
          <p>基于AI技术的实时环境数据监测和异常检测平台，为城市环境管理提供科学决策支持。</p>
          
          <div class="feature-cards">
            <div class="feature-card">
              <div class="feature-icon">🌍</div>
              <h3>实时监测</h3>
              <p>24/7实时监测城市环境质量数据，包括PM2.5、温度、湿度等关键指标</p>
              <router-link to="/map" class="feature-button">查看地图</router-link>
            </div>
            
            <div class="feature-card">
              <div class="feature-icon">🤖</div>
              <h3>AI异常检测</h3>
              <p>采用Isolation Forest算法进行智能异常检测，提前发现环境质量问题</p>
              <router-link to="/dashboard" class="feature-button">查看仪表板</router-link>
            </div>
            
            <div class="feature-card">
              <div class="feature-icon">⚠️</div>
              <h3>实时警报</h3>
              <p>多种警报方式（浏览器通知、声音、弹窗）确保及时响应异常情况</p>
              <button @click="testAlert" class="feature-button">测试警报</button>
            </div>
            
            <div class="feature-card">
              <div class="feature-icon">📊</div>
              <h3>数据分析</h3>
              <p>全面的数据统计和分析功能，支持数据导出和报表生成</p>
              <router-link to="/dashboard" class="feature-button">数据分析</router-link>
            </div>
          </div>
        </div>
      </div>

      <!-- 系统状态监控 -->
      <section class="status-section">
        <h3>系统状态</h3>
        <div class="status-grid">
          <div class="status-item">
            <div class="status-icon" :class="`status-${backendStatus}`">🖥️</div>
            <div class="status-info">
              <div class="status-label">后端服务</div>
              <div class="status-text">{{ backendStatusText }}</div>
            </div>
          </div>
          
          <div class="status-item">
            <div class="status-icon" :class="`status-${aiStatus}`">🤖</div>
            <div class="status-info">
              <div class="status-label">AI服务</div>
              <div class="status-text">{{ aiStatusText }}</div>
            </div>
          </div>
          
          <div class="status-item">
            <div class="status-icon" :class="`status-${wsStatus}`">🔄</div>
            <div class="status-info">
              <div class="status-label">实时连接</div>
              <div class="status-text">{{ wsStatusText }}</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

// 系统状态
const backendStatus = ref('checking')
const backendStatusText = ref('检查中...')
const aiStatus = ref('checking')
const aiStatusText = ref('检查中...')
const wsStatus = ref('checking')
const wsStatusText = ref('检查中...')

// 测试警报功能
function testAlert() {
  alert('警报测试：这是一个测试警报！')
}

// 检查系统状态
async function checkSystemStatus() {
  console.log('开始检查系统状态...')
  
  // 检查后端状态
  try {
    console.log('检查后端状态...')
    const response = await fetch('/api/sensor-data/latest')
    if (response.ok) {
      backendStatus.value = 'online'
      backendStatusText.value = '在线'
    } else {
      backendStatus.value = 'offline'
      backendStatusText.value = '离线'
    }
  } catch (error) {
    console.error('后端检查失败:', error)
    backendStatus.value = 'offline'
    backendStatusText.value = '离线'
  }

  // 检查AI服务状态
  try {
    console.log('检查AI服务状态...')
    const response = await fetch('http://localhost:8000/health')
    if (response.ok) {
      aiStatus.value = 'online'
      aiStatusText.value = '在线'
    } else {
      aiStatus.value = 'offline'
      aiStatusText.value = '离线'
    }
  } catch (error) {
    console.error('AI服务检查失败:', error)
    aiStatus.value = 'offline'
    aiStatusText.value = '离线'
  }

  // WebSocket状态设置为离线（简化）
  wsStatus.value = 'offline'
  wsStatusText.value = '未连接'
  
  console.log('系统状态检查完成')
}

// 组件挂载时初始化
onMounted(async () => {
  console.log('HomeView组件已挂载')
  await checkSystemStatus()
})
</script>

<style scoped>
/* 页面动画 */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideInFromLeft {
  from {
    opacity: 0;
    transform: translateX(-50px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes bounce {
  0%, 20%, 60%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-20px);
  }
  80% {
    transform: translateY(-10px);
  }
}

.home-view {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.top-nav {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  box-shadow: 0 2px 20px rgba(0,0,0,0.1);
  padding: 0 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 70px;
  position: sticky;
  top: 0;
  z-index: 1000;
  animation: slideInFromLeft 0.8s ease-out;
}

.nav-brand h1 {
  margin: 0;
  color: #333;
  font-size: 24px;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea, #764ba2);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  /* 如果不支持渐变文字则显示备用颜色 */
  -moz-background-clip: text;
}

.nav-links {
  display: flex;
  gap: 1.5rem;
}

.nav-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-decoration: none;
  color: #666;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 12px;
  transition: all 0.3s ease;
  min-width: 80px;
  font-size: 14px;
}

.nav-link:hover {
  color: #667eea;
  background: rgba(102, 126, 234, 0.1);
  transform: translateY(-2px);
}

.nav-link.active {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

.nav-icon {
  font-size: 18px;
}

.main-content {
  padding: 0;
}

.hero-section {
  padding: 4rem 2rem;
  text-align: center;
  color: white;
  animation: fadeInUp 1s ease-out;
}

.hero-content h2 {
  font-size: 3rem;
  margin-bottom: 1rem;
  font-weight: 700;
  text-shadow: 0 2px 10px rgba(0,0,0,0.3);
  background: linear-gradient(135deg, #ffffff, #e3f2fd);
  background-clip: text;
  -webkit-background-clip: text;
  color: white;
  -webkit-text-fill-color: transparent;
  /* 备用颜色 */
  -moz-background-clip: text;
}

.hero-content p {
  font-size: 1.25rem;
  margin-bottom: 3rem;
  opacity: 0.9;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
}

.feature-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  animation: fadeInUp 0.8s ease-out 0.5s both;
}

.feature-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 20px;
  padding: 2rem;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  transition: transform 0.3s ease;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.feature-card:hover {
  transform: translateY(-10px);
}

.feature-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
  transition: transform 0.3s ease;
}

.feature-card:hover .feature-icon {
  transform: scale(1.2);
  animation: bounce 1s ease-in-out;
}

.feature-card h3 {
  color: #333;
  margin-bottom: 1rem;
  font-size: 1.5rem;
  font-weight: 600;
}

.feature-card p {
  color: #666;
  margin-bottom: 1.5rem;
  line-height: 1.6;
}

.feature-button {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  padding: 0.75rem 2rem;
  border-radius: 25px;
  text-decoration: none;
  font-weight: 500;
  display: inline-block;
  transition: all 0.3s ease;
  cursor: pointer;
}

.feature-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
}

.status-section {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  margin: 2rem;
  border-radius: 20px;
  padding: 3rem 2rem;
  color: white;
}

.status-section h3 {
  text-align: center;
  font-size: 2rem;
  margin-bottom: 2rem;
  color: white;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 2rem;
  max-width: 800px;
  margin: 0 auto;
}

.status-item {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.1);
  padding: 1.5rem;
  border-radius: 15px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.status-icon {
  font-size: 2rem;
  margin-right: 1rem;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-online {
  background: rgba(76, 175, 80, 0.2);
  border: 2px solid #4CAF50;
}

.status-offline {
  background: rgba(244, 67, 54, 0.2);
  border: 2px solid #f44336;
}

.status-checking {
  background: rgba(255, 193, 7, 0.2);
  border: 2px solid #FFC107;
}

.status-info {
  flex: 1;
}

.status-label {
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: rgba(255, 255, 255, 0.9);
}

.status-text {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .top-nav {
    padding: 0 1rem;
  }

  .nav-brand h1 {
    font-size: 18px;
  }

  .nav-links {
    gap: 1rem;
  }

  .nav-link {
    min-width: 60px;
    font-size: 12px;
    padding: 0.5rem;
  }

  .hero-content h2 {
    font-size: 2rem;
  }

  .hero-content p {
    font-size: 1rem;
  }

  .feature-cards {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .status-section {
    margin: 1rem;
    padding: 2rem 1rem;
  }

  .status-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
</content>
</invoke>