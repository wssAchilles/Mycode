<template>
  <div class="map-view">
    <!-- 现代化头部导航 -->
    <header class="map-header">
      <div class="header-container">
        <div class="header-left">
          <div class="brand-section">
            <div class="brand-icon">🗺️</div>
            <div class="brand-info">
              <h1 class="page-title">智慧城市地图</h1>
              <p class="page-subtitle">实时环境监测可视化</p>
            </div>
          </div>
        </div>
        
        <div class="header-center">
          <div class="search-container">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="搜索地点或传感器..."
                class="search-input"
                @input="handleSearch"
              />
              <button v-if="searchQuery" @click="clearSearch" class="clear-btn">✕</button>
            </div>
          </div>
        </div>
        
        <div class="header-right">
          <div class="header-controls">
            <button @click="toggleLayerPanel" class="control-btn" :class="{ active: showLayerPanel }">
              <span class="btn-icon">🛰️</span>
              <span class="btn-text">图层</span>
            </button>
            <button @click="toggleFilterPanel" class="control-btn" :class="{ active: showFilterPanel }">
              <span class="btn-icon">🔧</span>
              <span class="btn-text">筛选</span>
            </button>
            <button @click="toggleSettingsPanel" class="control-btn" :class="{ active: showSettingsPanel }">
              <span class="btn-icon">⚙️</span>
              <span class="btn-text">设置</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- 主要内容区域 -->
    <main class="map-main">
      <!-- 左侧面板 -->
      <aside class="sidebar" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
        <div class="sidebar-header">
          <h2 class="sidebar-title">传感器状态</h2>
          <button @click="toggleSidebar" class="sidebar-toggle">
            {{ sidebarCollapsed ? '→' : '←' }}
          </button>
        </div>
        
        <div class="sidebar-content" v-if="!sidebarCollapsed">
          <!-- 统计摘要 -->
          <div class="stats-summary">
            <div class="stat-item">
              <div class="stat-icon">📊</div>
              <div class="stat-info">
                <div class="stat-value">{{ sensorStore.sensorData.length }}</div>
                <div class="stat-label">传感器总数</div>
              </div>
            </div>
            <div class="stat-item">
              <div class="stat-icon">⚠️</div>
              <div class="stat-info">
                <div class="stat-value">{{ sensorStore.anomalyStats.anomalies }}</div>
                <div class="stat-label">异常设备</div>
              </div>
            </div>
            <div class="stat-item">
              <div class="stat-icon">📈</div>
              <div class="stat-info">
                <div class="stat-value">{{ sensorStore.averagePM25 }}</div>
                <div class="stat-label">平均PM2.5</div>
              </div>
            </div>
          </div>
          
          <!-- 传感器列表 -->
          <div class="sensor-list">
            <h3 class="list-title">传感器设备</h3>
            <div class="sensor-items">
              <div 
                v-for="sensor in sensorStore.sensorData" 
                :key="sensor.deviceId"
                class="sensor-item"
                :class="{ 'sensor-anomaly': sensor.isAnomaly }"
                @click="focusSensor(sensor)"
              >
                <div class="sensor-status">
                  <div class="status-dot" :class="sensor.isAnomaly ? 'anomaly' : 'normal'"></div>
                </div>
                <div class="sensor-info">
                  <div class="sensor-id">{{ sensor.deviceId }}</div>
                  <div class="sensor-data">PM2.5: {{ sensor.pm25 }} µg/m³</div>
                  <div class="sensor-location">{{ sensor.latitude.toFixed(4) }}, {{ sensor.longitude.toFixed(4) }}</div>
                </div>
                <div class="sensor-actions">
                  <button class="action-btn" @click.stop="showSensorDetails(sensor)">详情</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 地图容器 -->
      <section class="map-container">
        <!-- Google Maps 容器 -->
        <div 
          ref="mapContainer" 
          id="google-map" 
          class="google-map"
        ></div>
        
        <!-- 地图加载状态 -->
        <div v-if="!mapLoaded" class="map-loading">
          <div class="loading-spinner"></div>
          <div class="loading-text">正在加载地图...</div>
        </div>
        
        <!-- 地图控制面板 -->
        <div class="map-controls">
          <div class="control-group">
            <button @click="centerMap" class="map-control-btn" title="回到中心">
              <span>🎯</span>
            </button>
            <button @click="toggleHeatmap" class="map-control-btn" :class="{ active: showHeatmap }" title="热力图">
              <span>🔥</span>
            </button>
            <button @click="refreshSensors" class="map-control-btn" title="刷新数据">
              <span>🔄</span>
            </button>
          </div>
        </div>
      </section>

      <!-- 右侧面板（图层、筛选、设置） -->
      <aside class="right-panel" v-show="showLayerPanel || showFilterPanel || showSettingsPanel">
        <!-- 图层面板 -->
        <div v-if="showLayerPanel" class="panel-content">
          <div class="panel-header">
            <h3 class="panel-title">地图图层</h3>
            <button @click="toggleLayerPanel" class="panel-close">✕</button>
          </div>
          <div class="panel-body">
            <div class="layer-options">
              <div class="layer-item">
                <label class="layer-label">
                  <input type="radio" v-model="mapType" value="roadmap" @change="updateMapType">
                  <span class="layer-name">道路地图</span>
                </label>
              </div>
              <div class="layer-item">
                <label class="layer-label">
                  <input type="radio" v-model="mapType" value="satellite" @change="updateMapType">
                  <span class="layer-name">卫星地图</span>
                </label>
              </div>
              <div class="layer-item">
                <label class="layer-label">
                  <input type="radio" v-model="mapType" value="hybrid" @change="updateMapType">
                  <span class="layer-name">混合地图</span>
                </label>
              </div>
              <div class="layer-item">
                <label class="layer-label">
                  <input type="radio" v-model="mapType" value="terrain" @change="updateMapType">
                  <span class="layer-name">地形地图</span>
                </label>
              </div>
            </div>
            
            <hr class="panel-divider">
            
            <div class="overlay-options">
              <h4 class="options-title">覆盖图层</h4>
              <div class="option-item">
                <label class="option-label">
                  <input type="checkbox" v-model="showHeatmap" @change="toggleHeatmap">
                  <span class="option-name">热力图</span>
                </label>
              </div>
              <div class="option-item">
                <label class="option-label">
                  <input type="checkbox" v-model="showTraffic" @change="toggleTraffic">
                  <span class="option-name">交通状况</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- 筛选面板 -->
        <div v-if="showFilterPanel" class="panel-content">
          <div class="panel-header">
            <h3 class="panel-title">数据筛选</h3>
            <button @click="toggleFilterPanel" class="panel-close">✕</button>
          </div>
          <div class="panel-body">
            <div class="filter-group">
              <h4 class="filter-title">PM2.5 浓度范围</h4>
              <div class="range-slider">
                <input 
                  type="range" 
                  v-model="pmFilter.min" 
                  min="0" 
                  max="500" 
                  class="slider"
                  @input="applyFilters"
                >
                <input 
                  type="range" 
                  v-model="pmFilter.max" 
                  min="0" 
                  max="500" 
                  class="slider"
                  @input="applyFilters"
                >
                <div class="range-values">
                  <span>{{ pmFilter.min }} - {{ pmFilter.max }} µg/m³</span>
                </div>
              </div>
            </div>
            
            <div class="filter-group">
              <h4 class="filter-title">设备状态</h4>
              <div class="checkbox-group">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="statusFilter.normal" @change="applyFilters">
                  <span class="checkbox-name">正常设备</span>
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" v-model="statusFilter.anomaly" @change="applyFilters">
                  <span class="checkbox-name">异常设备</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- 设置面板 -->
        <div v-if="showSettingsPanel" class="panel-content">
          <div class="panel-header">
            <h3 class="panel-title">地图设置</h3>
            <button @click="toggleSettingsPanel" class="panel-close">✕</button>
          </div>
          <div class="panel-body">
            <div class="setting-group">
              <h4 class="setting-title">显示选项</h4>
              <div class="setting-item">
                <label class="setting-label">
                  <input type="checkbox" v-model="mapSettings.showLabels">
                  <span class="setting-name">显示标签</span>
                </label>
              </div>
              <div class="setting-item">
                <label class="setting-label">
                  <input type="checkbox" v-model="mapSettings.enableClustering">
                  <span class="setting-name">标记聚合</span>
                </label>
              </div>
            </div>
            
            <div class="setting-group">
              <h4 class="setting-title">更新频率</h4>
              <select v-model="mapSettings.refreshInterval" class="setting-select">
                <option value="5000">5秒</option>
                <option value="10000">10秒</option>
                <option value="30000">30秒</option>
                <option value="60000">1分钟</option>
              </select>
            </div>
          </div>
        </div>
      </aside>
    </main>

    <!-- 传感器详情弹窗 -->
    <div v-if="selectedSensor" class="sensor-detail-modal" @click.self="closeSensorDetails">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">传感器详情</h3>
          <button @click="closeSensorDetails" class="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="sensor-detail-info">
            <div class="detail-row">
              <div class="detail-label">设备ID</div>
              <div class="detail-value">{{ selectedSensor.deviceId }}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">PM2.5浓度</div>
              <div class="detail-value">{{ selectedSensor.pm25 }} µg/m³</div>
            </div>
            <div class="detail-row" v-if="selectedSensor.temperature">
              <div class="detail-label">温度</div>
              <div class="detail-value">{{ selectedSensor.temperature }}°C</div>
            </div>
            <div class="detail-row" v-if="selectedSensor.humidity">
              <div class="detail-label">湿度</div>
              <div class="detail-value">{{ selectedSensor.humidity }}%</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">位置</div>
              <div class="detail-value">{{ selectedSensor.latitude }}, {{ selectedSensor.longitude }}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">状态</div>
              <div class="detail-value">
                <span :class="selectedSensor.isAnomaly ? 'status-anomaly' : 'status-normal'">
                  {{ selectedSensor.isAnomaly ? '异常' : '正常' }}
                </span>
              </div>
            </div>
            <div class="detail-row" v-if="selectedSensor.anomalyScore">
              <div class="detail-label">异常分数</div>
              <div class="detail-value">{{ selectedSensor.anomalyScore.toFixed(4) }}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">更新时间</div>
              <div class="detail-value">{{ formatTime(selectedSensor.timestamp) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
    <main class="map-main">
      <!-- 左侧控制面板 -->
      <aside class="side-panel left-panel" :class="{ collapsed: leftPanelCollapsed }">
        <div class="panel-header">
          <h3 class="panel-title">传感器状态</h3>
          <button @click="toggleLeftPanel" class="collapse-btn">
            <span :class="leftPanelCollapsed ? 'icon-expand' : 'icon-collapse'">
              {{ leftPanelCollapsed ? '◀' : '▶' }}
            </span>
          </button>
        </div>
        
        <div class="panel-content" v-show="!leftPanelCollapsed">
          <!-- 实时统计卡片 -->
          <div class="stats-section">
            <div class="stat-card" v-for="stat in sensorStats" :key="stat.type">
              <div class="stat-icon" :class="stat.iconClass">{{ stat.icon }}</div>
              <div class="stat-content">
                <div class="stat-value">{{ stat.value }}</div>
                <div class="stat-label">{{ stat.label }}</div>
                <div class="stat-trend" :class="stat.trendClass">{{ stat.trend }}</div>
              </div>
            </div>
          </div>

          <!-- 传感器列表 -->
          <div class="sensors-section">
            <div class="section-header">
              <h4 class="section-title">传感器列表</h4>
              <div class="section-actions">
                <button @click="refreshSensors" class="action-btn">
                  <span class="btn-icon">🔄</span>
                </button>
              </div>
            </div>
            
            <div class="sensor-list">
              <div 
                v-for="sensor in filteredSensors" 
                :key="sensor.id"
                class="sensor-item"
                :class="{ 
                  active: selectedSensor?.id === sensor.id,
                  'status-normal': sensor.status === 'normal',
                  'status-warning': sensor.status === 'warning',
                  'status-error': sensor.status === 'error',
                  'status-offline': sensor.status === 'offline'
                }"
                @click="selectSensor(sensor)"
              >
                <div class="sensor-indicator"></div>
                <div class="sensor-info">
                  <div class="sensor-name">{{ sensor.name }}</div>
                  <div class="sensor-location">{{ sensor.location }}</div>
                  <div class="sensor-data">
                    <span class="data-label">{{ sensor.dataType }}: </span>
                    <span class="data-value" :class="getDataValueClass(sensor)">
                      {{ sensor.currentValue }} {{ sensor.unit }}
                    </span>
                  </div>
                </div>
                <div class="sensor-status">
                  <span class="status-dot"></span>
                  <span class="status-text">{{ getStatusText(sensor.status) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 地图容器 -->
      <div class="map-container">
        <!-- 地图画布 -->
        <div ref="mapCanvas" class="map-canvas">
          <!-- 模拟地图背景 -->
          <div class="map-background">
            <!-- 网格背景 -->
            <div class="map-grid" v-if="showGrid"></div>
            
            <!-- 传感器标记 -->
            <div 
              v-for="sensor in visibleSensors"
              :key="sensor.id"
              class="sensor-marker"
              :class="[
                `status-${sensor.status}`,
                { 'selected': selectedSensor?.id === sensor.id }
              ]"
              :style="{
                left: sensor.mapX + '%',
                top: sensor.mapY + '%'
              }"
              @click="selectSensor(sensor)"
            >
              <div class="marker-pulse"></div>
              <div class="marker-icon">{{ getSensorIcon(sensor.type) }}</div>
              <div class="marker-label" v-if="showLabels">{{ sensor.name }}</div>
              
              <!-- 传感器数据弹窗 -->
              <div 
                v-if="selectedSensor?.id === sensor.id" 
                class="sensor-popup"
              >
                <div class="popup-header">
                  <h4>{{ sensor.name }}</h4>
                  <button @click="selectedSensor = null" class="popup-close">✕</button>
                </div>
                <div class="popup-content">
                  <div class="popup-info">
                    <div class="info-item">
                      <span class="info-label">位置:</span>
                      <span class="info-value">{{ sensor.location }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">状态:</span>
                      <span class="info-value" :class="'status-' + sensor.status">
                        {{ getStatusText(sensor.status) }}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">当前值:</span>
                      <span class="info-value" :class="getDataValueClass(sensor)">
                        {{ sensor.currentValue }} {{ sensor.unit }}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">更新时间:</span>
                      <span class="info-value">{{ formatTime(sensor.lastUpdate) }}</span>
                    </div>
                  </div>
                  
                  <!-- 迷你图表 -->
                  <div class="mini-chart">
                    <div class="chart-header">24小时趋势</div>
                    <div class="chart-container">
                      <svg class="trend-chart" viewBox="0 0 200 60">
                        <polyline
                          :points="generateTrendPoints(sensor.historyData)"
                          fill="none"
                          :stroke="getChartColor(sensor.status)"
                          stroke-width="2"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="loading-overlay">
          <LoadingSpinner />
          <span>数据加载中...</span>
        </div>

        <!-- 错误状态 -->
        <div v-if="error" class="error-message">
          {{ error.message }}
          <button @click="refreshSensors">重试</button>
        </div>

        <!-- 地图控制工具栏 -->
        <div class="map-controls">
          <div class="zoom-controls">
            <button @click="zoomIn" class="zoom-btn">
              <span class="btn-icon">+</span>
            </button>
            <div class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</div>
            <button @click="zoomOut" class="zoom-btn">
              <span class="btn-icon">-</span>
            </button>
          </div>
          
          <div class="view-controls">
            <button @click="resetView" class="control-btn">
              <span class="btn-icon">🏠</span>
              <span class="btn-text">重置视图</span>
            </button>
            <button @click="centerOnSensors" class="control-btn">
              <span class="btn-icon">📍</span>
              <span class="btn-text">定位传感器</span>
            </button>
            <button @click="toggleFullscreen" class="control-btn">
              <span class="btn-icon">⛶</span>
              <span class="btn-text">全屏</span>
            </button>
          </div>
        </div>

        <!-- 图例 -->
        <div class="map-legend" v-if="showLegend">
          <div class="legend-header">图例</div>
          <div class="legend-items">
            <div class="legend-item">
              <span class="legend-marker status-normal"></span>
              <span class="legend-text">正常</span>
            </div>
            <div class="legend-item">
              <span class="legend-marker status-warning"></span>
              <span class="legend-text">警告</span>
            </div>
            <div class="legend-item">
              <span class="legend-marker status-error"></span>
              <span class="legend-text">异常</span>
            </div>
            <div class="legend-item">
              <span class="legend-marker status-offline"></span>
              <span class="legend-text">离线</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧面板（图层控制、过滤器等） -->
      <aside class="side-panel right-panel" v-show="showRightPanel">
        <!-- 图层面板 -->
        <div v-show="showLayerPanel" class="panel-section">
          <div class="panel-header">
            <h3 class="panel-title">图层控制</h3>
          </div>
          <div class="panel-content">
            <div class="layer-controls">
              <div 
                v-for="layer in mapLayers" 
                :key="layer.id"
                class="layer-item"
              >
                <label class="layer-checkbox">
                  <input 
                    type="checkbox" 
                    v-model="layer.visible"
                    @change="toggleLayer(layer)"
                  />
                  <span class="checkmark"></span>
                  <span class="layer-name">{{ layer.name }}</span>
                </label>
                <div class="layer-opacity">
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    v-model="layer.opacity"
                    class="opacity-slider"
                  />
                  <span class="opacity-value">{{ layer.opacity }}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 过滤面板 -->
        <div v-show="showFilterPanel" class="panel-section">
          <div class="panel-header">
            <h3 class="panel-title">数据过滤</h3>
          </div>
          <div class="panel-content">
            <div class="filter-groups">
              <!-- 传感器类型过滤 -->
              <div class="filter-group">
                <h4 class="filter-title">传感器类型</h4>
                <div class="filter-options">
                  <label 
                    v-for="type in sensorTypes" 
                    :key="type.id"
                    class="filter-checkbox"
                  >
                    <input 
                      type="checkbox" 
                      v-model="selectedSensorTypes"
                      :value="type.id"
                    />
                    <span class="checkmark"></span>
                    <span class="filter-text">{{ type.name }}</span>
                  </label>
                </div>
              </div>

              <!-- 状态过滤 -->
              <div class="filter-group">
                <h4 class="filter-title">设备状态</h4>
                <div class="filter-options">
                  <label 
                    v-for="status in statusOptions" 
                    :key="status.value"
                    class="filter-checkbox"
                  >
                    <input 
                      type="checkbox" 
                      v-model="selectedStatuses"
                      :value="status.value"
                    />
                    <span class="checkmark"></span>
                    <span class="filter-text">{{ status.label }}</span>
                  </label>
                </div>
              </div>

              <!-- 数值范围过滤 -->
              <div class="filter-group">
                <h4 class="filter-title">数值范围</h4>
                <div class="range-filters">
                  <div class="range-input">
                    <label>最小值:</label>
                    <input 
                      type="number" 
                      v-model.number="minValue"
                      class="range-field"
                    />
                  </div>
                  <div class="range-input">
                    <label>最大值:</label>
                    <input 
                      type="number" 
                      v-model.number="maxValue"
                      class="range-field"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="filter-actions">
              <button @click="applyFilters" class="apply-btn">应用筛选</button>
              <button @click="clearFilters" class="clear-btn">清除筛选</button>
            </div>
          </div>
        </div>

        <!-- 设置面板 -->
        <div v-show="showSettingsPanel" class="panel-section">
          <div class="panel-header">
            <h3 class="panel-title">地图设置</h3>
          </div>
          <div class="panel-content">
            <div class="settings-groups">
              <div class="setting-group">
                <h4 class="setting-title">显示选项</h4>
                <div class="setting-options">
                  <label class="setting-checkbox">
                    <input type="checkbox" v-model="showGrid" />
                    <span class="checkmark"></span>
                    <span class="setting-text">显示网格</span>
                  </label>
                  <label class="setting-checkbox">
                    <input type="checkbox" v-model="showLabels" />
                    <span class="checkmark"></span>
                    <span class="setting-text">显示标签</span>
                  </label>
                  <label class="setting-checkbox">
                    <input type="checkbox" v-model="showLegend" />
                    <span class="checkmark"></span>
                    <span class="setting-text">显示图例</span>
                  </label>
                </div>
              </div>

              <div class="setting-group">
                <h4 class="setting-title">自动更新</h4>
                <div class="setting-options">
                  <label class="setting-checkbox">
                    <input type="checkbox" v-model="autoRefresh" />
                    <span class="checkmark"></span>
                    <span class="setting-text">启用自动刷新</span>
                  </label>
                  <div v-if="autoRefresh" class="setting-detail">
                    <label>刷新间隔:</label>
                    <select v-model="refreshInterval" class="setting-select">
                      <option value="5000">5 秒</option>
                      <option value="10000">10 秒</option>
                      <option value="30000">30 秒</option>
                      <option value="60000">1 分钟</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </main>

    <!-- 底部状态栏 -->
    <footer class="map-footer">
      <div class="footer-left">
        <div class="status-indicator">
          <span class="status-dot" :class="connectionStatus"></span>
          <span class="status-text">{{ connectionStatusText }}</span>
        </div>
        <div class="last-update">
          最后更新: {{ formatTime(lastUpdateTime) }}
        </div>
      </div>
      
      <div class="footer-center">
        <div class="coordinates" v-if="mousePosition">
          坐标: {{ mousePosition.x.toFixed(2) }}, {{ mousePosition.y.toFixed(2) }}
        </div>
      </div>
      
      <div class="footer-right">
        <div class="sensor-count">
          传感器: {{ filteredSensors.length }} / {{ sensors.length }}
        </div>
        <div class="zoom-info">
          缩放: {{ Math.round(zoomLevel * 100) }}%
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useSensorDataStore } from '@/stores/sensorData'
import type { SensorData } from '@/types/SensorData'

// 使用传感器数据store
const sensorStore = useSensorDataStore()

// 状态变量
const searchQuery = ref('')
const selectedSensor = ref<SensorData | null>(null)
const sidebarCollapsed = ref(false)
const showLayerPanel = ref(false)
const showFilterPanel = ref(false)
const showSettingsPanel = ref(false)
const mapLoaded = ref(false)
const showHeatmap = ref(false)
const showTraffic = ref(false)
const mapType = ref('roadmap')

// 地图相关
const mapContainer = ref<HTMLElement | null>(null)
let map: google.maps.Map | null = null
let heatmap: google.maps.visualization.HeatmapLayer | null = null
let trafficLayer: google.maps.TrafficLayer | null = null
const markers: google.maps.Marker[] = []

// 筛选器
const pmFilter = ref({ min: 0, max: 500 })
const statusFilter = ref({ normal: true, anomaly: true })

// 地图设置
const mapSettings = ref({
  showLabels: true,
  enableClustering: true,
  refreshInterval: 10000
})

// 默认地图中心（北京）
const defaultCenter = { lat: 39.9042, lng: 116.4074 }

// 搜索处理
const handleSearch = () => {
  if (!searchQuery.value.trim()) return
  
  // 实现搜索逻辑
  const searchTerm = searchQuery.value.toLowerCase()
  const foundSensor = sensorStore.sensorData.find(sensor => 
    sensor.deviceId.toLowerCase().includes(searchTerm)
  )
  
  if (foundSensor) {
    focusSensor(foundSensor)
  }
}

const clearSearch = () => {
  searchQuery.value = ''
}

// 面板切换
const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

const toggleLayerPanel = () => {
  showLayerPanel.value = !showLayerPanel.value
  showFilterPanel.value = false
  showSettingsPanel.value = false
}

const toggleFilterPanel = () => {
  showFilterPanel.value = !showFilterPanel.value
  showLayerPanel.value = false
  showSettingsPanel.value = false
}

const toggleSettingsPanel = () => {
  showSettingsPanel.value = !showSettingsPanel.value
  showLayerPanel.value = false
  showFilterPanel.value = false
}

// 传感器相关
const focusSensor = (sensor: SensorData) => {
  if (map) {
    const position = new google.maps.LatLng(sensor.latitude, sensor.longitude)
    map.setCenter(position)
    map.setZoom(15)
  }
  selectedSensor.value = sensor
}

const showSensorDetails = (sensor: SensorData) => {
  selectedSensor.value = sensor
}

const closeSensorDetails = () => {
  selectedSensor.value = null
}

// 地图控制
const centerMap = () => {
  if (map) {
    map.setCenter(defaultCenter)
    map.setZoom(12)
  }
}

const toggleHeatmap = () => {
  showHeatmap.value = !showHeatmap.value
  updateHeatmap()
}

const toggleTraffic = () => {
  showTraffic.value = !showTraffic.value
  updateTrafficLayer()
}

const refreshSensors = () => {
  // 重新渲染地图标记
  clearMarkers()
  addSensorMarkers()
}

const updateMapType = () => {
  if (map) {
    map.setMapTypeId(mapType.value as google.maps.MapTypeId)
  }
}

// 筛选器
const applyFilters = () => {
  // 根据筛选条件更新地图显示
  clearMarkers()
  addSensorMarkers()
}

// 地图初始化
const initGoogleMap = () => {
  if (!mapContainer.value || !window.google) {
    console.error('Google Maps API未加载或地图容器不存在')
    return
  }

  try {
    map = new google.maps.Map(mapContainer.value, {
      center: defaultCenter,
      zoom: 12,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ],
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false
    })

    mapLoaded.value = true
    console.log('Google Maps初始化成功')

    // 添加传感器标记
    addSensorMarkers()

    // 初始化热力图层
    if (window.google.maps.visualization) {
      initHeatmapLayer()
    }

    // 初始化交通图层
    initTrafficLayer()

  } catch (error) {
    console.error('初始化Google Maps失败:', error)
    mapLoaded.value = false
  }
}

