<template>
  <div class="alert-settings card hover-glow animate-fadeInUp">
    <!-- 现代化头部 -->
    <div class="settings-header">
      <div class="header-left">
        <div class="section-icon animate-glow">🔔</div>
        <div class="header-text">
          <h3 class="section-title">智能警报系统</h3>
          <p class="section-description">自定义异常检测通知</p>
        </div>
      </div>
      <div class="header-actions">
        <button @click="testAlert" class="btn btn-gradient-cosmic btn-sm hover-scale">
          <span class="btn-icon">🧪</span>
          测试警报
        </button>
      </div>
    </div>

    <div class="settings-content">
      <!-- 主开关 -->
      <div class="setting-group primary-toggle">
        <div class="toggle-container">
          <label class="modern-toggle">
            <input 
              type="checkbox" 
              v-model="localConfig.enabled"
              @change="updateConfig"
              class="toggle-input"
            />
            <span class="toggle-slider"></span>
            <span class="toggle-icon">🔔</span>
          </label>
          <div class="toggle-content">
            <div class="toggle-title">启用警报系统</div>
            <div class="toggle-description">开启后将实时监控异常并发送通知</div>
          </div>
        </div>
      </div>

      <!-- 警报类型选择 -->
      <div class="setting-group" v-if="localConfig.enabled">
        <div class="group-header">
          <div class="group-icon">🎯</div>
          <div class="group-title">通知方式</div>
        </div>
        
        <div class="notification-types">
          <label class="type-card" :class="{ active: localConfig.types.includes('browser') }">
            <input 
              type="checkbox" 
              v-model="localConfig.types"
              value="browser"
              @change="updateConfig"
              class="sr-only"
            />
            <div class="type-icon">🔔</div>
            <div class="type-content">
              <div class="type-title">浏览器通知</div>
              <div class="type-description">系统级弹窗提醒</div>
            </div>
            <div class="type-checkmark">✓</div>
          </label>

          <label class="type-card" :class="{ active: localConfig.types.includes('sound') }">
            <input 
              type="checkbox" 
              v-model="localConfig.types"
              value="sound"
              @change="updateConfig"
              class="sr-only"
            />
            <div class="type-icon">🔊</div>
            <div class="type-content">
              <div class="type-title">声音警报</div>
              <div class="type-description">音频提示通知</div>
            </div>
            <div class="type-checkmark">✓</div>
          </label>

          <label class="type-card" :class="{ active: localConfig.types.includes('popup') }">
            <input 
              type="checkbox" 
              v-model="localConfig.types"
              value="popup"
              @change="updateConfig"
              class="sr-only"
            />
            <div class="type-icon">💬</div>
            <div class="type-content">
              <div class="type-title">弹窗提醒</div>
              <div class="type-description">页面内通知提示</div>
            </div>
            <div class="type-checkmark">✓</div>
          </label>
        </div>
      </div>

      <!-- 高风险过滤 -->
      <div class="setting-group" v-if="localConfig.enabled">
        <div class="filter-setting">
          <label class="filter-toggle">
            <input 
              type="checkbox" 
              v-model="localConfig.highRiskOnly"
              @change="updateConfig"
              class="checkbox-input"
            />
            <span class="checkbox-custom"></span>
            <div class="filter-content">
              <div class="filter-title">🎯 高风险专属模式</div>
              <div class="filter-description">仅对置信度超过70%的严重异常发送警报</div>
            </div>
          </label>
        </div>
      </div>

      <!-- 音量控制 -->
      <div class="setting-group" v-if="localConfig.enabled && localConfig.types.includes('sound')">
        <div class="group-header">
          <div class="group-icon">🔊</div>
          <div class="group-title">音量设置</div>
        </div>
        
        <div class="volume-control">
          <div class="volume-slider-container">
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.1"
              v-model.number="localConfig.soundVolume"
              @input="updateConfig"
              class="volume-slider"
            />
            <div class="volume-track"></div>
            <div class="volume-progress" :style="{ width: `${localConfig.soundVolume * 100}%` }"></div>
            <div class="volume-thumb" :style="{ left: `${localConfig.soundVolume * 100}%` }"></div>
          </div>
          <div class="volume-display">
            <span class="volume-icon">{{ getVolumeIcon(localConfig.soundVolume) }}</span>
            <span class="volume-percentage">{{ Math.round(localConfig.soundVolume * 100) }}%</span>
          </div>
        </div>
      </div>

      <!-- 自动关闭时间 -->
      <div class="setting-group" v-if="localConfig.enabled && localConfig.types.includes('browser')">
        <div class="group-header">
          <div class="group-icon">⏱️</div>
          <div class="group-title">自动关闭</div>
        </div>
        
        <div class="time-control">
          <div class="time-input-container">
            <input 
              type="number" 
              min="0" 
              max="60" 
              v-model.number="localConfig.autoClose"
              @input="updateConfig"
              class="time-input"
            />
            <div class="input-unit">秒</div>
          </div>
          <div class="time-description">
            设为 0 表示需要手动关闭通知
          </div>
        </div>
      </div>
    </div>

    <!-- 最近警报历史 -->
    <div class="recent-alerts" v-if="recentAlerts.length > 0">
      <div class="alerts-header">
        <div class="header-left">
          <div class="section-icon">📋</div>
          <h4 class="alerts-title">最近警报记录</h4>
        </div>
        <button @click="clearAlerts" class="btn btn-outline btn-sm hover-scale">
          <span class="btn-icon">🗑️</span>
          清除全部
        </button>
      </div>
      
      <div class="alerts-list">
        <div 
          v-for="(alert, index) in recentAlerts" 
          :key="alert.id"
          class="alert-item hover-lift"
          :class="`alert-${alert.type}`"
          :style="{ animationDelay: `${0.1 * index}s` }"
        >
          <div class="alert-icon">
            {{ getAlertIcon(alert.type) }}
          </div>
          <div class="alert-content">
            <div class="alert-title">{{ alert.title }}</div>
            <div class="alert-message">{{ alert.message }}</div>
            <div class="alert-meta">
              <span class="alert-time">{{ formatTime(alert.timestamp) }}</span>
              <span class="alert-separator">•</span>
              <span class="alert-device">设备: {{ alert.deviceId }}</span>
            </div>
          </div>
          <button @click="removeAlert(alert.id)" class="remove-alert-btn hover-scale">
            <span>×</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { alertService, type AlertConfig, type AlertData } from '@/services/alertService'

