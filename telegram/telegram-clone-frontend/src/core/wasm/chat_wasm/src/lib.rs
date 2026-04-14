use js_sys::{Array, Uint32Array};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

// NOTE:
// - Inputs are expected to be sorted ascending.
// - Duplicates are tolerated and will be removed in outputs.

#[wasm_bindgen]
pub fn diff_sorted_unique_u32(existing: Vec<u32>, incoming: Vec<u32>) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();

    let mut i: usize = 0;
    let mut j: usize = 0;

    // Skip duplicates within each list while diffing.
    let mut last_a: u32 = 0;
    let mut has_last_a = false;
    let mut last_b: u32 = 0;
    let mut has_last_b = false;

    while i < existing.len() && j < incoming.len() {
        let a = existing[i];
        let b = incoming[j];

        if has_last_a && a == last_a {
            i += 1;
            continue;
        }
        if has_last_b && b == last_b {
            j += 1;
            continue;
        }

        if a == b {
            has_last_a = true;
            last_a = a;
            i += 1;

            has_last_b = true;
            last_b = b;
            j += 1;
            continue;
        }

        if a < b {
            has_last_a = true;
            last_a = a;
            i += 1;
            continue;
        }

        // b < a => b is new (in incoming but not in existing at current position).
        out.push(b);
        has_last_b = true;
        last_b = b;
        j += 1;
    }

    while j < incoming.len() {
        let b = incoming[j];
        if has_last_b && b == last_b {
            j += 1;
            continue;
        }
        out.push(b);
        has_last_b = true;
        last_b = b;
        j += 1;
    }

    out
}

#[wasm_bindgen]
pub fn merge_sorted_unique_u32(existing: Vec<u32>, incoming: Vec<u32>) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::with_capacity(existing.len().saturating_add(incoming.len()));

    let mut i: usize = 0;
    let mut j: usize = 0;
    let mut last: u32 = 0;
    let mut has_last = false;

    while i < existing.len() || j < incoming.len() {
        let next: u32;

        if j >= incoming.len() {
            next = existing[i];
            i += 1;
        } else if i >= existing.len() {
            next = incoming[j];
            j += 1;
        } else {
            let a = existing[i];
            let b = incoming[j];
            if a <= b {
                next = a;
                i += 1;
            } else {
                next = b;
                j += 1;
            }
        }

        if has_last && next == last {
            continue;
        }
        out.push(next);
        has_last = true;
        last = next;
    }

    out
}

#[wasm_bindgen]
pub fn merge_and_diff_sorted_unique_u32(existing: Vec<u32>, incoming: Vec<u32>) -> Array {
    // Keep this in a single WASM boundary crossing:
    // even if we reuse internal routines, this still avoids two JS->WASM calls.
    let merged = merge_sorted_unique_u32(existing.clone(), incoming.clone());
    let added = diff_sorted_unique_u32(existing, incoming);

    let out = Array::new_with_length(2);
    out.set(0, Uint32Array::from(merged.as_slice()).into());
    out.set(1, Uint32Array::from(added.as_slice()).into());
    out
}

