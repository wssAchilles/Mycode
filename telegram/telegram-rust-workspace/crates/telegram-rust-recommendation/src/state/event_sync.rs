//! 推荐引擎实时事件流（`recsys:events:v1`）同步与删帖墓碑多级缓存驱逐协调器。
//!
//! 挂载 `telegram-thunder-store` 的 Redis Stream 消费者，当收到 `post.deleted` 时：
//! 1. 立即写入 `ThunderStore` 墓碑表并从三池内存索引摘除；
//! 2. 同步驱逐 `RecentHotStore` 全部分片中的已删帖；
//! 3. 异步联动清理 `ServeCache` 与 `SourceCache` 的本地 Moka 条目及远端 Redis 缓存键。

use std::sync::Arc;

use telegram_thunder_store::{
    DeletedPostHook, StreamConsumerConfig, ThunderStore, spawn_stream_listener_with_hooks,
};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::serving::cache::ServeCache;
use crate::sources::cached_posts::SourceCache;
use crate::state::recent_store::RecentHotStore;

/// 后台事件流监听生命周期守卫（随 `AppState` 销毁时自动通知退出并回收协程）。
pub struct RecsysEventSyncGuard {
    shutdown_tx: watch::Sender<bool>,
    listener_handle: Option<JoinHandle<()>>,
}

impl std::fmt::Debug for RecsysEventSyncGuard {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RecsysEventSyncGuard")
            .field("active", &self.listener_handle.is_some())
            .finish()
    }
}

impl Drop for RecsysEventSyncGuard {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(true);
        if let Some(handle) = self.listener_handle.take() {
            handle.abort();
        }
    }
}

fn is_event_stream_enabled() -> bool {
    match std::env::var("RUST_RECOMMENDATION_EVENT_STREAM_ENABLED") {
        Ok(raw) => !matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "no" | "off"
        ),
        Err(_) => true,
    }
}

/// 启动 `recsys:events:v1` 后台监听任务并绑定三层缓存删帖驱逐钩子。
pub fn start_recsys_event_sync(
    redis_url: &str,
    thunder_store: Arc<ThunderStore>,
    recent_store: Arc<RecentHotStore>,
    serve_cache: ServeCache,
    source_cache: SourceCache,
) -> Arc<RecsysEventSyncGuard> {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    if !is_event_stream_enabled() || redis_url.trim().is_empty() {
        return Arc::new(RecsysEventSyncGuard {
            shutdown_tx,
            listener_handle: None,
        });
    }

    let Ok(runtime_handle) = tokio::runtime::Handle::try_current() else {
        return Arc::new(RecsysEventSyncGuard {
            shutdown_tx,
            listener_handle: None,
        });
    };

    let hook_handle = runtime_handle.clone();
    let on_deleted: DeletedPostHook = Arc::new(move |post_id: &str, _author_id: Option<&str>| {
        // 1. 立即从内存热帖池同步剔除
        recent_store.evict_post(post_id);
        // 2. 联动驱逐 ServeCache 与 SourceCache（含本地 Moka 与 Redis 键）
        let post_id_owned = post_id.to_string();
        let serve_cache = serve_cache.clone();
        let source_cache = source_cache.clone();
        hook_handle.spawn(async move {
            let _ = tokio::join!(
                serve_cache.evict_post(&post_id_owned),
                source_cache.evict_post(&post_id_owned),
            );
        });
    });

    let mut stream_config = StreamConsumerConfig::new(redis_url.to_string());
    if let Ok(custom_stream) = std::env::var("RECSYS_EVENT_STREAM_KEY")
        && !custom_stream.trim().is_empty()
    {
        stream_config.stream_key = custom_stream.trim().to_string();
    }

    let _guard = runtime_handle.enter();
    let listener_handle = spawn_stream_listener_with_hooks(
        thunder_store,
        stream_config,
        shutdown_rx,
        Some(on_deleted),
    );

    Arc::new(RecsysEventSyncGuard {
        shutdown_tx,
        listener_handle: Some(listener_handle),
    })
}
