use std::collections::HashSet;

const STOPWORDS: &[&str] = &[
    "a",
    "about",
    "after",
    "again",
    "all",
    "also",
    "an",
    "and",
    "are",
    "as",
    "at",
    "before",
    "but",
    "by",
    "can",
    "city",
    "claim",
    "company",
    "could",
    "day",
    "during",
    "for",
    "from",
    "has",
    "have",
    "into",
    "its",
    "less",
    "more",
    "new",
    "news",
    "not",
    "of",
    "old",
    "on",
    "one",
    "over",
    "report",
    "said",
    "says",
    "should",
    "south",
    "summary",
    "that",
    "the",
    "their",
    "them",
    "they",
    "this",
    "than",
    "today",
    "tomorrow",
    "two",
    "under",
    "update",
    "very",
    "was",
    "were",
    "while",
    "will",
    "with",
    "world",
    "would",
    "yesterday",
    "you",
    "your",
];

const DEMO_KEYWORDS: &[&str] = &[
    "ai", "delivery", "frontend", "go", "graph", "growth", "ranking", "recsys", "rust",
];

pub fn normalize_keyword(raw: &str) -> Option<String> {
    let normalized = normalize_phrase(raw);
    if normalized.is_empty() {
        return None;
    }

    if let Some(alias) = alias_slug(&normalized) {
        return Some(alias.to_string());
    }

    let tokens = normalized
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();

    if tokens.is_empty() || tokens.len() > 4 {
        return None;
    }

    if tokens.iter().all(|token| is_stopword(token)) {
        return None;
    }

    if tokens.len() == 1 {
        let token = tokens[0];
        if token.len() < 2 || token.len() > 32 || token.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        if is_stopword(token) && !DEMO_KEYWORDS.contains(&token) {
            return None;
        }
        return Some(token.to_string());
    }

    if tokens.iter().any(|token| is_stopword(token)) {
        return None;
    }

    Some(tokens.join("_"))
}

pub fn extract_keywords(text: &str, limit: usize) -> Vec<String> {
    let tokens = tokenize(text);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for window_size in (2..=4).rev() {
        for window in tokens.windows(window_size) {
            let phrase = window.join(" ");
            if alias_slug(&normalize_phrase(&phrase)).is_some() {
                push_keyword(&mut out, &mut seen, &phrase, limit);
                if out.len() >= limit {
                    return out;
                }
            }
        }
    }

    for window_size in (2..=4).rev() {
        for window in tokens.windows(window_size) {
            let phrase = window.join(" ");
            push_keyword(&mut out, &mut seen, &phrase, limit);
            if out.len() >= limit {
                return out;
            }
        }
    }

    for token in tokens {
        push_keyword(&mut out, &mut seen, &token, limit);
        if out.len() >= limit {
            break;
        }
    }

    out
}

pub fn canonical_keywords(explicit: &[String], text: &str, limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for keyword in explicit {
        push_keyword(&mut out, &mut seen, keyword, limit);
    }

    if out.len() < limit {
        for keyword in extract_keywords(text, limit) {
            push_keyword(&mut out, &mut seen, &keyword, limit);
            if out.len() >= limit {
                break;
            }
        }
    }

    out
}

pub fn slug_to_display(slug: &str) -> String {
    slug.split('_')
        .filter(|part| !part.is_empty())
        .map(title_case_token)
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn is_weak_keyword(slug: &str) -> bool {
    let normalized = slug.replace('_', " ");
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    tokens.is_empty() || tokens.iter().all(|token| is_stopword(token))
}

fn push_keyword(out: &mut Vec<String>, seen: &mut HashSet<String>, raw: &str, limit: usize) {
    if out.len() >= limit {
        return;
    }
    if let Some(keyword) = normalize_keyword(raw) {
        if seen.insert(keyword.clone()) {
            out.push(keyword);
        }
    }
}

fn alias_slug(normalized: &str) -> Option<&'static str> {
    match normalized {
        "donald trump" | "president trump" | "trump" | "us president" | "u s president" => {
            Some("donald_trump")
        }
        "mr beast" | "mrbeast" => Some("mrbeast"),
        "artificial intelligence" | "gen ai" | "generative ai" => Some("ai"),
        "ai agent" | "ai agents" | "agentic ai" => Some("ai_agents"),
        "golang" | "go language" | "go delivery" => Some("go"),
        "react" | "react js" | "reactjs" => Some("react"),
        "open ai" | "openai" => Some("openai"),
        "x ai" | "xai" => Some("xai"),
        "recommendation system"
        | "recommendation systems"
        | "recommender system"
        | "recommender systems" => Some("recsys"),
        "front end" | "front end development" | "frontend development" => Some("frontend"),
        _ => None,
    }
}

fn normalize_phrase(raw: &str) -> String {
    let lower = raw.trim().trim_start_matches('#').to_lowercase();
    let mut cleaned = String::with_capacity(lower.len());
    let mut skip_url = false;

    for part in lower.split_whitespace() {
        if part.starts_with("http://") || part.starts_with("https://") {
            skip_url = true;
            continue;
        }
        if skip_url {
            skip_url = false;
        }
        for c in part.chars() {
            if c.is_ascii_alphanumeric() || is_cjk(c) {
                cleaned.push(c);
            } else {
                cleaned.push(' ');
            }
        }
        cleaned.push(' ');
    }

    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn tokenize(text: &str) -> Vec<String> {
    normalize_phrase(text)
        .split_whitespace()
        .map(ToOwned::to_owned)
        .filter(|token| token.len() >= 2)
        .filter(|token| !token.chars().all(|c| c.is_ascii_digit()))
        .collect()
}

fn is_stopword(token: &str) -> bool {
    STOPWORDS.contains(&token)
}

fn is_cjk(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

fn title_case_token(token: &str) -> String {
    match token {
        "ai" => "AI".to_string(),
        "go" => "Go".to_string(),
        "mrbeast" => "MrBeast".to_string(),
        "recsys" => "Recsys".to_string(),
        "rust" => "Rust".to_string(),
        _ => {
            let mut chars = token.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical_keywords, extract_keywords, normalize_keyword};

    #[test]
    fn merges_trump_aliases() {
        assert_eq!(normalize_keyword("trump").as_deref(), Some("donald_trump"));
        assert_eq!(
            normalize_keyword("Donald Trump").as_deref(),
            Some("donald_trump")
        );
        assert_eq!(
            normalize_keyword("US President").as_deref(),
            Some("donald_trump")
        );
    }

    #[test]
    fn filters_generic_company_and_south_keywords() {
        assert_eq!(normalize_keyword("company"), None);
        assert_eq!(normalize_keyword("south"), None);
        assert_eq!(normalize_keyword("#world"), None);
    }

    #[test]
    fn extracts_phrases_before_single_tokens() {
        let keywords = extract_keywords("Donald Trump court ruling shakes campaign", 6);
        assert!(keywords.contains(&"donald_trump".to_string()));
        assert!(keywords.iter().any(|keyword| keyword.contains("court")));
    }

    #[test]
    fn keeps_demo_keywords_from_explicit_fields() {
        let keywords = canonical_keywords(
            &["recsys".to_string(), "rust".to_string()],
            "ignored text",
            4,
        );
        assert_eq!(keywords[..2], ["recsys".to_string(), "rust".to_string()]);
    }
}
