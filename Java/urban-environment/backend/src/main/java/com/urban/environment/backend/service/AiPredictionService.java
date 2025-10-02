package com.urban.environment.backend.service;

import com.urban.environment.backend.entity.SensorData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.Map;

/**
 * AI异常检测预测服务
 * 负责调用本地AI微服务进行异常检测
 */
@Service
public class AiPredictionService {

	private static final Logger logger = LoggerFactory.getLogger(AiPredictionService.class);

	private final WebClient webClient;
	private final String aiServiceUrl;

	public AiPredictionService(@Value("${ai.service.url:http://urban-ai-service:8000}") String aiServiceUrl) {
		this.aiServiceUrl = aiServiceUrl;
		this.webClient = WebClient.builder()
				.baseUrl(aiServiceUrl)
				.build();

		logger.info("AI预测服务初始化完成，AI服务地址: {}", aiServiceUrl);
	}

	/**
	 * 获取完整的AI预测结果
	 * 
	 * @param sensorData 传感器数据
	 * @return PredictionResponse 包含完整预测信息的响应对象
	 */
	public PredictionResponse getPrediction(SensorData sensorData) {
		try {
			// 构建请求体
			PredictionRequest request = new PredictionRequest(sensorData.getPm25());

			// 调用AI服务
			PredictionResponse response = webClient
					.post()
					.uri("/predict")
					.contentType(MediaType.APPLICATION_JSON)
					.bodyValue(request)
					.retrieve()
					.bodyToMono(PredictionResponse.class)
					.retryWhen(Retry.backoff(3, Duration.ofSeconds(1)))
					.timeout(Duration.ofSeconds(10))
					.block();

			if (response != null) {
				logger.debug("AI完整预测结果: PM2.5={}, 异常={}, 分数={}, 置信度={}",
						response.getPm25Value(),
						response.isAnomaly(),
						response.getAnomalyScore(),
						response.getConfidence());

				return response;
			} else {
				logger.warn("AI服务返回空响应，返回默认正常结果");
				PredictionResponse defaultResponse = new PredictionResponse();
				defaultResponse.setAnomaly(false);
				defaultResponse.setAnomalyScore(0.0);
				defaultResponse.setConfidence(0.0);
				defaultResponse.setPm25Value(sensorData.getPm25());
				return defaultResponse;
			}

		} catch (WebClientResponseException e) {
			logger.error("AI服务HTTP错误: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
			// 返回默认正常结果
			PredictionResponse defaultResponse = new PredictionResponse();
			defaultResponse.setAnomaly(false);
			defaultResponse.setAnomalyScore(0.0);
			defaultResponse.setConfidence(0.0);
			defaultResponse.setPm25Value(sensorData.getPm25());
			return defaultResponse;
		} catch (Exception e) {
			logger.error("调用AI服务异常: {}", e.getMessage(), e);
			// 返回默认正常结果
			PredictionResponse defaultResponse = new PredictionResponse();
			defaultResponse.setAnomaly(false);
			defaultResponse.setAnomalyScore(0.0);
			defaultResponse.setConfidence(0.0);
			defaultResponse.setPm25Value(sensorData.getPm25());
			return defaultResponse;
		}
	}

	/**
	 * 检测传感器数据是否异常
	 * 
	 * @param sensorData 传感器数据
	 * @return true 如果数据异常，false 如果数据正常
	 */
	public boolean isAnomalous(SensorData sensorData) {
		try {
			// 构建请求体
			PredictionRequest request = new PredictionRequest(sensorData.getPm25());

			// 调用AI服务
			PredictionResponse response = webClient
					.post()
					.uri("/predict")
					.contentType(MediaType.APPLICATION_JSON)
					.bodyValue(request)
					.retrieve()
					.bodyToMono(PredictionResponse.class)
					.retryWhen(Retry.backoff(3, Duration.ofSeconds(1)))
					.timeout(Duration.ofSeconds(10))
					.block();

			if (response != null) {
				logger.debug("AI预测结果: PM2.5={}, 异常={}, 分数={}, 置信度={}",
						response.getPm25Value(),
						response.isAnomaly(),
						response.getAnomalyScore(),
						response.getConfidence());

				return response.isAnomaly();
			} else {
				logger.warn("AI服务返回空响应，假设数据正常");
				return false;
			}

		} catch (WebClientResponseException e) {
			logger.error("AI服务HTTP错误: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
			return false; // 服务异常时假设数据正常
		} catch (Exception e) {
			logger.error("调用AI服务异常: {}", e.getMessage(), e);
			return false; // 调用异常时假设数据正常
		}
	}

	/**
	 * 检查AI服务健康状态
	 * 
	 * @return true 如果服务健康，false 如果服务不可用
	 */
	public boolean isServiceHealthy() {
		try {
			Map<String, Object> healthResponse = webClient
					.get()
					.uri("/health")
					.retrieve()
					.bodyToMono(Map.class)
					.timeout(Duration.ofSeconds(5))
					.block();

			return healthResponse != null && "healthy".equals(healthResponse.get("status"));
		} catch (Exception e) {
			logger.warn("AI服务健康检查失败: {}", e.getMessage());
			return false;
		}
	}

	/**
	 * 异步检测传感器数据是否异常
	 * 
	 * @param sensorData 传感器数据
	 * @return Mono<Boolean> 异步返回检测结果
	 */
	public Mono<Boolean> isAnomalousAsync(SensorData sensorData) {
		PredictionRequest request = new PredictionRequest(sensorData.getPm25());

		return webClient
				.post()
				.uri("/predict")
				.contentType(MediaType.APPLICATION_JSON)
				.bodyValue(request)
				.retrieve()
				.bodyToMono(PredictionResponse.class)
				.map(PredictionResponse::isAnomaly)
				.retryWhen(Retry.backoff(2, Duration.ofSeconds(1)))
				.timeout(Duration.ofSeconds(8))
				.doOnError(error -> logger.error("异步AI预测失败: {}", error.getMessage()))
				.onErrorReturn(false); // 错误时返回非异常
	}

	/**
	 * 预测请求模型
	 */
	public static class PredictionRequest {
		private double pm25;

		public PredictionRequest() {
		}

		public PredictionRequest(double pm25) {
			this.pm25 = pm25;
		}

		public double getPm25() {
			return pm25;
		}

		public void setPm25(double pm25) {
			this.pm25 = pm25;
		}
	}

	/**
	 * 预测响应模型
	 */
	public static class PredictionResponse {
		private boolean isAnomaly;
		private double anomalyScore;
		private double confidence;
		private double pm25Value;

		public PredictionResponse() {
		}

		public boolean isAnomaly() {
			return isAnomaly;
		}

		public void setAnomaly(boolean anomaly) {
			isAnomaly = anomaly;
		}

		public double getAnomalyScore() {
			return anomalyScore;
		}

		public void setAnomalyScore(double anomalyScore) {
			this.anomalyScore = anomalyScore;
		}

		public double getConfidence() {
			return confidence;
		}

		public void setConfidence(double confidence) {
			this.confidence = confidence;
		}

		public double getPm25Value() {
			return pm25Value;
		}

		public void setPm25Value(double pm25Value) {
			this.pm25Value = pm25Value;
		}
	}
}