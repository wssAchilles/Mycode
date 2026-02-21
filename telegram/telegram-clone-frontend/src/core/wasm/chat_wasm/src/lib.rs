use js_sys::{Array, Uint32Array};
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
        let hay = msg.to_lowercase();
        let mut all_match = true;
        for term in terms.iter() {
            if !hay.contains(term) {
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

#[wasm_bindgen]
pub fn chat_wasm_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
