#pragma once

#include <algorithm>
#include <cstddef>
#include <iterator>

namespace telegram::graph::core::ranking {

template <typename Iterator, typename Comparator>
void sort_top_k(Iterator begin, Iterator end, const std::size_t limit, Comparator comparator) {
  const auto size = static_cast<std::size_t>(std::distance(begin, end));
  if (limit == 0) {
    return;
  }
  if (size <= limit) {
    std::sort(begin, end, comparator);
    return;
  }
  std::partial_sort(
      begin,
      std::next(begin, static_cast<typename std::iterator_traits<Iterator>::difference_type>(limit)),
      end,
      comparator);
}

}  // namespace telegram::graph::core::ranking
