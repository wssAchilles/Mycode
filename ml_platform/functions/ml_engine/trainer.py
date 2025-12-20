"""
模型训练模块
负责执行分类、回归和聚类任务的训练流程
"""

from typing import Dict, Any, Tuple, List, Optional
import numpy as np

from .models import ModelFactory

def train_classification_model(
    X: np.ndarray, 
    y: np.ndarray, 
    model_name: str, 
    hyperparameters: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """训练分类模型"""
    
    # 延迟导入 sklearn 组件
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        confusion_matrix, classification_report,
        roc_curve, auc
    )
    
    # 1. 创建模型
    model = ModelFactory.create_model(model_name, hyperparameters)
    
    # 2. 数据分割
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # 3. 训练
    try:
        model.fit(X_train, y_train)
    except Exception as e:
        raise RuntimeError(f"模型训练失败: {str(e)}")
    
    # 4. 预测
    y_pred = model.predict(X_test)
    y_pred_proba = None
    if hasattr(model, 'predict_proba'):
        try:
            y_pred_proba = model.predict_proba(X_test)
        except:
            # 部分模型可能有该方法但调用失败（如SVM未开启probability）
            pass
    
    # 5. 计算指标
    # 注意：明确转换 numpy 类型为 float/int 以便 JSON 序列化
    try:
        metrics = {
            'accuracy': float(accuracy_score(y_test, y_pred)),
            'precision': float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            'recall': float(recall_score(y_test, y_pred, average='weighted', zero_division=0)),
            'f1_score': float(f1_score(y_test, y_pred, average='weighted', zero_division=0)),
            'confusion_matrix': confusion_matrix(y_test, y_pred).tolist(),
            # classification_report 返回 dict
            'classification_report': classification_report(y_test, y_pred, output_dict=True, zero_division=0) 
        }
    except Exception as e:
         raise RuntimeError(f"指标计算失败: {str(e)}")

    # 6. 特征重要性
    feature_importance = None
    if hasattr(model, 'feature_importances_'):
        feature_importance = model.feature_importances_.tolist()
    elif hasattr(model, 'coef_'):
        # 处理多分类与二分类的 coef_ 形状差异
        coef = model.coef_
        if len(coef.shape) > 1:
            feature_importance = np.mean(np.abs(coef), axis=0).tolist()
        else:
            feature_importance = np.abs(coef).tolist()
    
    # 7. 构造可视化数据
    visualization_data = {
        'confusion_matrix': metrics['confusion_matrix'],
        'feature_importance': feature_importance,
        'test_indices': list(range(len(y_test))),
        'y_true': y_test.tolist(),
        'y_pred': y_pred.tolist()
    }
    
    # 8. ROC 曲线 (仅二分类)
    if y_pred_proba is not None and len(np.unique(y)) == 2:
        try:
            fpr, tpr, _ = roc_curve(y_test, y_pred_proba[:, 1])
            visualization_data['roc_curve'] = {
                'fpr': fpr.tolist(),
                'tpr': tpr.tolist(),
                'auc': float(auc(fpr, tpr))
            }
        except Exception:
            # ROC 计算可能因数据问题失败，不应阻断主流程
            pass
            
    return metrics, visualization_data

def train_regression_model(
    X: np.ndarray, 
    y: np.ndarray, 
    model_name: str, 
    hyperparameters: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """训练回归模型"""
    
    # 延迟导入
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
    
    model = ModelFactory.create_model(model_name, hyperparameters)
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    try:
        model.fit(X_train, y_train)
    except Exception as e:
        raise RuntimeError(f"模型训练失败: {str(e)}")
    
    y_pred = model.predict(X_test)
    
    try:
        metrics = {
            'mse': float(mean_squared_error(y_test, y_pred)),
            'rmse': float(np.sqrt(mean_squared_error(y_test, y_pred))),
            'mae': float(mean_absolute_error(y_test, y_pred)),
            'r2_score': float(r2_score(y_test, y_pred))
        }
    except Exception as e:
         raise RuntimeError(f"指标计算失败: {str(e)}")
    
    feature_importance = None
    if hasattr(model, 'feature_importances_'):
        feature_importance = model.feature_importances_.tolist()
    elif hasattr(model, 'coef_'):
        feature_importance = np.abs(model.coef_).tolist()
    
    visualization_data = {
        'scatter_plot': {
            'y_true': y_test.tolist(),
            'y_pred': y_pred.tolist()
        },
        'residuals': (y_test - y_pred).tolist(),
        'feature_importance': feature_importance
    }
    
    return metrics, visualization_data

def train_clustering_model(
    X: np.ndarray, 
    model_name: str, 
    hyperparameters: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """训练聚类模型"""
    
    # 延迟导入
    from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score
    from sklearn.decomposition import PCA
    
    model = ModelFactory.create_model(model_name, hyperparameters)
    
    try:
        # 部分聚类算法只有 fit_predict，没有 predict
        if hasattr(model, 'fit_predict'):
            labels = model.fit_predict(X)
        else:
            model.fit(X)
            labels = model.labels_
    except Exception as e:
        raise RuntimeError(f"模型训练失败: {str(e)}")
    
    metrics = {}
    n_unique_labels = len(np.unique(labels))
    
    metrics['n_clusters'] = n_unique_labels
    
    # 仅当有多个簇时计算聚类指标
    if n_unique_labels > 1:
        # 聚类指标计算开销较大，数据量大时可能需要采样
        try:
            metrics['silhouette_score'] = float(silhouette_score(X, labels))
            metrics['davies_bouldin_score'] = float(davies_bouldin_score(X, labels))
            metrics['calinski_harabasz_score'] = float(calinski_harabasz_score(X, labels))
        except Exception:
             # 指标计算失败不应阻断
             pass
    
    visualization_data = {}
    
    # 降维可视化 (PCA)
    if X.shape[1] > 2:
        try:
            pca = PCA(n_components=2)
            X_pca = pca.fit_transform(X)
            visualization_data['pca'] = {
                'x': X_pca[:, 0].tolist(),
                'y': X_pca[:, 1].tolist(),
                'labels': labels.tolist(),
                'explained_variance': pca.explained_variance_ratio_.tolist()
            }
        except Exception:
            pass

    # 聚类中心
    if hasattr(model, 'cluster_centers_'):
        # 如果还没计算PCA（例如特征维度<=2），需要计算以便统一展示？
        # 这里简化逻辑：如果有PCA，则展示PCA后的中心；否则直接展示（假设2D）
        if 'pca' in visualization_data:
             # 需要重新初始化PCA或复用上面的PCA
             pca = PCA(n_components=2).fit(X) # 简单起见重新Fit
             pca_centers = pca.transform(model.cluster_centers_)
             visualization_data['cluster_centers'] = {
                'x': pca_centers[:, 0].tolist(),
                'y': pca_centers[:, 1].tolist()
            }
        elif X.shape[1] == 2:
            visualization_data['cluster_centers'] = {
                'x': model.cluster_centers_[:, 0].tolist(),
                'y': model.cluster_centers_[:, 1].tolist()
            }
            
    return metrics, visualization_data
