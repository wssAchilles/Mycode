#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
增强版AI异常检测预测服务 - enhanced_main.py
功能：
1. 支持多特征异常检测
2. 集成多种算法的预测结果
3. 智能阈值调整
4. 实时预警系统
5. 详细的预测分析报告
"""

import os
import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
import logging
from typing import Dict, Any, List, Optional
import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import asyncio

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 全局变量
enhanced_model = None
feature_scaler = None
model_metadata = None
all_models = None


class SensorReading(BaseModel):
    """传感器读数请求模型"""
    pm25: float = Field(..., ge=0.0, le=500.0, description="PM2.5数值，范围0-500")
    temperature: Optional[float] = Field(None, ge=-50.0, le=70.0, description="温度，范围-50到70°C")
    humidity: Optional[float] = Field(None, ge=0.0, le=100.0, description="湿度，范围0-100%")
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0, description="纬度")
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0, description="经度")
    device_id: str = Field(..., description="设备ID")
    timestamp: Optional[str] = Field(None, description="时间戳 (ISO格式)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "pm25": 25.6,
                "temperature": 23.5,
                "humidity": 65.2,
                "latitude": 35.6895,
                "longitude": 139.6917,
                "device_id": "sensor-tokyo-01",
                "timestamp": "2025-09-17T10:00:00Z"
            }
        }


class EnhancedPredictionResponse(BaseModel):
    """增强预测结果响应模型"""
    is_anomaly: bool = Field(..., description="是否为异常值")
    anomaly_score: float = Field(..., description="异常分数，越负越异常")
    confidence: float = Field(..., description="置信度，0-1之间")
    risk_level: str = Field(..., description="风险等级: low/medium/high/critical")
    
    # 输入数据
    pm25_value: float = Field(..., description="输入的PM2.5值")
    device_id: str = Field(..., description="设备ID")
    
    # 增强分析
    feature_analysis: Dict[str, float] = Field(..., description="特征分析")
    model_ensemble: Dict[str, Any] = Field(..., description="多模型集成结果")
    threshold_analysis: Dict[str, float] = Field(..., description="阈值分析")
    
    # 建议
    recommendations: List[str] = Field(..., description="建议措施")
    alert_level: int = Field(..., ge=0, le=4, description="警报级别 0-4")
    
    class Config:
        json_schema_extra = {
            "example": {
                "is_anomaly": True,
                "anomaly_score": -0.15,
                "confidence": 0.85,
                "risk_level": "high",
                "pm25_value": 35.6,
                "device_id": "sensor-tokyo-01",
                "feature_analysis": {
                    "pm25_normalized": 1.2,
                    "time_factor": 0.8,
                    "location_factor": 0.9
                },
                "model_ensemble": {
                    "isolation_forest": -0.15,
                    "one_class_svm": -0.12,
                    "elliptic_envelope": -0.18,
                    "consensus": "anomaly"
                },
                "threshold_analysis": {
                    "p95_threshold": -0.0078,
                    "p97_threshold": -0.0301,
                    "current_score": -0.15
                },
                "recommendations": [
                    "立即检查传感器周围环境",
                    "考虑启动应急响应程序",
                    "通知相关人员"
                ],
                "alert_level": 3
            }
        }


class AlertManager:
    """警报管理器"""
    
    def __init__(self):
        self.alert_history = []
        self.active_alerts = {}
        
    def should_trigger_alert(self, device_id: str, anomaly_score: float, confidence: float) -> bool:
        """判断是否应该触发警报"""
        # 高置信度的异常值触发警报
        return confidence > 0.7 and anomaly_score < -0.05
        
    def get_alert_level(self, anomaly_score: float, confidence: float) -> int:
        """获取警报级别 0-4"""
        if anomaly_score > 0:
            return 0  # 正常
        elif anomaly_score > -0.05:
            return 1  # 轻微异常
        elif anomaly_score > -0.1:
            return 2  # 中度异常
        elif anomaly_score > -0.2:
            return 3  # 高度异常
        else:
            return 4  # 严重异常
    
    def generate_recommendations(self, pm25: float, anomaly_score: float, alert_level: int) -> List[str]:
        """生成建议措施"""
        recommendations = []
        
        if alert_level == 0:
            recommendations.append("环境数据正常，继续监控")
        elif alert_level == 1:
            recommendations.append("轻微异常，建议持续观察")
            recommendations.append("检查传感器校准状态")
        elif alert_level == 2:
            recommendations.append("中度异常，建议检查环境因素")
            recommendations.append("考虑增加监测频率")
        elif alert_level == 3:
            recommendations.append("高度异常，立即检查传感器和周围环境")
            recommendations.append("通知环境监测人员")
            recommendations.append("考虑启动应急响应")
        else:  # alert_level == 4
            recommendations.append("严重异常！立即采取行动")
            recommendations.append("启动应急响应程序")
            recommendations.append("通知所有相关责任人")
            recommendations.append("考虑疏散或防护措施")
        
        # PM2.5特定建议
        if pm25 > 75:
            recommendations.append("PM2.5浓度过高，建议减少户外活动")
        elif pm25 > 35:
            recommendations.append("PM2.5浓度偏高，敏感人群应注意防护")
            
        return recommendations


# 全局警报管理器
alert_manager = AlertManager()


def load_enhanced_models():
    """加载增强模型和相关组件"""
    global enhanced_model, feature_scaler, model_metadata, all_models
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = os.path.join(script_dir, "models")
    
    try:
        # 加载主模型
        enhanced_model_path = os.path.join(model_dir, 'enhanced_anomaly_model.joblib')
        if os.path.exists(enhanced_model_path):
            enhanced_model = joblib.load(enhanced_model_path)
            logger.info("✅ 增强主模型加载成功")
        else:
            # 回退到原始模型
            original_model_path = os.path.join(model_dir, 'anomaly_model.joblib')
            if os.path.exists(original_model_path):
                enhanced_model = joblib.load(original_model_path)
                logger.info("⚠️ 使用原始模型作为回退")
            else:
                raise FileNotFoundError("找不到任何可用的模型文件")
        
        # 加载特征缩放器
        scaler_path = os.path.join(model_dir, 'feature_scaler.joblib')
        if os.path.exists(scaler_path):
            feature_scaler = joblib.load(scaler_path)
            logger.info("✅ 特征缩放器加载成功")
        
        # 加载模型元数据
        metadata_path = os.path.join(model_dir, 'model_metadata.joblib')
        if os.path.exists(metadata_path):
            model_metadata = joblib.load(metadata_path)
            logger.info("✅ 模型元数据加载成功")
            logger.info(f"特征数量: {len(model_metadata.get('feature_columns', []))}")
        
        # 加载所有模型（用于集成预测）
        all_models_path = os.path.join(model_dir, 'all_models.joblib')
        if os.path.exists(all_models_path):
            all_models = joblib.load(all_models_path)
            logger.info(f"✅ 集成模型加载成功 ({len(all_models)} 个模型)")
        
        return True
        
    except Exception as e:
        logger.error(f"模型加载失败: {e}")
        return False


def engineer_single_features(reading: SensorReading) -> np.ndarray:
    """为单个读数生成特征"""
    try:
        # 解析时间戳
        if reading.timestamp:
            timestamp = datetime.fromisoformat(reading.timestamp.replace('Z', '+00:00'))
        else:
            timestamp = datetime.now(timezone.utc)
        
        # 基础特征
        features = {
            'pm25': reading.pm25,
            'latitude': reading.latitude or 35.6895,  # 默认值
            'longitude': reading.longitude or 139.6917,
        }
        
        # 时间特征
        hour = timestamp.hour
        day_of_week = timestamp.weekday()
        
        features.update({
            'hour_sin': np.sin(2 * np.pi * hour / 24),
            'hour_cos': np.cos(2 * np.pi * hour / 24),
            'day_sin': np.sin(2 * np.pi * day_of_week / 7),
            'day_cos': np.cos(2 * np.pi * day_of_week / 7),
        })
        
        # 由于是单个读数，无法计算时间序列特征，使用默认值
        default_features = {
            'pm25_mean': reading.pm25,
            'pm25_std': 0.0,
            'pm25_min': reading.pm25,
            'pm25_max': reading.pm25,
            'pm25_diff': 0.0,
            'pm25_pct_change': 0.0,
            'pm25_lag1': reading.pm25,
            'pm25_lag2': reading.pm25,
            'location_change': 0.0,
        }
        
        features.update(default_features)
        
        # 如果有模型元数据，使用指定的特征顺序
        if model_metadata and 'feature_columns' in model_metadata:
            feature_columns = model_metadata['feature_columns']
            feature_array = np.array([features.get(col, 0.0) for col in feature_columns])
        else:
            # 使用默认特征顺序
            default_columns = [
                'pm25', 'pm25_mean', 'pm25_std', 'pm25_min', 'pm25_max',
                'pm25_diff', 'pm25_pct_change', 'pm25_lag1', 'pm25_lag2',
                'latitude', 'longitude', 'location_change',
                'hour_sin', 'hour_cos', 'day_sin', 'day_cos'
            ]
            feature_array = np.array([features.get(col, 0.0) for col in default_columns])
        
        return feature_array.reshape(1, -1)
        
    except Exception as e:
        logger.error(f"特征工程失败: {e}")
        # 返回最简单的特征：只有PM2.5
        return np.array([[reading.pm25]])


def get_risk_level(anomaly_score: float, confidence: float) -> str:
    """获取风险等级"""
    if anomaly_score > 0:
        return "low"
    elif anomaly_score > -0.05 or confidence < 0.5:
        return "low"
    elif anomaly_score > -0.1 or confidence < 0.7:
        return "medium"
    elif anomaly_score > -0.2 or confidence < 0.85:
        return "high"
    else:
        return "critical"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("🚀 增强版AI异常检测服务启动中...")
    
    success = load_enhanced_models()
    if not success:
        logger.error("❌ 模型加载失败，服务无法启动")
        raise Exception("Model loading failed")
    
    logger.info("✅ 增强版AI服务已就绪")
    logger.info("🎯 支持多特征分析、集成预测、智能预警")
    
    yield
    
    logger.info("🔄 增强版AI服务正在关闭...")


# 创建FastAPI应用
app = FastAPI(
    title="增强版AI异常检测服务",
    description="基于多算法集成的环境数据异常检测微服务，支持特征工程、智能阈值、实时预警",
    version="2.0.0",
    lifespan=lifespan
)


@app.get("/")
async def root():
    """根路径 - 服务状态检查"""
    return {
        "service": "增强版AI异常检测服务",
        "status": "运行中",
        "version": "2.0.0",
        "features": [
            "多特征异常检测",
            "算法集成预测",
            "智能阈值调整",
            "实时预警系统",
            "详细分析报告"
        ],
        "model_loaded": enhanced_model is not None,
        "scaler_loaded": feature_scaler is not None,
        "metadata_loaded": model_metadata is not None,
        "ensemble_models": len(all_models) if all_models else 0,
        "endpoints": {
            "health": "/health",
            "predict": "/predict",
            "enhanced_predict": "/enhanced-predict",
            "model_info": "/model-info",
            "alerts": "/alerts",
            "docs": "/docs"
        }
    }


@app.get("/health")
async def health_check():
    """健康检查端点"""
    model_status = "已加载" if enhanced_model is not None else "未加载"
    
    return {
        "status": "healthy",
        "model_status": model_status,
        "scaler_status": "已加载" if feature_scaler else "未加载",
        "metadata_status": "已加载" if model_metadata else "未加载",
        "service": "增强版AI异常检测服务",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat()
    }


@app.post("/enhanced-predict", response_model=EnhancedPredictionResponse)
async def enhanced_predict_anomaly(reading: SensorReading):
    """
    增强异常检测预测端点
    
    Args:
        reading: 传感器读数
    
    Returns:
        EnhancedPredictionResponse: 详细预测结果
    """
    global enhanced_model, feature_scaler, model_metadata, all_models
    
    try:
        # 检查模型是否已加载
        if enhanced_model is None:
            raise HTTPException(
                status_code=500,
                detail="AI模型未加载，请检查服务状态"
            )
        
        # 特征工程
        features = engineer_single_features(reading)
        
        # 特征缩放
        if feature_scaler is not None:
            features_scaled = feature_scaler.transform(features)
        else:
            features_scaled = features
        
        # 主模型预测
        prediction = enhanced_model.predict(features_scaled)[0]
        anomaly_score = enhanced_model.decision_function(features_scaled)[0]
        
        # 基本异常判断
        is_anomaly = prediction == -1
        
        # 计算置信度
        confidence = min(abs(anomaly_score) * 2, 1.0)
        
        # 集成模型预测
        model_ensemble = {}
        if all_models:
            for model_name, model in all_models.items():
                try:
                    pred = model.predict(features_scaled)[0]
                    if hasattr(model, 'decision_function'):
                        score = model.decision_function(features_scaled)[0]
                    else:
                        score = pred
                    model_ensemble[model_name] = {
                        "prediction": "anomaly" if pred == -1 else "normal",
                        "score": float(score)
                    }
                except Exception as e:
                    logger.warning(f"模型 {model_name} 预测失败: {e}")
        
        # 风险等级评估
        risk_level = get_risk_level(anomaly_score, confidence)
        
        # 警报级别
        alert_level = alert_manager.get_alert_level(anomaly_score, confidence)
        
        # 特征分析
        feature_analysis = {
            "pm25_normalized": float(reading.pm25 / 50.0),  # 归一化到标准值
            "time_factor": abs(np.sin(2 * np.pi * datetime.now().hour / 24)),
            "confidence_score": float(confidence)
        }
        
        # 阈值分析
        threshold_analysis = {}
        if model_metadata and 'thresholds' in model_metadata:
            thresholds = model_metadata['thresholds']
            for name, info in thresholds.items():
                threshold_analysis[f"{name}_threshold"] = float(info['threshold'])
        
        threshold_analysis["current_score"] = float(anomaly_score)
        
        # 生成建议
        recommendations = alert_manager.generate_recommendations(
            reading.pm25, anomaly_score, alert_level
        )
        
        # 构建响应
        result = EnhancedPredictionResponse(
            is_anomaly=is_anomaly,
            anomaly_score=round(anomaly_score, 4),
            confidence=round(confidence, 4),
            risk_level=risk_level,
            pm25_value=reading.pm25,
            device_id=reading.device_id,
            feature_analysis=feature_analysis,
            model_ensemble=model_ensemble or {"main_model": {"prediction": "anomaly" if is_anomaly else "normal", "score": float(anomaly_score)}},
            threshold_analysis=threshold_analysis,
            recommendations=recommendations,
            alert_level=alert_level
        )
        
        # 记录预测日志
        status = "异常" if is_anomaly else "正常"
        logger.info(
            f"增强预测完成: 设备={reading.device_id}, PM2.5={reading.pm25}, "
            f"结果={status}, 分数={anomaly_score:.4f}, 置信度={confidence:.4f}, "
            f"风险等级={risk_level}, 警报级别={alert_level}"
        )
        
        # 检查是否需要触发警报
        if alert_manager.should_trigger_alert(reading.device_id, anomaly_score, confidence):
            logger.warning(f"⚠️ 异常警报: 设备 {reading.device_id} 检测到严重异常")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"增强预测失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"增强预测失败: {str(e)}"
        )


# 保持向后兼容的简单预测端点
@app.post("/predict")
async def simple_predict_anomaly(reading: Dict[str, float]):
    """
    简单异常检测预测端点（向后兼容）
    """
    try:
        # 转换为增强输入格式
        enhanced_reading = SensorReading(
            pm25=reading.get("pm25", 0),
            device_id=reading.get("device_id", "unknown"),
            temperature=reading.get("temperature"),
            humidity=reading.get("humidity"),
            latitude=reading.get("latitude"),
            longitude=reading.get("longitude")
        )
        
        # 调用增强预测
        enhanced_result = await enhanced_predict_anomaly(enhanced_reading)
        
        # 返回简化结果
        return {
            "is_anomaly": enhanced_result.is_anomaly,
            "anomaly_score": enhanced_result.anomaly_score,
            "confidence": enhanced_result.confidence,
            "pm25_value": enhanced_result.pm25_value
        }
        
    except Exception as e:
        logger.error(f"简单预测失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"预测失败: {str(e)}"
        )


@app.get("/model-info")
async def get_enhanced_model_info():
    """获取增强模型信息"""
    if enhanced_model is None:
        raise HTTPException(status_code=503, detail="模型未加载")
    
    info = {
        "model_type": "Enhanced Environmental Anomaly Detector",
        "version": "2.0.0",
        "primary_algorithm": "IsolationForest",
        "model_loaded": True,
        "features": {
            "feature_engineering": True,
            "multi_algorithm_ensemble": True,
            "intelligent_thresholding": True,
            "real_time_alerting": True
        }
    }
    
    if model_metadata:
        info.update({
            "feature_count": len(model_metadata.get('feature_columns', [])),
            "feature_columns": model_metadata.get('feature_columns', []),
            "training_time": model_metadata.get('training_time', 'unknown'),
            "thresholds": model_metadata.get('thresholds', {})
        })
    
    if all_models:
        info["ensemble_models"] = list(all_models.keys())
    
    return info


@app.get("/alerts")
async def get_alerts():
    """获取警报状态"""
    return {
        "alert_history_count": len(alert_manager.alert_history),
        "active_alerts_count": len(alert_manager.active_alerts),
        "alert_levels": {
            "0": "正常",
            "1": "轻微异常",
            "2": "中度异常", 
            "3": "高度异常",
            "4": "严重异常"
        }
    }


if __name__ == "__main__":
    # 本地开发运行
    uvicorn.run(
        "enhanced_main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )