<template>
  <div class="filter-panel glass-card">
    <div class="panel-header">
      <h3>
        <span class="icon">🔍</span>
        数据筛选
      </h3>
      <button @click="resetFilters" class="reset-btn" v-if="hasActiveFilters">
        重置筛选
      </button>
    </div>

    <div class="filter-content">
      <!-- 时间范围筛选 -->
      <div class="filter-section">
        <h4 class="section-title">时间范围</h4>
        <div class="time-filter">
          <div class="quick-select">
            <button 
              v-for="option in timeOptions" 
              :key="option.value"
              @click="selectTimeRange(option.value)"
              :class="['time-btn', { active: activeTimeRange === option.value }]"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- PM2.5阈值筛选 -->
      <div class="filter-section">
        <h4 class="section-title">PM2.5 范围</h4>
        <div class="range-filter">
          <div class="range-inputs">
            <div class="input-group">
              <label>最小值</label>
              <input 
                type="number" 
                v-model.number="filters.pm25Min"
                min="0"
                max="500"
                step="0.1"
                placeholder="0"
              />
            </div>
            <div class="input-group">
              <label>最大值</label>
              <input 
                type="number" 
                v-model.number="filters.pm25Max"
                min="0"
                max="500"
                step="0.1"
                placeholder="500"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 异常状态筛选 -->
      <div class="filter-section">
        <h4 class="section-title">数据状态</h4>
        <div class="status-filter">
          <label class="checkbox-item">
            <input 
              type="checkbox" 
              v-model="filters.showNormal"
            />
            <span class="checkbox-label">
              <span class="status-dot normal"></span>
              正常数据
            </span>
          </label>
          <label class="checkbox-item">
            <input 
              type="checkbox" 
              v-model="filters.showAnomaly"
            />
            <span class="checkbox-label">
              <span class="status-dot anomaly"></span>
              异常数据
            </span>
          </label>
        </div>
      </div>
    </div>

    <!-- 应用按钮 -->
    <div class="filter-actions">
      <button @click="applyFilters" class="apply-btn primary">
        应用筛选
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSensorDataStore } from '@/stores/sensorData'
import type { SensorData } from '@/types/SensorData'

interface FilterOptions {
  startTime: string
  endTime: string
  pm25Min: number | null
  pm25Max: number | null
  showNormal: boolean
  showAnomaly: boolean
  selectedDevices: string[]
}

const emit = defineEmits<{
  filtersChanged: [filters: FilterOptions]
}>()

const sensorStore = useSensorDataStore()

const filters = ref<FilterOptions>({
  startTime: '',
  endTime: '',
  pm25Min: null,
  pm25Max: null,
  showNormal: true,
  showAnomaly: true,
  selectedDevices: []
})

const activeTimeRange = ref('24h')

const timeOptions = [
  { label: '1小时', value: '1h' },
  { label: '6小时', value: '6h' },
  { label: '24小时', value: '24h' },
  { label: '7天', value: '7d' },
  { label: '30天', value: '30d' }
]

const hasActiveFilters = computed(() => {
  return filters.value.pm25Min !== null || 
         filters.value.pm25Max !== null ||
         !filters.value.showNormal ||
         !filters.value.showAnomaly
})

function selectTimeRange(range: string) {
  activeTimeRange.value = range
  const now = new Date()
  let start = new Date()
  
  switch(range) {
    case '1h':
      start.setHours(now.getHours() - 1)
      break
    case '6h':
      start.setHours(now.getHours() - 6)
      break
    case '24h':
      start.setDate(now.getDate() - 1)
      break
    case '7d':
      start.setDate(now.getDate() - 7)
      break
    case '30d':
      start.setDate(now.getDate() - 30)
      break
  }
  
  filters.value.startTime = start.toISOString()
  filters.value.endTime = now.toISOString()
}

function applyFilters() {
  const filteredData = filterData()
  emit('filtersChanged', { ...filters.value })
  sensorStore.setFilteredData(filteredData)
}

function filterData(): SensorData[] {
  let data = [...sensorStore.latestData]
  
  if (filters.value.startTime) {
    const start = new Date(filters.value.startTime)
    data = data.filter(d => new Date(d.timestamp) >= start)
  }
  if (filters.value.endTime) {
    const end = new Date(filters.value.endTime)
    data = data.filter(d => new Date(d.timestamp) <= end)
  }
  
  if (filters.value.pm25Min !== null) {
    data = data.filter(d => d.pm25 >= filters.value.pm25Min!)
  }
  if (filters.value.pm25Max !== null) {
    data = data.filter(d => d.pm25 <= filters.value.pm25Max!)
  }
  
  if (!filters.value.showNormal) {
    data = data.filter(d => d.isAnomaly)
  }
  if (!filters.value.showAnomaly) {
    data = data.filter(d => !d.isAnomaly)
  }
  
  return data
}

function resetFilters() {
  filters.value = {
    startTime: '',
    endTime: '',
    pm25Min: null,
    pm25Max: null,
    showNormal: true,
    showAnomaly: true,
    selectedDevices: []
  }
  activeTimeRange.value = ''
  applyFilters()
}
</script>

<style scoped>
.filter-panel {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.reset-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;
}

.reset-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.filter-content {
  padding: 24px;
  max-height: 600px;
  overflow-y: auto;
}

.filter-section {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e0e0e0;
}

.filter-section:last-child {
  border-bottom: none;
}

.section-title {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.quick-select {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.time-btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: white;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;
}

.time-btn:hover {
  border-color: #667eea;
  color: #667eea;
}

.time-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-color: transparent;
}

.range-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-group label {
  font-size: 13px;
  color: #666;
}

.input-group input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.status-filter {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.normal {
  background: #4caf50;
}

.status-dot.anomaly {
  background: #f44336;
}

.filter-actions {
  padding: 20px 24px;
  background: #fafafa;
  border-top: 1px solid #e0e0e0;
  display: flex;
  gap: 12px;
}

.apply-btn {
  flex: 1;
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.apply-btn.primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.apply-btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

@media (max-width: 768px) {
  .filter-content {
    padding: 16px;
  }
  
  .range-inputs,
  .coord-inputs {
    grid-template-columns: 1fr;
  }
  
  .quick-select {
    flex-direction: column;
  }
  
  .time-btn {
    width: 100%;
  }
}
</style>
