from __future__ import annotations

import os
import re
from typing import Iterable, Optional

import requests

from agent_plane.contracts.models import AgentConversationItem, AgentImagePayload

_QUERY_KEY_PATTERN = re.compile(r"([?&]key=)[^&\s]+", re.IGNORECASE)


def _sanitize_error_message(raw: str, secret: str) -> str:
    """脱敏上游请求异常文本，彻底阻断密钥与查询参数回显泄漏。"""
    cleaned = _QUERY_KEY_PATTERN.sub(r"\1[REDACTED]", str(raw or ""))
    if secret:
        cleaned = cleaned.replace(secret, "[REDACTED]")
    return cleaned


class GeminiProvider:
    def __init__(self) -> None:
        self.api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        self.model_name = (os.getenv("AI_AGENT_GEMINI_MODEL") or "gemini-2.0-flash").strip()
        self.timeout_s = float(os.getenv("AI_AGENT_TIMEOUT_SECONDS", "25") or "25")

    def generate(
        self,
        *,
        system_instruction: str,
        prompt: str,
        history: Iterable[AgentConversationItem],
        image_data: Optional[AgentImagePayload] = None,
    ) -> dict[str, object]:
        if not self.api_key:
            raise RuntimeError("gemini_api_key_missing")

        # 严禁在 URL 查询参数拼接 API Key，统一通过 x-goog-api-key 请求头安全传递
        api_url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_name}:generateContent"
        )

        contents: list[dict[str, object]] = [
            {"role": "model", "parts": [{"text": system_instruction}]},
        ]

        for item in history:
            if not item.content.strip():
                continue
            contents.append(
                {
                    "role": "model" if item.role == "assistant" else "user",
                    "parts": [{"text": item.content.strip()}],
                }
            )

        current_parts: list[dict[str, object]] = [{"text": prompt}]
        if image_data and image_data.base64Data and image_data.mimeType:
            current_parts.append(
                {
                    "inline_data": {
                        "mime_type": image_data.mimeType,
                        "data": image_data.base64Data,
                    }
                }
            )
        contents.append({"role": "user", "parts": current_parts})

        try:
            response = requests.post(
                api_url,
                json={"contents": contents},
                timeout=self.timeout_s,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-goog-api-key": self.api_key,
                },
            )
            response.raise_for_status()
            payload = response.json()
        except requests.HTTPError as exc:
            status = getattr(exc.response, "status_code", "unknown")
            raise RuntimeError(f"gemini_upstream_http_{status}") from None
        except requests.RequestException as exc:
            safe_detail = _sanitize_error_message(type(exc).__name__, self.api_key)
            raise RuntimeError(f"gemini_upstream_network_error:{safe_detail}") from None
        except ValueError:
            raise RuntimeError("gemini_invalid_json_response") from None

        message = (
            payload.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )
        if not isinstance(message, str) or not message.strip():
            raise RuntimeError("gemini_empty_response")

        return {
            "message": message.strip(),
            "model": self.model_name,
            "tokens_used": int(payload.get("usageMetadata", {}).get("totalTokenCount", 0) or 0),
        }
