import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, Billing, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { tableKey } from "@duva/api/table";
import { operations } from "@duva/openapi";

export interface DuvaStackProps extends StackProps {
  /** The version of Duva the stack deploys. */
  version: string;
}

/**
 * A Duva deployment. Everything in it is paid per use, with no VPC and nothing always on,
 * so an idle deployment costs only what it stores (ADR-0006).
 */
export class DuvaStack extends Stack {
  constructor(scope: Construct, id: string, { version, ...props }: DuvaStackProps) {
    super(scope, id, props);

    // Mail and its metadata outlive the stack. They are deleted only when the stack's
    // first creation fails, so a retried deploy starts clean.
    const table = new TableV2(this, "Table", {
      partitionKey: { name: tableKey.partitionKey, type: AttributeType.STRING },
      sortKey: { name: tableKey.sortKey, type: AttributeType.STRING },
      billing: Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    const mail = new Bucket(this, "Mail", {
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    const handler = new NodejsFunction(this, "ApiHandler", {
      entry: fileURLToPath(import.meta.resolve("@duva/api/lambda")),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: { DUVA_VERSION: version, TABLE_NAME: table.tableName, MAIL_BUCKET: mail.bucketName },
      bundling: { format: OutputFormat.ESM, target: "node24" },
      logGroup: new LogGroup(this, "ApiLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // One route per operation in the OpenAPI document, so the route key names the operation.
    const api = new HttpApi(this, "Api", { description: "Duva's API" });
    const integration = new HttpLambdaIntegration("Handler", handler);
    for (const operation of operations) {
      if (operation.signIn) throw new Error(`${operation.operationId} needs sign-in, which the API can't check yet.`);
      const method = HttpMethod[operation.method.toUpperCase() as keyof typeof HttpMethod];
      api.addRoutes({ path: operation.path, methods: [method], integration });
    }

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint, description: "The URL of Duva's API" });
  }
}
