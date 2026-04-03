import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const QUEUE_URL = requireEnv("QUEUE_URL");
const TABLE_NAME = requireEnv("TABLE_NAME");
const BUCKET_NAME = requireEnv("BUCKET_NAME");
const REGION = process.env.AWS_REGION || "ap-southeast-1";

const POLL_WAIT_TIME_SECONDS = 20;
const MAX_MESSAGES_PER_POLL = 10;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const sqsClient = new SQSClient({ region: REGION });
const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({ region: REGION });

interface JobMessage {
  jobId: string;
  sourceUrl: string;
  outputFormat: "mp4" | "mp3";
}

async function pollLoop(): Promise<void> {
  console.log(
    `Poller started. Queue: ${QUEUE_URL} | Table: ${TABLE_NAME}`,
  );

  while (true) {
    try {
      const { Messages } = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: QUEUE_URL,
          MaxNumberOfMessages: MAX_MESSAGES_PER_POLL,
          WaitTimeSeconds: POLL_WAIT_TIME_SECONDS,
          VisibilityTimeout: 900,
        }),
      );

      if (!Messages || Messages.length === 0) continue;

      for (const message of Messages) {
        await handleMessage(message);
      }
    } catch (err) {
      console.error("Failed to receive messages from SQS:", err);
      await sleep(5000);
    }
  }
}

async function handleMessage(message: Message): Promise<void> {
  let job: JobMessage;

  try {
    job = JSON.parse(message.Body || "{}");
  } catch {
    console.error("Invalid JSON message body:", message.Body);
    await deleteMessage(message);
    return;
  }

  console.log(
    `Processing job ${job.jobId}: ${job.sourceUrl} → ${job.outputFormat}`,
  );

  await updateJobStatus(job.jobId, "PROCESSING");

  let workDir: string | null = null;

  try {
    workDir = await mkdtemp(path.join(tmpdir(), "yt-"));

    const outputPath = await runYtDlp(
      job.sourceUrl,
      job.outputFormat,
      workDir,
    );

    const s3Key = `outputs/${job.jobId}.${job.outputFormat}`;
    const fileBuffer = await readFile(outputPath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType:
          job.outputFormat === "mp3" ? "audio/mpeg" : "video/mp4",
      }),
    );

    await updateJobStatus(job.jobId, "COMPLETED", s3Key);

    console.log(
      `Job ${job.jobId} completed → s3://${BUCKET_NAME}/${s3Key}`,
    );

    await deleteMessage(message);
  } catch (err) {
    console.error(`Failed to process job ${job.jobId}:`, err);

    await updateJobStatus(
      job.jobId,
      "FAILED",
      undefined,
      String(err),
    );
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

async function runYtDlp(
  url: string,
  format: "mp4" | "mp3",
  workDir: string,
): Promise<string> {
  const outputTemplate = path.join(workDir, "output.%(ext)s");

  const commonArgs = [
    url,
    "--cookies",
    "/etc/yt-dlp/cookies.txt",
    "--js-runtimes",
    "deno",
    "--no-playlist",
    "--output",
    outputTemplate,
  ];

  const args =
    format === "mp3"
      ? [
          ...commonArgs,
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
        ]
      : [
          ...commonArgs,
          "--format",
          "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
          "--merge-output-format",
          "mp4",
        ];

  await execFileAsync("/usr/local/bin/yt-dlp", args, {
    maxBuffer: 1024 * 1024 * 50,
  });

  const files = await readdir(workDir);
  const outputFile = files.find((file) => file.startsWith("output."));

  if (!outputFile) {
    throw new Error("yt-dlp did not produce an output file");
  }

  return path.join(workDir, outputFile);
}

async function updateJobStatus(
  jobId: string,
  status: "PROCESSING" | "COMPLETED" | "FAILED",
  s3Key?: string,
  errorMessage?: string,
): Promise<void> {
  const updateExpr: string[] = [
    "#status = :status",
    "#updatedAt = :updatedAt",
  ];

  const exprNames: Record<string, string> = {
    "#status": "status",
    "#updatedAt": "updatedAt",
  };

  const exprValues: Record<string, any> = {
    ":status": status,
    ":updatedAt": new Date().toISOString(),
  };

  if (s3Key) {
    updateExpr.push("#s3Key = :s3Key");
    exprNames["#s3Key"] = "s3Key";
    exprValues[":s3Key"] = s3Key;
  }

  if (errorMessage) {
    updateExpr.push("#errorMessage = :errorMessage");
    exprNames["#errorMessage"] = "errorMessage";
    exprValues[":errorMessage"] = errorMessage;
  }

  await ddbDoc.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { jobId },
      UpdateExpression: `SET ${updateExpr.join(", ")}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
    }),
  );
}

async function deleteMessage(message: Message): Promise<void> {
  if (!message.ReceiptHandle) return;

  await sqsClient.send(
    new DeleteMessageCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGTERM", () => {
  console.log("Stopping worker...");
  process.exit(0);
});

pollLoop().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});