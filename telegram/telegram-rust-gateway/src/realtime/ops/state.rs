use std::collections::BTreeMap;

use serde::Serialize;

use crate::realtime_contracts::{
    RealtimeCompatDispatchEnvelopeV1, RealtimeDeliveryEnvelopeV1, RealtimeDeliveryTargetKind,
    RealtimeDeliveryTopic, RealtimeDropReason, RealtimeEventEnvelopeV1, RealtimeRecentDelivery,
    RealtimeRecentEvent, RealtimeTopic,
};

const RECENT_EVENTS_LIMIT: usize = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeOpsSnapshot {
    pub counts_by_topic: BTreeMap<String, u64>,
    pub delivery_counts_by_topic: BTreeMap<String, u64>,
    pub delivery_counts_by_target: BTreeMap<String, u64>,
    pub drop_reasons: BTreeMap<String, u64>,
    pub delivery_drop_reasons: BTreeMap<String, u64>,
    pub auth_failures: BTreeMap<String, u64>,
    pub compat_hits: u64,
    pub fallback_hits: u64,
    pub last_event_at: Option<String>,
    pub last_delivery_at: Option<String>,
    pub ingress_stream_lag: Option<u64>,
    pub delivery_stream_lag: Option<u64>,
    pub recent_events: Vec<RealtimeRecentEvent>,
    pub recent_deliveries: Vec<RealtimeRecentDelivery>,
}

#[derive(Debug, Default, Clone)]
pub struct RealtimeOpsState {
    counts_by_topic: BTreeMap<String, u64>,
    delivery_counts_by_topic: BTreeMap<String, u64>,
    delivery_counts_by_target: BTreeMap<String, u64>,
    drop_reasons: BTreeMap<String, u64>,
    delivery_drop_reasons: BTreeMap<String, u64>,
    auth_failures: BTreeMap<String, u64>,
    compat_hits: u64,
    fallback_hits: u64,
    last_event_at: Option<String>,
    last_delivery_at: Option<String>,
    ingress_stream_lag: Option<u64>,
    delivery_stream_lag: Option<u64>,
    recent_events: Vec<RealtimeRecentEvent>,
    recent_deliveries: Vec<RealtimeRecentDelivery>,
}

impl RealtimeOpsState {
    pub fn record_envelope(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let topic = ingress_topic_name(envelope.topic);
        *self.counts_by_topic.entry(topic).or_insert(0) += 1;
        self.compat_hits += u64::from(envelope.source == "node_socket_io_compat");
        self.last_event_at = Some(envelope.emitted_at.clone());
        self.recent_events.insert(
            0,
            RealtimeRecentEvent {
                event_id: envelope.event_id.clone(),
                topic: envelope.topic,
                emitted_at: envelope.emitted_at.clone(),
                session_id: envelope.session_id.clone(),
                user_id: envelope.user_id.clone(),
                chat_id: envelope.chat_id.clone(),
                source: envelope.source.clone(),
            },
        );
        if self.recent_events.len() > RECENT_EVENTS_LIMIT {
            self.recent_events.truncate(RECENT_EVENTS_LIMIT);
        }
    }

    pub fn record_delivery_request(&mut self, envelope: &RealtimeDeliveryEnvelopeV1) {
        let topic = delivery_topic_name(envelope.topic);
        let target = target_kind_name(envelope.target.kind);
        *self.delivery_counts_by_topic.entry(topic).or_insert(0) += 1;
        *self.delivery_counts_by_target.entry(target).or_insert(0) += 1;
        self.last_delivery_at = Some(envelope.emitted_at.clone());
    }

    pub fn record_delivery_dispatch(
        &mut self,
        envelope: &RealtimeDeliveryEnvelopeV1,
        dispatch: &RealtimeCompatDispatchEnvelopeV1,
    ) {
        self.last_delivery_at = Some(dispatch.emitted_at.clone());
        self.recent_deliveries.insert(
            0,
            RealtimeRecentDelivery {
                delivery_id: envelope.delivery_id.clone(),
                topic: envelope.topic,
                emitted_at: dispatch.emitted_at.clone(),
                requested_kind: envelope.target.kind,
                requested_id: envelope.target.id.clone(),
                source: dispatch.source.clone(),
                resolved_count: dispatch.target.resolved_count,
            },
        );
        if self.recent_deliveries.len() > RECENT_EVENTS_LIMIT {
            self.recent_deliveries.truncate(RECENT_EVENTS_LIMIT);
        }
    }

