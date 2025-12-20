"""
数据预处理模块
负责数据的清洗、编码和标准化
"""

from typing import List, Tuple, Optional
import pandas as pd
import numpy as np

def preprocess_data(
    df: pd.DataFrame, 
    feature_columns: List[str], 
    target_column: Optional[str] = None, 
    task_type: str = 'classification'
) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    """
    对数据进行预处理
    
    Args:
        df: 输入的 DataFrame
        feature_columns: 特征列名列表
        target_column: 目标列名 (可选)
        task_type: 任务类型 ('classification', 'regression', 'clustering')
        
    Returns:
        (X_scaled, y): 处理后的特征矩阵和目标向量
    """
    # 延迟导入 sklearn 组件
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    # 验证特征列是否存在
    missing_cols = [col for col in feature_columns if col not in df.columns]
    if missing_cols:
        raise ValueError(f"数据集中缺少以下特征列: {missing_cols}")
        
    # 选择特征列
    X = df[feature_columns].copy()
    
    # 1. 处理缺失值
    # 数值列用均值填充，非数值列暂不处理（或者是空字符串）
    numeric_cols = X.select_dtypes(include=[np.number]).columns
    if not numeric_cols.empty:
        X[numeric_cols] = X[numeric_cols].fillna(X[numeric_cols].mean())
    X = X.fillna(0) # 其他类型缺失值填充为0 (兜底)
    
    # 2. 编码分类变量
    # 对所有 object 类型的列进行 LabelEncoding
    # 注意: 生产环境通常需要保存 Encoder 以便处理新数据，这里暂简化处理
    for col in X.select_dtypes(include=['object', 'category']).columns:
        le = LabelEncoder()
        # 转换为字符串以处理混合类型，并处理 NaN
        X[col] = le.fit_transform(X[col].astype(str))
    
    # 3. 标准化
    scaler = StandardScaler()
    try:
        X_scaled = scaler.fit_transform(X)
    except Exception as e:
        raise ValueError(f"数据标准化失败: {str(e)}")
    
    # 4. 处理目标变量
    y = None
    if target_column:
        if target_column not in df.columns:
             # 对于非聚类任务，如果没有目标列但指定了target_column，应当报错
             if task_type != 'clustering':
                 raise ValueError(f"数据集中缺少目标列: {target_column}")
        else:
            y = df[target_column].copy()
            
            # 如果是分类任务，且目标是字符串，则进行编码
            if task_type == 'classification':
                if y.dtype == 'object' or y.dtype.name == 'category':
                    le = LabelEncoder()
                    y = le.fit_transform(y.astype(str))
                
                # 确保 y 是整数类型
                if hasattr(y, 'values'):
                    y = y.values
                y = y.astype(int)
            elif task_type == 'regression':
                # 确保 y 是数值类型
                if hasattr(y, 'values'):
                    y = y.values
                y = y.astype(float)
                
    return X_scaled, y
