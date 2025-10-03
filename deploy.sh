#!/bin/bash
set -euo pipefail

# Enable APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

# Check for required environment variables
if [ -z "${PROJECT_ID:-}" ]; then
  echo "PROJECT_ID environment variable is not set, using gcloud config get-value project."
  PROJECT_ID=$(gcloud config get-value project)
fi
if [ -z "${GCS_BUCKET_NAME:-}" ]; then
  echo "GCS_BUCKET_NAME environment variable is not set."
  exit 1
fi
if [ -z "${REGION:-}" ]; then
  echo "REGION environment variable is not set."
  exit 1
fi

# Build and push the container images
gcloud builds submit ./app --tag $REGION-docker.pkg.dev/$PROJECT_ID/containers/app
gcloud builds submit ./litestream --tag $REGION-docker.pkg.dev/$PROJECT_ID/containers/litestream

# Create a temporary service.yaml file with replaced values
sed -e "s/YOUR-PROJECT-ID/${PROJECT_ID}/g" \
    -e "s/YOUR-BUCKET-ID/${GCS_BUCKET_NAME}/g" \
    -e "s/YOUR-REGION/${REGION}/g" \
    service.yaml > service.yaml.tmp

# Deploy to Cloud Run
gcloud run services replace service.yaml.tmp

# Clean up the temporary file
rm service.yaml.tmp