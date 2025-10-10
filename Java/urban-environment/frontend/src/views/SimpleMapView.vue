<template>
  <div class="simple-map-view">
    <!-- 头部导航 -->
    <header class="map-header">
      <div class="header-content">
        <div class="brand-section">
          <router-link to="/dashboard" class="back-btn">← 返回仪表盘</router-link>
          <h1>🗺️ 智慧城市环境监测地图</h1>
          <p>Real-time Environmental Monitoring Map</p>
        </div>
        <div class="header-controls">
          <div class="legend">
            <div class="legend-item">
              <span class="legend-dot good"></span>
              <span>良好 (≤35)</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot moderate"></span>
              <span>中等 (36-75)</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot unhealthy"></span>
              <span>不健康 (76-150)</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot hazardous"></span>
              <span>危险 (>150)</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- 地图容器 -->
    <div class="map-container">
      <!-- 模拟地图背景 -->
      <div class="map-canvas">
        <div class="city-map">
          <!-- 城市区域背景 -->
          <div class="city-background">
            <div class="district" style="top: 20%; left: 20%; width: 25%; height: 30%;">
              <span class="district-name">朝阳区</span>
            </div>
            <div class="district" style="top: 20%; left: 50%; width: 30%; height: 25%;">
              <span class="district-name">海淀区</span>
            </div>
            <div class="district" style="top: 55%; left: 15%; width: 35%; height: 25%;">
              <span class="district-name">西城区</span>
            </div>
            <div class="district" style="top: 55%; left: 55%; width: 30%; height: 30%;">
              <span class="district-name">东城区</span>
            </div>
          </div>

          <!-- 传感器标记 -->
          <div 
            v-for="sensor in sensors" 
            :key="sensor.id"
            class="sensor-marker"
            :class="getSensorClass(sensor.pm25)"
            :style="{ 
              top: sensor.position.top + '%', 
              left: sensor.position.left + '%' 
            }"
            @click="selectSensor(sensor)"
          >
            <div class="marker-dot"></div>
            <div class="marker-pulse"></div>
            <div class="marker-label">{{ sensor.id }}</div>
          </div>

          <!-- 热力图区域 -->
          <div class="heatmap-overlay">
            <div 
              v-for="area in heatmapAreas" 
              :key="area.id"
              class="heat-area"
              :class="area.intensity"
              :style="{
                top: area.top + '%',
                left: area.left + '%',
                width: area.width + '%',
                height: area.height + '%'
              }"
            ></div>
          </div>
        </div>
      </div>

      <!-- 侧边信息面板 -->
      <div class="info-panel" :class="{ active: selectedSensor }">
        <div v-if="selectedSensor" class="sensor-info">
          <div class="info-header">
            <h3>{{ selectedSensor.id }}</h3>
            <button @click="closeSensorInfo" class="close-btn">✕</button>
          </div>
          
          <div class="info-content">
            <div class="info-section">
              <h4>📊 实时数据</h4>
              <div class="data-grid">
                <div class="data-item">
                  <span class="data-label">PM2.5</span>
                  <span class="data-value" :class="getPM25Class(selectedSensor.pm25)">
                    {{ selectedSensor.pm25 }} μg/m³
                  </span>
                </div>
                <div class="data-item">
                  <span class="data-label">温度</span>
                  <span class="data-value">{{ selectedSensor.temperature }}°C</span>
                </div>
                <div class="data-item">
                  <span class="data-label">湿度</span>
                  <span class="data-value">{{ selectedSensor.humidity }}%</span>
                </div>
                <div class="data-item">
                  <span class="data-label">状态</span>
                  <span class="data-value" :class="selectedSensor.status === '正常' ? 'status-good' : 'status-bad'">
                    {{ selectedSensor.status }}
                  </span>
                </div>
              </div>
            </div>
            
            <div class="info-section">
              <h4>📍 位置信息</h4>
              <p>经度: {{ selectedSensor.longitude }}</p>
              <p>纬度: {{ selectedSensor.latitude }}</p>
              <p>区域: {{ selectedSensor.district }}</p>
            </div>
            
            <div class="info-section">
              <h4>📈 24小时趋势</h4>
              <div class="trend-chart">
                <div class="chart-bars">
                  <div 
                    v-for="(value, index) in selectedSensor.trend" 
                    :key="index"
                    class="chart-bar"
                    :style="{ height: (value / 200 * 100) + '%' }"
                    :class="getPM25Class(value)"
                  ></div>
                </div>
                <div class="chart-labels">
                  <span>6h前</span>
                  <span>3h前</span>
                  <span>现在</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div v-else class="no-selection">
          <div class="empty-state">
            <div class="empty-icon">🎯</div>
            <h3>选择传感器</h3>
            <p>点击地图上的传感器标记查看详细信息</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部控制栏 -->
    <footer class="map-footer">
      <div class="footer-content">
        <div class="map-stats">
          <div class="stat">
            <span class="stat-label">总传感器:</span>
            <span class="stat-value">{{ sensors.length }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">在线:</span>
            <span class="stat-value">{{ onlineSensors }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">异常:</span>
            <span class="stat-value text-red">{{ anomalySensors }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">平均PM2.5:</span>
            <span class="stat-value">{{ averagePM25 }} μg/m³</span>
          </div>
        </div>
        
        <div class="map-controls">
          <button @click="refreshData" class="control-button">
            <span class="btn-icon">🔄</span>
            <span>刷新数据</span>
          </button>
          <button @click="exportData" class="control-button">
            <span class="btn-icon">📊</span>
            <span>导出数据</span>
          </button>
          <button @click="fullscreen" class="control-button">
            <span class="btn-icon">⛶</span>
            <span>全屏</span>
          </button>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

// 响应式数据
const selectedSensor = ref(null)

// 传感器数据
const sensors = ref([
  {
    id: 'SENSOR_001',
    pm25: 35.4,
    temperature: 23.5,
    humidity: 65.2,
    status: '正常',
    longitude: 116.4074,
    latitude: 39.9042,
    district: '朝阳区',
    position: { top: 30, left: 35 },
    trend: [42, 38, 35]
  },
  {
    id: 'SENSOR_002',
    pm25: 128.9,
    temperature: 26.1,
    humidity: 72.8,
    status: '异常',
    longitude: 116.3298,
    latitude: 39.9731,
    district: '海淀区',
    position: { top: 25, left: 65 },
    trend: [95, 112, 129]
  },
  {
    id: 'SENSOR_003',
    pm25: 42.1,
    temperature: 22.8,
    humidity: 58.4,
    status: '正常',
    longitude: 116.3683,
    latitude: 39.9015,
    district: '西城区',
    position: { top: 60, left: 25 },
    trend: [48, 45, 42]
  },
  {
    id: 'SENSOR_004',
    pm25: 89.7,
    temperature: 25.3,
    humidity: 69.1,
    status: '异常',
    longitude: 116.4171,
    latitude: 39.9075,
    district: '东城区',
    position: { top: 65, left: 70 },
    trend: [78, 83, 90]
  },
  {
    id: 'SENSOR_005',
    pm25: 28.3,
    temperature: 21.7,
    humidity: 55.9,
    status: '正常',
    longitude: 116.3912,
    latitude: 39.9549,
    district: '朝阳区',
    position: { top: 35, left: 45 },
    trend: [32, 30, 28]
  },
  {
    id: 'SENSOR_006',
    pm25: 156.2,
    temperature: 27.4,
    humidity: 74.3,
    status: '异常',
    longitude: 116.3134,
    latitude: 39.9279,
    district: '海淀区',
    position: { top: 40, left: 55 },
    trend: [142, 149, 156]
  }
])

// 热力图区域
const heatmapAreas = ref([
  { id: 1, top: 20, left: 50, width: 25, height: 20, intensity: 'high' },
  { id: 2, top: 35, left: 60, width: 20, height: 15, intensity: 'very-high' },
  { id: 3, top: 25, left: 30, width: 15, height: 25, intensity: 'medium' },
  { id: 4, top: 55, left: 15, width: 30, height: 20, intensity: 'low' },
  { id: 5, top: 60, left: 65, width: 20, height: 25, intensity: 'high' }
])

// 计算属性
const onlineSensors = computed(() => sensors.value.length)
const anomalySensors = computed(() => sensors.value.filter(s => s.status === '异常').length)
const averagePM25 = computed(() => {
  const sum = sensors.value.reduce((acc, s) => acc + s.pm25, 0)
  return Math.round(sum / sensors.value.length * 10) / 10
})

// 方法
function getSensorClass(pm25: number): string {
  if (pm25 > 150) return 'sensor-hazardous'
  if (pm25 > 75) return 'sensor-unhealthy'
  if (pm25 > 35) return 'sensor-moderate'
  return 'sensor-good'
}

function getPM25Class(pm25: number): string {
  if (pm25 > 150) return 'pm25-hazardous'
  if (pm25 > 75) return 'pm25-unhealthy'
  if (pm25 > 35) return 'pm25-moderate'
  return 'pm25-good'
}

function selectSensor(sensor: any) {
  selectedSensor.value = sensor
  console.log('选中传感器:', sensor.id)
}

function closeSensorInfo() {
  selectedSensor.value = null
}

function refreshData() {
  console.log('刷新地图数据')
  // 模拟数据更新
  sensors.value.forEach(sensor => {
    sensor.pm25 = Math.round((Math.random() * 200 + 10) * 10) / 10
    sensor.status = sensor.pm25 > 75 ? '异常' : '正常'
  })
}

function exportData() {
  console.log('导出地图数据')
  alert('数据导出功能开发中...')
}

function fullscreen() {
  console.log('切换全屏模式')
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    document.documentElement.requestFullscreen()
  }
}

onMounted(() => {
  console.log('SimpleMapView 组件已挂载')
  // 模拟实时更新
  setInterval(() => {
    if (Math.random() > 0.8) {
      refreshData()
    }
  }, 10000)
})
</script>

<style scoped>
.simple-map-view {
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* 头部导航 */
.map-header {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding: 20px 30px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.brand-section h1 {
  margin: 0 0 5px 0;
  font-size: 24px;
  font-weight: 600;
}

.brand-section p {
  margin: 0;
  opacity: 0.8;
  font-size: 14px;
}

.back-btn {
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 10px;
  display: inline-block;
  transition: color 0.2s ease;
}

.back-btn:hover {
  color: white;
}

.legend {
  display: flex;
  gap: 20px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.legend-dot.good { background: #22c55e; }
.legend-dot.moderate { background: #eab308; }
.legend-dot.unhealthy { background: #f97316; }
.legend-dot.hazardous { background: #ef4444; }

/* 地图容器 */
.map-container {
  height: calc(100vh - 140px);
  display: flex;
  position: relative;
}

.map-canvas {
  flex: 1;
  position: relative;
  background: #1a1a2e;
  border-radius: 20px;
  margin: 20px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.city-map {
  width: 100%;
  height: 100%;
  position: relative;
  background: linear-gradient(45deg, #16213e 0%, #0f3460 50%, #16213e 100%);
}

.city-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.district {
  position: absolute;
  background: rgba(255, 255, 255, 0.05);
  border: 2px dashed rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.district:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.district-name {
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  font-weight: 500;
}

/* 传感器标记 */
.sensor-marker {
  position: absolute;
  cursor: pointer;
  z-index: 10;
  transform: translate(-50%, -50%);
}

.marker-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  position: relative;
  z-index: 2;
  border: 2px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.marker-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: pulse 2s infinite;
  z-index: 1;
}

.marker-label {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.sensor-marker:hover .marker-label {
  opacity: 1;
}

.sensor-good .marker-dot { background: #22c55e; }
.sensor-good .marker-pulse { background: rgba(34, 197, 94, 0.3); }

.sensor-moderate .marker-dot { background: #eab308; }
.sensor-moderate .marker-pulse { background: rgba(234, 179, 8, 0.3); }

.sensor-unhealthy .marker-dot { background: #f97316; }
.sensor-unhealthy .marker-pulse { background: rgba(249, 115, 22, 0.3); }

.sensor-hazardous .marker-dot { background: #ef4444; }
.sensor-hazardous .marker-pulse { background: rgba(239, 68, 68, 0.3); }

/* 热力图 */
.heatmap-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

.heat-area {
  position: absolute;
  border-radius: 50%;
  filter: blur(20px);
}

.heat-area.low { background: rgba(34, 197, 94, 0.1); }
.heat-area.medium { background: rgba(234, 179, 8, 0.15); }
.heat-area.high { background: rgba(249, 115, 22, 0.2); }
.heat-area.very-high { background: rgba(239, 68, 68, 0.25); }

/* 信息面板 */
.info-panel {
  width: 350px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-left: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
  overflow-y: auto;
}

.sensor-info {
  padding: 20px;
}

.info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.info-header h3 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.info-section {
  margin-bottom: 25px;
}

.info-section h4 {
  margin: 0 0 15px 0;
  font-size: 14px;
  opacity: 0.8;
  font-weight: 600;
}

.data-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.data-item {
  background: rgba(255, 255, 255, 0.05);
  padding: 15px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.data-label {
  font-size: 12px;
  opacity: 0.7;
}

.data-value {
  font-size: 16px;
  font-weight: 600;
}

.pm25-good { color: #22c55e; }
.pm25-moderate { color: #eab308; }
.pm25-unhealthy { color: #f97316; }
.pm25-hazardous { color: #ef4444; }

.status-good { color: #22c55e; }
.status-bad { color: #ef4444; }

/* 趋势图 */
.trend-chart {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 15px;
}

.chart-bars {
  display: flex;
  align-items: end;
  gap: 8px;
  height: 60px;
  margin-bottom: 10px;
}

.chart-bar {
  flex: 1;
  border-radius: 2px;
  min-height: 4px;
  transition: all 0.3s ease;
}

.chart-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  opacity: 0.6;
}

.no-selection {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  text-align: center;
  opacity: 0.6;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 15px;
}

/* 底部控制栏 */
.map-footer {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding: 15px 30px;
}

.footer-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.map-stats {
  display: flex;
  gap: 30px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.stat-label {
  opacity: 0.7;
}

.stat-value {
  font-weight: 600;
}

.text-red {
  color: #ef4444;
}

.map-controls {
  display: flex;
  gap: 15px;
}

.control-button {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  transition: all 0.2s ease;
}

.control-button:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* 动画 */
@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.2); }
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .map-container {
    flex-direction: column;
  }
  
  .info-panel {
    width: 100%;
    height: 300px;
  }
  
  .header-content {
    flex-direction: column;
    gap: 15px;
  }
  
  .legend {
    flex-wrap: wrap;
    gap: 10px;
  }
}

@media (max-width: 768px) {
  .map-header {
    padding: 15px 20px;
  }
  
  .map-canvas {
    margin: 10px;
  }
  
  .footer-content {
    flex-direction: column;
    gap: 15px;
  }
  
  .map-stats {
    flex-wrap: wrap;
    gap: 15px;
  }
}
</style>