// 响应式数据
const localConfig = ref<AlertConfig>({
  enabled: true,
  types: ['browser', 'sound', 'popup'],
  highRiskOnly: false,
  soundVolume: 0.5,
  autoClose: 10
})

const recentAlerts = ref<AlertData[]>([])

// 警报订阅取消函数
let unsubscribe: (() => void) | null = null

// 初始化
onMounted(() => {
  // 获取当前配置
  localConfig.value = alertService.getConfig()
  
  // 获取最近警报
  recentAlerts.value = alertService.getRecentAlerts(5)
  
  // 订阅新警报
  unsubscribe = alertService.onAlert((alert) => {
    recentAlerts.value.unshift(alert)
    if (recentAlerts.value.length > 5) {
      recentAlerts.value = recentAlerts.value.slice(0, 5)
    }
  })
})

// 清理
onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
  }
})

// 更新配置
function updateConfig() {
  alertService.setConfig(localConfig.value)
}

// 测试警报
async function testAlert() {
  await alertService.testAlert()
}

// 清除所有警报
function clearAlerts() {
  alertService.clearAlerts()
  recentAlerts.value = []
}

// 移除单个警报
function removeAlert(alertId: string) {
  if (alertService.removeAlert(alertId)) {
    recentAlerts.value = recentAlerts.value.filter(alert => alert.id !== alertId)
  }
}

// 格式化时间
function formatTime(timestamp: Date): string {
  const now = new Date()
  const diff = now.getTime() - timestamp.getTime()
  const minutes = Math.floor(diff / 60000)
  
  if (minutes < 1) {
    return '刚刚'
  } else if (minutes < 60) {
    return `${minutes}分钟前`
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60)
    return `${hours}小时前`
  } else {
    return timestamp.toLocaleString('zh-CN')
  }
}

// 获取音量图标
function getVolumeIcon(volume: number): string {
  if (volume === 0) return '🔇'
  if (volume <= 0.3) return '🔈'
  if (volume <= 0.7) return '🔉'
  return '🔊'
}

