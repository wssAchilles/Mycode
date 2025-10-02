/**
 * 数据导出服务
 * 支持将传感器数据导出为CSV和Excel格式
 */

import type { SensorData } from '@/services/websocket'

export type ExportFormat = 'csv' | 'excel'

export interface ExportOptions {
  format: ExportFormat
  filename?: string
  includeHeaders: boolean
  dateRange?: {
    start: Date
    end: Date
  }
  anomaliesOnly?: boolean
}

class DataExportService {
  /**
   * 导出数据
   */
  public async exportData(data: SensorData[], options: ExportOptions): Promise<void> {
    // 过滤数据
    let filteredData = this.filterData(data, options)
    
    if (filteredData.length === 0) {
      throw new Error('没有符合条件的数据可以导出')
    }

    // 根据格式执行导出
    if (options.format === 'csv') {
      await this.exportCSV(filteredData, options)
    } else if (options.format === 'excel') {
      await this.exportExcel(filteredData, options)
    }
  }

  /**
   * 过滤数据
   */
  private filterData(data: SensorData[], options: ExportOptions): SensorData[] {
    let filtered = [...data]

    // 按日期范围过滤
    if (options.dateRange) {
      filtered = filtered.filter(item => {
        const timestamp = new Date(item.timestamp)
        return timestamp >= options.dateRange!.start && timestamp <= options.dateRange!.end
      })
    }

    // 只导出异常数据
    if (options.anomaliesOnly) {
      filtered = filtered.filter(item => item.isAnomaly)
    }

    // 按时间倒序排列
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return filtered
  }

  /**
   * 导出CSV格式
   */
  private async exportCSV(data: SensorData[], options: ExportOptions): Promise<void> {
    const headers = [
      '设备ID',
      '纬度',
      '经度', 
      'PM2.5值',
      '时间戳',
      '是否异常',
      '异常分数',
      '置信度'
    ]

    const csvContent = [
      // CSV头部
      options.includeHeaders ? headers.join(',') : '',
      // 数据行
      ...data.map(item => [
        `"${item.deviceId}"`,
        item.latitude.toString(),
        item.longitude.toString(),
        item.pm25.toString(),
        `"${item.timestamp}"`,
        item.isAnomaly ? '是' : '否',
        (item.anomalyScore || 0).toFixed(4),
        ((item.confidence || 0) * 100).toFixed(2) + '%'
      ].join(','))
    ].filter(Boolean).join('\n')

    // 添加BOM以支持中文
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' })
    
    this.downloadFile(blob, options.filename || this.generateFilename('csv', options))
  }

  /**
   * 导出Excel格式
   */
  private async exportExcel(data: SensorData[], options: ExportOptions): Promise<void> {
    try {
      // 动态导入SheetJS库
      const XLSX = await import('xlsx')
      
      // 准备数据
      const worksheetData = data.map(item => ({
        '设备ID': item.deviceId,
        '纬度': item.latitude,
        '经度': item.longitude,
        'PM2.5值': item.pm25,
        '时间戳': item.timestamp,
        '是否异常': item.isAnomaly ? '是' : '否',
        '异常分数': (item.anomalyScore || 0).toFixed(4),
        '置信度': ((item.confidence || 0) * 100).toFixed(2) + '%'
      }))

      // 创建工作簿
      const workbook = XLSX.utils.book_new()
      
      // 创建工作表
      const worksheet = XLSX.utils.json_to_sheet(worksheetData)
      
      // 设置列宽
      const columnWidths = [
        { wch: 15 }, // 设备ID
        { wch: 12 }, // 纬度
        { wch: 12 }, // 经度
        { wch: 10 }, // PM2.5值
        { wch: 20 }, // 时间戳
        { wch: 10 }, // 是否异常
        { wch: 12 }, // 异常分数
        { wch: 10 }  // 置信度
      ]
      worksheet['!cols'] = columnWidths

      // 添加工作表到工作簿
      XLSX.utils.book_append_sheet(workbook, worksheet, '传感器数据')
      
      // 生成Excel文件
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      })
      
