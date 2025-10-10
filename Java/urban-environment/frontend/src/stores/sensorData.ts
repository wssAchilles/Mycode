import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SensorData } from '../services/websocket'

export interface HeatmapData {
  lat: number
  lng: number
  weight: number
}

export const useSensorDataStore = defineStore('sensorData', () => {
  // 状态
  const latestData = ref<SensorData[]>([])
  const filteredData = ref<SensorData[]>([])
  const heatmapData = ref<HeatmapData[]>([])
  const isLoading = ref(false)
  const isConnected = ref(false)
  const error = ref<string | null>(null)
  const activeFilters = ref<any>(null)

  // 初始化测试数据
  const initTestData = () => {
    const testData: SensorData[] = [
      {
        id: 1,
        deviceId: "SENSOR_001",
        pm25: 45.2,
        temperature: 23.5,
        humidity: 65.2,
        latitude: 39.9042,
        longitude: 116.4074,
        timestamp: new Date().toISOString(),
        isAnomaly: true,
        anomalyScore: 0.75,
        confidence: 0.82
      },
      {
        id: 2,
        deviceId: "SENSOR_002",
        pm25: 28.1,
        temperature: 24.1,
        humidity: 58.7,
        latitude: 39.9123,
        longitude: 116.4456,
        timestamp: new Date().toISOString(),
        isAnomaly: false,
        anomalyScore: 0.23,
        confidence: 0.45
      },
      {
        id: 3,
        deviceId: "SENSOR_003",
        pm25: 89.7,
        temperature: 22.8,
        humidity: 71.3,
        latitude: 39.8956,
        longitude: 116.3891,
        timestamp: new Date().toISOString(),
        isAnomaly: true,
        anomalyScore: 0.91,
        confidence: 0.95
      },
      {
        id: 4,
        deviceId: "SENSOR_004",
        pm25: 35.6,
        temperature: 25.3,
        humidity: 62.8,
        latitude: 39.9087,
        longitude: 116.3975,
        timestamp: new Date().toISOString(),
        isAnomaly: false,
        anomalyScore: 0.18,
        confidence: 0.38
      },
      {
        id: 5,
        deviceId: "SENSOR_005",
        pm25: 72.3,
        temperature: 21.9,
        humidity: 68.4,
        latitude: 39.9156,
        longitude: 116.4234,
        timestamp: new Date().toISOString(),
        isAnomaly: true,
        anomalyScore: 0.83,
        confidence: 0.88
      }
    ];
    
    setData(testData);
    setConnectionStatus(true);
    console.log('已初始化测试数据', testData.length, '条');
  };

  // 在store创建时初始化测试数据
  if (latestData.value.length === 0) {
    initTestData();
  }

  // 计算属性：异常数据统计
  const anomalyStats = computed(() => {
    const total = latestData.value.length
    const anomalies = latestData.value.filter(data => data.isAnomaly).length
    const rate = total > 0 ? (anomalies / total) * 100 : 0
    
    return {
      total,
      anomalies,
      rate: Math.round(rate * 100) / 100
    }
  })

  // 计算属性：高风险异常数据
  const highRiskAnomalies = computed(() => {
    return latestData.value
      .filter(data => data.isAnomaly && (data.confidence || 0) > 0.7)
      .sort((a, b) => (b.anomalyScore || 0) - (a.anomalyScore || 0))
  })

  // 计算属性：获取独特设备的数量
  const deviceCount = computed(() => {
    const uniqueDevices = new Set(latestData.value.map(data => data.deviceId))
    return uniqueDevices.size
  })

  // 计算属性：获取平均PM2.5值
  const averagePM25 = computed(() => {
    if (latestData.value.length === 0) return 0
    const sum = latestData.value.reduce((acc, data) => acc + data.pm25, 0)
    return Number((sum / latestData.value.length).toFixed(2))
  })

  // 动作：更新或添加传感器数据
  const updateData = (newData: SensorData) => {
    try {
      // 查找是否已存在相同deviceId的数据
      const existingIndex = latestData.value.findIndex(
        data => data.deviceId === newData.deviceId
      )

      if (existingIndex !== -1) {
        // 如果存在，更新现有数据
        latestData.value[existingIndex] = newData
        console.log(`更新设备 ${newData.deviceId} 的数据:`, newData)
      } else {
        // 如果不存在，添加新数据
        latestData.value.push(newData)
        console.log(`添加新设备 ${newData.deviceId} 的数据:`, newData)
      }

      // 清除错误状态
      error.value = null
    } catch (err) {
      console.error('更新传感器数据时发生错误:', err)
      error.value = err instanceof Error ? err.message : 'Unknown error'
    }
  }

  // 动作：批量设置数据（用于初始加载）
  const setData = (data: SensorData[]) => {
    latestData.value = data
    error.value = null
    console.log('批量设置传感器数据:', data.length, '条记录')
  }

  // 动作：清空所有数据
  const clearData = () => {
    latestData.value = []
    error.value = null
    console.log('已清空所有传感器数据')
  }

  // 动作：设置连接状态
  const setConnectionStatus = (connected: boolean) => {
    isConnected.value = connected
    if (connected) {
      error.value = null
    }
  }

  // 动作：设置错误信息
  const setError = (errorMessage: string) => {
    error.value = errorMessage
    console.error('传感器数据错误:', errorMessage)
  }

  // 动作：获取最近的异常数据
  const getRecentAnomalies = (limit: number = 10): SensorData[] => {
    return latestData.value
      .filter(data => data.isAnomaly)
      .slice(0, limit)
  }

  // 动作：获取指定设备的异常历史
  const getDeviceAnomalies = (deviceId: string): SensorData[] => {
    return latestData.value.filter(data => 
      data.deviceId === deviceId && data.isAnomaly
    )
  }

  // 动作：获取热力图数据格式
  const getHeatmapData = (): HeatmapData[] => {
    return latestData.value.map(data => ({
      lat: data.latitude,
      lng: data.longitude,
      weight: data.pm25
    }))
  }
  
  // 动作：设置筛选后的数据
  const setFilteredData = (data: SensorData[]) => {
    filteredData.value = data
    console.log('设置筛选后数据:', data.length, '条')
  }

  return {
    // 状态
    latestData,
    filteredData,
    sensorData: latestData, // 兼容性别名
    isConnected,
    error,
    activeFilters,
    
    // 计算属性
    anomalyStats,
    highRiskAnomalies,
    deviceCount,
    averagePM25,
    
    // 动作
    updateData,
    setData,
    clearData,
    setConnectionStatus,
    setError,
    setFilteredData,
    getRecentAnomalies,
    getDeviceAnomalies,
    getHeatmapData
  }
})