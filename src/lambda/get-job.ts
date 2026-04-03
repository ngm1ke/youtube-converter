import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const jobsTableName = process.env.JOBS_TABLE_NAME;
const conversionBucketName = process.env.CONVERSION_BUCKET_NAME;

if (!jobsTableName) {
  throw new Error("JOBS_TABLE_NAME is not defined");
}

if (!conversionBucketName) {
  throw new Error("CONVERSION_BUCKET_NAME is not defined");
}

const dynamoDb = DynamoDBDocumentClient.from(
  new DynamoDBClient({})
);

const s3 = new S3Client({});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = event.pathParameters?.jobId;

  if (!jobId) {
    return response(400, {
      message: "jobId is required.",
    });
  }

  try {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: jobsTableName,
        Key: {
          jobId,
        },
      })
    );

    if (!result.Item) {
      return response(404, {
        message: "Job not found.",
      });
    }

    const job = result.Item;

    // Job is not completed yet
    if (job.status !== "COMPLETED") {
      return response(200, {
        jobId: job.jobId,
        status: job.status,
        createdAt: job.createdAt,
        ...(job.failedAt && {
          failedAt: job.failedAt,
        }),
        ...(job.error && {
          error: job.error,
        }),
      });
    }

    if (!job.s3Key) {
      return response(500, {
        message: "Job is completed but output file is missing.",
      });
    }

    // Generate presigned URL
    const command = new GetObjectCommand({
      Bucket: conversionBucketName,
      Key: job.s3Key,
    });

    const presignedUrl = await getSignedUrl(s3, command, {
      expiresIn: 3600, // 1 hour
    });

    return response(200, {
      jobId: job.jobId,
      status: job.status,
      s3Key: job.s3Key,
      presignedUrl,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } catch (error) {
    console.error("Failed to get conversion job", {
      error,
      jobId,
    });

    return response(500, {
      message: "Unable to get conversion job.",
    });
  }
};

function response(
  statusCode: number,
  body: Record<string, unknown>
) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}