#!/bin/sh
set -e

echo "--- Litestream startup script started ---"

# Log the environment variables
echo "DB_PATH=${DB_PATH}"
echo "GCS_BUCKET_NAME=${GCS_BUCKET_NAME}"
echo "GCS_PATH_PREFIX=${GCS_PATH_PREFIX}"

# Generate the config file using a heredoc.
echo "--- Generating litestream.yml from heredoc ---"
cat > /etc/litestream.yml <<EOF
dbs:
  - path: "${DB_PATH}"
    replicas:
      - type: "gcs"
        bucket: "${GCS_BUCKET_NAME}"
        path: "${GCS_PATH_PREFIX}"
EOF

# 1. Restore database if it exists in the replica.
#    On first run, this will find nothing and exit gracefully.
echo "--- [$(date -u +%FT%TZ)] Attempting to restore database from replica ---"
litestream restore -if-db-not-exists -config /etc/litestream.yml "${DB_PATH}" || true
echo "--- [$(date -u +%FT%TZ)] Restore command finished ---"

# 2. Start the health check server in the background.
#    This allows Cloud Run to mark the container as healthy while we wait.
echo "--- Starting health check server in background ---"
while true; do { echo -e 'HTTP/1.1 200 OK\r\n'; } | nc -l -p 8081; done &

# 3. Check if the DB file exists. If not, wait for the app to create it.
echo "--- Waiting for database file to be created by app... ---"
while [ ! -f "${DB_PATH}" ]; do
  sleep 1
done
echo "--- Database file found. ---"

# 4. Execute litestream in the foreground. This will be the main process.
echo "--- Starting Litestream replication ---"
exec litestream replicate -config /etc/litestream.yml






