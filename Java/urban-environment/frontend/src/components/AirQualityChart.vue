<template>
  <div class="air-quality-chart">
    <div class="chart-header">
      <h3>{{ title }}</h3>
      <div class="chart-controls">
        <select v-model="selectedMetric" @change="updateChart" class="metric-select">
          <option value="aqi">AQI指数</option>
          <option value="pm25">PM2.5浓度</option>
          <option value="temperature">温度</option>
          <option value="humidity">湿度</option>
        </select>
        <button @click="refreshChart" class="refresh-btn">🔄</button>
      </div>
    </div>
    
    <div class="chart-container">
      <canvas ref="chartCanvas" :width="canvasWidth" :height="canvasHeight"></canvas>
      
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner">📊 加载数据中...</div>
      </div>
    </div>
    
    <div class="chart-legend">
      <div class="legend-item" v-for="item in legendItems" :key="item.label">
        <span class="legend-color" :style="{ backgroundColor: item.color }"></span>
        <span class="legend-label">{{ item.label }}</span>
      </div>
    </div>
    
    <div class="data-summary" v-if="summaryData">
      <div class="summary-item">
        <span class="summary-label">最高值:</span>
        <span class="summary-value">{{ summaryData.max }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">最低值:</span>
        <span class="summary-value">{{ summaryData.min }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">平均值:</span>
        <span class="summary-value">{{ summaryData.avg }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import type { RealTimeSensorData } from '@/services/realTimeDataService'

interface Props {
  title?: string
  data: RealTimeSensorData[]
  width?: number
  height?: number
  showLegend?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '空气质量趋势图',
  width: 800,
  height: 400,
  showLegend: true
})

// 响应式数据
const chartCanvas = ref<HTMLCanvasElement | null>(null)
const selectedMetric = ref('aqi')
const isLoading = ref(false)
const canvasWidth = ref(props.width)
const canvasHeight = ref(props.height)

// 图表配置
const chartConfig = {
  padding: { top: 40, right: 40, bottom: 80, left: 80 },
  colors: {
    aqi: ['#22c55e', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#6b7280'],
    pm25: ['#3b82f6', '#06b6d4', '#10b981'],
    temperature: ['#f59e0b', '#dc2626'],
    humidity: ['#0891b2', '#0284c7']
  },
  gridColor: '#e5e7eb',
  textColor: '#6b7280',
  font: '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
}

// 计算图表数据
const chartData = computed(() => {
  if (!props.data || props.data.length === 0) return []
  
  const metric = selectedMetric.value
  return props.data.map((sensor, index) => ({
    x: index,
    y: sensor[metric as keyof RealTimeSensorData] as number,
    label: sensor.city_chinese || sensor.city,
    status: sensor.status,
    sensor: sensor
  })).sort((a, b) => b.y - a.y) // 按数值降序排列
})

// 计算图例数据
const legendItems = computed(() => {
  const metric = selectedMetric.value
  
  switch (metric) {
    case 'aqi':
      return [
        { label: '优秀 (0-50)', color: '#22c55e' },
        { label: '中等 (51-100)', color: '#eab308' },
        { label: '不健康 (101-150)', color: '#f97316' },
        { label: '非常不健康 (151-200)', color: '#ef4444' },
        { label: '危险 (200+)', color: '#8b5cf6' }
      ]
    case 'pm25':
      return [
        { label: '优秀 (0-35)', color: '#22c55e' },
        { label: '良好 (36-75)', color: '#eab308' },
        { label: '轻度污染 (76+)', color: '#ef4444' }
      ]
    case 'temperature':
      return [
        { label: '低温 (<10°C)', color: '#3b82f6' },
        { label: '适宜 (10-25°C)', color: '#22c55e' },
        { label: '高温 (>25°C)', color: '#ef4444' }
      ]
    case 'humidity':
      return [
        { label: '干燥 (<40%)', color: '#f59e0b' },
        { label: '适宜 (40-70%)', color: '#22c55e' },
        { label: '潮湿 (>70%)', color: '#0891b2' }
      ]
    default:
      return []
  }
})

// 计算统计数据
const summaryData = computed(() => {
  if (!chartData.value || chartData.value.length === 0) return null
  
  const values = chartData.value.map(d => d.y)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length
  
  const getUnit = (metric: string) => {
    switch (metric) {
      case 'aqi': return ''
      case 'pm25': return 'μg/m³'
      case 'temperature': return '°C'
      case 'humidity': return '%'
      default: return ''
    }
  }
  
  const unit = getUnit(selectedMetric.value)
  
  return {
    max: `${max.toFixed(1)}${unit}`,
    min: `${min.toFixed(1)}${unit}`,
    avg: `${avg.toFixed(1)}${unit}`
  }
})

// 获取数据点颜色
function getDataPointColor(value: number): string {
  const metric = selectedMetric.value
  
  switch (metric) {
    case 'aqi':
      if (value <= 50) return '#22c55e'
      if (value <= 100) return '#eab308'
      if (value <= 150) return '#f97316'
      if (value <= 200) return '#ef4444'
      return '#8b5cf6'
    
    case 'pm25':
      if (value <= 35) return '#22c55e'
      if (value <= 75) return '#eab308'
      return '#ef4444'
      
    case 'temperature':
      if (value < 10) return '#3b82f6'
      if (value <= 25) return '#22c55e'
      return '#ef4444'
      
    case 'humidity':
      if (value < 40) return '#f59e0b'
      if (value <= 70) return '#22c55e'
      return '#0891b2'
      
    default:
      return '#6b7280'
  }
}

// 绘制图表
function drawChart() {
  const canvas = chartCanvas.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  const data = chartData.value
  if (!data || data.length === 0) {
    drawEmptyState(ctx)
    return
  }
  
  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // 设置字体
  ctx.font = chartConfig.font
  
  // 计算绘图区域
  const { padding } = chartConfig
  const chartWidth = canvas.width - padding.left - padding.right
  const chartHeight = canvas.height - padding.top - padding.bottom
  
  // 计算数据范围
  const values = data.map(d => d.y)
  const maxValue = Math.max(...values)
  const minValue = Math.min(...values)
  const valueRange = maxValue - minValue || 1
  
  // 绘制网格线
  drawGrid(ctx, padding, chartWidth, chartHeight, maxValue, minValue)
  
  // 绘制数据点和柱状图
  drawBars(ctx, data, padding, chartWidth, chartHeight, maxValue, minValue)
  
  // 绘制坐标轴
  drawAxes(ctx, padding, chartWidth, chartHeight)
  
  // 绘制标题
  drawTitle(ctx, canvas.width)
}

// 绘制空状态
function drawEmptyState(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  
  ctx.fillStyle = '#9ca3af'
  ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  
  ctx.fillText(
    '暂无数据',
    ctx.canvas.width / 2,
    ctx.canvas.height / 2
  )
}

// 绘制网格线
function drawGrid(
  ctx: CanvasRenderingContext2D,
  padding: any,
  width: number,
  height: number,
  maxValue: number,
  minValue: number
) {
  ctx.strokeStyle = chartConfig.gridColor
  ctx.lineWidth = 1
  
  // 水平网格线
  const gridLines = 5
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (height / gridLines) * i
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(padding.left + width, y)
    ctx.stroke()
    
    // Y轴标签
    const value = maxValue - ((maxValue - minValue) / gridLines) * i
    ctx.fillStyle = chartConfig.textColor
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(value.toFixed(0), padding.left - 10, y)
  }
}

// 绘制柱状图
function drawBars(
  ctx: CanvasRenderingContext2D,
  data: any[],
  padding: any,
  width: number,
  height: number,
  maxValue: number,
  minValue: number
) {
  const barWidth = width / data.length * 0.8
  const barSpacing = width / data.length * 0.2
  
  data.forEach((point, index) => {
    const x = padding.left + (width / data.length) * index + barSpacing / 2
    const normalizedValue = (point.y - minValue) / (maxValue - minValue || 1)
    const barHeight = normalizedValue * height
    const y = padding.top + height - barHeight
    
    // 绘制柱状图
    ctx.fillStyle = getDataPointColor(point.y)
    ctx.fillRect(x, y, barWidth, barHeight)
    
    // 绘制异常状态指示
    if (point.status === '异常') {
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(x, y - 3, barWidth, 3)
    }
    
    // 绘制数值标签
    ctx.fillStyle = chartConfig.textColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(point.y.toFixed(1), x + barWidth / 2, y - 5)
    
    // 绘制城市标签
    ctx.save()
    ctx.translate(x + barWidth / 2, padding.top + height + 15)
    ctx.rotate(-Math.PI / 4)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(point.label, 0, 0)
    ctx.restore()
  })
}

// 绘制坐标轴
function drawAxes(
  ctx: CanvasRenderingContext2D,
  padding: any,
  width: number,
  height: number
) {
  ctx.strokeStyle = chartConfig.textColor
  ctx.lineWidth = 2
  
  // Y轴
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top)
  ctx.lineTo(padding.left, padding.top + height)
  ctx.stroke()
  
  // X轴
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top + height)
  ctx.lineTo(padding.left + width, padding.top + height)
  ctx.stroke()
}

