use std::collections::BTreeMap;

use serde::Serialize;

use crate::realtime_contracts::{RealtimeDropReason, RealtimeEventEnvelopeV1, RealtimeRecentEvent, RealtimeTopic};

const RECENT_EVENTS_LIMIT: usize = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeOpsSnapshot {
    pub counts_by_topic: BTreeMap<String, u64>,
    pub drop_reasons: BTreeMap<String, u64>,
    pub auth_failures: BTreeMap<String, u64>,
    pub compat_hits: u64,
    pub last_event_at: Option<String>,
    pub ingress_stream_lag: Option<u64>,
    pub recent_events: Vec<RealtimeRecentEvent>,
}

#[derive(Debug, Default, Clone)]
pub struct RealtimeOpsState {
    counts_by_topic: BTreeMap<String, u64>,
    drop_reasons: BTreeMap<String, u64>,
    auth_failures: BTreeMap<String, u64>,
    compat_hits: u64,
    last_event_at: Option<String>,
    ingress_stream_lag: Option<u64>,
    recent_events: Vec<RealtimeRecentEvent>,
}

impl RealtimeOpsState {
    pub fn record_envelope(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let topic = topic_name(envelope.topic);
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

    pub fn record_drop_reason(&mut self, reason: RealtimeDropReason) {
        *self.drop_reasons.entry(drop_reason_name(reason)).or_insert(0) += 1;
    }

    pub fn record_auth_failure(&mut self, failure_class: &str) {
        *self
            .auth_failures
            .entry(failure_class.to_string())
            .or_insert(0) += 1;
    }

    pub fn set_ingress_stream_lag(&mut self, lag: Option<u64>) {
        self.ingress_stream_lag = lag;
    }

    pub fn snapshot(&self) -> RealtimeOpsSnapshot {
        RealtimeOpsSnapshot {
            counts_by_topic: self.counts_by_topic.clone(),
            drop_reasons: self.drop_reasons.clone(),
            auth_failures: self.auth_failures.clone(),
            compat_hits: self.compat_hits,
            last_event_at: self.last_event_at.clone(),
            ingress_stream_lag: self.ingress_stream_lag,
            recent_events: self.recent_events.clone(),
        }
    }
}

fn topic_name(topic: RealtimeTopic) -> String {
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

fn drop_reason_name(reason: RealtimeDropReason) -> String {
    match reason {
        RealtimeDropReason::InvalidEvent => "invalid_event",
        RealtimeDropReason::UnsupportedTopic => "unsupported_topic",
        RealtimeDropReason::DlqWriteFailed => "dlq_write_failed",
        RealtimeDropReason::StreamReadFailed => "stream_read_failed",
        RealtimeDropReason::StreamParseFailed => "stream_parse_failed",
    }
    .to_string()
}
