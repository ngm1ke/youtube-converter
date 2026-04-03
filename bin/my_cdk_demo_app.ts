#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { LambdaStack } from "../lib/lambda-stack";
import { QueueStack } from "../lib/queue-stack";
import { StorageStack } from "../lib/storage-stack";
import { EcsStack } from "../lib/ecs-stack";

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const storageStack = new StorageStack(app, "StorageStack", { env });
const queueStack = new QueueStack(app, "QueueStack", { env });
const lambdaStack = new LambdaStack(app, "LambdaStack", {
  env,
  jobsTable: storageStack.jobsTable,
  conversionQueue: queueStack.conversionQueue,
  conversionBucket: storageStack.conversionBucket,
});

new ApiStack(app, "ApiStack", {
  env,
  helloFunction: lambdaStack.helloFunction,
  convertFunction: lambdaStack.convertFunction,
  getJobFunction: lambdaStack.getJobFunction
});

new EcsStack(app, "EcsStack", {
  env,
  jobsTable: storageStack.jobsTable,
  conversionQueue: queueStack.conversionQueue,
  conversionBucket: storageStack.conversionBucket,
  getJobFunction: lambdaStack.getJobFunction
});