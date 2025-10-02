/**
 * 实时警报服务
 * 负责监听异常数据并触发各种类型的警报
 */

export type AlertType = 'browser' | 'sound' | 'popup'

export interface AlertConfig {
  enabled: boolean
  types: AlertType[]
  highRiskOnly: boolean
  soundVolume: number
  autoClose: number // 自动关闭时间（秒），0表示手动关闭
}

export interface AlertData {
  id: string
  title: string
  message: string
  type: 'warning' | 'danger' | 'info'
  timestamp: Date
  deviceId: string
  pm25: number
  anomalyScore?: number
  confidence?: number
  location: {
    latitude: number
    longitude: number
  }
}

class AlertService {
  private config: AlertConfig = {
    enabled: true,
    types: ['browser', 'sound', 'popup'],
    highRiskOnly: false,
    soundVolume: 0.5,
    autoClose: 10
  }

  private alerts: AlertData[] = []
  private callbacks: Array<(alert: AlertData) => void> = []
  private audio: HTMLAudioElement | null = null

  constructor() {
    this.initializeAudio()
    this.requestNotificationPermission()
  }

  /**
   * 初始化音频
   */
  private initializeAudio() {
    try {
      // 创建警报音效（使用 Web Audio API 生成简单的蜂鸣声）
      this.createAlertSound()
    } catch (error) {
      console.warn('无法初始化警报音效:', error)
    }
  }

  /**
   * 创建警报音效
   */
  private createAlertSound() {
    // 使用 Web Audio API 创建警报音
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    
    const createBeep = (frequency: number, duration: number, delay: number = 0) => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const oscillator = audioContext.createOscillator()
          const gainNode = audioContext.createGain()
          
          oscillator.connect(gainNode)
          gainNode.connect(audioContext.destination)
          
          oscillator.frequency.value = frequency
          oscillator.type = 'square'
          
          gainNode.gain.setValueAtTime(0, audioContext.currentTime)
          gainNode.gain.linearRampToValueAtTime(this.config.soundVolume, audioContext.currentTime + 0.01)
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration)
          
          oscillator.start(audioContext.currentTime)
          oscillator.stop(audioContext.currentTime + duration)
          
