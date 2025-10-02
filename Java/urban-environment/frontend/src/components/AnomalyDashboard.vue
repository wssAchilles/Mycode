<template>
  <div class="anomaly-dashboard bg-particles animate-fadeIn">
    <!-- 现代化导航栏头部 -->
    <div class="dashboard-header card bg-gradient-animated hover-glow">
      <div class="header-content">
        <div class="brand-section animate-slideInLeft">
          <div class="brand-icon">🌍</div>
          <div class="brand-text">
            <h2 class="dashboard-title">AI异常检测仪表板</h2>
            <p class="dashboard-subtitle">智能环境监控系统</p>
          </div>
        </div>
        
        <div class="status-section animate-slideInRight">
          <div class="refresh-indicator" :class="{ active: isUpdating }">
            <span class="refresh-icon">🔄</span>
            <span class="status-text">{{ isUpdating ? '数据更新中...' : '实时监控中' }}</span>
          </div>
          <div class="connection-status online">
            <span class="status-dot"></span>
            <span class="text-sm">系统在线</span>
          </div>
        </div>
      </div>
    </div>

    <div class="dashboard-content space-y-8">
      <!-- 统计概览卡片 - 使用新设计 -->
      <div class="stats-section animate-fadeInUp">
        <ResponsiveGrid :columns="4" gap="lg" class="stats-grid">
          <div class="stat-card stat-primary hover-lift animate-zoomIn" style="animation-delay: 0.1s">
            <div class="stat-icon">📊</div>
            <div class="stat-content">
              <div class="stat-value">{{ sensorStore.anomalyStats.total }}</div>
              <div class="stat-label">总数据量</div>
              <div class="stat-trend up">↗ +12.5%</div>
            </div>
            <div class="stat-background"></div>
          </div>
          
          <div class="stat-card stat-warning hover-lift animate-zoomIn" style="animation-delay: 0.2s">
            <div class="stat-icon">⚠️</div>
            <div class="stat-content">
              <div class="stat-value">{{ sensorStore.anomalyStats.anomalies }}</div>
              <div class="stat-label">异常数量</div>
              <div class="stat-trend up">↗ +3.2%</div>
            </div>
            <div class="stat-background"></div>
          </div>
          
          <div class="stat-card stat-info hover-lift animate-zoomIn" style="animation-delay: 0.3s">
            <div class="stat-icon">📈</div>
            <div class="stat-content">
              <div class="stat-value">{{ sensorStore.anomalyStats.rate }}%</div>
              <div class="stat-label">异常率</div>
              <div class="stat-trend down">↘ -1.8%</div>
            </div>
            <div class="stat-background"></div>
          </div>
          
          <div class="stat-card stat-danger hover-lift animate-zoomIn" style="animation-delay: 0.4s">
            <div class="stat-icon">🚨</div>
            <div class="stat-content">
              <div class="stat-value">{{ sensorStore.highRiskAnomalies.length }}</div>
              <div class="stat-label">高风险异常</div>
              <div class="stat-trend up">↗ +5.4%</div>
            </div>
            <div class="stat-background"></div>
          </div>
        </ResponsiveGrid>
      </div>

      <!-- 主要功能区域 - 现代化布局 -->
      <div class="main-sections animate-slideInUp">
        <ResponsiveGrid :columns="2" gap="lg">
          <!-- 最近异常列表 - 现代化设计 -->
          <div class="recent-anomalies card hover-glow animate-fadeInUp" style="animation-delay: 0.5s">
            <div class="section-header">
              <div class="header-left">
                <div class="section-icon">🔍</div>
                <div class="header-text">
                  <h3 class="section-title">最近异常检测</h3>
                  <p class="section-description">实时异常数据监控</p>
                </div>
              </div>
              <div class="header-actions">
                <button @click="refreshData" class="btn btn-glass btn-sm hover-scale">
                  <span class="btn-icon">🔄</span>
                  刷新
                </button>
              </div>
            </div>
            
            <div class="anomaly-list" v-if="recentAnomalies.length > 0">
              <div 
                v-for="(anomaly, index) in recentAnomalies" 
                :key="`${anomaly.deviceId}-${anomaly.timestamp}`"
                class="anomaly-item hover-lift"
                :class="{ 'high-risk': (anomaly.confidence || 0) > 0.7 }"
                :style="{ animationDelay: `${0.1 * index}s` }"
              >
                <div class="anomaly-header">
                  <div class="device-info">
                    <div class="device-id">
                      <span class="device-icon">📱</span>
                      设备 {{ anomaly.deviceId }}
                    </div>
                    <div class="timestamp">{{ formatTimestamp(anomaly.timestamp) }}</div>
                  </div>
                  <div class="risk-level">
                    <div class="risk-badge" :class="getRiskLevel(anomaly.confidence || 0)">
                      <span class="risk-dot"></span>
                      {{ getRiskText(anomaly.confidence || 0) }}
                    </div>
                  </div>
                </div>
                
                <div class="anomaly-details">
                  <div class="detail-grid">
                    <div class="detail-item">
                      <div class="detail-icon pm25">🌫️</div>
                      <div class="detail-content">
                        <span class="label">PM2.5</span>
                        <span class="value">{{ anomaly.pm25 }} µg/m³</span>
                      </div>
                    </div>
                    <div class="detail-item">
                      <div class="detail-icon score">⚡</div>
                      <div class="detail-content">
                        <span class="label">异常分数</span>
                        <span class="value">{{ anomaly.anomalyScore?.toFixed(4) }}</span>
                      </div>
                    </div>
                    <div class="detail-item">
                      <div class="detail-icon confidence">🎯</div>
                      <div class="detail-content">
                        <span class="label">置信度</span>
                        <span class="value">{{ ((anomaly.confidence || 0) * 100).toFixed(1) }}%</span>
                      </div>
                    </div>
                    <div class="detail-item">
                      <div class="detail-icon location">📍</div>
                      <div class="detail-content">
                        <span class="label">位置</span>
                        <span class="value">{{ anomaly.latitude.toFixed(4) }}, {{ anomaly.longitude.toFixed(4) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div class="anomaly-actions">
                  <button class="action-btn view-btn btn-xs">
                    <span>👁️</span>
                    查看详情
                  </button>
                  <button class="action-btn export-btn btn-xs">
                    <span>📤</span>
                    导出数据
                  </button>
                </div>
              </div>
            </div>
            
            <div v-else class="no-anomalies animate-fadeIn">
              <div class="no-data-illustration">
                <div class="no-data-icon animate-float">✅</div>
                <div class="no-data-content">
                  <h4 class="no-data-title">系统运行正常</h4>
                  <p class="no-data-message">当前没有检测到异常数据</p>
                  <small class="no-data-tip">系统持续监控中...</small>
                </div>
              </div>
            </div>
          </div>

          <!-- 异常趋势图表区域 - 现代化占位符 -->
          <div class="chart-section card hover-glow animate-fadeInUp" style="animation-delay: 0.6s">
            <div class="section-header">
              <div class="header-left">
                <div class="section-icon">📊</div>
                <div class="header-text">
                  <h3 class="section-title">异常检测趋势</h3>
                  <p class="section-description">实时数据可视化分析</p>
                </div>
              </div>
              <div class="header-actions">
                <div class="time-range-selector">
                  <button class="time-btn active">24H</button>
                  <button class="time-btn">7D</button>
                  <button class="time-btn">30D</button>
                </div>
              </div>
            </div>
            
            <div class="chart-placeholder">
              <div class="chart-animation animate-pulse">
                <div class="chart-icon animate-glow">📊</div>
                <div class="chart-content">
                  <h4 class="chart-title">实时图表系统</h4>
                  <p class="chart-description">异常趋势图表正在开发中...</p>
                  <div class="feature-list">
                    <div class="feature-item">✨ 实时数据更新</div>
                    <div class="feature-item">📈 趋势分析图表</div>
                    <div class="feature-item">🔍 交互式数据探索</div>
                  </div>
                  <button class="btn btn-gradient-cosmic btn-sm mt-4 hover-scale">
                    <span>🚀</span>
                    敬请期待
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ResponsiveGrid>
      </div>

      <!-- 设置和导出区域 - 现代化设计 -->
      <div class="settings-sections animate-slideInUp">
        <ResponsiveGrid :columns="2" gap="lg">
          <!-- 警报设置 -->
          <div class="alert-settings-wrapper animate-fadeInUp" style="animation-delay: 0.7s">
            <AlertSettings />
          </div>

          <!-- 数据导出 -->
          <div class="data-export-wrapper animate-fadeInUp" style="animation-delay: 0.8s">
            <DataExport />
          </div>
        </ResponsiveGrid>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSensorDataStore } from '@/stores/sensorData'
import { alertService, createAnomalyAlert } from '@/services/alertService'
import AlertSettings from '@/components/AlertSettings.vue'
import DataExport from '@/components/DataExport.vue'
import ResponsiveGrid from '@/components/ResponsiveGrid.vue'
import type { SensorData } from '@/services/websocket'

// 状态管理
const sensorStore = useSensorDataStore()
const isUpdating = ref(false)

// 计算最近的异常数据
const recentAnomalies = computed(() => {
  return sensorStore.getRecentAnomalies(20)
})

// 格式化时间戳
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  if (diffMins < 1) {
    return '刚刚'
  } else if (diffMins < 60) {
    return `${diffMins}分钟前`
  } else if (diffMins < 1440) {
    const hours = Math.floor(diffMins / 60)
    return `${hours}小时前`
  } else {
    return date.toLocaleString('zh-CN')
  }
}

