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
    task_type: str = 'classification',
    missing_strategy: str = 'mean'  # mean, median, constant, drop
) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    """
    对数据进行预处理
    
    Args:
        df: 输入的 DataFrame
        feature_columns: 特征列名列表
        target_column: 目标列名 (可选)
        task_type: 任务类型 ('classification', 'regression', 'clustering')
        missing_strategy: 缺失值处理策略
        
    Returns:
        (X_scaled, y): 处理后的特征矩阵和目标向量
    """
    # 延迟导入 sklearn 组件
    from sklearn.compose import ColumnTransformer
    from sklearn.preprocessing import StandardScaler, OneHotEncoder, OrdinalEncoder
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    
    # 验证特征列是否存在
    missing_cols = [col for col in feature_columns if col not in df.columns]
    if missing_cols:
        raise ValueError(f"数据集中缺少以下特征列: {missing_cols}")
        
    # 选择特征列
    # 0. 先处理全局行删除逻辑 (确保 X 和 y 对齐)
    cols_to_check = []
    
    # 目标列缺失必须删除 (非聚类)
    if target_column and target_column in df.columns and task_type != 'clustering':
        cols_to_check.append(target_column)
        
    # 如果策略是drop，检查特征列
    if missing_strategy == 'drop':
        cols_to_check.extend([c for c in feature_columns if c in df.columns])
        
    if cols_to_check:
        original_len = len(df)
        df = df.dropna(subset=cols_to_check)
        if len(df) < original_len:
            print(f"预处理: 丢弃了 {original_len - len(df)} 行包含缺失值的样本")

    if len(df) == 0:
         raise ValueError("数据预处理后样本量为0，请检查数据完整性或尝试其他缺失值处理策略")

    X = df[feature_columns].copy()
    
    # 区分数值列和分类列
    numeric_features = X.select_dtypes(include=[np.number]).columns.tolist()
    categorical_features = X.select_dtypes(include=['object', 'category', 'bool']).columns.tolist()
    
    # 1. 构建数值处理管道
    numeric_steps = []
    # 缺失值填充
    if missing_strategy == 'drop':
        # drop 在这里不好处理，因为要保持X行数，这就需要在最开始dropna
        # 这里对于drop策略，如果不是 dropna，暂退化为 mean
        numeric_steps.append(('imputer', SimpleImputer(strategy='mean')))
    elif missing_strategy in ['mean', 'median']:
        numeric_steps.append(('imputer', SimpleImputer(strategy=missing_strategy)))
    else:
        # constant fill with 0
        numeric_steps.append(('imputer', SimpleImputer(strategy='constant', fill_value=0)))
    
    # 标准化
    numeric_steps.append(('scaler', StandardScaler()))
    numeric_transformer = Pipeline(steps=numeric_steps)
    
    # 2. 构建分类处理管道
    categorical_transformer = Pipeline(steps=[
        ('imputer', SimpleImputer(strategy='constant', fill_value='missing')),
        # OneHot 对于高基数特征会导致维度爆炸，这里做一个简单判断
        # 如果唯一值数量 > 10，使用 OrdinalEncoder (Label Encoding)
        # 否则使用 OneHot
        ('encoder', OneHotOrOrdinalEncoder()) 
    ])
    
    # 组合预处理器
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', numeric_transformer, numeric_features),
            ('cat', categorical_transformer, categorical_features)
        ],
        remainder='drop' # 丢弃未列出的列（虽然上面已经只选了feature_columns）
    )
    
    try:
        X_scaled = preprocessor.fit_transform(X)
        # 如果是稀疏矩阵，转换为密集矩阵 (有些模型不支持稀疏)
        if hasattr(X_scaled, 'toarray'):
            X_scaled = X_scaled.toarray()
    except Exception as e:
        raise ValueError(f"特征预处理失败: {str(e)}")

    # 4. 处理目标变量
    y = None
    if target_column:
        if target_column not in df.columns:
             if task_type != 'clustering':
                 raise ValueError(f"数据集中缺少目标列: {target_column}")
        else:
            y = df[target_column].copy()
            
            # 如果是 drop 策略，需要先对齐 X 和 y 的 dropna
            # (由于上面是在 Pipeline 内部处理，这里实际上无法直接对齐 drop)
            # 这里的简化逻辑是：如果 missing_strategy 是 drop，应该在函数入口就 dropna
            
            if task_type == 'classification':
                # 确保 y 是整数类型
                from sklearn.preprocessing import LabelEncoder
                le = LabelEncoder()
                y = le.fit_transform(y.astype(str))
            elif task_type == 'regression':
                # 确保 y 是数值类型
                if y.dtype == 'object':
                     # 尝试转换，无法转换的转为NaN然后填充0 (虽然上面已经dropna，但转换可能产生新的NaN)
                     y = pd.to_numeric(y, errors='coerce').fillna(0)
                y = y.values.astype(float)
                
    return X_scaled, y

class OneHotOrOrdinalEncoder:
    """
    智能编码器：
    低基数 (<10) -> OneHot
    高基数 (>=10) -> Ordinal
    """
    def __init__(self, threshold=10):
        self.threshold = threshold
        self.transformers = {} # col_idx -> transformer
        self.feature_names_out = None
        
    def fit(self, X, y=None):
        if hasattr(X, 'iloc'):
            X = X.values
        
        n_features = X.shape[1]
        self.transformers = {}
        
        from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder
        
        for i in range(n_features):
            unique_count = len(np.unique(X[:, i].astype(str)))
            if unique_count < self.threshold:
                enc = OneHotEncoder(sparse_output=False, handle_unknown='ignore')
            else:
                enc = OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=-1)
            
            enc.fit(X[:, i:i+1])
            self.transformers[i] = enc
            
        return self

    def transform(self, X):
        if hasattr(X, 'iloc'):
            X = X.values
            
        output_arrays = []
        for i in range(X.shape[1]):
            enc = self.transformers[i]
            col_transformed = enc.transform(X[:, i:i+1])
            output_arrays.append(col_transformed)
            
        return np.hstack(output_arrays)
    
    def fit_transform(self, X, y=None):
        return self.fit(X, y).transform(X)
