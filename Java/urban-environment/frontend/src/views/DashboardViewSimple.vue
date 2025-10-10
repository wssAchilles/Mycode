<template>
  <div class="dashboard-container">
    <!-- Header Section -->
    <header class="dashboard-header glass-header">
      <div class="header-content">
        <div class="brand-section">
          <div class="logo-wrapper">
            <span class="logo-icon">🌍</span>
          </div>
          <div class="brand-text">
            <h1 class="brand-title">智慧城市环境监测</h1>
            <p class="brand-subtitle">Urban Environment Intelligence Platform</p>
          </div>
        </div>
        <div class="connection-status">
          <div class="status-indicator" :class="wsConnected ? 'connected' : 'disconnected'">
            <span class="status-dot"></span>
            <span class="status-text">{{ wsConnected ? 'WebSocket已连接' : 'WebSocket未连接' }}</span>
          </div>
        </div>
      </div>
    </header>
    
    <!-- 统计卡片 -->
    <div class="stats-section">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-content">
            <div class="stat-value">{{ sensorStore.latestData.length }}</div>
            <div class="stat-label">在线传感器</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🚨</div>
          <div class="stat-content">
            <div class="stat-value">{{ anomalousData.length }}</div>
            <div class="stat-label">异常检测</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🌡️</div>
          <div class="stat-content">
            <div class="stat-value">{{ averagePM25 }}</div>
            <div class="stat-label">平均PM2.5</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">⏰</div>
          <div class="stat-content">
            <div class="stat-value">{{ lastUpdate }}</div>
            <div class="stat-label">最后更新</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 实时数据表格 -->
    <div class="data-section">
      <div class="section-header">
        <h2>实时传感器数据</h2>
        <button @click="refreshData" class="refresh-btn">刷新数据</button>
      </div>
      
      <div class="data-table">
        <table>
          <thead>
            <tr>
              <th>设备ID</th>
              <th>PM2.5</th>
              <th>位置</th>
              <th>状态</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="data in sensorStore.latestData" :key="data.deviceId">
              <td>{{ data.deviceId }}</td>
              <td :class="getPM25Class(data.pm25)">{{ data.pm25 }}</td>
              <td>{{ data.latitude.toFixed(4) }}, {{ data.longitude.toFixed(4) }}</td>
              <td>
                <span :class="data.isAnomaly ? 'status-anomaly' : 'status-normal'">
                  {{ data.isAnomaly ? '异常' : '正常' }}
                </span>
              </td>
              <td>{{ formatTime(data.timestamp) }}</td>
            </tr>
          </tbody>
        </table>
        
        <div v-if="sensorStore.latestData.length === 0" class="no-data">
          <p>暂无传感器数据</p>
          <p>请启动IoT模拟器或检查后端服务</p>
        </div>
      </div>
    </div>
    
    <!-- 快速导航 -->
    <div class="nav-section">
      <div class="nav-grid">
        <router-link to="/map" class="nav-card">
          <div class="nav-icon">🗺️</div>
          <div class="nav-text">
            <h3>地图视图</h3>
            <p>查看传感器位置分布</p>
          </div>
        </router-link>
        
        <router-link to="/test" class="nav-card">
          <div class="nav-icon">🔧</div>
          <div class="nav-text">
            <h3>系统测试</h3>
            <p>测试系统功能</p>
          </div>
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSensorDataStore } from '@/stores/sensorData'
import { webSocketService } from '@/services/websocket-simple'
import type { SensorData } from '@/types/SensorData'

// 状态管理
const sensorStore = useSensorDataStore()

// WebSocket连接状态
const wsConnected = ref(false)
const lastUpdate = ref('从未')

// 计算属性
const anomalousData = computed(() => {
  return sensorStore.latestData.filter(d => d.isAnomaly)
})

const averagePM25 = computed(() => {
  if (sensorStore.latestData.length === 0) return 0
  const sum = sensorStore.latestData.reduce((acc, d) => acc + d.pm25, 0)
  return Math.round(sum / sensorStore.latestData.length * 10) / 10
})

// 方法
function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN')
}

function getPM25Class(value: number): string {
  if (value > 150) return 'pm25-hazardous'
  if (value > 75) return 'pm25-moderate' 
  if (value > 35) return 'pm25-good'
  return 'pm25-excellent'
}

function refreshData() {
  console.log('刷新数据请求')
  lastUpdate.value = new Date().toLocaleTimeString('zh-CN')
}

function handleRealtimeData(data: SensorData) {
  console.log('Dashboard收到实时数据:', data)
  sensorStore.updateData(data)
  lastUpdate.value = new Date().toLocaleTimeString('zh-CN')
}

function initializeWebSocket() {
  try {
    webSocketService.connect(handleRealtimeData)
    wsConnected.value = true
    console.log('Dashboard: WebSocket连接已建立')
  } catch (error) {
    console.error('Dashboard: WebSocket连接失败:', error)
    wsConnected.value = false
  }
}

// 生命周期
onMounted(() => {
  console.log('Dashboard组件已加载')
  lastUpdate.value = new Date().toLocaleTimeString('zh-CN')
  
  // 初始化WebSocket
  initializeWebSocket()
})

onUnmounted(() => {
  console.log('Dashboard组件卸载，关闭WebSocket连接')
  webSocketService.disconnect()
})
</script>

<style scoped>
.dashboard-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

/* 头部样式 */
.dashboard-header {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 30px;
}

.brand-section {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo-icon {
  font-size: 48px;
}

.brand-title {
  color: white;
  font-size: 24px;
  margin: 0;
  font-weight: 600;
}

.brand-subtitle {
  color: rgba(255, 255, 255, 0.8);
  margin: 0;
  font-size: 14px;
}

.connection-status {
  display: flex;
  align-items: center;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}

.status-indicator.connected {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-indicator.disconnected {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.status-indicator.connected .status-dot {
  animation: pulse 2s infinite;
}

/* 统计卡片 */
.stats-section {
  margin-bottom: 30px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 16px;
  transition: transform 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-icon {
  font-size: 32px;
}

.stat-value {
  color: white;
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 4px;
}

.stat-label {
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
}

/* 数据表格 */
.data-section {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  margin-bottom: 30px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 30px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.section-header h2 {
  color: white;
  margin: 0;
  font-size: 20px;
}

.refresh-btn {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.data-table {
  padding: 0 30px 20px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  text-align: left;
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

th {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  font-size: 14px;
}

td {
  color: white;
  font-size: 14px;
}

.pm25-excellent { color: #22c55e; }
.pm25-good { color: #eab308; }
.pm25-moderate { color: #f97316; }
.pm25-hazardous { color: #ef4444; }

.status-normal { 
  color: #22c55e; 
  font-weight: 500;
}

.status-anomaly { 
  color: #ef4444; 
  font-weight: 500;
}

.no-data {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.7);
}

/* 导航区域 */
.nav-section {
  margin-bottom: 20px;
}

.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}

.nav-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 16px;
  text-decoration: none;
  transition: all 0.2s ease;
}

.nav-card:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.15);
}

.nav-icon {
  font-size: 32px;
}

.nav-text h3 {
  color: white;
  margin: 0 0 4px 0;
  font-size: 16px;
}

.nav-text p {
  color: rgba(255, 255, 255, 0.7);
  margin: 0;
  font-size: 14px;
}

/* 动画 */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .dashboard-container {
    padding: 10px;
  }
  
  .header-content {
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
  
  .stats-grid {
    grid-template-columns: 1fr;
  }
  
  .section-header {
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
  
  table {
    font-size: 12px;
  }
  
  th, td {
    padding: 8px;
  }
}
</style>
