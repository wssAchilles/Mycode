package com.urban.environment.backend.messaging;

import com.urban.environment.backend.entity.SensorData;
import com.urban.environment.backend.repository.SensorDataRepository;
import com.urban.environment.backend.service.AiPredictionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Kafka消息消费者服务
 * 负责从Kafka的sensor-data-topic主题中消费传感器数据、异常检测并存储到TimescaleDB
 */
@Service
public class KafkaDataConsumer {

	private static final Logger logger = LoggerFactory.getLogger(KafkaDataConsumer.class);

	@Autowired
	private SensorDataRepository sensorDataRepository;

	@Autowired
	private DataPushService dataPushService;

	@Autowired
	private AiPredictionService aiPredictionService;

	/**
	 * 消费来自Kafka的传感器数据
	 * 
	 * @param sensorData 从Kafka接收到的传感器数据
	 */
	@KafkaListener(topics = "sensor-data-topic", groupId = "${spring.kafka.consumer.group-id}")
	public void consume(SensorData sensorData) {
		try {
			// 1. AI异常检测并获取预测结果
			AiPredictionService.PredictionResponse predictionResponse = null;
			boolean isAnomalous = false;
			try {
				predictionResponse = aiPredictionService.getPrediction(sensorData);
				isAnomalous = predictionResponse.isAnomaly();

				// 将AI预测结果设置到传感器数据中
				sensorData.setIsAnomaly(isAnomalous);
				sensorData.setAnomalyScore(predictionResponse.getAnomalyScore());
				sensorData.setConfidence(predictionResponse.getConfidence());

				logger.debug("AI异常检测结果: PM2.5={}, 异常={}, 分数={}, 置信度={}",
						sensorData.getPm25(), isAnomalous,
						predictionResponse.getAnomalyScore(), predictionResponse.getConfidence());
			} catch (Exception aiException) {
				logger.warn("AI异常检测失败，继续正常流程: {}", aiException.getMessage());
			}

			// 2. 将接收到的数据（包含AI预测结果）保存到TimescaleDB
			SensorData savedData = sensorDataRepository.save(sensorData);

			// 3. 通过WebSocket推送保存后的数据（带有ID和AI预测结果）到前端
			dataPushService.pushData(savedData);

			// 4. 记录处理结果（包含异常检测信息）
			String anomalyStatus = isAnomalous ? "异常" : "正常";
			String anomalyDetails = "";
			if (predictionResponse != null) {
				anomalyDetails = String.format(", 分数=%.4f, 置信度=%.2f",
						predictionResponse.getAnomalyScore(),
						predictionResponse.getConfidence());
			}

			logger.info("✅ 成功处理传感器数据: ID={}, DeviceID={}, Location=({},{}), PM2.5={}, 状态={}{}",
					savedData.getId(), savedData.getDeviceId(),
					savedData.getLatitude(), savedData.getLongitude(), savedData.getPm25(),
					anomalyStatus, anomalyDetails);

			// 5. 如果检测到异常，记录额外的警告信息
			if (isAnomalous) {
				logger.warn("🚨 检测到异常数据: ID={}, PM2.5={}, 位置=({},{}){}",
						savedData.getId(), savedData.getPm25(),
						savedData.getLatitude(), savedData.getLongitude(), anomalyDetails);

				// 这里可以添加异常处理逻辑，比如：
				// - 发送告警通知
				// - 记录到异常日志表
				// - 触发特殊处理流程
			}

		} catch (Exception e) {
			logger.error("❌ 处理传感器数据时发生错误: {}", e.getMessage(), e);
		}
	}
}
