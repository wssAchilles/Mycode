"""
模型训练模块
负责执行分类、回归和聚类任务的训练流程，支持自动模型选择和集成学习
"""

from typing import Dict, Any, Tuple, List, Optional
import numpy as np
import pandas as pd
from .models import ModelFactory

# 定义支持自动优选的候选模型
CANDIDATE_MODELS_REGRESSION = ['RandomForestRegressor', 'LGBMRegressor', 'XGBRegressor']
CANDIDATE_MODELS_CLASSIFICATION = ['RandomForestClassifier', 'LGBMClassifier', 'XGBClassifier']

def train_classification_model(
    X: np.ndarray, 
    y: np.ndarray, 
    model_name: str, 
    hyperparameters: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """训练分类模型 (支持自动模型选择)"""
    
    # 延迟导入 sklearn 组件
    from sklearn.model_selection import train_test_split, cross_val_score
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        confusion_matrix, classification_report,
        roc_curve, auc
    )
    from sklearn.ensemble import VotingClassifier
    
    # 结果容器
    model_selection_report = {}
    best_model = None
    best_score = -1
    
    # 2. 数据分割
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # 3. 确定要训练的模型列表
    models_to_train = []
    if model_name == 'AutoSelection':
        models_to_train = CANDIDATE_MODELS_CLASSIFICATION
    else:
        models_to_train = [model_name]
        
    trained_estimators = []

    # 4. 遍历训练
    for name in models_to_train:
        try:
            model = ModelFactory.create_model(name, hyperparameters)
            model.fit(X_train, y_train)
            
            # 使用验证集评分 (这里简单用测试集作为选择标准，生产环境应再划分类验证集)
            # 或者使用 Cross Validation
            cv_scores = cross_val_score(model, X_train, y_train, cv=3, scoring='accuracy')
            avg_cv_score = float(np.mean(cv_scores))
            
            model_selection_report[name] = {
                'cv_score': avg_cv_score,
                'status': 'success'
            }
            
            trained_estimators.append((name, model))
            
            if avg_cv_score > best_score:
                best_score = avg_cv_score
                best_model = model
                
        except Exception as e:
            model_selection_report[name] = {'status': 'failed', 'error': str(e)}
            print(f"训练 {name} 失败: {e}")

    # 5. 集成学习 (如果 AutoSelection 且有多个模型成功)
    if model_name == 'AutoSelection' and len(trained_estimators) > 1:
        try:
            voting_clf = VotingClassifier(estimators=trained_estimators, voting='soft')
            voting_clf.fit(X_train, y_train)
            
            cv_scores = cross_val_score(voting_clf, X_train, y_train, cv=3, scoring='accuracy')
            avg_cv_score = float(np.mean(cv_scores))
             
            model_selection_report['VotingEnsemble'] = {
                'cv_score': avg_cv_score,
                'status': 'success'
            }
            
            if avg_cv_score > best_score:
                best_score = avg_cv_score
                best_model = voting_clf
                print("Voting Ensemble 胜出")
                
        except Exception as e:
            model_selection_report['VotingEnsemble'] = {'status': 'failed', 'error': str(e)}

    if best_model is None:
        raise RuntimeError("没有模型训练成功")

    # 6. 最终评估 (使用最佳模型)
    model = best_model
    y_pred = model.predict(X_test)
    y_pred_proba = None
    if hasattr(model, 'predict_proba'):
        try:
            y_pred_proba = model.predict_proba(X_test)
        except:
             pass
    
    # 7. 计算指标
    try:
        metrics = {
            'accuracy': float(accuracy_score(y_test, y_pred)),
            'precision': float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            'recall': float(recall_score(y_test, y_pred, average='weighted', zero_division=0)),
            'f1_score': float(f1_score(y_test, y_pred, average='weighted', zero_division=0)),
            'confusion_matrix': confusion_matrix(y_test, y_pred).tolist(),
            'classification_report': classification_report(y_test, y_pred, output_dict=True, zero_division=0),
            'model_selection_report': model_selection_report
        }
    except Exception as e:
         raise RuntimeError(f"指标计算失败: {str(e)}")

    # 8. 特征重要性
    feature_importance = _get_feature_importance(model)
    
    # 9. 构造可视化数据
    visualization_data = {
        'confusion_matrix': metrics['confusion_matrix'],
        'feature_importance': feature_importance,
        'model_selection_report': model_selection_report,
        # 下采样避免前端渲染卡顿, 这里暂只返回索引
        'test_indices': list(range(len(y_test)))[:200], # 只返回前200个点用于示意
        'y_true': y_test.tolist()[:200],
        'y_pred': y_pred.tolist()[:200]
    }
    
    # 10. ROC 曲线 (下采样)
    if y_pred_proba is not None and len(np.unique(y)) == 2:
        try:
            fpr, tpr, _ = roc_curve(y_test, y_pred_proba[:, 1])
            # 下采样 ROC 点 (保留最多 100 个点)
            if len(fpr) > 100:
                indices = np.linspace(0, len(fpr) - 1, 100).astype(int)
                fpr = fpr[indices]
                tpr = tpr[indices]
                
            visualization_data['roc_curve'] = {
                'fpr': fpr.tolist(),
                'tpr': tpr.tolist(),
                'auc': float(auc(fpr, tpr))
            }
        except Exception:
            pass
            
    return metrics, visualization_data