// 添加传感器标记
const addSensorMarkers = () => {
  if (!map) return

  sensorStore.sensorData.forEach(sensor => {
    // 根据筛选条件判断是否显示
    if (!shouldShowSensor(sensor)) return

    const marker = new google.maps.Marker({
      position: { lat: sensor.latitude, lng: sensor.longitude },
      map: map,
      title: `${sensor.deviceId} - PM2.5: ${sensor.pm25} µg/m³`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: sensor.isAnomaly ? '#ef4444' : '#10b981',
        fillOpacity: 0.8,
        strokeColor: '#ffffff',
        strokeWeight: 2
      }
    })

    // 添加点击事件
    marker.addListener('click', () => {
      showSensorDetails(sensor)
    })

    markers.push(marker)
  })
}

// 清除所有标记
const clearMarkers = () => {
  markers.forEach(marker => {
    marker.setMap(null)
  })
  markers.length = 0
}

// 判断是否应该显示传感器
const shouldShowSensor = (sensor: SensorData): boolean => {
  // PM2.5筛选
  if (sensor.pm25 < pmFilter.value.min || sensor.pm25 > pmFilter.value.max) {
    return false
  }
  
  // 状态筛选
  if (sensor.isAnomaly && !statusFilter.value.anomaly) {
    return false
  }
  if (!sensor.isAnomaly && !statusFilter.value.normal) {
    return false
  }
  
  return true
}

