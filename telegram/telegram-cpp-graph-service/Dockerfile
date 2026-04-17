FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN sed -i 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g; s|http://security.ubuntu.com/ubuntu|https://security.ubuntu.com/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources \
  && for attempt in 1 2 3; do \
       apt-get update -o Acquire::Retries=5 \
       && apt-get install -y --no-install-recommends \
            build-essential \
            cmake \
            curl \
            libcurl4-openssl-dev \
            nlohmann-json3-dev \
       && break; \
       if [[ "${attempt}" -eq 3 ]]; then exit 1; fi; \
       rm -rf /var/lib/apt/lists/*; \
       sleep 5; \
     done \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build --config Release -j"$(nproc)"

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN sed -i 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g; s|http://security.ubuntu.com/ubuntu|https://security.ubuntu.com/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources \
  && for attempt in 1 2 3; do \
       apt-get update -o Acquire::Retries=5 \
       && apt-get install -y --no-install-recommends \
            ca-certificates \
            curl \
            libcurl4 \
       && break; \
       if [[ "${attempt}" -eq 3 ]]; then exit 1; fi; \
       rm -rf /var/lib/apt/lists/*; \
       sleep 5; \
     done \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/build/telegram-cpp-graph-service /usr/local/bin/telegram-cpp-graph-service

EXPOSE 4300

CMD ["telegram-cpp-graph-service"]
