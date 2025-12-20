"""
Prompt 模板管理模块
负责生成 AI 调用的提示词
"""

import json
from typing import Dict, Any, List

def build_prompt_for_tool(tool: str, arguments: Dict[str, Any]) -> str:
    """
    为不同工具构建提示词
    
    Args:
        tool: 工具名称
        arguments: 工具参数
        
    Returns:
        生成的提示词字符串 (中文)
    """
    
    if tool == 'explain_algorithm':
        algorithm_name = arguments.get('algorithm_name', '')
        category = arguments.get('category', '')
        # detail_level = arguments.get('detail_level', 'basic') # 保留参数但暂未使用逻辑
        
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
        # focus_areas = arguments.get('focus_areas', [])
        
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
        # Fallback
        return f"请回答关于 {tool} 的问题: {json.dumps(arguments, ensure_ascii=False)}"
    
def get_valid_tools() -> List[str]:
    """获取所有支持的工具列表"""
    return [
        'explain_algorithm', 'generate_visualization_code', 'analyze_ml_results',
        'suggest_hyperparameters', 'compare_algorithms', 'debug_visualization',
        'explain_concept', 'generate_practice', 'get_study_plan',
        "review_mistakes",
    "chat",
    "debug_models"
]
