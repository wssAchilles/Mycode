#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
AI异常检测预测服务 - main.py
功能：FastAPI服务，加载预训练模型，提供实时异常检测API
"""

import os
import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import logging
from typing import Dict, Any
import uvicorn
from contextlib import asynccontextmanager

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 全局模型变量
model = None

# 请求体模型
class SensorReading(BaseModel):
    """传感器读数请求模型"""
    pm25: float = Field(
        ..., 
        ge=0.0, 
        le=500.0, 
        description="PM2.5数值，范围0-500"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "pm25": 25.6
            }
        }


class PredictionResponse(BaseModel):
    """预测结果响应模型"""
    is_anomaly: bool = Field(..., description="是否为异常值")
    anomaly_score: float = Field(..., description="异常分数，越负越异常")
    confidence: float = Field(..., description="置信度，0-1之间")
    pm25_value: float = Field(..., description="输入的PM2.5值")
    
    class Config:
        json_schema_extra = {
            "example": {
                "is_anomaly": True,
                "anomaly_score": -0.15,
                "confidence": 0.85,
                "pm25_value": 25.6
            }
        }


def load_model():
    """加载预训练的异常检测模型"""
    global model
    
    # 使用绝对路径或相对于脚本的路径
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, "models", "anomaly_model.joblib")
    
    try:
        if not os.path.exists(model_path):
            logger.error(f"模型文件不存在: {model_path}")
            logger.error("请先运行 python train.py 来训练模型")
            raise FileNotFoundError(f"模型文件不存在: {model_path}")
        
        logger.info(f"正在加载模型: {model_path}")
        model = joblib.load(model_path)
        
        # 验证模型
        test_data = np.array([[25.0]])
        _ = model.predict(test_data)
        _ = model.decision_function(test_data)
        
        logger.info("✅ 模型加载成功并验证通过")
        return model
        
    except Exception as e:
        logger.error(f"模型加载失败: {e}")
        raise e


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时加载模型
    logger.info("🚀 AI异常检测服务启动中...")
    load_model()
    logger.info("🎯 服务已就绪，等待请求...")
    
    yield
    
    # 关闭时清理资源
    logger.info("🔄 服务正在关闭...")


# 创建FastAPI应用
app = FastAPI(
    title="AI异常检测服务",
    description="基于IsolationForest的PM2.5异常检测微服务",
    version="1.0.0",
    lifespan=lifespan
)


@app.get("/")
async def root():
    """根路径 - 服务状态检查"""
    return {
        "service": "AI异常检测服务",
        "status": "运行中",
        "version": "2.0.0",  # 更新版本号
        "model_loaded": model is not None,
        "endpoints": {
            "health": "/health",
            "predict": "/predict",
            "enhanced-predict": "/enhanced-predict",  # 添加增强预测端点
            "model-info": "/model-info",
            "docs": "/docs"
        }
    }


@app.get("/health")
async def health_check():
    """健康检查端点"""
    model_status = "已加载" if model is not None else "未加载"
    
    return {
        "status": "healthy",
        "model_status": model_status,
        "service": "AI异常检测服务"
    }


@app.post("/predict", response_model=PredictionResponse)
async def predict_anomaly(reading: SensorReading):
    """
    异常检测预测端点
    
    Args:
        reading: 传感器读数
    
    Returns:
        PredictionResponse: 预测结果
    """
    global model
    
    try:
        # 检查模型是否已加载
        if model is None:
            logger.error("模型未加载")
            raise HTTPException(
                status_code=500,
                detail="AI模型未加载，请检查服务状态"
            )
        
        # 准备输入数据
        pm25_value = reading.pm25
        input_data = np.array([[pm25_value]])
        
        # 进行预测
        prediction = model.predict(input_data)[0]  # -1为异常，1为正常
        anomaly_score = model.decision_function(input_data)[0]  # 异常分数
        
        # 处理结果
        is_anomaly = prediction == -1
        
        # 计算置信度（基于异常分数的绝对值）
        # 异常分数越负，越可能是异常；越正，越可能是正常
        confidence = min(abs(anomaly_score) * 2, 1.0)  # 限制在0-1之间
        
        result = PredictionResponse(
            is_anomaly=is_anomaly,
            anomaly_score=round(anomaly_score, 4),
            confidence=round(confidence, 4),
            pm25_value=pm25_value
        )
        
        # 记录预测日志
        status = "异常" if is_anomaly else "正常"
        logger.info(
            f"预测完成: PM2.5={pm25_value}, "
            f"结果={status}, "
            f"分数={anomaly_score:.4f}, "
            f"置信度={confidence:.4f}"
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"预测过程出错: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"预测失败: {str(e)}"
        )


@app.post("/enhanced-predict")
async def enhanced_predict_anomaly(reading: dict):
    """
    增强异常检测预测端点
    支持更详细的分析和预警
    """
    global model
    
    try:
        if model is None:
            raise HTTPException(
                status_code=500,
                detail="AI模型未加载，请检查服务状态"
            )
        
        # 获取PM2.5值
        pm25_value = reading.get("pm25", 0)
        device_id = reading.get("device_id", "unknown")
        
        # 准备输入数据
        input_data = np.array([[pm25_value]])
        
        # 进行预测
        prediction = model.predict(input_data)[0]
        anomaly_score = model.decision_function(input_data)[0]
        
        # 处理结果
        is_anomaly = prediction == -1
        
        # 增强的置信度计算
        confidence = min(abs(anomaly_score) * 2, 1.0)
        
        # 风险等级评估
        if anomaly_score > 0:
            risk_level = "low"
        elif anomaly_score > -0.05:
            risk_level = "low"
        elif anomaly_score > -0.1:
            risk_level = "medium"
        elif anomaly_score > -0.2:
            risk_level = "high"
        else:
            risk_level = "critical"
        
        # 警报级别 (0-4)
        if anomaly_score > -0.05:
            alert_level = 0 if not is_anomaly else 1
        elif anomaly_score > -0.1:
            alert_level = 2
        elif anomaly_score > -0.2:
            alert_level = 3
        else:
            alert_level = 4
        
        # 生成建议
        recommendations = []
        if alert_level == 0:
            recommendations.append("环境数据正常，继续监控")
        elif alert_level == 1:
            recommendations.append("轻微异常，建议持续观察")
        elif alert_level == 2:
            recommendations.append("中度异常，建议检查环境因素")
        elif alert_level == 3:
            recommendations.append("高度异常，立即检查传感器和周围环境")
            recommendations.append("通知环境监测人员")
        else:
            recommendations.append("严重异常！立即采取行动")
            recommendations.append("启动应急响应程序")
        
        # PM2.5特定建议
        if pm25_value > 75:
            recommendations.append("PM2.5浓度过高，建议减少户外活动")
        elif pm25_value > 35:
            recommendations.append("PM2.5浓度偏高，敏感人群应注意防护")
        
        result = {
            "is_anomaly": is_anomaly,
            "anomaly_score": round(anomaly_score, 4),
            "confidence": round(confidence, 4),
            "risk_level": risk_level,
            "pm25_value": pm25_value,
            "device_id": device_id,
            "feature_analysis": {
                "pm25_normalized": pm25_value / 50.0,
                "confidence_score": confidence
            },
            "model_ensemble": {
                "isolation_forest": {
                    "prediction": "anomaly" if is_anomaly else "normal",
                    "score": round(anomaly_score, 4)
                }
            },
            "threshold_analysis": {
                "current_score": round(anomaly_score, 4),
                "anomaly_threshold": 0.0
            },
            "recommendations": recommendations,
            "alert_level": alert_level
        }
        
        # 记录预测日志
        status = "异常" if is_anomaly else "正常"
        logger.info(
            f"增强预测完成: 设备={device_id}, PM2.5={pm25_value}, "
            f"结果={status}, 分数={anomaly_score:.4f}, 置信度={confidence:.4f}, "
            f"风险等级={risk_level}, 警报级别={alert_level}"
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"增强预测过程出错: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"增强预测失败: {str(e)}"
        )
async def predict_anomaly(reading: SensorReading):
    """
    异常检测预测端点
    
    Args:
        reading: 传感器读数
    
    Returns:
        PredictionResponse: 预测结果
    """
    global model
    
    try:
        # 检查模型是否已加载
        if model is None:
            logger.error("模型未加载")
            raise HTTPException(
                status_code=500,
                detail="AI模型未加载，请检查服务状态"
            )
        
        # 准备输入数据
        pm25_value = reading.pm25
        input_data = np.array([[pm25_value]])
        
        # 进行预测
        prediction = model.predict(input_data)[0]  # -1为异常，1为正常
        anomaly_score = model.decision_function(input_data)[0]  # 异常分数
        
        # 处理结果
        is_anomaly = prediction == -1
        
        # 计算置信度（基于异常分数的绝对值）
        # 异常分数越负，越可能是异常；越正，越可能是正常
        confidence = min(abs(anomaly_score) * 2, 1.0)  # 限制在0-1之间
        
        result = PredictionResponse(
            is_anomaly=is_anomaly,
            anomaly_score=round(anomaly_score, 4),
            confidence=round(confidence, 4),
            pm25_value=pm25_value
        )
        
        # 记录预测日志
        status = "异常" if is_anomaly else "正常"
        logger.info(
            f"预测完成: PM2.5={pm25_value}, "
            f"结果={status}, "
            f"分数={anomaly_score:.4f}, "
            f"置信度={confidence:.4f}"
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"预测过程出错: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"预测失败: {str(e)}"
        )


@app.get("/model-info")
async def get_model_info():
    """获取模型信息"""
    global model
    
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="模型未加载"
        )
    
    try:
        return {
            "model_type": "IsolationForest",
            "library": "scikit-learn",
            "model_loaded": True,
            "parameters": {
                "contamination": getattr(model, 'contamination', 'auto'),
                "n_estimators": getattr(model, 'n_estimators', 100),
                "max_samples": getattr(model, 'max_samples', 'auto'),
                "random_state": getattr(model, 'random_state', 42)
            }
        }
    except Exception as e:
        logger.error(f"获取模型信息失败: {e}")
        raise HTTPException(
            status_code=500,
            detail="无法获取模型信息"
        )


if __name__ == "__main__":
    # 本地开发运行
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # 关闭reload模式
        log_level="info"
    )