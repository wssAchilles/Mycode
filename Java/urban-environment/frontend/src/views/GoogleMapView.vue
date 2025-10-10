<template>
  <div class="google-map-view">
    <!-- 头部导航 -->
    <header class="map-header">
      <div class="header-content">
        <div class="brand-section">
          <router-link to="/dashboard" class="back-btn">← 返回仪表盘</router-link>
          <h1>🗺️ 智慧城市环境监测地图</h1>
          <p>基于Google Maps的实时环境监测可视化</p>
        </div>
        <div class="header-controls">
          <div class="map-type-selector">
            <select v-model="mapType" @change="updateMapType" class="map-type-select">
              <option value="roadmap">道路地图</option>
              <option value="satellite">卫星地图</option>
              <option value="hybrid">混合地图</option>
              <option value="terrain">地形地图</option>
            </select>
          </div>
          <div class="layer-controls">
            <button 
              @click="toggleHeatmap" 
              class="layer-btn"
              :class="{ active: showHeatmap }"
            >
              <span class="btn-icon">🔥</span>
              <span>热力图</span>
            </button>
            <button 
              @click="toggleTraffic" 
              class="layer-btn"
              :class="{ active: showTraffic }"
            >
              <span class="btn-icon">🚦</span>
              <span>交通</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- 地图容器 -->
    <div class="map-container">
      <!-- Google Maps 容器 -->
      <div 
        ref="mapContainer" 
        id="google-map" 
        class="google-map"
        :class="{ loading: !mapLoaded }"
      ></div>
      
      <!-- 地图加载状态 -->
      <div v-if="!mapLoaded" class="map-loading">
        <div class="loading-spinner"></div>
        <p>正在加载Google Maps...</p>
      </div>

      <!-- 传感器信息面板 -->
      <div v-if="selectedSensor" class="sensor-info-panel">
        <div class="panel-header">
          <h3>{{ selectedSensor.id }}</h3>
          <button @click="closeSensorInfo" class="close-btn">✕</button>
        </div>
        <div class="panel-content">
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">AQI</span>
              <span class="info-value" :class="getAQIClass(selectedSensor.aqi)">
                {{ selectedSensor.aqi }}
              </span>
            </div>
            <div class="info-item">
              <span class="info-label">PM2.5</span>
              <span class="info-value" :class="getPM25Class(selectedSensor.pm25)">
                {{ selectedSensor.pm25 }} μg/m³
              </span>
            </div>
            <div class="info-item">
              <span class="info-label">温度</span>
              <span class="info-value">{{ selectedSensor.temperature }}°C</span>
            </div>
            <div class="info-item">
              <span class="info-label">湿度</span>
              <span class="info-value">{{ selectedSensor.humidity }}%</span>
            </div>
            <div class="info-item">
              <span class="info-label">状态</span>
              <span class="info-value" :class="selectedSensor.status === '正常' ? 'status-good' : 'status-bad'">
                {{ selectedSensor.status }}
              </span>
            </div>
          </div>
          <div class="location-info">
            <p><strong>省份:</strong> {{ selectedSensor.province }}</p>
            <p><strong>城市:</strong> {{ selectedSensor.city_chinese || selectedSensor.city }}</p>
            <p><strong>区域:</strong> {{ selectedSensor.district }}</p>
            <p><strong>位置:</strong> {{ selectedSensor.location }}</p>
            <p><strong>传感器名:</strong> {{ selectedSensor.sensorName || selectedSensor.id }}</p>
            <p><strong>坐标:</strong> {{ Number(selectedSensor.latitude).toFixed(6) }}, {{ Number(selectedSensor.longitude).toFixed(6) }}</p>
            <p><strong>数据源:</strong> {{ selectedSensor.data_source }}</p>
            <p><strong>最后更新:</strong> {{ formatTime(selectedSensor.lastUpdate) }}</p>
          </div>
          <div class="extended-data">
            <h4>详细环境数据</h4>
            <div class="extended-grid">
              <div class="extended-item">
                <span class="data-label">PM10:</span>
                <span class="data-value">{{ selectedSensor.pm10 || 'N/A' }} μg/m³</span>
              </div>
              <div class="extended-item">
                <span class="data-label">SO₂:</span>
                <span class="data-value">{{ selectedSensor.so2 || 'N/A' }} μg/m³</span>
              </div>
              <div class="extended-item">
                <span class="data-label">NO₂:</span>
                <span class="data-value">{{ selectedSensor.no2 || 'N/A' }} μg/m³</span>
              </div>
              <div class="extended-item">
                <span class="data-label">CO:</span>
                <span class="data-value">{{ selectedSensor.co || 'N/A' }} mg/m³</span>
              </div>
              <div class="extended-item">
                <span class="data-label">O₃:</span>
                <span class="data-value">{{ selectedSensor.o3 || 'N/A' }} μg/m³</span>
              </div>
              <div class="extended-item">
                <span class="data-label">风速:</span>
                <span class="data-value">{{ selectedSensor.windSpeed || 'N/A' }} m/s</span>
              </div>
              <div class="extended-item">
                <span class="data-label">风向:</span>
                <span class="data-value">{{ selectedSensor.windDirection || 'N/A' }}</span>
              </div>
              <div class="extended-item">
                <span class="data-label">气压:</span>
                <span class="data-value">{{ selectedSensor.pressure || 'N/A' }} hPa</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部统计栏 -->
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
            <span>刷新</span>
          </button>
          <button @click="centerMap" class="control-button">
            <span class="btn-icon">🎯</span>
            <span>居中</span>
          </button>
          <button @click="exportData" class="control-button">
            <span class="btn-icon">📊</span>
            <span>导出</span>
          </button>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, onUnmounted } from 'vue'
import { realTimeDataService, type RealTimeSensorData } from '@/services/realTimeDataService'

// 类型定义
interface SensorData {
  id: string
  city: string
  city_chinese: string
  province: string
  district: string
  location: string
  sensorName?: string
  pm25: number
  pm10?: number
  aqi: number
  temperature: number
  humidity: number
  so2?: number
  no2?: number
  co?: number
  o3?: number
  windSpeed?: number
  windDirection?: string
  pressure?: number
  status: string
  latitude: number
  longitude: number
  lastUpdate: string
  data_source: string
}

// 响应式数据
const mapContainer = ref<HTMLElement | null>(null)
const mapLoaded = ref(false)
const selectedSensor = ref<SensorData | null>(null)
const mapType = ref('roadmap')
const showHeatmap = ref(false)
const showTraffic = ref(false)

// Google Maps 对象
let map: google.maps.Map | null = null
let heatmap: google.maps.visualization.HeatmapLayer | null = null
let trafficLayer: google.maps.TrafficLayer | null = null
const markers: google.maps.Marker[] = []

// 默认中心点（中国中心）
const defaultCenter = { lat: 35.8617, lng: 104.1954 }

// 传感器数据 - 从实时数据服务获取
const sensors = ref<SensorData[]>([])

// 城市坐标映射
const CITY_COORDINATES: { [key: string]: { lat: number, lng: number } } = {
  // 直辖市
  '北京': { lat: 39.9042, lng: 116.4074 },
  '上海': { lat: 31.2304, lng: 121.4737 },
  '天津': { lat: 39.3434, lng: 117.3616 },
  '重庆': { lat: 29.4316, lng: 106.9123 },
  
  // 江苏省详细城市
  '南京': { lat: 32.0603, lng: 118.7969 },
  '苏州': { lat: 31.2989, lng: 120.5853 },
  '无锡': { lat: 31.4912, lng: 120.3119 },
  '常州': { lat: 31.7976, lng: 119.9460 },
  '镇江': { lat: 32.2044, lng: 119.4520 },
  '扬州': { lat: 32.4085, lng: 119.4327 },
  '泰州': { lat: 32.4849, lng: 119.9233 },
  '南通': { lat: 32.0116, lng: 120.8651 },
  '盐城': { lat: 33.3777, lng: 120.1397 },
  '连云港': { lat: 34.5963, lng: 119.1248 },
  '徐州': { lat: 34.2052, lng: 117.2845 },
  '淮安': { lat: 33.5975, lng: 119.0153 },
  '宿迁': { lat: 33.9520, lng: 118.2757 },
  
  // 其他省份主要城市
  '广州': { lat: 23.1291, lng: 113.2644 },
  '深圳': { lat: 22.5431, lng: 114.0579 },
  '杭州': { lat: 30.2741, lng: 120.1551 },
  '成都': { lat: 30.5728, lng: 104.0668 },
  '武汉': { lat: 30.5928, lng: 114.3055 },
  '西安': { lat: 34.3416, lng: 108.9398 },
  '沈阳': { lat: 41.8057, lng: 123.4315 },
  '青岛': { lat: 36.0671, lng: 120.3826 },
  '大连': { lat: 38.9140, lng: 121.6147 },
  '厦门': { lat: 24.4798, lng: 118.0819 },
  '昆明': { lat: 25.0389, lng: 102.7183 },
  '长沙': { lat: 28.2282, lng: 112.9388 },
  '郑州': { lat: 34.7466, lng: 113.6254 },
  '济南': { lat: 36.6512, lng: 117.1201 },
  '合肥': { lat: 31.8206, lng: 117.2272 },
  '南昌': { lat: 28.6820, lng: 115.8583 },
  '福州': { lat: 26.0745, lng: 119.2965 },
  '海口': { lat: 20.0458, lng: 110.3417 },
  '哈尔滨': { lat: 45.8038, lng: 126.5349 },
  '长春': { lat: 43.8171, lng: 125.3235 },
  '石家庄': { lat: 38.0428, lng: 114.5149 },
  '太原': { lat: 37.8706, lng: 112.5489 },
  '呼和浩特': { lat: 40.8414, lng: 111.7516 },
  '兰州': { lat: 36.0611, lng: 103.8343 },
  '西宁': { lat: 36.6171, lng: 101.7782 },
  '银川': { lat: 38.4872, lng: 106.2309 },
  '乌鲁木齐': { lat: 43.8256, lng: 87.6168 },
  '拉萨': { lat: 29.6625, lng: 91.1146 },
  '贵阳': { lat: 26.6470, lng: 106.6302 }
}

