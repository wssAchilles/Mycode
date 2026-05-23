use serde::{Deserialize, Serialize};

/// Query types for graph service
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum GraphQueryType {
    SocialNeighbors,
    RecentEngagers,
    CoEngagers,
    ContentAffinityNeighbors,
    BridgeUsers,
}

/// Request for neighbor queries
#[derive(Debug, Clone, Serialize)]
pub struct NeighborRequest {
    pub user_id: String,
    pub limit: usize,
    pub exclude_user_ids: Vec<String>,
}

/// Request for bridge user queries
#[derive(Debug, Clone, Serialize)]
pub struct BridgeRequest {
    pub user_id: String,
    pub limit: usize,
    pub max_depth: usize,
    pub exclude_user_ids: Vec<String>,
}

/// Neighbor candidate from graph service
#[derive(Debug, Clone, Deserialize)]
pub struct NeighborCandidate {
    pub user_id: String,
    pub score: f64,
    pub interaction_probability: f64,
    pub edge_kinds: Vec<String>,
    pub last_interaction_at_ms: Option<i64>,
}

/// Bridge candidate from graph service
#[derive(Debug, Clone, Deserialize)]
pub struct BridgeCandidate {
    pub user_id: String,
    pub score: f64,
    pub bridge_strength: f64,
    pub via_user_ids: Vec<String>,
    pub depth: usize,
}

/// Query result wrapper
#[derive(Debug, Clone)]
pub struct GraphQueryResult<T> {
    pub candidates: Vec<T>,
    pub total_scanned: usize,
    pub budget_exhausted: bool,
}

/// Cache key for graph queries
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub user_id: String,
    pub query_type: GraphQueryType,
    pub limit: usize,
}

/// Cached entry with expiration
#[derive(Debug, Clone)]
pub struct CachedEntry<T> {
    pub data: GraphQueryResult<T>,
    pub cached_at: std::time::Instant,
}

/// Response envelope from graph kernel service
#[derive(Debug, Clone, Deserialize)]
pub struct GraphKernelCandidatesResponse<T> {
    pub candidates: Vec<T>,
    #[serde(default)]
    pub total_scanned: usize,
    #[serde(default)]
    pub budget_exhausted: bool,
}

impl<T> GraphKernelCandidatesResponse<T> {
    pub fn into_query_result(self) -> GraphQueryResult<T> {
        GraphQueryResult {
            candidates: self.candidates,
            total_scanned: self.total_scanned,
            budget_exhausted: self.budget_exhausted,
        }
    }
}