// 获取风险等级样式类
function getRiskLevel(confidence: number): string {
  if (confidence >= 0.8) return 'critical'
  if (confidence >= 0.7) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}

// 获取风险等级文字
function getRiskText(confidence: number): string {
  if (confidence >= 0.8) return '严重'
  if (confidence >= 0.7) return '高风险'
  if (confidence >= 0.5) return '中风险'
  return '低风险'
}

// 刷新数据
function refreshData() {
  isUpdating.value = true
  // 模拟刷新延迟
  setTimeout(() => {
    isUpdating.value = false
  }, 1000)
}

// 组件挂载时的操作
onMounted(() => {
  // 可以在这里添加定时刷新逻辑
})

onUnmounted(() => {
  // 清理定时器等
})
</script>

<style scoped>
/* === 仪表板主容器 === */
.anomaly-dashboard {
  min-height: 100vh;
  padding: var(--spacing-6);
  position: relative;
  overflow: hidden;
}

/* === 现代化头部设计 === */
.dashboard-header {
  margin-bottom: var(--spacing-8);
  position: relative;
  overflow: hidden;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-6) var(--spacing-8);
  position: relative;
  z-index: 2;
}

.brand-section {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
}

.brand-icon {
  font-size: var(--font-size-4xl);
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
  animation: float 3s ease-in-out infinite;
}

