#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>

#if defined(__x86_64__) || defined(_M_X64)
#include <cpuid.h>
#define GRAPH_HAS_X86_CPUID 1
#else
#define GRAPH_HAS_X86_CPUID 0
#endif

#if GRAPH_HAS_X86_CPUID
#include <immintrin.h>
#endif

namespace telegram::graph::query {

/// Check if AVX2 is available at runtime.
inline bool has_avx2() {
#if GRAPH_HAS_X86_CPUID
  static const bool cached = [] {
    unsigned int eax, ebx, ecx, edx;
    if (__get_cpuid_count(7, 0, &eax, &ebx, &ecx, &edx)) {
      return (ebx & (1 << 5)) != 0;  // AVX2 bit
    }
    return false;
  }();
  return cached;
#else
  return false;
#endif
}

/// Scalar sorted set intersection (baseline).
inline std::vector<uint32_t> intersect_sorted_scalar(
    const uint32_t* a, std::size_t a_len,
    const uint32_t* b, std::size_t b_len) {
  std::vector<uint32_t> result;
  result.reserve(std::min(a_len, b_len));

  std::size_t i = 0, j = 0;
  while (i < a_len && j < b_len) {
    if (a[i] < b[j]) {
      ++i;
    } else if (a[i] > b[j]) {
      ++j;
    } else {
      result.push_back(a[i]);
      ++i;
      ++j;
    }
  }
  return result;
}

#if GRAPH_HAS_X86_CPUID
/// AVX2 broadcast-based sorted set intersection.
/// For each element in the shorter array, broadcast it into a YMM register
/// and scan the longer array in 8-element chunks.
inline std::vector<uint32_t> intersect_sorted_avx2(
    const uint32_t* a, std::size_t a_len,
    const uint32_t* b, std::size_t b_len) {
  // Ensure `a` is the shorter array for fewer broadcasts
  if (a_len > b_len) {
    return intersect_sorted_avx2(b, b_len, a, a_len);
  }

  std::vector<uint32_t> result;
  result.reserve(std::min(a_len, b_len));

  const __m256i* b_vec = reinterpret_cast<const __m256i*>(b);
  const std::size_t b_vec_len = b_len / 8;

  std::size_t j = 0;

  for (std::size_t i = 0; i < a_len; ++i) {
    const uint32_t key = a[i];

    // Scalar fast-path: skip past smaller elements in b
    while (j < b_len && b[j] < key) ++j;
    if (j >= b_len) break;
    if (b[j] == key) {
      result.push_back(key);
      ++j;
      continue;
    }

    const __m256i broadcast = _mm256_set1_epi32(static_cast<int>(key));

    std::size_t vec_start = j / 8;
    for (std::size_t v = vec_start; v < b_vec_len; ++v) {
      const uint32_t chunk_first = b[v * 8];
      if (chunk_first > key) break;

      const uint32_t chunk_last = b[v * 8 + 7];
      if (chunk_last < key) {
        j = (v + 1) * 8;
        continue;
      }

      const __m256i chunk = _mm256_loadu_si256(&b_vec[v]);
      const __m256i cmp = _mm256_cmpeq_epi32(chunk, broadcast);
      const int mask = _mm256_movemask_epi8(cmp);

      if (mask != 0) {
        const int lane = __builtin_ctz(mask) / 4;
        result.push_back(key);
        j = v * 8 + lane + 1;
        break;
      }
    }
  }

  return result;
}
#endif

/// Hybrid intersection: dispatches to the best available algorithm.
inline std::vector<uint32_t> intersect_sorted(
    const uint32_t* a, std::size_t a_len,
    const uint32_t* b, std::size_t b_len) {
  if (a_len < 128 || b_len < 128 || !has_avx2()) {
    return intersect_sorted_scalar(a, a_len, b, b_len);
  }

#if GRAPH_HAS_X86_CPUID
  return intersect_sorted_avx2(a, a_len, b, b_len);
#else
  return intersect_sorted_scalar(a, a_len, b, b_len);
#endif
}

}  // namespace telegram::graph::query
