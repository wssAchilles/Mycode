import sys
import os
import pytest
import pandas as pd
import numpy as np

# Add functions directory to path so we can import ml_engine
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from ml_engine.preprocessing import preprocess_data

def test_missing_strategy_mean():
    """Test mean imputation for numeric columns with missing values."""
    df = pd.DataFrame({
        'A': [1.0, 2.0, None, 4.0],
        'B': ['x', 'y', 'x', 'y'],
        'target': [0, 1, 0, 1]
    })
    
    # Expected mean of A is (1+2+4)/3 = 7/3 = approx 2.333
    
    X, y = preprocess_data(df, feature_columns=['A', 'B'], target_column='target', missing_strategy='mean')
    
    assert X.shape == (4, 3) # A (1) + B (2 for one-hot x, y) = 3 columns? Or B label encoded?
    # Wait, 'x', 'y' has cardinality 2 (< 10), so it should be One-Hot encoded if numeric logic works.
    # Let's check logic:
    # 1. infer_objects()
    # 2. Imputation:
    #    - numeric: mean -> 1, 2, 2.33, 4
    #    - categorical (B): 'unknown' if None? No None here.
    # 3. Encoding:
    #    - B is object. nunique=2. <10 -> OneHot.
    #    - B_x, B_y.
    
    # Actually, scaler is applied.
    # Let's just check shape and finite values.
    assert not np.isnan(X).any()

def test_missing_strategy_constant():
    """Test constant imputation (fill 0)."""
    df = pd.DataFrame({
        'A': [1.0, None, 3.0],
        'target': [1, 2, 3]
    })
    
    X, y = preprocess_data(df, feature_columns=['A'], target_column='target', missing_strategy='constant')
    
    # A should have 0.0 at index 1 before scaling.
    # After scaling, it behaves normally.
    assert not np.isnan(X).any()

def test_missing_strategy_drop():
    """Test dropping rows with missing values."""
    df = pd.DataFrame({
        'A': [1.0, None, 3.0],
        'target': [1, 2, 3]
    })
    
    X, y = preprocess_data(df, feature_columns=['A'], target_column='target', missing_strategy='drop')
    
    assert X.shape[0] == 2
    assert y.shape[0] == 2

def test_encoding_onehot_vs_label():
    """Test that low cardinality uses OneHot and high cardinality uses Label."""
    df = pd.DataFrame({
        'low_card': ['a', 'b', 'a', 'c'] * 5, # 3 unique values
        'high_card': [str(i) for i in range(20)], # 20 unique values
        'target': range(20)
    })
    
    X, y = preprocess_data(df, feature_columns=['low_card', 'high_card'], target_column='target')
    
    # low_card: 3 unique -> OneHot -> 3 columns (or 2 if drop_first? code says handle_unknown='ignore', usually implies standard OneHot)
    # The code uses pd.get_dummies if implementing manual, or sklearn OneHotEncoder.
    # Code uses: OneHotEncoder(sparse_output=False, handle_unknown='ignore')
    # So 3 columns for 'low_card'.
    
    # high_card: 20 unique (> 10) -> LabelEncoder -> 1 column.
    
    # Total columns: 3 + 1 = 4.
    
    assert X.shape[1] == 4

def test_target_missing():
    """Test that rows with missing target are dropped for classification/regression."""
    df = pd.DataFrame({
        'A': [1, 2, 3],
        'target': [1, None, 0]
    })
    
    X, y = preprocess_data(df, feature_columns=['A'], target_column='target', task_type='classification')
    
    assert X.shape[0] == 2
    assert len(y) == 2
