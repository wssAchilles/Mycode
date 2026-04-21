use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use socketioxide::{
    SocketIo,
    extract::{AckSender, Data, SocketRef},
    layer::SocketIoLayer,
    socket::DisconnectReason,
};
use tracing::{debug, warn};

use crate::{
    realtime::ingress::event_consumer::apply_ingress_envelope,
    realtime_contracts::{RealtimeEventEnvelopeV1, RealtimeTopic},
    state::AppState,
};

use super::{
    contracts::{
        AuthenticatePayload, ROOM_MESSAGE_SCHEMA_VERSION, RUST_SOCKET_IO_COMPAT_SOURCE,
        ReadChatPayload, RoomRequestPayload, SendMessagePayload, SocketMessageAck, TypingPayload,
        TypingServerPayload, normalize_group_room, other_private_user_id, read_message_id,
        read_seq, session_room, user_room,
    },
    upstream::{
        ensure_group_access, fetch_current_user, fetch_user_groups, mark_chat_read, send_message,
        validate_auth_precheck,
    },
};

pub fn create_socket_layer() -> (SocketIoLayer, SocketIo) {
    SocketIo::new_layer()
}

pub fn register_socket_namespace(io: &SocketIo, state: AppState) {
    io.ns("/", move |socket: SocketRef| {
        let state = state.clone();
        async move {
            register_connection(&state, &socket);
            register_handlers(&socket, state.clone());
            socket.on_disconnect(move |socket: SocketRef, reason: DisconnectReason| {
                let state = state.clone();
                async move {
                    handle_disconnect(&state, &socket, reason);
                }
            });
        }
    });
}

fn register_handlers(socket: &SocketRef, state: AppState) {
    let authenticate_state = state.clone();
    socket.on(
        "authenticate",
        move |socket: SocketRef, Data(payload): Data<AuthenticatePayload>| {
            let state = authenticate_state.clone();
            async move {
                if let Err(err) = handle_authenticate(&state, &socket, payload).await {
                    warn!(session_id = %socket.id, error = %err, "rust socket authenticate failed");
                    let _ = socket.emit(
                        "authError",
                        &json!({
                            "message": "认证失败，请重新登录"
                        }),
                    );
                }
            }
        },
    );

    let join_room_state = state.clone();
    socket.on(
        "joinRoom",
        move |socket: SocketRef, Data(payload): Data<RoomRequestPayload>| {
            let state = join_room_state.clone();
            async move {
                if let Err(err) = handle_join_room(&state, &socket, payload).await {
                    warn!(session_id = %socket.id, error = %err, "rust socket joinRoom failed");
                    let _ = socket.emit(
                        "message",
                        &json!({
                            "type": "error",
                            "message": "加入房间失败"
                        }),
                    );
                }
            }
        },
    );

    let leave_room_state = state.clone();
    socket.on(
        "leaveRoom",
        move |socket: SocketRef, Data(payload): Data<RoomRequestPayload>| {
            let state = leave_room_state.clone();
            async move {
                if let Err(err) = handle_leave_room(&state, &socket, payload).await {
                    warn!(session_id = %socket.id, error = %err, "rust socket leaveRoom failed");
                }
            }
        },
    );

    let send_message_state = state.clone();
    socket.on(
        "sendMessage",
        move |socket: SocketRef, Data(payload): Data<SendMessagePayload>, ack: AckSender| {
            let state = send_message_state.clone();
            async move {
                let response = match handle_send_message(&state, &socket, payload).await {
                    Ok(ack) => ack,
                    Err(err) => {
                        warn!(session_id = %socket.id, error = %err, "rust socket sendMessage failed");
                        SocketMessageAck::err(err.to_string())
                    }
                };
                let _ = ack.send(&response);
            }
        },
    );

    let read_chat_state = state.clone();
    socket.on(
        "readChat",
        move |socket: SocketRef, Data(payload): Data<ReadChatPayload>| {
            let state = read_chat_state.clone();
            async move {
                if let Err(err) = handle_read_chat(&state, &socket, payload).await {
                    warn!(session_id = %socket.id, error = %err, "rust socket readChat failed");
                }
            }
        },
    );

    let presence_state = state.clone();
    socket.on(
        "presenceSubscribe",
        move |socket: SocketRef, Data(user_ids): Data<Vec<String>>| {
            let state = presence_state.clone();
            async move {
                handle_presence_subscribe(&state, &socket, user_ids);
            }
        },
    );

    let typing_start_state = state.clone();
    socket.on(
        "typingStart",
        move |socket: SocketRef, Data(payload): Data<TypingPayload>| {
            let state = typing_start_state.clone();
            async move {
                handle_typing_event(&state, &socket, payload, true).await;
            }
        },
    );

    let typing_stop_state = state.clone();
    socket.on(
        "typingStop",
        move |socket: SocketRef, Data(payload): Data<TypingPayload>| {
            let state = typing_stop_state.clone();
            async move {
                handle_typing_event(&state, &socket, payload, false).await;
            }
        },
    );
}

