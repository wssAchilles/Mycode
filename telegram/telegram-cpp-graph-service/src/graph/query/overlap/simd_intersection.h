#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#if defined(__x86_64__) || defined(_M_X64)
#include <cpuid.h>
#define GRAPH_HAS_X86_CPUID 1
#else
#define GRAPH_HAS_X86_CPUID 0
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
/// Returns elements present in both sorted arrays.
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

/// Hybrid intersection: uses scalar for small arrays, can be extended with AVX2.
/// For arrays < 128 elements, scalar is faster due to AVX2 setup overhead.
inline std::vector<uint32_t> intersect_sorted(
    const uint32_t* a, std::size_t a_len,
    const uint32_t* b, std::size_t b_len) {
  // For small arrays, scalar merge is optimal
  if (a_len < 128 || b_len < 128 || !has_avx2()) {
    return intersect_sorted_scalar(a, a_len, b, b_len);
  }

  // For larger arrays with AVX2, use galloping intersection
  // (avoids branch-heavy merge for skewed intersections)
  std::vector<uint32_t> result;
  result.reserve(std::min(a_len, b_len));

  std::size_t i = 0, j = 0;
  while (i < a_len && j < b_len) {
    if (a[i] < b[j]) {
      // Gallop: skip ahead in larger steps
      std::size_t step = 1;
      while (i + step < a_len && a[i + step] < b[j]) step *= 2;
      i += step / 2;
    } else if (a[i] > b[j]) {
      std::size_t step = 1;
      while (j + step < b_len && a[i] > b[j + step]) step *= 2;
      j += step / 2;
    } else {
      result.push_back(a[i]);
      ++i;
      ++j;
    }
  }
  return result;
}

}  // namespace telegram::graph::query