def train_regression_model(
    X: np.ndarray, 
    y: np.ndarray, 
    model_name: str, 
    hyperparameters: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """训练回归模型 (支持自动模型选择和时间序列验证)"""
    
    # 延迟导入
    from sklearn.model_selection import train_test_split, TimeSeriesSplit, cross_val_score
    from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
    from sklearn.ensemble import VotingRegressor
    
    model_selection_report = {}
    best_model = None
    best_score = float('inf') # MAE 越小越好
    
    # 使用 TimeSeriesSplit (默认 5 折)
    # 对于时序数据，不能随机 split。这里简单起见，如果数据量够大，我们按时间顺序划分 Train/Test
    # 假设数据已经是按时间排序的 (通常是)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    # 时序交叉验证器
    tscv = TimeSeriesSplit(n_splits=3)
    
    # 3. 确定模型列表
    models_to_train = []
    if model_name == 'AutoSelection':
        models_to_train = CANDIDATE_MODELS_REGRESSION
    else:
        models_to_train = [model_name]
        
    trained_estimators = []

    # 4. 遍历训练
    for name in models_to_train:
        try:
            model = ModelFactory.create_model(name, hyperparameters)
            
            # 使用 TSCV 获取 MAE (neg_mean_absolute_error 返回负数，取负变正)
            cv_scores = cross_val_score(model, X_train, y_train, cv=tscv, scoring='neg_mean_absolute_error')
            avg_mae = -np.mean(cv_scores)
            
            # 全量训练
            model.fit(X_train, y_train)
            
            model_selection_report[name] = {
                'cv_mae': float(avg_mae),
                'status': 'success'
            }
            
            trained_estimators.append((name, model))
            
            if avg_mae < best_score:
                best_score = avg_mae
                best_model = model
                
        except Exception as e:
            model_selection_report[name] = {'status': 'failed', 'error': str(e)}

    # 5. 集成学习
    if model_name == 'AutoSelection' and len(trained_estimators) > 1:
        try:
            voting_reg = VotingRegressor(estimators=trained_estimators)
            
            cv_scores = cross_val_score(voting_reg, X_train, y_train, cv=tscv, scoring='neg_mean_absolute_error')
            avg_mae = -np.mean(cv_scores)
            
            voting_reg.fit(X_train, y_train)
             
            model_selection_report['VotingEnsemble'] = {
                'cv_mae': float(avg_mae),
                'status': 'success'
            }
            
            if avg_mae < best_score:
                best_score = avg_mae
                best_model = voting_reg
                
        except Exception as e:
            model_selection_report['VotingEnsemble'] = {'status': 'failed', 'error': str(e)}

    if best_model is None:
        raise RuntimeError("没有模型训练成功")
        
    # 6. 最终评估
    model = best_model
    y_pred = model.predict(X_test)
    
    try:
        metrics = {
            'mse': float(mean_squared_error(y_test, y_pred)),
            'rmse': float(np.sqrt(mean_squared_error(y_test, y_pred))),
            'mae': float(mean_absolute_error(y_test, y_pred)),
            'r2_score': float(r2_score(y_test, y_pred)),
            'model_selection_report': model_selection_report
        }
    except Exception as e:
         raise RuntimeError(f"指标计算失败: {str(e)}")
    
    feature_importance = _get_feature_importance(model)
    
    # 计算相关性矩阵 (仅取前 10 个特征 + 目标)
    # 构造简单 DataFrame 用于计算
    # 注意 X_test 已经是 numpy array
    correlation_matrix = []
    try:
        df_corr = pd.DataFrame(X_test[:, :10])
        df_corr['target'] = y_test
        corr = df_corr.corr()
        correlation_matrix = corr.values.tolist()
    except:
        pass

    visualization_data = {
        'scatter_plot': {
            # 同样下采样，避免数据量过大
            'y_true': y_test.tolist()[:200],
            'y_pred': y_pred.tolist()[:200]
        },
        'residuals': (y_test - y_pred).tolist()[:200],
        'feature_importance': feature_importance,
        'model_selection_report': model_selection_report,
        'correlation_matrix': correlation_matrix
    }
    
    return metrics, visualization_data

def train_clustering_model(
    X: np.ndarray, 
    model_name: str, 
    hyperparameters: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """训练聚类模型 (保持原有逻辑，稍作优化)"""
    # ... (保持大部分逻辑不变，只是确保代码风格统一) ...
    # 为节省空间，此处复用原逻辑，但确保异常处理健壮
    
    from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score
    from sklearn.decomposition import PCA
    
    model = ModelFactory.create_model(model_name, hyperparameters)
    
    try:
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
    
    if n_unique_labels > 1:
        try:
            # 采样计算指标，如果数据量太大
            if len(X) > 5000:
                indices = np.random.choice(len(X), 5000, replace=False)
                X_sample = X[indices]
                labels_sample = labels[indices]
            else:
                X_sample = X
                labels_sample = labels

            metrics['silhouette_score'] = float(silhouette_score(X_sample, labels_sample))
            metrics['davies_bouldin_score'] = float(davies_bouldin_score(X_sample, labels_sample))
            metrics['calinski_harabasz_score'] = float(calinski_harabasz_score(X_sample, labels_sample))
        except Exception:
             pass
    
    visualization_data = {}
    
    # 降维可视化 (PCA) - 下采样
    if X.shape[1] > 2:
        try:
            # 同样下采样以加快 PCA 和传输
            plot_indices = list(range(len(X)))
            if len(X) > 500:
                plot_indices = np.linspace(0, len(X) - 1, 500).astype(int)
                X_plot = X[plot_indices]
                labels_plot = labels[plot_indices]
            else:
                X_plot = X
                labels_plot = labels

            pca = PCA(n_components=2)
            X_pca = pca.fit_transform(X_plot)
            visualization_data['pca'] = {
                'x': X_pca[:, 0].tolist(),
                'y': X_pca[:, 1].tolist(),
                'labels': labels_plot.tolist(),
                'explained_variance': pca.explained_variance_ratio_.tolist()
            }
        except Exception:
            pass
            
    return metrics, visualization_data

def _get_feature_importance(model) -> Optional[List[float]]:
    """提取特征重要性 (兼容集成模型)"""
    try:
        # 1. 树模型 / 集成模型
        if hasattr(model, 'feature_importances_'):
            return model.feature_importances_.tolist()
            
        # 2. 线性模型
        if hasattr(model, 'coef_'):
            coef = model.coef_
            if len(coef.shape) > 1:
                return np.mean(np.abs(coef), axis=0).tolist()
            else:
                return np.abs(coef).tolist()
                
        # 3. Voting Ensemble (取平均)
        if hasattr(model, 'estimators_'):
            importances = []
            for estimator in model.estimators_:
                imp = _get_feature_importance(estimator)
                if imp:
                    importances.append(imp)
            if importances:
                return np.mean(importances, axis=0).tolist()
                
    except:
        pass
    return None