// 初始化热力图层
const initHeatmapLayer = () => {
  if (!map || !window.google.maps.visualization) return

  const heatmapData = sensorStore.getHeatmapData().map(point => ({
    location: new google.maps.LatLng(point.lat, point.lng),
    weight: point.weight
  }))

  heatmap = new google.maps.visualization.HeatmapLayer({
    data: heatmapData,
    map: null, // 初始时不显示
    radius: 30,
    opacity: 0.6
  })
}

// 更新热力图
const updateHeatmap = () => {
  if (!heatmap) return
  
  heatmap.setMap(showHeatmap.value ? map : null)
}

// 初始化交通图层
const initTrafficLayer = () => {
  if (!map) return
  
  trafficLayer = new google.maps.TrafficLayer()
}

// 更新交通图层
const updateTrafficLayer = () => {
  if (!trafficLayer) return
  
  trafficLayer.setMap(showTraffic.value ? map : null)
}

// 时间格式化
const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

// 等待Google Maps API加载
const waitForGoogleMaps = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve()
      return
    }

    let attempts = 0
    const maxAttempts = 50

    const checkGoogle = () => {
      attempts++
      if (window.google && window.google.maps) {
        resolve()
      } else if (attempts >= maxAttempts) {
        reject(new Error('Google Maps API加载超时'))
      } else {
        setTimeout(checkGoogle, 100)
      }
    }

    checkGoogle()
  })
}

