"""
机器学习模型实验平台 - Firebase Cloud Functions后端服务
"""

import json
import traceback
import os
import time
import uuid
from firebase_functions import https_fn, options, params
from firebase_admin import initialize_app, storage, firestore
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    confusion_matrix, classification_report,
    silhouette_score, davies_bouldin_score, calinski_harabasz_score,
    mean_squared_error, r2_score, mean_absolute_error
)

# 分类算法
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from sklearn.naive_bayes import GaussianNB

# 回归算法
from sklearn.linear_model import LinearRegression, Ridge, Lasso
from sklearn.tree import DecisionTreeRegressor
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.svm import SVR

# 聚类算法
from sklearn.cluster import KMeans, DBSCAN, AgglomerativeClustering
from sklearn.mixture import GaussianMixture

# 降维算法
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE

# 初始化Firebase Admin
app = initialize_app()
# db 将在函数内部按需初始化

# 模型工厂
MODEL_FACTORY = {
    # 分类模型
    'LogisticRegression': LogisticRegression,
    'DecisionTreeClassifier': DecisionTreeClassifier,
    'RandomForestClassifier': RandomForestClassifier,
    'GradientBoostingClassifier': GradientBoostingClassifier,
    'SVC': SVC,
    'KNeighborsClassifier': KNeighborsClassifier,
    'GaussianNB': GaussianNB,
    
    # 回归模型
    'LinearRegression': LinearRegression,
    'Ridge': Ridge,
    'Lasso': Lasso,
    'DecisionTreeRegressor': DecisionTreeRegressor,
    'RandomForestRegressor': RandomForestRegressor,
    'GradientBoostingRegressor': GradientBoostingRegressor,
    'SVR': SVR,
    
    # 聚类模型
    'KMeans': KMeans,
    'DBSCAN': DBSCAN,
    'AgglomerativeClustering': AgglomerativeClustering,
    'GaussianMixture': GaussianMixture,
}

def download_dataset_from_storage(dataset_url):
    """从Firebase Storage下载数据集"""
    try:
        # 从URL中提取bucket和路径
        # 格式: gs://bucket-name/path/to/file.csv
        if dataset_url.startswith('gs://'):
            parts = dataset_url[5:].split('/', 1)
            bucket_name = parts[0]
            file_path = parts[1] if len(parts) > 1 else ''
        else:
            # 处理HTTPS URL
            # 格式: https://firebasestorage.googleapis.com/v0/b/bucket-name/o/path%2Fto%2Ffile.csv
            import urllib.parse
            url_parts = urllib.parse.urlparse(dataset_url)
            path_parts = url_parts.path.split('/')
            bucket_name = path_parts[4] if len(path_parts) > 4 else ''
            file_path = urllib.parse.unquote(path_parts[6]) if len(path_parts) > 6 else ''
        
        # 下载文件
        bucket = storage.bucket(bucket_name)
        blob = bucket.blob(file_path)
        content = blob.download_as_text()
        
        # 转换为DataFrame
        import io
        df = pd.read_csv(io.StringIO(content))
        return df
    except Exception as e:
        raise Exception(f"下载数据集失败: {str(e)}")

def preprocess_data(df, feature_columns, target_column=None, task_type='classification'):
    """数据预处理"""
    # 选择特征列
    X = df[feature_columns].copy()
    
    # 处理缺失值
    X = X.fillna(X.mean() if X.select_dtypes(include=[np.number]).shape[1] > 0 else 0)
    
    # 编码分类变量
    for col in X.select_dtypes(include=['object']).columns:
        le = LabelEncoder()
        X[col] = le.fit_transform(X[col].astype(str))
    
    # 标准化
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # 处理目标变量
    y = None
    if target_column and task_type != 'clustering':
        y = df[target_column].copy()
        if task_type == 'classification':
            # 编码分类标签
            if y.dtype == 'object':
                le = LabelEncoder()
                y = le.fit_transform(y)
    
    return X_scaled, y

