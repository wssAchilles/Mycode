use super::{
    QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT, QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT,
    QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct QualityGuardInput {
    pub is_nsfw: bool,
    pub content_len: usize,
    pub has_media: bool,
    pub has_news_payload: bool,
}

pub fn quality_guard_drop_reason(input: QualityGuardInput) -> Option<&'static str> {
    if input.is_nsfw {
        return Some(QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT);
    }
    if input.content_len == 0 && !input.has_media && !input.has_news_payload {
        return Some(QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT);
    }
    if input.content_len <= 2 && !input.has_media && !input.has_news_payload {
        return Some(QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT, QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT,
        QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT, QualityGuardInput, quality_guard_drop_reason,
    };

    #[test]
    fn quality_guard_decision_is_pure_and_reasoned() {
        assert_eq!(
            quality_guard_drop_reason(QualityGuardInput {
                is_nsfw: true,
                ..QualityGuardInput::default()
            }),
            Some(QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT)
        );
        assert_eq!(
            quality_guard_drop_reason(QualityGuardInput::default()),
            Some(QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT)
        );
        assert_eq!(
            quality_guard_drop_reason(QualityGuardInput {
                content_len: 2,
                ..QualityGuardInput::default()
            }),
            Some(QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT)
        );
        assert_eq!(
            quality_guard_drop_reason(QualityGuardInput {
                content_len: 0,
                has_media: true,
                ..QualityGuardInput::default()
            }),
            None
        );
    }
}
