import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as assets from "aws-cdk-lib/aws-s3-assets";
export interface EcsStackProps extends cdk.StackProps {
  readonly jobsTable: dynamodb.ITable;
  readonly conversionQueue: sqs.IQueue;
  readonly conversionBucket: s3.IBucket;
  readonly getJobFunction: lambda.IFunction;
}

export class EcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);
    const { conversionQueue, jobsTable, conversionBucket } = props;
    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    const securityGroup = new ec2.SecurityGroup(this, "Worker", {
      vpc,
      description: "Security group for EC2 (no inbound rules)",
      allowAllOutbound: true,
    });

    const role = new iam.Role(this, "WorkerRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Role cho EC2 instance poll SQS và update DynamoDB",
      managedPolicies: [
        // Enable Session Manager (SSM) access instance without SSH
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });

    conversionQueue.grantConsumeMessages(role);
    jobsTable.grantWriteData(role);
    conversionBucket.grantWrite(role);
    // Pack worker as S3 assets
    const appAsset = new assets.Asset(this, "WorkerAppAsset", {
      path: path.join(__dirname, "..", "src/worker"),
      exclude: ["node_modules", "dist", ".git", "*.log"],
    });
    appAsset.grantRead(role);

    const userData = ec2.UserData.forLinux();

    userData.addCommands(
      "set -euxo pipefail",

      // System packages
      // Amazon Linux 2023 already provides curl-minimal
      // ============================================
      "dnf install -y unzip tar xz",

      // Node.js 20
      // ============================================
      "curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -",
      "dnf install -y nodejs",

      "node --version",
      "npm --version",

      // Deno
      // Required by recent yt-dlp YouTube extractor
      // ============================================
      "curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh",
      "chmod 0755 /usr/local/bin/deno",
      "/usr/local/bin/deno --version",

      // FFmpeg
      // ============================================
      "curl -fL --retry 3 --retry-delay 2 https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz",

      "mkdir -p /tmp/ffmpeg-extract",

      "tar -xf /tmp/ffmpeg.tar.xz " +
        "-C /tmp/ffmpeg-extract " +
        "--strip-components=1",

      "install -m 0755 /tmp/ffmpeg-extract/ffmpeg /usr/local/bin/ffmpeg",
      "install -m 0755 /tmp/ffmpeg-extract/ffprobe /usr/local/bin/ffprobe",

      "ffmpeg -version",
      "ffprobe -version",

      "rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-extract",

      // yt-dlp
      // ============================================
      "curl -fL --retry 3 --retry-delay 2 " +
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux " +
        "-o /usr/local/bin/yt-dlp",

      "chmod 0755 /usr/local/bin/yt-dlp",

      "yt-dlp --version",

      // Prepare application directory
      // ============================================
      "mkdir -p /opt/index",
      "rm -rf /opt/index/*",

      // Download application from S3
      // ============================================
      `aws s3 cp s3://${appAsset.s3BucketName}/${appAsset.s3ObjectKey} /tmp/index.zip`,

      "unzip -o /tmp/index.zip -d /opt/index",

      "rm -f /tmp/index.zip",

      "cd /opt/index",

      "npm install",

      "npm run build",

      "test -f /opt/index/dist/index.js",

      "cat > /etc/systemd/system/index.service << 'EOF'\n" +
        `[Unit]
Description=SQS to DynamoDB index
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/index

Environment=QUEUE_URL=${conversionQueue.queueUrl}
Environment=TABLE_NAME=${jobsTable.tableName}
Environment=BUCKET_NAME=${props.conversionBucket.bucketName}
Environment=AWS_REGION=${this.region}

ExecStart=/usr/bin/node /opt/index/dist/index.js

Restart=always
RestartSec=5

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF`,

      "systemctl daemon-reload",
      "systemctl enable index.service",
      "systemctl start index.service",

      "systemctl --no-pager --full status index.service",
    );

    // EC2 Instance
    const instance = new ec2.Instance(this, "WorkerInstance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup,
      role,
      userData,
      userDataCausesReplacement: true,
    });

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "QueueUrl", { value: conversionQueue.queueUrl });
    new cdk.CfnOutput(this, "TableName", { value: jobsTable.tableName });
    new cdk.CfnOutput(this, "InstanceId", { value: instance.instanceId });
  }
}
