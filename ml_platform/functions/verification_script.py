"""
后端逻辑验证脚本
"""
import sys
import pandas as pd
import numpy as np
from ml_engine.models import ModelFactory
from ml_engine.preprocessing import preprocess_data
from ml_engine.trainer import train_classification_model

def test_preprocessing():
    print("Testing Preprocessing...")
    data = {
        'feature1': [1.0, 2.0, np.nan, 4.0],
        'feature2': ['A', 'B', 'A', 'B'],
        'target': [0, 1, 0, 1]
    }
    df = pd.DataFrame(data)
    
    X, y = preprocess_data(
        df, 
        feature_columns=['feature1', 'feature2'], 
        target_column='target',
        task_type='classification'
    )
    
    assert X.shape == (4, 2), "X shape error"
    assert y.shape == (4,), "y shape error"
    print("Preprocessing OK")
    return X, y

def test_model_training(X, y):
    print("Testing Training...")
    metrics, _ = train_classification_model(
        X, y, 
        model_name='RandomForestClassifier',
        hyperparameters={'n_estimators': 10}
    )
    print(f"Metrics: {metrics}")
    print("Training OK")

if __name__ == "__main__":
    try:
        X, y = test_preprocessing()
        test_model_training(X, y)
        print("All tests passed!")
    except Exception as e:
        print(f"FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
