FROM alpine:3.21 AS builder

RUN apk add --no-cache \
  build-base \
  cmake \
  curl-dev \
  git \
  nlohmann-json

WORKDIR /app

COPY . .

# Disable LTO for Alpine musl compatibility
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF \
  && cmake --build build --config Release -j"$(nproc)"

FROM alpine:3.21

RUN apk add --no-cache \
  ca-certificates \
  curl \
  libstdc++

WORKDIR /app

COPY --from=builder /app/build/telegram-cpp-graph-service /usr/local/bin/telegram-cpp-graph-service

EXPOSE 4300

CMD ["telegram-cpp-graph-service"]
