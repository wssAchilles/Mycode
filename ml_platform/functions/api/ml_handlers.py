"""
机器学习业务逻辑处理模块
负责训练请求的参数解析、流程控制和结果持久化
"""

import json
import traceback
from firebase_functions import https_fn
from firebase_admin import firestore
import traceback
import json

from ml_engine.preprocessing import preprocess_data
from ml_engine.trainer import (
    train_classification_model, 
    train_regression_model, 
    train_clustering_model
)
from utils.storage import download_dataset_from_storage

def handle_train_model(req: https_fn.CallableRequest) -> dict:
    """处理模型训练请求 (Callable)"""
    try:
        # 1. 获取参数 (CallableRequest 自动解析 data)
        data = req.data
        if not data:
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT, message='请求数据为空')
        
        # 2. 提取参数
        dataset_url = data.get('dataset_url')
        model_config = data.get('model_config', {})
        task_type = data.get('task_type', 'classification')
        feature_columns = data.get('feature_columns', [])
        target_column = data.get('target_column')
        user_id = data.get('user_id', 'anonymous')
        
        # 3. 参数验证
        if not dataset_url:
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT, message='缺少数据集URL')
        if not feature_columns:
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT, message='缺少特征列')
            
        # 4. 核心流程：下载 -> 预处理 -> 训练
        
        # 下载
        try:
            df = download_dataset_from_storage(dataset_url)
        except Exception as e:
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message=f'数据下载失败: {str(e)}')
            
        # 预处理
        try:
            X, y = preprocess_data(df, feature_columns, target_column, task_type)
        except Exception as e:
             raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message=f'数据预处理失败: {str(e)}')
            
        # 训练
        model_name = model_config.get('model_name', 'RandomForestClassifier')
        hyperparameters = model_config.get('hyperparameters', {})
        
        try:
            if task_type == 'classification':
                if y is None:
                    raise ValueError("分类任务需要目标列")
                metrics, visualization_data = train_classification_model(X, y, model_name, hyperparameters)
            elif task_type == 'regression':
                if y is None:
                    raise ValueError("回归任务需要目标列")
                metrics, visualization_data = train_regression_model(X, y, model_name, hyperparameters)
            elif task_type == 'clustering':
                metrics, visualization_data = train_clustering_model(X, model_name, hyperparameters)
            else:
                raise ValueError(f"不支持的任务类型: {task_type}")
        except Exception as e:
            print(f"训练错误: {traceback.format_exc()}")
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message=f'模型训练失败: {str(e)}')
            
        # 5. 持久化记录
        try:
            db = firestore.client()
            experiment_record = {
                'user_id': user_id,
                'dataset_url': dataset_url,
                'model_config': model_config,
                'task_type': task_type,
                'feature_columns': feature_columns,
                'target_column': target_column,
                'metrics': metrics,
                'timestamp': firestore.SERVER_TIMESTAMP
            }
            experiment_ref = db.collection('experiments').add(experiment_record)
            experiment_id = experiment_ref[1].id
        except Exception as e:
            # 记录失败不应阻断返回结果，但要记录日志
            print(f"Firestore 写入失败: {str(e)}")
            experiment_id = None
            
        # 6. 返回响应 (直接返回 dict)
        return {
            'status': 'success',
            'metrics': metrics,
            'visualization_data': visualization_data,
            'model_info': {
                'model_name': model_name,
                'hyperparameters': hyperparameters,
                'task_type': task_type,
                'n_features': X.shape[1],
                'n_samples': X.shape[0]
            },
            'experiment_id': experiment_id
        }
        
    except https_fn.HttpsError:
        raise
    except Exception as e:
        print(f"全局异常: {traceback.format_exc()}")
        raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message=f'服务器内部错误: {str(e)}')

def handle_get_history(req: https_fn.CallableRequest) -> dict:
    """处理获取历史记录请求 (Callable)"""
    try:
        data = req.data or {}
        user_id = data.get('user_id') or 'anonymous'
        limit = data.get('limit', 10)
        
        try:
            limit = int(limit)
        except:
            limit = 10
        
        # 查询 (Firestore logic remains same)
        db = firestore.client()
        experiments_ref = db.collection('experiments')
        query = experiments_ref.where('user_id', '==', user_id)\
                               .order_by('timestamp', direction=firestore.Query.DESCENDING)\
                               .limit(limit)
        
        experiments = []
        for doc in query.stream():
            experiment = doc.to_dict()
            experiment['id'] = doc.id
            if 'timestamp' in experiment and experiment['timestamp']:
                experiment['timestamp'] = experiment['timestamp'].isoformat()
            experiments.append(experiment)
            
        return {'status': 'success', 'experiments': experiments}
        
    except Exception as e:
        raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message=str(e))
