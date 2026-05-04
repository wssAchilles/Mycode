use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessEnvelope<T> {
    pub success: bool,
    pub data: T,
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::SuccessEnvelope;

    #[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
    struct TestPayload {
        value: String,
    }

    #[test]
    fn parses_success_envelope_payload() {
        let envelope: SuccessEnvelope<TestPayload> =
            serde_json::from_str(r#"{"success":true,"data":{"value":"ok"}}"#)
                .expect("parse success envelope");

        assert!(envelope.success);
        assert_eq!(envelope.data.value, "ok");
    }
}
