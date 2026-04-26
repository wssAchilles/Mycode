use std::collections::HashMap;

use super::normalizer::{extract_keywords, is_weak_keyword, slug_to_display};
use super::scorer::ScoredTrendCluster;

pub fn generate_display_name(cluster: &ScoredTrendCluster) -> Option<String> {
    if cluster.cluster.documents.len() > 1 {
        if let Some(stable_name) = stable_event_name(cluster) {
            return Some(stable_name);
        }
    }

    let representative = cluster
        .cluster
        .documents
        .get(cluster.representative_index)?;
    if let Some(title) = representative.payload.title.as_deref() {
        let cleaned = clean_display_title(title);
        if is_usable_display_title(&cleaned) {
            return Some(cleaned);
        }
    }

    let keyword_display = cluster
        .canonical_keywords
        .iter()
        .filter(|keyword| !is_weak_keyword(keyword))
        .take(3)
        .map(|keyword| slug_to_display(keyword))
        .collect::<Vec<_>>()
        .join(" ");

    if is_usable_display_title(&keyword_display) {
        Some(keyword_display)
    } else {
        None
    }
}

fn stable_event_name(cluster: &ScoredTrendCluster) -> Option<String> {
    let entity = cluster
        .canonical_keywords
        .iter()
        .find(|keyword| !is_weak_keyword(keyword))
        .map(|keyword| slug_to_display(keyword))?;
    let action = dominant_action(cluster);
    let display = match action {
        Some(action) if !entity.to_lowercase().contains(&action) => {
            format!("{entity} {}", slug_to_display(&action))
        }
        _ => entity,
    };

    if is_usable_display_title(&display) {
        Some(display)
    } else {
        None
    }
}

fn dominant_action(cluster: &ScoredTrendCluster) -> Option<String> {
    let mut counts = HashMap::<String, usize>::new();
    for document in &cluster.cluster.documents {
        for action in &document.action_tokens {
            *counts.entry(action.clone()).or_insert(0) += 1;
        }
    }
    counts
        .into_iter()
        .max_by(|(left_action, left_count), (right_action, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| right_action.cmp(left_action))
        })
        .map(|(action, _)| action)
}

pub fn representative_summary(cluster: &ScoredTrendCluster) -> Option<String> {
    let representative = cluster
        .cluster
        .documents
        .get(cluster.representative_index)?;
    representative
        .payload
        .summary
        .as_deref()
        .map(clean_summary)
        .filter(|summary| !summary.is_empty())
}

fn clean_display_title(title: &str) -> String {
    let normalized = title
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    truncate_words(&normalized, 96)
}

fn clean_summary(summary: &str) -> String {
    truncate_words(
        &summary
            .replace('\n', " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
        180,
    )
}

fn truncate_words(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.trim().to_string();
    }
    let mut out = String::new();
    for word in value.split_whitespace() {
        let next_len = out.chars().count() + word.chars().count() + usize::from(!out.is_empty());
        if next_len > max_chars {
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    if out.is_empty() {
        value.chars().take(max_chars).collect()
    } else {
        out
    }
}

fn is_usable_display_title(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < 4 {
        return false;
    }
    let keywords = extract_keywords(trimmed, 4);
    !keywords.is_empty() && !keywords.iter().all(|keyword| is_weak_keyword(keyword))
}

#[cfg(test)]
mod tests {
    use super::is_usable_display_title;

    #[test]
    fn rejects_weak_generic_title() {
        assert!(!is_usable_display_title("Company south news"));
    }

    #[test]
    fn accepts_event_title() {
        assert!(is_usable_display_title(
            "MrBeast: Company sued by ex-employee over harassment claim"
        ));
    }
}
