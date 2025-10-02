import axios from 'axios'
import type { SensorData } from '@/types/SensorData'
import type { HeatmapData } from '@/stores/sensorData'

// API基础URL
const API_BASE_URL = 'http://localhost:8080/api'

// 创建axios实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

/**
 * 获取最新的传感器数据
 * @returns Promise<SensorData[]> 传感器数据数组
 */
export async function fetchLatestSensorData(): Promise<SensorData[]> {
  try {
    const response = await apiClient.get<SensorData[]>('/data/latest')
    return response.data
  } catch (error) {
    console.error('获取传感器数据时出错:', error)
    throw new Error('获取传感器数据失败')
  }
}

/**
 * 获取热力图数据
 * @returns Promise<HeatmapData[]> 热力图数据数组
 */
export async function fetchHeatmapData(): Promise<HeatmapData[]> {
  try {
    const response = await apiClient.get<HeatmapData[]>('/data/heatmap')
    return response.data
  } catch (error) {
    console.error('获取热力图数据时出错:', error)
    throw new Error('获取热力图数据失败')
  }
}
