FROM rust:1.90-bookworm AS builder
WORKDIR /app
ENV CARGO_TARGET_DIR=/app/target

COPY telegram-rust-workspace/Cargo.toml telegram-rust-workspace/Cargo.lock telegram-rust-workspace/
COPY telegram-rust-workspace/crates telegram-rust-workspace/crates
COPY telegram-rust-recommendation/Cargo.toml telegram-rust-recommendation/
COPY telegram-rust-recommendation/src telegram-rust-recommendation/src

RUN cargo build --manifest-path telegram-rust-workspace/Cargo.toml -p telegram-rust-recommendation --release --locked

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/telegram-rust-recommendation /usr/local/bin/telegram-rust-recommendation

EXPOSE 4200
CMD ["telegram-rust-recommendation"]
