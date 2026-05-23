use anyhow::Result;
use redis::AsyncCommands;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Default)]
pub struct RealtimeUserFeatures {
    pub interaction_count_1h: u32,
    pub interaction_count_24h: u32,
    pub type_distribution: HashMap<String, u32>,
    pub recency_score: f64,
}

impl RealtimeUserFeatures {
    pub fn is_empty(&self) -> bool {
        self.interaction_count_1h == 0 && self.interaction_count_24h == 0
    }
}

pub struct RealtimeFeatureProvider {
    client: redis::Client,
}

impl RealtimeFeatureProvider {
    pub fn new(redis_url: &str) -> Result<Self> {
        let client = redis::Client::open(redis_url)?;
        Ok(Self { client })
    }

    pub async fn get_user_features(&self, user_id: &str) -> Result<RealtimeUserFeatures> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let key = format!("rf:user:{}:recent_actions", user_id);
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let one_hour_ago = now_ms.saturating_sub(3_600 * 1000);
        let one_day_ago = now_ms.saturating_sub(86_400 * 1000);
        let members: Vec<String> = conn
            .zrangebyscore(&key, one_day_ago as isize, now_ms as isize)
            .await?;
        if members.is_empty() {
            return Ok(RealtimeUserFeatures::default());
        }
        let mut type_dist: HashMap<String, u32> = HashMap::new();
        let mut count_1h = 0u32;
        let mut total_weight = 0.0f64;
        for member in &members {
            let parts: Vec<&str> = member.splitn(3, ':').collect();
            if parts.len() < 3 {
                continue;
            }
            let action_type = parts[0];
            let timestamp: u64 = parts[2].parse().unwrap_or(0);
            *type_dist.entry(action_type.to_string()).or_insert(0) += 1;
            if timestamp >= one_hour_ago {
                count_1h += 1;
            }
            let age_hours = (now_ms.saturating_sub(timestamp)) as f64 / 3_600_000.0;
            total_weight += (-age_hours / 24.0).exp();
        }
        Ok(RealtimeUserFeatures {
            interaction_count_1h: count_1h,
            interaction_count_24h: members.len() as u32,
            type_distribution: type_dist,
            recency_score: (total_weight / 10.0).min(1.0),
        })
    }
}
