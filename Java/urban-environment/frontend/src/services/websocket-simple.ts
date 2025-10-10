import type { SensorData } from '@/types/SensorData'

export interface WebSocketService {
  connect(onMessageCallback: (data: SensorData) => void): void
  disconnect(): void
  isConnected(): boolean
}

class SimpleWebSocketService implements WebSocketService {
  private connected = false

  connect(onMessageCallback: (data: SensorData) => void): void {
    console.log('SimpleWebSocket: 模拟连接')
    this.connected = true
    
    // 模拟一些测试数据
    setTimeout(() => {
      const mockData: SensorData = {
        deviceId: 'SENSOR_001',
        latitude: 39.9042,
        longitude: 116.4074,
        pm25: 45.6,
        temperature: 23.5,
        humidity: 65.2,
        timestamp: new Date().toISOString(),
        isAnomaly: false,
        anomalyScore: 0.1,
        confidence: 0.95
      }
      onMessageCallback(mockData)
    }, 1000)
  }

  disconnect(): void {
    console.log('SimpleWebSocket: 断开连接')
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }
}

export const webSocketService: WebSocketService = new SimpleWebSocketService()