// 获取警报图标
function getAlertIcon(type: string): string {
  switch (type) {
    case 'danger': return '🚨'
    case 'warning': return '⚠️'
    case 'info': return 'ℹ️'
    default: return '🔔'
  }
}
</script>

<style scoped>
/* === 警报设置主容器 === */
.alert-settings {
  height: fit-content;
  position: relative;
  overflow: hidden;
}

/* === 现代化头部 === */
.settings-header {
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

/* === 设置内容区域 === */
.settings-content {
  padding: 0 var(--spacing-8) var(--spacing-6);
}

.setting-group {
  margin-bottom: var(--spacing-8);
}

.setting-group:last-child {
  margin-bottom: 0;
}

/* === 主开关设计 === */
.primary-toggle {
  background: var(--gradient-primary);
  border-radius: var(--radius-2xl);
  padding: var(--spacing-6);
  position: relative;
  overflow: hidden;
}

.primary-toggle::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  z-index: 1;
}

.toggle-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
  position: relative;
  z-index: 2;
}

.modern-toggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  cursor: pointer;
  position: relative;
}

.toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: relative;
  width: 60px;
  height: 32px;
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius-full);
  transition: all var(--duration-300) var(--easing-spring);
}

.toggle-slider::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  background: white;
  border-radius: var(--radius-full);
  transition: all var(--duration-300) var(--easing-spring);
  box-shadow: var(--shadow-sm);
}

.toggle-input:checked + .toggle-slider {
  background: rgba(255, 255, 255, 0.4);
  border-color: rgba(255, 255, 255, 0.6);
}

.toggle-input:checked + .toggle-slider::before {
  transform: translateX(28px);
  background: white;
  box-shadow: var(--shadow-md);
}

.toggle-icon {
  font-size: var(--font-size-lg);
  color: white;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
}

.toggle-content {
  flex: 1;
}

.toggle-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: white;
  margin-bottom: var(--spacing-1);
}

.toggle-description {
  font-size: var(--font-size-sm);
  color: rgba(255, 255, 255, 0.8);
  line-height: var(--line-height-relaxed);
}

/* === 分组标题 === */
.group-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-4);
}

.group-icon {
  font-size: var(--font-size-xl);
  opacity: 0.8;
}

.group-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

/* === 通知类型卡片 === */
.notification-types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacing-4);
}

.type-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-4);
  background: var(--glass-bg);
  border: 2px solid var(--glass-border);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all var(--duration-300) var(--easing-spring);
  position: relative;
  overflow: hidden;
}

.type-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--gradient-primary);
  opacity: 0;
  transition: opacity var(--duration-300) var(--easing-out);
  z-index: 0;
}

.type-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
}

.type-card:hover::before {
  opacity: 0.05;
}

.type-card.active {
  border-color: var(--color-primary-400);
  background: rgba(59, 130, 246, 0.1);
  box-shadow: var(--shadow-glow);
}

.type-card.active::before {
  opacity: 0.1;
}

.type-icon {
  font-size: var(--font-size-2xl);
  position: relative;
  z-index: 1;
}

.type-content {
  flex: 1;
  position: relative;
  z-index: 1;
}

.type-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-1);
}

.type-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
}

.type-checkmark {
  font-size: var(--font-size-lg);
  color: var(--color-primary-500);
  opacity: 0;
  transform: scale(0.5);
  transition: all var(--duration-300) var(--easing-spring);
  position: relative;
  z-index: 1;
}

.type-card.active .type-checkmark {
  opacity: 1;
  transform: scale(1);
}

/* === 过滤设置 === */
.filter-setting {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: var(--spacing-5);
  transition: all var(--duration-200) var(--easing-out);
}

.filter-setting:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: var(--color-primary-300);
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  cursor: pointer;
}

.checkbox-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkbox-custom {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-outline);
  border-radius: var(--radius-sm);
  position: relative;
  transition: all var(--duration-200) var(--easing-out);
  flex-shrink: 0;
}

.checkbox-custom::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
  color: white;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  transition: transform var(--duration-200) var(--easing-spring);
}

.checkbox-input:checked + .checkbox-custom {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
  box-shadow: var(--shadow-glow);
}

.checkbox-input:checked + .checkbox-custom::after {
  transform: translate(-50%, -50%) scale(1);
}

.filter-content {
  flex: 1;
}

.filter-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-1);
}

.filter-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
}

/* === 音量控制 === */
.volume-control {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
}

