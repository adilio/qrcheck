# syntax=docker/dockerfile:1
FROM golang:1.22 AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o qrcheck ./cmd/qrcheck

FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /app/qrcheck ./qrcheck
EXPOSE 8080
CMD ["./qrcheck"]
