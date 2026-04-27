use std::collections::HashSet;

use crate::contracts::RecommendationCandidatePayload;

pub fn related_post_ids(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let mut ids = vec![
        candidate.model_post_id.clone(),
        Some(candidate.post_id.clone()),
        candidate.original_post_id.clone(),
        candidate.reply_to_post_id.clone(),
        candidate.conversation_id.clone(),
    ];

    if candidate.is_news == Some(true) {
        if let Some(external_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.external_id.clone())
        {
            ids.push(Some(external_id));
        }
        if let Some(cluster_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
        {
            ids.push(Some(format!("news:cluster:{cluster_id}")));
        }
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in ids.into_iter().flatten() {
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}
