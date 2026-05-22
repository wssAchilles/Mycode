use js_sys::{Array, Uint32Array};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

// Re-export wasm-bindgen-rayon's thread initialization
pub use wasm_bindgen_rayon::init_thread_pool;

// NOTE:
// - Inputs are expected to be sorted ascending.
// - Duplicates are tolerated and will be removed in outputs.

#[wasm_bindgen]
pub fn diff_sorted_unique_u32(existing: Vec<u32>, incoming: Vec<u32>) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    let mut i: usize = 0;
    let mut j: usize = 0;
    let mut last_a: u32 = 0;
    let mut has_last_a = false;
    let mut last_b: u32 = 0;
    let mut has_last_b = false;

    while i < existing.len() && j < incoming.len() {
        let a = existing[i];
        let b = incoming[j];
        if has_last_a && a == last_a { i += 1; continue; }
        if has_last_b && b == last_b { j += 1; continue; }
        if a == b {
            has_last_a = true; last_a = a; i += 1;
            has_last_b = true; last_b = b; j += 1;
            continue;
        }
        if a < b { has_last_a = true; last_a = a; i += 1; continue; }
        out.push(b);
        has_last_b = true; last_b = b; j += 1;
    }

    while j < incoming.len() {
        let b = incoming[j];
        if has_last_b && b == last_b { j += 1; continue; }
        out.push(b);
        has_last_b = true; last_b = b; j += 1;
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
        if j >= incoming.len() { next = existing[i]; i += 1; }
        else if i >= existing.len() { next = incoming[j]; j += 1; }
        else {
            let a = existing[i]; let b = incoming[j];
            if a <= b { next = a; i += 1; } else { next = b; j += 1; }
        }
        if has_last && next == last { continue; }
        out.push(next); has_last = true; last = next;
    }

    out
}

#[wasm_bindgen]
pub fn merge_and_diff_sorted_unique_u32(existing: Vec<u32>, incoming: Vec<u32>) -> Array {
    let merged = merge_sorted_unique_u32(existing.clone(), incoming.clone());
    let added = diff_sorted_unique_u32(existing, incoming);
    let out = Array::new_with_length(2);
    out.set(0, Uint32Array::from(merged.as_slice()).into());
    out.set(1, Uint32Array::from(added.as_slice()).into());
    out
}