// 南京市详细区域坐标
const NANJING_DISTRICTS: { [key: string]: { lat: number, lng: number } } = {
  '玄武区': { lat: 32.0507, lng: 118.7973 },
  '秦淮区': { lat: 32.0353, lng: 118.7973 },
  '建邺区': { lat: 32.0037, lng: 118.7209 },
  '鼓楼区': { lat: 32.0663, lng: 118.7697 },
  '浦口区': { lat: 32.0588, lng: 118.6278 },
  '栖霞区': { lat: 32.0947, lng: 118.9066 },
  '雨花台区': { lat: 31.9919, lng: 118.7797 },
  '江宁区': { lat: 31.9523, lng: 118.8400 },
  '六合区': { lat: 32.3426, lng: 118.8273 },
  '溧水区': { lat: 31.6534, lng: 119.0286 },
  '高淳区': { lat: 31.3269, lng: 118.8756 }
}

// 加载实时传感器数据
async function loadSensorData() {
  try {
    // 首先尝试加载南京详细数据
    const nanjingResponse = await fetch('/data/nanjing_air_quality.json')
    if (nanjingResponse.ok) {
      const nanjingData = await nanjingResponse.json()
      console.log(`加载南京市详细数据: ${nanjingData.total_sensors}个传感器`)
      
      // 转换数据格式并添加坐标
      const nanjingSensors = nanjingData.sensors.map((sensor: any) => ({
        id: sensor.id,
        city: sensor.city,
        city_chinese: sensor.city,
        province: sensor.province,
        district: sensor.district,
        location: sensor.location,
        sensorName: sensor.sensorName,
        pm25: parseFloat(sensor.pm25) || 0,
        aqi: parseInt(sensor.aqi) || 50,
        temperature: parseFloat(sensor.temperature) || 20,
        humidity: parseInt(sensor.humidity) || 60,
        so2: parseFloat(sensor.so2) || 0,
        no2: parseFloat(sensor.no2) || 0,
        co: parseFloat(sensor.co) || 0,
        o3: parseFloat(sensor.o3) || 0,
        pm10: parseFloat(sensor.pm10) || 0,
        windSpeed: parseFloat(sensor.windSpeed) || 0,
        windDirection: sensor.windDirection || 'N',
        pressure: parseFloat(sensor.pressure) || 1013,
        status: sensor.status || '正常',
        latitude: parseFloat(sensor.latitude),
        longitude: parseFloat(sensor.longitude),
        lastUpdate: sensor.lastUpdate || sensor.timestamp,
        data_source: '南京市IQAir数据'
      }))
      
      sensors.value = nanjingSensors
      return
    }

    // 降级方案：尝试加载通用实时数据
    const response = await fetch('/data/current_air_quality.json')
    if (response.ok) {
      const data = await response.json()
      console.log(`加载通用数据: ${data.total_cities}个城市`)
      
      // 转换数据格式并添加坐标
      const mappedSensors = data.cities?.map((city: any, index: number) => {
        const coords = CITY_COORDINATES[city.city_chinese] || { lat: 32.0603, lng: 118.7969 }
        return {
          id: city.id || `SENSOR_${(index + 1).toString().padStart(3, '0')}`,
          city: city.city || city.city_chinese,
          city_chinese: city.city_chinese,
          province: city.province,
          district: city.district,
          location: city.location,
          pm25: city.pm25,
          aqi: city.aqi,
          temperature: city.temperature,
          humidity: city.humidity,
          status: city.status,
          latitude: coords.lat + (Math.random() - 0.5) * 0.01,
          longitude: coords.lng + (Math.random() - 0.5) * 0.01,
          lastUpdate: city.lastUpdate,
          data_source: city.data_source || 'Real_Time_API'
        }
      }) || []
      
      sensors.value = mappedSensors
    } else {
      console.warn('无法加载传感器数据，使用默认数据')
      generateDefaultSensors()
    }
  } catch (error) {
    console.error('加载传感器数据失败:', error)
    generateDefaultSensors()
  }
}

