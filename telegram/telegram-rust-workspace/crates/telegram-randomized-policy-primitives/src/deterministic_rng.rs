use chacha20::{
    ChaCha20,
    cipher::{KeyIvInit, StreamCipher},
};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};

const SEED_COMMITMENT_DOMAIN: &[u8] = b"telegram/randomized-logging/seed-commit/v1";
const HKDF_SALT_DOMAIN: &[u8] = b"telegram/randomized-logging/hkdf-salt/v1";
const DRAW_KEY_DOMAIN: &[u8] = b"telegram/randomized-slate/draw-key/v1";
pub const DETERMINISTIC_RNG_SUITE_V1: &str = "hkdf-sha256+rfc8439-chacha20+open53/v1";
pub const OPEN53_MAX_WORDS_PER_DRAW_V1: usize = 4;
pub const OPEN53_WORD_BYTES_V1: usize = 8;
const OPEN53_MASK: u64 = (1_u64 << 53) - 1;
const OPEN53_DENOMINATOR: f64 = 9_007_199_254_740_992.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeterministicRngError {
    EmptyEpochId,
    EmptyDecisionId,
    FrameTooLong,
    HkdfExpandFailed,
    StreamExhausted,
    OpenIntervalExhausted,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Open53Draw {
    pub start_byte_offset: u64,
    pub raw_words: Vec<u64>,
    pub accepted_unsigned_53: u64,
    pub uniform_draw: f64,
}

pub struct DeterministicOpen53Rng {
    cipher: ChaCha20,
    byte_offset: u64,
}

impl DeterministicOpen53Rng {
    pub fn from_seed_and_context(
        seed: &[u8; 32],
        epoch_id: &[u8],
        decision_id: &[u8],
        source_decision_sha256: &[u8; 32],
        candidate_pool_sha256: &[u8; 32],
        config_sha256: &[u8; 32],
    ) -> Result<Self, DeterministicRngError> {
        validate_context_ids(epoch_id, decision_id)?;
        let salt: [u8; 32] = Sha256::digest(length_framed_bytes(&[HKDF_SALT_DOMAIN])?).into();
        let hkdf = Hkdf::<Sha256>::new(Some(&salt), seed);
        let mut key = [0_u8; 32];
        let info = development_rng_info(
            epoch_id,
            decision_id,
            source_decision_sha256,
            candidate_pool_sha256,
            config_sha256,
        )?;
        hkdf.expand(&info, &mut key)
            .map_err(|_| DeterministicRngError::HkdfExpandFailed)?;
        let nonce = [0_u8; 12];

        Ok(Self {
            cipher: ChaCha20::new((&key).into(), (&nonce).into()),
            byte_offset: 0,
        })
    }

    pub fn byte_offset(&self) -> u64 {
        self.byte_offset
    }

    pub fn next_open53(&mut self) -> Result<Open53Draw, DeterministicRngError> {
        let start_byte_offset = self.byte_offset;
        let mut raw_words = Vec::with_capacity(OPEN53_MAX_WORDS_PER_DRAW_V1);

        for _ in 0..OPEN53_MAX_WORDS_PER_DRAW_V1 {
            let mut bytes = [0_u8; OPEN53_WORD_BYTES_V1];
            self.cipher
                .try_apply_keystream(&mut bytes)
                .map_err(|_| DeterministicRngError::StreamExhausted)?;
            self.byte_offset = self
                .byte_offset
                .checked_add(
                    u64::try_from(OPEN53_WORD_BYTES_V1)
                        .map_err(|_| DeterministicRngError::StreamExhausted)?,
                )
                .ok_or(DeterministicRngError::StreamExhausted)?;
            let raw_word = u64::from_le_bytes(bytes);
            raw_words.push(raw_word);
            let unsigned_53 = raw_word & OPEN53_MASK;
            if unsigned_53 != 0 {
                return Ok(Open53Draw {
                    start_byte_offset,
                    raw_words,
                    accepted_unsigned_53: unsigned_53,
                    uniform_draw: unsigned_53 as f64 / OPEN53_DENOMINATOR,
                });
            }
        }

        Err(DeterministicRngError::OpenIntervalExhausted)
    }
}

pub fn compute_development_seed_commitment_sha256_v1(
    epoch_id: &[u8],
    seed: &[u8; 32],
) -> Result<[u8; 32], DeterministicRngError> {
    if epoch_id.is_empty() {
        return Err(DeterministicRngError::EmptyEpochId);
    }
    length_framed_sha256(&[
        SEED_COMMITMENT_DOMAIN,
        DETERMINISTIC_RNG_SUITE_V1.as_bytes(),
        epoch_id,
        seed,
    ])
}

pub fn compute_development_rng_context_sha256_v1(
    epoch_id: &[u8],
    decision_id: &[u8],
    source_decision_sha256: &[u8; 32],
    candidate_pool_sha256: &[u8; 32],
    config_sha256: &[u8; 32],
) -> Result<[u8; 32], DeterministicRngError> {
    validate_context_ids(epoch_id, decision_id)?;
    Ok(Sha256::digest(development_rng_info(
        epoch_id,
        decision_id,
        source_decision_sha256,
        candidate_pool_sha256,
        config_sha256,
    )?)
    .into())
}

fn development_rng_info(
    epoch_id: &[u8],
    decision_id: &[u8],
    source_decision_sha256: &[u8; 32],
    candidate_pool_sha256: &[u8; 32],
    config_sha256: &[u8; 32],
) -> Result<Vec<u8>, DeterministicRngError> {
    length_framed_bytes(&[
        DRAW_KEY_DOMAIN,
        DETERMINISTIC_RNG_SUITE_V1.as_bytes(),
        epoch_id,
        decision_id,
        source_decision_sha256,
        candidate_pool_sha256,
        config_sha256,
    ])
}

fn validate_context_ids(epoch_id: &[u8], decision_id: &[u8]) -> Result<(), DeterministicRngError> {
    if epoch_id.is_empty() {
        return Err(DeterministicRngError::EmptyEpochId);
    }
    if decision_id.is_empty() {
        return Err(DeterministicRngError::EmptyDecisionId);
    }
    Ok(())
}

fn length_framed_sha256(frames: &[&[u8]]) -> Result<[u8; 32], DeterministicRngError> {
    let bytes = length_framed_bytes(frames)?;
    Ok(Sha256::digest(bytes).into())
}

fn length_framed_bytes(frames: &[&[u8]]) -> Result<Vec<u8>, DeterministicRngError> {
    let mut output = Vec::new();
    for frame in frames {
        append_frame(&mut output, frame)?;
    }
    Ok(output)
}

fn append_frame(output: &mut Vec<u8>, frame: &[u8]) -> Result<(), DeterministicRngError> {
    let length = u32::try_from(frame.len()).map_err(|_| DeterministicRngError::FrameTooLong)?;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(frame);
    Ok(())
}

#[cfg(test)]
mod tests {
    use chacha20::{
        ChaCha20,
        cipher::{KeyIvInit, StreamCipher, StreamCipherSeek},
    };
    use hkdf::Hkdf;
    use sha2::Sha256;

    use super::{
        DeterministicOpen53Rng, DeterministicRngError, OPEN53_DENOMINATOR, OPEN53_MASK,
        compute_development_rng_context_sha256_v1, compute_development_seed_commitment_sha256_v1,
    };

    #[test]
    fn hkdf_matches_rfc5869_test_case_one() {
        let ikm = [0x0b_u8; 22];
        let salt = hex("000102030405060708090a0b0c");
        let info = hex("f0f1f2f3f4f5f6f7f8f9");
        let mut output = [0_u8; 42];
        Hkdf::<Sha256>::new(Some(&salt), &ikm)
            .expand(&info, &mut output)
            .unwrap();

        assert_eq!(
            output.as_slice(),
            hex("3cb25f25faacd57a90434f64d0362f2a\
                 2d2d0a90cf1a5a4c5db02d56ecc4c5bf\
                 34007208d5b887185865")
        );
    }

    #[test]
    fn chacha20_matches_rfc8439_block_function_vector() {
        let key: [u8; 32] = std::array::from_fn(|index| u8::try_from(index).unwrap());
        let nonce: [u8; 12] = hex("000000090000004a00000000").try_into().unwrap();
        let mut block = [0_u8; 64];
        let mut cipher = ChaCha20::new((&key).into(), (&nonce).into());
        cipher.seek(64);
        cipher.apply_keystream(&mut block);

        assert_eq!(
            block.as_slice(),
            hex("10f1e7e4d13b5915500fdd1fa32071c4\
                 c7d1f4c733c068030422aa9ac3d46c4e\
                 d2826446079faa0914c2d705d98b02a2\
                 b5129cd1de164eb9cbd083e8a2503c4e")
        );
    }

    #[test]
    fn chacha20_ietf_stream_starts_at_counter_zero_with_zero_nonce() {
        let key = [0_u8; 32];
        let nonce = [0_u8; 12];
        let mut block = [0_u8; 64];
        let mut cipher = ChaCha20::new((&key).into(), (&nonce).into());
        cipher.apply_keystream(&mut block);

        assert_eq!(
            block.as_slice(),
            hex("76b8e0ada0f13d90405d6ae55386bd28\
                 bdd219b8a08ded1aa836efcc8b770dc7\
                 da41597c5157488d7724e03fb8d84a37\
                 6a43b8f41518a11cc387b669b2ee6586")
        );
    }

    #[test]
    fn open53_draws_are_replayable_open_and_domain_separated() {
        let seed = [7_u8; 32];
        let source = [1_u8; 32];
        let pool = [2_u8; 32];
        let config = [3_u8; 32];
        let epoch = b"development-epoch-a";
        let first_decision = b"decision-a";
        let second_decision = b"decision-b";
        let first_context = compute_development_rng_context_sha256_v1(
            epoch,
            first_decision,
            &source,
            &pool,
            &config,
        )
        .unwrap();
        let second_context = compute_development_rng_context_sha256_v1(
            epoch,
            second_decision,
            &source,
            &pool,
            &config,
        )
        .unwrap();
        let mut first = DeterministicOpen53Rng::from_seed_and_context(
            &seed,
            epoch,
            first_decision,
            &source,
            &pool,
            &config,
        )
        .unwrap();
        let mut replay = DeterministicOpen53Rng::from_seed_and_context(
            &seed,
            epoch,
            first_decision,
            &source,
            &pool,
            &config,
        )
        .unwrap();
        let mut separated = DeterministicOpen53Rng::from_seed_and_context(
            &seed,
            epoch,
            second_decision,
            &source,
            &pool,
            &config,
        )
        .unwrap();

        let first_draw = first.next_open53().unwrap();
        let replay_draw = replay.next_open53().unwrap();
        let separated_draw = separated.next_open53().unwrap();

        assert_eq!(first_draw, replay_draw);
        assert_ne!(first_draw.raw_words, separated_draw.raw_words);
        assert_ne!(first_context, second_context);
        assert!(first_draw.uniform_draw > 0.0 && first_draw.uniform_draw < 1.0);
        assert_eq!(first_draw.start_byte_offset, 0);
        assert_eq!(first.byte_offset(), 8);
        assert_eq!(
            first_draw.uniform_draw,
            first_draw.accepted_unsigned_53 as f64 / OPEN53_DENOMINATOR
        );
        assert_eq!(
            first_draw.accepted_unsigned_53,
            first_draw.raw_words[0] & OPEN53_MASK
        );
    }

    #[test]
    fn open53_replay_crosses_chacha_block_boundary() {
        let seed = [17_u8; 32];
        let source = [4_u8; 32];
        let pool = [5_u8; 32];
        let config = [6_u8; 32];
        let epoch = b"development-epoch-block-boundary";
        let decision = b"decision-block-boundary";
        let mut first = DeterministicOpen53Rng::from_seed_and_context(
            &seed, epoch, decision, &source, &pool, &config,
        )
        .unwrap();
        let mut replay = DeterministicOpen53Rng::from_seed_and_context(
            &seed, epoch, decision, &source, &pool, &config,
        )
        .unwrap();

        let first_draws = (0..9)
            .map(|_| first.next_open53().unwrap())
            .collect::<Vec<_>>();
        let replay_draws = (0..9)
            .map(|_| replay.next_open53().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(first_draws, replay_draws);
        assert!(first_draws[8].start_byte_offset >= 64);
        assert!(
            first_draws
                .iter()
                .all(|draw| draw.uniform_draw > 0.0 && draw.uniform_draw < 1.0)
        );
        assert!(first.byte_offset() >= 72);
        assert_eq!(first.byte_offset(), replay.byte_offset());
    }

    #[test]
    fn commitment_and_context_are_length_framed_and_fail_closed() {
        let seed = [9_u8; 32];
        let commitment = compute_development_seed_commitment_sha256_v1(b"epoch", &seed).unwrap();
        assert_eq!(
            commitment.as_slice(),
            hex("58a91a434d90d922885442db0145c4e526a8653fadc64ef1a3997197882c6e3c")
        );
        assert_ne!(
            commitment,
            compute_development_seed_commitment_sha256_v1(b"epoch-2", &seed).unwrap()
        );
        assert_eq!(
            compute_development_seed_commitment_sha256_v1(b"", &seed),
            Err(DeterministicRngError::EmptyEpochId)
        );
        assert_eq!(
            compute_development_rng_context_sha256_v1(
                b"",
                b"decision",
                &[1_u8; 32],
                &[2_u8; 32],
                &[3_u8; 32],
            ),
            Err(DeterministicRngError::EmptyEpochId)
        );
        assert_eq!(
            compute_development_rng_context_sha256_v1(
                b"epoch",
                b"",
                &[1_u8; 32],
                &[2_u8; 32],
                &[3_u8; 32],
            ),
            Err(DeterministicRngError::EmptyDecisionId)
        );
    }

    fn hex(value: &str) -> Vec<u8> {
        let compact = value
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        compact
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let high = (pair[0] as char).to_digit(16).unwrap();
                let low = (pair[1] as char).to_digit(16).unwrap();
                u8::try_from((high << 4) | low).unwrap()
            })
            .collect()
    }
}
