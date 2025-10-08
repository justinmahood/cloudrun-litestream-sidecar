# Stage 1: Build Litestream from source
FROM golang:1.24-bullseye AS builder

# Copy the Litestream source code
COPY litestream /usr/src/litestream

# Set the working directory
WORKDIR /usr/src/litestream

# Build the Litestream binary
RUN go build -v -ldflags "-s -w" -o /usr/local/bin/litestream ./cmd/litestream

# Stage 2: Final image
FROM debian:11-slim

# Install ca-certificates and netcat for health checks
RUN apt-get update && apt-get install -y ca-certificates netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Copy the Litestream binary from the builder stage
COPY --from=builder /usr/local/bin/litestream /usr/local/bin/litestream

# Copy the run script
COPY litestream-cloudrun-poc/litestream/run.sh /usr/local/bin/run.sh

# Make the run script executable
RUN chmod +x /usr/local/bin/run.sh

# Set the entrypoint
ENTRYPOINT ["/usr/local/bin/run.sh"]
