"""
VF 内容安全检测模块
多层安全架构: 规则引擎 → ML 分类器 → LLM 审核 (可选)
"""

import re
from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, field
from enum import Enum
import json
from pathlib import Path

# ========== 类型定义 ==========

class SafetyLevel(Enum):
    """安全级别"""
    SAFE = "safe"           # 安全
    LOW_RISK = "low_risk"   # 低风险
    MEDIUM_RISK = "medium"  # 中风险 (需要 ML 复审)
    HIGH_RISK = "high"      # 高风险 (直接拦截)
    BLOCKED = "blocked"     # 已拦截


class ViolationType(Enum):
    """违规类型"""
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
    """安全检测结果"""
    safe: bool
    level: SafetyLevel
    score: float  # 0-1, 越高越危险
    violations: List[ViolationType] = field(default_factory=list)
    matched_rules: List[str] = field(default_factory=list)
    reason: Optional[str] = None
    ml_scores: Optional[Dict[str, float]] = None
    requires_review: bool = False


@dataclass 
class RuleMatch:
    """规则匹配结果"""
    rule_id: str
    rule_name: str
    violation_type: ViolationType
    severity: float  # 0-1
    matched_text: str


# ========== 规则引擎 ==========

class SafetyRuleEngine:
    """
    规则引擎 - 第一层安全检测
    支持关键词、正则、URL 黑名单
    """
    
    def __init__(self):
        # 高危关键词 (直接拦截)
        self.high_risk_keywords: Dict[ViolationType, Set[str]] = {
            ViolationType.SPAM: {
                "buy followers", "get rich quick", "make money fast",
                "click here now", "limited time offer", "act now",
                "免费领取", "点击链接", "转发抽奖",
            },
            ViolationType.NSFW: {
                "xxx", "porn", "nude", "naked", "sex video",
                "色情", "裸体", "成人视频",
            },
            ViolationType.VIOLENCE: {
                "kill", "murder", "bomb", "terrorist", "attack plan",
                "杀人", "爆炸", "恐怖袭击", "血腥",
            },
            ViolationType.HATE_SPEECH: {
                "hate all", "death to", "exterminate",
                "种族灭绝", "仇恨",
            },
            ViolationType.SCAM: {
                "send bitcoin", "wire money", "nigerian prince",
                "crypto giveaway", "double your money",
                "转账", "汇款", "虚拟货币",
            },
            ViolationType.SELF_HARM: {
                "how to suicide", "end my life", "kill myself",
                "自杀方法", "结束生命",
            },
        }
        
        # 中危关键词 (需要 ML 复审)
        self.medium_risk_keywords: Dict[ViolationType, Set[str]] = {
            ViolationType.SPAM: {
                "follow me", "like for like", "f4f", "promo",
                "关注回关", "互粉",
            },
            ViolationType.HARASSMENT: {
                "idiot", "stupid", "loser", "dumb",
                "白痴", "傻瓜", "垃圾",
            },
        }
        
        # 正则模式
        self.regex_patterns: List[Tuple[re.Pattern, ViolationType, float]] = [
            # 电话号码钓鱼
            (re.compile(r"call\s*(?:me|now|us)?\s*\+?\d{10,}", re.I), ViolationType.SCAM, 0.8),
            # 可疑链接
            (re.compile(r"bit\.ly|tinyurl|短链|t\.cn", re.I), ViolationType.SCAM, 0.6),
            # 重复字符 (spam 特征)
            (re.compile(r"(.)\1{10,}"), ViolationType.SPAM, 0.5),
            # 全大写喊话
            (re.compile(r"\b[A-Z]{20,}\b"), ViolationType.SPAM, 0.4),
        ]
        
        # URL 黑名单 (域名)
        self.url_blacklist: Set[str] = {
            "malware.com", "phishing.net", "scam-site.org",
            # 添加更多已知恶意域名
        }
        
        # 用户黑名单
        self.user_blacklist: Set[str] = set()
        
    def add_keyword(self, keyword: str, violation_type: ViolationType, high_risk: bool = True):
        """动态添加关键词"""
        target = self.high_risk_keywords if high_risk else self.medium_risk_keywords
        if violation_type not in target:
            target[violation_type] = set()
        target[violation_type].add(keyword.lower())
        
    def add_user_to_blacklist(self, user_id: str):
        """添加用户到黑名单"""
        self.user_blacklist.add(user_id)
        
    def remove_user_from_blacklist(self, user_id: str):
        """从黑名单移除用户"""
        self.user_blacklist.discard(user_id)
        
    def check(self, content: str, user_id: Optional[str] = None) -> SafetyResult:
        """
        规则引擎检测
        """
        content_lower = content.lower()
        matches: List[RuleMatch] = []
        max_severity = 0.0
        violations: List[ViolationType] = []
        
        # 1. 用户黑名单检查
        if user_id and user_id in self.user_blacklist:
            return SafetyResult(
                safe=False,
                level=SafetyLevel.BLOCKED,
                score=1.0,
                violations=[ViolationType.UNKNOWN],
                matched_rules=["user_blacklist"],
                reason="User is blacklisted"
            )
        
        # 2. 高危关键词检查
        for vtype, keywords in self.high_risk_keywords.items():
            for keyword in keywords:
                if keyword.lower() in content_lower:
                    matches.append(RuleMatch(
                        rule_id=f"high_{vtype.value}_{keyword}",
                        rule_name=f"High risk keyword: {keyword}",
                        violation_type=vtype,
                        severity=0.9,
                        matched_text=keyword
                    ))
                    if vtype not in violations:
                        violations.append(vtype)
                    max_severity = max(max_severity, 0.9)
                    
        # 3. 中危关键词检查
        for vtype, keywords in self.medium_risk_keywords.items():
            for keyword in keywords:
                if keyword.lower() in content_lower:
                    matches.append(RuleMatch(
                        rule_id=f"medium_{vtype.value}_{keyword}",
                        rule_name=f"Medium risk keyword: {keyword}",
                        violation_type=vtype,
                        severity=0.5,
                        matched_text=keyword
                    ))
                    if vtype not in violations:
                        violations.append(vtype)
                    max_severity = max(max_severity, 0.5)
                    
        # 4. 正则模式检查
        for pattern, vtype, severity in self.regex_patterns:
            if pattern.search(content):
                matches.append(RuleMatch(
                    rule_id=f"regex_{vtype.value}",
                    rule_name=f"Regex pattern: {vtype.value}",
                    violation_type=vtype,
                    severity=severity,
                    matched_text=pattern.pattern
                ))
                if vtype not in violations:
                    violations.append(vtype)
                max_severity = max(max_severity, severity)
                
        # 5. URL 检查
        urls = re.findall(r'https?://([^\s/]+)', content)
        for url in urls:
            domain = url.lower().split('/')[0]
            if domain in self.url_blacklist:
                matches.append(RuleMatch(
                    rule_id=f"url_blacklist_{domain}",
                    rule_name=f"Blacklisted URL: {domain}",
                    violation_type=ViolationType.SCAM,
                    severity=0.95,
                    matched_text=domain
                ))
                violations.append(ViolationType.SCAM)
                max_severity = max(max_severity, 0.95)
                
        # 6. 判定结果
        if max_severity >= 0.9:
            level = SafetyLevel.HIGH_RISK
            safe = False
        elif max_severity >= 0.5:
            level = SafetyLevel.MEDIUM_RISK
            safe = False
        elif max_severity > 0:
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
            requires_review=(level == SafetyLevel.MEDIUM_RISK)
        )