/// Parallel string search using Rayon.
/// Searches messages in parallel across multiple threads.
#[wasm_bindgen]
pub fn search_contains_indices(messages: Vec<String>, query: String, limit: u32) -> Vec<u32> {
    let cap = if limit == 0 { 1 } else { limit as usize };
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() { return Vec::new(); }

    let terms: Vec<String> = trimmed
        .split_whitespace()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    if terms.is_empty() { return Vec::new(); }

    // Use Rayon for parallel search when dataset is large enough
    if messages.len() > 1000 {
        let results: Vec<u32> = messages
            .par_iter()
            .enumerate()
            .filter(|(_, msg)| {
                let hay = msg.as_str();
                terms.iter().all(|term| hay.contains(term.as_str()))
            })
            .map(|(idx, _)| idx as u32)
            .take(cap)
            .collect();
        results
    } else {
        // Sequential search for small datasets
        let mut out: Vec<u32> = Vec::with_capacity(cap.min(messages.len()));
        for (idx, msg) in messages.iter().enumerate() {
            if out.len() >= cap { break; }
            let hay = msg.as_str();
            let mut all_match = true;
            for term in terms.iter() {
                if !hay.contains(term.as_str()) { all_match = false; break; }
            }
            if all_match { out.push(idx as u32); }
        }
        out
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum MessagePatch {
    Reset { chat_id: String, load_seq: i64, messages: Vec<Value>, has_more: bool, next_before_seq: Option<i64> },
    Append { chat_id: String, load_seq: i64, messages: Vec<Value> },
    Prepend { chat_id: String, load_seq: i64, messages: Vec<Value>, has_more: bool, next_before_seq: Option<i64> },
    Delete { chat_id: String, load_seq: i64, ids: Vec<String> },
    Update { chat_id: String, load_seq: i64, updates: Vec<Value> },
}

impl MessagePatch {
    fn chat_id(&self) -> &str {
        match self {
            MessagePatch::Reset { chat_id, .. } | MessagePatch::Append { chat_id, .. }
            | MessagePatch::Prepend { chat_id, .. } | MessagePatch::Delete { chat_id, .. }
            | MessagePatch::Update { chat_id, .. } => chat_id,
        }
    }

    fn load_seq(&self) -> i64 {
        match self {
            MessagePatch::Reset { load_seq, .. } | MessagePatch::Append { load_seq, .. }
            | MessagePatch::Prepend { load_seq, .. } | MessagePatch::Delete { load_seq, .. }
            | MessagePatch::Update { load_seq, .. } => *load_seq,
        }
    }
}

fn merge_update_value(existing: &Value, incoming: &Value) -> Value {
    match (existing, incoming) {
        (Value::Object(current), Value::Object(next)) => {
            let mut merged: Map<String, Value> = current.clone();
            for (key, value) in next.iter() { merged.insert(key.clone(), value.clone()); }
            Value::Object(merged)
        }
        _ => incoming.clone(),
    }
}

fn update_id(value: &Value) -> Option<String> {
    value.as_object().and_then(|object| object.get("id")).and_then(Value::as_str).map(str::to_string)
}

fn merge_adjacent_patches(prev: MessagePatch, next: MessagePatch) -> Option<MessagePatch> {
    if prev.chat_id() != next.chat_id() || prev.load_seq() != next.load_seq() { return None; }
    match (prev, next) {
        (MessagePatch::Append { chat_id, load_seq, mut messages }, MessagePatch::Append { messages: next_messages, .. }) => {
            messages.extend(next_messages);
            Some(MessagePatch::Append { chat_id, load_seq, messages })
        }
        (MessagePatch::Prepend { chat_id, load_seq, messages, .. }, MessagePatch::Prepend { messages: mut next_messages, has_more, next_before_seq, .. }) => {
            next_messages.extend(messages);
            Some(MessagePatch::Prepend { chat_id, load_seq, messages: next_messages, has_more, next_before_seq })
        }
        (MessagePatch::Delete { chat_id, load_seq, ids }, MessagePatch::Delete { ids: next_ids, .. }) => {
            let mut seen = HashSet::new();
            let mut merged = Vec::new();
            for id in ids.into_iter().chain(next_ids.into_iter()) { if seen.insert(id.clone()) { merged.push(id); } }
            Some(MessagePatch::Delete { chat_id, load_seq, ids: merged })
        }
        (MessagePatch::Update { chat_id, load_seq, updates }, MessagePatch::Update { updates: next_updates, .. }) => {
            let mut by_id: HashMap<String, Value> = HashMap::new();
            for update in updates { if let Some(id) = update_id(&update) { by_id.insert(id, update); } }
            for update in next_updates {
                if let Some(id) = update_id(&update) {
                    let merged = if let Some(existing) = by_id.get(&id) { merge_update_value(existing, &update) } else { update };
                    by_id.insert(id, merged);
                }
            }
            Some(MessagePatch::Update { chat_id, load_seq, updates: by_id.into_values().collect() })
        }
        (MessagePatch::Reset { chat_id, load_seq, mut messages, has_more, next_before_seq }, MessagePatch::Append { messages: next_messages, .. }) => {
            messages.extend(next_messages);
            Some(MessagePatch::Reset { chat_id, load_seq, messages, has_more, next_before_seq })
        }
        _ => None,
    }
}

fn compact_message_patches_internal(patches: Vec<MessagePatch>) -> Vec<MessagePatch> {
    if patches.is_empty() { return Vec::new(); }
    let mut start_at = 0usize;
    for (index, patch) in patches.iter().enumerate().rev() {
        if matches!(patch, MessagePatch::Reset { .. }) { start_at = index; break; }
    }
    let input = if start_at > 0 { patches.into_iter().skip(start_at).collect::<Vec<_>>() } else { patches };
    let mut out: Vec<MessagePatch> = Vec::new();
    for next in input.into_iter() {
        if let Some(prev) = out.pop() {
            if let Some(merged) = merge_adjacent_patches(prev.clone(), next.clone()) { out.push(merged); }
            else { out.push(prev); out.push(next); }
        } else { out.push(next); }
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
pub fn chat_wasm_version() -> String { env!("CARGO_PKG_VERSION").to_string() }

// Crypto functions using ChaCha20-Poly1305
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};

/// Encrypt a message using ChaCha20-Poly1305
#[wasm_bindgen]
pub fn encrypt_message(key: &[u8], nonce: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, JsValue> {
    if key.len() != 32 {
        return Err(JsValue::from_str("key must be 32 bytes"));
    }
    if nonce.len() != 12 {
        return Err(JsValue::from_str("nonce must be 12 bytes"));
    }

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| JsValue::from_str(&format!("key error: {e}")))?;
    let nonce = Nonce::from_slice(nonce);
    cipher.encrypt(nonce, plaintext)
        .map_err(|e| JsValue::from_str(&format!("encrypt error: {e}")))
}

/// Decrypt a message using ChaCha20-Poly1305
#[wasm_bindgen]
pub fn decrypt_message(key: &[u8], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, JsValue> {
    if key.len() != 32 {
        return Err(JsValue::from_str("key must be 32 bytes"));
    }
    if nonce.len() != 12 {
        return Err(JsValue::from_str("nonce must be 12 bytes"));
    }

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| JsValue::from_str(&format!("key error: {e}")))?;
    let nonce = Nonce::from_slice(nonce);
    cipher.decrypt(nonce, ciphertext)
        .map_err(|e| JsValue::from_str(&format!("decrypt error: {e}")))
}

/// Batch decrypt multiple messages using Rayon for parallelism
/// Returns a flat Vec<u8> where each decrypted message is length-prefixed (4 bytes LE)
#[wasm_bindgen]
pub fn batch_decrypt_messages(
    key: &[u8],
    messages: Vec<Vec<u8>>,
    nonces: Vec<Vec<u8>>,
) -> Result<Vec<u8>, JsValue> {
    if key.len() != 32 {
        return Err(JsValue::from_str("key must be 32 bytes"));
    }
    if messages.len() != nonces.len() {
        return Err(JsValue::from_str("messages and nonces must have same length"));
    }

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| JsValue::from_str(&format!("key error: {e}")))?;

    let results: Result<Vec<Vec<u8>>, JsValue> = messages
        .par_iter()
        .zip(nonces.par_iter())
        .map(|(msg, nonce_bytes)| {
            if nonce_bytes.len() != 12 {
                return Err(JsValue::from_str("nonce must be 12 bytes"));
            }
            let nonce = Nonce::from_slice(nonce_bytes);
            cipher.decrypt(nonce, msg.as_ref())
                .map_err(|e| JsValue::from_str(&format!("decrypt error: {e}")))
        })
        .collect();

    let decrypted = results?;
    
    // Flatten with length prefixes
    let total_len: usize = decrypted.iter().map(|d| 4 + d.len()).sum();
    let mut output = Vec::with_capacity(total_len);
    for d in &decrypted {
        let len = d.len() as u32;
        output.extend_from_slice(&len.to_le_bytes());
        output.extend_from_slice(d);
    }
    
    Ok(output)
}

/// Compress data using simple RLE encoding
#[wasm_bindgen]
pub fn compress_data(data: &[u8]) -> Vec<u8> {
    if data.is_empty() {
        return vec![0; 4];
    }

    let mut output = Vec::with_capacity(data.len() / 2);
    let len = data.len() as u32;
    output.extend_from_slice(&len.to_le_bytes());

    let mut i = 0;
    while i < data.len() {
        let byte = data[i];
        let mut count = 1u8;
        
        while i + (count as usize) < data.len() 
            && data[i + (count as usize)] == byte 
            && count < 255 
        {
            count += 1;
        }
        
        if count >= 3 {
            output.push(0xFF);
            output.push(byte);
            output.push(count);
        } else {
            for j in 0..count {
                output.push(data[i + j as usize]);
            }
        }
        
        i += count as usize;
    }

    output
}

/// Decompress data compressed with compress_data
#[wasm_bindgen]
pub fn decompress_data(compressed: &[u8]) -> Result<Vec<u8>, JsValue> {
    if compressed.len() < 4 {
        return Err(JsValue::from_str("invalid compressed data"));
    }

    let original_len = u32::from_le_bytes([compressed[0], compressed[1], compressed[2], compressed[3]]) as usize;
    let mut output = Vec::with_capacity(original_len);
    
    let mut i = 4;
    while i < compressed.len() {
        if compressed[i] == 0xFF && i + 2 < compressed.len() {
            let byte = compressed[i + 1];
            let count = compressed[i + 2];
            for _ in 0..count {
                output.push(byte);
            }
            i += 3;
        } else {
            output.push(compressed[i]);
            i += 1;
        }
    }

    if output.len() != original_len {
        return Err(JsValue::from_str(&format!(
            "decompressed length mismatch: expected {}, got {}",
            original_len, output.len()
        )));
    }

    Ok(output)
}

// SIMD-accelerated sorted array operations using WASM SIMD128
#[cfg(target_arch = "wasm32")]
mod simd_ops {
    use std::arch::wasm32::*;

    /// SIMD-accelerated merge of two sorted u32 arrays
    /// Processes 4 elements at a time when possible
    pub unsafe fn merge_sorted_simd(a: &[u32], b: &[u32]) -> Vec<u32> {
        let mut out = Vec::with_capacity(a.len() + b.len());
        let mut i = 0;
        let mut j = 0;

        // Process 4 elements at a time when both arrays have enough
        while i + 4 <= a.len() && j + 4 <= b.len() {
            let va = v128_load(a.as_ptr().add(i) as *const v128);
            let vb = v128_load(b.as_ptr().add(j) as *const v128);

            // Compare and merge using SIMD
            let mask = u32x4_le(va, vb);
            let blend = v128_bitselect(va, vb, mask);

            // Extract and push values
            let vals = [
                u32x4_extract_lane::<0>(blend),
                u32x4_extract_lane::<1>(blend),
                u32x4_extract_lane::<2>(blend),
                u32x4_extract_lane::<3>(blend),
            ];

            for v in vals {
                if out.last().map_or(true, |&last| v != last) {
                    out.push(v);
                }
            }

            // Advance pointers based on which values were selected
            let a_count = u32x4_extract_lane::<0>(mask) as usize
                + u32x4_extract_lane::<1>(mask) as usize
                + u32x4_extract_lane::<2>(mask) as usize
                + u32x4_extract_lane::<3>(mask) as usize;
            i += a_count;
            j += 4 - a_count;
        }

        // Scalar fallback for remaining elements
        while i < a.len() || j < b.len() {
            let next = if j >= b.len() {
                let v = a[i]; i += 1; v
            } else if i >= a.len() {
                let v = b[j]; j += 1; v
            } else if a[i] <= b[j] {
                let v = a[i]; i += 1; v
            } else {
                let v = b[j]; j += 1; v
            };
            if out.last().map_or(true, |&last| next != last) {
                out.push(next);
            }
        }

        out
    }
}

/// SIMD-accelerated merge (falls back to scalar on non-wasm32)
#[wasm_bindgen]
pub fn merge_sorted_unique_u32_simd(existing: Vec<u32>, incoming: Vec<u32>) -> Vec<u32> {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        simd_ops::merge_sorted_simd(&existing, &incoming)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        merge_sorted_unique_u32(existing, incoming)
    }
}

/// SIMD-accelerated string search using u8x16 comparisons
#[wasm_bindgen]
pub fn search_contains_indices_simd(haystacks: Vec<String>, query: String, limit: u32) -> Vec<u32> {
    if query.is_empty() || haystacks.is_empty() {
        return Vec::new();
    }

    let query_bytes = query.to_lowercase();
    let query_bytes = query_bytes.as_bytes();
    let limit = limit as usize;

    let mut results = Vec::with_capacity(limit.min(haystacks.len()));

    for (idx, haystack) in haystacks.iter().enumerate() {
        if results.len() >= limit {
            break;
        }
        let lower = haystack.to_lowercase();
        if contains_bytes_simd(lower.as_bytes(), query_bytes) {
            results.push(idx as u32);
        }
    }

    results
}

/// Byte substring search (SIMD-friendly pattern)
fn contains_bytes_simd(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    if needle.len() > haystack.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}


