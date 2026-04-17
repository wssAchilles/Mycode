"""
MCP 助手 API 处理模块
负责处理与 AI 模型的交互
"""

import json
import time
import uuid
import os
import requests
import traceback
from firebase_functions import https_fn
from .prompts import build_prompt_for_tool, get_valid_tools

def handle_mcp_chat(req: https_fn.CallableRequest, api_key: str) -> dict:
    """内部处理 MCP 聊天请求的逻辑 (Callable)"""
    
    request_start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    
    try:
        print(f"[{request_id}] MCP请求开始 (Callable)")
        
        # 1. 验证请求数据
        data = req.data
        if not data:
             raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT, message='请求数据为空')

        tool = data.get('tool')
        arguments = data.get('arguments', {})
        
        if not tool or not isinstance(tool, str):
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT, message='无效的工具名称')
            
        valid_tools = get_valid_tools()
        if tool not in valid_tools:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message=f'未知的工具: {tool}',
                details={'valid_tools': valid_tools}
            )
            
        if tool == "debug_models":
            url = f"https://generativelanguage.googleapis.com/v1/models?key={api_key}"
            response = requests.get(url, timeout=10)
            if response.status_code != 200:
                return {"error": f"{response.status_code} - {response.text}"}
            return response.json()

        # 2. 准备 Prompt
        prompt = build_prompt_for_tool(tool, arguments)
        model_name = os.getenv("AI_MODEL", "gemini-2.5-flash")
        
        # 3. 调用 Gemini API
        if not api_key:
             raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION, message='API Key 未配置')
            
        # 4. 执行请求 (使用 requests)
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": 8192,
                "temperature": 0.7
            }
        }
        
        try:
            response = requests.post(url, json=payload, timeout=60)
            if response.status_code != 200:
                error_msg = f"AI API Error: {response.status_code} - {response.text}"
                print(f"[{request_id}] {error_msg}")
                raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.UNAVAILABLE, message=error_msg)
                
            response.raise_for_status()
            api_data = response.json()
        except https_fn.HttpsError:
            raise
        except requests.exceptions.Timeout:
             raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.DEADLINE_EXCEEDED, message='AI 服务请求超时')
        except Exception as e:
            error_msg = f"AI API 错误: {str(e)}"
            print(f"[{request_id}] {error_msg}")
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.UNAVAILABLE, message=f'AI 服务调用失败: {str(e)}')
            
        # 5. 解析响应
        try:
            if 'candidates' not in api_data or not api_data['candidates']:
                 # 检查安全拦截
                 block_reason = api_data.get('promptFeedback', {}).get('blockReason', 'UNKNOWN')
                 raise https_fn.HttpsError(
                     code=https_fn.FunctionsErrorCode.ABORTED,
                     message=f'内容被阻止: {block_reason}'
                 )
                
            candidate = api_data['candidates'][0]
            finish_reason = candidate.get('finishReason', 'UNKNOWN')
            
            if finish_reason != 'STOP':
                 raise https_fn.HttpsError(
                     code=https_fn.FunctionsErrorCode.DATA_LOSS,
                     message=f'生成未完成: {finish_reason}'
                 )
                
            result_text = candidate['content']['parts'][0]['text']
            
        except (KeyError, IndexError) as e:
            print(f"[{request_id}] 响应解析异常: {str(e)}")
            raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message='AI 响应格式异常')
            
        # 6. 返回结果
        duration = time.time() - request_start_time
        print(f"[{request_id}] 完成耗时: {duration:.2f}s")
        
        return {
            'status': 'success',
            'result': result_text,
            'tool': tool
        }

    except https_fn.HttpsError:
        raise
    except Exception as e:
        error_detail = str(e)
        print(f"[{request_id}] 全局异常: {traceback.format_exc()}")
        # 在开发调试阶段返回详细错误，生产环境应屏蔽
        raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message=f'服务器内部错误: {error_detail}')
