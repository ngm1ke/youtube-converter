import * as cdk from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

/** Owns asynchronous conversion-job delivery. */
export class QueueStack extends cdk.Stack {
  public readonly conversionQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const conversionDeadLetterQueue = new sqs.Queue(this, "ConversionDeadLetterQueue", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(4),
    });

    this.conversionQueue = new sqs.Queue(this, "ConversionQueue", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: {
        queue: conversionDeadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    new cdk.CfnOutput(this, "ConversionQueueUrl", {
      value: this.conversionQueue.queueUrl,
    });
  }
}
