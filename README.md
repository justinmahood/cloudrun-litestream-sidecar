# Cloud Run with Litestream Sidecar

This repository demonstrates how to run a stateful application with a serverless, scale-to-zero SQL database on Cloud Run. It uses a sidecar running [Litestream](https://litestream.io/) to replicate and restore a [SQLite](https://sqlite.org/) database to Google Cloud Storage, you can leverage the cost-saving benefits of serverless without giving up SQL compatibility.

## Architecture

The Cloud Run service is composed of two containers:

*   **app**: A Node.js application that uses the standard `sqlite3` library to interact with a SQLite database. Replace this with your own application as needed.
*   **litestream**: A sidecar container that runs Litestream to replicate the SQLite database to Google Cloud Storage.

The two containers share an in-memory volume where the SQLite database is stored. 

Cloud Run is configured to ensure the `litestream` container starts and is healthy before the `app` container starts, so that the data is there when the application starts.

**Important**: Cloud Run is configured to scale to a maximum of 1 instance to avoid concurrency issues with SQLite.

## Deployment

To deploy this service, you will need to:

1.  **Authenticate with Google Cloud**:
    ```bash
    gcloud auth login
    ```

2.  **Set up environment variables**:
    ```bash
    export PROJECT_ID=$(gcloud config get-value project)
    export REGION=us-central1
    export GCS_BUCKET_NAME="your-gcs-bucket-name" # Replace with your GCS bucket name
    ```

3.  **Create a GCS bucket**:
    ```bash
    gsutil mb -p $PROJECT_ID gs://$GCS_BUCKET_NAME
    ```

4.  **Create an Artifact Registry repository**:
    ```bash
    gcloud artifacts repositories create containers \
        --repository-format=docker \
        --location=$REGION \
        --description="Docker repository"
    ```

5.  **Deploy the service**:
    ```bash
    ./deploy.sh
    ```

6. Open the URL of the deployed service in your browser to see the application in action.

## How it works

1.  **Restore**: On startup, the `litestream` container restores the database from Google Cloud Storage if it doesn't exist in the in-memory volume.
2.  **Application Start**: The `app` container starts and creates/accesses the SQLite database in the shared volume.
3.  **Replication**: The `litestream` container continuously replicates any changes from the SQLite database to Google Cloud Storage.