      this.downloadFile(blob, options.filename || this.generateFilename('xlsx', options))
      
    } catch (error) {
      console.error('Excel导出失败:', error)
      // 如果Excel导出失败，回退到CSV格式
      console.log('回退到CSV格式导出')
      await this.exportCSV(data, { ...options, format: 'csv' })
    }
  }

  /**
   * 生成报告数据
   */
  public generateReport(data: SensorData[]): string {
    if (data.length === 0) {
      return '无数据可生成报告'
    }

    const anomalies = data.filter(item => item.isAnomaly)
    const averagePM25 = data.reduce((sum, item) => sum + item.pm25, 0) / data.length
    const maxPM25 = Math.max(...data.map(item => item.pm25))
    const minPM25 = Math.min(...data.map(item => item.pm25))
    
    const devices = new Set(data.map(item => item.deviceId))
    const anomalyRate = (anomalies.length / data.length) * 100

    // 按设备统计
    const deviceStats = Array.from(devices).map(deviceId => {
      const deviceData = data.filter(item => item.deviceId === deviceId)
      const deviceAnomalies = deviceData.filter(item => item.isAnomaly)
      return {
        deviceId,
        count: deviceData.length,
        anomalies: deviceAnomalies.length,
        averagePM25: deviceData.reduce((sum, item) => sum + item.pm25, 0) / deviceData.length,
        anomalyRate: (deviceAnomalies.length / deviceData.length) * 100
      }
    })

    // 生成报告文本
    const report = `
城市环境监测数据报告
生成时间: ${new Date().toLocaleString('zh-CN')}

=== 总览 ===
数据总量: ${data.length} 条
异常数量: ${anomalies.length} 条
异常率: ${anomalyRate.toFixed(2)}%

=== PM2.5统计 ===
平均值: ${averagePM25.toFixed(2)} µg/m³
最大值: ${maxPM25.toFixed(2)} µg/m³
最小值: ${minPM25.toFixed(2)} µg/m³

=== 设备统计 ===
监测设备数量: ${devices.size} 个
${deviceStats.map(stat => `
设备 ${stat.deviceId}:
  - 数据量: ${stat.count} 条
  - 异常数: ${stat.anomalies} 条
  - 异常率: ${stat.anomalyRate.toFixed(2)}%
  - 平均PM2.5: ${stat.averagePM25.toFixed(2)} µg/m³`).join('')}

=== 最新异常记录 ===
${anomalies.slice(0, 5).map(item => `
时间: ${new Date(item.timestamp).toLocaleString('zh-CN')}
设备: ${item.deviceId}
PM2.5: ${item.pm25} µg/m³
位置: (${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)})
置信度: ${((item.confidence || 0) * 100).toFixed(1)}%`).join('')}

生成说明:
本报告基于AI异常检测系统生成，异常检测模型使用Isolation Forest算法。
    `.trim()

    return report
  }

  /**
   * 导出报告
   */
  public async exportReport(data: SensorData[], filename?: string): Promise<void> {
    const report = this.generateReport(data)
    const blob = new Blob(['\uFEFF' + report], { type: 'text/plain;charset=utf-8' })
    this.downloadFile(blob, filename || this.generateReportFilename())
  }

  /**
   * 下载文件
   */
  private downloadFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    // 清理URL对象
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  /**
   * 生成文件名
   */
  private generateFilename(extension: string, options: ExportOptions): string {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const prefix = options.anomaliesOnly ? '异常数据' : '传感器数据'
    return `${prefix}_${timestamp}.${extension}`
  }

  /**
   * 生成报告文件名
   */
  private generateReportFilename(): string {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    return `环境监测报告_${timestamp}.txt`
  }

  /**
   * 验证数据
   */
  public validateData(data: SensorData[]): { valid: boolean; message?: string } {
    if (!Array.isArray(data)) {
      return { valid: false, message: '数据必须是数组格式' }
    }

    if (data.length === 0) {
      return { valid: false, message: '没有可导出的数据' }
    }

    // 检查必需字段
    const requiredFields = ['deviceId', 'latitude', 'longitude', 'pm25', 'timestamp']
    const firstItem = data[0]
    
    for (const field of requiredFields) {
      if (!(field in firstItem)) {
        return { valid: false, message: `缺少必需字段: ${field}` }
      }
    }

    return { valid: true }
  }
}

// 创建单例实例
export const dataExportService = new DataExportService()

// 导出工具函数
export const exportSensorData = async (
  data: SensorData[], 
  format: ExportFormat = 'csv',
  options: Partial<ExportOptions> = {}
) => {
  const exportOptions: ExportOptions = {
    format,
    includeHeaders: true,
    ...options
  }

  const validation = dataExportService.validateData(data)
  if (!validation.valid) {
    throw new Error(validation.message)
  }

  await dataExportService.exportData(data, exportOptions)
}

export default dataExportService