fn register_connection(state: &AppState, socket: &SocketRef) {
    let session_id = socket.id.to_string();
    socket.join(session_room(&session_id));
    {
        let mut sessions = state
            .realtime_socket_state
            .lock()
            .expect("rust socket session mutex poisoned");
        sessions.register_connection(&session_id);
    }
    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            None,
            None,
            RealtimeTopic::SessionOpened,
            None,
            json!({
                "transport": "socket_io_compat",
                "connectedAt": chrono::Utc::now().to_rfc3339(),
                "status": "unknown"
            }),
        ),
    );
}

async fn handle_authenticate(
    state: &AppState,
    socket: &SocketRef,
    payload: AuthenticatePayload,
) -> Result<()> {
    let access_token = payload.token.trim();
    if access_token.is_empty() {
        return Err(anyhow!("AUTH_TOKEN_MISSING"));
    }

    validate_auth_precheck(state, access_token)?;
    let auth_me = fetch_current_user(state, access_token).await?;
    let groups = fetch_user_groups(state, access_token).await?;

    let session_id = socket.id.to_string();
    let user_id = auth_me.user.id;
    let username = auth_me.user.username;
    let group_ids = groups.into_iter().map(|group| group.id).collect::<Vec<_>>();

    let rooms = {
        let mut sessions = state
            .realtime_socket_state
            .lock()
            .expect("rust socket session mutex poisoned");
        sessions.authenticate(&session_id, &user_id, &username, access_token, &group_ids)
    };

    for room in &rooms {
        socket.join(room.clone());
        apply_ingress_envelope(
            state,
            &build_socket_event(
                &session_id,
                Some(&user_id),
                None,
                RealtimeTopic::SessionHeartbeat,
                None,
                json!({
                    "transport": "socket_io_compat",
                    "activity": "room_joined",
                    "roomId": room,
                    "status": "online"
                }),
            ),
        );
    }

    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            Some(&user_id),
            None,
            RealtimeTopic::SessionHeartbeat,
            None,
            json!({
                "transport": "socket_io_compat",
                "activity": "authenticate_success",
                "status": "online"
            }),
        ),
    );
    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            Some(&user_id),
            None,
            RealtimeTopic::PresenceUpdated,
            None,
            json!({
                "transport": "socket_io_compat",
                "status": "online",
                "reason": "authenticated"
            }),
        ),
    );

    let _ = socket.emit(
        "authenticated",
        &json!({
            "userId": user_id,
            "username": username,
        }),
    );

    Ok(())
}

async fn handle_join_room(
    state: &AppState,
    socket: &SocketRef,
    payload: RoomRequestPayload,
) -> Result<()> {
    let session_id = socket.id.to_string();
    let access_token = session_access_token(state, &session_id)?;
    let user_id = session_user_id(state, &session_id)?;
    ensure_group_access(state, &access_token, payload.room_id.trim()).await?;
    let room = {
        let mut sessions = state
            .realtime_socket_state
            .lock()
            .expect("rust socket session mutex poisoned");
        sessions
            .join_room(&session_id, &payload.room_id)
            .ok_or_else(|| anyhow!("SESSION_NOT_FOUND"))?
    };
    socket.join(room.clone());
    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            Some(&user_id),
            None,
            RealtimeTopic::SessionHeartbeat,
            None,
            json!({
                "transport": "socket_io_compat",
                "activity": "room_joined",
                "roomId": room,
                "status": "online"
            }),
        ),
    );
    Ok(())
}

async fn handle_leave_room(
    state: &AppState,
    socket: &SocketRef,
    payload: RoomRequestPayload,
) -> Result<()> {
    let session_id = socket.id.to_string();
    let user_id = session_user_id(state, &session_id)?;
    let room = {
        let mut sessions = state
            .realtime_socket_state
            .lock()
            .expect("rust socket session mutex poisoned");
        sessions
            .leave_room(&session_id, &payload.room_id)
            .ok_or_else(|| anyhow!("SESSION_NOT_FOUND"))?
    };
    socket.leave(room.clone());
    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            Some(&user_id),
            None,
            RealtimeTopic::SessionHeartbeat,
            None,
            json!({
                "transport": "socket_io_compat",
                "activity": "room_left",
                "roomId": room,
                "status": "online"
            }),
        ),
    );
    Ok(())
}