// 组件挂载
onMounted(async () => {
  console.log('MapView组件已挂载')
  
  try {
    // 等待Google Maps API加载
    await waitForGoogleMaps()
    
    // 下一个tick后初始化地图
    await nextTick()
    
    setTimeout(() => {
      initGoogleMap()
    }, 100)
    
  } catch (error) {
    console.error('加载Google Maps失败:', error)
    mapLoaded.value = false
  }
})

// 组件卸载
onUnmounted(() => {
  // 清理地图资源
  clearMarkers()
  if (heatmap) {
    heatmap.setMap(null)
  }
  if (trafficLayer) {
    trafficLayer.setMap(null)
  }
})

// 声明全局类型
declare global {
  interface Window {
    google: typeof google
  }
}
</script>
    longitude: 116.4074,
    pm25: 0,
    temperature: 25.3,
    mapX: 45,
    mapY: 35,
    historyData: [22.1, 23.5, 24.2, 25.3, 25.1, 24.8],
    lastUpdate: new Date(Date.now() - 300000) // 5分钟前
  },
  {
    id: 'sensor-002',
    deviceId: 'HUM_002',
    name: '公园湿度监测站',
    type: 'humidity',
    dataType: '湿度',
    location: '中央公园北门',
    value: 68.7,
    currentValue: 68.7,
    unit: '%',
    timestamp: new Date().toISOString(),
    status: 'normal',
    latitude: 39.9100,
    longitude: 116.4100,
    pm25: 0,
    humidity: 68.7,
    mapX: 65,
    mapY: 25,
    historyData: [65.2, 66.8, 67.5, 68.7, 69.1, 68.3],
    lastUpdate: new Date(Date.now() - 180000) // 3分钟前
  },
  {
    id: 'sensor-003',
    deviceId: 'AQI_003',
    name: '工业区空气质量站',
    type: 'air_quality',
    dataType: 'AQI',
    location: '东工业园区',
    value: 156,
    currentValue: 156,
    unit: '',
    timestamp: new Date().toISOString(),
    status: 'warning',
    latitude: 39.8950,
    longitude: 116.4200,
    pm25: 156,
    mapX: 80,
    mapY: 60,
    historyData: [142, 148, 152, 156, 159, 155],
    lastUpdate: new Date(Date.now() - 120000) // 2分钟前
  },
  {
    id: 'sensor-004',
    deviceId: 'NOISE_004',
    name: '商业区噪音监测点',
    type: 'noise',
    dataType: '噪音',
    location: '步行街中段',
    value: 72.5,
    currentValue: 72.5,
    unit: 'dB',
    timestamp: new Date().toISOString(),
    status: 'error',
    latitude: 39.9000,
    longitude: 116.4050,
    pm25: 0,
    mapX: 35,
    mapY: 55,
    historyData: [68.2, 70.1, 71.8, 72.5, 73.2, 71.9],
    lastUpdate: new Date(Date.now() - 600000) // 10分钟前
  },
  {
    id: 'sensor-005',
    deviceId: 'TEMP_005',
    name: '住宅区温度站',
    type: 'temperature',
    dataType: '温度',
    location: '学府小区',
    value: 0,
    currentValue: 0,
    unit: '°C',
    timestamp: new Date().toISOString(),
    status: 'offline',
    latitude: 39.8980,
    longitude: 116.4000,
    pm25: 0,
    temperature: 0,
    mapX: 20,
    mapY: 45,
    historyData: [24.1, 24.3, 0, 0, 0, 0],
    lastUpdate: new Date(Date.now() - 1800000) // 30分钟前
  },
  {
    id: 'sensor-006',
    deviceId: 'HUM_006',
    name: '河滨湿度传感器',
    type: 'humidity',
    dataType: '湿度',
    location: '滨江路码头',
    value: 78.2,
    currentValue: 78.2,
    unit: '%',
    timestamp: new Date().toISOString(),
    status: 'normal',
    latitude: 39.8920,
    longitude: 116.4120,
    pm25: 0,
    humidity: 78.2,
    mapX: 55,
    mapY: 75,
    historyData: [75.8, 76.5, 77.2, 78.2, 78.8, 77.9],
    lastUpdate: new Date(Date.now() - 240000) // 4分钟前
  }
])