.brand-text .dashboard-title {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  font-family: var(--font-family-display);
  margin: 0 0 var(--spacing-1) 0;
  background: linear-gradient(135deg, #667eea, #764ba2, #f093fb);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.dashboard-subtitle {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.8;
}

.status-section {
  display: flex;
  align-items: center;
  gap: var(--spacing-6);
}

.refresh-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-3) var(--spacing-5);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-backdrop-filter);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: all var(--duration-300) var(--easing-spring);
}

.refresh-indicator.active {
  background: rgba(59, 130, 246, 0.1);
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  box-shadow: var(--shadow-glow);
}

.refresh-icon {
  font-size: var(--font-size-base);
  animation: spin-modern 2s linear infinite;
}

.refresh-indicator.active .refresh-icon {
  animation-duration: 0.8s;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-4);
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: var(--radius-xl);
  font-weight: var(--font-weight-medium);
  color: var(--color-success);
}

.status-dot {
  width: 8px;
  height: 8px;
  background: var(--color-success);
  border-radius: var(--radius-full);
  animation: pulse 2s ease-in-out infinite;
}

/* === 统计卡片现代化设计 === */
.stats-section {
  margin-bottom: var(--spacing-8);
}

.stat-card {
  position: relative;
  padding: var(--spacing-6);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: all var(--duration-300) var(--easing-spring);
  cursor: pointer;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0.1;
  transition: opacity var(--duration-300) var(--easing-out);
  z-index: 0;
}

