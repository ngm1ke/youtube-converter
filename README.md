# YouTube Converter

A YouTube video converter built with an event-driven AWS architecture.

## Tech Stack

- **AWS CDK** — Infrastructure as Code
- **API Gateway** — HTTP API
- **Lambda** — API / job management
- **SQS** — Job queue
- **DynamoDB** — Job status & metadata
- **S3** — Converted file storage
- **EC2** — Video processing worker
- **FFmpeg + yt-dlp** — Video download & conversion
- **TypeScript / Node.js** — Application & worker

## Architecture

```text
                        ┌──────────────────┐
                        │      Client      │
                        └────────┬─────────┘
                                 │
                                 │ POST /jobs
                                 ▼
                    ┌─────────────────────────┐
                    │      API Gateway        │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   CreateJob Lambda      │
                    │                         │
                    │ - Validate URL          │
                    │ - Create jobId          │
                    │ - Save job to DynamoDB  │
                    │ - Send message to SQS   │
                    └──────┬───────────┬──────┘
                           │           │
                 PutItem   │           │ SendMessage
                           ▼           ▼
                    ┌────────────┐  ┌──────────────┐
                    │ DynamoDB   │  │     SQS      │
                    │ JobsTable  │  │ Conversion   │
                    └──────┬─────┘  │    Queue     │
                           │        └──────┬───────┘
                           │               │
                           │               │ Poll
                           │               ▼
                           │       ┌─────────────────┐
                           │       │   EC2 Worker    │
                           │       │                 │
                           │       │    index.ts     │
                           │       │                 │
                           │       │ - Receive SQS   │
                           │       │ - yt-dlp        │
                           │       │ - FFmpeg        │
                           │       │ - Upload S3     │
                           │       │ - Update job    │
                           │       └──────┬──────────┘
                           │              │
                           │              │
                           │        ┌─────▼─────┐
                           │        │    S3     │
                           │        │ Converted │
                           │        │   Files   │
                           │        └─────┬─────┘
                           │              │
                           │              │
                           │        Update DynamoDB
                           │              │
                           └──────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  GetJob Lambda   │
                         │                  │
                         │ - Get job status │
                         │ - Generate       │
                         │   presigned URL  │
                         └────────┬─────────┘
                                  │
                                  ▼
                            ┌───────────┐
                            │  Client   │
                            └───────────┘