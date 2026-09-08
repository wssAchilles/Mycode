use std::cmp::Ordering;
use std::collections::HashSet;

const CURSOR_VERSION: u8 = 2;
const MAX_CANDIDATES: usize = 16;
const MAX_PAGE_SIZE: usize = 8;
const MAX_PAGES: usize = MAX_CANDIDATES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CursorMode {
    InNetwork,
    General,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Candidate {
    id: &'static str,
    author_id: &'static str,
    created_at_ms: i64,
    score: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CursorKey {
    InNetwork {
        created_at_ms: i64,
        post_id: &'static str,
        author_id: &'static str,
    },
    General {
        score: i64,
        created_at_ms: i64,
        post_id: &'static str,
        author_id: &'static str,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Cursor {
    version: u8,
    ordering_fingerprint: u64,
    mode: CursorMode,
    key: CursorKey,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CursorError {
    ResourceLimitExceeded,
    InputContractInvalid,
    NotEvaluable,
}

#[derive(Debug, PartialEq, Eq)]
struct Page {
    ids: Vec<&'static str>,
    next_cursor: Option<Cursor>,
    has_more: bool,
}

fn compare_desc<T: Ord>(left: &T, right: &T) -> Ordering {
    right.cmp(left)
}

fn compare_candidates(left: &Candidate, right: &Candidate, mode: CursorMode) -> Ordering {
    match mode {
        CursorMode::InNetwork => compare_desc(&left.created_at_ms, &right.created_at_ms)
            .then_with(|| compare_desc(&left.id, &right.id))
            .then_with(|| compare_desc(&left.author_id, &right.author_id)),
        CursorMode::General => compare_desc(&left.score, &right.score)
            .then_with(|| compare_desc(&left.created_at_ms, &right.created_at_ms))
            .then_with(|| compare_desc(&left.id, &right.id))
            .then_with(|| compare_desc(&left.author_id, &right.author_id)),
    }
}

fn cursor_key(candidate: &Candidate, mode: CursorMode) -> CursorKey {
    match mode {
        CursorMode::InNetwork => CursorKey::InNetwork {
            created_at_ms: candidate.created_at_ms,
            post_id: candidate.id,
            author_id: candidate.author_id,
        },
        CursorMode::General => CursorKey::General {
            score: candidate.score,
            created_at_ms: candidate.created_at_ms,
            post_id: candidate.id,
            author_id: candidate.author_id,
        },
    }
}

fn compare_candidate_to_cursor_key(candidate: &Candidate, key: CursorKey) -> Ordering {
    match key {
        CursorKey::InNetwork {
            created_at_ms,
            post_id,
            author_id,
        } => compare_desc(&candidate.created_at_ms, &created_at_ms)
            .then_with(|| compare_desc(&candidate.id, &post_id))
            .then_with(|| compare_desc(&candidate.author_id, &author_id)),
        CursorKey::General {
            score,
            created_at_ms,
            post_id,
            author_id,
        } => compare_desc(&candidate.score, &score)
            .then_with(|| compare_desc(&candidate.created_at_ms, &created_at_ms))
            .then_with(|| compare_desc(&candidate.id, &post_id))
            .then_with(|| compare_desc(&candidate.author_id, &author_id)),
    }
}

fn mix_bytes(state: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *state ^= u64::from(*byte);
        *state = state.wrapping_mul(1_099_511_628_211);
    }
}

fn ordering_fingerprint(candidates: &[Candidate], mode: CursorMode) -> u64 {
    let mut ordered = candidates.to_vec();
    ordered.sort_by(|left, right| compare_candidates(left, right, mode));
    let mut fingerprint = 14_695_981_039_346_656_037_u64;
    mix_bytes(
        &mut fingerprint,
        &[match mode {
            CursorMode::InNetwork => 0,
            CursorMode::General => 1,
        }],
    );
    for candidate in ordered {
        mix_bytes(&mut fingerprint, candidate.id.as_bytes());
        mix_bytes(&mut fingerprint, candidate.author_id.as_bytes());
        mix_bytes(&mut fingerprint, &candidate.created_at_ms.to_le_bytes());
        mix_bytes(&mut fingerprint, &candidate.score.to_le_bytes());
    }
    fingerprint
}

fn validate_input(candidates: &[Candidate], page_size: usize) -> Result<(), CursorError> {
    if candidates.len() > MAX_CANDIDATES || !(1..=MAX_PAGE_SIZE).contains(&page_size) {
        return Err(CursorError::ResourceLimitExceeded);
    }
    let mut ids = HashSet::with_capacity(candidates.len());
    if candidates
        .iter()
        .any(|candidate| candidate.id.is_empty() || !ids.insert(candidate.id))
    {
        return Err(CursorError::InputContractInvalid);
    }
    Ok(())
}

fn page_frozen(
    candidates: &[Candidate],
    mode: CursorMode,
    page_size: usize,
    cursor: Option<Cursor>,
) -> Result<Page, CursorError> {
    validate_input(candidates, page_size)?;
    let fingerprint = ordering_fingerprint(candidates, mode);
    if let Some(cursor) = cursor
        && (cursor.version != CURSOR_VERSION
            || cursor.mode != mode
            || cursor.ordering_fingerprint != fingerprint)
    {
        return Err(CursorError::NotEvaluable);
    }

    let mut ordered = candidates.to_vec();
    ordered.sort_by(|left, right| compare_candidates(left, right, mode));
    let eligible = ordered
        .iter()
        .filter(|candidate| {
            cursor
                .map(|cursor| {
                    compare_candidate_to_cursor_key(candidate, cursor.key) == Ordering::Greater
                })
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    let page_len = eligible.len().min(page_size);
    let ids = eligible[..page_len]
        .iter()
        .map(|candidate| candidate.id)
        .collect::<Vec<_>>();
    let has_more = eligible.len() > page_len;
    let next_cursor = has_more.then(|| Cursor {
        version: CURSOR_VERSION,
        ordering_fingerprint: fingerprint,
        mode,
        key: cursor_key(eligible[page_len - 1], mode),
    });
    Ok(Page {
        ids,
        next_cursor,
        has_more,
    })
}

fn collect_pages(
    candidates: &[Candidate],
    mode: CursorMode,
    page_size: usize,
) -> Result<Vec<&'static str>, CursorError> {
    let mut cursor = None;
    let mut ids = Vec::new();
    for _ in 0..MAX_PAGES {
        let page = page_frozen(candidates, mode, page_size, cursor)?;
        ids.extend(page.ids);
        if !page.has_more {
            let mut unique_ids = HashSet::with_capacity(ids.len());
            if ids.iter().any(|id| !unique_ids.insert(*id)) {
                return Err(CursorError::InputContractInvalid);
            }
            return Ok(ids);
        }
        cursor = page.next_cursor;
    }
    Err(CursorError::ResourceLimitExceeded)
}

fn legacy_date_only_remaining(candidates: &[Candidate], page_size: usize) -> Vec<&'static str> {
    let mut ordered = candidates.to_vec();
    ordered.sort_by(|left, right| compare_candidates(left, right, CursorMode::InNetwork));
    let boundary = ordered[page_size - 1].created_at_ms;
    ordered
        .iter()
        .filter(|candidate| candidate.created_at_ms < boundary)
        .map(|candidate| candidate.id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        Candidate, CursorError, CursorMode, collect_pages, legacy_date_only_remaining, page_frozen,
    };

    const TIED_TIMESTAMP: i64 = 1_700_000_000_000;
    const IN_NETWORK_FIXTURE: [Candidate; 4] = [
        Candidate {
            id: "post-a",
            author_id: "author-1",
            created_at_ms: TIED_TIMESTAMP,
            score: 1,
        },
        Candidate {
            id: "post-c",
            author_id: "author-1",
            created_at_ms: TIED_TIMESTAMP,
            score: 1,
        },
        Candidate {
            id: "post-b",
            author_id: "author-2",
            created_at_ms: TIED_TIMESTAMP,
            score: 1,
        },
        Candidate {
            id: "post-d",
            author_id: "author-1",
            created_at_ms: TIED_TIMESTAMP + 1,
            score: 1,
        },
    ];

    #[test]
    fn frozen_in_network_cursor_covers_equal_timestamp_ties_without_duplicates() {
        let ids = collect_pages(&IN_NETWORK_FIXTURE, CursorMode::InNetwork, 2)
            .expect("frozen composite cursor should paginate");

        assert_eq!(ids, ["post-d", "post-c", "post-b", "post-a"]);
        assert_eq!(ids.len(), IN_NETWORK_FIXTURE.len());
    }

    #[test]
    fn legacy_date_only_boundary_proves_equal_timestamp_omission() {
        let remaining = legacy_date_only_remaining(&IN_NETWORK_FIXTURE, 2);
        let composite = collect_pages(&IN_NETWORK_FIXTURE, CursorMode::InNetwork, 2)
            .expect("composite cursor should expose the full frozen snapshot");

        assert!(remaining.is_empty());
        assert_eq!(&composite[2..], ["post-b", "post-a"]);
        assert_ne!(remaining, &composite[2..]);
    }

    #[test]
    fn general_score_mutation_is_not_evaluable_without_a_frozen_ordering_version() {
        let first = page_frozen(&IN_NETWORK_FIXTURE, CursorMode::General, 2, None)
            .expect("first page should be evaluable");
        let cursor = first
            .next_cursor
            .expect("first page should have a continuation");
        let mut mutated = IN_NETWORK_FIXTURE;
        mutated[0].score = 99;

        assert_eq!(
            page_frozen(&mutated, CursorMode::General, 2, Some(cursor)),
            Err(CursorError::NotEvaluable)
        );
    }

    #[test]
    fn cursor_rejects_candidate_universe_insert_or_delete_before_paging() {
        let first = page_frozen(&IN_NETWORK_FIXTURE, CursorMode::InNetwork, 2, None)
            .expect("first page should be evaluable");
        let cursor = first
            .next_cursor
            .expect("first page should have a continuation");

        let inserted = [
            IN_NETWORK_FIXTURE[0],
            IN_NETWORK_FIXTURE[1],
            IN_NETWORK_FIXTURE[2],
            IN_NETWORK_FIXTURE[3],
            Candidate {
                id: "post-inserted",
                author_id: "author-3",
                created_at_ms: TIED_TIMESTAMP - 1,
                score: 1,
            },
        ];
        assert_eq!(
            page_frozen(&inserted, CursorMode::InNetwork, 2, Some(cursor)),
            Err(CursorError::NotEvaluable)
        );

        let deleted = [
            IN_NETWORK_FIXTURE[0],
            IN_NETWORK_FIXTURE[1],
            IN_NETWORK_FIXTURE[2],
        ];
        assert_eq!(
            page_frozen(&deleted, CursorMode::InNetwork, 2, Some(cursor)),
            Err(CursorError::NotEvaluable)
        );
    }

    #[test]
    fn cursor_rejects_version_or_mode_drift_before_paging() {
        let first = page_frozen(&IN_NETWORK_FIXTURE, CursorMode::InNetwork, 2, None)
            .expect("first page should be evaluable");
        let cursor = first
            .next_cursor
            .expect("first page should have a continuation");

        let mut version_drift = cursor;
        version_drift.version = cursor.version.wrapping_add(1);
        assert_eq!(
            page_frozen(
                &IN_NETWORK_FIXTURE,
                CursorMode::InNetwork,
                2,
                Some(version_drift)
            ),
            Err(CursorError::NotEvaluable)
        );

        let mut mode_drift = cursor;
        mode_drift.mode = CursorMode::General;
        assert_eq!(
            page_frozen(
                &IN_NETWORK_FIXTURE,
                CursorMode::InNetwork,
                2,
                Some(mode_drift)
            ),
            Err(CursorError::NotEvaluable)
        );
    }

    #[test]
    fn fixture_rejects_unbounded_or_duplicate_inputs_before_paging() {
        let duplicate = [IN_NETWORK_FIXTURE[0], IN_NETWORK_FIXTURE[0]];
        assert_eq!(
            collect_pages(&duplicate, CursorMode::InNetwork, 0),
            Err(CursorError::ResourceLimitExceeded)
        );
        assert_eq!(
            collect_pages(&duplicate, CursorMode::InNetwork, 1),
            Err(CursorError::InputContractInvalid)
        );
    }
}