// 地图图层配置
const mapLayers: Ref<MapLayer[]> = ref([
  { id: 'base', name: '基础地图', visible: true, opacity: 100 },
  { id: 'satellite', name: '卫星图层', visible: false, opacity: 80 },
  { id: 'traffic', name: '交通流量', visible: false, opacity: 70 },
  { id: 'heatmap', name: '热力图', visible: true, opacity: 60 }
])

// 传感器类型选项
const sensorTypes: Ref<SensorType[]> = ref([
  { id: 'temperature', name: '温度传感器' },
  { id: 'humidity', name: '湿度传感器' },
  { id: 'air_quality', name: '空气质量' },
  { id: 'noise', name: '噪音监测' }
])

// 状态选项
const statusOptions: Ref<StatusOption[]> = ref([
  { value: 'normal', label: '正常' },
  { value: 'warning', label: '警告' },
  { value: 'error', label: '异常' },
  { value: 'offline', label: '离线' }
])

// 计算属性
const sensorStats = computed(() => {
  const total = sensors.value.length
  const normal = sensors.value.filter(s => s.status === 'normal').length
  const warning = sensors.value.filter(s => s.status === 'warning').length
  const error = sensors.value.filter(s => s.status === 'error').length
  const offline = sensors.value.filter(s => s.status === 'offline').length

  return [
    {
      type: 'total',
      icon: '📊',
      iconClass: 'icon-total',
      value: total,
      label: '总传感器',
      trend: '+0%',
      trendClass: 'trend-neutral'
    },
    {
      type: 'normal',
      icon: '✅',
      iconClass: 'icon-normal',
      value: normal,
      label: '正常运行',
      trend: '+5%',
      trendClass: 'trend-positive'
    },
    {
      type: 'warning',
      icon: '⚠️',
      iconClass: 'icon-warning',
      value: warning,
      label: '警告状态',
      trend: '+1',
      trendClass: 'trend-warning'
    },
    {
      type: 'error',
      icon: '❌',
      iconClass: 'icon-error',
      value: error + offline,
      label: '异常/离线',
      trend: '-2%',
      trendClass: 'trend-negative'
    }
  ]
})

const filteredSensors = computed(() => {
  let filtered = sensors.value.filter(sensor => {
    // 搜索过滤
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      if (!sensor.name.toLowerCase().includes(query) && 
          !sensor.location.toLowerCase().includes(query)) {
        return false
      }
    }

    // 类型过滤
    if (!selectedSensorTypes.value.includes(sensor.type)) {
      return false
    }

    // 状态过滤
    if (!selectedStatuses.value.includes(sensor.status)) {
      return false
    }

    // 数值范围过滤
    if (minValue.value !== null && sensor.currentValue < minValue.value) {
      return false
    }
    if (maxValue.value !== null && sensor.currentValue > maxValue.value) {
      return false
    }

    return true
  })

  return filtered
})

const visibleSensors = computed(() => {
  return filteredSensors.value
})

const showRightPanel = computed(() => {
  return showLayerPanel.value || showFilterPanel.value || showSettingsPanel.value
})

const connectionStatusText = computed(() => {
  switch (connectionStatus.value) {
    case 'connected': return '在线'
    case 'connecting': return '连接中'
    case 'disconnected': return '离线'
    default: return '未知'
  }
})

// 方法
const handleSearch = () => {
  // 搜索逻辑已在计算属性中实现
}

const clearSearch = () => {
  searchQuery.value = ''
}

const toggleLayerPanel = () => {
  showLayerPanel.value = !showLayerPanel.value
  if (showLayerPanel.value) {
    showFilterPanel.value = false
    showSettingsPanel.value = false
  }
}

const toggleFilterPanel = () => {
  showFilterPanel.value = !showFilterPanel.value
  if (showFilterPanel.value) {
    showLayerPanel.value = false
    showSettingsPanel.value = false
  }
}

