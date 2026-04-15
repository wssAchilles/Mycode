FROM golang:1.24-alpine AS builder
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/telegram-go-delivery-consumer ./cmd/delivery-consumer

FROM alpine:3.21
WORKDIR /app
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /out/telegram-go-delivery-consumer /app/telegram-go-delivery-consumer

EXPOSE 4100

CMD ["/app/telegram-go-delivery-consumer"]
