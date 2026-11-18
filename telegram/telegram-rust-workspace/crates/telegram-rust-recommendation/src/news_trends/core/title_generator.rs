use std::collections::{HashMap, HashSet};

use super::normalizer::{extract_keywords, is_stopword, is_weak_keyword, slug_to_display};
use super::scorer::ScoredTrendCluster;

pub fn generate_display_name(cluster: &ScoredTrendCluster) -> Option<String> {
    if cluster.cluster.documents.len() > 1
        && let Some(stable_name) = stable_event_name(cluster)
    {
        return Some(stable_name);
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
    let entity_slug = cluster
        .canonical_keywords
        .iter()
        .find(|keyword| !is_weak_keyword(keyword))?;
    let entity = slug_to_display(entity_slug);
    let action = consensus_action(cluster, entity_slug);

    if let Some(action) = action {
        let display = if entity.to_lowercase().contains(&action) {
            entity
        } else {
            format!("{entity} {}", slug_to_display(&action))
        };
        return is_usable_display_title(&display).then_some(display);
    }

    // 多词实体（如 Donald Trump）可直接作为聚合事件标题；若仅为孤立单字且代表文档含新闻标题，则回退至精炼代表标题以避免残词
    if !entity_slug.contains('_') {
        let representative_has_title = cluster
            .cluster
            .documents
            .get(cluster.representative_index)
            .and_then(|doc| doc.payload.title.as_deref())
            .is_some_and(|title| is_usable_display_title(&clean_display_title(title)));
        if representative_has_title {
            return None;
        }
    }

    is_usable_display_title(&entity).then_some(entity)
}

fn consensus_action(cluster: &ScoredTrendCluster, entity_slug: &str) -> Option<String> {
    // 仅当同一动作词在至少 2 篇文档中独立出现且与核心实体同文共现时，才认定为簇级共识动作词
    let mut doc_freqs = HashMap::<String, usize>::new();
    let mut co_occurs_with_entity = HashSet::<String>::new();

    for document in &cluster.cluster.documents {
        let unique_actions = document.action_tokens.iter().collect::<HashSet<_>>();
        if unique_actions.is_empty() {
            continue;
        }
        let has_entity = document
            .canonical_keywords
            .iter()
            .chain(document.title_keywords.iter())
            .any(|kw| kw == entity_slug);

        for action in unique_actions {
            *doc_freqs.entry(action.clone()).or_insert(0) += 1;
            if has_entity {
                co_occurs_with_entity.insert(action.clone());
            }
        }
    }

    doc_freqs
        .into_iter()
        .filter(|(action, count)| *count >= 2 && co_occurs_with_entity.contains(action))
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

    // 优先提取冒号或破折号前的完整主标题子句（如 "Congo Ebola Outbreak: How Fear..." -> "Congo Ebola Outbreak"）
    for separator in [": ", " — ", " – ", " - "] {
        if let Some((lead, _)) = normalized.split_once(separator) {
            let trimmed = lead.trim();
            let word_count = trimmed.split_whitespace().count();
            let char_count = trimmed.chars().count();
            if (2..=8).contains(&word_count)
                && (10..=58).contains(&char_count)
                && is_usable_display_title(trimmed)
            {
                return trimmed.to_string();
            }
        }
    }

    // 超长复合句优先在主从句逗号边界收敛，避免截断在从句介词处
    if normalized.chars().count() > 58
        && let Some((clause, _)) = normalized.split_once(", ")
    {
        let trimmed = clause.trim();
        let word_count = trimmed.split_whitespace().count();
        let char_count = trimmed.chars().count();
        if (3..=9).contains(&word_count)
            && (16..=56).contains(&char_count)
            && is_usable_display_title(trimmed)
        {
            return trimmed.to_string();
        }
    }

    let truncated = truncate_words(&normalized, 64);
    if truncated.chars().count() < normalized.chars().count() {
        trim_dangling_tail(&truncated)
    } else {
        truncated
    }
}

fn trim_dangling_tail(value: &str) -> String {
    let mut words = value
        .split_whitespace()
        .map(|word| {
            word.trim_end_matches([',', ':', ';', '-', '—', '–'])
                .to_string()
        })
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();

    while words.len() > 3 {
        let Some(last) = words.last() else {
            break;
        };
        let lower = last
            .trim_matches(|c: char| !c.is_ascii_alphanumeric())
            .to_lowercase();
        if lower.is_empty() || is_stopword(&lower) {
            words.pop();
        } else {
            break;
        }
    }

    words.join(" ")
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
    use super::{clean_display_title, is_usable_display_title};

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

    #[test]
    fn extracts_concise_lead_clause_without_truncating_single_word_speaker() {
        assert_eq!(
            clean_display_title(
                "Congo Ebola Outbreak: How Fear and Mistrust Drive Community Spread"
            ),
            "Congo Ebola Outbreak"
        );
        assert_eq!(
            clean_display_title(
                "Prince William Brings Climate Prize to India, in an Electric Rickshaw"
            ),
            "Prince William Brings Climate Prize to India"
        );
        assert_eq!(
            clean_display_title("MrBeast: Company sued by ex-employee over harassment claim"),
            "MrBeast: Company sued by ex-employee over harassment claim"
        );
    }
}
