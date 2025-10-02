<template>
  <div class="realtime-chart-container">
    <div class="chart-header">
      <div class="chart-title">
        <div class="title-icon">📊</div>
        <div>
          <h3>实时PM2.5趋势</h3>
          <p class="chart-subtitle">最近30条数据记录</p>
        </div>
      </div>
      <div class="chart-controls">
        <button 
          @click="toggleAutoScroll" 
          :class="['control-btn', { active: autoScroll }]"
        >
          <span class="btn-icon">{{ autoScroll ? '⏸️' : '▶️' }}</span>
          {{ autoScroll ? '暂停' : '开始' }}
        </button>
        <button @click="clearChart" class="control-btn">
          <span class="btn-icon">🗑️</span>
          清空
        </button>
      </div>
    </div>

    <div class="chart-content">
      <div class="chart-canvas-container" ref="chartContainer">
        <canvas ref="chartCanvas" :width="canvasSize.width" :height="canvasSize.height"></canvas>
        
        <!-- 数据点悬停信息 -->
        <div 
          v-if="hoveredPoint"
          class="tooltip"
          :style="{ left: hoveredPoint.x + 'px', top: hoveredPoint.y + 'px' }"
        >
          <div class="tooltip-header">
            <strong>{{ hoveredPoint.data.deviceId }}</strong>
          </div>
          <div class="tooltip-body">
            <div>PM2.5: {{ hoveredPoint.data.pm25 }} μg/m³</div>
            <div>时间: {{ formatTime(hoveredPoint.data.timestamp) }}</div>
            <div v-if="hoveredPoint.data.isAnomaly" class="anomaly-info">
              ⚠️ 异常检测: {{ (hoveredPoint.data.confidence! * 100).toFixed(1) }}%
            </div>
          </div>
        </div>
      </div>

      <!-- 图例和统计信息 -->
      <div class="chart-legend">
        <div class="legend-items">
          <div class="legend-item">
            <div class="legend-color normal"></div>
            <span>正常值</span>
          </div>
          <div class="legend-item">
            <div class="legend-color anomaly"></div>
            <span>异常值</span>
          </div>
        </div>
        
        <div class="chart-stats">
          <div class="stat-item">
            <span class="stat-label">数据点:</span>
            <span class="stat-value">{{ chartData.length }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">异常:</span>
            <span class="stat-value anomaly">{{ anomalyCount }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">平均值:</span>
            <span class="stat-value">{{ averageValue.toFixed(1) }} μg/m³</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useSensorDataStore } from '@/stores/sensorData'
import type { SensorData } from '@/types/SensorData'

interface ChartPoint {
  x: number
  y: number
  data: SensorData
  isAnomaly: boolean
}

interface HoveredPoint {
  x: number
  y: number
  data: SensorData
}

// 状态管理
const sensorStore = useSensorDataStore()
const chartContainer = ref<HTMLDivElement>()
const chartCanvas = ref<HTMLCanvasElement>()

// 图表配置
const autoScroll = ref(true)
const maxDataPoints = 30
const chartData = ref<SensorData[]>([])

// 画布状态
const canvasSize = ref({ width: 800, height: 400 })
const hoveredPoint = ref<HoveredPoint | null>(null)

// 计算属性
const anomalyCount = computed(() => {
  return chartData.value.filter(d => d.isAnomaly).length
})

const averageValue = computed(() => {
  if (chartData.value.length === 0) return 0
  const sum = chartData.value.reduce((acc, d) => acc + d.pm25, 0)
  return sum / chartData.value.length
})

// 监听传感器数据变化
watch(
  () => sensorStore.sensorData,
  (newData) => {
    if (autoScroll.value && newData.length > 0) {
      updateChartData(newData[newData.length - 1])
    }
  },
  { deep: true }
)

// 更新图表数据
function updateChartData(newData: SensorData) {
  chartData.value.push(newData)
  
  // 保持最大数据点数量
  if (chartData.value.length > maxDataPoints) {
    chartData.value.shift()
  }
  
  // 重新绘制图表
  drawChart()
}

// 切换自动滚动
function toggleAutoScroll() {
  autoScroll.value = !autoScroll.value
}

// 清空图表
function clearChart() {
  chartData.value = []
  drawChart()
}

// 格式化时间
function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN')
}

