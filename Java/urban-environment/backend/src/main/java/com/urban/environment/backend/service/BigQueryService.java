package com.urban.environment.backend.service;

import com.google.cloud.bigquery.*;
import com.urban.environment.backend.config.BigQueryConfig;
import com.urban.environment.backend.entity.SensorData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * BigQuery服务类
 * 负责将传感器数据存储到BigQuery以及查询分析
 */
@Service
public class BigQueryService {
    
    private static final Logger logger = LoggerFactory.getLogger(BigQueryService.class);
    
    @Autowired
    private BigQuery bigQuery;
    
    @Autowired
    private BigQueryConfig bigQueryConfig;
    
    private static final String TABLE_NAME = "sensor_readings";
    
    /**
     * 初始化BigQuery数据集和表
     */
    public void initializeBigQueryStructure() {
        try {
            String datasetName = bigQueryConfig.getDatasetName();
            
            // 创建数据集（如果不存在）
            DatasetId datasetId = DatasetId.of(datasetName);
            Dataset dataset = bigQuery.getDataset(datasetId);
            
            if (dataset == null) {
                DatasetInfo datasetInfo = DatasetInfo.newBuilder(datasetId)
                    .setDescription("城市环境监测传感器数据")
                    .setLocation("US")
                    .build();
                dataset = bigQuery.create(datasetInfo);
                logger.info("✅ 创建BigQuery数据集: {}", datasetName);
            }
            
            // 创建表（如果不存在）
            TableId tableId = TableId.of(datasetName, TABLE_NAME);
            Table table = bigQuery.getTable(tableId);
            
            if (table == null) {
                Schema schema = Schema.of(
                    Field.of("id", StandardSQLTypeName.INT64),
                    Field.of("device_id", StandardSQLTypeName.STRING),
                    Field.of("latitude", StandardSQLTypeName.FLOAT64),
                    Field.of("longitude", StandardSQLTypeName.FLOAT64),
                    Field.of("pm25", StandardSQLTypeName.FLOAT64),
                    Field.of("timestamp", StandardSQLTypeName.TIMESTAMP),
                    Field.of("is_anomaly", StandardSQLTypeName.BOOL),
                    Field.of("anomaly_score", StandardSQLTypeName.FLOAT64),
                    Field.of("confidence", StandardSQLTypeName.FLOAT64),
                    Field.of("processed_at", StandardSQLTypeName.TIMESTAMP)
                );
                
                TableDefinition tableDefinition = StandardTableDefinition.of(schema);
                TableInfo tableInfo = TableInfo.newBuilder(tableId, tableDefinition)
                    .setDescription("传感器实时读数数据")
                    .build();
                    
                table = bigQuery.create(tableInfo);
                logger.info("✅ 创建BigQuery表: {}.{}", datasetName, TABLE_NAME);
            }
            
        } catch (BigQueryException e) {
            logger.error("❌ BigQuery初始化失败: {}", e.getMessage(), e);
        }
    }
    
    /**
     * 批量插入传感器数据到BigQuery
     */
    public void insertSensorData(List<SensorData> dataList) {
        if (dataList == null || dataList.isEmpty()) {
            return;
        }
        
        try {
            String datasetName = bigQueryConfig.getDatasetName();
            TableId tableId = TableId.of(datasetName, TABLE_NAME);
            
            List<InsertAllRequest.RowToInsert> rows = new ArrayList<>();
            
            for (SensorData data : dataList) {
                Map<String, Object> rowContent = new HashMap<>();
                rowContent.put("id", data.getId());
                rowContent.put("device_id", data.getDeviceId());
                rowContent.put("latitude", data.getLatitude());
                rowContent.put("longitude", data.getLongitude());
                rowContent.put("pm25", data.getPm25());
                rowContent.put("timestamp", data.getTimestamp().toString());
                rowContent.put("is_anomaly", data.getIsAnomaly());
                rowContent.put("anomaly_score", data.getAnomalyScore());
                rowContent.put("confidence", data.getConfidence());
                rowContent.put("processed_at", Instant.now().toString());
                
                rows.add(InsertAllRequest.RowToInsert.of(UUID.randomUUID().toString(), rowContent));
            }
            
            InsertAllRequest insertRequest = InsertAllRequest.newBuilder(tableId)
                .setRows(rows)
                .build();
                
            InsertAllResponse response = bigQuery.insertAll(insertRequest);
            
            if (response.hasErrors()) {
                logger.error("❌ BigQuery插入错误: {}", response.getInsertErrors());
            } else {
                logger.info("✅ 成功插入 {} 条数据到BigQuery", dataList.size());
            }
            
        } catch (Exception e) {
            logger.error("❌ BigQuery插入失败: {}", e.getMessage(), e);
        }
    }
    
