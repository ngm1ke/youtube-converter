import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface ApiStackProps extends cdk.StackProps {
  readonly helloFunction: lambda.IFunction;
  readonly convertFunction: lambda.IFunction;
  readonly getJobFunction: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, "YoutubeConverterApi", {
      restApiName: "Youtube Converter API",
    });

    api.root
      .addResource("hello")
      .addMethod("GET", new apigateway.LambdaIntegration(props.helloFunction));

    api.root
      .addResource("convert")
      .addMethod(
        "POST",
        new apigateway.LambdaIntegration(props.convertFunction),
      );

    const getJobResource = api.root.addResource("get-job");

    getJobResource
      .addResource("{jobId}")
      .addMethod("GET", new apigateway.LambdaIntegration(props.getJobFunction));

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
    });
  }
}