const toggleSettingsPanel = () => {
  showSettingsPanel.value = !showSettingsPanel.value
  if (showSettingsPanel.value) {
    showLayerPanel.value = false
    showFilterPanel.value = false
  }
}

const toggleLeftPanel = () => {
  leftPanelCollapsed.value = !leftPanelCollapsed.value
}

const selectSensor = (sensor: SensorDataExtended) => {
  selectedSensor.value = sensor
}

const refreshSensors = async () => {
  try {
    loading.value = true
    error.value = null
    // 模拟API调用延迟
    setTimeout(() => {
      sensors.value.forEach(sensor => {
        if (sensor.status !== 'offline') {
          // 模拟数据变化
          const variation = (Math.random() - 0.5) * 2
          sensor.currentValue = Math.max(0, sensor.currentValue + variation)
          sensor.value = sensor.currentValue
          sensor.lastUpdate = new Date()
          
          // 更新历史数据
          sensor.historyData.push(sensor.currentValue)
          if (sensor.historyData.length > 24) {
            sensor.historyData.shift()
          }
        }
      })
      
      lastUpdateTime.value = new Date()
      connectionStatus.value = 'connected'
    }, 1000)
  } catch (err) {
    error.value = err as Error
    console.error('获取传感器数据失败:', err)
  } finally {
    loading.value = false
  }
}

const zoomIn = () => {
  zoomLevel.value = Math.min(zoomLevel.value * 1.2, 3)
}

const zoomOut = () => {
  zoomLevel.value = Math.max(zoomLevel.value / 1.2, 0.5)
}

const resetView = () => {
  zoomLevel.value = 1
  selectedSensor.value = null
}

const centerOnSensors = () => {
  // 重置视图到显示所有传感器
  resetView()
}

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

const toggleLayer = (layer: MapLayer) => {
  // 图层切换逻辑
}

const applyFilters = () => {
  // 过滤器应用逻辑已在计算属性中实现
}

const clearFilters = () => {
  selectedSensorTypes.value = ['temperature', 'humidity', 'air_quality', 'noise']
  selectedStatuses.value = ['normal', 'warning', 'error', 'offline']
  minValue.value = null
  maxValue.value = null
}

const getStatusText = (status: string) => {
  switch (status) {
    case 'normal': return '正常'
    case 'warning': return '警告'
    case 'error': return '异常'
    case 'offline': return '离线'
    default: return '未知'
  }
}

const getDataValueClass = (sensor: SensorDataExtended) => {
  return `value-${sensor.status}`
}

const getSensorIcon = (type: string) => {
  switch (type) {
    case 'temperature': return '🌡️'
    case 'humidity': return '💧'
    case 'air_quality': return '🌪️'
    case 'noise': return '🔊'
    default: return '📡'
  }
}

const formatTime = (date: Date) => {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

const generateTrendPoints = (data: number[]) => {
  if (!data || data.length === 0) return ''
  
  const width = 200
  const height = 60
  const maxValue = Math.max(...data)
  const minValue = Math.min(...data)
  const range = maxValue - minValue || 1
  
  return data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - ((value - minValue) / range) * height
    return `${x},${y}`
  }).join(' ')
}

const getChartColor = (status: string) => {
  switch (status) {
    case 'normal': return '#10b981'
    case 'warning': return '#f59e0b'
    case 'error': return '#ef4444'
    case 'offline': return '#6b7280'
    default: return '#3b82f6'
  }
}

// 定时器
let refreshTimer: number | null = null

// 监听器
watch(autoRefresh, (enabled) => {
  if (enabled && refreshInterval.value) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
})

watch(refreshInterval, () => {
  if (autoRefresh.value) {
    stopAutoRefresh()
    startAutoRefresh()
  }
})

// 生命周期
onMounted(() => {
  if (autoRefresh.value) {
    startAutoRefresh()
  }
  
  // 添加鼠标移动监听
  if (mapCanvas.value) {
    mapCanvas.value.addEventListener('mousemove', handleMouseMove)
  }
  
  // 初始化数据
  refreshSensors()
})

onUnmounted(() => {
  stopAutoRefresh()
  
  if (mapCanvas.value) {
    mapCanvas.value.removeEventListener('mousemove', handleMouseMove)
  }
})

// 辅助方法
const startAutoRefresh = () => {
  refreshTimer = window.setInterval(() => {
    refreshSensors()
  }, refreshInterval.value)
}

const stopAutoRefresh = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

const handleMouseMove = (event: MouseEvent) => {
  if (mapCanvas.value) {
    const rect = mapCanvas.value.getBoundingClientRect()
    mousePosition.value = {
      x: (event.clientX - rect.left) / rect.width * 100,
      y: (event.clientY - rect.top) / rect.height * 100
    }
  }
}
</script>

<style>
/* === 全局CSS变量 === */
:root {
  /* 渐变背景 */
  --gradient-background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --gradient-primary: linear-gradient(135deg, #6366f1, #8b5cf6);
  --gradient-accent: linear-gradient(135deg, #ec4899, #f97316);
}
</style>

<style scoped>
/* === 设计系统变量 === */
:root {
  /* 玻璃拟态效果 */
  --glass-bg: rgba(255, 255, 255, 0.2);
  --glass-border: rgba(255, 255, 255, 0.3);
  
  /* 现代色彩系统 */
  --color-primary: #6366f1;
  --color-secondary: #8b5cf6;
  --color-accent: #ec4899;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;
  
  /* 间距系统 */
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-5: 1.25rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;
  
  /* 圆角系统 */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
  
  /* 阴影系统 */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  --shadow-glow: 0 0 15px rgba(99, 102, 241, 0.5);
  
  /* 过渡效果 */
  --duration-100: 0.1s;
  --duration-200: 0.2s;
  --duration-300: 0.3s;
  --duration-500: 0.5s;
  --easing-out: cubic-bezier(0, 0, 0.2, 1);
  --easing-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --easing-spring: cubic-bezier(0.68, -0.55, 0.27, 1.55);
}

/* === 全局基础样式 === */
.map-view {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  width: 100%;
}

.map-view::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: 
    radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.3) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.2) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}

/* === 头部区域 === */
.map-header {
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--glass-border);
  position: sticky;
  top: 0;
  z-index: 1000;
  transition: all var(--duration-300) var(--easing-out);
}

.header-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 var(--spacing-8);
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 80px;
  position: relative;
}

.brand-section {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
}

.brand-icon {
  width: 48px;
  height: 48px;
  background: var(--gradient-primary);
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  box-shadow: var(--shadow-glow);
  position: relative;
  overflow: hidden;
}

.brand-icon::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(45deg, rgba(255, 255, 255, 0.2) 0%, transparent 100%);
  border-radius: var(--radius-xl);
}

.brand-info {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(45deg, var(--color-primary), var(--color-accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
  line-height: 1.2;
}

.page-subtitle {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
  margin: 0;
  line-height: 1.2;
}

/* 搜索框样式 */
.search-container {
  flex-grow: 1;
  max-width: 500px;
  margin: 0 var(--spacing-6);
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: var(--spacing-3);
  font-size: 1.25rem;
  color: rgba(255, 255, 255, 0.7);
}

.search-input {
  width: 100%;
  padding: var(--spacing-3) var(--spacing-3) var(--spacing-3) var(--spacing-10);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  color: white;
  font-size: 1rem;
  transition: all var(--duration-300) var(--easing-out);
}

.search-input:focus {
  outline: none;
  box-shadow: var(--shadow-glow);
  background: rgba(255, 255, 255, 0.25);
}

.clear-btn {
  position: absolute;
  right: var(--spacing-3);
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 1.25rem;
  transition: all var(--duration-200) var(--easing-out);
}

.clear-btn:hover {
  color: white;
  transform: scale(1.1);
}

/* 控制按钮 */
.header-controls {
  display: flex;
  gap: var(--spacing-3);
}

.control-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-4);
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-300) var(--easing-spring);
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-2px);
}

