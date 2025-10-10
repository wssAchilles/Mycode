package com.urban.environment.backend.controller;

import com.urban.environment.backend.service.BigQueryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据分析控制器
 * 提供基于BigQuery的高级数据分析API
 */
@RestController
@RequestMapping("/api/analytics")
@CrossOrigin("*")
public class AnalyticsController {
    
    private static final Logger logger = LoggerFactory.getLogger(AnalyticsController.class);
    
    @Autowired(required = false)
    private BigQueryService bigQueryService;
    
    /**
     * 获取异常统计数据
     * 
     * @param startTime 开始时间
     * @param endTime 结束时间
     * @return 统计数据
     */
    @GetMapping("/anomaly-statistics")
    public ResponseEntity<?> getAnomalyStatistics(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime) {
        
        if (bigQueryService == null) {
            return ResponseEntity.ok(createMockStatistics());
        }
        
        try {
            // 设置默认时间范围（最近24小时）
            if (startTime == null) {
                startTime = LocalDateTime.now().minusDays(1);
            }
            if (endTime == null) {
                endTime = LocalDateTime.now();
            }
            
            String start = startTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            String end = endTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            
            Map<String, Object> statistics = bigQueryService.queryAnomalyStatistics(start, end);
            
            return ResponseEntity.ok(statistics);
            
        } catch (Exception e) {
            logger.error("获取异常统计失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(
                Map.of("error", "获取统计数据失败", "message", e.getMessage())
            );
        }
    }
    
    /**
     * 获取设备历史数据
     * 
     * @param deviceId 设备ID
     * @param limit 限制数量
     * @return 历史数据列表
     */
    @GetMapping("/device-history/{deviceId}")
    public ResponseEntity<?> getDeviceHistory(
            @PathVariable String deviceId,
            @RequestParam(defaultValue = "100") int limit) {
        
        if (bigQueryService == null) {
            return ResponseEntity.ok(List.of());
        }
        
        try {
            List<Map<String, Object>> history = bigQueryService.queryDeviceHistory(deviceId, limit);
            return ResponseEntity.ok(history);
            
        } catch (Exception e) {
            logger.error("获取设备历史失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(
                Map.of("error", "获取设备历史失败", "message", e.getMessage())
            );
        }
    }
    
    /**
     * 获取数据趋势分析
     * 
     * @param hours 分析的小时数
     * @return 趋势数据
     */
    @GetMapping("/trends")
    public ResponseEntity<?> getDataTrends(@RequestParam(defaultValue = "24") int hours) {
        
        if (bigQueryService == null) {
            return ResponseEntity.ok(createMockTrends());
        }
        
        try {
            // 这里可以实现更复杂的趋势分析查询
            LocalDateTime startTime = LocalDateTime.now().minusHours(hours);
            LocalDateTime endTime = LocalDateTime.now();
            
            String start = startTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            String end = endTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            
            Map<String, Object> statistics = bigQueryService.queryAnomalyStatistics(start, end);
            
            // 添加趋势指标
            Map<String, Object> trends = new HashMap<>(statistics);
            trends.put("time_range_hours", hours);
            trends.put("trend_direction", calculateTrendDirection(statistics));
            
            return ResponseEntity.ok(trends);
            
        } catch (Exception e) {
            logger.error("获取趋势数据失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(
                Map.of("error", "获取趋势数据失败", "message", e.getMessage())
            );
        }
    }
    
    /**
     * 获取热点区域分析
     * 
     * @return 热点区域数据
     */
    @GetMapping("/hotspots")
    public ResponseEntity<?> getHotspots() {
        
        if (bigQueryService == null) {
            return ResponseEntity.ok(createMockHotspots());
        }
        
        try {
            // 执行自定义SQL查询获取热点区域
            String sql = String.format(
                "SELECT " +
                "  ROUND(latitude, 3) as lat_zone, " +
                "  ROUND(longitude, 3) as lng_zone, " +
                "  COUNT(*) as data_count, " +
                "  AVG(pm25) as avg_pm25, " +
                "  SUM(CASE WHEN is_anomaly THEN 1 ELSE 0 END) as anomaly_count " +
                "FROM `sensor_readings` " +
                "WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR) " +
                "GROUP BY lat_zone, lng_zone " +
                "HAVING data_count > 10 " +
                "ORDER BY anomaly_count DESC " +
                "LIMIT 10"
            );
            
            // 注意：实际实现需要调整SQL以适应实际的BigQuery项目结构
            
            return ResponseEntity.ok(Map.of(
                "hotspots", List.of(),
                "message", "热点分析功能正在开发中"
            ));
            
        } catch (Exception e) {
            logger.error("获取热点数据失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(
                Map.of("error", "获取热点数据失败", "message", e.getMessage())
            );
        }
    }
    
    /**
     * 计算趋势方向
     */
    private String calculateTrendDirection(Map<String, Object> statistics) {
        double anomalyRate = (double) statistics.getOrDefault("anomaly_rate", 0.0);
        if (anomalyRate > 10) {
            return "increasing";
        } else if (anomalyRate < 5) {
            return "decreasing";
        } else {
            return "stable";
        }
    }
    
    /**
     * 创建模拟统计数据（当BigQuery不可用时）
     */
    private Map<String, Object> createMockStatistics() {
        return Map.of(
            "total_count", 1000L,
            "anomaly_count", 50L,
            "anomaly_rate", 5.0,
            "avg_pm25", 22.5,
            "max_pm25", 45.0,
            "min_pm25", 8.0,
            "status", "mock_data"
        );
    }
    
    /**
     * 创建模拟趋势数据
     */
    private Map<String, Object> createMockTrends() {
        return Map.of(
            "time_range_hours", 24,
            "trend_direction", "stable",
            "avg_pm25", 22.5,
            "anomaly_rate", 5.0,
            "status", "mock_data"
        );
    }
    
    /**
     * 创建模拟热点数据
     */
    private Map<String, Object> createMockHotspots() {
        return Map.of(
            "hotspots", List.of(
                Map.of("lat", 35.689, "lng", 139.691, "intensity", 0.8),
                Map.of("lat", 35.690, "lng", 139.692, "intensity", 0.6)
            ),
            "status", "mock_data"
        );
    }
}