.stat-card.stat-primary::before {
  background: var(--gradient-primary);
}

.stat-card.stat-warning::before {
  background: var(--gradient-warning);
}

.stat-card.stat-info::before {
  background: var(--gradient-success);
}

.stat-card.stat-danger::before {
  background: var(--gradient-danger);
}

.stat-card:hover::before {
  opacity: 0.15;
}

.stat-icon {
  font-size: var(--font-size-3xl);
  margin-bottom: var(--spacing-3);
  position: relative;
  z-index: 1;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.stat-content {
  position: relative;
  z-index: 1;
}

.stat-value {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-black);
  font-family: var(--font-family-display);
  line-height: var(--line-height-none);
  margin-bottom: var(--spacing-2);
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--spacing-1);
}

.stat-trend {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--radius-sm);
  display: inline-block;
}

.stat-trend.up {
  background: rgba(16, 185, 129, 0.1);
  color: var(--color-success);
}

.stat-trend.down {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
}

/* === 主要内容区域 === */
.main-sections {
  margin-bottom: var(--spacing-8);
}

/* === 异常列表现代化设计 === */
.recent-anomalies {
  height: fit-content;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-6) var(--spacing-8);
  border-bottom: 1px solid var(--color-outline-variant);
  margin-bottom: var(--spacing-6);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.section-icon {
  font-size: var(--font-size-2xl);
  opacity: 0.8;
}

.header-text .section-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  font-family: var(--font-family-display);
  margin: 0 0 var(--spacing-1) 0;
  color: var(--color-text-primary);
}

.section-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: var(--spacing-3);
}

/* === 异常项目现代化样式 === */
.anomaly-list {
  max-height: 600px;
  overflow-y: auto;
  padding: 0 var(--spacing-4);
}

/* 自定义滚动条 */
.anomaly-list::-webkit-scrollbar {
  width: 6px;
}

.anomaly-list::-webkit-scrollbar-track {
  background: var(--color-surface-100);
  border-radius: var(--radius-full);
}

.anomaly-list::-webkit-scrollbar-thumb {
  background: var(--color-surface-300);
  border-radius: var(--radius-full);
}

.anomaly-list::-webkit-scrollbar-thumb:hover {
  background: var(--color-primary-400);
}

.anomaly-item {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-backdrop-filter);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: var(--spacing-5);
  margin-bottom: var(--spacing-4);
  transition: all var(--duration-300) var(--easing-spring);
  position: relative;
  overflow: hidden;
}

.anomaly-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: var(--gradient-primary);
  opacity: 0;
  transition: opacity var(--duration-300) var(--easing-out);
}

.anomaly-item:hover::before {
  opacity: 1;
}

.anomaly-item.high-risk {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.05);
}

.anomaly-item.high-risk::before {
  background: var(--gradient-danger);
  opacity: 1;
}

.anomaly-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-4);
}

.device-info .device-id {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  margin-bottom: var(--spacing-1);
}

.device-icon {
  font-size: var(--font-size-sm);
  opacity: 0.7;
}