async fn handle_send_message(
    state: &AppState,
    socket: &SocketRef,
    payload: SendMessagePayload,
) -> Result<SocketMessageAck> {
    let session_id = socket.id.to_string();
    let access_token = session_access_token(state, &session_id)?;
    let user_id = session_user_id(state, &session_id)?;

    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            Some(&user_id),
            chat_id_from_send_payload(&payload),
            RealtimeTopic::MessageCommandRequested,
            None,
            json!({
                "transport": "socket_io_compat",
                "chatType": payload.chat_type,
                "receiverId": payload.receiver_id,
                "groupId": payload.group_id,
                "messageType": payload.r#type.clone().unwrap_or_else(|| "text".to_string()),
                "contentLength": payload.content.trim().chars().count(),
                "hasAttachments": payload.file_url.is_some()
                    || payload.file_name.is_some()
                    || payload.mime_type.is_some()
                    || payload
                        .attachments
                        .as_ref()
                        .map(|items: &Vec<Value>| !items.is_empty())
                        .unwrap_or(false),
            }),
        ),
    );

    let response = send_message(state, &access_token, &payload).await?;
    Ok(SocketMessageAck::ok(
        read_message_id(&response.data),
        read_seq(&response.data),
        payload.client_temp_id.clone(),
    ))
}

async fn handle_read_chat(
    state: &AppState,
    socket: &SocketRef,
    payload: ReadChatPayload,
) -> Result<()> {
    let session_id = socket.id.to_string();
    let access_token = session_access_token(state, &session_id)?;
    let user_id = session_user_id(state, &session_id)?;

    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            Some(&user_id),
            Some(payload.chat_id.clone()),
            RealtimeTopic::ReadAckRequested,
            None,
            json!({
                "transport": "socket_io_compat",
                "seq": payload.seq
            }),
        ),
    );

    let response = mark_chat_read(state, &access_token, &payload.chat_id, payload.seq).await?;
    emit_read_receipt(
        state,
        socket,
        &user_id,
        &response.chat_id,
        response.seq,
        response.read_count,
    )
    .await;
    Ok(())
}

fn handle_presence_subscribe(state: &AppState, socket: &SocketRef, user_ids: Vec<String>) {
    for target_id in user_ids
        .into_iter()
        .filter(|user_id| !user_id.trim().is_empty())
    {
        let is_online = {
            let registry = state
                .realtime_registry
                .lock()
                .expect("realtime registry mutex poisoned");
            registry
                .snapshot(state.config.realtime_heartbeat_stale_secs)
                .users
                .iter()
                .find(|user| user.user_id == target_id)
                .map(|user| user.authenticated_sessions > 0)
                .unwrap_or(false)
        };
        let _ = socket.emit(
            "realtimeBatch",
            &vec![json!({
                "type": "presence",
                "payload": {
                    "userId": target_id,
                    "isOnline": is_online
                }
            })],
        );
    }
}

async fn handle_typing_event(
    state: &AppState,
    socket: &SocketRef,
    payload: TypingPayload,
    is_typing: bool,
) {
    let session_id = socket.id.to_string();
    let Some(user_id) = session_user_id_optional(state, &session_id) else {
        return;
    };
    let username =
        session_username_optional(state, &session_id).unwrap_or_else(|| "Unknown".to_string());
    let event_name = if is_typing {
        "typingStart"
    } else {
        "typingStop"
    };
    let typing_payload = TypingServerPayload {
        user_id: user_id.clone(),
        username,
        group_id: payload.group_id.clone(),
    };

    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            Some(&user_id),
            payload
                .group_id
                .clone()
                .map(|group_id| format!("g:{group_id}")),
            RealtimeTopic::TypingUpdated,
            None,
            json!({
                "transport": "socket_io_compat",
                "isTyping": is_typing,
                "receiverId": payload.receiver_id,
                "groupId": payload.group_id,
            }),
        ),
    );

    if let Some(group_id) = payload.group_id {
        let target_room = normalize_group_room(&group_id);
        let mut operator = state
            .realtime_socket_io
            .as_ref()
            .expect("rust socket io missing")
            .within(target_room);
        operator = operator.except(session_room(&session_id));
        let _ = operator.emit(event_name, &typing_payload).await;
    } else if let Some(receiver_id) = payload.receiver_id {
        let _ = state
            .realtime_socket_io
            .as_ref()
            .expect("rust socket io missing")
            .within(user_room(&receiver_id))
            .emit(event_name, &typing_payload)
            .await;
    }
}

