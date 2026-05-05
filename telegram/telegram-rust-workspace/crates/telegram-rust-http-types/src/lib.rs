use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderResponse<T> {
    pub payload: T,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessEnvelope<T> {
    pub success: bool,
    pub data: T,
}

impl<T> SuccessEnvelope<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data,
        }
    }

    pub fn into_success_data(self) -> Result<T, UnsuccessfulEnvelope> {
        if self.success {
            Ok(self.data)
        } else {
            Err(UnsuccessfulEnvelope)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnsuccessfulEnvelope;

impl fmt::Display for UnsuccessfulEnvelope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("success envelope reported success=false")
    }
}

impl Error for UnsuccessfulEnvelope {}

#[derive(Debug)]
pub enum SuccessEnvelopeDecodeError {
    Decode(serde_json::Error),
    Unsuccessful(UnsuccessfulEnvelope),
}

impl fmt::Display for SuccessEnvelopeDecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Decode(error) => write!(formatter, "decode success envelope: {error}"),
            Self::Unsuccessful(error) => error.fmt(formatter),
        }
    }
}

impl Error for SuccessEnvelopeDecodeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Decode(error) => Some(error),
            Self::Unsuccessful(error) => Some(error),
        }
    }
}

pub fn decode_success_envelope<T>(body: &str) -> Result<T, SuccessEnvelopeDecodeError>
where
    T: DeserializeOwned,
{
    let envelope: SuccessEnvelope<T> =
        serde_json::from_str(body).map_err(SuccessEnvelopeDecodeError::Decode)?;
    envelope
        .into_success_data()
        .map_err(SuccessEnvelopeDecodeError::Unsuccessful)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::{SuccessEnvelope, SuccessEnvelopeDecodeError, decode_success_envelope};

    #[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
    struct TestPayload {
        value: String,
    }

    #[test]
    fn builds_success_envelope() {
        let envelope = SuccessEnvelope::ok(TestPayload {
            value: "ok".to_string(),
        });

        assert!(envelope.success);
        assert_eq!(envelope.data.value, "ok");
    }

    #[test]
    fn preserves_provider_response_payload_and_latency() {
        let response = super::ProviderResponse {
            payload: TestPayload {
                value: "ok".to_string(),
            },
            latency_ms: 12,
        };

        assert_eq!(response.payload.value, "ok");
        assert_eq!(response.latency_ms, 12);
    }

    #[test]
    fn parses_success_envelope_payload() {
        let envelope: SuccessEnvelope<TestPayload> =
            serde_json::from_str(r#"{"success":true,"data":{"value":"ok"}}"#)
                .expect("parse success envelope");

        assert!(envelope.success);
        assert_eq!(envelope.data.value, "ok");
    }

    #[test]
    fn decodes_success_envelope_payload() {
        let payload: TestPayload =
            decode_success_envelope(r#"{"success":true,"data":{"value":"ok"}}"#)
                .expect("decode success envelope");

        assert_eq!(payload.value, "ok");
    }

    #[test]
    fn rejects_unsuccessful_envelope() {
        let error =
            decode_success_envelope::<TestPayload>(r#"{"success":false,"data":{"value":"ok"}}"#)
                .expect_err("reject unsuccessful envelope");

        assert!(matches!(error, SuccessEnvelopeDecodeError::Unsuccessful(_)));
    }

    #[test]
    fn surfaces_decode_error() {
        let error = decode_success_envelope::<TestPayload>(r#"{"success":true}"#)
            .expect_err("missing data should fail decode");

        assert!(matches!(error, SuccessEnvelopeDecodeError::Decode(_)));
    }
}