#[wasm_bindgen]
pub fn search_contains_indices(messages: Vec<String>, query: String, limit: u32) -> Vec<u32> {
    let cap = if limit == 0 { 1 } else { limit as usize };
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let terms: Vec<String> = trimmed
        .split_whitespace()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    if terms.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<u32> = Vec::with_capacity(cap.min(messages.len()));
    for (idx, msg) in messages.iter().enumerate() {
        if out.len() >= cap {
            break;
        }
        // Caller passes pre-lowercased haystacks to avoid per-query lowercase allocations.
        let hay = msg.as_str();
        let mut all_match = true;
        for term in terms.iter() {
            if !hay.contains(term.as_str()) {
                all_match = false;
                break;
            }
        }

        if all_match {
            out.push(idx as u32);
        }
    }

    out
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum MessagePatch {
    Reset {
        chat_id: String,
        load_seq: i64,
        messages: Vec<Value>,
        has_more: bool,
        next_before_seq: Option<i64>,
    },
    Append {
        chat_id: String,
        load_seq: i64,
        messages: Vec<Value>,
    },
    Prepend {
        chat_id: String,
        load_seq: i64,
        messages: Vec<Value>,
        has_more: bool,
        next_before_seq: Option<i64>,
    },
    Delete {
        chat_id: String,
        load_seq: i64,
        ids: Vec<String>,
    },
    Update {
        chat_id: String,
        load_seq: i64,
        updates: Vec<Value>,
    },
}

impl MessagePatch {
    fn chat_id(&self) -> &str {
        match self {
            MessagePatch::Reset { chat_id, .. }
            | MessagePatch::Append { chat_id, .. }
            | MessagePatch::Prepend { chat_id, .. }
            | MessagePatch::Delete { chat_id, .. }
            | MessagePatch::Update { chat_id, .. } => chat_id,
        }
    }

    fn load_seq(&self) -> i64 {
        match self {
            MessagePatch::Reset { load_seq, .. }
            | MessagePatch::Append { load_seq, .. }
            | MessagePatch::Prepend { load_seq, .. }
            | MessagePatch::Delete { load_seq, .. }
            | MessagePatch::Update { load_seq, .. } => *load_seq,
        }
    }
}

fn merge_update_value(existing: &Value, incoming: &Value) -> Value {
    match (existing, incoming) {
        (Value::Object(current), Value::Object(next)) => {
            let mut merged: Map<String, Value> = current.clone();
            for (key, value) in next.iter() {
                merged.insert(key.clone(), value.clone());
            }
            Value::Object(merged)
        }
        _ => incoming.clone(),
    }
}

fn update_id(value: &Value) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn merge_adjacent_patches(prev: MessagePatch, next: MessagePatch) -> Option<MessagePatch> {
    if prev.chat_id() != next.chat_id() || prev.load_seq() != next.load_seq() {
        return None;
    }

    match (prev, next) {
        (
            MessagePatch::Append {
                chat_id,
                load_seq,
                mut messages,
            },
            MessagePatch::Append { messages: next_messages, .. },
        ) => {
            messages.extend(next_messages);
            Some(MessagePatch::Append {
                chat_id,
                load_seq,
                messages,
            })
        }
        (
            MessagePatch::Prepend {
                chat_id,
                load_seq,
                messages,
                ..
            },
            MessagePatch::Prepend {
                messages: mut next_messages,
                has_more,
                next_before_seq,
                ..
            },
        ) => {
            next_messages.extend(messages);
            Some(MessagePatch::Prepend {
                chat_id,
                load_seq,
                messages: next_messages,
                has_more,
                next_before_seq,
            })
        }
        (
            MessagePatch::Delete {
                chat_id,
                load_seq,
                ids,
            },
            MessagePatch::Delete { ids: next_ids, .. },
        ) => {
            let mut seen = HashSet::new();
            let mut merged = Vec::new();
            for id in ids.into_iter().chain(next_ids.into_iter()) {
                if seen.insert(id.clone()) {
                    merged.push(id);
                }
            }
            Some(MessagePatch::Delete {
                chat_id,
                load_seq,
                ids: merged,
            })
        }
        (
            MessagePatch::Update {
                chat_id,
                load_seq,
                updates,
            },
            MessagePatch::Update {
                updates: next_updates,
                ..
            },
        ) => {
            let mut by_id: HashMap<String, Value> = HashMap::new();
            for update in updates {
                if let Some(id) = update_id(&update) {
                    by_id.insert(id, update);
                }
            }
            for update in next_updates {
                if let Some(id) = update_id(&update) {
                    let merged = if let Some(existing) = by_id.get(&id) {
                        merge_update_value(existing, &update)
                    } else {
                        update
                    };
                    by_id.insert(id, merged);
                }
            }
            Some(MessagePatch::Update {
                chat_id,
                load_seq,
                updates: by_id.into_values().collect(),
            })
        }
        (
            MessagePatch::Reset {
                chat_id,
                load_seq,
                mut messages,
                has_more,
                next_before_seq,
            },
            MessagePatch::Append {
                messages: next_messages,
                ..
            },
        ) => {
            messages.extend(next_messages);
            Some(MessagePatch::Reset {
                chat_id,
                load_seq,
                messages,
                has_more,
                next_before_seq,
            })
        }
        _ => None,
    }
}

fn compact_message_patches_internal(patches: Vec<MessagePatch>) -> Vec<MessagePatch> {
    if patches.is_empty() {
        return Vec::new();
    }

    let mut start_at = 0usize;
    for (index, patch) in patches.iter().enumerate().rev() {
        if matches!(patch, MessagePatch::Reset { .. }) {
            start_at = index;
            break;
        }
    }

    let input = if start_at > 0 {
        patches.into_iter().skip(start_at).collect::<Vec<_>>()
    } else {
        patches
    };

    let mut out: Vec<MessagePatch> = Vec::new();
    for next in input.into_iter() {
        if let Some(prev) = out.pop() {
            if let Some(merged) = merge_adjacent_patches(prev.clone(), next.clone()) {
                out.push(merged);
            } else {
                out.push(prev);
                out.push(next);
            }
        } else {
            out.push(next);
        }
    }
    out
}

#[wasm_bindgen]
pub fn compact_message_patches(patches: JsValue) -> Result<JsValue, JsValue> {
    let parsed: Vec<MessagePatch> = serde_wasm_bindgen::from_value(patches)
        .map_err(|err| JsValue::from_str(&format!("compact_message_patches parse failed: {err}")))?;
    serde_wasm_bindgen::to_value(&compact_message_patches_internal(parsed))
        .map_err(|err| JsValue::from_str(&format!("compact_message_patches serialize failed: {err}")))
}

#[wasm_bindgen]
pub fn chat_wasm_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
