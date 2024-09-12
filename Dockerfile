FROM golang:1.23-alpine AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -a -installsuffix cgo -o app ./cmd/main/main.go

FROM oven/bun:1 AS frontend-builder
WORKDIR /app
COPY ui/package*.json .
RUN bun install
COPY ui/ .
RUN bun run build

FROM alpine:latest
WORKDIR /root/
COPY --from=backend-builder /app/app .
COPY --from=frontend-builder /app/.dist ./ui/.dist
EXPOSE 1323
CMD ["./app"]