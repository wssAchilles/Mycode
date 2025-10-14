"""
AI 客户端封装
支持多个 AI 提供商: Google Gemini, Anthropic Claude, OpenAI GPT
"""

import os
from typing import Optional
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()


class AIClient:
    """统一的 AI 客户端接口"""
    
    def __init__(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None
    ):
        """
        初始化 AI 客户端
        
        Args:
            provider: AI 提供商 ('gemini', 'claude', 'openai')
            model: 模型名称
            api_key: API 密钥 (如果不提供,从环境变量读取)
        """
        self.provider = provider or os.getenv('AI_PROVIDER', 'gemini')
        self.model = model or os.getenv('AI_MODEL', 'gemini-1.5-flash')
        
        # 初始化对应的客户端
        if self.provider == 'gemini':
            self._init_gemini_client(api_key)
        elif self.provider == 'claude':
            self._init_claude_client(api_key)
        elif self.provider == 'openai':
            self._init_openai_client(api_key)
        else:
            raise ValueError(f"不支持的 AI 提供商: {self.provider}")
    
    def _init_gemini_client(self, api_key: Optional[str] = None):
        """初始化 Google Gemini 客户端"""
        try:
            import google.generativeai as genai
            
            key = api_key or os.getenv('GOOGLE_API_KEY')
            if not key:
                raise ValueError("缺少 GOOGLE_API_KEY")
            
            genai.configure(api_key=key)
            self.client = genai.GenerativeModel(self.model)
            self.client_type = 'gemini'
            
            print(f"✓ Gemini 客户端初始化成功 (模型: {self.model})")
            
        except ImportError:
            raise ImportError("请安装 google-generativeai: pip install google-generativeai")
    
    def _init_claude_client(self, api_key: Optional[str] = None):
        """初始化 Anthropic Claude 客户端"""
        try:
            import anthropic
            
            key = api_key or os.getenv('ANTHROPIC_API_KEY')
            if not key:
                raise ValueError("缺少 ANTHROPIC_API_KEY")
            
            self.client = anthropic.Anthropic(api_key=key)
            self.client_type = 'claude'
            
            print(f"✓ Claude 客户端初始化成功 (模型: {self.model})")
            
        except ImportError:
            raise ImportError("请安装 anthropic: pip install anthropic")
    
    def _init_openai_client(self, api_key: Optional[str] = None):
        """初始化 OpenAI 客户端"""
        try:
            import openai
            
            key = api_key or os.getenv('OPENAI_API_KEY')
            if not key:
                raise ValueError("缺少 OPENAI_API_KEY")
            
            self.client = openai.OpenAI(api_key=key)
            self.client_type = 'openai'
            
            print(f"✓ OpenAI 客户端初始化成功 (模型: {self.model})")
            
        except ImportError:
            raise ImportError("请安装 openai: pip install openai")
    
    def generate(self, prompt: str, max_tokens: int = 2000) -> str:
        """
        生成文本
        
        Args:
            prompt: 提示词
            max_tokens: 最大令牌数
            
        Returns:
            生成的文本
        """
        if self.client_type == 'gemini':
            return self._generate_gemini(prompt, max_tokens)
        elif self.client_type == 'claude':
            return self._generate_claude(prompt, max_tokens)
        elif self.client_type == 'openai':
            return self._generate_openai(prompt, max_tokens)
        else:
            raise ValueError(f"未知的客户端类型: {self.client_type}")
    
    def _generate_gemini(self, prompt: str, max_tokens: int) -> str:
        """使用 Gemini 生成文本"""
        try:
            response = self.client.generate_content(
                prompt,
                generation_config={
                    'max_output_tokens': max_tokens,
                    'temperature': 0.7,
                }
            )
            return response.text
        except Exception as e:
            raise Exception(f"Gemini 生成失败: {str(e)}")
    
    def _generate_claude(self, prompt: str, max_tokens: int) -> str:
        """使用 Claude 生成文本"""
        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}]
            )
            return message.content[0].text
        except Exception as e:
            raise Exception(f"Claude 生成失败: {str(e)}")
    
    def _generate_openai(self, prompt: str, max_tokens: int) -> str:
        """使用 OpenAI 生成文本"""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}]
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"OpenAI 生成失败: {str(e)}")
    
    async def generate_async(self, prompt: str, max_tokens: int = 2000) -> str:
        """
        异步生成文本
        
        Args:
            prompt: 提示词
            max_tokens: 最大令牌数
            
        Returns:
            生成的文本
        """
        # 对于同步客户端,使用线程池执行
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        
        with ThreadPoolExecutor() as executor:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                executor,
                self.generate,
                prompt,
                max_tokens
            )
            return result


# 便捷函数
def create_ai_client(
    provider: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None
) -> AIClient:
    """
    创建 AI 客户端
    
    Args:
        provider: AI 提供商 ('gemini', 'claude', 'openai')
        model: 模型名称
        api_key: API 密钥
        
    Returns:
        AIClient 实例
    """
    return AIClient(provider=provider, model=model, api_key=api_key)


# 测试函数
def test_ai_client():
    """测试 AI 客户端"""
    print("=" * 60)
    print("测试 AI 客户端")
    print("=" * 60)
    
    try:
        # 创建客户端
        client = create_ai_client()
        
        # 测试生成
        print("\n测试提示: 用一句话解释什么是快速排序算法")
        response = client.generate("用一句话解释什么是快速排序算法")
        
        print(f"\nAI 回复:\n{response}")
        print("\n✓ 测试成功!")
        
    except Exception as e:
        print(f"\n✗ 测试失败: {e}")


if __name__ == "__main__":
    test_ai_client()
