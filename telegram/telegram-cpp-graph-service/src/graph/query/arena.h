#pragma once

#include <array>
#include <cstddef>
#include <memory_resource>
#include <vector>

namespace telegram::graph::core::query {

// Request-scoped arena allocator for query temporaries.
//
// Uses a stack-allocated buffer as the backing store for a monotonic
// memory resource.  Allocations are bump-pointer fast; all memory is
// released at once when the arena is destroyed (end of request).
//
// Template parameter controls the stack buffer size.  If a single
// request exceeds this, the monotonic resource falls back to the
// upstream resource (default: operator new / operator delete).
template <std::size_t BufferSize = 8192>
class QueryArena {
 public:
  explicit QueryArena(std::pmr::memory_resource* upstream = std::pmr::get_default_resource())
      : monotonic_(buffer_.data(), buffer_.size(), upstream) {}

  // Not copyable or movable -- lives on the stack for one request.
  QueryArena(const QueryArena&) = delete;
  QueryArena& operator=(const QueryArena&) = delete;

  std::pmr::memory_resource* resource() { return &monotonic_; }
  std::pmr::polymorphic_allocator<std::byte> allocator() { return std::pmr::polymorphic_allocator<std::byte>(&monotonic_); }

 private:
  std::array<std::byte, BufferSize> buffer_;
  std::pmr::monotonic_buffer_resource monotonic_;
};

}  // namespace telegram::graph::core::query
