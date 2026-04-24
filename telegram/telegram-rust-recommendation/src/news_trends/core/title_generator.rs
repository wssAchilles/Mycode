use super::normalizer::{extract_keywords, is_weak_keyword, slug_to_display};
use super::scorer::ScoredTrendCluster;

pub fn generate_display_name(cluster: &ScoredTrendCluster) -> Option<String> {
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
