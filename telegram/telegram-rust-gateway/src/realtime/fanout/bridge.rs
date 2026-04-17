use serde::Serialize;

use crate::realtime_contracts::RealtimeDeliveryTopic;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanoutBridgeSnapshot {
    pub active_user_targets: usize,
    pub active_room_targets: usize,
    pub last_updated_at: Option<String>,
    pub last_delivery_at: Option<String>,
    pub last_delivery_topic: Option<RealtimeDeliveryTopic>,
    pub last_resolved_socket_count: usize,
}

#[derive(Debug, Default, Clone)]
pub struct FanoutBridge {
    active_user_targets: usize,
    active_room_targets: usize,
    last_updated_at: Option<String>,
    last_delivery_at: Option<String>,
    last_delivery_topic: Option<RealtimeDeliveryTopic>,
    last_resolved_socket_count: usize,
}

impl FanoutBridge {
    pub fn refresh_registry(
        &mut self,
        active_user_targets: usize,
        active_room_targets: usize,
        at: String,
    ) {
        self.active_user_targets = active_user_targets;
        self.active_room_targets = active_room_targets;
        self.last_updated_at = Some(at);
    }

    pub fn record_delivery(
        &mut self,
        topic: RealtimeDeliveryTopic,
        resolved_socket_count: usize,
        at: String,
    ) {
        self.last_delivery_at = Some(at);
        self.last_delivery_topic = Some(topic);
        self.last_resolved_socket_count = resolved_socket_count;
    }

    pub fn snapshot(&self) -> FanoutBridgeSnapshot {
        FanoutBridgeSnapshot {
            active_user_targets: self.active_user_targets,
            active_room_targets: self.active_room_targets,
            last_updated_at: self.last_updated_at.clone(),
            last_delivery_at: self.last_delivery_at.clone(),
            last_delivery_topic: self.last_delivery_topic,
            last_resolved_socket_count: self.last_resolved_socket_count,
        }
    }
}
