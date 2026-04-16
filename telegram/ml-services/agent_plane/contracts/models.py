from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


AgentScope = Literal["feed", "notifications", "news"]


class AgentConversationItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentImagePayload(BaseModel):
    mimeType: str
    base64Data: str


class AgentUserSnapshot(BaseModel):
    id: str
    username: str


class AgentFeedItem(BaseModel):
    postId: str
    title: Optional[str] = None
    snippet: str
    authorUsername: Optional[str] = None
    isNews: bool = False
    recallSource: Optional[str] = None
    createdAt: str


class AgentNotificationItem(BaseModel):
    id: str
    type: str
    actorUsername: Optional[str] = None
    postSnippet: Optional[str] = None
    actionText: Optional[str] = None
    createdAt: str


class AgentNewsItem(BaseModel):
    postId: Optional[str] = None
    title: str
    summary: str
    source: Optional[str] = None
    url: Optional[str] = None
    createdAt: Optional[str] = None


class FeedContextSnapshot(BaseModel):
    items: List[AgentFeedItem] = Field(default_factory=list)
    summary: str = ""


class NotificationContextSnapshot(BaseModel):
    items: List[AgentNotificationItem] = Field(default_factory=list)
    summary: str = ""


class NewsContextSnapshot(BaseModel):
    items: List[AgentNewsItem] = Field(default_factory=list)
    summary: str = ""


class AgentContextSnapshot(BaseModel):
    user: AgentUserSnapshot
    requestedScopes: List[AgentScope] = Field(default_factory=list)
    feed: Optional[FeedContextSnapshot] = None
    notifications: Optional[NotificationContextSnapshot] = None
    news: Optional[NewsContextSnapshot] = None
    generatedAt: str


class AgentRespondRequest(BaseModel):
    userId: str
    message: str
    conversationId: Optional[str] = None
    conversationHistory: List[AgentConversationItem] = Field(default_factory=list)
    imageData: Optional[AgentImagePayload] = None
    contextSnapshot: AgentContextSnapshot


class AgentRespondData(BaseModel):
    message: str
    suggestions: List[str] = Field(default_factory=list)
    usedScopes: List[AgentScope] = Field(default_factory=list)
    model: str = "unknown"
    mode: str = "agent_primary"
    fallback: bool = False


class AgentRespondResponse(BaseModel):
    success: bool = True
    data: AgentRespondData
