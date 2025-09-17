FROM debian:11-slim

# Install Litestream and netcat for health checks
RUN apt-get update && apt-get install -y curl netcat-openbsd && \
    curl -L -o /usr/local/bin/litestream https://github.com/benbjohnson/litestream/releases/download/v0.3.9/litestream-v0.3.9-linux-amd64.tar.gz && \
    tar -C /usr/local/bin -xzf /usr/local/bin/litestream


COPY run.sh /usr/local/bin/run.sh

RUN chmod +x /usr/local/bin/run.sh

ENTRYPOINT ["/usr/local/bin/run.sh"]


