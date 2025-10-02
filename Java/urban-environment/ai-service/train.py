#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
AI模型训练脚本 - train.py
功能：连接数据库，获取历史数据，训练异常检测模型并保存
"""

import os
import pandas as pd
import psycopg2
import joblib
from sklearn.ensemble import IsolationForest
from dotenv import load_dotenv
import logging
from typing import Optional

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_environment():
    """加载环境变量"""
    load_dotenv()
    
    db_config = {
        'host': os.getenv('DB_HOST', 'localhost'),
        'database': os.getenv('DB_NAME', 'urban_environment_db'),  # 修正数据库名
        'user': os.getenv('DB_USER', 'user'),                      # 修正用户名
        'password': os.getenv('DB_PASSWORD', 'password'),           # 修正密码字段名
        'port': os.getenv('DB_PORT', '5433')                       # 修正端口
    }
    
    logger.info(f"数据库配置: {db_config['host']}:{db_config['port']}/{db_config['database']}")
    return db_config


def fetch_data(db_config: dict) -> Optional[pd.DataFrame]:
    """
    连接数据库并获取传感器数据
    
    Args:
        db_config: 数据库连接配置
    
    Returns:
        DataFrame: 包含pm25数据的DataFrame，失败返回None
    """
    try:
        logger.info("正在连接数据库...")
        
        # 建立数据库连接
        conn = psycopg2.connect(**db_config)
        
        # SQL查询：获取所有非空的pm25数据
        query = """
        SELECT id, pm25, latitude, longitude, timestamp 
        FROM sensor_data 
        WHERE pm25 IS NOT NULL 
        ORDER BY timestamp DESC
        """
        
        logger.info("正在执行查询...")
        df = pd.read_sql_query(query, conn)
        
        conn.close()
        
        logger.info(f"数据获取成功！共获取 {len(df)} 条记录")
        logger.info(f"PM2.5数据范围: {df['pm25'].min():.2f} - {df['pm25'].max():.2f}")
        
        return df
        
    except psycopg2.Error as e:
        logger.error(f"数据库连接错误: {e}")
        return None
    except Exception as e:
        logger.error(f"数据获取失败: {e}")
        return None


def train_model(df: pd.DataFrame) -> Optional[IsolationForest]:
    """
    训练异常检测模型
    
    Args:
        df: 包含pm25列的DataFrame
    
    Returns:
        训练好的IsolationForest模型，失败返回None
    """
    try:
        logger.info("开始训练异常检测模型...")
        
        # 检查数据是否足够
        if len(df) < 50:
            logger.warning(f"数据量不足（{len(df)}条），建议至少50条数据进行训练")
        
        # 准备训练数据（仅使用pm25列）
        X = df[['pm25']].values
        
        # 初始化IsolationForest模型
        model = IsolationForest(
            contamination='auto',  # 自动检测异常比例
            random_state=42,       # 固定随机种子确保可重现性
            n_estimators=100,      # 树的数量
            max_samples='auto',    # 每棵树的样本数
            max_features=1.0,      # 使用所有特征
            bootstrap=False,       # 不使用bootstrap采样
            n_jobs=-1,            # 使用所有CPU核心
            verbose=0             # 不显示详细训练过程
        )
        
        # 训练模型
        logger.info("正在训练模型...")
        model.fit(X)
        
        # 在训练数据上进行预测，检查模型性能
        predictions = model.predict(X)
        anomaly_count = sum(predictions == -1)
        normal_count = sum(predictions == 1)
        anomaly_rate = anomaly_count / len(predictions) * 100
        
        logger.info(f"模型训练完成！")
        logger.info(f"训练数据统计: 正常 {normal_count} 条, 异常 {anomaly_count} 条")
        logger.info(f"异常检出率: {anomaly_rate:.2f}%")
        
        return model
        
    except Exception as e:
        logger.error(f"模型训练失败: {e}")
        return None


def save_model(model: IsolationForest, model_path: str) -> bool:
    """
    保存训练好的模型
    
    Args:
        model: 训练好的模型
        model_path: 模型保存路径
    
    Returns:
        bool: 保存成功返回True，失败返回False
    """
    try:
        # 确保模型目录存在
        os.makedirs(os.path.dirname(model_path), exist_ok=True)
        
        # 保存模型
        logger.info(f"正在保存模型到: {model_path}")
        joblib.dump(model, model_path)
        
        # 验证模型文件
        if os.path.exists(model_path):
            file_size = os.path.getsize(model_path)
            logger.info(f"模型保存成功！文件大小: {file_size / 1024:.2f} KB")
            return True
        else:
            logger.error("模型文件保存失败")
            return False
            
    except Exception as e:
        logger.error(f"模型保存错误: {e}")
        return False


def main():
    """主执行函数"""
    logger.info("=" * 50)
    logger.info("开始AI异常检测模型训练流程")
    logger.info("=" * 50)
    
    # 1. 加载环境配置
    db_config = load_environment()
    
    # 2. 获取训练数据
    df = fetch_data(db_config)
    if df is None or len(df) == 0:
        logger.error("无法获取训练数据，训练中止")
        return False
    
    # 3. 训练模型
    model = train_model(df)
    if model is None:
        logger.error("模型训练失败，训练中止")
        return False
    
    # 4. 保存模型（使用绝对路径）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, "models", "anomaly_model.joblib")
    success = save_model(model, model_path)
    if not success:
        logger.error("模型保存失败，训练中止")
        return False
    
    logger.info("=" * 50)
    logger.info("🎉 模型训练流程完成！")
    logger.info(f"✅ 模型文件: {model_path}")
    logger.info(f"✅ 训练数据量: {len(df)} 条")
    logger.info("🚀 现在可以启动AI预测服务了！")
    logger.info("=" * 50)
    
    return True


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)