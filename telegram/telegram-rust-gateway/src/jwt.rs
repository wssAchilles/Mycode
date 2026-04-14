use axum::http::HeaderMap;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct JwtPrevalidator {
    decoding_key: DecodingKey,
    validation: Validation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessTokenClaims {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub username: String,
    pub aud: Option<String>,
    pub iss: Option<String>,
    pub exp: usize,
    pub iat: Option<usize>,
    pub jti: Option<String>,
}

#[derive(Debug, Error)]
pub enum JwtValidationError {
    #[error("authorization header malformed")]
    Malformed,
    #[error("token verification failed")]
    Invalid,
}

impl JwtPrevalidator {
    pub fn new(secret: &str) -> Self {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&["telegram-clone-users"]);
        validation.set_issuer(&["telegram-clone"]);
        Self {
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            validation,
        }
    }

    pub fn maybe_validate_bearer(
        &self,
        headers: &HeaderMap,
    ) -> Result<Option<AccessTokenClaims>, JwtValidationError> {
        let Some(raw) = headers.get(http::header::AUTHORIZATION) else {
            return Ok(None);
        };
        let value = raw.to_str().map_err(|_| JwtValidationError::Malformed)?;
        let token = value
            .strip_prefix("Bearer ")
            .or_else(|| value.strip_prefix("bearer "))
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .ok_or(JwtValidationError::Malformed)?;

        let decoded = decode::<AccessTokenClaims>(token, &self.decoding_key, &self.validation)
            .map_err(|_| JwtValidationError::Invalid)?;
        Ok(Some(decoded.claims))
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};
    use jsonwebtoken::{EncodingKey, Header, encode};

    use super::*;

    #[test]
    fn validates_existing_access_token() {
        let claims = AccessTokenClaims {
            user_id: "u_1".to_string(),
            username: "alice".to_string(),
            aud: Some("telegram-clone-users".to_string()),
            iss: Some("telegram-clone".to_string()),
            exp: usize::MAX / 2,
            iat: None,
            jti: None,
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret("0123456789abcdef0123456789abcdef".as_bytes()),
        )
        .expect("token");

        let validator = JwtPrevalidator::new("0123456789abcdef0123456789abcdef");
        let mut headers = HeaderMap::new();
        headers.insert(
            http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).expect("header"),
        );

        let validated = validator.maybe_validate_bearer(&headers).expect("valid");

        assert_eq!(validated.expect("claims").user_id, "u_1");
    }
}
