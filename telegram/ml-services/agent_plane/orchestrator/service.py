from __future__ import annotations

from agent_plane.contracts.models import AgentRespondData, AgentRespondRequest, AgentRespondResponse
from agent_plane.planner import build_execution_plan
from agent_plane.prompts import build_agent_system_instruction, render_context_blocks
from agent_plane.providers import GeminiProvider
from agent_plane.state import compact_history


class AgentOrchestrator:
    def __init__(self, provider: GeminiProvider | None = None) -> None:
        self.provider = provider or GeminiProvider()

    def respond(self, request: AgentRespondRequest) -> AgentRespondResponse:
        plan = build_execution_plan(request.message, request.contextSnapshot)
        history = compact_history(request.conversationHistory)
        context_blocks = render_context_blocks(request.contextSnapshot, plan.active_scopes)

        prompt_sections = [f"用户问题：{request.message.strip()}"]
        if context_blocks:
            prompt_sections.append(f"以下是与当前用户有关的上下文，请优先利用它回答：\n{context_blocks}")

        provider_result = self.provider.generate(
            system_instruction=build_agent_system_instruction(plan.response_style),
            prompt="\n\n".join(prompt_sections),
            history=history,
            image_data=request.imageData,
        )

        suggestions = self._build_follow_up_suggestions(plan.active_scopes)
        return AgentRespondResponse(
            success=True,
            data=AgentRespondData(
                message=str(provider_result["message"]),
                suggestions=suggestions,
                usedScopes=plan.active_scopes,
                model=str(provider_result["model"]),
                mode="agent_primary",
                fallback=False,
            ),
        )

    def _build_follow_up_suggestions(self, scopes: list[str]) -> list[str]:
        if "notifications" in scopes:
            return ["帮我总结最近通知", "哪些互动最值得先处理", "有什么需要我马上回复的吗"]
        if "news" in scopes:
            return ["把重点新闻压缩成三条", "这些新闻和我有什么关系", "哪条新闻最值得点开"]
        if "feed" in scopes:
            return ["最近有哪些值得看的动态", "帮我总结一下关注圈子", "我应该先看哪几条内容"]
        return ["帮我总结一下今天的动态", "最近有什么值得关注", "给我一个下一步建议"]
