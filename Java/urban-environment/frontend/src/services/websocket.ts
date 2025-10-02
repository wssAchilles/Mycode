import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { createAnomalyAlert } from './alertService'
import type { SensorData } from '@/types/SensorData'

// 重新导出类型以保持向后兼容性
export type { SensorData }

export interface WebSocketService {
  connect(onMessageCallback: (data: SensorData) => void): void
  disconnect(): void
  isConnected(): boolean
}

class WebSocketServiceImpl implements WebSocketService {
  private client: Client | null = null
  private connected = false

  connect(onMessageCallback: (data: SensorData) => void): void {
    if (this.client) {
      console.warn('WebSocket客户端已经存在，先断开连接')
      this.disconnect()
    }

    // 创建STOMP客户端，使用SockJS作为传输层
    this.client = new Client({
      webSocketFactory: () => new SockJS('http://localhost:8080/ws'),
      reconnectDelay: 5000, // 自动重连延迟5秒
      heartbeatIncoming: 4000, // 期望接收的心跳间隔
      heartbeatOutgoing: 4000, // 发送心跳间隔
      debug: (str: string) => {
        console.log('STOMP Debug:', str)
      }
    })

    // 连接成功回调
    this.client.onConnect = (frame) => {
      console.log('WebSocket连接成功:', frame)
      this.connected = true

      // 订阅传感器数据主题
      this.client?.subscribe('/topic/sensordata', (message) => {
        try {
          const sensorData: SensorData = JSON.parse(message.body)
          console.log('接收到实时传感器数据:', sensorData)
          
          // 如果检测到异常，自动触发警报
          if (sensorData.isAnomaly) {
            createAnomalyAlert(
              sensorData.deviceId,
              sensorData.pm25,
              sensorData.anomalyScore,
              sensorData.confidence,
              {
                latitude: sensorData.latitude,
                longitude: sensorData.longitude
              }
            ).catch(error => {
              console.error('触发异常警报失败:', error)
            })
          }
          
          onMessageCallback(sensorData)
        } catch (error) {
          console.error('解析WebSocket消息失败:', error, message.body)
        }
      })
    }

    // 连接错误回调
    this.client.onStompError = (frame) => {
      console.error('WebSocket STOMP错误:', frame)
      this.connected = false
    }

    // WebSocket连接错误回调
    this.client.onWebSocketError = (event) => {
      console.error('WebSocket连接错误:', event)
      this.connected = false
    }

    // 断开连接回调
    this.client.onDisconnect = (frame) => {
      console.log('WebSocket连接断开:', frame)
      this.connected = false
    }

    // 激活客户端连接
    this.client.activate()
  }

  disconnect(): void {
    if (this.client) {
      this.client.deactivate()
      this.client = null
      this.connected = false
      console.log('WebSocket连接已断开')
    }
  }

  isConnected(): boolean {
    return this.connected
  }
}

// 导出单例实例
export const webSocketService: WebSocketService = new WebSocketServiceImpl()