def train_classification_model(X, y, model_name, hyperparameters):
    """训练分类模型"""
    # 数据分割
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # 创建并训练模型
    model_class = MODEL_FACTORY.get(model_name, RandomForestClassifier)
    model = model_class(**hyperparameters)
    model.fit(X_train, y_train)
    
    # 预测
    y_pred = model.predict(X_test)
    y_pred_proba = None
    if hasattr(model, 'predict_proba'):
        y_pred_proba = model.predict_proba(X_test)
    
    # 计算指标
    metrics = {
        'accuracy': float(accuracy_score(y_test, y_pred)),
        'precision': float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
        'recall': float(recall_score(y_test, y_pred, average='weighted', zero_division=0)),
        'f1_score': float(f1_score(y_test, y_pred, average='weighted', zero_division=0)),
        'confusion_matrix': confusion_matrix(y_test, y_pred).tolist(),
        'classification_report': classification_report(y_test, y_pred, output_dict=True)
    }
    
    # 特征重要性（如果模型支持）
    feature_importance = None
    if hasattr(model, 'feature_importances_'):
        feature_importance = model.feature_importances_.tolist()
    elif hasattr(model, 'coef_'):
        feature_importance = np.abs(model.coef_[0]).tolist() if len(model.coef_.shape) > 1 else np.abs(model.coef_).tolist()
    
    # 可视化数据
    visualization_data = {
        'confusion_matrix': metrics['confusion_matrix'],
        'feature_importance': feature_importance,
        'test_indices': list(range(len(y_test))),
        'y_true': y_test.tolist(),
        'y_pred': y_pred.tolist()
    }
    
    # 如果有概率预测，添加ROC曲线数据
    if y_pred_proba is not None and len(np.unique(y)) == 2:
        from sklearn.metrics import roc_curve, auc
        fpr, tpr, _ = roc_curve(y_test, y_pred_proba[:, 1])
        visualization_data['roc_curve'] = {
            'fpr': fpr.tolist(),
            'tpr': tpr.tolist(),
            'auc': float(auc(fpr, tpr))
        }
    
    return metrics, visualization_data

def train_regression_model(X, y, model_name, hyperparameters):
    """训练回归模型"""
    # 数据分割
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # 创建并训练模型
    model_class = MODEL_FACTORY.get(model_name, RandomForestRegressor)
    model = model_class(**hyperparameters)
    model.fit(X_train, y_train)
    
    # 预测
    y_pred = model.predict(X_test)
    
    # 计算指标
    metrics = {
        'mse': float(mean_squared_error(y_test, y_pred)),
        'rmse': float(np.sqrt(mean_squared_error(y_test, y_pred))),
        'mae': float(mean_absolute_error(y_test, y_pred)),
        'r2_score': float(r2_score(y_test, y_pred))
    }
    
    # 特征重要性
    feature_importance = None
    if hasattr(model, 'feature_importances_'):
        feature_importance = model.feature_importances_.tolist()
    elif hasattr(model, 'coef_'):
        feature_importance = np.abs(model.coef_).tolist()
    
    # 可视化数据
    visualization_data = {
        'scatter_plot': {
            'y_true': y_test.tolist(),
            'y_pred': y_pred.tolist()
        },
        'residuals': (y_test - y_pred).tolist(),
        'feature_importance': feature_importance
    }
    
    return metrics, visualization_data