// 绘制图表
function drawChart() {
  const canvas = chartCanvas.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  if (chartData.value.length === 0) return
  
  // 图表边距
  const margin = { top: 20, right: 20, bottom: 40, left: 60 }
  const width = canvas.width - margin.left - margin.right
  const height = canvas.height - margin.top - margin.bottom
  
  // 计算数据范围
  const minValue = Math.min(...chartData.value.map(d => d.pm25))
  const maxValue = Math.max(...chartData.value.map(d => d.pm25))
  const valueRange = maxValue - minValue || 1
  
  // 绘制网格线
  ctx.strokeStyle = '#e5e5e5'
  ctx.lineWidth = 1
  
  // 水平网格线
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + (height * i) / 5
    ctx.beginPath()
    ctx.moveTo(margin.left, y)
    ctx.lineTo(margin.left + width, y)
    ctx.stroke()
  }
  
  // 垂直网格线
  for (let i = 0; i <= 6; i++) {
    const x = margin.left + (width * i) / 6
    ctx.beginPath()
    ctx.moveTo(x, margin.top)
    ctx.lineTo(x, margin.top + height)
    ctx.stroke()
  }
  
  // 绘制数据点和连线
  if (chartData.value.length > 1) {
    // 绘制连线
    ctx.strokeStyle = '#4f46e5'
    ctx.lineWidth = 2
    ctx.beginPath()
    
    chartData.value.forEach((point, index) => {
      const x = margin.left + (width * index) / (maxDataPoints - 1)
      const y = margin.top + height - ((point.pm25 - minValue) / valueRange) * height
      
      if (index === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    
    ctx.stroke()
  }
  
  // 绘制数据点
  chartData.value.forEach((point, index) => {
    const x = margin.left + (width * index) / (maxDataPoints - 1)
    const y = margin.top + height - ((point.pm25 - minValue) / valueRange) * height
    
    // 数据点样式
    ctx.beginPath()
    ctx.arc(x, y, point.isAnomaly ? 6 : 4, 0, 2 * Math.PI)
    ctx.fillStyle = point.isAnomaly ? '#ef4444' : '#4f46e5'
    ctx.fill()
    
    // 异常点外圈
    if (point.isAnomaly) {
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, 2 * Math.PI)
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  })
  
  // 绘制Y轴标签
  ctx.fillStyle = '#666'
  ctx.font = '12px system-ui'
  ctx.textAlign = 'right'
  
  for (let i = 0; i <= 5; i++) {
    const value = minValue + (valueRange * (5 - i)) / 5
    const y = margin.top + (height * i) / 5
    ctx.fillText(value.toFixed(1), margin.left - 10, y + 4)
  }
  
  // Y轴标题
  ctx.save()
  ctx.translate(20, margin.top + height / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.font = '14px system-ui'
  ctx.fillText('PM2.5 (μg/m³)', 0, 0)
  ctx.restore()
}

// 处理画布点击和鼠标移动
function handleCanvasMouseMove(event: MouseEvent) {
  const canvas = chartCanvas.value
  if (!canvas || chartData.value.length === 0) return
  
  const rect = canvas.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  
  // 检查是否悬停在数据点上
  const margin = { top: 20, right: 20, bottom: 40, left: 60 }
  const width = canvas.width - margin.left - margin.right
  const height = canvas.height - margin.top - margin.bottom
  
  const minValue = Math.min(...chartData.value.map(d => d.pm25))
  const maxValue = Math.max(...chartData.value.map(d => d.pm25))
  const valueRange = maxValue - minValue || 1
  
  let found = false
  
  chartData.value.forEach((point, index) => {
    const x = margin.left + (width * index) / (maxDataPoints - 1)
    const y = margin.top + height - ((point.pm25 - minValue) / valueRange) * height
    
    const distance = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2)
    
    if (distance <= 10) {
      hoveredPoint.value = {
        x: event.clientX - rect.left + 10,
        y: event.clientY - rect.top - 10,
        data: point
      }
      found = true
    }
  })
  
  if (!found) {
    hoveredPoint.value = null
  }
}

// 调整画布大小
function resizeCanvas() {
  if (!chartContainer.value || !chartCanvas.value) return
  
  const container = chartContainer.value
  const containerWidth = container.clientWidth
  const containerHeight = 400
  
  canvasSize.value = {
    width: containerWidth,
    height: containerHeight
  }
  
  nextTick(() => {
    drawChart()
  })
}

// 组件挂载
onMounted(() => {
  console.log('RealtimeChart组件已挂载')
  
  // 初始化画布大小
  resizeCanvas()
  
  // 监听窗口大小变化
  window.addEventListener('resize', resizeCanvas)
  
  // 添加鼠标事件监听
  if (chartCanvas.value) {
    chartCanvas.value.addEventListener('mousemove', handleCanvasMouseMove)
    chartCanvas.value.addEventListener('mouseleave', () => {
      hoveredPoint.value = null
    })
  }
  
  // 如果已有数据，添加到图表
  if (sensorStore.sensorData.length > 0) {
    const recentData = sensorStore.sensorData.slice(-maxDataPoints)
    chartData.value = [...recentData]
    drawChart()
  }
})

// 组件卸载
onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  
  if (chartCanvas.value) {
    chartCanvas.value.removeEventListener('mousemove', handleCanvasMouseMove)
  }
})
</script>

