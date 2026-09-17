#![allow(dead_code)]

pub mod candidate_hydrators;
pub mod candidate_pipeline;
pub mod clients;
pub mod config;
pub mod contracts;
pub mod filters;
pub mod news_trends;
pub mod ops;
pub mod perf_fixture;
pub mod pipeline;
pub mod query_hydrators;
pub mod replay;
pub mod runtime;
pub mod scorers;
pub mod selectors;
pub mod server;
pub mod serving;
pub mod side_effects;
pub mod sources;
pub mod state;

pub use clients::backend_client;
pub use ops::metrics;
pub use selectors::top_k;
pub use sources::orchestrator;
pub use state::recent_store;
