package com.urban.environment.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * WebSocket配置类
 * 启用WebSocket和STOMP消息代理功能
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

	/**
	 * 注册STOMP端点
	 * 配置WebSocket连接端点和SockJS备用方案
	 */
	@Override
	public void registerStompEndpoints(StompEndpointRegistry registry) {
		registry.addEndpoint("/ws")
				.setAllowedOriginPatterns("*") // 开发环境允许所有来源，生产环境应指定具体域名
				.withSockJS(); // 启用SockJS作为WebSocket的备用方案
	}

	/**
	 * 配置消息代理
	 * 设置简单的内存消息代理和应用程序目的地前缀
	 */
	@Override
	public void configureMessageBroker(MessageBrokerRegistry config) {
		// 启用简单的消息代理，目的地前缀为 /topic
		config.enableSimpleBroker("/topic");

		// 设置应用程序目的地前缀（可选，用于客户端发送消息到服务器）
		config.setApplicationDestinationPrefixes("/app");
	}
}