// 生成默认传感器数据
function generateDefaultSensors() {
  const defaultSensors = Object.entries(CITY_COORDINATES).slice(0, 10).map(([city, coords], index) => ({
    id: `DEFAULT_${String(index + 1).padStart(3, '0')}`,
    city: city,
    city_chinese: city,
    province: city.includes('北京') ? '北京市' : city.includes('上海') ? '上海市' : '江苏省',
    district: `${city}市区`,
    location: `${city}监测站`,
    pm25: Math.round((50 + Math.random() * 100) * 10) / 10,
    aqi: Math.round(60 + Math.random() * 80),
    temperature: Math.round((18 + Math.random() * 8) * 10) / 10,
    humidity: Math.round(55 + Math.random() * 30),
    status: Math.random() > 0.7 ? '异常' : '正常',
    latitude: coords.lat + (Math.random() - 0.5) * 0.005,
    longitude: coords.lng + (Math.random() - 0.5) * 0.005,
    lastUpdate: new Date().toISOString(),
    data_source: 'Default_Generated'
  }))
  
  sensors.value = defaultSensors
  console.log(`生成默认传感器数据: ${defaultSensors.length}个`)
}

// 计算属性
const onlineSensors = computed(() => sensors.value.length)
const anomalySensors = computed(() => sensors.value.filter(s => s.status === '异常').length)
const averagePM25 = computed(() => {
  if (sensors.value.length === 0) return 0
  const sum = sensors.value.reduce((acc, s) => acc + s.pm25, 0)
  return Math.round(sum / sensors.value.length * 10) / 10
})

// 方法
function getPM25Class(pm25: number): string {
  if (pm25 > 150) return 'pm25-hazardous'
  if (pm25 > 75) return 'pm25-unhealthy'
  if (pm25 > 35) return 'pm25-moderate'
  return 'pm25-good'
}

function getAQIClass(aqi: number): string {
  if (aqi > 200) return 'aqi-hazardous'
  if (aqi > 150) return 'aqi-unhealthy'
  if (aqi > 100) return 'aqi-moderate'
  if (aqi > 50) return 'aqi-good'
  return 'aqi-excellent'
}

