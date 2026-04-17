"""
MCP Server for ML Platform
为算法可视化学习平台提供 AI 辅助功能
"""

import asyncio
import json
from typing import Any, Optional
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent,
    EmbeddedResource,
    ImageContent,
)
import os
from ai_client import create_ai_client


class MLPlatformMCPServer:
    """ML Platform MCP 服务器"""
    
    def __init__(self):
        self.app = Server("ml-platform-mcp")
        
        # 初始化 AI 客户端 (支持 Gemini, Claude, OpenAI)
        self.ai_client = create_ai_client()
        
        # 算法知识库
        self.algorithm_knowledge = self._load_algorithm_knowledge()
        
        # 注册工具
        self._register_tools()
        
    def _load_algorithm_knowledge(self) -> dict:
        """加载算法知识库"""
        return {
            "sorting": {
                "bubble_sort": {
                    "name": "冒泡排序",
                    "complexity": {"time": "O(n²)", "space": "O(1)"},
                    "principle": "重复遍历列表,比较相邻元素并交换位置",
                    "use_cases": "小规模数据排序,教学演示"
                },
                "quick_sort": {
                    "name": "快速排序",
                    "complexity": {"time": "O(n log n)", "space": "O(log n)"},
                    "principle": "分治法,选择基准元素进行分区",
                    "use_cases": "通用排序,平均性能最优"
                },
                "merge_sort": {
                    "name": "归并排序",
                    "complexity": {"time": "O(n log n)", "space": "O(n)"},
                    "principle": "分治法,将数组分割后合并",
                    "use_cases": "稳定排序,链表排序"
                }
            },
            "data_structures": {
                "binary_tree": {
                    "name": "二叉树",
                    "operations": ["插入", "删除", "查找", "遍历"],
                    "complexity": {"search": "O(log n)", "insert": "O(log n)"},
                    "use_cases": "数据存储,表达式解析"
                },
                "hash_table": {
                    "name": "哈希表",
                    "operations": ["插入", "删除", "查找"],
                    "complexity": {"average": "O(1)", "worst": "O(n)"},
                    "use_cases": "快速查找,缓存实现"
                }
            },
            "os_algorithms": {
                "fcfs": {
                    "name": "先来先服务调度",
                    "principle": "按到达时间顺序执行进程",
                    "pros": "简单公平",
                    "cons": "平均等待时间长"
                },
                "sjf": {
                    "name": "最短作业优先",
                    "principle": "优先执行服务时间最短的进程",
                    "pros": "平均等待时间最短",
                    "cons": "可能导致饥饿"
                },
                "round_robin": {
                    "name": "时间片轮转",
                    "principle": "每个进程分配固定时间片",
                    "pros": "公平性好,响应时间快",
                    "cons": "上下文切换开销"
                }
            },
            "ml_algorithms": {
                "random_forest": {
                    "name": "随机森林",
                    "type": "集成学习",
                    "principle": "多个决策树投票",
                    "hyperparameters": ["n_estimators", "max_depth", "min_samples_split"],
                    "use_cases": "分类和回归,特征重要性分析"
                },
                "kmeans": {
                    "name": "K-Means聚类",
                    "type": "无监督学习",
                    "principle": "迭代优化聚类中心",
                    "hyperparameters": ["n_clusters", "max_iter", "init"],
                    "use_cases": "客户分群,图像压缩"
                },
                "svm": {
                    "name": "支持向量机",
                    "type": "监督学习",
                    "principle": "寻找最优分类超平面",
                    "hyperparameters": ["C", "kernel", "gamma"],
                    "use_cases": "二分类,文本分类"
                }
            }
        }
    
    def _register_tools(self):
        """注册 MCP 工具"""
        
        @self.app.list_tools()
        async def list_tools() -> list[Tool]:
            """列出所有可用工具"""
            return [
                Tool(
                    name="explain_algorithm",
                    description="解释算法原理、时间复杂度和应用场景",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "algorithm_name": {
                                "type": "string",
                                "description": "算法名称,如 'bubble_sort', 'quick_sort'"
                            },
                            "category": {
                                "type": "string",
                                "enum": ["sorting", "data_structures", "os_algorithms", "ml_algorithms"],
                                "description": "算法类别"
                            },
                            "detail_level": {
                                "type": "string",
                                "enum": ["basic", "detailed", "expert"],
                                "description": "解释详细程度",
                                "default": "basic"
                            }
                        },
                        "required": ["algorithm_name", "category"]
                    }
                ),
                Tool(
                    name="generate_visualization_code",
                    description="生成算法可视化的 Flutter/Dart 代码",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "algorithm_type": {
                                "type": "string",
                                "description": "算法类型,如 'sorting', 'tree_traversal'"
                            },
                            "framework": {
                                "type": "string",
                                "enum": ["flutter", "dart"],
                                "default": "flutter"
                            },
                            "animation_style": {
                                "type": "string",
                                "enum": ["basic", "smooth", "interactive"],
                                "default": "smooth"
                            }
                        },
                        "required": ["algorithm_type"]
                    }
                ),
                Tool(
                    name="analyze_ml_results",
                    description="分析机器学习实验结果并提供优化建议",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "metrics": {
                                "type": "object",
                                "description": "模型评估指标 (accuracy, precision, recall等)"
                            },
                            "model_type": {
                                "type": "string",
                                "description": "模型类型"
                            },
                            "task_type": {
                                "type": "string",
                                "enum": ["classification", "regression", "clustering"]
                            }
                        },
                        "required": ["metrics", "task_type"]
                    }
                ),
                Tool(
                    name="suggest_hyperparameters",
                    description="根据数据特征建议机器学习模型超参数",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "model_name": {
                                "type": "string",
                                "description": "模型名称"
                            },
                            "dataset_info": {
                                "type": "object",
                                "description": "数据集信息 (样本数量、特征数量等)"
                            },
                            "task_type": {
                                "type": "string",
                                "enum": ["classification", "regression", "clustering"]
                            }
                        },
                        "required": ["model_name", "task_type"]
                    }
                ),
                Tool(
                    name="compare_algorithms",
                    description="比较多个算法的性能和适用场景",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "algorithms": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "要比较的算法列表"
                            },
                            "category": {
                                "type": "string",
                                "enum": ["sorting", "os_algorithms", "ml_algorithms"]
                            },
                            "comparison_criteria": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "enum": ["complexity", "performance", "use_cases", "pros_cons"]
                                }
                            }
                        },
                        "required": ["algorithms", "category"]
                    }
                ),
                Tool(
                    name="debug_visualization",
                    description="帮助调试可视化代码中的问题",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "error_message": {
                                "type": "string",
                                "description": "错误信息"
                            },
                            "code_snippet": {
                                "type": "string",
                                "description": "相关代码片段"
                            },
                            "context": {
                                "type": "string",
                                "description": "问题上下文"
                            }
                        },
                        "required": ["error_message"]
                    }
                )
            ]
        
        @self.app.call_tool()
        async def call_tool(name: str, arguments: Any) -> list[TextContent]:
            """调用工具"""
            
            if name == "explain_algorithm":
                return await self._explain_algorithm(arguments)
            
            elif name == "generate_visualization_code":
                return await self._generate_visualization_code(arguments)
            
            elif name == "analyze_ml_results":
                return await self._analyze_ml_results(arguments)
            
            elif name == "suggest_hyperparameters":
                return await self._suggest_hyperparameters(arguments)
            
            elif name == "compare_algorithms":
                return await self._compare_algorithms(arguments)
            
            elif name == "debug_visualization":
                return await self._debug_visualization(arguments)
            
            else:
                return [TextContent(
                    type="text",
                    text=f"未知工具: {name}"
                )]
    
    async def _explain_algorithm(self, args: dict) -> list[TextContent]:
        """解释算法"""
        algorithm_name = args["algorithm_name"]
        category = args["category"]
        detail_level = args.get("detail_level", "basic")
        
        # 从知识库获取基础信息
        algo_info = self.algorithm_knowledge.get(category, {}).get(algorithm_name, {})
        
        if not algo_info:
            return [TextContent(
                type="text",
                text=f"未找到算法 '{algorithm_name}' 的信息"
            )]
        
        # 使用 AI 生成详细解释
        prompt = f"""请详细解释以下算法:

算法名称: {algo_info.get('name', algorithm_name)}
类别: {category}
详细程度: {detail_level}

基础信息:
{json.dumps(algo_info, indent=2, ensure_ascii=False)}

请按以下格式提供解释:
1. 算法原理 (通俗易懂的语言)
2. 时间和空间复杂度分析
3. 适用场景和实际应用
4. 优缺点对比
5. 学习建议和注意事项

如果详细程度是 'expert',还需要包括:
- 数学证明或推导
- 代码实现细节
- 优化技巧
"""
        
        message = self.client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        
        explanation = message.content[0].text
        
        return [TextContent(
            type="text",
            text=explanation
        )]
    
    async def _generate_visualization_code(self, args: dict) -> list[TextContent]:
        """生成可视化代码"""
        algorithm_type = args["algorithm_type"]
        framework = args.get("framework", "flutter")
        animation_style = args.get("animation_style", "smooth")
        
        prompt = f"""为 {algorithm_type} 算法生成 {framework} 可视化代码。

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
- 交互控制 (播放/暂停/速度调节)
"""
        
        code = await self.ai_client.generate_async(prompt, max_tokens=3000)
        
        return [TextContent(
            type="text",
            text=f"# {algorithm_type} 可视化代码\n\n{code}"
        )]
    
    async def _analyze_ml_results(self, args: dict) -> list[TextContent]:
        """分析机器学习结果"""
        metrics = args["metrics"]
        task_type = args["task_type"]
        model_type = args.get("model_type", "unknown")
        
        prompt = f"""分析以下机器学习实验结果:

任务类型: {task_type}
模型类型: {model_type}

评估指标:
{json.dumps(metrics, indent=2, ensure_ascii=False)}

请提供:
1. 模型性能评估 (性能好坏判断)
2. 可能存在的问题 (过拟合/欠拟合/数据不平衡等)
3. 具体优化建议 (超参数调整、特征工程、模型选择)
4. 下一步实验方向

请以考研学生能理解的方式解释。
"""
        
        analysis = await self.ai_client.generate_async(prompt, max_tokens=2000)
        
        return [TextContent(
            type="text",
            text=analysis
        )]
    
    async def _suggest_hyperparameters(self, args: dict) -> list[TextContent]:
        """建议超参数"""
        model_name = args["model_name"]
        task_type = args["task_type"]
        dataset_info = args.get("dataset_info", {})
        
        # 从知识库获取模型信息
        model_info = None
        for category in self.algorithm_knowledge.get("ml_algorithms", {}).values():
            if category.get("name") == model_name:
                model_info = category
                break
        
        prompt = f"""为以下场景建议机器学习模型超参数:

模型: {model_name}
任务类型: {task_type}
数据集信息: {json.dumps(dataset_info, indent=2, ensure_ascii=False)}

模型知识库信息:
{json.dumps(model_info, indent=2, ensure_ascii=False) if model_info else "无"}

请提供:
1. 推荐的超参数配置 (初始值)
2. 每个超参数的作用解释
3. 参数调优的建议范围
4. 调优策略 (网格搜索/随机搜索/贝叶斯优化)
"""
        
        suggestions = await self.ai_client.generate_async(prompt, max_tokens=1500)
        
        return [TextContent(
            type="text",
            text=suggestions
        )]
    
    async def _compare_algorithms(self, args: dict) -> list[TextContent]:
        """比较算法"""
        algorithms = args["algorithms"]
        category = args["category"]
        criteria = args.get("comparison_criteria", ["complexity", "use_cases"])
        
        # 收集算法信息
        algo_infos = {}
        for algo in algorithms:
            info = self.algorithm_knowledge.get(category, {}).get(algo)
            if info:
                algo_infos[algo] = info
        
        prompt = f"""比较以下 {category} 类别的算法:

算法列表: {', '.join(algorithms)}
比较维度: {', '.join(criteria)}

已知信息:
{json.dumps(algo_infos, indent=2, ensure_ascii=False)}

请提供:
1. 详细的对比表格
2. 各算法的适用场景分析
3. 性能对比 (时间/空间复杂度)
4. 选择建议 (什么情况下用哪个)
"""
        
        comparison = await self.ai_client.generate_async(prompt, max_tokens=2000)
        
        return [TextContent(
            type="text",
            text=comparison
        )]
    
    async def _debug_visualization(self, args: dict) -> list[TextContent]:
        """调试可视化代码"""
        error_message = args["error_message"]
        code_snippet = args.get("code_snippet", "")
        context = args.get("context", "")
        
        prompt = f"""帮助调试 Flutter 可视化代码问题:

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
4. 预防类似问题的建议
"""
        
        debug_help = await self.ai_client.generate_async(prompt, max_tokens=2000)
        
        return [TextContent(
            type="text",
            text=debug_help
        )]
    
    async def run(self):
        """运行 MCP 服务器"""
        async with stdio_server() as (read_stream, write_stream):
            await self.app.run(
                read_stream,
                write_stream,
                self.app.create_initialization_options()
            )


async def main():
    """主函数"""
    server = MLPlatformMCPServer()
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())
