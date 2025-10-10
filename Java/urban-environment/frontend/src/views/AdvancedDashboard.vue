<template>
  <div class="advanced-dashboard">
    <!-- 侧边导航栏 -->
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header">
        <div class="logo-container">
          <span class="logo-icon">🌍</span>
          <span v-if="!sidebarCollapsed" class="logo-text">SmartCity</span>
        </div>
        <button @click="toggleSidebar" class="sidebar-toggle">
          {{ sidebarCollapsed ? '→' : '←' }}
        </button>
      </div>
      
      <nav class="sidebar-nav">
        <div class="nav-item active" @click="activeSection = 'overview'">
          <span class="nav-icon">📊</span>
          <span v-if="!sidebarCollapsed" class="nav-text">总览</span>
        </div>
        <div class="nav-item" @click="navigateTo('/map')">
          <span class="nav-icon">🗺️</span>
          <span v-if="!sidebarCollapsed" class="nav-text">地图</span>
        </div>
        <div class="nav-item" @click="showAnalysis">
          <span class="nav-icon">📈</span>
          <span v-if="!sidebarCollapsed" class="nav-text">分析</span>
        </div>
        <div class="nav-item" @click="showAlerts">
          <span class="nav-icon">🚨</span>
          <span v-if="!sidebarCollapsed" class="nav-text">警报</span>
          <span v-if="anomalyCount > 0" class="nav-badge">{{ anomalyCount }}</span>
        </div>
      </nav>
    </aside>

    <!-- 主内容区 -->
    <main class="main-content">
      <!-- 顶部栏 -->
      <header class="top-bar">
        <div class="top-bar-left">
          <h1 class="page-title">智慧城市环境监测平台</h1>
          <p class="page-subtitle">Urban Environment Intelligence System</p>
        </div>
        
        <div class="top-bar-right">
          <div class="search-box">
            <input 
              type="text" 
              v-model="searchQuery"
              placeholder="搜索传感器..."
              class="search-input"
            />
            <span class="search-icon">🔍</span>
          </div>
          
          <div class="notification-icon" @click="toggleNotifications">
            <span>🔔</span>
            <span v-if="notifications > 0" class="notification-dot"></span>
          </div>
        </div>
      </header>

      <!-- 统计卡片 -->
      <section class="stats-cards">
        <div class="stat-card gradient-1 clickable" @click="showSensorDetails">
          <div class="card-icon">📡</div>
          <div class="card-info">
            <div class="card-value">{{ sensorCount }}</div>
            <div class="card-label">在线传感器</div>
          </div>
          <div class="card-trend up">↑ 12%</div>
          <div class="card-action-hint">👁️ 点击查看详情</div>
        </div>
        
        <div class="stat-card gradient-2 clickable" @click="showAnomalyDetails">
          <div class="card-icon">⚠️</div>
          <div class="card-info">
            <div class="card-value">{{ anomalyCount }}</div>
            <div class="card-label">异常事件</div>
          </div>
          <div class="card-trend down">↓ 5%</div>
          <div class="card-action-hint">👁️ 点击查看详情</div>
        </div>
        
        <div class="stat-card gradient-3 clickable" @click="showPM25Details">
          <div class="card-icon">💨</div>
          <div class="card-info">
            <div class="card-value">{{ averagePM25 }}</div>
            <div class="card-label">平均PM2.5</div>
          </div>
          <div class="card-trend">→ 0%</div>
          <div class="card-action-hint">👁️ 点击查看详情</div>
        </div>
        
        <div class="stat-card gradient-4 clickable" @click="showUpdateDetails">
          <div class="card-icon">⏰</div>
          <div class="card-info">
            <div class="card-value">{{ currentTime }}</div>
            <div class="card-label">更新时间</div>
          </div>
          <div class="card-action-hint">👁️ 点击查看详情</div>
        </div>
      </section>

      <!-- 数据可视化图表 -->
      <section class="visualization-section">
        <div class="section-header">
          <h2>数据可视化分析</h2>
        </div>
        
        <div class="charts-container">
          <div class="chart-wrapper">
            <AirQualityChart 
              title="全国城市空气质量分析"
              :data="filteredSensors"
              :width="800"
              :height="400"
            />
          </div>
        </div>
      </section>

      <!-- 数据表格 -->
      <section class="data-section">
        <div class="section-header">
          <h2>实时传感器数据</h2>
          <div class="data-status" v-if="lastUpdateTime">
            <span class="status-indicator" :class="updateStatus">
              {{ getStatusIcon() }}
            </span>
            最后更新: {{ lastUpdateTime }}
            <button @click="toggleAutoUpdate" class="auto-update-btn" :class="{ active: autoUpdateEnabled }">
              {{ autoUpdateEnabled ? '🔄 自动更新' : '⏸️ 手动模式' }}
            </button>
          </div>
          <div class="section-controls">
            <div class="region-filter">
              <div class="cascader-container">
                <select v-model="selectedProvince" @change="onProvinceChange" class="location-select">
                  <option value="">全部省份</option>
                  <option value="北京市">北京市</option>
                  <option value="上海市">上海市</option>
                  <option value="广东省">广东省</option>
                  <option value="江苏省">江苏省</option>
                  <option value="浙江省">浙江省</option>
                  <option value="四川省">四川省</option>
                  <option value="湖北省">湖北省</option>
                  <option value="陕西省">陕西省</option>
                  <option value="山东省">山东省</option>
                </select>
                
                <select v-model="selectedCity" @change="onCityChange" class="location-select" :disabled="!selectedProvince">
                  <option value="">全部城市</option>
                  <option v-for="city in availableCities" :key="city" :value="city">{{ city }}</option>
                </select>
                
                <select v-model="selectedDistrict" @change="onDistrictChange" class="location-select" :disabled="!selectedCity">
                  <option value="">全部区县</option>
                  <option v-for="district in availableDistricts" :key="district" :value="district">{{ district }}</option>
                </select>
              </div>
              <span class="filter-icon">🌏</span>
            </div>
            <div class="section-actions">
              <button @click="refreshData" class="btn-refresh">🔄 刷新</button>
              <button @click="exportData" class="btn-export">📥 导出</button>
              <button @click="viewOnMap" class="btn-map">🗺️ 地图查看</button>
            </div>
          </div>
        </div>
        
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>设备ID</th>
                <th>PM2.5</th>
                <th>温度</th>
                <th>湿度</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sensor in filteredSensors" :key="sensor.id" @click="selectSensor(sensor)">
                <td>{{ sensor.id }}</td>
                <td>
                  <span :class="getPM25Class(sensor.pm25)">{{ sensor.pm25 }}</span>
                </td>
                <td>{{ sensor.temperature }}°C</td>
                <td>{{ sensor.humidity }}%</td>
                <td>
                  <span :class="['status', sensor.status === '正常' ? 'normal' : 'anomaly']">
                    {{ sensor.status }}
                  </span>
                </td>
                <td>{{ formatTime(sensor.lastUpdate) }}</td>
                <td>
                  <button @click.stop="viewDetails(sensor)" class="btn-action">详情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>

    <!-- 卡片详情模态框 -->
    <div v-if="showCardDetailModal" class="modal-overlay" @click.self="closeCardDetailModal">
      <div class="card-detail-modal">
        <div class="modal-header">
          <h3>{{ cardDetailTitle }}</h3>
          <button @click="closeCardDetailModal" class="modal-close">✕</button>
        </div>
        
        <div class="modal-body">
          <div v-if="cardDetailType === 'sensors'" class="detail-content">
            <div class="detail-section">
              <h4>📡 传感器在线状态</h4>
              <div class="sensor-grid">
                <div v-for="sensor in filteredSensors" :key="sensor.id" class="sensor-card">
                  <div class="sensor-header">
                    <span class="sensor-id">{{ sensor.id }}</span>
                    <span class="sensor-status" :class="sensor.status === '正常' ? 'status-online' : 'status-offline'">{{ sensor.status }}</span>
                  </div>
                  <div class="sensor-location">{{ sensor.city }} - {{ sensor.district }}</div>
                  <div class="sensor-data">
                    <span class="data-item">PM2.5: {{ sensor.pm25 }}μg/m³</span>
                    <span class="data-item">AQI: {{ sensor.aqi }}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="detail-section">
              <h4>📈 在线统计</h4>
              <div class="stats-summary">
                <div class="summary-item">
                  <span class="summary-label">总传感器:</span>
                  <span class="summary-value">{{ sensorCount }}个</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">正常运行:</span>
                  <span class="summary-value">{{ sensorCount - anomalyCount }}个</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">在线率:</span>
                  <span class="summary-value">{{ Math.round((sensorCount - anomalyCount) / sensorCount * 100) }}%</span>
                </div>
              </div>
            </div>
          </div>
          
          <div v-if="cardDetailType === 'anomaly'" class="detail-content">
            <div class="detail-section">
              <h4>⚠️ 异常传感器列表</h4>
              <div class="anomaly-list">
                <div v-for="sensor in anomalySensors" :key="sensor.id" class="anomaly-item">
                  <div class="anomaly-header">
                    <span class="anomaly-id">{{ sensor.id }}</span>
                    <span class="anomaly-level" :class="getAnomalyLevelClass(sensor.pm25)">{{ getAnomalyLevel(sensor.pm25) }}</span>
                  </div>
                  <div class="anomaly-location">{{ sensor.city }} - {{ sensor.district }}</div>
                  <div class="anomaly-details">
                    <div class="detail-row">
                      <span>PM2.5:</span>
                      <span class="value-dangerous">{{ sensor.pm25 }} μg/m³</span>
                    </div>
                    <div class="detail-row">
                      <span>AQI:</span>
                      <span class="value-dangerous">{{ sensor.aqi }}</span>
                    </div>
                    <div class="detail-row">
                      <span>建议:</span>
                      <span class="recommendation">{{ getRecommendation(sensor.pm25) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div v-if="cardDetailType === 'pm25'" class="detail-content">
            <div class="detail-section">
              <h4>💨 PM2.5数据分析</h4>
              <div class="pm25-analysis">
                <div class="analysis-chart">
                  <canvas ref="pm25ChartCanvas" width="400" height="200"></canvas>
                </div>
                <div class="analysis-stats">
                  <div class="stat-row">
                    <span class="stat-label">平均值:</span>
                    <span class="stat-value">{{ averagePM25 }} μg/m³</span>
                  </div>
                  <div class="stat-row">
                    <span class="stat-label">最高值:</span>
                    <span class="stat-value">{{ maxPM25 }} μg/m³</span>
                  </div>
                  <div class="stat-row">
                    <span class="stat-label">最低值:</span>
                    <span class="stat-value">{{ minPM25 }} μg/m³</span>
                  </div>
                  <div class="stat-row">
                    <span class="stat-label">超标率:</span>
                    <span class="stat-value">{{ exceedanceRate }}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div v-if="cardDetailType === 'update'" class="detail-content">
            <div class="detail-section">
              <h4>⏰ 系统更新状态</h4>
              <div class="update-info">
                <div class="update-item">
                  <span class="update-label">最后更新:</span>
                  <span class="update-value">{{ lastUpdateTime }}</span>
                </div>
                <div class="update-item">
                  <span class="update-label">更新状态:</span>
                  <span class="update-value" :class="updateStatus">{{ getUpdateStatusText() }}</span>
                </div>
                <div class="update-item">
                  <span class="update-label">更新间隔:</span>
                  <span class="update-value">{{ updateInterval }}秒</span>
                </div>
                <div class="update-item">
                  <span class="update-label">下次更新:</span>
                  <span class="update-value">{{ getNextUpdateTime() }}</span>
                </div>
              </div>
              
              <div class="update-controls">
                <button @click="refreshData" class="btn-update">🔄 立即更新</button>
                <button @click="toggleAutoUpdate" class="btn-toggle" :class="{ active: autoUpdateEnabled }">
                  {{ autoUpdateEnabled ? '⏸️ 暂停自动' : '▶️ 启动自动' }}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button @click="closeCardDetailModal" class="btn-close">关闭</button>
        </div>
      </div>
    </div>

    <!-- 传感器详情模态框 -->
    <div v-if="showDetailModal" class="modal-overlay" @click.self="closeDetailModal">
      <div class="detail-modal">
        <div class="modal-header">
          <h3>传感器详细信息</h3>
          <button @click="closeDetailModal" class="modal-close">✕</button>
        </div>
        
        <div class="modal-body" v-if="selectedSensorDetail">
          <!-- 基本信息 -->
          <div class="detail-section">
            <h4>📋 基本信息</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">设备ID</span>
                <span class="detail-value">{{ selectedSensorDetail.id }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">设备状态</span>
                <span class="detail-value" :class="['status-badge', selectedSensorDetail.status === '正常' ? 'status-normal' : 'status-anomaly']">
                  {{ selectedSensorDetail.status }}
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">安装位置</span>
                <span class="detail-value">{{ getLocation(selectedSensorDetail.id) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">安装日期</span>
                <span class="detail-value">{{ getInstallDate(selectedSensorDetail.id) }}</span>
              </div>
            </div>
          </div>

          <!-- 实时数据 -->
          <div class="detail-section">
            <h4>📊 实时监测数据</h4>
            <div class="sensor-data-cards">
              <div class="data-card pm25" :class="getPM25Class(selectedSensorDetail.pm25)">
                <div class="card-header">
                  <span class="card-icon">💨</span>
                  <span class="card-title">PM2.5</span>
                </div>
                <div class="card-value">
                  {{ selectedSensorDetail.pm25 }} <span class="unit">μg/m³</span>
                </div>
                <div class="card-status">{{ getPM25Status(selectedSensorDetail.pm25) }}</div>
              </div>
              
              <div class="data-card temperature">
                <div class="card-header">
                  <span class="card-icon">🌡️</span>
                  <span class="card-title">温度</span>
                </div>
                <div class="card-value">
                  {{ selectedSensorDetail.temperature }} <span class="unit">°C</span>
                </div>
                <div class="card-status">{{ getTemperatureStatus(selectedSensorDetail.temperature) }}</div>
              </div>
              
              <div class="data-card humidity">
                <div class="card-header">
                  <span class="card-icon">💧</span>
                  <span class="card-title">湿度</span>
                </div>
                <div class="card-value">
                  {{ selectedSensorDetail.humidity }} <span class="unit">%</span>
                </div>
                <div class="card-status">{{ getHumidityStatus(selectedSensorDetail.humidity) }}</div>
              </div>
            </div>
          </div>

          <!-- 24小时趋势 -->
          <div class="detail-section">
            <h4>📈 24小时数据趋势</h4>
            <div class="trend-container">
              <canvas ref="trendCanvas" width="600" height="200"></canvas>
            </div>
          </div>

          <!-- 设备信息 -->
          <div class="detail-section">
            <h4>🔧 设备技术信息</h4>
            <div class="tech-info">
              <div class="tech-row">
                <span class="tech-label">设备型号</span>
                <span class="tech-value">{{ getDeviceModel(selectedSensorDetail.id) }}</span>
              </div>
              <div class="tech-row">
                <span class="tech-label">固件版本</span>
                <span class="tech-value">{{ getFirmwareVersion(selectedSensorDetail.id) }}</span>
              </div>
              <div class="tech-row">
                <span class="tech-label">通信方式</span>
                <span class="tech-value">4G/WiFi</span>
              </div>
              <div class="tech-row">
                <span class="tech-label">上次维护</span>
                <span class="tech-value">{{ getLastMaintenance(selectedSensorDetail.id) }}</span>
              </div>
              <div class="tech-row">
                <span class="tech-label">电池电量</span>
                <span class="tech-value">{{ getBatteryLevel(selectedSensorDetail.id) }}%</span>
              </div>
              <div class="tech-row">
                <span class="tech-label">信号强度</span>
                <span class="tech-value">{{ getSignalStrength(selectedSensorDetail.id) }}</span>
              </div>
            </div>
          </div>

          <!-- 操作建议 -->
          <div class="detail-section">
            <h4>💡 操作建议</h4>
            <div class="recommendations">
              <div v-for="rec in getRecommendations(selectedSensorDetail)" :key="rec.type" 
                   class="recommendation" :class="rec.type">
                <span class="rec-icon">{{ rec.icon }}</span>
                <span class="rec-text">{{ rec.text }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button @click="navigateToMap(selectedSensorDetail)" class="btn-map">
            📍 在地图中查看
          </button>
          <button @click="downloadReport(selectedSensorDetail)" class="btn-report">
            📄 生成报告
          </button>
          <button @click="closeDetailModal" class="btn-close">
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { realTimeDataService, type RealTimeSensorData } from '@/services/realTimeDataService'
import { realTimeUpdateService } from '@/services/realTimeUpdateService'
import AirQualityChart from '@/components/AirQualityChart.vue'

const router = useRouter()

// 状态
const sidebarCollapsed = ref(false)
const activeSection = ref('overview')
const searchQuery = ref('')
const notifications = ref(2)
const sensorCount = ref(22)
const anomalyCount = ref(9)
const averagePM25 = ref(78.5)
const currentTime = ref('')

// 详情模态框状态
const showDetailModal = ref(false)
const selectedSensorDetail = ref(null)
const trendCanvas = ref(null)

// 卡片详情模态框状态
const showCardDetailModal = ref(false)
const cardDetailType = ref('')
const cardDetailTitle = ref('')
const pm25ChartCanvas = ref(null)

// 实时传感器数据
const sensors = ref<RealTimeSensorData[]>([])
const isLoading = ref(true)
const lastUpdateTime = ref('')

// 实时更新状态
const updateStatus = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')
const autoUpdateEnabled = ref(true)
const updateInterval = ref(60) // 秒
const nextUpdateTime = ref('')

// 三级联动筛选状态
const selectedProvince = ref('')
const selectedCity = ref('')
const selectedDistrict = ref('')
const filteredSensors = ref(sensors.value)

// 计算可用的城市和区县
const availableCities = computed(() => {
  if (!selectedProvince.value) return []
  const cities = [...new Set(sensors.value
    .filter(sensor => sensor.province === selectedProvince.value)
    .map(sensor => sensor.city))]
  return cities.sort()
})

const availableDistricts = computed(() => {
  if (!selectedCity.value) return []
  const districts = [...new Set(sensors.value
    .filter(sensor => sensor.province === selectedProvince.value && sensor.city === selectedCity.value)
    .map(sensor => sensor.district))]
  return districts.sort()
})

// 方法
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function toggleNotifications() {
  console.log('Toggle notifications')
}

function navigateTo(path: string) {
  router.push(path)
}

function getPM25Class(value: number): string {
  if (value > 150) return 'pm25-hazardous'
  if (value > 75) return 'pm25-unhealthy'
  if (value > 35) return 'pm25-moderate'
  return 'pm25-good'
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN')
}

function selectSensor(sensor: any) {
  console.log('Selected sensor:', sensor)
}

function viewDetails(sensor: any) {
  console.log('View details:', sensor)
  selectedSensorDetail.value = sensor
  showDetailModal.value = true
  
  // 延迟绘制趋势图，确保DOM已渲染
  setTimeout(() => {
    drawTrendChart()
  }, 100)
}

function closeDetailModal() {
  showDetailModal.value = false
  selectedSensorDetail.value = null
}

// 关闭卡片详情模态框
function closeCardDetailModal() {
  showCardDetailModal.value = false
  cardDetailType.value = ''
  cardDetailTitle.value = ''
}

// 显示传感器详情
function showSensorDetails() {
  cardDetailType.value = 'sensors'
  cardDetailTitle.value = '📡 在线传感器详情'
  showCardDetailModal.value = true
}

// 显示异常详情
function showAnomalyDetails() {
  cardDetailType.value = 'anomaly'
  cardDetailTitle.value = '⚠️ 异常事件详情'
  showCardDetailModal.value = true
}

// 显示PM2.5详情
function showPM25Details() {
  cardDetailType.value = 'pm25'
  cardDetailTitle.value = '💨 PM2.5数据分析'
  showCardDetailModal.value = true
  
  // 延迟绘制图表
  setTimeout(() => {
    drawPM25Chart()
  }, 100)
}

// 显示更新详情
function showUpdateDetails() {
  cardDetailType.value = 'update'
  cardDetailTitle.value = '⏰ 系统更新状态'
  showCardDetailModal.value = true
}

// 计算异常传感器
const anomalySensors = computed(() => {
  return filteredSensors.value.filter(sensor => sensor.status === '异常')
})

// 计算PM2.5统计数据
const maxPM25 = computed(() => {
  if (filteredSensors.value.length === 0) return 0
  return Math.max(...filteredSensors.value.map(s => s.pm25))
})

const minPM25 = computed(() => {
  if (filteredSensors.value.length === 0) return 0
  return Math.min(...filteredSensors.value.map(s => s.pm25))
})

const exceedanceRate = computed(() => {
  if (filteredSensors.value.length === 0) return 0
  const exceedCount = filteredSensors.value.filter(s => s.pm25 > 75).length
  return Math.round((exceedCount / filteredSensors.value.length) * 100)
})

// 获取异常等级
function getAnomalyLevel(pm25: number): string {
  if (pm25 > 250) return '严重污染'
  if (pm25 > 150) return '重度污染'
  if (pm25 > 115) return '中度污染'
  if (pm25 > 75) return '轻度污染'
  return '超标'
}

// 获取异常等级样式类
function getAnomalyLevelClass(pm25: number): string {
  if (pm25 > 250) return 'level-hazardous'
  if (pm25 > 150) return 'level-very-unhealthy'
  if (pm25 > 115) return 'level-unhealthy'
  if (pm25 > 75) return 'level-moderate'
  return 'level-slight'
}

// 获取建议
function getRecommendation(pm25: number): string {
  if (pm25 > 250) return '立即采取应急措施，停止户外活动'
  if (pm25 > 150) return '建议室内活动，佩戴防护口罩'
  if (pm25 > 115) return '减少户外运动，敏感人群停止户外活动'
  if (pm25 > 75) return '敏感人群减少户外活动'
  return '加强监测，关注变化趋势'
}

// 获取更新状态文本
function getUpdateStatusText(): string {
  const statusMap = {
    connecting: '连接中...',
    connected: '已连接',
    disconnected: '已断开',
    error: '连接错误'
  }
  return statusMap[updateStatus.value] || '未知状态'
}

// 获取下次更新时间
function getNextUpdateTime(): string {
  if (!autoUpdateEnabled.value) return '已暂停'
  const next = new Date(Date.now() + updateInterval.value * 1000)
  return next.toLocaleTimeString('zh-CN')
}

// 绘制PM2.5图表
function drawPM25Chart() {
  if (!pm25ChartCanvas.value) return
  
  const ctx = (pm25ChartCanvas.value as HTMLCanvasElement).getContext('2d')
  if (!ctx) return
  
  const width = 400
  const height = 200
  
  // 清除画布
  ctx.clearRect(0, 0, width, height)
  
  const data = filteredSensors.value.map(s => s.pm25).slice(0, 10) // 取前10个数据
  if (data.length === 0) return
  
  const maxValue = Math.max(...data, 100)
  const barWidth = width / data.length - 10
  const colors = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#8b5cf6']
  
  // 绘制柱状图
  data.forEach((value, index) => {
    const barHeight = (value / maxValue) * (height - 40)
    const x = index * (barWidth + 10) + 5
    const y = height - barHeight - 20
    
    // 根据PM2.5值选择颜色
    let colorIndex = 0
    if (value > 150) colorIndex = 4
    else if (value > 115) colorIndex = 3
    else if (value > 75) colorIndex = 2
    else if (value > 35) colorIndex = 1
    
    ctx.fillStyle = colors[colorIndex]
    ctx.fillRect(x, y, barWidth, barHeight)
    
    // 绘制数值
    ctx.fillStyle = '#374151'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(Math.round(value).toString(), x + barWidth / 2, y - 5)
  })
}

// 获取传感器位置
function getLocation(sensorId: string): string {
  const locations = {
    'SENSOR_001': '朝阳区建国门大街',
    'SENSOR_002': '海淀区中关村',
    'SENSOR_003': '西城区西单',
    'SENSOR_004': '东城区王府井',
    'SENSOR_005': '朝阳区国贸',
    'SENSOR_006': '海淀区五道口',
    'SENSOR_007': '丰台区方庄',
    'SENSOR_008': '石景山区八角',
    'SENSOR_009': '通州区潞河',
    'SENSOR_010': '昌平区回龙观',
    'SENSOR_011': '大兴区亦庄',
    'SENSOR_012': '顺义区后沙峪'
  }
  return locations[sensorId] || '未知位置'
}

// 获取安装日期
function getInstallDate(sensorId: string): string {
  const dates = {
    'SENSOR_001': '2024-01-15',
    'SENSOR_002': '2024-02-20',
    'SENSOR_003': '2024-01-25',
    'SENSOR_004': '2024-03-10',
    'SENSOR_005': '2024-02-15',
    'SENSOR_006': '2024-03-20',
    'SENSOR_007': '2024-01-30',
    'SENSOR_008': '2024-02-25',
    'SENSOR_009': '2024-03-05',
    'SENSOR_010': '2024-02-10',
    'SENSOR_011': '2024-03-15',
    'SENSOR_012': '2024-01-20'
  }
  return dates[sensorId] || '2024-01-01'
}

// 获取设备型号
function getDeviceModel(sensorId: string): string {
  const models = ['AQM-2000', 'AQM-2100', 'AQM-3000']
  return models[parseInt(sensorId.slice(-1)) % 3] + 'Pro'
}

// 获取固件版本
function getFirmwareVersion(sensorId: string): string {
  const versions = ['v2.1.3', 'v2.2.1', 'v2.1.5']
  return versions[parseInt(sensorId.slice(-1)) % 3]
}

// 获取上次维护时间
function getLastMaintenance(sensorId: string): string {
  const dates = ['2024-09-15', '2024-10-01', '2024-09-20']
  return dates[parseInt(sensorId.slice(-1)) % 3]
}

// 获取电池电量
function getBatteryLevel(sensorId: string): number {
  const levels = [85, 92, 78, 95, 88]
  return levels[parseInt(sensorId.slice(-1)) % 5]
}

// 获取信号强度
function getSignalStrength(sensorId: string): string {
  const strengths = ['强', '中', '弱']
  const level = parseInt(sensorId.slice(-1)) % 3
  return strengths[level] + ' (-' + (60 + level * 10) + 'dBm)'
}

// 获取PM2.5状态
function getPM25Status(value: number): string {
  if (value <= 35) return '优秀'
  if (value <= 75) return '良好'
  if (value <= 115) return '轻度污染'
  if (value <= 150) return '中度污染'
  return '重度污染'
}

// 获取温度状态
function getTemperatureStatus(value: number): string {
  if (value < 10) return '偏低'
  if (value > 35) return '偏高'
  return '正常'
}

// 获取湿度状态
function getHumidityStatus(value: number): string {
  if (value < 30) return '干燥'
  if (value > 80) return '潮湿'
  return '适宜'
}

// 获取操作建议
function getRecommendations(sensor: any) {
  const recommendations = []
  
  if (sensor.pm25 > 150) {
    recommendations.push({
      type: 'danger',
      icon: '🚨',
      text: '建议立即采取应急措施，减少户外活动'
    })
  } else if (sensor.pm25 > 100) {
    recommendations.push({
      type: 'warning',
      icon: '⚠️',
      text: '建议加强区域监测，关注污染源'
    })
  } else {
    recommendations.push({
      type: 'success',
      icon: '✅',
      text: '空气质量良好，继续保持监测'
    })
  }
  
  if (sensor.temperature > 35) {
    recommendations.push({
      type: 'warning',
      icon: '🌡️',
      text: '温度偏高，检查设备散热状况'
    })
  }
  
  if (sensor.humidity > 80) {
    recommendations.push({
      type: 'info',
      icon: '💧',
      text: '湿度较高，注意设备防护'
    })
  }
  
  return recommendations
}

// 绘制趋势图
function drawTrendChart() {
  if (!trendCanvas.value) return
  
  const ctx = trendCanvas.value.getContext('2d')
  const width = 600
  const height = 200
  
  // 清除画布
  ctx.clearRect(0, 0, width, height)
  
  // 生成24小时数据
  const hours = 24
  const data = []
  const baseValue = selectedSensorDetail.value.pm25
  
  for (let i = 0; i < hours; i++) {
    const variation = (Math.random() - 0.5) * 40
    const value = Math.max(0, baseValue + variation)
    data.push(value)
  }
  
  // 绘制背景网格
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 0.5
  
  // 水平网格线
  for (let i = 0; i <= 4; i++) {
    const y = (i / 4) * height
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  
  // 垂直网格线
  for (let i = 0; i <= 6; i++) {
    const x = (i / 6) * width
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  
  // 绘制趋势线
  const maxValue = Math.max(...data, 200)
  ctx.strokeStyle = '#4f46e5'
  ctx.lineWidth = 2
  ctx.beginPath()
  
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width
    const y = height - (data[i] / maxValue) * height
    
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  
  // 绘制数据点
  ctx.fillStyle = '#4f46e5'
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width
    const y = height - (data[i] / maxValue) * height
    
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  
  // 绘制Y轴标签
  ctx.fillStyle = '#6b7280'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'right'
  
  for (let i = 0; i <= 4; i++) {
    const value = (maxValue / 4) * (4 - i)
    const y = (i / 4) * height + 4
    ctx.fillText(Math.round(value).toString(), -5, y)
  }
}

// 导航到地图
function navigateToMap(sensor: any) {
  closeDetailModal()
  router.push('/map')
}

// 下载报告
function downloadReport(sensor: any) {
  const report = `
传感器详细报告
================

基本信息:
- 设备ID: ${sensor.id}
- 位置: ${getLocation(sensor.id)}
- 状态: ${sensor.status}
- 安装日期: ${getInstallDate(sensor.id)}

实时数据:
- PM2.5: ${sensor.pm25} μg/m³ (${getPM25Status(sensor.pm25)})
- 温度: ${sensor.temperature}°C (${getTemperatureStatus(sensor.temperature)})
- 湿度: ${sensor.humidity}% (${getHumidityStatus(sensor.humidity)})

设备信息:
- 型号: ${getDeviceModel(sensor.id)}
- 固件版本: ${getFirmwareVersion(sensor.id)}
- 电池电量: ${getBatteryLevel(sensor.id)}%
- 信号强度: ${getSignalStrength(sensor.id)}

生成时间: ${new Date().toLocaleString('zh-CN')}
  `
  
  const blob = new Blob([report], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sensor_${sensor.id}_report.txt`
  a.click()
  URL.revokeObjectURL(url)
}


function exportData() {
  console.log('Exporting data...')
  // 导出CSV功能
  const csv = 'DeviceID,PM2.5,Temperature,Humidity,Status\n' + 
    sensors.value.map(s => `${s.id},${s.pm25},${s.temperature},${s.humidity},${s.status}`).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sensor_data.csv'
  a.click()
}

function showAnalysis() {
  activeSection.value = 'analysis'
  alert('数据分析功能\n\n' +
    '📊 当前统计:\n' +
    `• 平均PM2.5: ${averagePM25.value} μg/m³\n` +
    `• 异常传感器: ${anomalyCount.value}个\n` +
    `• 在线传感器: ${sensorCount.value}个\n\n` +
    '📈 趋势分析:\n' +
    '• PM2.5呈上升趋势\n' +
    '• 东城区污染较严重\n' +
    '• 建议加强监测')
}

function showAlerts() {
  activeSection.value = 'alerts'
  const alertList = sensors.value.filter(s => s.status === '异常')
  let message = '⚠️ 异常警报列表\n\n'
  
  alertList.forEach(sensor => {
    message += `🚨 ${sensor.id}:\n`
    message += `   PM2.5: ${sensor.pm25} μg/m³\n`
    message += `   状态: ${sensor.pm25 > 150 ? '严重超标' : sensor.pm25 > 100 ? '中度超标' : '轻度超标'}\n`
    message += `   建议: ${sensor.pm25 > 150 ? '立即采取措施' : '加强监测'}\n\n`
  })
  
  alert(message)
}

function updateTime() {
  currentTime.value = new Date().toLocaleTimeString('zh-CN')
}

// 加载实时传感器数据
async function loadRealTimeData() {
  try {
    isLoading.value = true
    console.log('🔄 正在获取全国实时环境数据...')
    
    const realTimeData = await realTimeDataService.fetchNationalRealTimeData()
    sensors.value = realTimeData
    
    // 更新统计信息
    sensorCount.value = realTimeData.length
    anomalyCount.value = realTimeData.filter(s => s.status === '异常').length
    
    if (realTimeData.length > 0) {
      const sum = realTimeData.reduce((acc, s) => acc + s.pm25, 0)
      averagePM25.value = Math.round(sum / realTimeData.length * 10) / 10
    }
    
    lastUpdateTime.value = new Date().toLocaleString('zh-CN')
    
    // 应用当前筛选条件
    applyFilter()
    
    console.log(`✅ 成功加载 ${realTimeData.length} 个传感器的实时数据`)
    console.log(`📊 异常传感器: ${anomalyCount.value} 个, 平均PM2.5: ${averagePM25.value} μg/m³`)
    
  } catch (error) {
    console.error('❌ 加载实时数据失败:', error)
    // 显示用户友好的错误信息
    alert('获取实时数据失败，请检查网络连接后重试')
  } finally {
    isLoading.value = false
  }
}

// 刷新数据
async function refreshData() {
  await loadRealTimeData()
}

// 启动实时更新服务
function startRealTimeUpdates() {
  console.log('🚀 启动前端实时更新服务')
  
  // 订阅数据更新
  realTimeUpdateService.onDataUpdate((newData) => {
    sensors.value = newData
    applyFilter()
    lastUpdateTime.value = new Date().toLocaleString('zh-CN')
    console.log(`📊 数据已更新: ${newData.length}个城市`)
  })
  
  // 订阅状态更新
  realTimeUpdateService.onStatusChange((status) => {
    updateStatus.value = status
    updateStatusText()
  })
  
  // 启动服务
  realTimeUpdateService.start('normal')
}

// 停止实时更新
function stopRealTimeUpdates() {
  realTimeUpdateService.stop()
  autoUpdateEnabled.value = false
  console.log('⏹️ 实时更新已停止')
}

// 切换自动更新
function toggleAutoUpdate() {
  if (autoUpdateEnabled.value) {
    stopRealTimeUpdates()
  } else {
    autoUpdateEnabled.value = true
    startRealTimeUpdates()
  }
}

// 更新状态文本
function updateStatusText() {
  const statusMap = {
    connecting: '🔄 连接中...',
    connected: '🟢 已连接',
    disconnected: '⚪ 已断开',
    error: '🔴 连接错误'
  }
  
  // 这里可以更新状态显示，暂时使用console输出
  console.log(`状态更新: ${statusMap[updateStatus.value]}`)
}

// 获取状态图标
function getStatusIcon(): string {
  const iconMap = {
    connecting: '🔄',
    connected: '🟢',
    disconnected: '⚪',
    error: '🔴'
  }
  return iconMap[updateStatus.value] || '⚪'
}

// 三级联动筛选功能
function onProvinceChange() {
  selectedCity.value = ''
  selectedDistrict.value = ''
  applyFilter()
}

function onCityChange() {
  selectedDistrict.value = ''
  applyFilter()
}

function onDistrictChange() {
  applyFilter()
}

function applyFilter() {
  let filtered = sensors.value
  
  if (selectedProvince.value) {
    filtered = filtered.filter(sensor => sensor.province === selectedProvince.value)
  }
  
  if (selectedCity.value) {
    filtered = filtered.filter(sensor => sensor.city === selectedCity.value)
  }
  
  if (selectedDistrict.value) {
    filtered = filtered.filter(sensor => sensor.district === selectedDistrict.value)
  }
  
  filteredSensors.value = filtered
  
  // 更新统计数据
  sensorCount.value = filtered.length
  anomalyCount.value = filtered.filter(s => s.status === '异常').length
  
  if (filtered.length > 0) {
    const sum = filtered.reduce((acc, s) => acc + s.pm25, 0)
    averagePM25.value = Math.round(sum / filtered.length * 10) / 10
  } else {
    averagePM25.value = 0
  }
  
  const location = selectedDistrict.value || selectedCity.value || selectedProvince.value || '全国'
  console.log(`筛选位置: ${location}, 找到 ${filtered.length} 个传感器`)
}

// 在地图中查看筛选结果
function viewOnMap() {
  // 将筛选条件传递给地图
  const params = selectedDistrict.value ? `?district=${encodeURIComponent(selectedDistrict.value)}` : ''
  router.push(`/map${params}`)
  console.log(`跳转到地图查看${selectedDistrict.value || '全部'}区域`)
}

onMounted(async () => {
  updateTime()
  const timer = setInterval(updateTime, 1000)
  
  // 加载初始实时数据
  await loadRealTimeData()
  
  // 启动实时更新服务
  if (autoUpdateEnabled.value) {
    startRealTimeUpdates()
  }
  
  onUnmounted(() => {
    clearInterval(timer)
    // 停止实时更新服务
    realTimeUpdateService.stop()
  })
})
</script>

<style scoped>
/* 主布局 */
.advanced-dashboard {
  display: flex;
  min-height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #334155;
}

/* 侧边栏 */
.sidebar {
  width: 250px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-right: 1px solid #e5e7eb;
  transition: width 0.3s ease;
  display: flex;
  flex-direction: column;
}

.sidebar.collapsed {
  width: 70px;
}

/* 卡片可点击样式 */
.stat-card.clickable {
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.stat-card.clickable::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transition: left 0.5s;
}

.stat-card.clickable:hover::before {
  left: 100%;
}

.stat-card.clickable:hover {
  transform: translateY(-5px);
  box-shadow: 0 15px 35px rgba(0, 0, 0, 0.15);
}

.card-action-hint {
  position: absolute;
  bottom: 8px;
  right: 12px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.stat-card.clickable:hover .card-action-hint {
  opacity: 1;
}

/* 卡片详情模态框样式 */
.card-detail-modal {
  background: white;
  border-radius: 16px;
  max-width: 900px;
  width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
}

.sensor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.sensor-card {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

.sensor-card:hover {
  background: #f1f5f9;
  border-color: #d1d5db;
}

.sensor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.sensor-id {
  font-weight: 600;
  color: #1f2937;
}

.sensor-status {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-online {
  background: #dcfce7;
  color: #16a34a;
}

.status-offline {
  background: #fef2f2;
  color: #dc2626;
}

.sensor-location {
  color: #6b7280;
  font-size: 14px;
  margin-bottom: 12px;
}

.sensor-data {
  display: flex;
  gap: 16px;
}

.data-item {
  font-size: 13px;
  color: #374151;
}

.stats-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.summary-item {
  background: #f8fafc;
  padding: 16px;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.summary-label {
  color: #6b7280;
  font-weight: 500;
}

.summary-value {
  color: #1f2937;
  font-weight: 600;
  font-size: 18px;
}

/* 异常详情样式 */
.anomaly-list {
  margin-top: 16px;
}

.anomaly-item {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}

.anomaly-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.anomaly-id {
  font-weight: 600;
  color: #dc2626;
}

.anomaly-level {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.level-slight {
  background: #fef3c7;
  color: #d97706;
}

.level-moderate {
  background: #fed7aa;
  color: #ea580c;
}

.level-unhealthy {
  background: #fecaca;
  color: #dc2626;
}

.level-very-unhealthy {
  background: #fde2e8;
  color: #be185d;
}

.level-hazardous {
  background: #ede9fe;
  color: #7c3aed;
}

.anomaly-location {
  color: #6b7280;
  font-size: 14px;
  margin-bottom: 12px;
}

.anomaly-details {
  display: grid;
  gap: 8px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}

.detail-row:last-child {
  border-bottom: none;
}

.value-dangerous {
  color: #dc2626;
  font-weight: 600;
}

.recommendation {
  color: #059669;
  font-size: 13px;
  max-width: 300px;
  text-align: right;
}

/* PM2.5分析样式 */
.pm25-analysis {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 24px;
  margin-top: 16px;
}

.analysis-chart {
  background: #f8fafc;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.analysis-stats {
  display: grid;
  gap: 12px;
}

.stat-row {
  background: #f8fafc;
  padding: 12px 16px;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  color: #6b7280;
  font-weight: 500;
}

.stat-value {
  color: #1f2937;
  font-weight: 600;
}

/* 更新状态样式 */
.update-info {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.update-item {
  background: #f8fafc;
  padding: 16px;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.update-label {
  color: #6b7280;
  font-weight: 500;
}

.update-value {
  color: #1f2937;
  font-weight: 600;
}

.update-value.connected {
  color: #16a34a;
}

.update-value.disconnected {
  color: #dc2626;
}

.update-value.connecting {
  color: #d97706;
}

.update-controls {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  justify-content: center;
}

.btn-update, .btn-toggle {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-update {
  background: #3b82f6;
  color: white;
}

.btn-update:hover {
  background: #2563eb;
}

.btn-toggle {
  background: #6b7280;
  color: white;
}

.btn-toggle:hover {
  background: #4b5563;
}

.btn-toggle.active {
  background: #16a34a;
}

.btn-toggle.active:hover {
  background: #15803d;
}

.sidebar-header {
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #1f2937;
}

.logo-icon {
  font-size: 24px;
}

.logo-text {
  font-weight: 600;
  font-size: 18px;
}

.sidebar-toggle {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  color: #4b5563;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.sidebar-toggle:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* 导航 */
.sidebar-nav {
  flex: 1;
  padding: 20px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 15px 20px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.nav-item:hover {
  background: #f3f4f6;
  color: #1f2937;
}

.nav-item.active {
  background: #e0e7ff;
  color: #4f46e5;
  border-left: 3px solid #4f46e5;
}

.nav-icon {
  font-size: 20px;
  min-width: 24px;
}

.nav-text {
  font-size: 14px;
  font-weight: 500;
}

.nav-badge {
  position: absolute;
  right: 20px;
  background: #ef4444;
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 600;
}

/* 主内容 */
.main-content {
  flex: 1;
  overflow-y: auto;
}

/* 顶部栏 */
.top-bar {
  background: white;
  padding: 20px 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.page-title {
  color: #1f2937;
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.page-subtitle {
  color: #6b7280;
  margin: 5px 0 0 0;
  font-size: 14px;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 20px;
}

.search-box {
  position: relative;
  background: #f9fafb;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  padding: 10px 40px 10px 15px;
}

.search-input {
  background: transparent;
  border: none;
  color: #374151;
  width: 200px;
  outline: none;
}

.search-input::placeholder {
  color: #9ca3af;
}

.search-icon {
  position: absolute;
  right: 15px;
  top: 50%;
  transform: translateY(-50%);
}

.notification-icon {
  position: relative;
  cursor: pointer;
  font-size: 20px;
  color: #4b5563;
}

.notification-dot {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 10px;
  height: 10px;
  background: #ef4444;
  border-radius: 50%;
}

/* 统计卡片 */
.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  padding: 30px;
}

.stat-card {
  background: white;
  border-radius: 16px;
  padding: 25px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 20px;
  position: relative;
  overflow: hidden;
  transition: transform 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-5px);
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
}

.gradient-1::before { background: linear-gradient(90deg, #60a5fa, #93c5fd); }
.gradient-2::before { background: linear-gradient(90deg, #fca5a5, #fbbf24); }
.gradient-3::before { background: linear-gradient(90deg, #86efac, #bef264); }
.gradient-4::before { background: linear-gradient(90deg, #c4b5fd, #f9a8d4); }

.card-icon {
  font-size: 36px;
  min-width: 50px;
}

.card-info {
  flex: 1;
}

.card-value {
  color: #1f2937;
  font-size: 28px;
  font-weight: 600;
}

.card-label {
  color: #6b7280;
  font-size: 14px;
  margin-top: 5px;
}

.card-trend {
  font-size: 14px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
}

.card-trend.up {
  color: #22c55e;
}

.card-trend.down {
  color: #ef4444;
}

/* 数据表格 */
.data-section {
  padding: 30px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-header h2 {
  color: #1f2937;
  margin: 0;
  font-size: 20px;
}

.section-actions {
  display: flex;
  gap: 10px;
}

.btn-refresh, .btn-export {
  background: white;
  border: 1px solid #e5e7eb;
  color: #4b5563;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-refresh:hover, .btn-export:hover {
  background: #f3f4f6;
}

.data-table-wrapper {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th {
  background: #f9fafb;
  color: #374151;
  padding: 15px;
  text-align: left;
  font-weight: 600;
  font-size: 14px;
}

.data-table td {
  color: #1f2937;
  padding: 15px;
  border-top: 1px solid #e5e7eb;
}

.data-table tbody tr {
  cursor: pointer;
  transition: background 0.2s;
}

.data-table tbody tr:hover {
  background: #f9fafb;
}

/* 状态样式 */
.status {
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.status.normal {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status.anomaly {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.pm25-good { color: #22c55e; }
.pm25-moderate { color: #eab308; }
.pm25-unhealthy { color: #f97316; }
.pm25-hazardous { color: #ef4444; }

.btn-action {
  background: #4f46e5;
  border: 1px solid #4f46e5;
  color: white;
  padding: 5px 15px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-action:hover {
  background: #4338ca;
}

/* 响应式设计 */
/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.detail-modal {
  background: white;
  border-radius: 20px;
  max-width: 800px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  animation: slideIn 0.3s ease;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

@keyframes slideIn {
  from { 
    opacity: 0;
    transform: translateY(-50px) scale(0.9);
  }
  to { 
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 25px 30px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 20px 20px 0 0;
}

.modal-header h3 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #1f2937;
}

.modal-close {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  color: #6b7280;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.2s;
}

.modal-close:hover {
  background: #e5e7eb;
  color: #374151;
}

.modal-body {
  padding: 30px;
}

.detail-section {
  margin-bottom: 30px;
}

.detail-section h4 {
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.detail-item {
  background: #f9fafb;
  padding: 15px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.detail-label {
  display: block;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 5px;
  font-weight: 500;
}

.detail-value {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}
/* 数据卡片 */
.sensor-data-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 20px;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.data-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
}

.data-card.pm25-good::before { background: #22c55e; }
.data-card.pm25-moderate::before { background: #eab308; }
.data-card.pm25-unhealthy::before { background: #f97316; }
.data-card.pm25-hazardous::before { background: #ef4444; }

.data-card.temperature::before { background: #3b82f6; }
.data-card.humidity::before { background: #06b6d4; }

.data-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.card-icon {
  font-size: 24px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #6b7280;
}

.card-value {
  font-size: 28px;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 8px;
}

.unit {
  font-size: 16px;
  font-weight: 400;
  color: #6b7280;
}

.card-status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 20px;
  display: inline-block;
}

.data-card.pm25-good .card-status {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
}

.data-card.pm25-moderate .card-status {
  background: rgba(234, 179, 8, 0.1);
  color: #eab308;
}

.data-card.pm25-unhealthy .card-status {
  background: rgba(249, 115, 22, 0.1);
  color: #f97316;
}

.data-card.pm25-hazardous .card-status {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.data-card.temperature .card-status,
.data-card.humidity .card-status {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

/* 趋势图 */
.trend-container {
  background: #f9fafb;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e5e7eb;
}

/* 技术信息 */
.tech-info {
  background: #f9fafb;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e5e7eb;
}

.tech-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #e5e7eb;
}

.tech-row:last-child {
  border-bottom: none;
}

.tech-label {
  font-size: 14px;
  color: #6b7280;
  font-weight: 500;
}

.tech-value {
  font-size: 14px;
  color: #1f2937;
  font-weight: 600;
}

/* 操作建议 */
.recommendations {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.recommendation {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px;
  border-radius: 12px;
  font-size: 14px;
}

.recommendation.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #15803d;
}

.recommendation.warning {
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.2);
  color: #c2410c;
}

.recommendation.danger {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #dc2626;
}

.recommendation.info {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  color: #2563eb;
}

.rec-icon {
  font-size: 16px;
}

.rec-text {
  font-weight: 500;
}

/* 模态框底部 */
.modal-footer {
  padding: 20px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: #f9fafb;
  border-radius: 0 0 20px 20px;
}

.detail-section {
  margin-bottom: 24px;
}

.detail-section h4 {
  color: #1f2937;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e5e7eb;
}

.btn-map, .btn-report, .btn-close {
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-map {
  background: #4f46e5;
  color: white;
  border-color: #4f46e5;
}

.btn-map:hover {
  background: #4338ca;
}

.btn-report {
  background: #06b6d4;
  color: white;
  border-color: #06b6d4;
}

.btn-report:hover {
  background: #0891b2;
}

.btn-close {
  background: #f3f4f6;
  color: #6b7280;
  border-color: #d1d5db;
}

.btn-close:hover {
  background: #e5e7eb;
}

/* 数据状态样式 */
.data-status {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #6b7280;
  background: rgba(34, 197, 94, 0.1);
  padding: 8px 16px;
  border-radius: 12px;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.status-indicator {
  font-size: 12px;
  transition: all 0.3s ease;
}

.status-indicator.connecting {
  animation: spin 1s linear infinite;
}

.status-indicator.connected {
  animation: pulse 2s infinite;
}

.status-indicator.error {
  animation: shake 0.5s ease-in-out;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-2px); }
  75% { transform: translateX(2px); }
}

.auto-update-btn {
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}

.auto-update-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.auto-update-btn.active {
  background: #22c55e;
  color: white;
  border-color: #22c55e;
}

.auto-update-btn.active:hover {
  background: #16a34a;
}

/* 三级联动筛选样式 */
.section-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.region-filter {
  position: relative;
  display: flex;
  align-items: center;
  gap: 15px;
}

.cascader-container {
  display: flex;
  gap: 12px;
  align-items: center;
}

.location-select {
  background: white;
  border: 1px solid #e5e7eb;
  color: #1f2937;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  min-width: 120px;
  cursor: pointer;
  transition: all 0.2s;
  appearance: none;
}

.location-select:hover:not(:disabled) {
  border-color: #4f46e5;
}

.location-select:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.location-select:disabled {
  background: #f9fafb;
  color: #9ca3af;
  cursor: not-allowed;
  border-color: #e5e7eb;
}

.filter-icon {
  font-size: 18px;
  color: #4f46e5;
}

.btn-map {
  background: #22c55e;
  border: 1px solid #22c55e;
  color: white;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-map:hover {
  background: #16a34a;
}

/* 区域标签样式 */
.district-badge {
  background: rgba(79, 70, 229, 0.1);
  color: #4f46e5;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 筛选提示 */
.filter-status {
  background: rgba(34, 197, 94, 0.1);
  color: #16a34a;
  padding: 10px 15px;
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 20px;
  border-left: 3px solid #22c55e;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    z-index: 1000;
    height: 100vh;
    left: -250px;
    transition: left 0.3s;
  }
  
  .sidebar:not(.collapsed) {
    left: 0;
  }
  
  .stats-cards {
    grid-template-columns: 1fr;
  }
  
  .top-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
  }
  
  .detail-modal {
    width: 95%;
    max-height: 95vh;
  }
  
  .modal-body {
    padding: 20px;
  }
  
  .sensor-data-cards {
    grid-template-columns: 1fr;
  }
  
  .detail-grid {
    grid-template-columns: 1fr;
  }
  
  .modal-footer {
    flex-direction: column;
  }
  
  .trend-container canvas {
    width: 100% !important;
    height: auto !important;
  }
}
</style>