function getMarkerColor(sensor: SensorData): string {
  const aqi = sensor.aqi || (sensor.pm25 * 1.5)
  if (aqi > 150) return '#ef4444' // 红色 - 危险
  if (aqi > 100) return '#f97316'  // 橙色 - 不健康
  if (aqi > 50) return '#eab308'   // 黄色 - 中等
  return '#22c55e' // 绿色 - 良好
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

// 等待Google Maps API加载
const waitForGoogleMaps = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve()
      return
    }

    let attempts = 0
    const maxAttempts = 50

    const checkGoogle = () => {
      attempts++
      if (window.google && window.google.maps) {
        resolve()
      } else if (attempts >= maxAttempts) {
        reject(new Error('Google Maps API加载超时'))
      } else {
        setTimeout(checkGoogle, 100)
      }
    }

    checkGoogle()
  })
}

// 初始化Google地图
const initGoogleMap = () => {
  if (!mapContainer.value || !window.google) {
    console.error('Google Maps API未加载或地图容器不存在')
    return
  }

  try {
    map = new google.maps.Map(mapContainer.value, {
      center: defaultCenter,
      zoom: 11,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ]
    })

    mapLoaded.value = true
    console.log('Google Maps初始化成功')

    // 添加传感器标记
    addSensorMarkers()

    // 初始化热力图层
    if (window.google.maps.visualization) {
      initHeatmapLayer()
    }

    // 初始化交通图层
    initTrafficLayer()

  } catch (error) {
    console.error('初始化Google Maps失败:', error)
    mapLoaded.value = false
  }
}

// 添加传感器标记
const addSensorMarkers = () => {
  if (!map) return

  // 清除现有标记
  markers.forEach(marker => marker.setMap(null))
  markers.length = 0

  sensors.value.forEach(sensor => {
    const marker = new google.maps.Marker({
      position: { lat: sensor.latitude, lng: sensor.longitude },
      map: map,
      title: `${sensor.id} - ${sensor.location}\nAQI: ${sensor.aqi} PM2.5: ${sensor.pm25} μg/m³`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: sensor.status === '异常' ? 15 : 12,
        fillColor: getMarkerColor(sensor),
        fillOpacity: 0.8,
        strokeColor: sensor.status === '异常' ? '#ffffff' : '#333333',
        strokeWeight: sensor.status === '异常' ? 3 : 2
      }
    })

    // 添加点击事件
    marker.addListener('click', () => {
      selectedSensor.value = sensor
      map?.setCenter({ lat: sensor.latitude, lng: sensor.longitude })
    })

    markers.push(marker)
  })
}

// 初始化热力图层
const initHeatmapLayer = () => {
  if (!map || !window.google.maps.visualization) return

  const heatmapData = sensors.value.map(sensor => ({
    location: new google.maps.LatLng(sensor.latitude, sensor.longitude),
    weight: sensor.pm25
  }))

  heatmap = new google.maps.visualization.HeatmapLayer({
    data: heatmapData,
    map: null, // 初始时不显示
    radius: 50,
    opacity: 0.6
  })
}

// 初始化交通图层
const initTrafficLayer = () => {
  if (!map) return
  trafficLayer = new google.maps.TrafficLayer()
}

// 更新地图类型
const updateMapType = () => {
  if (map) {
    map.setMapTypeId(mapType.value as google.maps.MapTypeId)
  }
}

// 切换热力图
const toggleHeatmap = () => {
  if (!heatmap) return
  
  showHeatmap.value = !showHeatmap.value
  heatmap.setMap(showHeatmap.value ? map : null)
}

// 切换交通图层
const toggleTraffic = () => {
  if (!trafficLayer) return
  
  showTraffic.value = !showTraffic.value
  trafficLayer.setMap(showTraffic.value ? map : null)
}

// 关闭传感器信息
const closeSensorInfo = () => {
  selectedSensor.value = null
}

// 刷新数据
const refreshData = async () => {
  console.log('刷新传感器数据')
  await loadSensorData()
  addSensorMarkers()
  
  if (heatmap && showHeatmap.value) {
    const heatmapData = sensors.value.map(sensor => ({
      location: new google.maps.LatLng(sensor.latitude, sensor.longitude),
      weight: sensor.aqi || sensor.pm25 * 1.5
    }))
    heatmap.setData(heatmapData)
  }
}

// 地图居中
const centerMap = () => {
  if (map) {
    map.setCenter(defaultCenter)
    map.setZoom(11)
  }
}

