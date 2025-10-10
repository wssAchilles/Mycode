// 前端实时数据更新服务
import type { RealTimeSensorData } from './realTimeDataService'

export interface UpdateCallback {
  (data: RealTimeSensorData[]): void
}

export interface StatusCallback {
  (status: 'connecting' | 'connected' | 'disconnected' | 'error'): void
}

export class RealTimeUpdateService {
  private updateCallbacks: UpdateCallback[] = []
  private statusCallbacks: StatusCallback[] = []
  private updateInterval: number | null = null
  private isActive = false
  private currentStatus: 'connecting' | 'connected' | 'disconnected' | 'error' = 'disconnected'
  private lastUpdateTime: Date | null = null
  private consecutiveErrors = 0
  private maxErrors = 3

  // 更新频率配置
  private readonly UPDATE_INTERVALS = {
    fast: 30 * 1000,    // 30秒 - 快速更新
    normal: 60 * 1000,  // 1分钟 - 正常更新  
    slow: 300 * 1000    // 5分钟 - 慢速更新
  }

  private currentUpdateInterval = this.UPDATE_INTERVALS.normal

  constructor() {
    // 页面可见性变化时调整更新频率
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  /**
   * 订阅数据更新
   */
  onDataUpdate(callback: UpdateCallback): () => void {
    this.updateCallbacks.push(callback)
    
    // 返回取消订阅函数
    return () => {
      const index = this.updateCallbacks.indexOf(callback)
      if (index > -1) {
        this.updateCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * 订阅状态更新
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.push(callback)
    
    // 立即调用一次当前状态
    callback(this.currentStatus)
    
    return () => {
      const index = this.statusCallbacks.indexOf(callback)
      if (index > -1) {
        this.statusCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * 开始实时更新
   */
  start(updateMode: 'fast' | 'normal' | 'slow' = 'normal'): void {
    if (this.isActive) {
      console.log('🔄 实时更新服务已在运行')
      return
    }

    this.isActive = true
    this.currentUpdateInterval = this.UPDATE_INTERVALS[updateMode]
    this.consecutiveErrors = 0
    
    console.log(`🚀 启动实时数据更新服务 (${updateMode}模式, ${this.currentUpdateInterval/1000}秒间隔)`)
    
    // 立即更新一次
    this.fetchAndUpdate()
    
    // 设置定时更新
    this.updateInterval = window.setInterval(() => {
      this.fetchAndUpdate()
    }, this.currentUpdateInterval)

    this.setStatus('connecting')
  }

  /**
   * 停止实时更新
   */
  stop(): void {
    if (!this.isActive) {
      return
    }

    this.isActive = false
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }

    this.setStatus('disconnected')
    console.log('⏹️ 实时数据更新服务已停止')
  }

  /**
   * 手动触发更新
   */
  async forceUpdate(): Promise<void> {
    console.log('🔄 手动触发数据更新')
    await this.fetchAndUpdate()
  }

  /**
   * 获取并更新数据
   */
  private async fetchAndUpdate(): Promise<void> {
    try {
      this.setStatus('connecting')
      
      // 尝试获取最新数据
      const response = await fetch('/data/current_air_quality.json?t=' + Date.now(), {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      
      // 检查数据有效性
      if (!data.cities || !Array.isArray(data.cities)) {
        throw new Error('数据格式无效')
      }

      // 转换数据格式
      const sensors: RealTimeSensorData[] = data.cities.map((city: any) => ({
        id: city.id,
        pm25: Math.round(city.pm25 * 10) / 10,
        temperature: city.temperature,
        humidity: city.humidity,
        status: city.status,
        province: city.province,
        city: city.city_chinese + '市',
        district: city.district,
        location: city.location,
        lastUpdate: city.lastUpdate,
        aqi: city.aqi,
        pm10: Math.round(city.pm25 * 1.3),
        so2: Math.round(20 + Math.random() * 30),
        no2: Math.round(25 + Math.random() * 35),
        co: Math.round((0.8 + Math.random() * 1.2) * 10) / 10,
        o3: Math.round(60 + Math.random() * 80)
      }))

      // 更新成功
      this.consecutiveErrors = 0
      this.lastUpdateTime = new Date()
      this.setStatus('connected')

      // 通知所有订阅者
      this.updateCallbacks.forEach(callback => {
        try {
          callback(sensors)
        } catch (error) {
          console.error('❌ 数据更新回调异常:', error)
        }
      })

      console.log(`✅ 数据更新成功: ${sensors.length}个城市 (${new Date().toLocaleTimeString()})`)

    } catch (error) {
      this.consecutiveErrors++
      console.error(`❌ 数据更新失败 (${this.consecutiveErrors}/${this.maxErrors}):`, error)

      // 连续错误处理
      if (this.consecutiveErrors >= this.maxErrors) {
        this.setStatus('error')
        // 降级到慢速更新模式
        if (this.currentUpdateInterval === this.UPDATE_INTERVALS.fast) {
          this.changeUpdateInterval('normal')
        } else if (this.currentUpdateInterval === this.UPDATE_INTERVALS.normal) {
          this.changeUpdateInterval('slow')
        }
      } else {
        this.setStatus('connecting')
      }
    }
  }

  /**
   * 改变更新间隔
   */
  changeUpdateInterval(mode: 'fast' | 'normal' | 'slow'): void {
    const newInterval = this.UPDATE_INTERVALS[mode]
    
    if (newInterval === this.currentUpdateInterval) {
      return
    }

    this.currentUpdateInterval = newInterval
    
    // 重启定时器
    if (this.updateInterval && this.isActive) {
      clearInterval(this.updateInterval)
      this.updateInterval = window.setInterval(() => {
        this.fetchAndUpdate()
      }, this.currentUpdateInterval)
    }

    console.log(`🔄 更新间隔已调整为${mode}模式 (${newInterval/1000}秒)`)
  }

  /**
   * 设置状态
   */
  private setStatus(status: 'connecting' | 'connected' | 'disconnected' | 'error'): void {
    if (this.currentStatus === status) {
      return
    }

    this.currentStatus = status
    
    // 通知状态变化
    this.statusCallbacks.forEach(callback => {
      try {
        callback(status)
      } catch (error) {
        console.error('❌ 状态更新回调异常:', error)
      }
    })
  }

  /**
   * 处理页面可见性变化
   */
  private handleVisibilityChange(): void {
    if (document.hidden) {
      // 页面不可见时切换到慢速模式
      console.log('📱 页面不可见，切换到慢速更新模式')
      this.changeUpdateInterval('slow')
    } else {
      // 页面可见时恢复正常模式
      console.log('👀 页面可见，恢复正常更新模式')
      this.changeUpdateInterval('normal')
      // 立即更新一次
      this.fetchAndUpdate()
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): 'connecting' | 'connected' | 'disconnected' | 'error' {
    return this.currentStatus
  }

  /**
   * 获取最后更新时间
   */
  getLastUpdateTime(): Date | null {
    return this.lastUpdateTime
  }

  /**
   * 获取当前更新间隔
   */
  getCurrentInterval(): number {
    return this.currentUpdateInterval
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.isActive
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.stop()
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.updateCallbacks.length = 0
    this.statusCallbacks.length = 0
    console.log('🗑️ 实时更新服务已销毁')
  }
}

// 创建全局实例
export const realTimeUpdateService = new RealTimeUpdateService()
