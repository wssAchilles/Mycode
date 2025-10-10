<template>
  <div class="data-visualization">
    <!-- PM2.5 实时趋势图 -->
    <div class="chart-container">
      <div class="chart-header">
        <h3>PM2.5 实时趋势</h3>
        <div class="chart-controls">
          <button 
            v-for="range in timeRanges" 
            :key="range.value"
            @click="selectedRange = range.value"
            :class="['range-btn', { active: selectedRange === range.value }]"
          >
            {{ range.label }}
          </button>
        </div>
      </div>
      <div class="chart-wrapper">
        <canvas ref="trendChart"></canvas>
      </div>
    </div>

    <!-- 空气质量分布图 -->
    <div class="chart-container">
      <div class="chart-header">
        <h3>空气质量分布</h3>
        <span class="chart-subtitle">各区域PM2.5浓度</span>
      </div>
      <div class="distribution-chart">
        <div 
          v-for="area in areaData" 
          :key="area.name"
          class="area-bar"
        >
          <div class="bar-label">{{ area.name }}</div>
          <div class="bar-container">
            <div 
              class="bar-fill"
              :style="{ 
                width: (area.value / maxValue * 100) + '%',
                background: getGradient(area.value)
              }"
            >
              <span class="bar-value">{{ area.value }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 传感器状态饼图 -->
    <div class="chart-container">
      <div class="chart-header">
        <h3>传感器状态分布</h3>
      </div>
      <div class="pie-chart">
        <canvas ref="pieChart"></canvas>
        <div class="chart-legend">
          <div class="legend-item">
            <span class="legend-color" style="background: #22c55e"></span>
            <span>正常运行: {{ statusData.normal }}个</span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background: #f97316"></span>
            <span>轻度异常: {{ statusData.warning }}个</span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background: #ef4444"></span>
            <span>严重异常: {{ statusData.error }}个</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

// 时间范围选项
const timeRanges = [
  { label: '1小时', value: '1h' },
  { label: '6小时', value: '6h' },
  { label: '24小时', value: '24h' },
  { label: '7天', value: '7d' }
]

const selectedRange = ref('24h')

// 区域数据
const areaData = ref([
  { name: '朝阳区', value: 45 },
  { name: '海淀区', value: 78 },
  { name: '西城区', value: 32 },
  { name: '东城区', value: 56 },
  { name: '丰台区', value: 89 }
])

// 状态数据
const statusData = ref({
  normal: 5,
  warning: 2,
  error: 1
})

const maxValue = ref(100)
const trendChart = ref(null)
const pieChart = ref(null)

// 获取渐变色
function getGradient(value: number): string {
  if (value < 35) return 'linear-gradient(90deg, #22c55e, #10b981)'
  if (value < 75) return 'linear-gradient(90deg, #eab308, #f59e0b)'
  if (value < 115) return 'linear-gradient(90deg, #f97316, #ea580c)'
  return 'linear-gradient(90deg, #ef4444, #dc2626)'
}

// 绘制趋势图
function drawTrendChart() {
  if (!trendChart.value) return
  
  const ctx = trendChart.value.getContext('2d')
  const width = trendChart.value.width
  const height = trendChart.value.height
  
  // 清除画布
  ctx.clearRect(0, 0, width, height)
  
  // 生成模拟数据
  const points = 50
  const data = []
  for (let i = 0; i < points; i++) {
    data.push(Math.random() * 150 + 20)
  }
  
  // 绘制渐变背景
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)')
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0)')
  
  // 绘制曲线
  ctx.beginPath()
  ctx.moveTo(0, height - data[0] * height / 200)
  
  for (let i = 1; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width
    const y = height - (data[i] * height / 200)
    ctx.lineTo(x, y)
  }
  
  // 填充区域
  ctx.lineTo(width, height)
  ctx.lineTo(0, height)
  ctx.closePath()
  ctx.fillStyle = gradient
  ctx.fill()
  
  // 绘制线条
  ctx.beginPath()
  ctx.moveTo(0, height - data[0] * height / 200)
  for (let i = 1; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width
    const y = height - (data[i] * height / 200)
    ctx.lineTo(x, y)
  }
  ctx.strokeStyle = '#6366f1'
  ctx.lineWidth = 2
  ctx.stroke()
}

// 绘制饼图
function drawPieChart() {
  if (!pieChart.value) return
  
  const ctx = pieChart.value.getContext('2d')
  const width = pieChart.value.width
  const height = pieChart.value.height
  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) / 2 - 20
  
  // 清除画布
  ctx.clearRect(0, 0, width, height)
  
  // 数据
  const total = statusData.value.normal + statusData.value.warning + statusData.value.error
  const data = [
    { value: statusData.value.normal, color: '#22c55e' },
    { value: statusData.value.warning, color: '#f97316' },
    { value: statusData.value.error, color: '#ef4444' }
  ]
  
  let currentAngle = -Math.PI / 2
  
  data.forEach(segment => {
    const angle = (segment.value / total) * 2 * Math.PI
    
    // 绘制扇形
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + angle)
    ctx.lineTo(centerX, centerY)
    ctx.closePath()
    ctx.fillStyle = segment.color
    ctx.fill()
    
    currentAngle += angle
  })
  
  // 绘制中心圆
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius * 0.6, 0, 2 * Math.PI)
  ctx.fillStyle = '#1e293b'
  ctx.fill()
}

// 监听范围变化
watch(selectedRange, () => {
  drawTrendChart()
})

onMounted(() => {
  // 设置画布大小
  if (trendChart.value) {
    trendChart.value.width = trendChart.value.parentElement.offsetWidth
    trendChart.value.height = 200
    drawTrendChart()
  }
  
  if (pieChart.value) {
    pieChart.value.width = 200
    pieChart.value.height = 200
    drawPieChart()
  }
  
  // 模拟数据更新
  setInterval(() => {
    areaData.value.forEach(area => {
      area.value = Math.round(Math.random() * 100 + 20)
    })
    drawTrendChart()
  }, 5000)
})
</script>

<style scoped>
.data-visualization {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 20px;
  padding: 20px;
}

.chart-container {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 20px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.chart-header h3 {
  color: white;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.chart-subtitle {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
}

.chart-controls {
  display: flex;
  gap: 5px;
}

.range-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.7);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.range-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.range-btn.active {
  background: rgba(99, 102, 241, 0.3);
  border-color: #6366f1;
  color: white;
}

.chart-wrapper {
  position: relative;
  width: 100%;
  height: 200px;
}

.chart-wrapper canvas {
  width: 100%;
  height: 100%;
}

/* 分布图 */
.distribution-chart {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.area-bar {
  display: flex;
  align-items: center;
  gap: 15px;
}

.bar-label {
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  min-width: 60px;
}

.bar-container {
  flex: 1;
  height: 30px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 15px;
  overflow: hidden;
  position: relative;
}

.bar-fill {
  height: 100%;
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 10px;
  transition: width 0.5s ease;
}

.bar-value {
  color: white;
  font-size: 12px;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* 饼图 */
.pie-chart {
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 20px;
}

.pie-chart canvas {
  flex-shrink: 0;
}

.chart-legend {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .data-visualization {
    grid-template-columns: 1fr;
  }
}
</style>
