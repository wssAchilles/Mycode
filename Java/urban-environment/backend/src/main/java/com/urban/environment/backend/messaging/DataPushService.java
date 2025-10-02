package com.urban.environment.backend.messaging;

import com.urban.environment.backend.entity.SensorData;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 数据推送服务
 * 负责将传感器数据通过WebSocket推送给前端客户端
 */
@Service
public class DataPushService {

	private static final Logger logger = LoggerFactory.getLogger(DataPushService.class);

	private final SimpMessagingTemplate messagingTemplate;

	@Autowired
	public DataPushService(SimpMessagingTemplate messagingTemplate) {
		this.messagingTemplate = messagingTemplate;
	}

	/**
	 * 推送传感器数据到WebSocket客户端
	 * 
	 * @param sensorData 要推送的传感器数据
	 */
	public void pushData(SensorData sensorData) {
		try {
			messagingTemplate.convertAndSend("/topic/sensordata", sensorData);
			logger.info("成功推送数据到WebSocket客户端: DeviceID={}, PM2.5={}",
					sensorData.getDeviceId(), sensorData.getPm25());
		} catch (Exception e) {
			logger.error("推送数据到WebSocket客户端失败: {}", e.getMessage(), e);
		}
	}
}