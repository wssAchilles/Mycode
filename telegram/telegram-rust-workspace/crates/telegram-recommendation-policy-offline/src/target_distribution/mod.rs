mod build;
mod stream_io;
mod verify;

pub use build::{
    BuiltTargetDistribution, build_target_distribution_from_reader,
    build_target_distribution_stream, build_target_distribution_to_writer,
};
pub use verify::{
    target_distribution_stream_verifier_build_fingerprint_sha256,
    verify_target_distribution_from_readers, verify_target_distribution_stream,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetDistributionError {
    ResourceLimitExceeded,
    InvalidSource,
    InvalidConfig,
    InvalidManifest,
    SupportIncomplete,
    CandidatePoolTruncated,
    CandidateCountMismatch,
    DuplicateCandidateIdentity,
    EligibleCandidateLogitMissing,
    LoggedActionNotEligible,
    PrefixDrift,
    NumericalFailure,
    GrammarViolation,
    DigestMismatch,
    CountMismatch,
    RecalculationMismatch,
    InputReadFailed,
    OutputWriteFailed,
}

impl TargetDistributionError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ResourceLimitExceeded => "resource_limit_exceeded",
            Self::InvalidSource => "invalid_source",
            Self::InvalidConfig => "invalid_config",
            Self::InvalidManifest => "invalid_manifest",
            Self::SupportIncomplete => "support_incomplete",
            Self::CandidatePoolTruncated => "candidate_pool_truncated",
            Self::CandidateCountMismatch => "candidate_count_mismatch",
            Self::DuplicateCandidateIdentity => "duplicate_candidate_identity",
            Self::EligibleCandidateLogitMissing => "eligible_candidate_logit_missing",
            Self::LoggedActionNotEligible => "logged_action_not_eligible",
            Self::PrefixDrift => "prefix_drift",
            Self::NumericalFailure => "numerical_failure",
            Self::GrammarViolation => "grammar_violation",
            Self::DigestMismatch => "digest_mismatch",
            Self::CountMismatch => "count_mismatch",
            Self::RecalculationMismatch => "recalculation_mismatch",
            Self::InputReadFailed => "input_read_failed",
            Self::OutputWriteFailed => "output_write_failed",
        }
    }
}