    /**
     * 插入单条传感器数据
     */
    public void insertSingleSensorData(SensorData data) {
        insertSensorData(Collections.singletonList(data));
    }
    
    /**
     * 查询指定时间范围内的异常数据统计
     */
    public Map<String, Object> queryAnomalyStatistics(String startTime, String endTime) {
        Map<String, Object> statistics = new HashMap<>();
        
        try {
            String query = String.format(
                "SELECT " +
                "  COUNT(*) as total_count, " +
                "  SUM(CASE WHEN is_anomaly = true THEN 1 ELSE 0 END) as anomaly_count, " +
                "  AVG(pm25) as avg_pm25, " +
                "  MAX(pm25) as max_pm25, " +
                "  MIN(pm25) as min_pm25 " +
                "FROM `%s.%s.%s` " +
                "WHERE timestamp BETWEEN TIMESTAMP('%s') AND TIMESTAMP('%s')",
                bigQuery.getOptions().getProjectId(),
                bigQueryConfig.getDatasetName(),
                TABLE_NAME,
                startTime,
                endTime
            );
            
            QueryJobConfiguration queryConfig = QueryJobConfiguration.newBuilder(query).build();
            TableResult result = bigQuery.query(queryConfig);
            
            for (FieldValueList row : result.iterateAll()) {
                statistics.put("total_count", row.get("total_count").getLongValue());
                statistics.put("anomaly_count", row.get("anomaly_count").getLongValue());
                statistics.put("avg_pm25", row.get("avg_pm25").getDoubleValue());
                statistics.put("max_pm25", row.get("max_pm25").getDoubleValue());
                statistics.put("min_pm25", row.get("min_pm25").getDoubleValue());
            }
            
            // 计算异常率
            long total = (long) statistics.getOrDefault("total_count", 0L);
            long anomalies = (long) statistics.getOrDefault("anomaly_count", 0L);
            if (total > 0) {
                statistics.put("anomaly_rate", (double) anomalies / total * 100);
            }
            
            logger.info("✅ BigQuery统计查询成功: {}", statistics);
            
        } catch (Exception e) {
            logger.error("❌ BigQuery查询失败: {}", e.getMessage(), e);
        }
        
        return statistics;
    }
    
    /**
     * 查询设备历史数据
     */
    public List<Map<String, Object>> queryDeviceHistory(String deviceId, int limit) {
        List<Map<String, Object>> results = new ArrayList<>();
        
        try {
            String query = String.format(
                "SELECT * FROM `%s.%s.%s` " +
                "WHERE device_id = '%s' " +
                "ORDER BY timestamp DESC " +
                "LIMIT %d",
                bigQuery.getOptions().getProjectId(),
                bigQueryConfig.getDatasetName(),
                TABLE_NAME,
                deviceId,
                limit
            );
            
            QueryJobConfiguration queryConfig = QueryJobConfiguration.newBuilder(query).build();
            TableResult result = bigQuery.query(queryConfig);
            
            for (FieldValueList row : result.iterateAll()) {
                Map<String, Object> record = new HashMap<>();
                row.forEach(fieldValue -> {
                    String fieldName = fieldValue.getAttribute().toString();
                    record.put(fieldName, fieldValue.getValue());
                });
                results.add(record);
            }
            
            logger.info("✅ 查询设备 {} 历史数据: {} 条", deviceId, results.size());
            
        } catch (Exception e) {
            logger.error("❌ 查询设备历史失败: {}", e.getMessage(), e);
        }
        
        return results;
    }
    
    /**
     * 执行自定义BigQuery SQL查询
     */
    public TableResult executeQuery(String sql) {
        try {
            QueryJobConfiguration queryConfig = QueryJobConfiguration.newBuilder(sql)
                .setUseLegacySql(false)
                .build();
                
            return bigQuery.query(queryConfig);
            
        } catch (Exception e) {
            logger.error("❌ 执行BigQuery查询失败: {}", e.getMessage(), e);
            throw new RuntimeException("BigQuery查询执行失败", e);
        }
    }
}