.volume-slider-container {
  flex: 1;
  position: relative;
  height: 8px;
}

.volume-slider {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 8px;
  opacity: 0;
  cursor: pointer;
  z-index: 3;
}

.volume-track {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 8px;
  background: var(--color-surface-200);
  border-radius: var(--radius-full);
}

.volume-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 8px;
  background: var(--gradient-primary);
  border-radius: var(--radius-full);
  transition: width var(--duration-200) var(--easing-out);
}

.volume-thumb {
  position: absolute;
  top: 50%;
  width: 20px;
  height: 20px;
  background: white;
  border: 3px solid var(--color-primary-500);
  border-radius: var(--radius-full);
  transform: translate(-50%, -50%);
  box-shadow: var(--shadow-md);
  transition: left var(--duration-200) var(--easing-out);
  cursor: pointer;
}

.volume-display {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  min-width: 80px;
}

.volume-icon {
  font-size: var(--font-size-lg);
}

.volume-percentage {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-family: var(--font-family-mono);
}

/* === 时间控制 === */
.time-control {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.time-input-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.time-input {
  width: 100px;
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  text-align: center;
  transition: all var(--duration-200) var(--easing-out);
}

.time-input:focus {
  outline: none;
  border-color: var(--color-primary-500);
  box-shadow: var(--shadow-glow);
  background: white;
}

.input-unit {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}

.time-description {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  font-style: italic;
}

/* === 最近警报区域 === */
.recent-alerts {
  border-top: 1px solid var(--color-outline-variant);
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
}

.alerts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-5) var(--spacing-8);
  border-bottom: 1px solid var(--color-outline-variant);
}

.alerts-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

/* === 警报列表 === */
.alerts-list {
  max-height: 320px;
  overflow-y: auto;
}

.alerts-list::-webkit-scrollbar {
  width: 6px;
}

.alerts-list::-webkit-scrollbar-track {
  background: var(--color-surface-100);
  border-radius: var(--radius-full);
}

.alerts-list::-webkit-scrollbar-thumb {
  background: var(--color-surface-300);
  border-radius: var(--radius-full);
}

.alert-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-3);
  padding: var(--spacing-4) var(--spacing-8);
  border-bottom: 1px solid var(--color-outline-variant);
  transition: all var(--duration-200) var(--easing-out);
  position: relative;
}

.alert-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  transition: background-color var(--duration-200) var(--easing-out);
}

.alert-item:hover {
  background: rgba(255, 255, 255, 0.8);
}

.alert-item:last-child {
  border-bottom: none;
}

.alert-item.alert-danger::before {
  background: var(--color-error);
}

.alert-item.alert-warning::before {
  background: var(--color-warning);
}

.alert-item.alert-info::before {
  background: var(--color-info);
}

.alert-icon {
  font-size: var(--font-size-xl);
  flex-shrink: 0;
  margin-top: var(--spacing-1);
}

.alert-content {
  flex: 1;
  min-width: 0;
}

.alert-title {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-1);
  line-height: var(--line-height-tight);
}

.alert-message {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-relaxed);
  margin-bottom: var(--spacing-2);
}

.alert-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.alert-separator {
  opacity: 0.5;
}

.remove-alert-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  line-height: 1;
  transition: all var(--duration-200) var(--easing-spring);
  flex-shrink: 0;
}

.remove-alert-btn:hover {
  background: var(--color-error);
  color: white;
  transform: scale(1.1);
}

/* === 响应式设计 === */
@media (max-width: 1024px) {
  .notification-types {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .settings-header {
    flex-direction: column;
    gap: var(--spacing-4);
    text-align: center;
  }
  
  .settings-content {
    padding: 0 var(--spacing-6) var(--spacing-6);
  }
  
  .toggle-container {
    flex-direction: column;
    text-align: center;
  }
  
  .volume-control {
    flex-direction: column;
    align-items: stretch;
  }
  
  .volume-display {
    justify-content: center;
  }
  
  .time-input-container {
    justify-content: center;
  }
  
  .alerts-header {
    flex-direction: column;
    gap: var(--spacing-3);
    text-align: center;
  }
  
  .alert-meta {
    flex-direction: column;
    gap: var(--spacing-1);
    align-items: flex-start;
  }
  
  .alert-separator {
    display: none;
  }
}
</style>