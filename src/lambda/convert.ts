import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from "aws-lambda";

const jobsTableName = process.env.JOBS_TABLE_NAME!;
const conversionQueueUrl = process.env.CONVERSION_QUEUE_URL!;
const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

interface ConvertRequest {
  url?: string;
  format?: "mp3" | "mp4";
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let request: ConvertRequest;

  try {
    request = JSON.parse(event.body ?? "{}");
  } catch {
    return response(400, { message: "Request body must be valid JSON." });
  }

  if (!request.url || !isHttpUrl(request.url)) {
    return response(400, { message: "A valid http(s) 'url' is required." });
  }

  const format = request.format ?? "mp4";
  if (format !== "mp3" && format !== "mp4") {
    return response(400, { message: "'format' must be either 'mp3' or 'mp4'." });
  }

  const jobId = randomUUID();
  const createdAt = new Date().toISOString();
  const job = {
    jobId,
    sourceUrl: request.url,
    outputFormat: format,
    status: "PENDING",
    createdAt,
  };

  try {
    await dynamoDb.send(new PutCommand({ TableName: jobsTableName, Item: job }));
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: conversionQueueUrl,
        MessageBody: JSON.stringify({ jobId, sourceUrl: request.url, outputFormat: format }),
      }),
    );
  } catch (error) {
    console.error("Failed to create conversion job", { error, jobId });
    return response(500, { message: "Unable to create conversion job." });
  }

  return response(202, { jobId, status: job.status });
};
// TODO: check youtube URL
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function response(
  statusCode: number,
  body: Record<string, string>,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
