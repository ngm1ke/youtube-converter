import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/** Owns persistent application storage. */
export class StorageStack extends cdk.Stack {
  public readonly conversionBucket: s3.Bucket;
  public readonly jobsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.conversionBucket = new s3.Bucket(this, "ConversionBucket", {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.jobsTable = new dynamodb.Table(this, "JobsTable", {
      partitionKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, "ConversionBucketName", {
      value: this.conversionBucket.bucketName,
    });

    new cdk.CfnOutput(this, "JobsTableName", {
      value: this.jobsTable.tableName,
    });

  }
}
