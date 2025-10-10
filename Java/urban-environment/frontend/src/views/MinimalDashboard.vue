<template>
  <div class="minimal-dashboard">
    <!-- 头部 -->
    <header class="dashboard-header">
      <div class="header-content">
        <h1>🌍 智慧城市环境监测平台</h1>
        <p>Urban Environment Intelligence Platform</p>
      </div>
      <div class="status">
        <span class="status-dot"></span>
        <span>系统运行中</span>
      </div>
    </header>

    <!-- 统计卡片 -->
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">📊</div>
        <div class="stat-info">
          <div class="stat-number">{{ onlineSensors }}</div>
          <div class="stat-label">在线传感器</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon">🚨</div>
        <div class="stat-info">
          <div class="stat-number">{{ anomalyCount }}</div>
          <div class="stat-label">异常检测</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon">🌡️</div>
        <div class="stat-info">
          <div class="stat-number">{{ averagePM25 }}</div>
          <div class="stat-label">平均PM2.5</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon">⏰</div>
        <div class="stat-info">
          <div class="stat-number">{{ currentTime }}</div>
          <div class="stat-label">当前时间</div>
        </div>
      </div>
    </section>

    <!-- 模拟数据表格 -->
    <section class="data-section">
      <h2>实时传感器数据</h2>
      <div class="data-table">
        <table>
          <thead>
            <tr>
              <th>设备ID</th>
              <th>PM2.5 (μg/m³)</th>
              <th>温度 (°C)</th>
              <th>湿度 (%)</th>
              <th>状态</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sensor in sensorData" :key="sensor.id">
              <td>{{ sensor.id }}</td>
              <td :class="getPM25Class(sensor.pm25)">{{ sensor.pm25 }}</td>
              <td>{{ sensor.temperature }}</td>
              <td>{{ sensor.humidity }}</td>
              <td>
                <span :class="sensor.status === '正常' ? 'status-normal' : 'status-anomaly'">
                  {{ sensor.status }}
                </span>
              </td>
              <td>{{ sensor.lastUpdate }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 快速导航 -->
    <section class="nav-section">
      <h2>快速导航</h2>
      <div class="nav-grid">
        <router-link to="/map" class="nav-card">
          <div class="nav-icon">🗺️</div>
          <div>
            <h3>地图视图</h3>
            <p>查看传感器位置分布</p>
          </div>
        </router-link>
        
        <router-link to="/test" class="nav-card">
          <div class="nav-icon">🔧</div>
          <div>
            <h3>系统测试</h3>
            <p>验证系统功能</p>
          </div>
        </router-link>
      </div>
    </section>

    <!-- 系统信息 -->
    <footer class="system-info">
      <p>系统版本: v2.0.0 | Vue 3 + TypeScript | 最后更新: {{ lastUpdate }}</p>
    </footer>
  </div> 
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

// 响应式数据
const onlineSensors = ref(8)
const anomalyCount = ref(2)
const averagePM25 = ref(45.6)
const currentTime = ref('')
const lastUpdate = ref('')

// 模拟传感器数据
const sensorData = ref([
  {
    id: 'SENSOR_001',
    pm25: 35.4,
    temperature: 23.5,
    humidity: 65.2,
    status: '正常',
    lastUpdate: '16:50:25'
  },
  {
    id: 'SENSOR_002', 
    pm25: 128.9,
    temperature: 26.1,
    humidity: 72.8,
    status: '异常',
    lastUpdate: '16:50:22'
  },
  {
    id: 'SENSOR_003',
    pm25: 42.1,
    temperature: 22.8,
    humidity: 58.4,
    status: '正常',
    lastUpdate: '16:50:20'
  },
  {
    id: 'SENSOR_004',
    pm25: 89.7,
    temperature: 25.3,
    humidity: 69.1,
    status: '异常',
    lastUpdate: '16:50:18'
  },
  {
    id: 'SENSOR_005',
    pm25: 28.3,
    temperature: 21.7,
    humidity: 55.9,
    status: '正常',
    lastUpdate: '16:50:15'
  }
])

// 方法
function getPM25Class(value: number): string {
  if (value > 150) return 'pm25-hazardous'
  if (value > 75) return 'pm25-unhealthy' 
  if (value > 35) return 'pm25-moderate'
  return 'pm25-good'
}

function updateTime() {
  const now = new Date()
  currentTime.value = now.toLocaleTimeString('zh-CN')
  lastUpdate.value = now.toLocaleString('zh-CN')
}

// 模拟实时数据更新
function simulateDataUpdate() {
  setInterval(() => {
    // 随机更新一个传感器的数据
    const randomIndex = Math.floor(Math.random() * sensorData.value.length)
    const sensor = sensorData.value[randomIndex]
    
    // 随机生成新的PM2.5值
    sensor.pm25 = Math.round((Math.random() * 200 + 10) * 10) / 10
    sensor.status = sensor.pm25 > 75 ? '异常' : '正常'
    sensor.lastUpdate = new Date().toLocaleTimeString('zh-CN')
    
    // 更新异常计数
    anomalyCount.value = sensorData.value.filter(s => s.status === '异常').length
    
    // 更新平均值
    const totalPM25 = sensorData.value.reduce((sum, s) => sum + s.pm25, 0)
    averagePM25.value = Math.round(totalPM25 / sensorData.value.length * 10) / 10
  }, 3000)
}

onMounted(() => {
  console.log('MinimalDashboard 组件已挂载')
  updateTime()
  setInterval(updateTime, 1000)
  simulateDataUpdate()
})
</script>

<style scoped>
.minimal-dashboard {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* 头部样式 */
.dashboard-header {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-radius: 20px;
  padding: 30px;
  margin-bottom: 30px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-content h1 {
  margin: 0 0 10px 0;
  font-size: 28px;
  font-weight: 600;
}

.header-content p {
  margin: 0;
  opacity: 0.8;
  font-size: 16px;
}

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(34, 197, 94, 0.2);
  padding: 10px 20px;
  border-radius: 12px;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-dot {
  width: 10px;
  height: 10px;
  background: #22c55e;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-radius: 16px;
  padding: 25px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 20px;
  transition: transform 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-5px);
}

.stat-icon {
  font-size: 36px;
}

.stat-number {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 5px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.8;
}

/* 数据表格 */
.data-section {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-radius: 20px;
  padding: 30px;
  margin-bottom: 30px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.data-section h2 {
  margin: 0 0 20px 0;
  font-size: 22px;
}

.data-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
}

th, td {
  padding: 15px;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

th {
  background: rgba(255, 255, 255, 0.1);
  font-weight: 600;
}

.pm25-good { color: #22c55e; font-weight: 600; }
.pm25-moderate { color: #eab308; font-weight: 600; }
.pm25-unhealthy { color: #f97316; font-weight: 600; }
.pm25-hazardous { color: #ef4444; font-weight: 600; }

.status-normal { 
  color: #22c55e; 
  background: rgba(34, 197, 94, 0.2);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.status-anomaly { 
  color: #ef4444; 
  background: rgba(239, 68, 68, 0.2);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

/* 导航区域 */
.nav-section {
  margin-bottom: 30px;
}

.nav-section h2 {
  margin-bottom: 20px;
  font-size: 22px;
}

.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.nav-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-radius: 16px;
  padding: 25px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 20px;
  text-decoration: none;
  color: white;
  transition: all 0.3s ease;
}

.nav-card:hover {
  transform: translateY(-5px);
  background: rgba(255, 255, 255, 0.15);
}

.nav-icon {
  font-size: 36px;
}

.nav-card h3 {
  margin: 0 0 5px 0;
  font-size: 18px;
}

.nav-card p {
  margin: 0;
  font-size: 14px;
  opacity: 0.8;
}

/* 系统信息 */
.system-info {
  text-align: center;
  padding: 20px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.system-info p {
  margin: 0;
  font-size: 14px;
  opacity: 0.7;
}

/* 动画 */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .minimal-dashboard {
    padding: 15px;
  }
  
  .dashboard-header {
    flex-direction: column;
    gap: 20px;
    text-align: center;
  }
  
  .stats-grid {
    grid-template-columns: 1fr;
  }
  
  .nav-grid {
    grid-template-columns: 1fr;
  }
  
  table {
    font-size: 14px;
  }
  
  th, td {
    padding: 10px;
  }
}
</style>
