use std::io::{BufRead, Read};

use sha2::{Digest, Sha256};
use telegram_recommendation_contracts::{
    MAX_TARGET_DISTRIBUTION_FILE_BYTES, MAX_TARGET_DISTRIBUTION_LINE_BYTES,
    MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS,
};

use super::TargetDistributionError;

pub(crate) struct BoundedNdjsonReader<R> {
    reader: R,
    raw_hasher: Sha256,
    byte_len: u64,
    line_count: u64,
    max_line_bytes: u64,
}

impl<R: BufRead> BoundedNdjsonReader<R> {
    pub(crate) fn new(reader: R) -> Self {
        Self {
            reader,
            raw_hasher: Sha256::new(),
            byte_len: 0,
            line_count: 0,
            max_line_bytes: 0,
        }
    }

    pub(crate) fn read_line(
        &mut self,
        malformed: TargetDistributionError,
    ) -> Result<Option<Vec<u8>>, TargetDistributionError> {
        let mut line = Vec::new();
        let bytes_read = (&mut self.reader)
            .take(MAX_TARGET_DISTRIBUTION_LINE_BYTES + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| TargetDistributionError::InputReadFailed)?;
        if bytes_read == 0 {
            return Ok(None);
        }
        let line_bytes = u64::try_from(bytes_read)
            .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?;
        if line_bytes > MAX_TARGET_DISTRIBUTION_LINE_BYTES {
            return Err(TargetDistributionError::ResourceLimitExceeded);
        }
        if line.last() != Some(&b'\n') || line.len() == 1 {
            return Err(malformed);
        }
        self.byte_len = self
            .byte_len
            .checked_add(line_bytes)
            .filter(|bytes| *bytes <= MAX_TARGET_DISTRIBUTION_FILE_BYTES)
            .ok_or(TargetDistributionError::ResourceLimitExceeded)?;
        self.line_count = self
            .line_count
            .checked_add(1)
            .filter(|count| *count <= MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS)
            .ok_or(TargetDistributionError::ResourceLimitExceeded)?;
        self.max_line_bytes = self.max_line_bytes.max(line_bytes);
        self.raw_hasher.update(&line);
        line.pop();
        Ok(Some(line))
    }

    pub(crate) fn byte_len(&self) -> u64 {
        self.byte_len
    }

    pub(crate) fn line_count(&self) -> u64 {
        self.line_count
    }

    pub(crate) fn max_line_bytes(&self) -> u64 {
        self.max_line_bytes
    }

    pub(crate) fn sha256_hex(&self) -> String {
        format!("{:x}", self.raw_hasher.clone().finalize())
    }
}
