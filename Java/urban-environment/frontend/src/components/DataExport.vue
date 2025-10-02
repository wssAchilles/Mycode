<template>
  <div class="export-panel">
    <div class="panel-header">
      <h3>数据导出</h3>
      <div class="export-stats">
        <span>当前数据: {{ totalData }} 条</span>
        <span v-if="anomalyData > 0">异常数据: {{ anomalyData }} 条</span>
      </div>
    </div>

    <div class="export-options">
      <!-- 导出格式 -->
      <div class="option-group">
        <label class="group-title">导出格式</label>
        <div class="radio-group">
          <label class="radio-item">
            <input type="radio" v-model="exportOptions.format" value="csv" />
            <span>📊 CSV格式</span>
          </label>
          <label class="radio-item">
            <input type="radio" v-model="exportOptions.format" value="excel" />
            <span>📈 Excel格式</span>
          </label>
        </div>
      </div>

      <!-- 数据筛选 -->
      <div class="option-group">
        <label class="group-title">数据筛选</label>
        <div class="checkbox-group">
          <label class="checkbox-item">
            <input type="checkbox" v-model="exportOptions.anomaliesOnly" />
            <span>仅导出异常数据</span>
          </label>
          <label class="checkbox-item">
            <input type="checkbox" v-model="exportOptions.includeHeaders" />
            <span>包含表头</span>
          </label>
        </div>
      </div>

      <!-- 日期范围 -->
      <div class="option-group">
        <label class="group-title">日期范围（可选）</label>
        <div class="date-range">
          <div class="date-input">
            <label>开始时间:</label>
            <input 
              type="datetime-local" 
              v-model="startDate"
              :max="endDate || currentDateTime"
            />
          </div>
          <div class="date-input">
            <label>结束时间:</label>
            <input 
              type="datetime-local" 
              v-model="endDate"
              :min="startDate"
              :max="currentDateTime"
            />
          </div>
        </div>
      </div>

      <!-- 自定义文件名 -->
      <div class="option-group">
        <label class="group-title">文件名（可选）</label>
        <input 
          type="text" 
          v-model="exportOptions.filename"
          placeholder="留空将自动生成文件名"
          class="filename-input"
        />
      </div>
    </div>

    <!-- 导出按钮 -->
    <div class="export-actions">
      <button 
        @click="handleExport"
        :disabled="loading || totalData === 0"
        class="export-btn primary"
      >
        <span v-if="loading">导出中...</span>
        <span v-else>📤 导出数据</span>
      </button>
      
      <button 
        @click="handleExportReport"
        :disabled="loading || totalData === 0"
        class="export-btn secondary"
      >
        <span v-if="loading">生成中...</span>
        <span v-else">📋 生成报告</span>
      </button>
    </div>

    <!-- 预览信息 -->
    <div class="preview-info" v-if="previewData">
      <h4>导出预览</h4>
      <div class="preview-stats">
        <div class="stat-item">
          <span class="label">将导出数据:</span>
          <span class="value">{{ previewData.count }} 条</span>
        </div>
        <div class="stat-item" v-if="previewData.anomalies > 0">
          <span class="label">异常数据:</span>
          <span class="value highlight">{{ previewData.anomalies }} 条</span>
        </div>
        <div class="stat-item">
          <span class="label">时间范围:</span>
          <span class="value">{{ previewData.timeRange }}</span>
        </div>
        <div class="stat-item">
          <span class="label">文件大小:</span>
          <span class="value">约 {{ previewData.estimatedSize }}</span>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div class="error-message" v-if="error">
      <span class="error-icon">⚠️</span>
      <span>{{ error }}</span>
      <button @click="clearError" class="close-error">×</button>
    </div>

    <!-- 成功提示 -->
    <div class="success-message" v-if="success">
      <span class="success-icon">✅</span>
      <span>{{ success }}</span>
      <button @click="clearSuccess" class="close-success">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSensorDataStore } from '@/stores/sensorData'
import { dataExportService, type ExportOptions } from '@/services/exportService'
import type { SensorData } from '@/services/websocket'

// 状态管理
const sensorStore = useSensorDataStore()

// 响应式数据
const loading = ref(false)
const error = ref('')
const success = ref('')

const exportOptions = ref<ExportOptions>({
  format: 'csv',
  includeHeaders: true,
  anomaliesOnly: false
})

const startDate = ref('')
const endDate = ref('')

// 计算属性
const currentDateTime = computed(() => {
  return new Date().toISOString().slice(0, 16)
})

const totalData = computed(() => sensorStore.latestData.length)
const anomalyData = computed(() => 
  sensorStore.latestData.filter(item => item.isAnomaly).length
)