// 绘制标题
function drawTitle(ctx: CanvasRenderingContext2D, canvasWidth: number) {
  ctx.fillStyle = '#1f2937'
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  
  const metricNames = {
    aqi: 'AQI指数分布',
    pm25: 'PM2.5浓度分布',
    temperature: '温度分布',
    humidity: '湿度分布'
  }
  
  ctx.fillText(
    metricNames[selectedMetric.value as keyof typeof metricNames] || '数据分布',
    canvasWidth / 2,
    10
  )
}

// 更新图表
function updateChart() {
  setTimeout(drawChart, 100)
}

// 刷新图表
function refreshChart() {
  isLoading.value = true
  setTimeout(() => {
    drawChart()
    isLoading.value = false
  }, 500)
}

// 监听数据变化
watch(() => props.data, () => {
  updateChart()
}, { deep: true })

watch(selectedMetric, () => {
  updateChart()
})

// 生命周期
onMounted(() => {
  updateChart()
})
</script>

<style scoped>
.air-quality-chart {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.chart-header h3 {
  margin: 0;
  color: #1f2937;
  font-size: 18px;
  font-weight: 600;
}

.chart-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.metric-select {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  color: #374151;
}

.refresh-btn {
  padding: 6px 12px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.refresh-btn:hover {
  background: #e5e7eb;
}

.chart-container {
  position: relative;
  margin-bottom: 20px;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.loading-spinner {
  color: #6b7280;
  font-size: 16px;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.legend-label {
  font-size: 12px;
  color: #6b7280;
}

.data-summary {
  display: flex;
  justify-content: space-around;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
}

.summary-item {
  text-align: center;
}

.summary-label {
  display: block;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 4px;
}

.summary-value {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chart-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  
  .chart-legend {
    flex-direction: column;
    gap: 8px;
  }
  
  .data-summary {
    flex-direction: column;
    gap: 12px;
  }
}
</style>
