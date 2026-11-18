"""纯标准库确定性内容安全规则引擎（关键词、正则、恶意域名与用户黑名单毫秒级过滤）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import re
import threading
from typing import Dict, List, Optional, Set, Tuple


class SafetyLevel(Enum):
    """内容安全风险等级枚举。"""

    SAFE = "safe"
    LOW_RISK = "low_risk"
    MEDIUM_RISK = "medium"
    HIGH_RISK = "high"
    BLOCKED = "blocked"


class ViolationType(Enum):
    """内容违规类别枚举。"""

    SPAM = "spam"
    NSFW = "nsfw"
    VIOLENCE = "violence"
    HATE_SPEECH = "hate_speech"
    HARASSMENT = "harassment"
    MISINFORMATION = "misinformation"
    SCAM = "scam"
    ILLEGAL = "illegal"
    SELF_HARM = "self_harm"
    UNKNOWN = "unknown"


@dataclass
class SafetyResult:
    """单条内容安全审查结果。"""

    safe: bool
    level: SafetyLevel
    score: float
    violations: List[ViolationType] = field(default_factory=list)
    matched_rules: List[str] = field(default_factory=list)
    reason: Optional[str] = None
    ml_scores: Optional[Dict[str, float]] = None
    requires_review: bool = False


@dataclass
class RuleMatch:
    """命中的确定性规则详情。"""

    rule_id: str
    rule_name: str
    violation_type: ViolationType
    severity: float
    matched_text: str


class SafetyRuleEngine:
    """线程安全的轻量级内容安全规则引擎。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        # 高危关键词（直接拦截）
        self.high_risk_keywords: Dict[ViolationType, Set[str]] = {
            ViolationType.SPAM: {
                "buy followers",
                "get rich quick",
                "make money fast",
                "click here now",
                "limited time offer",
                "act now",
                "免费领取",
                "点击链接",
                "转发抽奖",
            },
            ViolationType.NSFW: {
                "xxx",
                "porn",
                "nude",
                "naked",
                "sex video",
                "色情",
                "裸体",
                "成人视频",
            },
            ViolationType.VIOLENCE: {
                "kill",
                "murder",
                "bomb",
                "terrorist",
                "attack plan",
                "杀人",
                "爆炸",
                "恐怖袭击",
                "血腥",
            },
            ViolationType.HATE_SPEECH: {
                "hate all",
                "death to",
                "exterminate",
                "种族灭绝",
                "仇恨",
            },
            ViolationType.SCAM: {
                "send bitcoin",
                "wire money",
                "nigerian prince",
                "crypto giveaway",
                "double your money",
                "转账",
                "汇款",
                "虚拟货币",
            },
            ViolationType.SELF_HARM: {
                "how to suicide",
                "end my life",
                "kill myself",
                "自杀方法",
                "结束生命",
            },
        }

        # 中危关键词（拦截并标记人工复审）
        self.medium_risk_keywords: Dict[ViolationType, Set[str]] = {
            ViolationType.SPAM: {
                "follow me",
                "like for like",
                "f4f",
                "promo",
                "关注回关",
                "互粉",
            },
            ViolationType.HARASSMENT: {
                "idiot",
                "stupid",
                "loser",
                "dumb",
                "白痴",
                "傻瓜",
                "垃圾",
            },
        }

        # 风险特征正则表达式
        self.regex_patterns: List[Tuple[re.Pattern[str], ViolationType, float]] = [
            (re.compile(r"call\s*(?:me|now|us)?\s*\+?\d{10,}", re.I), ViolationType.SCAM, 0.8),
            (re.compile(r"bit\.ly|tinyurl|短链|t\.cn", re.I), ViolationType.SCAM, 0.6),
            (re.compile(r"(.)\1{10,}"), ViolationType.SPAM, 0.5),
            (re.compile(r"\b[A-Z]{20,}\b"), ViolationType.SPAM, 0.4),
        ]

        # 恶意域名黑名单
        self.url_blacklist: Set[str] = {
            "malware.com",
            "phishing.net",
            "scam-site.org",
        }

        # 用户黑名单
        self.user_blacklist: Set[str] = set()

    def add_keyword(self, keyword: str, violation_type: ViolationType, high_risk: bool = True) -> None:
        """动态添加风险关键词（线程安全）。"""
        cleaned = str(keyword or "").strip().lower()
        if not cleaned:
            return
        with self._lock:
            target = self.high_risk_keywords if high_risk else self.medium_risk_keywords
            if violation_type not in target:
                target[violation_type] = set()
            target[violation_type].add(cleaned)

    def add_user_to_blacklist(self, user_id: str) -> None:
        """将指定用户加入黑名单（线程安全）。"""
        cleaned = str(user_id or "").strip()
        if not cleaned:
            return
        with self._lock:
            self.user_blacklist.add(cleaned)

    def remove_user_from_blacklist(self, user_id: str) -> None:
        """将指定用户移出黑名单（线程安全）。"""
        cleaned = str(user_id or "").strip()
        with self._lock:
            self.user_blacklist.discard(cleaned)

    def check(self, content: str, user_id: Optional[str] = None) -> SafetyResult:
        """执行多层确定性规则审查并返回风险分级。"""
        text = str(content or "")
        content_lower = text.lower()
        matches: List[RuleMatch] = []
        max_severity = 0.0
        violations: List[ViolationType] = []

        with self._lock:
            if user_id and user_id in self.user_blacklist:
                return SafetyResult(
                    safe=False,
                    level=SafetyLevel.BLOCKED,
                    score=1.0,
                    violations=[ViolationType.UNKNOWN],
                    matched_rules=["user_blacklist"],
                    reason="User is blacklisted",
                )
            high_snapshot = {k: set(v) for k, v in self.high_risk_keywords.items()}
            medium_snapshot = {k: set(v) for k, v in self.medium_risk_keywords.items()}
            url_snapshot = set(self.url_blacklist)

        for vtype, keywords in high_snapshot.items():
            for keyword in keywords:
                if keyword in content_lower:
                    matches.append(
                        RuleMatch(
                            rule_id=f"high_{vtype.value}_{keyword}",
                            rule_name=f"High risk keyword: {keyword}",
                            violation_type=vtype,
                            severity=0.9,
                            matched_text=keyword,
                        )
                    )
                    if vtype not in violations:
                        violations.append(vtype)
                    max_severity = max(max_severity, 0.9)

        for vtype, keywords in medium_snapshot.items():
            for keyword in keywords:
                if keyword in content_lower:
                    matches.append(
                        RuleMatch(
                            rule_id=f"medium_{vtype.value}_{keyword}",
                            rule_name=f"Medium risk keyword: {keyword}",
                            violation_type=vtype,
                            severity=0.5,
                            matched_text=keyword,
                        )
                    )
                    if vtype not in violations:
                        violations.append(vtype)
                    max_severity = max(max_severity, 0.5)

        for pattern, vtype, severity in self.regex_patterns:
            if pattern.search(text):
                matches.append(
                    RuleMatch(
                        rule_id=f"regex_{vtype.value}",
                        rule_name=f"Regex pattern: {vtype.value}",
                        violation_type=vtype,
                        severity=severity,
                        matched_text=pattern.pattern,
                    )
                )
                if vtype not in violations:
                    violations.append(vtype)
                max_severity = max(max_severity, severity)

        urls = re.findall(r"https?://([^\s/]+)", text)
        for url in urls:
            domain = url.lower().split("/")[0]
            if domain in url_snapshot:
                matches.append(
                    RuleMatch(
                        rule_id=f"url_blacklist_{domain}",
                        rule_name=f"Blacklisted URL: {domain}",
                        violation_type=ViolationType.SCAM,
                        severity=0.95,
                        matched_text=domain,
                    )
                )
                if ViolationType.SCAM not in violations:
                    violations.append(ViolationType.SCAM)
                max_severity = max(max_severity, 0.95)

        if max_severity >= 0.9:
            level = SafetyLevel.HIGH_RISK
            safe = False
        elif max_severity >= 0.5:
            level = SafetyLevel.MEDIUM_RISK
            safe = False
        elif max_severity > 0.0:
            level = SafetyLevel.LOW_RISK
            safe = True
        else:
            level = SafetyLevel.SAFE
            safe = True

        return SafetyResult(
            safe=safe,
            level=level,
            score=max_severity,
            violations=violations,
            matched_rules=[m.rule_id for m in matches],
            reason=matches[0].rule_name if matches else None,
            requires_review=(level == SafetyLevel.MEDIUM_RISK),
        )


class DeterministicSafetyService:
    """面向在线推理层的零外部依赖内容安全审查门面。"""

    def __init__(self) -> None:
        self.rule_engine = SafetyRuleEngine()

    def check(
        self,
        content: str,
        user_id: Optional[str] = None,
        skip_ml: bool = True,
    ) -> SafetyResult:
        """执行确定性规则检测（保留 skip_ml 参数以完全兼容 V2/V3 调用契约）。"""
        _ = skip_ml
        return self.rule_engine.check(content=content, user_id=user_id)
