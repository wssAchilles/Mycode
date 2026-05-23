use super::GraphClient;
use super::types::{GraphQueryResult, GraphQueryType, NeighborCandidate};

pub struct BatchGraphClient<C: GraphClient> {
    inner: C,
}

impl<C: GraphClient> BatchGraphClient<C> {
    pub fn new(inner: C) -> Self {
        Self { inner }
    }

    pub async fn batch_neighbor_queries(
        &self,
        user_id: &str,
        queries: &[(GraphQueryType, usize)],
        exclude_user_ids: &[String],
    ) -> anyhow::Result<
        std::collections::HashMap<GraphQueryType, GraphQueryResult<NeighborCandidate>>,
    > {
        let mut results = std::collections::HashMap::new();
        for (query_type, limit) in queries {
            let user_id = user_id.to_string();
            let exclude = exclude_user_ids.to_vec();
            let client = &self.inner;
            let qt = query_type.clone();
            let lim = *limit;
            match qt {
                GraphQueryType::SocialNeighbors => {
                    results.insert(qt, client.social_neighbors(&user_id, lim, &exclude).await?);
                }
                GraphQueryType::RecentEngagers => {
                    results.insert(qt, client.recent_engagers(&user_id, lim, &exclude).await?);
                }
                GraphQueryType::CoEngagers => {
                    results.insert(qt, client.co_engagers(&user_id, lim, &exclude).await?);
                }
                GraphQueryType::ContentAffinityNeighbors => {
                    results.insert(
                        qt,
                        client
                            .content_affinity_neighbors(&user_id, lim, &exclude)
                            .await?,
                    );
                }
                _ => {}
            }
        }
        Ok(results)
    }
}