def train_clustering_model(X, model_name, hyperparameters):
    """训练聚类模型"""
    # 创建并训练模型
    model_class = MODEL_FACTORY.get(model_name, KMeans)
    model = model_class(**hyperparameters)
    
    # 聚类
    labels = model.fit_predict(X)
    
    # 计算指标
    metrics = {}
    if len(np.unique(labels)) > 1:
        metrics['silhouette_score'] = float(silhouette_score(X, labels))
        metrics['davies_bouldin_score'] = float(davies_bouldin_score(X, labels))
        metrics['calinski_harabasz_score'] = float(calinski_harabasz_score(X, labels))
    
    metrics['n_clusters'] = len(np.unique(labels))
    
    # 降维可视化
    visualization_data = {}
    
    # PCA降维
    if X.shape[1] > 2:
        pca = PCA(n_components=2)
        X_pca = pca.fit_transform(X)
        visualization_data['pca'] = {
            'x': X_pca[:, 0].tolist(),
            'y': X_pca[:, 1].tolist(),
            'labels': labels.tolist(),
            'explained_variance': pca.explained_variance_ratio_.tolist()
        }
    
    # t-SNE降维（数据量较小时）
    if X.shape[0] <= 1000 and X.shape[1] > 2:
        tsne = TSNE(n_components=2, random_state=42)
        X_tsne = tsne.fit_transform(X)
        visualization_data['tsne'] = {
            'x': X_tsne[:, 0].tolist(),
            'y': X_tsne[:, 1].tolist(),
            'labels': labels.tolist()
        }
    
    # 聚类中心（如果模型支持）
    if hasattr(model, 'cluster_centers_'):
        if X.shape[1] > 2:
            # 降维后的聚类中心
            pca_centers = pca.transform(model.cluster_centers_)
            visualization_data['cluster_centers'] = {
                'x': pca_centers[:, 0].tolist(),
                'y': pca_centers[:, 1].tolist()
            }
    
    return metrics, visualization_data

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["POST", "OPTIONS"],
    ),
    max_instances=10,
    memory=options.MemoryOption.GB_1
)
def train_ml_model(req: https_fn.Request) -> https_fn.Response:
    """
    机器学习模型训练API
    
    请求格式:
    {
        "dataset_url": "gs://bucket/path/to/data.csv",
        "model_config": {
            "model_name": "RandomForestClassifier",
            "hyperparameters": {"n_estimators": 100, "max_depth": 10}
        },
        "task_type": "classification",  # classification, regression, clustering
        "feature_columns": ["col1", "col2", "col3"],
        "target_column": "target",  # 聚类任务时可为null
        "user_id": "user123"
    }
    """
    try:
        # 按需初始化Firestore客户端
        db = firestore.client()
        
        # 解析请求数据
        data = req.get_json()
        if not data:
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '请求数据为空'}),
                status=400,
                mimetype='application/json'
            )
        
        # 提取参数
        dataset_url = data.get('dataset_url')
        model_config = data.get('model_config', {})
        task_type = data.get('task_type', 'classification')
        feature_columns = data.get('feature_columns', [])
        target_column = data.get('target_column')
        user_id = data.get('user_id', 'anonymous')
        
        # 验证参数
        if not dataset_url:
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '缺少数据集URL'}),
                status=400,
                mimetype='application/json'
            )
        
        if not feature_columns:
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '缺少特征列'}),
                status=400,
                mimetype='application/json'
            )
        
        # 下载数据集
        df = download_dataset_from_storage(dataset_url)
        
        # 数据预处理
        X, y = preprocess_data(df, feature_columns, target_column, task_type)
        
        # 获取模型配置
        model_name = model_config.get('model_name', 'RandomForestClassifier')
        hyperparameters = model_config.get('hyperparameters', {})
        
        # 根据任务类型训练模型
        if task_type == 'classification':
            if y is None:
                return https_fn.Response(
                    json.dumps({'status': 'error', 'message': '分类任务需要目标列'}),
                    status=400,
                    mimetype='application/json'
                )
            metrics, visualization_data = train_classification_model(X, y, model_name, hyperparameters)
        elif task_type == 'regression':
            if y is None:
                return https_fn.Response(
                    json.dumps({'status': 'error', 'message': '回归任务需要目标列'}),
                    status=400,
                    mimetype='application/json'
                )
            metrics, visualization_data = train_regression_model(X, y, model_name, hyperparameters)
        elif task_type == 'clustering':
            metrics, visualization_data = train_clustering_model(X, model_name, hyperparameters)
        else:
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': f'不支持的任务类型: {task_type}'}),
                status=400,
                mimetype='application/json'
            )
        
        # 保存实验记录到Firestore
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
        
        # 写入Firestore
        experiment_ref = db.collection('experiments').add(experiment_record)
        
        # 构造响应
        response = {
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
            'experiment_id': experiment_ref[1].id if experiment_ref else None
        }
        
        return https_fn.Response(
            json.dumps(response),
            status=200,
            mimetype='application/json'
        )
        
    except Exception as e:
        # 错误处理
        error_msg = f"训练模型时发生错误: {str(e)}"
        print(f"Error: {error_msg}")
        print(traceback.format_exc())
        
        return https_fn.Response(
            json.dumps({
                'status': 'error',
                'message': error_msg,
                'details': traceback.format_exc()
            }),
            status=500,
            mimetype='application/json'
        )

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["GET", "OPTIONS"],
    )
)
def get_experiment_history(req: https_fn.Request) -> https_fn.Response:
    """获取用户的实验历史记录"""
    try:
        # 按需初始化Firestore客户端
        db = firestore.client()
        
        user_id = req.args.get('user_id', 'anonymous')
        limit = int(req.args.get('limit', 10))
        
        # 查询Firestore
        experiments_ref = db.collection('experiments')
        query = experiments_ref.where('user_id', '==', user_id).order_by('timestamp', direction=firestore.Query.DESCENDING).limit(limit)
        
        experiments = []
        for doc in query.stream():
            experiment = doc.to_dict()
            experiment['id'] = doc.id
            # 转换时间戳
            if 'timestamp' in experiment and experiment['timestamp']:
                experiment['timestamp'] = experiment['timestamp'].isoformat()
            experiments.append(experiment)
        
        return https_fn.Response(
            json.dumps({
                'status': 'success',
                'experiments': experiments
            }),
            status=200,
            mimetype='application/json'
        )
        
    except Exception as e:
        return https_fn.Response(
            json.dumps({
                'status': 'error',
                'message': str(e)
            }),
            status=500,
            mimetype='application/json'
        )