<style scoped>
.realtime-chart-container {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-sm));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-4) var(--spacing-6);
  background: rgba(255, 255, 255, 0.5);
  border-bottom: 1px solid var(--glass-border);
}

.chart-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.title-icon {
  font-size: var(--font-size-xl);
}

.chart-title h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.chart-subtitle {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.chart-controls {
  display: flex;
  gap: var(--spacing-2);
}

.control-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-2) var(--spacing-3);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-200) var(--easing-smooth);
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.9);
  color: var(--color-text-primary);
  transform: translateY(-1px);
}

.control-btn.active {
  background: var(--gradient-primary);
  color: white;
  border-color: transparent;
}

.chart-content {
  padding: var(--spacing-4);
}

.chart-canvas-container {
  position: relative;
  width: 100%;
  height: 400px;
  margin-bottom: var(--spacing-4);
}

canvas {
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.tooltip {
  position: absolute;
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  pointer-events: none;
  z-index: 1000;
  min-width: 200px;
}

.tooltip-header {
  margin-bottom: var(--spacing-1);
}

.tooltip-body > div {
  margin-bottom: var(--spacing-1);
}

.tooltip-body > div:last-child {
  margin-bottom: 0;
}

.anomaly-info {
  color: #ff6b6b !important;
  font-weight: var(--font-weight-medium);
}

.chart-legend {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: var(--spacing-4);
  border-top: 1px solid var(--glass-border);
}

.legend-items {
  display: flex;
  gap: var(--spacing-4);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
}

.legend-color.normal {
  background: #4f46e5;
}

.legend-color.anomaly {
  background: #ef4444;
}

.chart-stats {
  display: flex;
  gap: var(--spacing-4);
}

.stat-item {
  display: flex;
  gap: var(--spacing-1);
  font-size: var(--font-size-sm);
}

.stat-label {
  color: var(--color-text-secondary);
}

.stat-value {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.stat-value.anomaly {
  color: var(--color-error);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chart-header {
    flex-direction: column;
    gap: var(--spacing-3);
    align-items: flex-start;
  }
  
  .chart-legend {
    flex-direction: column;
    gap: var(--spacing-3);
    align-items: flex-start;
  }
  
  .chart-stats {
    flex-wrap: wrap;
  }
}
</style>