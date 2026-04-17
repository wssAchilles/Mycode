cmake_minimum_required(VERSION 3.20)

project(telegram_cpp_graph_service LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(Threads REQUIRED)

add_executable(telegram-cpp-graph-service
  src/main.cpp
  src/config/config.cpp
  src/graph/graph_store.cpp
  src/http/http_server.cpp
  src/ops/metrics.cpp
  src/snapshot/backend_snapshot_client.cpp
  src/snapshot/snapshot_loader.cpp
)

target_include_directories(telegram-cpp-graph-service PRIVATE src)

target_link_libraries(telegram-cpp-graph-service
  PRIVATE
    CURL::libcurl
    nlohmann_json::nlohmann_json
    Threads::Threads
)

target_compile_options(telegram-cpp-graph-service PRIVATE
  -Wall
  -Wextra
  -Wpedantic
)