const previewData = computed(() => {
  if (totalData.value === 0) return null

  let filtered = [...sensorStore.latestData]
  
  // 按日期范围过滤
  if (startDate.value && endDate.value) {
    const start = new Date(startDate.value)
    const end = new Date(endDate.value)
    filtered = filtered.filter(item => {
      const timestamp = new Date(item.timestamp)
      return timestamp >= start && timestamp <= end
    })
  }
  
  // 按异常过滤
  if (exportOptions.value.anomaliesOnly) {
    filtered = filtered.filter(item => item.isAnomaly)
  }

  if (filtered.length === 0) return null

  const anomalies = filtered.filter(item => item.isAnomaly).length
  const timestamps = filtered.map(item => new Date(item.timestamp))
  const minTime = new Date(Math.min(...timestamps.map(t => t.getTime())))
  const maxTime = new Date(Math.max(...timestamps.map(t => t.getTime())))
  
  // 估算文件大小（每条记录约100字节）
  const estimatedBytes = filtered.length * 100
  const estimatedSize = formatFileSize(estimatedBytes)

  return {
    count: filtered.length,
    anomalies,
    timeRange: `${minTime.toLocaleString('zh-CN')} - ${maxTime.toLocaleString('zh-CN')}`,
    estimatedSize
  }
})

// 监听日期范围变化
watch([startDate, endDate], () => {
  if (startDate.value && endDate.value) {
    exportOptions.value.dateRange = {
      start: new Date(startDate.value),
      end: new Date(endDate.value)
    }
  } else {
    delete exportOptions.value.dateRange
  }
})

// 方法
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function handleExport() {
  if (totalData.value === 0) {
    error.value = '没有可导出的数据'
    return
  }

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    // 验证数据
    const validation = dataExportService.validateData(sensorStore.latestData)
    if (!validation.valid) {
      throw new Error(validation.message)
    }

    // 执行导出
    await dataExportService.exportData(sensorStore.latestData, exportOptions.value)
    
    const format = exportOptions.value.format.toUpperCase()
    const count = previewData.value?.count || totalData.value
    success.value = `成功导出 ${count} 条数据为 ${format} 格式`
    
  } catch (err) {
    console.error('导出失败:', err)
    error.value = err instanceof Error ? err.message : '导出失败，请重试'
  } finally {
    loading.value = false
  }
}

async function handleExportReport() {
  if (totalData.value === 0) {
    error.value = '没有可生成报告的数据'
    return
  }

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    await dataExportService.exportReport(sensorStore.latestData)
    success.value = '成功生成并下载数据分析报告'
  } catch (err) {
    console.error('报告生成失败:', err)
    error.value = err instanceof Error ? err.message : '报告生成失败，请重试'
  } finally {
    loading.value = false
  }
}

function clearError() {
  error.value = ''
}

function clearSuccess() {
  success.value = ''
}
</script>

<style scoped>
.export-panel {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background-color: #fafafa;
  border-bottom: 1px solid #e0e0e0;
}

.panel-header h3 {
  margin: 0;
  color: #333;
  font-size: 18px;
  font-weight: 600;
}

.export-stats {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #666;
}

.export-options {
  padding: 24px;
}

.option-group {
  margin-bottom: 24px;
}

.option-group:last-child {
  margin-bottom: 0;
}

.group-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 12px;
}

.radio-group, .checkbox-group {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.radio-item, .checkbox-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 0;
  font-size: 14px;
  color: #555;
}

.radio-item input, .checkbox-item input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.date-range {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.date-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.date-input label {
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.date-input input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.filename-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.export-actions {
  display: flex;
  gap: 12px;
  padding: 20px 24px;
  background-color: #fafafa;
  border-top: 1px solid #e0e0e0;
}

.export-btn {
  flex: 1;
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.export-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.export-btn.primary {
  background-color: #2196f3;
  color: white;
}

.export-btn.primary:hover:not(:disabled) {
  background-color: #1976d2;
}

.export-btn.secondary {
  background-color: #fff;
  color: #2196f3;
  border: 1px solid #2196f3;
}

.export-btn.secondary:hover:not(:disabled) {
  background-color: #f5f5f5;
}

.preview-info {
  padding: 20px 24px;
  background-color: #f8f9fa;
  border-top: 1px solid #e0e0e0;
}

.preview-info h4 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 16px;
  font-weight: 600;
}

.preview-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.stat-item .label {
  color: #666;
}

.stat-item .value {
  color: #333;
  font-weight: 600;
}

.stat-item .value.highlight {
  color: #f44336;
}

.error-message, .success-message {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  font-size: 14px;
}

.error-message {
  background-color: #ffebee;
  color: #d32f2f;
  border-top: 1px solid #ffcdd2;
}

.success-message {
  background-color: #e8f5e8;
  color: #2e7d32;
  border-top: 1px solid #c8e6c9;
}

.close-error, .close-success {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  margin-left: auto;
}

.close-error:hover, .close-success:hover {
  opacity: 1;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .panel-header {
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  
  .export-stats {
    flex-direction: column;
    gap: 8px;
  }
  
  .date-range {
    grid-template-columns: 1fr;
  }
  
  .export-actions {
    flex-direction: column;
  }
  
  .preview-stats {
    grid-template-columns: 1fr;
  }
}
</style>