          oscillator.onended = () => resolve()
        }, delay)
      })
    }

    // 存储播放函数
    this.playAlertSound = async () => {
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      
      // 播放三声蜂鸣
      await createBeep(800, 0.2, 0)
      await createBeep(1000, 0.2, 300)
      await createBeep(1200, 0.3, 600)
    }
  }

  private playAlertSound: () => Promise<void> = async () => {
    // 默认实现（如果 Web Audio API 初始化失败）
    console.log('播放警报音效')
  }

  /**
   * 请求浏览器通知权限
   */
  private async requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  }

  /**
   * 设置警报配置
   */
  public setConfig(config: Partial<AlertConfig>) {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  public getConfig(): AlertConfig {
    return { ...this.config }
  }

  /**
   * 触发警报
   */
  public async triggerAlert(data: Omit<AlertData, 'id' | 'timestamp'>): Promise<string> {
    if (!this.config.enabled) {
      return ''
    }

    // 如果配置为只显示高风险异常，检查置信度
    if (this.config.highRiskOnly && (data.confidence || 0) < 0.7) {
      return ''
    }

    // 创建警报数据
    const alert: AlertData = {
      ...data,
      id: Date.now().toString(),
      timestamp: new Date()
    }

    // 添加到警报列表
    this.alerts.unshift(alert)

    // 保持最多100条警报记录
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(0, 100)
    }

    // 触发各种类型的警报
    const promises = this.config.types.map(type => this.executeAlert(type, alert))
    await Promise.all(promises)

    // 通知订阅者
    this.callbacks.forEach(callback => {
      try {
        callback(alert)
      } catch (error) {
        console.error('警报回调执行失败:', error)
      }
    })

    return alert.id
  }

  /**
   * 执行特定类型的警报
   */
  private async executeAlert(type: AlertType, alert: AlertData): Promise<void> {
    try {
      switch (type) {
        case 'browser':
          await this.showBrowserNotification(alert)
          break
        case 'sound':
          await this.playAlertSound()
          break
        case 'popup':
          // popup 类型通过回调处理，这里不需要额外操作
          break
      }
    } catch (error) {
      console.error(`执行 ${type} 警报失败:`, error)
    }
  }

  /**
   * 显示浏览器通知
   */
  private async showBrowserNotification(alert: AlertData): Promise<void> {
    if (!('Notification' in window)) {
      console.warn('浏览器不支持通知功能')
      return
    }

    if (Notification.permission !== 'granted') {
      console.warn('没有通知权限')
      return
    }

    const notification = new Notification(alert.title, {
      body: alert.message,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: `anomaly-${alert.deviceId}`, // 防止同一设备的重复通知
      requireInteraction: alert.type === 'danger', // 危险级别需要用户交互
      silent: false,
      data: alert
    })

    // 自动关闭
    if (this.config.autoClose > 0) {
      setTimeout(() => {
        notification.close()
      }, this.config.autoClose * 1000)
    }

    // 点击通知时的处理
    notification.onclick = () => {
      window.focus()
      notification.close()
      
      // 可以在这里添加跳转到地图对应位置的逻辑
      this.onNotificationClick(alert)
    }
  }

  /**
   * 通知点击处理（可被重写）
   */
  private onNotificationClick(alert: AlertData) {
    console.log('通知被点击:', alert)
    // 这里可以添加导航到地图位置等逻辑
  }

  /**
   * 订阅警报事件
   */
  public onAlert(callback: (alert: AlertData) => void): () => void {
    this.callbacks.push(callback)
    
    // 返回取消订阅函数
    return () => {
      const index = this.callbacks.indexOf(callback)
      if (index > -1) {
        this.callbacks.splice(index, 1)
      }
    }
  }

  /**
   * 获取所有警报记录
   */
  public getAlerts(): AlertData[] {
    return [...this.alerts]
  }

  /**
   * 获取最近的警报
   */
  public getRecentAlerts(limit: number = 10): AlertData[] {
    return this.alerts.slice(0, limit)
  }

  /**
   * 清除所有警报
   */
  public clearAlerts(): void {
    this.alerts = []
  }

  /**
   * 删除指定警报
   */
  public removeAlert(alertId: string): boolean {
    const index = this.alerts.findIndex(alert => alert.id === alertId)
    if (index > -1) {
      this.alerts.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * 测试警报系统
   */
  public async testAlert(): Promise<void> {
    await this.triggerAlert({
      title: '测试警报',
      message: '这是一个测试警报，用于验证警报系统是否正常工作。',
      type: 'info',
      deviceId: 'TEST-001',
      pm25: 50.5,
      anomalyScore: -0.1234,
      confidence: 0.85,
      location: {
        latitude: 35.6895,
        longitude: 139.6917
      }
    })
  }

  /**
   * 销毁服务
   */
  public destroy(): void {
    this.callbacks = []
    this.alerts = []
    this.audio = null
  }
}

// 创建单例实例
export const alertService = new AlertService()

// 为了方便使用，导出一些常用的工具函数
export const createAnomalyAlert = (deviceId: string, pm25: number, anomalyScore?: number, confidence?: number, location?: { latitude: number; longitude: number }) => {
  const riskLevel = (confidence || 0) >= 0.8 ? 'danger' : (confidence || 0) >= 0.7 ? 'warning' : 'info'
  const riskText = riskLevel === 'danger' ? '严重异常' : riskLevel === 'warning' ? '异常' : '可能异常'
  
  return alertService.triggerAlert({
    title: `环境监测${riskText}`,
    message: `设备 ${deviceId} 检测到异常PM2.5值: ${pm25} µg/m³${confidence ? ` (置信度: ${(confidence * 100).toFixed(1)}%)` : ''}`,
    type: riskLevel as 'warning' | 'danger' | 'info',
    deviceId,
    pm25,
    anomalyScore,
    confidence,
    location: location || { latitude: 0, longitude: 0 }
  })
}

export default alertService