.control-btn.active {
  background: var(--gradient-primary);
  box-shadow: var(--shadow-glow);
  color: white;
}

.btn-icon {
  font-size: 1.25rem;
}

/* === 主体区域 === */
.map-main {
  flex: 1;
  display: flex;
  position: relative;
  z-index: 1;
  overflow: hidden;
}

/* === 侧边栏基础 === */
.side-panel {
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  transition: all var(--duration-300) var(--easing-out);
  position: relative;
  z-index: 100;
}

/* === 左侧面板 === */
.left-panel {
  width: 320px;
  border-right: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
}

.left-panel.collapsed {
  width: 60px;
}

.left-panel.collapsed .panel-content {
  opacity: 0;
  pointer-events: none;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-4) var(--spacing-6);
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.1);
}

.panel-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.collapse-btn {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-2);
  cursor: pointer;
  color: white;
  font-size: 0.875rem;
  transition: all var(--duration-200) var(--easing-out);
}

.collapse-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.05);
}

.panel-content {
  flex: 1;
  padding: var(--spacing-4);
  overflow-y: auto;
  transition: opacity var(--duration-300) var(--easing-out);
}

/* === 统计卡片 === */
.stats-section {
  margin-bottom: var(--spacing-6);
}

.stat-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-4);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  margin-bottom: var(--spacing-3);
  transition: all var(--duration-300) var(--easing-spring);
  position: relative;
  overflow: hidden;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--gradient-primary);
  opacity: 0;
  transition: opacity var(--duration-300) var(--easing-out);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.stat-card:hover::before {
  opacity: 0.1;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  position: relative;
  z-index: 1;
}

.icon-primary { background: var(--gradient-primary); }
.icon-success { background: linear-gradient(135deg, var(--color-success), #059669); }
.icon-warning { background: linear-gradient(135deg, var(--color-warning), #d97706); }
.icon-error { background: linear-gradient(135deg, var(--color-error), #dc2626); }

.stat-content {
  flex: 1;
  position: relative;
  z-index: 1;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  line-height: 1.2;
}

.stat-label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
  margin-bottom: var(--spacing-1);
}

.stat-trend {
  font-size: 0.75rem;
  font-weight: 600;
}

.trend-up { color: var(--color-success); }
.trend-down { color: var(--color-error); }
.trend-stable { color: var(--color-info); }

/* === 传感器列表 === */
.sensors-section {
  flex: 1;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-4);
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.section-actions {
  display: flex;
  gap: var(--spacing-2);
}

.action-btn {
  width: 32px;
  height: 32px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
  font-size: 0.875rem;
  transition: all var(--duration-200) var(--easing-out);
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.05);
}

.sensor-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.sensor-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-3);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--duration-300) var(--easing-spring);
  position: relative;
  overflow: hidden;
}

.sensor-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  transition: background-color var(--duration-200) var(--easing-out);
}

.sensor-item.status-normal::before { background: var(--color-success); }
.sensor-item.status-warning::before { background: var(--color-warning); }
.sensor-item.status-error::before { background: var(--color-error); }
.sensor-item.status-offline::before { background: #6b7280; }

.sensor-item:hover {
  transform: translateX(4px);
  background: rgba(255, 255, 255, 0.2);
}

.sensor-item.active {
  background: rgba(99, 102, 241, 0.2);
  border-color: var(--color-primary);
  box-shadow: var(--shadow-glow);
}

.sensor-indicator {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  position: relative;
}

.sensor-item.status-normal .sensor-indicator {
  background: var(--color-success);
  animation: pulse-success 2s infinite;
}

.sensor-item.status-warning .sensor-indicator {
  background: var(--color-warning);
  animation: pulse-warning 2s infinite;
}

.sensor-item.status-error .sensor-indicator {
  background: var(--color-error);
  animation: pulse-error 1.5s infinite;
}

.sensor-item.status-offline .sensor-indicator {
  background: #6b7280;
}

.sensor-info {
  flex: 1;
  min-width: 0;
}

.sensor-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
  line-height: 1.2;
  margin-bottom: var(--spacing-1);
}

.sensor-location {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.2;
  margin-bottom: var(--spacing-1);
}

.sensor-data {
  font-size: 0.75rem;
  line-height: 1.2;
}

.data-label {
  color: rgba(255, 255, 255, 0.7);
}

.data-value {
  font-weight: 600;
}

.value-normal { color: var(--color-success); }
.value-warning { color: var(--color-warning); }
.value-error { color: var(--color-error); }
.value-offline { color: #6b7280; }

.sensor-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--spacing-1);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

.sensor-item.status-normal .status-dot { background: var(--color-success); }
.sensor-item.status-warning .status-dot { background: var(--color-warning); }
.sensor-item.status-error .status-dot { background: var(--color-error); }
.sensor-item.status-offline .status-dot { background: #6b7280; }

.status-text {
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

/* === 脉冲动画 === */
@keyframes pulse-success {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
}

@keyframes pulse-warning {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
}

@keyframes pulse-error {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
}

/* === 地图容器 === */
.map-container {
  flex: 1;
  position: relative;
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  margin: var(--spacing-4);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.map-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  cursor: grab;
}

.map-canvas:active {
  cursor: grabbing;
}

.map-background {
  width: 100%;
  height: 100%;
  position: relative;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
}

.map-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: 
    linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px);
  background-size: 50px 50px;
  opacity: 0.3;
}

/* === 传感器标记 === */
.sensor-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  z-index: 10;
  transition: all var(--duration-300) var(--easing-spring);
}

.sensor-marker:hover {
  transform: translate(-50%, -50%) scale(1.1);
  z-index: 20;
}

.sensor-marker.selected {
  z-index: 30;
}

.marker-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  pointer-events: none;
}

.sensor-marker.status-normal .marker-pulse {
  background: var(--color-success);
  animation: marker-pulse 2s infinite;
}

.sensor-marker.status-warning .marker-pulse {
  background: var(--color-warning);
  animation: marker-pulse 2s infinite;
}

.sensor-marker.status-error .marker-pulse {
  background: var(--color-error);
  animation: marker-pulse 1.5s infinite;
}

.sensor-marker.status-offline .marker-pulse {
  background: #6b7280;
}

.marker-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: white;
  font-weight: 600;
  position: relative;
  z-index: 1;
  border: 3px solid white;
  box-shadow: var(--shadow-lg);
}

.sensor-marker.status-normal .marker-icon {
  background: var(--color-success);
}

.sensor-marker.status-warning .marker-icon {
  background: var(--color-warning);
}

.sensor-marker.status-error .marker-icon {
  background: var(--color-error);
}

.sensor-marker.status-offline .marker-icon {
  background: #6b7280;
}

.marker-label {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-1) var(--spacing-2);
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
  white-space: nowrap;
  margin-top: var(--spacing-2);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-200) var(--easing-out);
}

.sensor-marker:hover .marker-label {
  opacity: 1;
}

