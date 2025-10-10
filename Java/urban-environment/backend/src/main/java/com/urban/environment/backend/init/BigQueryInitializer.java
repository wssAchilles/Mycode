package com.urban.environment.backend.init;

import com.urban.environment.backend.service.BigQueryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * BigQuery初始化器
 * 在应用启动时初始化BigQuery数据集和表结构
 */
@Component
@Profile("!test") // 测试环境不执行
public class BigQueryInitializer implements CommandLineRunner {
    
    private static final Logger logger = LoggerFactory.getLogger(BigQueryInitializer.class);
    
    @Autowired(required = false)
    private BigQueryService bigQueryService;
    
    @Override
    public void run(String... args) throws Exception {
        if (bigQueryService != null) {
            try {
                logger.info("🚀 开始初始化BigQuery结构...");
                bigQueryService.initializeBigQueryStructure();
                logger.info("✅ BigQuery初始化完成");
            } catch (Exception e) {
                logger.error("❌ BigQuery初始化失败，但不影响应用启动: {}", e.getMessage());
                // 不抛出异常，允许应用继续运行
            }
        } else {
            logger.info("ℹ️ BigQuery服务未配置，跳过初始化");
        }
    }
}
