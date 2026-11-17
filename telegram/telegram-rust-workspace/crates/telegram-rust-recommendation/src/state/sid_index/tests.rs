use super::*;

fn post(post_id: &str, author_id: &str, codes: [i32; 6], created_at_ms: i64) -> IndexedSidPost {
    IndexedSidPost::from_codes(post_id, author_id, &codes, created_at_ms).expect("valid sid codes")
}

#[test]
fn pack_and_unpack_roundtrip_and_validate_bounds() {
    let codes = [12, 87, 203, 5, 199, 255];
    let key = pack_full_key(&codes).expect("valid 6x256 codes");
    assert_eq!(key >> 48, 0);
    assert_eq!(codes_from_key(key), codes);

    assert_eq!(pack_full_key(&[-1, 0, 0, 0, 0, 0]), None);
    assert_eq!(pack_full_key(&[0, 256, 0, 0, 0, 0]), None);
    assert_eq!(seed_key(&[-1, 1, 2, 3, 4, 5]), None);

    let partial = seed_key(&[12, 87, 203, -1, 5, 6]).expect("depth 3 prefix");
    assert_eq!(partial.valid_depth, 3);
    assert_eq!(codes_from_key(partial.key), [12, 87, 203, 0, 0, 0]);
}

#[test]
fn prefix_range_bounds_match_expected_byte_boundaries() {
    let key = pack_full_key(&[10, 20, 30, 40, 50, 60]).unwrap();
    let (lo6, hi6) = prefix_range(key, 6);
    assert_eq!(lo6, key);
    assert_eq!(hi6, key + 1);

    let (lo3, hi3) = prefix_range(key, 3);
    assert_eq!(lo3, pack_full_key(&[10, 20, 30, 0, 0, 0]).unwrap());
    assert_eq!(hi3, pack_full_key(&[10, 20, 31, 0, 0, 0]).unwrap());

    let (lo0, hi0) = prefix_range(key, 0);
    assert_eq!(lo0, 0);
    assert_eq!(hi0, 1u64 << 48);
}

#[test]
fn retrieve_for_seed_descends_prefix_depth_and_excludes_seed_and_shallow_hits() {
    let index = SidPrefixIndex::build(vec![
        post("p-seed", "a1", [10, 20, 30, 40, 50, 60], 1_000),
        post("p-d6", "a2", [10, 20, 30, 40, 50, 60], 900),
        post("p-d5", "a3", [10, 20, 30, 40, 50, 99], 950),
        post("p-d4", "a4", [10, 20, 30, 40, 88, 99], 960),
        post("p-d3", "a5", [10, 20, 30, 77, 88, 99], 970),
        post("p-d2-too-shallow", "a6", [10, 20, 99, 77, 88, 99], 999),
    ]);

    let seed = seed_key(&[10, 20, 30, 40, 50, 60]).unwrap();
    let excluded = HashSet::from(["p-seed".to_string()]);
    let hits = index.retrieve_for_seed("p-seed", seed, &SidRetrieveParams::default(), &excluded);

    let summary: Vec<(&str, u32)> = hits
        .iter()
        .map(|c| (c.post_id.as_str(), c.shared_prefix_depth))
        .collect();
    assert_eq!(
        summary,
        vec![("p-d6", 6), ("p-d5", 5), ("p-d4", 4), ("p-d3", 3)]
    );
}

#[test]
fn retrieve_interleaved_round_robins_dedups_and_enforces_budgets() {
    let index = SidPrefixIndex::build(vec![
        post("p1", "a1", [1, 2, 3, 4, 5, 6], 100),
        post("p2", "a2", [1, 2, 3, 4, 5, 7], 200),
        post("p3", "a3", [1, 2, 3, 9, 9, 9], 150),
        post("q1", "a4", [9, 8, 7, 6, 5, 4], 300),
    ]);

    let seeds = vec![
        SidSeed::from_codes("s1", &[1, 2, 3, 4, 5, 0]).unwrap(),
        SidSeed::from_codes("s2", &[9, 8, 7, 6, 5, 0]).unwrap(),
        // 相同 post_id 的重复种子应被去重，不重复占据轮次
        SidSeed::from_codes("s1", &[1, 2, 3, 4, 5, 0]).unwrap(),
    ];
    let params = SidRetrieveParams {
        max_results: 3,
        max_seeds: 50,
        max_per_seed: 100,
        min_prefix_depth: 3,
        max_prefix_depth: 6,
    };
    let (candidates, counts) = index.retrieve_interleaved(&seeds, &HashSet::new(), &params);

    let ids: Vec<&str> = candidates.iter().map(|c| c.post_id.as_str()).collect();
    assert_eq!(ids, vec!["p2", "q1", "p1"]);
    assert_eq!(counts, vec![2, 1]);

    // 额外测试不同 seed_id 命中重叠前缀池时的全局去重与交替出队
    let overlapping_seeds = vec![
        SidSeed::from_codes("s1", &[1, 2, 3, 4, 5, 0]).unwrap(),
        SidSeed::from_codes("s2", &[9, 8, 7, 6, 5, 0]).unwrap(),
        SidSeed::from_codes("s3", &[1, 2, 3, 4, 5, 0]).unwrap(),
    ];
    let (overlap_candidates, overlap_counts) =
        index.retrieve_interleaved(&overlapping_seeds, &HashSet::new(), &params);
    let overlap_ids: Vec<&str> = overlap_candidates
        .iter()
        .map(|c| c.post_id.as_str())
        .collect();
    assert_eq!(overlap_ids, vec!["p2", "q1", "p1"]);
    assert_eq!(overlap_counts, vec![1, 1, 1]);
}

#[test]
fn upsert_and_remove_keep_index_sorted_and_consistent() {
    let mut index = SidPrefixIndex::build(vec![post("p1", "a1", [5, 5, 5, 5, 5, 5], 10)]);
    index.upsert(post("p2", "a2", [1, 2, 3, 4, 5, 6], 20));
    assert_eq!(index.len(), 2);
    assert_eq!(index.by_key()[0].post_id, "p2");
    assert_eq!(index.lookup_codes("p2"), Some([1, 2, 3, 4, 5, 6]));

    assert!(index.remove("p1"));
    assert!(!index.remove("missing"));
    assert_eq!(index.len(), 1);
    assert_eq!(index.lookup("p1"), None);
}