# 定义 Secret 参数
GOOGLE_API_KEY = params.SecretParam("GOOGLE_API_KEY")

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["POST", "OPTIONS"],
    ),
    max_instances=10,
    memory=options.MemoryOption.GB_1,
    timeout_sec=120,  # 增加超时到 120 秒
    secrets=[GOOGLE_API_KEY]
)
def mcp_chat_assistant(req: https_fn.Request) -> https_fn.Response:
    """
    MCP 聊天助手 API
    前端通过此函数调用 MCP Server 功能
    
    请求格式:
    {
        "tool": "explain_algorithm",  # 工具名称
        "arguments": {                 # 工具参数
            "algorithm_name": "quick_sort",
            "category": "sorting",
            "detail_level": "basic"
        }
    }
    """
    # 记录请求开始时间
    request_start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    
    try:
        # 记录请求信息（不记录敏感数据）
        print(f"[{request_id}] MCP请求开始 - Method: {req.method}, Path: {req.path}")
        
        # 解析请求数据
        try:
            data = req.get_json()
        except Exception as e:
            print(f"[{request_id}] JSON解析失败: {str(e)}")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '请求数据格式错误'}),
                status=400,
                mimetype='application/json'
            )
        
        if not data:
            print(f"[{request_id}] 请求数据为空")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '请求数据为空'}),
                status=400,
                mimetype='application/json'
            )
        
        tool = data.get('tool')
        arguments = data.get('arguments', {})
        
        # 参数验证
        if not tool:
            print(f"[{request_id}] 缺少工具名称")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '缺少工具名称'}),
                status=400,
                mimetype='application/json'
            )
        
        if not isinstance(tool, str):
            print(f"[{request_id}] 工具名称类型错误: {type(tool)}")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '工具名称必须是字符串'}),
                status=400,
                mimetype='application/json'
            )
        
        if not isinstance(arguments, dict):
            print(f"[{request_id}] 参数类型错误: {type(arguments)}")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '参数必须是对象'}),
                status=400,
                mimetype='application/json'
            )
        
        # 验证工具名称是否合法
        valid_tools = [
            'explain_algorithm', 'generate_visualization_code', 'analyze_ml_results',
            'suggest_hyperparameters', 'compare_algorithms', 'debug_visualization',
            'explain_concept', 'generate_practice', 'get_study_plan',
            'review_mistakes', 'chat'
        ]
        if tool not in valid_tools:
            print(f"[{request_id}] 无效的工具名称: {tool}")
            return https_fn.Response(
                json.dumps({
                    'status': 'error', 
                    'message': f'未知的工具: {tool}',
                    'valid_tools': valid_tools
                }),
                status=400,
                mimetype='application/json'
            )
        
        print(f"[{request_id}] 调用工具: {tool}, 参数数量: {len(arguments)}")
        
        # 导入 requests (使用 REST API)
        import requests
        
        # 从 Secret 获取 API Key (去除可能的换行符)
        api_key = GOOGLE_API_KEY.value.strip() if GOOGLE_API_KEY.value else None
        if not api_key:
            print(f"[{request_id}] API Key 未配置")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '服务配置错误'}),
                status=500,
                mimetype='application/json'
            )
        
        # 选择模型 (使用最新的稳定版本)
        model_name = os.getenv("AI_MODEL", "gemini-2.5-flash")
        
        # 根据工具类型构造提示词
        prompt = _build_prompt_for_tool(tool, arguments)
        
        # 使用 REST API 调用 Gemini
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "maxOutputTokens": 2048,  # 限制输出长度以加快响应
                "temperature": 0.7
            }
        }
        
        # 增加超时到 60 秒,避免详细回答时超时
        response = requests.post(url, json=payload, timeout=60)
        response.raise_for_status()
        
        try:
            data = response.json()
        except ValueError as e:
            print(f"[{request_id}] API 响应JSON解析失败: {str(e)}")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': 'AI 响应格式错误'}),
                status=500,
                mimetype='application/json'
            )
        
        # 检查是否有候选结果
        if 'candidates' not in data or not data['candidates']:
            print(f"[{request_id}] 无候选结果，可能触发内容过滤")
            # 检查是否有 promptFeedback
            if 'promptFeedback' in data:
                feedback = data['promptFeedback']
                if 'blockReason' in feedback:
                    print(f"[{request_id}] 内容被阻止: {feedback['blockReason']}")
                    return https_fn.Response(
                        json.dumps({'status': 'error', 'message': '您的请求包含不适当内容，请修改后重试'}),
                        status=400,
                        mimetype='application/json'
                    )
            
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': 'AI 未返回有效响应，请稍后重试'}),
                status=500,
                mimetype='application/json'
            )
        
        candidate = data['candidates'][0]
        
        # 检查完成原因
        finish_reason = candidate.get('finishReason', 'UNKNOWN')
        if finish_reason != 'STOP':
            print(f"[{request_id}] 响应未正常完成: {finish_reason}")
            
            # 根据不同的完成原因返回不同的错误信息
            error_messages = {
                'MAX_TOKENS': 'AI 回复过长，请尝试更简单的问题',
                'SAFETY': '回复内容触发了安全过滤，请修改问题',
                'RECITATION': '回复内容可能包含版权材料',
                'OTHER': '回复生成异常，请重试'
            }
            error_msg = error_messages.get(finish_reason, f'响应未正常完成: {finish_reason}')
            
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': error_msg}),
                status=500,
                mimetype='application/json'
            )
        
        # 提取文本
        try:
            result = candidate['content']['parts'][0]['text']
            print(f"[{request_id}] 成功生成回复，长度: {len(result)} 字符")
        except (KeyError, IndexError) as e:
            print(f"[{request_id}] 响应格式异常: {str(e)}")
            print(f"[{request_id}] 原始响应: {json.dumps(data)}")
            return https_fn.Response(
                json.dumps({'status': 'error', 'message': '响应格式异常'}),
                status=500,
                mimetype='application/json'
            )
        
        # 计算总耗时
        total_duration = time.time() - request_start_time
        print(f"[{request_id}] 请求完成，总耗时: {total_duration:.2f}秒")
        
        return https_fn.Response(
            json.dumps({
                'status': 'success',
                'result': result,
                'tool': tool
            }),
            status=200,
            mimetype='application/json'
        )
        
    except Exception as e:
        # 计算错误发生时的耗时
        error_duration = time.time() - request_start_time
        error_msg = str(e)
        
        print(f"[{request_id}] 发生错误 (耗时: {error_duration:.2f}秒): {error_msg}")
        print(f"[{request_id}] 错误堆栈:\n{traceback.format_exc()}")
        
        # 不向客户端暴露详细的内部错误信息
        user_message = '服务器内部错误，请稍后重试'
        
        # 根据错误类型提供更友好的消息
        if 'timeout' in error_msg.lower():
            user_message = '请求超时，请稍后重试'
        elif 'connection' in error_msg.lower():
            user_message = '网络连接失败，请检查网络设置'
        elif 'json' in error_msg.lower():
            user_message = '数据格式错误'
        
        return https_fn.Response(
            json.dumps({
                'status': 'error',
                'message': user_message
            }),
            status=500,
            mimetype='application/json'
        )

