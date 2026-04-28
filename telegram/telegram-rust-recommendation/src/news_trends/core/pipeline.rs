use chrono::Utc;

use crate::news_trends::contracts::{NewsTrendRequestPayload, NewsTrendResponsePayload};

use super::clusterer::{cluster_documents, normalize_documents};
use super::scorer::score_clusters;
use super::selector::select_trends;
use super::util::bounded_limit;

pub fn run_news_trends_pipeline(mut request: NewsTrendRequestPayload) -> NewsTrendResponsePayload {
    if request.now_ms <= 0 {
        request.now_ms = Utc::now().timestamp_millis();
    }
    if request.window_hours == 0 {
        request.window_hours = 24;
    }
    request.limit = bounded_limit(request.limit);

    let documents = normalize_documents(&request);
    let clusters = cluster_documents(documents);
    let scored_clusters = score_clusters(clusters, &request);
    let trends = select_trends(scored_clusters, &request);

    NewsTrendResponsePayload {
        request_id: request.request_id,
        mode: request.mode,
        generated_at: Utc::now().to_rfc3339(),
        cache_hit: false,
        trends,
    }
}

#[cfg(test)]
mod tests {
    use crate::news_trends::contracts::{
        NewsTrendMode, TrendDocumentPayload, TrendMetricsPayload, TrendSourceType,
    };

    use super::run_news_trends_pipeline;

    const NOW_MS: i64 = 1_774_454_400_000;

    #[test]
    fn clusters_alias_keywords_into_one_event() {
        let response = run_news_trends_pipeline(request(vec![
            news_doc(
                "1",
                "Donald Trump court ruling expected",
                vec!["trump"],
                4,
                0,
            ),
            news_doc(
                "2",
                "US President faces new court case",
                vec!["donald trump"],
                2,
                1,
            ),
        ]));

        assert_eq!(response.trends.len(), 1);
        assert_eq!(response.trends[0].tag, "donald_trump");
        assert_eq!(response.trends[0].count, 2);
        assert_eq!(response.trends[0].display_name, "Donald Trump Court");
        assert!(response.trends[0].trend_id.contains("donald_trump"));
    }

    #[test]
    fn filters_weak_keyword_only_trends() {
        let response = run_news_trends_pipeline(request(vec![news_doc(
            "1",
            "Company south news today",
            vec!["company", "south"],
            1,
            0,
        )]));

        assert!(response.trends.is_empty());
    }

    #[test]
    fn engagement_and_freshness_affect_ranking() {
        let response = run_news_trends_pipeline(request(vec![
            news_doc("old", "Rust release notes", vec!["rust"], 1, 72),
            news_doc("hot", "AI launch gets shared widely", vec!["ai"], 20, 2),
        ]));

        assert_eq!(response.trends[0].tag, "ai");
        assert!(response.trends[0].score > response.trends[1].score);
        assert_eq!(
            response.trends[0]
                .score_breakdown
                .get("lifecycle_rising")
                .copied(),
            Some(1.0)
        );
    }

    #[test]
    fn industrial_trend_score_records_velocity_coherence_and_cross_surface() {
        let mut news = news_doc(
            "news",
            "Recsys ranking latency improves",
            vec!["recsys", "ranking", "latency"],
            18,
            1,
        );
        let mut space = space_doc(
            "space",
            "Recsys ranking latency notes from delivery",
            vec!["recsys", "ranking", "latency"],
            14,
            2,
        );
        news.cluster_id = Some(700);
        space.cluster_id = Some(700);
        let response = run_news_trends_pipeline(request(vec![news, space]));

        let breakdown = &response.trends[0].score_breakdown;
        assert!(
            breakdown
                .get("cluster_coherence")
                .copied()
                .unwrap_or_default()
                > 0.0
        );
        assert!(
            breakdown
                .get("engagement_density")
                .copied()
                .unwrap_or_default()
                > 0.0
        );
        assert_eq!(breakdown.get("cross_surface").copied(), Some(1.0));
        assert!(
            breakdown
                .get("industrial_multiplier")
                .copied()
                .unwrap_or(1.0)
                > 1.0
        );
    }

    #[test]
    fn source_cap_prevents_one_domain_from_dominating() {
        let mut docs = vec![
            news_doc("1", "AI model launch", vec!["ai"], 10, 1),
            news_doc("2", "Rust performance release", vec!["rust"], 9, 1),
            news_doc("3", "Recsys ranking update", vec!["recsys"], 8, 1),
            news_doc("4", "Frontend rendering update", vec!["frontend"], 7, 1),
        ];
        docs[0].canonical_url = Some("https://same.example/a".to_string());
        docs[1].canonical_url = Some("https://same.example/b".to_string());
        docs[2].canonical_url = Some("https://same.example/c".to_string());
        docs[3].canonical_url = Some("https://other.example/d".to_string());

        let mut req = request(docs);
        req.limit = 3;
        let response = run_news_trends_pipeline(req);

        assert_eq!(response.trends.len(), 3);
        assert!(response.trends.iter().any(|trend| trend.tag == "frontend"));
        assert!(!response.trends.iter().any(|trend| trend.tag == "recsys"));
    }

    fn request(
        documents: Vec<TrendDocumentPayload>,
    ) -> crate::news_trends::contracts::NewsTrendRequestPayload {
        crate::news_trends::contracts::NewsTrendRequestPayload {
            request_id: "test".to_string(),
            mode: NewsTrendMode::NewsTopics,
            limit: 6,
            window_hours: 168,
            now_ms: NOW_MS,
            documents,
        }
    }

    fn news_doc(
        id: &str,
        title: &str,
        keywords: Vec<&str>,
        clicks: i32,
        age_hours: i64,
    ) -> TrendDocumentPayload {
        TrendDocumentPayload {
            id: id.to_string(),
            source_type: TrendSourceType::NewsArticle,
            title: Some(title.to_string()),
            summary: Some(format!("{title} summary")),
            body: None,
            source: Some("bbc_world".to_string()),
            source_url: Some(format!("https://example.com/{id}")),
            canonical_url: Some(format!("https://example.com/{id}")),
            cover_image_url: None,
            published_at: Some(
                chrono::DateTime::<chrono::Utc>::from_timestamp_millis(
                    NOW_MS - age_hours * 60 * 60 * 1000,
                )
                .unwrap()
                .to_rfc3339(),
            ),
            fetched_at: None,
            created_at: None,
            cluster_id: None,
            keywords: keywords.into_iter().map(ToOwned::to_owned).collect(),
            metrics: TrendMetricsPayload {
                impressions: Some(10.0),
                clicks: Some(f64::from(clicks)),
                shares: Some((clicks / 2).into()),
                dwell_count: Some(5.0),
                likes: None,
                comments: None,
                reposts: None,
            },
            embedding: None,
        }
    }

    fn space_doc(
        id: &str,
        body: &str,
        keywords: Vec<&str>,
        clicks: i32,
        age_hours: i64,
    ) -> TrendDocumentPayload {
        let mut document = news_doc(id, body, keywords, clicks, age_hours);
        document.source_type = TrendSourceType::SpacePost;
        document.title = None;
        document.body = Some(body.to_string());
        document.source = Some("space".to_string());
        document
    }
}
