"""
模型工厂模块
负责管理和提供 Scikit-learn 模型类
"""

from typing import Dict, Any, Type, Optional
import traceback

class ModelFactory:
    """管理所有支持的机器学习模型"""

    @classmethod
    def create_model(cls, model_name: str, hyperparameters: Dict[str, Any] = None) -> Any:
        """
        创建模型实例
        
        Args:
            model_name: 模型名称
            hyperparameters: 超参数字典
            
        Returns:
            初始化的模型实例
            
        Raises:
            ValueError: 如果模型名称未知
        """
        hyperparameters = hyperparameters or {}
        
        try:
            # 分类模型
            if model_name == 'LogisticRegression':
                from sklearn.linear_model import LogisticRegression
                return LogisticRegression(**hyperparameters)
            elif model_name == 'DecisionTreeClassifier':
                from sklearn.tree import DecisionTreeClassifier
                return DecisionTreeClassifier(**hyperparameters)
            elif model_name == 'RandomForestClassifier':
                from sklearn.ensemble import RandomForestClassifier
                return RandomForestClassifier(**hyperparameters)
            elif model_name == 'GradientBoostingClassifier':
                from sklearn.ensemble import GradientBoostingClassifier
                return GradientBoostingClassifier(**hyperparameters)
            elif model_name == 'SVC':
                from sklearn.svm import SVC
                return SVC(**hyperparameters)
            elif model_name == 'KNeighborsClassifier':
                from sklearn.neighbors import KNeighborsClassifier
                return KNeighborsClassifier(**hyperparameters)
            elif model_name == 'GaussianNB':
                from sklearn.naive_bayes import GaussianNB
                return GaussianNB(**hyperparameters)
                
            # 回归模型
            elif model_name == 'LinearRegression':
                from sklearn.linear_model import LinearRegression
                return LinearRegression(**hyperparameters)
            elif model_name == 'Ridge':
                from sklearn.linear_model import Ridge
                return Ridge(**hyperparameters)
            elif model_name == 'Lasso':
                from sklearn.linear_model import Lasso
                return Lasso(**hyperparameters)
            elif model_name == 'DecisionTreeRegressor':
                from sklearn.tree import DecisionTreeRegressor
                return DecisionTreeRegressor(**hyperparameters)
            elif model_name == 'RandomForestRegressor':
                from sklearn.ensemble import RandomForestRegressor
                return RandomForestRegressor(**hyperparameters)
            elif model_name == 'GradientBoostingRegressor':
                from sklearn.ensemble import GradientBoostingRegressor
                return GradientBoostingRegressor(**hyperparameters)
            elif model_name == 'SVR':
                from sklearn.svm import SVR
                return SVR(**hyperparameters)
                
            # 聚类模型
            elif model_name == 'KMeans':
                from sklearn.cluster import KMeans
                return KMeans(**hyperparameters)
            elif model_name == 'DBSCAN':
                from sklearn.cluster import DBSCAN
                return DBSCAN(**hyperparameters)
            elif model_name == 'AgglomerativeClustering':
                from sklearn.cluster import AgglomerativeClustering
                return AgglomerativeClustering(**hyperparameters)
            elif model_name == 'GaussianMixture':
                from sklearn.mixture import GaussianMixture
                return GaussianMixture(**hyperparameters)

            # 高级集成模型 (LightGBM & XGBoost)
            elif model_name == 'LGBMRegressor':
                from lightgbm import LGBMRegressor
                return LGBMRegressor(**hyperparameters)
            elif model_name == 'LGBMClassifier':
                from lightgbm import LGBMClassifier
                return LGBMClassifier(**hyperparameters)
            elif model_name == 'XGBRegressor':
                from xgboost import XGBRegressor
                return XGBRegressor(**hyperparameters)
            elif model_name == 'XGBClassifier':
                from xgboost import XGBClassifier
                return XGBClassifier(**hyperparameters)
                
            else:
                raise ValueError(f"未知的模型名称: {model_name}")
                
        except ImportError as e:
            raise ValueError(f"无法导入模型 {model_name}: {str(e)}")
        except Exception as e:
            raise ValueError(f"创建模型 {model_name} 失败: {str(e)}")

    @classmethod
    def get_model_class(cls, model_name: str) -> Optional[Type[Any]]:
        """获取指定名称的模型类 (仅用于类型检查或反射，不做实例化)"""
        # 注意：此方法现在也会触发导入，但由于我们主要用 create_model，这个方法暂时保留以兼容旧代码(如果有)
        # 或者直接抛出 NotImplementedError 如果不再需要
        try:
            instance = cls.create_model(model_name)
            return type(instance)
        except:
            return None
