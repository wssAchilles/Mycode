use std::error::Error;
use std::fmt::{Display, Formatter};

// ponytail: fixed 1 MiB ceiling; raise only with measured contract evidence.
pub(crate) const MAX_RESPONSE_BODY_BYTES: usize = 1_048_576;
const MAX_ERROR_BODY_CHARS: usize = 4_096;

#[derive(Debug)]
pub(crate) enum ResponseBodyError {
    Read(reqwest::Error),
    TooLarge {
        limit: usize,
        declared_length: Option<u64>,
    },
}

impl ResponseBodyError {
    pub(crate) fn is_timeout(&self) -> bool {
        matches!(self, Self::Read(error) if error.is_timeout())
    }
}

impl Display for ResponseBodyError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Read(error) => write!(formatter, "read response body: {error}"),
            Self::TooLarge {
                limit,
                declared_length: Some(declared_length),
            } => write!(
                formatter,
                "response body exceeds {limit} byte limit (content-length={declared_length})"
            ),
            Self::TooLarge {
                limit,
                declared_length: None,
            } => write!(formatter, "response body exceeds {limit} byte limit"),
        }
    }
}

impl Error for ResponseBodyError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Read(error) => Some(error),
            Self::TooLarge { .. } => None,
        }
    }
}

pub(crate) async fn read_response_body_bounded(
    mut response: reqwest::Response,
) -> Result<String, ResponseBodyError> {
    let declared_length = response.content_length();
    if declared_length.is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64) {
        return Err(ResponseBodyError::TooLarge {
            limit: MAX_RESPONSE_BODY_BYTES,
            declared_length,
        });
    }

    let mut body = Vec::with_capacity(
        declared_length
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or_default()
            .min(MAX_RESPONSE_BODY_BYTES),
    );
    while let Some(chunk) = response.chunk().await.map_err(ResponseBodyError::Read)? {
        if chunk.len() > MAX_RESPONSE_BODY_BYTES.saturating_sub(body.len()) {
            return Err(ResponseBodyError::TooLarge {
                limit: MAX_RESPONSE_BODY_BYTES,
                declared_length,
            });
        }
        body.extend_from_slice(&chunk);
    }

    Ok(String::from_utf8_lossy(&body).into_owned())
}

pub(crate) fn error_body_preview(body: &str) -> String {
    let mut chars = body.chars();
    let preview: String = chars.by_ref().take(MAX_ERROR_BODY_CHARS).collect();
    if chars.next().is_some() {
        format!("{preview}...[truncated]")
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::{
        MAX_RESPONSE_BODY_BYTES, ResponseBodyError, error_body_preview, read_response_body_bounded,
    };

    async fn spawn_response_server(
        body: Vec<u8>,
        chunked: bool,
        declared_length: Option<u64>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept test request");
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await;

            let headers = if chunked {
                "transfer-encoding: chunked\r\n"
            } else {
                ""
            };
            let content_length = declared_length
                .map(|length| format!("content-length: {length}\r\n"))
                .unwrap_or_default();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n{headers}{content_length}connection: close\r\n\r\n"
            );
            let _ = stream.write_all(response.as_bytes()).await;
            if chunked {
                let chunk_header = format!("{:X}\r\n", body.len());
                let _ = stream.write_all(chunk_header.as_bytes()).await;
                let _ = stream.write_all(&body).await;
                let _ = stream.write_all(b"\r\n0\r\n\r\n").await;
            } else {
                let _ = stream.write_all(&body).await;
            }
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn accepts_body_at_limit() {
        let base_url = spawn_response_server(b"ok".to_vec(), false, Some(2)).await;
        let response = reqwest::Client::new()
            .get(base_url)
            .send()
            .await
            .expect("response");

        assert_eq!(
            read_response_body_bounded(response).await.expect("body"),
            "ok"
        );
    }

    #[tokio::test]
    async fn rejects_declared_body_before_reading_it() {
        let base_url = spawn_response_server(
            Vec::new(),
            false,
            Some((MAX_RESPONSE_BODY_BYTES + 1) as u64),
        )
        .await;
        let response = reqwest::Client::new()
            .get(base_url)
            .send()
            .await
            .expect("response headers");

        let error = read_response_body_bounded(response)
            .await
            .expect_err("declared oversized body");
        assert!(matches!(
            error,
            ResponseBodyError::TooLarge {
                declared_length: Some(length),
                ..
            } if length == (MAX_RESPONSE_BODY_BYTES + 1) as u64
        ));
    }

    #[tokio::test]
    async fn rejects_chunked_body_after_reaching_limit() {
        let base_url =
            spawn_response_server(vec![b'x'; MAX_RESPONSE_BODY_BYTES + 1], true, None).await;
        let response = reqwest::Client::new()
            .get(base_url)
            .send()
            .await
            .expect("response");

        let error = read_response_body_bounded(response)
            .await
            .expect_err("chunked oversized body");
        assert!(matches!(
            error,
            ResponseBodyError::TooLarge {
                declared_length: None,
                ..
            }
        ));
    }

    #[test]
    fn truncates_error_body_preview() {
        let body = "x".repeat(5_000);
        let preview = error_body_preview(&body);

        assert_eq!(preview.len(), 4_096 + "...[truncated]".len());
        assert!(preview.ends_with("...[truncated]"));
    }
}
