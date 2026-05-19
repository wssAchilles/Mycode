cmake_minimum_required(VERSION 3.20)

project(telegram_cpp_graph_service LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

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

if(CMAKE_BUILD_TYPE STREQUAL "Release")
  target_compile_options(telegram-cpp-graph-core PRIVATE -O3 -march=native)
endif()

add_executable(telegram-cpp-graph-service
  src/main.cpp
)

target_link_libraries(telegram-cpp-graph-service PRIVATE telegram-cpp-graph-core)
target_compile_options(telegram-cpp-graph-service PRIVATE -Wall -Wextra -Wpedantic)

enable_testing()

add_executable(graph-store-tests
  tests/graph_store_tests.cpp
)
target_link_libraries(graph-store-tests PRIVATE telegram-cpp-graph-core)
target_compile_options(graph-store-tests PRIVATE -Wall -Wextra -Wpedantic)
add_test(NAME graph-store-tests COMMAND graph-store-tests)

add_executable(graph-store-bench EXCLUDE_FROM_ALL
  tests/graph_store_bench.cpp
)
target_link_libraries(graph-store-bench PRIVATE telegram-cpp-graph-core)
target_compile_options(graph-store-bench PRIVATE -Wall -Wextra -Wpedantic)