    pub fn record_ingress_drop_reason(&mut self, reason: RealtimeDropReason) {
        *self.drop_reasons.entry(drop_reason_name(reason)).or_insert(0) += 1;
    }

    pub fn record_delivery_drop_reason(&mut self, reason: RealtimeDropReason) {
        *self
            .delivery_drop_reasons
            .entry(drop_reason_name(reason))
            .or_insert(0) += 1;
    }

    pub fn record_auth_failure(&mut self, failure_class: &str) {
        *self
            .auth_failures
            .entry(failure_class.to_string())
            .or_insert(0) += 1;
    }

    pub fn record_fallback_hit(&mut self) {
        self.fallback_hits += 1;
    }

    pub fn set_ingress_stream_lag(&mut self, lag: Option<u64>) {
        self.ingress_stream_lag = lag;
    }

    pub fn set_delivery_stream_lag(&mut self, lag: Option<u64>) {
        self.delivery_stream_lag = lag;
    }

    pub fn snapshot(&self) -> RealtimeOpsSnapshot {
        RealtimeOpsSnapshot {
            counts_by_topic: self.counts_by_topic.clone(),
            delivery_counts_by_topic: self.delivery_counts_by_topic.clone(),
            delivery_counts_by_target: self.delivery_counts_by_target.clone(),
            drop_reasons: self.drop_reasons.clone(),
            delivery_drop_reasons: self.delivery_drop_reasons.clone(),
            auth_failures: self.auth_failures.clone(),
            compat_hits: self.compat_hits,
            fallback_hits: self.fallback_hits,
            last_event_at: self.last_event_at.clone(),
            last_delivery_at: self.last_delivery_at.clone(),
            ingress_stream_lag: self.ingress_stream_lag,
            delivery_stream_lag: self.delivery_stream_lag,
            recent_events: self.recent_events.clone(),
            recent_deliveries: self.recent_deliveries.clone(),
        }
    }
}

fn ingress_topic_name(topic: RealtimeTopic) -> String {
    match topic {
        RealtimeTopic::SessionOpened => "session_opened",
        RealtimeTopic::SessionClosed => "session_closed",
        RealtimeTopic::SessionHeartbeat => "session_heartbeat",
        RealtimeTopic::PresenceUpdated => "presence_updated",
        RealtimeTopic::TypingUpdated => "typing_updated",
        RealtimeTopic::MessageCommandRequested => "message_command_requested",
        RealtimeTopic::ReadAckRequested => "read_ack_requested",
    }
    .to_string()
}

fn delivery_topic_name(topic: RealtimeDeliveryTopic) -> String {
    match topic {
        RealtimeDeliveryTopic::Message => "message",
        RealtimeDeliveryTopic::Presence => "presence",
        RealtimeDeliveryTopic::Typing => "typing",
        RealtimeDeliveryTopic::ReadReceipt => "read_receipt",
        RealtimeDeliveryTopic::GroupUpdate => "group_update",
    }
    .to_string()
}

fn target_kind_name(kind: RealtimeDeliveryTargetKind) -> String {
    match kind {
        RealtimeDeliveryTargetKind::Socket => "socket",
        RealtimeDeliveryTargetKind::User => "user",
        RealtimeDeliveryTargetKind::Room => "room",
        RealtimeDeliveryTargetKind::Broadcast => "broadcast",
    }
    .to_string()
}

fn drop_reason_name(reason: RealtimeDropReason) -> String {
    match reason {
        RealtimeDropReason::InvalidEvent => "invalid_event",
        RealtimeDropReason::UnsupportedTopic => "unsupported_topic",
        RealtimeDropReason::DlqWriteFailed => "dlq_write_failed",
        RealtimeDropReason::StreamReadFailed => "stream_read_failed",
        RealtimeDropReason::StreamParseFailed => "stream_parse_failed",
        RealtimeDropReason::DeliveryInvalidEvent => "delivery_invalid_event",
        RealtimeDropReason::DeliveryUnsupportedTarget => "delivery_unsupported_target",
        RealtimeDropReason::DeliveryNoResolvedTargets => "delivery_no_resolved_targets",
        RealtimeDropReason::DeliveryDispatchPublishFailed => "delivery_dispatch_publish_failed",
        RealtimeDropReason::DeliveryStreamReadFailed => "delivery_stream_read_failed",
        RealtimeDropReason::DeliveryStreamParseFailed => "delivery_stream_parse_failed",
    }
    .to_string()
}
