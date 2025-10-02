<template>
  <div class="dashboard-container">
    <!-- 完整的仪表板界面 -->
    <AnomalyDashboard />
    
    <!-- 实时数据可视化 -->
    <div class="realtime-section animate-fadeInUp" style="animation-delay: 0.8s">
      <div class="card hover-glow">
        <div class="section-header">
          <div class="header-left">
            <div class="section-icon">📈</div>
            <div class="header-text">
              <h3 class="section-title">实时数据监控</h3>
              <p class="section-description">PM2.5数值实时趋势图表</p>
            </div>
          </div>
          <div class="connection-status">
            <div class="status-indicator" :class="wsConnected ? 'connected' : 'disconnected'">
              <span class="status-dot"></span>
              <span class="status-text">{{ wsConnected ? 'WebSocket已连接' : 'WebSocket未连接' }}</span>
            </div>
          </div>
        </div>
        
        <div class="realtime-content">
          <RealtimeChart />
        </div>
      </div>
    </div>
    
    <!-- 快速导航区域 -->
    <div class="quick-nav-section animate-fadeInUp" style="animation-delay: 0.9s">
      <div class="card hover-glow">
        <div class="section-header">
          <div class="header-left">
            <div class="section-icon">🧭</div>
            <div class="header-text">
              <h3 class="section-title">快速导航</h3>
              <p class="section-description">系统功能快速访问</p>
            </div>
          </div>
        </div>
        
        <div class="quick-nav-grid">
          <router-link 
            to="/map" 
            class="nav-card nav-primary hover-lift animate-zoomIn"
            style="animation-delay: 1.0s"
          >
            <div class="nav-icon">🗺️</div>
            <div class="nav-content">
              <h4 class="nav-title">传感器地图</h4>
              <p class="nav-description">查看所有传感器位置和实时数据</p>
            </div>
            <div class="nav-arrow">→</div>
          </router-link>
          
          <div class="nav-card nav-info hover-lift animate-zoomIn" style="animation-delay: 1.1s">
            <div class="nav-icon">📊</div>
            <div class="nav-content">
              <h4 class="nav-title">数据分析</h4>
              <p class="nav-description">深入分析环境监测数据趋势</p>
            </div>
            <div class="nav-arrow">→</div>
          </div>
          
          <div class="nav-card nav-success hover-lift animate-zoomIn" style="animation-delay: 1.2s">
            <div class="nav-icon">⚙️</div>
            <div class="nav-content">
              <h4 class="nav-title">系统设置</h4>
              <p class="nav-description">配置监控参数和警报规则</p>
            </div>
            <div class="nav-arrow">→</div>
          </div>
          
          <div class="nav-card nav-warning hover-lift animate-zoomIn" style="animation-delay: 1.3s">
            <div class="nav-icon">📱</div>
            <div class="nav-content">
              <h4 class="nav-title">移动端</h4>
              <p class="nav-description">移动设备优化的监控界面</p>
            </div>
            <div class="nav-arrow">→</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 系统状态信息 -->
    <div class="system-info-section animate-fadeInUp" style="animation-delay: 1.4s">
      <div class="card hover-glow">
        <div class="section-header">
          <div class="header-left">
            <div class="section-icon">💡</div>
            <div class="header-text">
              <h3 class="section-title">系统信息</h3>
              <p class="section-description">当前系统运行状态</p>
            </div>
          </div>
        </div>
        
        <div class="system-info-grid">
          <div class="info-item">
            <div class="info-label">系统版本</div>
            <div class="info-value">v2.1.0</div>
          </div>
          <div class="info-item">
            <div class="info-label">在线传感器</div>
            <div class="info-value">{{ onlineSensors }} 个</div>
          </div>
          <div class="info-item">
            <div class="info-label">数据更新</div>
            <div class="info-value">{{ lastUpdate }}</div>
          </div>
          <div class="info-item">
            <div class="info-label">WebSocket状态</div>
            <div class="info-value" :class="wsConnected ? 'status-online' : 'status-offline'">
              <span class="status-dot"></span>
              {{ wsConnected ? '已连接' : '未连接' }}
            </div>
          </div>
          <div class="info-item">
            <div class="info-label">实时消息数</div>
            <div class="info-value">{{ realtimeStats.totalMessages }}</div>
          </div>
          <div class="info-item">
            <div class="info-label">检测到异常</div>
            <div class="info-value">{{ realtimeStats.anomalyCount }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSensorDataStore } from '@/stores/sensorData'
import { webSocketService } from '@/services/websocket'
import type { SensorData } from '@/types/SensorData'
import AnomalyDashboard from '@/components/AnomalyDashboard.vue'
import RealtimeChart from '@/components/RealtimeChart.vue'

// 状态管理
const sensorStore = useSensorDataStore()

// WebSocket连接状态
const wsConnected = ref(false)

// 在线传感器数量
const onlineSensors = computed(() => {
  return sensorStore.sensorData.length
})

// 最后更新时间
const lastUpdate = ref('刚刚')

// 实时数据统计
const realtimeStats = ref({
  totalMessages: 0,
  anomalyCount: 0,
  lastAnomalyTime: null as Date | null
})

// 更新时间格式化
function updateLastUpdate() {
  const now = new Date()
  lastUpdate.value = now.toLocaleTimeString('zh-CN')
}

