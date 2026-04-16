from __future__ import annotations

import os
from typing import Iterable, Optional

import requests

from agent_plane.contracts.models import AgentConversationItem, AgentImagePayload


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

        api_url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_name}:generateContent?key={self.api_key}"
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

        response = requests.post(
            api_url,
            json={"contents": contents},
            timeout=self.timeout_s,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
        message = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text")
        if not isinstance(message, str) or not message.strip():
            raise RuntimeError("gemini_empty_response")

        return {
          "message": message.strip(),
          "model": self.model_name,
          "tokens_used": int(payload.get("usageMetadata", {}).get("totalTokenCount", 0) or 0),
        }
