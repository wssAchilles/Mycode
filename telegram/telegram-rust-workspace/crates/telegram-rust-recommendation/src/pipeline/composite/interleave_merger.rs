use crate::contracts::RecommendationCandidatePayload;

use super::traits::{CandidateGroup, CandidateMerger};

/// Round-robin interleave merger that balances content types.
///
/// Picks candidates from each source group in round-robin order,
/// ensuring no single source dominates the feed.
///
/// This is the default merger, modeled after X's `BlenderSelector`
/// which interleaves posts, ads, and WTF results.
pub struct InterleaveMerger;

impl CandidateMerger for InterleaveMerger {
    fn merge(
        &self,
        groups: Vec<CandidateGroup>,
        max_size: usize,
    ) -> Vec<RecommendationCandidatePayload> {
        let mut iterators: Vec<_> = groups
            .into_iter()
            .map(|group| group.candidates.into_iter())
            .collect();

        let mut merged = Vec::with_capacity(max_size);
        loop {
            let mut any_advanced = false;
            for iter in &mut iterators {
                if let Some(candidate) = iter.next() {
                    merged.push(candidate);
                    any_advanced = true;
                    if merged.len() >= max_size {
                        return merged;
                    }
                }
            }
            if !any_advanced {
                break;
            }
        }
        merged
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_helpers::make_test_candidate;

    #[test]
    fn balances_sources() {
        let merger = InterleaveMerger;
        let a = make_group("A", &["a-0", "a-1", "a-2"]);
        let b = make_group("B", &["b-0", "b-1", "b-2"]);

        let merged = merger.merge(vec![a, b], 10);
        assert_eq!(merged.len(), 6);

        let ids: Vec<_> = merged.iter().map(|c| c.post_id.clone()).collect();
        assert_eq!(ids, vec!["a-0", "b-0", "a-1", "b-1", "a-2", "b-2"]);
    }

    #[test]
    fn respects_max_size() {
        let merger = InterleaveMerger;
        let a = make_group("A", &["a-0", "a-1", "a-2", "a-3", "a-4"]);
        let b = make_group("B", &["b-0", "b-1", "b-2", "b-3", "b-4"]);

        let merged = merger.merge(vec![a, b], 4);
        assert_eq!(merged.len(), 4);
    }

    #[test]
    fn handles_empty_group() {
        let merger = InterleaveMerger;
        let a = make_group("A", &["a-0", "a-1"]);
        let b = make_group("B", &[]);

        let merged = merger.merge(vec![a, b], 10);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn handles_all_empty() {
        let merger = InterleaveMerger;
        let merged = merger.merge(
            vec![make_group("A", &[]), make_group("B", &[])],
            10,
        );
        assert!(merged.is_empty());
    }

    #[test]
    fn single_source_preserves_order() {
        let merger = InterleaveMerger;
        let a = make_group("Only", &["a-0", "a-1", "a-2"]);

        let merged = merger.merge(vec![a], 10);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].post_id, "a-0");
        assert_eq!(merged[1].post_id, "a-1");
        assert_eq!(merged[2].post_id, "a-2");
    }

    fn make_group(name: &str, ids: &[&str]) -> CandidateGroup {
        CandidateGroup::new(
            name,
            ids.iter()
                .map(|id| make_test_candidate(id, "author-1"))
                .collect(),
        )
    }
}