// 处理实时传感器数据
function handleRealtimeData(data: SensorData) {
  console.log('Dashboard收到实时数据:', data)
  
  // 更新统计信息
  realtimeStats.value.totalMessages++
  if (data.isAnomaly) {
    realtimeStats.value.anomalyCount++
    realtimeStats.value.lastAnomalyTime = new Date()
  }
  
  // 更新最后更新时间
  updateLastUpdate()
  
  // 更新传感器数据存储
  sensorStore.updateData(data)
}

// 初始化WebSocket连接
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

// 组件挂载时
onMounted(async () => {
  console.log('Dashboard组件已完全加载')
  updateLastUpdate()
  
  // 初始化WebSocket连接
  initializeWebSocket()
  
  // 每30秒更新一次时间显示
  setInterval(updateLastUpdate, 30000)
})

// 组件卸载时清理WebSocket连接
onUnmounted(() => {
  console.log('Dashboard组件卸载，关闭WebSocket连接')
  webSocketService.disconnect()
})
</script>

<style scoped>
/* === 仪表板容器 === */
.dashboard-container {
  min-height: 100vh;
  background: var(--color-surface-50);
  position: relative;
}

/* === 快速导航区域 === */
.quick-nav-section,
.realtime-section {
  padding: 0 var(--spacing-6) var(--spacing-8);
}

.realtime-content {
  padding: var(--spacing-4);
}

.connection-status {
  display: flex;
  align-items: center;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.status-indicator.connected {
  background: rgba(34, 197, 94, 0.1);
  color: var(--color-success);
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.status-indicator.connected .status-dot {
  background: var(--color-success);
  animation: pulse 2s ease-in-out infinite;
}

.status-indicator.disconnected {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.status-indicator.disconnected .status-dot {
  background: var(--color-error);
}

.status-indicator .status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

.quick-nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacing-4);
  padding: var(--spacing-6);
}

.nav-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
  padding: var(--spacing-5);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-backdrop-filter);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  text-decoration: none;
  color: var(--color-text-primary);
  transition: all var(--duration-300) var(--easing-spring);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.nav-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0;
  transition: opacity var(--duration-300) var(--easing-out);
  z-index: 0;
}

.nav-card.nav-primary::before {
  background: var(--gradient-primary);
}

.nav-card.nav-info::before {
  background: var(--gradient-success);
}

.nav-card.nav-success::before {
  background: var(--gradient-info);
}

.nav-card.nav-warning::before {
  background: var(--gradient-warning);
}

.nav-card:hover::before {
  opacity: 0.1;
}

.nav-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-2xl);
  border-color: var(--color-primary-300);
}

.nav-icon {
  font-size: var(--font-size-2xl);
  z-index: 1;
  position: relative;
}

.nav-content {
  flex: 1;
  z-index: 1;
  position: relative;
}

.nav-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  margin: 0 0 var(--spacing-1) 0;
  color: var(--color-text-primary);
}

.nav-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
  line-height: var(--line-height-relaxed);
}

.nav-arrow {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-tertiary);
  transition: all var(--duration-300) var(--easing-spring);
  z-index: 1;
  position: relative;
}

.nav-card:hover .nav-arrow {
  color: var(--color-primary-500);
  transform: translateX(4px);
}

/* === 系统信息区域 === */
.system-info-section {
  padding: 0 var(--spacing-6) var(--spacing-8);
}

.system-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacing-4);
  padding: var(--spacing-6);
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  padding: var(--spacing-4);
  background: rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg);
  transition: all var(--duration-200) var(--easing-out);
}

.info-item:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-1px);
}

.info-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.info-value {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-family: var(--font-family-mono);
}

.status-online {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  color: var(--color-success) !important;
}

.status-offline {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  color: var(--color-error) !important;
}

.status-online .status-dot {
  width: 8px;
  height: 8px;
  background: var(--color-success);
  border-radius: var(--radius-full);
  animation: pulse 2s ease-in-out infinite;
}

.status-offline .status-dot {
  width: 8px;
  height: 8px;
  background: var(--color-error);
  border-radius: var(--radius-full);
  animation: pulse 2s ease-in-out infinite;
}

/* === 通用节标题样式 === */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-6) var(--spacing-8);
  border-bottom: 1px solid var(--color-outline-variant);
  margin-bottom: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.section-icon {
  font-size: var(--font-size-2xl);
  opacity: 0.8;
}

.header-text .section-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  font-family: var(--font-family-display);
  margin: 0 0 var(--spacing-1) 0;
  color: var(--color-text-primary);
}

.section-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}

/* === 响应式设计 === */
@media (max-width: 1200px) {
  .quick-nav-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
}

@media (max-width: 768px) {
  .dashboard-container {
    padding: var(--spacing-2);
  }
  
  .quick-nav-section,
  .system-info-section {
    padding: 0 var(--spacing-2) var(--spacing-6);
  }
  
  .quick-nav-grid,
  .system-info-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-3);
    padding: var(--spacing-4);
  }
  
  .nav-card {
    padding: var(--spacing-4);
  }
  
  .section-header {
    padding: var(--spacing-4) var(--spacing-6);
    flex-direction: column;
    gap: var(--spacing-2);
    text-align: center;
  }
}

@media (max-width: 480px) {
  .nav-card {
    flex-direction: column;
    text-align: center;
    gap: var(--spacing-3);
  }
  
  .nav-arrow {
    transform: rotate(90deg);
  }
  
  .nav-card:hover .nav-arrow {
    transform: rotate(90deg) translateX(4px);
  }
}
</style>