/* === 传感器弹窗 === */
.sensor-popup {
  position: absolute;
  top: -10px;
  left: 60px;
  width: 320px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  z-index: 100;
  animation: popup-enter var(--duration-300) var(--easing-spring);
}

.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
}

.popup-header h4 {
  font-size: 1.125rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.popup-close {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
  font-size: 1rem;
  transition: all var(--duration-200) var(--easing-out);
}

.popup-close:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.1);
}

.popup-content {
  padding: var(--spacing-4);
}

.popup-info {
  margin-bottom: var(--spacing-4);
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-3);
}

.info-item:last-child {
  margin-bottom: 0;
}

.info-label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}

.info-value {
  font-size: 0.875rem;
  color: white;
  font-weight: 600;
}

.info-value.status-normal { color: var(--color-success); }
.info-value.status-warning { color: var(--color-warning); }
.info-value.status-error { color: var(--color-error); }
.info-value.status-offline { color: #6b7280; }

/* === 迷你图表 === */
.mini-chart {
  margin-top: var(--spacing-4);
}

.chart-header {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
  margin-bottom: var(--spacing-2);
}

.chart-container {
  width: 100%;
  height: 60px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
  padding: var(--spacing-2);
}

.trend-chart {
  width: 100%;
  height: 100%;
}

/* === 地图控制工具栏 === */
.map-controls {
  position: absolute;
  top: var(--spacing-4);
  right: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  z-index: 50;
}

.zoom-controls {
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.zoom-btn {
  width: 44px;
  height: 44px;
  background: transparent;
  border: none;
  color: white;
  font-size: 1.25rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-200) var(--easing-out);
  display: flex;
  align-items: center;
  justify-content: center;
}

.zoom-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.zoom-level {
  padding: var(--spacing-2);
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  text-align: center;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid var(--glass-border);
  border-bottom: 1px solid var(--glass-border);
}

.view-controls {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

/* === 动画效果 === */
@keyframes marker-pulse {
  0%, 100% { 
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  50% { 
    transform: translate(-50%, -50%) scale(1.5);
    opacity: 0;
  }
}

@keyframes popup-enter {
  0% {
    opacity: 0;
    transform: scale(0.8) translateY(10px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* === 图例 === */
.map-legend {
  position: absolute;
  bottom: var(--spacing-4);
  left: var(--spacing-4);
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4);
  z-index: 50;
}

.legend-header {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
  margin-bottom: var(--spacing-3);
}

.legend-items {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.legend-marker {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  border: 2px solid white;
  box-shadow: var(--shadow-sm);
}

.legend-marker.status-normal { background: var(--color-success); }
.legend-marker.status-warning { background: var(--color-warning); }
.legend-marker.status-error { background: var(--color-error); }
.legend-marker.status-offline { background: #6b7280; }

.legend-text {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

/* === 右侧面板 === */
.right-panel {
  width: 350px;
  border-left: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 80px);
}

.panel-section {
  border-bottom: 1px solid var(--glass-border);
}

.panel-section:last-child {
  border-bottom: none;
}

/* === 图层控制 === */
.layer-controls {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.layer-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.layer-checkbox {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  cursor: pointer;
}

.layer-checkbox input[type="checkbox"] {
  display: none;
}

.checkmark {
  width: 20px;
  height: 20px;
  border: 2px solid var(--glass-border);
  border-radius: var(--radius-sm);
  position: relative;
  transition: all var(--duration-200) var(--easing-out);
  background: transparent;
}

.layer-checkbox input[type="checkbox"]:checked + .checkmark {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.layer-checkbox input[type="checkbox"]:checked + .checkmark::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 0.75rem;
  font-weight: 700;
}

.layer-name {
  font-size: 0.875rem;
  color: white;
  font-weight: 500;
}

.layer-opacity {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  margin-left: var(--spacing-8);
}

.opacity-slider {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-full);
  outline: none;
  appearance: none;
  -webkit-appearance: none;
}

.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.opacity-value {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
  min-width: 35px;
  text-align: right;
}

/* === 过滤器 === */
.filter-groups {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-5);
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.filter-title {
  font-size: 1rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.filter-options {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.filter-checkbox {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  cursor: pointer;
  padding: var(--spacing-2);
  border-radius: var(--radius-md);
  transition: background-color var(--duration-200) var(--easing-out);
}

.filter-checkbox:hover {
  background: rgba(255, 255, 255, 0.1);
}

.filter-text {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
}

.range-filters {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.range-input {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.range-input label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.range-field {
  padding: var(--spacing-2) var(--spacing-3);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: white;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all var(--duration-200) var(--easing-out);
}

.range-field:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.filter-actions {
  display: flex;
  gap: var(--spacing-3);
  margin-top: var(--spacing-4);
}

.apply-btn {
  flex: 1;
  padding: var(--spacing-3);
  background: var(--gradient-primary);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-300) var(--easing-spring);
}

.apply-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}

.clear-btn {
  flex: 1;
  padding: var(--spacing-3);
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-200) var(--easing-out);
}

.clear-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--color-primary);
}

/* === 设置面板 === */
.settings-groups {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-5);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.setting-title {
  font-size: 1rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.setting-options {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.setting-checkbox {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  cursor: pointer;
  padding: var(--spacing-2);
  border-radius: var(--radius-md);
  transition: background-color var(--duration-200) var(--easing-out);
}

.setting-checkbox:hover {
  background: rgba(255, 255, 255, 0.1);
}

.setting-text {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
}

.setting-detail {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  margin-left: var(--spacing-8);
  margin-top: var(--spacing-2);
}

.setting-detail label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.setting-select {
  padding: var(--spacing-2) var(--spacing-3);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: white;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all var(--duration-200) var(--easing-out);
}

.setting-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

/* === 底部状态栏 === */
.map-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-3) var(--spacing-6);
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--glass-border);
  z-index: 50;
}

.footer-left,
.footer-center,
.footer-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

.status-dot.connected { 
  background: var(--color-success);
  animation: pulse-success 2s infinite;
}

.status-dot.connecting { 
  background: var(--color-warning);
  animation: pulse-warning 2s infinite;
}

.status-dot.disconnected { 
  background: var(--color-error);
}

.status-text,
.last-update,
.coordinates,
.sensor-count,
.zoom-info {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

/* === 响应式设计 === */
@media (max-width: 1024px) {
  .left-panel {
    width: 280px;
  }
  
  .right-panel {
    width: 300px;
  }
  
  .header-container {
    padding: 0 var(--spacing-6);
  }
  
  .sensor-popup {
    width: 280px;
  }
}

@media (max-width: 768px) {
  .map-main {
    flex-direction: column;
  }
  
  .left-panel {
    width: 100%;
    height: 200px;
    order: 2;
  }
  
  .right-panel {
    width: 100%;
    height: 250px;
    order: 3;
    border-left: none;
    border-top: 1px solid var(--glass-border);
  }
  
  .map-container {
    order: 1;
    margin: var(--spacing-2);
    height: 400px;
  }
  
  .map-controls {
    top: var(--spacing-2);
    right: var(--spacing-2);
  }
  
  .map-legend {
    bottom: var(--spacing-2);
    left: var(--spacing-2);
  }
  
  .sensor-popup {
    width: 250px;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
  
  .map-footer {
    flex-direction: column;
    gap: var(--spacing-2);
    padding: var(--spacing-2) var(--spacing-4);
  }
  
  .footer-left,
  .footer-center,
  .footer-right {
    justify-content: center;
  }
}
</style>