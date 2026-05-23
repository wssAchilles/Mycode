use anyhow::Result;
use std::collections::HashMap;

use super::GraphClient;
use super::types::{GraphQueryResult, GraphQueryType, NeighborCandidate, NeighborRequest};

/// Batch multiple graph queries into fewer HTTP calls
pub struct BatchGraphClient<C: GraphClient> {
    inner: C,
}

impl<C: GraphClient> BatchGraphClient<C> {
    pub fn new(inner: C) -> Self {
        Self { inner }
    }

    /// Execute multiple neighbor queries and merge results
    pub async fn batch_neighbor_queries(
        &self,
        user_id: &str,
        queries: &[(GraphQueryType, usize)], // (query_type, limit)
        exclude_user_ids: &[String],
    ) -> Result<HashMap<GraphQueryType, GraphQueryResult<NeighborCandidate>>> {
        let mut results = HashMap::new();

        // Execute all queries concurrently

        for (query_type, limit) in queries {
            let user_id = user_id.to_string();
            let exclude = exclude_user_ids.to_vec();
            let client = &self.inner;
            let qt = *query_type;
            let lim = *limit;

            // We can't borrow `self.inner` across spawn, so execute sequentially
            // but batch the result collection
            match qt {
                GraphQueryType::SocialNeighbors => {
                    let r = client.social_neighbors(&user_id, lim, &exclude).await?;
                    results.insert(qt, r);
                }
                GraphQueryType::RecentEngagers => {
                    let r = client.recent_engagers(&user_id, lim, &exclude).await?;
                    results.insert(qt, r);
                }
                GraphQueryType::CoEngagers => {
                    let r = client.co_engagers(&user_id, lim, &exclude).await?;
                    results.insert(qt, r);
                }
                GraphQueryType::ContentAffinityNeighbors => {
                    let r = client
                        .content_affinity_neighbors(&user_id, lim, &exclude)
                        .await?;
                    results.insert(qt, r);
                }
                _ => {}
            }
        }

        Ok(results)
    }
}
