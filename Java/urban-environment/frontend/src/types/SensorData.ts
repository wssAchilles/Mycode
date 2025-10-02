/**
 * 传感器数据接口定义
 * 与后端API返回的数据结构保持一致
 */
export interface SensorData {
  id?: number
  deviceId: string
  latitude: number
  longitude: number
  pm25: number
  temperature?: number
  humidity?: number
  timestamp: string
  // AI异常检测结果
  isAnomaly?: boolean
  anomalyScore?: number
  confidence?: number
}