// 导出数据
const exportData = () => {
  console.log('导出地图数据')
  const csvContent = 'data:text/csv;charset=utf-8,' 
    + 'SensorID,City,District,Location,AQI,PM2.5,Temperature,Humidity,Status,Latitude,Longitude,DataSource,LastUpdate\n'
    + sensors.value.map(s => 
        `${s.id},${s.city_chinese},${s.district},${s.location},${s.aqi},${s.pm25},${s.temperature},${s.humidity},${s.status},${s.latitude},${s.longitude},${s.data_source},${s.lastUpdate}`
      ).join('\n')
  
  const encodedUri = encodeURI(csvContent)
  const link = document.createElement('a')
  link.setAttribute('href', encodedUri)
  link.setAttribute('download', 'enhanced_sensor_data.csv')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// 生命周期
onMounted(async () => {
  console.log('GoogleMapView组件已挂载')
  
  try {
    // 先加载传感器数据
    await loadSensorData()
    
    // 等待Google Maps API加载
    await waitForGoogleMaps()
    
    // 延迟初始化以确保DOM准备就绪
    await nextTick()
    setTimeout(() => {
      initGoogleMap()
    }, 100)
    
  } catch (error) {
    console.error('加载Google Maps失败:', error)
    mapLoaded.value = false
  }
})

onUnmounted(() => {
  // 清理地图资源
  if (map) {
    markers.forEach(marker => marker.setMap(null))
    if (heatmap) heatmap.setMap(null)
    if (trafficLayer) trafficLayer.setMap(null)
  }
})

// 声明全局类型
declare global {
  interface Window {
    google: typeof google
  }
}
</script>

<style scoped>
.google-map-view {
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
  z-index: 1000;
  position: relative;
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

.header-controls {
  display: flex;
  align-items: center;
  gap: 20px;
}

.map-type-select {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
}

.map-type-select option {
  background: #333;
  color: white;
}

.layer-controls {
  display: flex;
  gap: 10px;
}

.layer-btn {
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

.layer-btn:hover,
.layer-btn.active {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
}

/* 地图容器 */
.map-container {
  height: calc(100vh - 140px);
  position: relative;
  margin: 20px;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.google-map {
  width: 100%;
  height: 100%;
  transition: opacity 0.3s ease;
}

.google-map.loading {
  opacity: 0.5;
}

/* 加载状态 */
.map-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  z-index: 1000;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top: 4px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 15px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 传感器信息面板 */
.sensor-info-panel {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 300px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(15px);
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  color: #333;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
  color: #333;
}

.close-btn {
  background: rgba(0, 0, 0, 0.1);
  border: none;
  color: #666;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.2);
}

.panel-content {
  padding: 20px;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  margin-bottom: 15px;
}

.info-item {
  background: rgba(0, 0, 0, 0.05);
  padding: 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.info-value {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.pm25-good { color: #22c55e; }
.pm25-moderate { color: #eab308; }
.pm25-unhealthy { color: #f97316; }
.pm25-hazardous { color: #ef4444; }

.status-good { color: #22c55e; }
.status-bad { color: #ef4444; }

.location-info {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
}

.location-info p {
  margin: 5px 0;
}

/* 扩展传感器数据面板 */
.extended-data {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #e5e7eb;
}

.extended-data h4 {
  margin: 0 0 15px 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.extended-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.extended-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.data-label {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

.data-value {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

/* 底部统计栏 */
.map-footer {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding: 15px 30px;
  position: relative;
  z-index: 1000;
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

/* 响应式设计 */
@media (max-width: 1024px) {
  .sensor-info-panel {
    position: relative;
    top: auto;
    right: auto;
    width: 100%;
    margin: 10px;
  }
  
  .header-content {
    flex-direction: column;
    gap: 15px;
  }
}

@media (max-width: 768px) {
  .map-header {
    padding: 15px 20px;
  }
  
  .map-container {
    margin: 10px;
    height: calc(100vh - 120px);
  }
  
  .footer-content {
    flex-direction: column;
    gap: 15px;
  }
  
  .map-stats {
    flex-wrap: wrap;
    gap: 15px;
  }
  
  .header-controls {
    flex-direction: column;
    gap: 10px;
  }
}
</style>