.timestamp {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  font-weight: var(--font-weight-medium);
}

.risk-badge {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-1_5) var(--spacing-3);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.risk-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  animation: pulse 2s ease-in-out infinite;
}

.risk-badge.critical {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.risk-badge.critical .risk-dot {
  background: var(--color-error);
}

.risk-badge.high {
  background: rgba(245, 158, 11, 0.1);
  color: var(--color-warning);
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.risk-badge.high .risk-dot {
  background: var(--color-warning);
}

.risk-badge.medium {
  background: rgba(59, 130, 246, 0.1);
  color: var(--color-info);
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.risk-badge.medium .risk-dot {
  background: var(--color-info);
}

.risk-badge.low {
  background: rgba(16, 185, 129, 0.1);
  color: var(--color-success);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.risk-badge.low .risk-dot {
  background: var(--color-success);
}

/* === 详情网格布局 === */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-4);
}

.detail-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2);
  background: rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg);
  transition: all var(--duration-200) var(--easing-out);
}

.detail-item:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-1px);
}

.detail-icon {
  font-size: var(--font-size-sm);
  width: 20px;
  text-align: center;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-0_5);
  flex: 1;
}

.detail-content .label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-content .value {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-family: var(--font-family-mono);
}

/* === 操作按钮 === */
.anomaly-actions {
  display: flex;
  gap: var(--spacing-2);
  justify-content: flex-end;
  padding-top: var(--spacing-3);
  border-top: 1px solid var(--color-outline-variant);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-1_5) var(--spacing-3);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-200) var(--easing-spring);
}

.action-btn:hover {
  background: var(--color-primary-50);
  color: var(--color-primary-600);
  border-color: var(--color-primary-300);
  transform: translateY(-1px);
}

/* === 无数据状态 === */
.no-anomalies {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
  padding: var(--spacing-8);
}

.no-data-illustration {
  text-align: center;
}

.no-data-icon {
  font-size: var(--font-size-6xl);
  margin-bottom: var(--spacing-4);
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.1));
}

.no-data-content .no-data-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-2) 0;
}

.no-data-message {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
  margin: 0 0 var(--spacing-2) 0;
}

.no-data-tip {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  font-style: italic;
}

/* === 图表区域 === */
.chart-section {
  height: fit-content;
}

.time-range-selector {
  display: flex;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.time-btn {
  padding: var(--spacing-2) var(--spacing-4);
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--duration-200) var(--easing-out);
}

.time-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.time-btn.active {
  background: var(--color-primary-500);
  color: white;
}

.chart-placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  padding: var(--spacing-8);
}

.chart-animation {
  text-align: center;
  max-width: 320px;
}

.chart-content .chart-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin: var(--spacing-4) 0 var(--spacing-2) 0;
}

.chart-description {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
  margin: 0 0 var(--spacing-6) 0;
  line-height: var(--line-height-relaxed);
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-6);
}

.feature-item {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  text-align: left;
}

/* === 响应式设计 === */
@media (max-width: 1200px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .anomaly-dashboard {
    padding: var(--spacing-4);
  }
  
  .header-content {
    flex-direction: column;
    gap: var(--spacing-4);
    text-align: center;
  }
  
  .brand-section {
    flex-direction: column;
    text-align: center;
  }
  
  .dashboard-title {
    font-size: var(--font-size-2xl);
  }
  
  .status-section {
    justify-content: center;
  }
  
  .section-header {
    flex-direction: column;
    gap: var(--spacing-3);
    text-align: center;
  }
  
  .anomaly-actions {
    justify-content: center;
  }
  
  .time-range-selector {
    justify-content: center;
  }
}

@media (max-width: 480px) {
  .detail-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-2);
  }
  
  .detail-item {
    padding: var(--spacing-1_5);
  }
  
  .chart-placeholder {
    min-height: 300px;
    padding: var(--spacing-6);
  }
}
</style>