fn handle_disconnect(state: &AppState, socket: &SocketRef, reason: DisconnectReason) {
    let session_id = socket.id.to_string();
    let removed = {
        let mut sessions = state
            .realtime_socket_state
            .lock()
            .expect("rust socket session mutex poisoned");
        sessions.remove(&session_id)
    };
    let user_id = removed.as_ref().and_then(|record| record.user_id.clone());
    apply_ingress_envelope(
        state,
        &build_socket_event(
            &session_id,
            user_id.as_deref(),
            None,
            RealtimeTopic::SessionClosed,
            None,
            json!({
                "transport": "socket_io_compat",
                "closeReason": format!("{reason:?}"),
                "closedAt": chrono::Utc::now().to_rfc3339(),
                "status": if user_id.is_some() { "offline" } else { "unknown" }
            }),
        ),
    );
}

async fn emit_read_receipt(
    state: &AppState,
    socket: &SocketRef,
    reader_id: &str,
    chat_id: &str,
    seq: u64,
    read_count: u64,
) {
    let payload = json!([{
        "type": "readReceipt",
        "payload": {
            "chatId": chat_id,
            "seq": seq,
            "readCount": read_count,
            "readerId": reader_id
        }
    }]);

    match super::contracts::parse_chat_id(chat_id) {
        Some(super::contracts::ParsedChatId::Group { group_id }) => {
            let _ = state
                .realtime_socket_io
                .as_ref()
                .expect("rust socket io missing")
                .within(normalize_group_room(&group_id))
                .emit("realtimeBatch", &payload)
                .await;
        }
        Some(super::contracts::ParsedChatId::Private { .. }) => {
            if let Some(other_user_id) = other_private_user_id(chat_id, reader_id) {
                let _ = state
                    .realtime_socket_io
                    .as_ref()
                    .expect("rust socket io missing")
                    .within(user_room(&other_user_id))
                    .emit("realtimeBatch", &payload)
                    .await;
            }
        }
        None => {
            debug!(chat_id, "skip read receipt emit for invalid chat id");
            let _ = socket;
        }
    }
}

fn session_access_token(state: &AppState, session_id: &str) -> Result<String> {
    let sessions = state
        .realtime_socket_state
        .lock()
        .expect("rust socket session mutex poisoned");
    sessions
        .access_token(session_id)
        .ok_or_else(|| anyhow!("USER_NOT_AUTHENTICATED"))
}

fn session_user_id(state: &AppState, session_id: &str) -> Result<String> {
    session_user_id_optional(state, session_id).ok_or_else(|| anyhow!("USER_NOT_AUTHENTICATED"))
}

fn session_user_id_optional(state: &AppState, session_id: &str) -> Option<String> {
    let sessions = state
        .realtime_socket_state
        .lock()
        .expect("rust socket session mutex poisoned");
    sessions.user_id(session_id)
}

fn session_username_optional(state: &AppState, session_id: &str) -> Option<String> {
    let sessions = state
        .realtime_socket_state
        .lock()
        .expect("rust socket session mutex poisoned");
    sessions.username(session_id)
}

fn build_socket_event(
    session_id: &str,
    user_id: Option<&str>,
    chat_id: Option<String>,
    topic: RealtimeTopic,
    trace_id: Option<String>,
    payload: Value,
) -> RealtimeEventEnvelopeV1 {
    RealtimeEventEnvelopeV1 {
        spec_version: crate::realtime_contracts::REALTIME_EVENT_SPEC_VERSION.to_string(),
        event_id: uuid::Uuid::new_v4().to_string(),
        topic,
        emitted_at: chrono::Utc::now().to_rfc3339(),
        partition_key: chat_id
            .clone()
            .or_else(|| user_id.map(ToString::to_string))
            .unwrap_or_else(|| session_id.to_string()),
        trace_id: trace_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        source: RUST_SOCKET_IO_COMPAT_SOURCE.to_string(),
        session_id: session_id.to_string(),
        user_id: user_id.map(ToString::to_string),
        chat_id,
        payload,
    }
}

fn chat_id_from_send_payload(payload: &SendMessagePayload) -> Option<String> {
    match payload.chat_type.as_str() {
        "group" => payload
            .group_id
            .as_ref()
            .map(|group_id| format!("g:{group_id}")),
        "private" => None,
        _ => None,
    }
}

#[allow(dead_code)]
fn _room_message_schema_version() -> &'static str {
    ROOM_MESSAGE_SCHEMA_VERSION
}
