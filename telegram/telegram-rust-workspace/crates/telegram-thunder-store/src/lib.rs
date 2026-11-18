//! Thunder 内存帖子存储 — 对标 X 的 Thunder service。
//!
//! 提供亚毫秒级关注流（In-Network）内存查询、三池分离索引、删除墓碑防复活、
//! 对话树祖先门控与 `recsys:events:v1` Redis Stream 增量同步能力。

pub mod model;
pub mod post_store;
pub mod stream_consumer;

#[cfg(test)]
mod tests;

pub use model::{
    CompactPost, LightPost, PoolStats, PostEvent, PruneResult, ThunderConfig, ThunderSnapshot,
    ThunderStats, TinyPost,
};
pub use post_store::{InNetworkStore, PostEventProcessor, ThunderStore};
pub use stream_consumer::{
    DEFAULT_CONSUMER_GROUP, DEFAULT_STREAM_KEY, DeletedPostHook, StreamConsumerConfig,
    apply_recsys_stream_event, apply_recsys_stream_event_with_hook, spawn_stream_listener,
    spawn_stream_listener_with_hooks, spawn_stream_listener_with_shutdown,
};