# ========== ML 分类器接口 ==========

class SafetyMLClassifier:
    """
    ML 安全分类器 - 第二层安全检测
    使用预训练模型进行多标签分类
    """
    
    def __init__(self, model_path: Optional[str] = None):
        self.model = None
        self.tokenizer = None
        self.labels = [
            "spam", "nsfw", "violence", "hate_speech", 
            "harassment", "misinformation", "safe"
        ]
        
        if model_path:
            self._load_model(model_path)
            
    def _load_model(self, model_path: str):
        """加载模型 (使用 transformers)"""
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(model_path)
            self.model = AutoModelForSequenceClassification.from_pretrained(model_path)
            print(f"✅ Safety ML model loaded from {model_path}")
        except Exception as e:
            print(f"⚠️ Failed to load safety model: {e}")
            
    def predict(self, content: str) -> Dict[str, float]:
        """
        预测内容安全分数
        返回各类别的概率
        """
        if self.model is None:
            # 返回默认安全分数 (模型未加载时)
            return {label: 0.0 for label in self.labels[:-1]} | {"safe": 1.0}
            
        try:
            import torch
            
            inputs = self.tokenizer(
                content, 
                return_tensors="pt", 
                truncation=True, 
                max_length=512
            )
            
            with torch.no_grad():
                outputs = self.model(**inputs)
                probs = torch.sigmoid(outputs.logits).squeeze().tolist()
                
            return dict(zip(self.labels, probs))
        except Exception as e:
            print(f"⚠️ ML prediction failed: {e}")
            return {label: 0.0 for label in self.labels[:-1]} | {"safe": 1.0}
            
    def check(self, content: str, thresholds: Optional[Dict[str, float]] = None) -> SafetyResult:
        """
        使用 ML 模型检测
        """
        default_thresholds = {
            "spam": 0.7,
            "nsfw": 0.8,
            "violence": 0.8,
            "hate_speech": 0.7,
            "harassment": 0.6,
            "misinformation": 0.7,
        }
        thresholds = thresholds or default_thresholds
        
        scores = self.predict(content)
        violations: List[ViolationType] = []
        max_score = 0.0
        
        label_to_violation = {
            "spam": ViolationType.SPAM,
            "nsfw": ViolationType.NSFW,
            "violence": ViolationType.VIOLENCE,
            "hate_speech": ViolationType.HATE_SPEECH,
            "harassment": ViolationType.HARASSMENT,
            "misinformation": ViolationType.MISINFORMATION,
        }
        
        for label, score in scores.items():
            if label in thresholds and score >= thresholds[label]:
                violations.append(label_to_violation.get(label, ViolationType.UNKNOWN))
                max_score = max(max_score, score)
                
        if max_score >= 0.8:
            level = SafetyLevel.HIGH_RISK
        elif max_score >= 0.5:
            level = SafetyLevel.MEDIUM_RISK
        elif max_score >= 0.3:
            level = SafetyLevel.LOW_RISK
        else:
            level = SafetyLevel.SAFE
            
        return SafetyResult(
            safe=(level in [SafetyLevel.SAFE, SafetyLevel.LOW_RISK]),
            level=level,
            score=max_score,
            violations=violations,
            ml_scores=scores,
            requires_review=(level == SafetyLevel.MEDIUM_RISK)
        )


