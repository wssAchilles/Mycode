"""
机器学习模型实验平台 - Firebase Cloud Functions后端服务
"""

import json
import traceback
from firebase_functions import https_fn, options
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
