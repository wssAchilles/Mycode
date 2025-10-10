package com.urban.environment.backend.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.auth.oauth2.ServiceAccountCredentials;
import com.google.cloud.bigquery.BigQuery;
import com.google.cloud.bigquery.BigQueryOptions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.FileInputStream;
import java.io.IOException;

/**
 * BigQuery配置类
 * 负责初始化Google Cloud BigQuery客户端
 */
@Configuration
public class BigQueryConfig {
    
    private static final Logger logger = LoggerFactory.getLogger(BigQueryConfig.class);
    
    @Value("${google.cloud.project-id:urban-environment-471707}")
    private String projectId;
    
    @Value("${google.cloud.credentials-path:urban-environment-471707-92bc4f61209b.json}")
    private String credentialsPath;
    
    @Value("${google.cloud.bigquery.dataset:sensor_data}")
    private String datasetName;
    
    /**
     * 创建BigQuery客户端Bean
     */
    @Bean
    public BigQuery bigQuery() {
        try {
            // 加载服务账号凭证
            GoogleCredentials credentials = ServiceAccountCredentials
                .fromStream(new FileInputStream(credentialsPath));
            
            // 构建BigQuery客户端
            BigQuery bigQuery = BigQueryOptions.newBuilder()
                .setProjectId(projectId)
                .setCredentials(credentials)
                .build()
                .getService();
            
            logger.info("✅ BigQuery客户端初始化成功");
            logger.info("项目ID: {}", projectId);
            logger.info("数据集: {}", datasetName);
            
            return bigQuery;
            
        } catch (IOException e) {
            logger.error("❌ 无法加载Google Cloud凭证文件: {}", credentialsPath, e);
            throw new RuntimeException("BigQuery初始化失败", e);
        }
    }
    
    /**
     * 获取数据集名称
     */
    public String getDatasetName() {
        return datasetName;
    }
}
