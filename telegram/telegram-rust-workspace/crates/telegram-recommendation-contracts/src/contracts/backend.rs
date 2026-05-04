use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessEnvelope<T> {
    pub success: bool,
    pub data: T,
}
