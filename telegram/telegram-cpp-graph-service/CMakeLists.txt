cmake_minimum_required(VERSION 3.20)

project(telegram_cpp_graph_service LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ---------------------------------------------------------------------------
# Sanitizer options (consumed by CMakePresets.json profiles)
# ---------------------------------------------------------------------------
option(GRAPH_ENABLE_ASAN  "Enable AddressSanitizer"  OFF)
option(GRAPH_ENABLE_TSAN  "Enable ThreadSanitizer"   OFF)
option(GRAPH_ENABLE_UBSAN "Enable UndefinedBehaviorSanitizer" OFF)

# ---------------------------------------------------------------------------
# Link-Time Optimization for Release builds
# ---------------------------------------------------------------------------
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT DEFINED CMAKE_INTERPROCEDURAL_OPTIMIZATION)
  include(CheckIPOSupported)
  check_ipo_supported(RESULT ipo_supported OUTPUT ipo_output)
  if(ipo_supported)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)
  else()
    message(WARNING "IPO/LTO not supported by this toolchain: ${ipo_output}")
  endif()
endif()

find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(Threads REQUIRED)

add_library(telegram-cpp-graph-core
  src/config/config.cpp
  src/graph/graph_store.cpp
  src/http/routes/graph_routes.cpp
  src/http/routes/request_validation.cpp
  src/http/runtime/http_server.cpp
  src/ops/metrics.cpp
  src/ops/summaries/http_runtime_summary.cpp
  src/ops/summaries/kernel_summary.cpp
  src/ops/summaries/snapshot_summary.cpp
  src/snapshot/backend_snapshot_client.cpp
  src/snapshot/snapshot_loader.cpp
)

target_include_directories(telegram-cpp-graph-core PUBLIC src)

target_link_libraries(telegram-cpp-graph-core
  PUBLIC
    CURL::libcurl
    nlohmann_json::nlohmann_json
    Threads::Threads
)

target_compile_options(telegram-cpp-graph-core PRIVATE
  -Wall
  -Wextra
  -Wpedantic
)

# ---------------------------------------------------------------------------
# Apply sanitizer flags to core library (propagates to all linked targets)
# ---------------------------------------------------------------------------
set(_sanitizer_compile_flags "")
set(_sanitizer_link_flags "")

if(GRAPH_ENABLE_ASAN)
  list(APPEND _sanitizer_compile_flags -fsanitize=address -fno-omit-frame-pointer)
  list(APPEND _sanitizer_link_flags    -fsanitize=address)
endif()

if(GRAPH_ENABLE_TSAN)
  list(APPEND _sanitizer_compile_flags -fsanitize=thread -fno-omit-frame-pointer)
  list(APPEND _sanitizer_link_flags    -fsanitize=thread)
endif()

if(GRAPH_ENABLE_UBSAN)
  list(APPEND _sanitizer_compile_flags -fsanitize=undefined)
  list(APPEND _sanitizer_link_flags    -fsanitize=undefined)
endif()

if(_sanitizer_compile_flags)
  target_compile_options(telegram-cpp-graph-core PUBLIC ${_sanitizer_compile_flags})
  target_link_options(telegram-cpp-graph-core PUBLIC ${_sanitizer_link_flags})
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Release")
  target_compile_options(telegram-cpp-graph-core PRIVATE -O3 -march=native)
endif()

add_executable(telegram-cpp-graph-service
  src/main.cpp
)

target_link_libraries(telegram-cpp-graph-service PRIVATE telegram-cpp-graph-core)
target_compile_options(telegram-cpp-graph-service PRIVATE -Wall -Wextra -Wpedantic)

enable_testing()

include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.15.2
)
# Prevent GoogleTest from overriding our compiler/linker options
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

add_executable(graph-store-tests
  tests/graph_store_tests.cpp
)
target_link_libraries(graph-store-tests PRIVATE telegram-cpp-graph-core GTest::gtest_main)
target_compile_options(graph-store-tests PRIVATE -Wall -Wextra -Wpedantic)
# Ensure FetchContent GoogleTest headers take precedence over system/conda copies
target_include_directories(graph-store-tests BEFORE PRIVATE
  "${CMAKE_CURRENT_BINARY_DIR}/_deps/googletest-src/googletest/include"
)
add_test(NAME graph-store-tests COMMAND graph-store-tests)

add_executable(graph-store-bench EXCLUDE_FROM_ALL
  tests/graph_store_bench.cpp
)
target_link_libraries(graph-store-bench PRIVATE telegram-cpp-graph-core)
target_compile_options(graph-store-bench PRIVATE -Wall -Wextra -Wpedantic)
