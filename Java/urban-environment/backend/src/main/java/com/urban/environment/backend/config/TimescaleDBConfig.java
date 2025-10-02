package com.urban.environment.backend.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * TimescaleDB配置类
 * 负责在应用启动后初始化TimescaleDB超表
 */
@Component
public class TimescaleDBConfig {

	private static final Logger logger = LoggerFactory.getLogger(TimescaleDBConfig.class);

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private Environment environment;

	/**
	 * 应用启动完成后初始化TimescaleDB超表
	 * 仅在使用PostgreSQL数据库时执行
	 */
	@EventListener(ApplicationReadyEvent.class)
	public void initializeTimescaleDB() {
		String databaseUrl = environment.getProperty("spring.datasource.url", "");

		// 只有在使用PostgreSQL时才尝试创建超表
		if (databaseUrl.contains("postgresql")) {
			try {
				jdbcTemplate.execute(
						"SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE)");
				logger.info("TimescaleDB超表创建成功");
			} catch (Exception e) {
				logger.warn("TimescaleDB超表创建失败，可能是因为TimescaleDB扩展未安装: {}", e.getMessage());
				logger.info("应用将继续使用标准PostgreSQL表");
			}
		} else {
			logger.info("当前使用的不是PostgreSQL数据库，跳过TimescaleDB超表创建");
		}
	}
}
