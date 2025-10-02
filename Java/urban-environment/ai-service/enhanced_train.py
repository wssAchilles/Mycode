#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
增强版AI模型训练脚本 - enhanced_train.py
功能：
1. 支持多传感器类型数据
2. 高级特征工程（时间序列特征、地理特征等）
3. 多种异常检测算法对比
4. 模型集成和优化
5. 实时预警阈值调优
"""

import os
import pandas as pd
import numpy as np
import psycopg2
import joblib
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
from sklearn.covariance import EllipticEnvelope
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler, RobustScaler
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from dotenv import load_dotenv
import logging
from typing import Optional, Dict, Tuple, List
import warnings
from datetime import datetime, timedelta

# 忽略警告
warnings.filterwarnings('ignore')

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class EnvironmentalAnomalyDetector:
    """环境数据异常检测器"""
    
    def __init__(self):
        self.models = {}
        self.scalers = {}
        self.feature_columns = []
        self.thresholds = {}
        
    def load_environment(self) -> Dict:
        """加载环境变量"""
        load_dotenv()
        
        db_config = {
            'host': os.getenv('DB_HOST', 'localhost'),
            'database': os.getenv('DB_NAME', 'urban_environment_db'),
            'user': os.getenv('DB_USER', 'user'),
            'password': os.getenv('DB_PASSWORD', 'password'),
            'port': os.getenv('DB_PORT', '5433')
        }
        
        logger.info(f"数据库配置: {db_config['host']}:{db_config['port']}/{db_config['database']}")
        return db_config
    
    def fetch_enhanced_data(self, db_config: Dict) -> Optional[pd.DataFrame]:
        """
        获取增强的传感器数据，包含更多特征
        """
        try:
            logger.info("正在连接数据库获取增强数据...")
            
            conn = psycopg2.connect(**db_config)
            
            # 获取最近7天的数据用于特征工程
            query = """
            SELECT 
                id, device_id, 
                pm25, latitude, longitude, 
                timestamp,
                EXTRACT(HOUR FROM timestamp) as hour_of_day,
                EXTRACT(DOW FROM timestamp) as day_of_week,
                EXTRACT(DOY FROM timestamp) as day_of_year
            FROM sensor_data 
            WHERE pm25 IS NOT NULL 
                AND timestamp >= NOW() - INTERVAL '7 days'
            ORDER BY device_id, timestamp
            """
            
            df = pd.read_sql_query(query, conn)
            conn.close()
            
            if len(df) == 0:
                logger.warning("没有找到最近7天的数据，使用所有历史数据")
                return self.fetch_all_data(db_config)
            
            logger.info(f"获取到 {len(df)} 条增强数据")
            return df
            
        except Exception as e:
            logger.error(f"获取增强数据失败: {e}")
            # 回退到基础数据获取
            return self.fetch_all_data(db_config)
    
    def fetch_all_data(self, db_config: Dict) -> Optional[pd.DataFrame]:
        """获取所有历史数据作为回退方案"""
        try:
            conn = psycopg2.connect(**db_config)
            
            query = """
            SELECT 
                id, device_id, 
                pm25, latitude, longitude, 
                timestamp
            FROM sensor_data 
            WHERE pm25 IS NOT NULL 
            ORDER BY timestamp DESC
            LIMIT 10000
            """
            
            df = pd.read_sql_query(query, conn)
            conn.close()
            
            # 添加时间特征
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df['hour_of_day'] = df['timestamp'].dt.hour
            df['day_of_week'] = df['timestamp'].dt.dayofweek
            df['day_of_year'] = df['timestamp'].dt.dayofyear
            
            logger.info(f"回退获取到 {len(df)} 条基础数据")
            return df
            
        except Exception as e:
            logger.error(f"获取基础数据也失败: {e}")
            return None
    
    def engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        高级特征工程
        """
        logger.info("开始特征工程...")
        
        # 确保timestamp是datetime类型
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        
        # 按设备分组进行特征工程
        enhanced_df = []
        
        for device_id in df['device_id'].unique():
            device_data = df[df['device_id'] == device_id].copy().sort_values('timestamp')
            
            if len(device_data) < 2:
                continue
                
            # 1. 基础统计特征
            device_data['pm25_mean'] = device_data['pm25'].rolling(window=5, min_periods=1).mean()
            device_data['pm25_std'] = device_data['pm25'].rolling(window=5, min_periods=1).std()
            device_data['pm25_min'] = device_data['pm25'].rolling(window=5, min_periods=1).min()
            device_data['pm25_max'] = device_data['pm25'].rolling(window=5, min_periods=1).max()
            
            # 2. 变化率特征
            device_data['pm25_diff'] = device_data['pm25'].diff()
            device_data['pm25_pct_change'] = device_data['pm25'].pct_change()
            
            # 3. 时间序列特征
            device_data['pm25_lag1'] = device_data['pm25'].shift(1)
            device_data['pm25_lag2'] = device_data['pm25'].shift(2)
            
            # 4. 地理位置偏移特征（如果设备移动）
            device_data['lat_diff'] = device_data['latitude'].diff()
            device_data['lon_diff'] = device_data['longitude'].diff()
            device_data['location_change'] = np.sqrt(
                device_data['lat_diff']**2 + device_data['lon_diff']**2
            )
            
            # 5. 时间周期特征
            device_data['hour_sin'] = np.sin(2 * np.pi * device_data['hour_of_day'] / 24)
            device_data['hour_cos'] = np.cos(2 * np.pi * device_data['hour_of_day'] / 24)
            device_data['day_sin'] = np.sin(2 * np.pi * device_data['day_of_week'] / 7)
            device_data['day_cos'] = np.cos(2 * np.pi * device_data['day_of_week'] / 7)
            
            enhanced_df.append(device_data)
        
        if not enhanced_df:
            logger.error("特征工程失败：没有足够的设备数据")
            return df
        
        result_df = pd.concat(enhanced_df, ignore_index=True)
        
        # 填充NaN值
        result_df = result_df.fillna(method='ffill').fillna(0)
        
        # 定义特征列
        self.feature_columns = [
            'pm25', 'pm25_mean', 'pm25_std', 'pm25_min', 'pm25_max',
            'pm25_diff', 'pm25_pct_change', 'pm25_lag1', 'pm25_lag2',
            'latitude', 'longitude', 'location_change',
            'hour_sin', 'hour_cos', 'day_sin', 'day_cos'
        ]
        
        # 过滤掉无穷大和NaN值
        for col in self.feature_columns:
            if col in result_df.columns:
                result_df[col] = result_df[col].replace([np.inf, -np.inf], np.nan)
                result_df[col] = result_df[col].fillna(result_df[col].median())
        
        logger.info(f"特征工程完成，生成 {len(self.feature_columns)} 个特征")
        return result_df
    
    def train_multiple_models(self, df: pd.DataFrame) -> Dict:
        """
        训练多种异常检测模型
        """
        logger.info("开始训练多种异常检测模型...")
        
        # 准备特征数据
        X = df[self.feature_columns].values
        
        # 数据标准化
        scaler = RobustScaler()  # 使用RobustScaler对异常值更稳健
        X_scaled = scaler.fit_transform(X)
        self.scalers['robust'] = scaler
        
        models = {}
        
        # 1. Isolation Forest (主推荐)
        logger.info("训练 Isolation Forest...")
        iso_forest = IsolationForest(
            contamination=0.1,  # 假设10%的数据是异常
            random_state=42,
            n_estimators=200,
            max_samples='auto',
            max_features=0.8,
            bootstrap=False,
            n_jobs=-1
        )
        iso_forest.fit(X_scaled)
        models['isolation_forest'] = iso_forest
        
        # 2. One-Class SVM
        logger.info("训练 One-Class SVM...")
        ocsvm = OneClassSVM(
            kernel='rbf',
            gamma='scale',
            nu=0.1  # 异常值比例
        )
        ocsvm.fit(X_scaled)
        models['one_class_svm'] = ocsvm
        
        # 3. Elliptic Envelope (鲁棒协方差估计)
        logger.info("训练 Elliptic Envelope...")
        elliptic = EllipticEnvelope(
            contamination=0.1,
            random_state=42
        )
        elliptic.fit(X_scaled)
        models['elliptic_envelope'] = elliptic
        
        # 4. Local Outlier Factor (仅用于预测，不保存fit状态)
        logger.info("配置 Local Outlier Factor...")
        lof = LocalOutlierFactor(
            contamination=0.1,
            novelty=True  # 允许预测新数据
        )
        lof.fit(X_scaled)
        models['local_outlier_factor'] = lof
        
        self.models = models
        
        # 评估模型性能
        self.evaluate_models(X_scaled, models)
        
        return models
    
    def evaluate_models(self, X: np.ndarray, models: Dict) -> None:
        """
        评估模型性能
        """
        logger.info("评估模型性能...")
        
        results = {}
        
        for name, model in models.items():
            predictions = model.predict(X)
            anomaly_count = sum(predictions == -1)
            anomaly_rate = anomaly_count / len(predictions) * 100
            
            results[name] = {
                'anomaly_count': anomaly_count,
                'anomaly_rate': anomaly_rate
            }
            
            logger.info(f"{name}: 检测到 {anomaly_count} 个异常 ({anomaly_rate:.2f}%)")
        
        # 选择最佳模型 (这里选择Isolation Forest作为主模型)
        self.best_model = 'isolation_forest'
        logger.info(f"选择 {self.best_model} 作为主要模型")
    
    def create_ensemble_model(self) -> None:
        """
        创建集成模型，结合多个算法的预测结果
        """
        logger.info("创建集成异常检测模型...")
        
        def ensemble_predict(X):
            """集成预测函数"""
            predictions = {}
            scores = {}
            
            # 获取各模型的预测结果
            for name, model in self.models.items():
                pred = model.predict(X)
                predictions[name] = pred
                
                # 获取异常分数
                if hasattr(model, 'decision_function'):
                    scores[name] = model.decision_function(X)
                elif hasattr(model, 'score_samples'):
                    scores[name] = model.score_samples(X)
                else:
                    scores[name] = pred  # 使用预测结果作为分数
            
            # 投票机制：多数模型认为是异常则为异常
            ensemble_pred = []
            ensemble_score = []
            
            for i in range(len(X)):
                votes = [predictions[name][i] for name in predictions]
                anomaly_votes = sum(1 for vote in votes if vote == -1)
                
                # 如果超过一半的模型认为是异常，则判定为异常
                if anomaly_votes >= len(self.models) / 2:
                    ensemble_pred.append(-1)
                else:
                    ensemble_pred.append(1)
                
                # 平均异常分数
                avg_score = np.mean([scores[name][i] for name in scores])
                ensemble_score.append(avg_score)
            
            return np.array(ensemble_pred), np.array(ensemble_score)
        
        self.ensemble_predict = ensemble_predict
    
    def optimize_thresholds(self, df: pd.DataFrame) -> None:
        """
        优化异常检测阈值
        """
        logger.info("优化异常检测阈值...")
        
        X = df[self.feature_columns].values
        X_scaled = self.scalers['robust'].transform(X)
        
        # 使用主模型获取决策分数
        main_model = self.models[self.best_model]
        scores = main_model.decision_function(X_scaled)
        
        # 计算不同阈值下的统计信息
        percentiles = [90, 95, 97, 99, 99.5]
        
        for p in percentiles:
            threshold = np.percentile(scores, 100 - p)
            anomaly_count = sum(scores < threshold)
            anomaly_rate = anomaly_count / len(scores) * 100
            
            self.thresholds[f'p{p}'] = {
                'threshold': threshold,
                'anomaly_rate': anomaly_rate
            }
            
            logger.info(f"阈值 P{p}: {threshold:.4f} (异常率: {anomaly_rate:.2f}%)")
        
        # 设置默认阈值 (95th percentile)
        self.default_threshold = self.thresholds['p95']['threshold']
    
    def save_enhanced_model(self, model_dir: str) -> bool:
        """
        保存增强的模型和相关组件
        """
        try:
            os.makedirs(model_dir, exist_ok=True)
            
            # 保存主模型
            main_model_path = os.path.join(model_dir, 'enhanced_anomaly_model.joblib')
            joblib.dump(self.models[self.best_model], main_model_path)
            
            # 保存所有模型
            all_models_path = os.path.join(model_dir, 'all_models.joblib')
            joblib.dump(self.models, all_models_path)
            
            # 保存缩放器
            scaler_path = os.path.join(model_dir, 'feature_scaler.joblib')
            joblib.dump(self.scalers['robust'], scaler_path)
            
            # 保存特征列和阈值信息
            metadata = {
                'feature_columns': self.feature_columns,
                'thresholds': self.thresholds,
                'default_threshold': self.default_threshold,
                'best_model': self.best_model,
                'training_time': datetime.now().isoformat()
            }
            
            metadata_path = os.path.join(model_dir, 'model_metadata.joblib')
            joblib.dump(metadata, metadata_path)
            
            # 创建模型信息文件
            info_path = os.path.join(model_dir, 'model_info.txt')
            with open(info_path, 'w', encoding='utf-8') as f:
                f.write("Enhanced Environmental Anomaly Detection Model\n")
                f.write("=" * 50 + "\n\n")
                f.write(f"Training Time: {metadata['training_time']}\n")
                f.write(f"Best Model: {self.best_model}\n")
                f.write(f"Features: {len(self.feature_columns)}\n")
                f.write(f"Feature List:\n")
                for i, feature in enumerate(self.feature_columns, 1):
                    f.write(f"  {i}. {feature}\n")
                f.write(f"\nThresholds:\n")
                for name, info in self.thresholds.items():
                    f.write(f"  {name}: {info['threshold']:.4f} ({info['anomaly_rate']:.2f}%)\n")
            
            logger.info(f"增强模型保存成功到: {model_dir}")
            return True
            
        except Exception as e:
            logger.error(f"保存增强模型失败: {e}")
            return False
    
    def train_complete_pipeline(self) -> bool:
        """
        执行完整的训练流水线
        """
        logger.info("=" * 60)
        logger.info("开始增强版AI异常检测模型训练")
        logger.info("=" * 60)
        
        # 1. 加载环境配置
        db_config = self.load_environment()
        
        # 2. 获取增强数据
        df = self.fetch_enhanced_data(db_config)
        if df is None or len(df) == 0:
            logger.error("无法获取训练数据")
            return False
        
        logger.info(f"数据概览:")
        logger.info(f"  记录数: {len(df)}")
        logger.info(f"  设备数: {df['device_id'].nunique()}")
        logger.info(f"  PM2.5范围: {df['pm25'].min():.2f} - {df['pm25'].max():.2f}")
        logger.info(f"  时间范围: {df['timestamp'].min()} 到 {df['timestamp'].max()}")
        
        # 3. 特征工程
        df_enhanced = self.engineer_features(df)
        if len(df_enhanced) < 10:
            logger.error("特征工程后数据不足")
            return False
        
        # 4. 训练多种模型
        models = self.train_multiple_models(df_enhanced)
        
        # 5. 创建集成模型
        self.create_ensemble_model()
        
        # 6. 优化阈值
        self.optimize_thresholds(df_enhanced)
        
        # 7. 保存模型
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_dir = os.path.join(script_dir, "models")
        success = self.save_enhanced_model(model_dir)
        
        if success:
            logger.info("=" * 60)
            logger.info("🎉 增强版AI模型训练完成！")
            logger.info("✅ 特征工程: 时间序列 + 地理 + 统计特征")
            logger.info("✅ 多算法集成: IsolationForest + OneClassSVM + EllipticEnvelope + LOF")
            logger.info("✅ 智能阈值优化: 自适应异常检测阈值")
            logger.info("✅ 完整模型包: 模型 + 缩放器 + 元数据")
            logger.info("🚀 模型已准备就绪，可以部署到生产环境！")
            logger.info("=" * 60)
            return True
        else:
            logger.error("模型保存失败")
            return False


def main():
    """主执行函数"""
    detector = EnvironmentalAnomalyDetector()
    success = detector.train_complete_pipeline()
    return success


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)