def _build_prompt_for_tool(tool: str, arguments: dict) -> str:
    """为不同工具构建提示词"""
    
    if tool == 'explain_algorithm':
        algorithm_name = arguments.get('algorithm_name', '')
        category = arguments.get('category', '')
        detail_level = arguments.get('detail_level', 'basic')
        
        return f"""请简明解释算法"{algorithm_name}"({category}类):
1. 基本原理(2-3句)
2. 时间/空间复杂度
3. 适用场景
4. 优缺点(各2点)

要求:简洁易懂,总字数300-500字。"""
    
    elif tool == 'generate_visualization_code':
        algorithm_type = arguments.get('algorithm_type', '')
        framework = arguments.get('framework', 'flutter')
        animation_style = arguments.get('animation_style', 'smooth')
        
        return f"""为 {algorithm_type} 算法生成 {framework} 可视化代码。

要求:
1. 使用 CustomPaint 进行绘制
2. 动画风格: {animation_style}
3. 包含完整的动画控制器设置
4. 代码要清晰注释
5. 性能优化 (目标 60 FPS)

请生成完整的 Dart/Flutter 代码,包括:
- Widget 类定义
- CustomPainter 实现
- Animation Controller 设置
- 交互控制 (播放/暂停/速度调节)"""
    
    elif tool == 'analyze_ml_results':
        metrics = arguments.get('metrics', {})
        task_type = arguments.get('task_type', '')
        model_type = arguments.get('model_type', 'unknown')
        
        return f"""分析以下机器学习实验结果:

任务类型: {task_type}
模型类型: {model_type}

评估指标:
{json.dumps(metrics, indent=2, ensure_ascii=False)}

请提供:
1. 模型性能评估 (性能好坏判断)
2. 可能存在的问题 (过拟合/欠拟合/数据不平衡等)
3. 具体优化建议 (超参数调整、特征工程、模型选择)
4. 下一步实验方向

请以考研学生能理解的方式解释。"""
    
    elif tool == 'suggest_hyperparameters':
        model_name = arguments.get('model_name', '')
        task_type = arguments.get('task_type', '')
        dataset_info = arguments.get('dataset_info', {})
        
        return f"""为以下场景建议机器学习模型超参数:

模型: {model_name}
任务类型: {task_type}
数据集信息: {json.dumps(dataset_info, indent=2, ensure_ascii=False)}

请提供:
1. 推荐的超参数配置 (初始值)
2. 每个超参数的作用解释
3. 参数调优的建议范围
4. 调优策略 (网格搜索/随机搜索/贝叶斯优化)"""
    
    elif tool == 'compare_algorithms':
        algorithms = arguments.get('algorithms', [])
        category = arguments.get('category', '')
        criteria = arguments.get('comparison_criteria', ['complexity', 'use_cases'])
        
        return f"""比较以下 {category} 类别的算法:

算法列表: {', '.join(algorithms)}
比较维度: {', '.join(criteria)}

请提供:
1. 详细的对比表格
2. 各算法的适用场景分析
3. 性能对比 (时间/空间复杂度)
4. 选择建议 (什么情况下用哪个)"""
    
    elif tool == 'debug_visualization':
        error_message = arguments.get('error_message', '')
        code_snippet = arguments.get('code_snippet', '')
        context = arguments.get('context', '')
        
        return f"""帮助调试 Flutter 可视化代码问题:

错误信息:
{error_message}

相关代码:
```dart
{code_snippet}
```

问题上下文:
{context}

请提供:
1. 错误原因分析
2. 具体修复方案
3. 修改后的代码
4. 预防类似问题的建议"""
    
    elif tool == 'explain_concept':
        concept = arguments.get('concept', '')
        subject = arguments.get('subject', '')
        detail_level = arguments.get('detail_level', 'basic')
        
        return f"""请简明解释概念"{concept}"({subject}科目):
1. 定义(2-3句话)
2. 核心特点(3-4点)
3. 与相关概念的区别(简述)
4. 408考点提示

要求:简洁清晰,总字数300-500字。"""
    
    elif tool == 'generate_practice':
        topic = arguments.get('topic', '')
        difficulty = arguments.get('difficulty', 'medium')
        count = arguments.get('count', 5)
        
        return f"""生成{count}道关于"{topic}"的{difficulty}难度练习题:

格式要求:
题X. [题目]
选项: A/B/C/D
答案: [答案]
解析: [简要解析1-2句]

要求:简洁,总字数500字内。"""
    
    elif tool == 'get_study_plan':
        subject = arguments.get('subject', '')
        duration_weeks = arguments.get('duration_weeks', 12)
        current_level = arguments.get('current_level', 'beginner')
        focus_areas = arguments.get('focus_areas', [])
        
        return f"""为{subject}制定{duration_weeks}周学习计划(水平:{current_level}):

按周列出:
第1-X周: [核心知识点] [每周时间分配]

要求:简洁实用,总字数400-600字。"""
    
    elif tool == 'review_mistakes':
        mistakes = arguments.get('mistakes', [])
        topic = arguments.get('topic', '')
        
        mistakes_text = "\n".join([f"- {m}" for m in mistakes]) if mistakes else "暂无错题记录"
        
        return f"""请帮助分析以下错题:

主题: {topic}

错题列表:
{mistakes_text}

请提供:
1. 错题涉及的知识点分析
2. 常见错误原因
3. 正确的解题思路
4. 相关知识点的复习建议
5. 类似题型的练习建议

帮助学生从错误中学习,避免重复犯错。"""
    
    elif tool == 'chat':
        message = arguments.get('message', '')
        history = arguments.get('history', [])
        
        context = "你是一个专业的408考研学习助手,精通数据结构、算法、操作系统、计算机网络、计算机组成原理等科目,也熟悉机器学习基础。\n\n"
        
        if history:
            context += "对话历史:\n"
            for msg in history[-5:]:  # 只保留最近5条
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                context += f"{role}: {content}\n"
            context += "\n"
        
        return context + f"用户问题: {message}\n\n请用中文详细回答,适合考研学生理解。"
    
    else:
        return f"抱歉,暂不支持工具: {tool}。可用工具包括: explain_algorithm, generate_visualization_code, analyze_ml_results, suggest_hyperparameters, compare_algorithms, debug_visualization, explain_concept, generate_practice, get_study_plan, review_mistakes, chat"