# ========== 综合安全检测服务 ==========

class ContentSafetyService:
    """
    综合内容安全服务
    整合规则引擎 + ML 分类器
    """
    
    def __init__(
        self,
        ml_model_path: Optional[str] = None,
        enable_ml: bool = True
    ):
        self.rule_engine = SafetyRuleEngine()
        self.ml_classifier = SafetyMLClassifier(ml_model_path) if enable_ml else None
        self.enable_ml = enable_ml
        
    def check(
        self,
        content: str,
        user_id: Optional[str] = None,
        skip_ml: bool = False
    ) -> SafetyResult:
        """
        综合安全检测
        1. 规则引擎检测 (快速)
        2. ML 分类器检测 (规则引擎为中/低风险时)
        """
        # Layer 1: 规则引擎
        rule_result = self.rule_engine.check(content, user_id)
        
        # 高风险直接返回
        if rule_result.level == SafetyLevel.HIGH_RISK:
            return rule_result
            
        # 已拦截直接返回
        if rule_result.level == SafetyLevel.BLOCKED:
            return rule_result
            
        # Layer 2: ML 分类器 (可选)
        if self.enable_ml and self.ml_classifier and not skip_ml:
            if rule_result.level in [SafetyLevel.MEDIUM_RISK, SafetyLevel.LOW_RISK, SafetyLevel.SAFE]:
                ml_result = self.ml_classifier.check(content)
                
                # 合并结果 (取更严格的)
                if ml_result.score > rule_result.score:
                    return SafetyResult(
                        safe=ml_result.safe,
                        level=ml_result.level,
                        score=ml_result.score,
                        violations=list(set(rule_result.violations + ml_result.violations)),
                        matched_rules=rule_result.matched_rules,
                        ml_scores=ml_result.ml_scores,
                        reason=ml_result.reason or rule_result.reason,
                        requires_review=ml_result.requires_review or rule_result.requires_review
                    )
                    
        return rule_result
        
    def check_batch(
        self,
        items: List[Dict[str, str]]
    ) -> List[SafetyResult]:
        """
        批量检测
        items: [{"post_id": "xxx", "content": "...", "user_id": "..."}]
        """
        return [
            self.check(
                item.get("content", ""),
                item.get("user_id")
            )
            for item in items
        ]


# ========== 单例导出 ==========

_safety_service: Optional[ContentSafetyService] = None

def get_safety_service() -> ContentSafetyService:
    global _safety_service
    if _safety_service is None:
        _safety_service = ContentSafetyService(
            ml_model_path=None,  # TODO: 配置模型路径
            enable_ml=False  # 默认禁用 ML (需要先训练模型)
        )
    return _safety_service
