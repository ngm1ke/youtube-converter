import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface LambdaStackProps extends cdk.StackProps {
  readonly jobsTable: dynamodb.ITable;
  readonly conversionQueue: sqs.IQueue;
  readonly conversionBucket: s3.IBucket;
}

export class LambdaStack extends cdk.Stack {
  public readonly helloFunction: lambda.IFunction;
  public readonly convertFunction: lambda.IFunction;
  public readonly getJobFunction: lambda.IFunction;
  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    this.helloFunction = new lambdaNodejs.NodejsFunction(
      this,
      "HelloFunction",
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, "../src/lambda/hello.ts"),
        handler: "handler",
      },
    );
    this.getJobFunction = new lambdaNodejs.NodejsFunction(
      this,
      "GetJobFunction",
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, "../src/lambda/get-job.ts"),
        handler: "handler",
         environment: {
          JOBS_TABLE_NAME: props.jobsTable.tableName,
          CONVERSION_BUCKET_NAME: props.conversionBucket.bucketName,
        },
      },
    );
    this.convertFunction = new lambdaNodejs.NodejsFunction(
      this,
      "ConvertFunction",
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, "../src/lambda/convert.ts"),
        handler: "handler",
        environment: {
          JOBS_TABLE_NAME: props.jobsTable.tableName,
          CONVERSION_QUEUE_URL: props.conversionQueue.queueUrl,
          CONVERSION_BUCKET_NAME: props.conversionBucket.bucketName,
        },
      },
    );

    props.jobsTable.grant(this.convertFunction, "dynamodb:PutItem");
    props.jobsTable.grantReadData(this.getJobFunction);
    props.conversionQueue.grantSendMessages(this.convertFunction);
    props.conversionBucket.grantRead(this.getJobFunction)
  }
}
