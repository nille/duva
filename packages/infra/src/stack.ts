import { fileURLToPath } from "node:url";
import { CfnCondition, CfnOutput, CfnParameter, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Distribution, S3OriginAccessControl, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  type CfnUserPool,
  FeaturePlan,
  ManagedLoginVersion,
  OAuthScope,
  UserPool,
  UserPoolClientIdentityProvider,
} from "aws-cdk-lib/aws-cognito";
import { AttributeType, Billing, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { ConfigurationSet, EmailIdentity, Identity, ReceiptRuleSet } from "aws-cdk-lib/aws-ses";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { environmentVariables, inboundPrefix, receiptRuleName, tableKey } from "@duva/api/infrastructure";
import { operations } from "@duva/openapi";
import { cliRedirectUri, signInSender, stackOutputs, stackParameters } from "./outputs.ts";

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

    // duva deploy names the organization's first domain when it runs, so it reaches the stack as a parameter.
    const domain = new CfnParameter(this, stackParameters.domain, {
      type: "String",
      description: "The organization's first domain, a standalone domain",
    }).valueAsString;
    const admin = new CfnParameter(this, stackParameters.admin, {
      type: "String",
      description: "The first admin's email address",
    }).valueAsString;
    const domainVerified = new CfnCondition(this, "DomainVerifiedCondition", {
      expression: Fn.conditionEquals(
        new CfnParameter(this, stackParameters.domainVerified, {
          type: "String",
          allowedValues: ["true", "false"],
          description: "Whether SES has verified the domain",
        }).valueAsString,
        "true",
      ),
    });

    // Every send goes through this configuration set. It publishes no events and turns off
    // engagement metrics, so SES tracks no opens or clicks.
    const sending = new ConfigurationSet(this, "Sending", { vdmOptions: { engagementMetrics: false } });
    const identity = new EmailIdentity(this, "DomainIdentity", {
      identity: Identity.domain(domain),
      configurationSet: sending,
      mailFromDomain: `mail.${domain}`,
    });

    // Rules arrive with the first address, and Duva manages them at run time, so a stack update
    // never reverts their recipients. Until then the rule set is empty and SES refuses all mail.
    // CloudFormation can't make a rule set active: duva deploy does that.
    const receiving = new ReceiptRuleSet(this, "Receiving");

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

    // The web app, a single-page app that deploy uploads, on CloudFront's default domain for now.
    const web = new Bucket(this, "Web", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    // CloudFront names are global to the account, and each region can have a deployment.
    const webAccess = new S3OriginAccessControl(this, "WebAccess", { originAccessControlName: `Duva-Web-${this.region}` });
    const distribution = new Distribution(this, "WebDistribution", {
      comment: "Duva's web app",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(web, { originAccessControl: webAccess }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
    });
    const webUrl = `https://${distribution.distributionDomainName}`;

    // Humans sign in through managed login with a code emailed to them. Only Duva adds humans, and
    // without a password. Cognito requires PASSWORD among the first factors, so it is listed, but
    // nobody has one. Humans are hard to move out of a user pool, so it outlives the stack.
    const humans = new UserPool(this, "Humans", {
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInPolicy: { allowedFirstAuthFactors: { password: true, emailOtp: true } },
      accountRecovery: AccountRecovery.NONE,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    // Cognito refuses an SES identity SES hasn't verified, which a new domain's isn't yet. Until it
    // is, codes come from Cognito's own sender, and deploy switches once SES has verified the domain.
    humans.node.addDependency(identity);
    (humans.node.defaultChild as CfnUserPool).addPropertyOverride(
      "EmailConfiguration",
      Fn.conditionIf(
        domainVerified.logicalId,
        {
          EmailSendingAccount: "DEVELOPER",
          SourceArn: this.formatArn({ service: "ses", resource: "identity", resourceName: domain }),
          From: `Duva <${signInSender(domain)}>`,
          ConfigurationSet: sending.configurationSetName,
        },
        { EmailSendingAccount: "COGNITO_DEFAULT" },
      ),
    );
    // Cognito's prefix domains are unique per region, and a deployment is the only one in its account and region.
    const signIn = humans.addDomain("SignIn", {
      cognitoDomain: { domainPrefix: `duva-${this.account}` },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    // Both clients are public: the web app and the CLI keep no secret, so they sign in with PKCE.
    // An address that isn't a human in the organization gets no code and no hint that it was unknown.
    const client = (id: string, callbackUrls: string[], logoutUrls: string[]) => {
      const appClient = humans.addClient(id, {
        generateSecret: false,
        authFlows: { user: true },
        oAuth: { flows: { authorizationCodeGrant: true }, scopes: [OAuthScope.OPENID, OAuthScope.EMAIL], callbackUrls, logoutUrls },
        preventUserExistenceErrors: true,
        supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      });
      new CfnManagedLoginBranding(this, `${id}Branding`, {
        userPoolId: humans.userPoolId,
        clientId: appClient.userPoolClientId,
        useCognitoProvidedValues: true,
      });
      return appClient;
    };
    const webClient = client("WebClient", [`${webUrl}/`], [`${webUrl}/`]);
    const cliClient = client("CliClient", [cliRedirectUri], []);

    const lambda = (id: string, entry: string, environment: Record<string, string>, { memorySize = 512, timeout = Duration.seconds(10) } = {}) =>
      new NodejsFunction(this, id, {
        entry: fileURLToPath(import.meta.resolve(entry)),
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.ARM_64,
        memorySize,
        timeout,
        environment: { ...environment, NODE_OPTIONS: "--enable-source-maps" },
        // The AWS SDK is bundled too, so the deployed code is exactly what this version built.
        // CommonJS modules in the bundle still require Node's built-ins, so ESM gets a require.
        bundling: {
          format: OutputFormat.ESM,
          target: "node24",
          mainFields: ["module", "main"],
          bundleAwsSDK: true,
          minify: true,
          sourceMap: true,
          sourcesContent: false,
          banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        },
        // ApiHandler's logs are ApiLogs, as before there were other Lambdas.
        logGroup: new LogGroup(this, `${id.replace(/Handler$/, "")}Logs`, {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });

    // SES stores each message it accepts in the mail bucket, then invokes the inbound Lambda without
    // waiting. Lambda retries a failed event twice, then leaves it in the failure queue for replay.
    const inboundFailures = new Queue(this, "InboundFailures", {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    // A message can be up to 40 MB, and is parsed whole.
    const inbound = lambda(
      "InboundHandler",
      "@duva/api/inbound-lambda",
      { [environmentVariables.tableName]: table.tableName, [environmentVariables.mailBucket]: mail.bucketName },
      { memorySize: 1024, timeout: Duration.seconds(60) },
    );
    inbound.configureAsyncInvoke({ retryAttempts: 2, onFailure: new SqsDestination(inboundFailures) });
    table.grantReadWriteData(inbound);
    mail.grantRead(inbound);

    // Duva creates its receipt rule with the first address, so only it may use the bucket and the Lambda.
    const ruleArn = this.formatArn({ service: "ses", resource: "receipt-rule-set", resourceName: `${receiving.receiptRuleSetName}:receipt-rule/${receiptRuleName}` });
    const ses = new ServicePrincipal("ses.amazonaws.com");
    inbound.addPermission("SesInvoke", { principal: ses, sourceAccount: this.account, sourceArn: ruleArn });
    mail.addToResourcePolicy(
      new PolicyStatement({
        principals: [ses],
        actions: ["s3:PutObject"],
        resources: [mail.arnForObjects(`${inboundPrefix}*`)],
        conditions: { StringEquals: { "aws:SourceAccount": this.account }, ArnLike: { "aws:SourceArn": ruleArn } },
      }),
    );

    const handler = lambda("ApiHandler", "@duva/api/lambda", {
      [environmentVariables.version]: version,
      [environmentVariables.tableName]: table.tableName,
      [environmentVariables.mailBucket]: mail.bucketName,
      [environmentVariables.receiptRuleSet]: receiving.receiptRuleSetName,
      [environmentVariables.inboundFunction]: inbound.functionArn,
    });
    table.grantReadWriteData(handler);
    // Message bodies are read from the raw mail.
    mail.grantRead(handler);
    // Creating an address adds it to the receipt rule's recipients. IAM has no resource type for
    // receipt rules, so these actions can't be limited to Duva's rule set.
    handler.addToRolePolicy(
      new PolicyStatement({ actions: ["ses:DescribeReceiptRule", "ses:CreateReceiptRule", "ses:UpdateReceiptRule"], resources: ["*"] }),
    );

    const authorizerHandler = lambda("AuthorizerHandler", "@duva/api/authorizer-lambda", {
      [environmentVariables.tableName]: table.tableName,
      [environmentVariables.userPoolId]: humans.userPoolId,
      [environmentVariables.userPoolClientIds]: Fn.join(",", [webClient.userPoolClientId, cliClient.userPoolClientId]),
    });
    table.grantReadData(authorizerHandler);

    // duva deploy invokes it after each deploy, to set up the organization with its first admin.
    const setup = lambda("SetupHandler", "@duva/api/setup-lambda", {
      [environmentVariables.tableName]: table.tableName,
      [environmentVariables.userPoolId]: humans.userPoolId,
      [environmentVariables.domain]: domain,
      [environmentVariables.admin]: admin,
    });
    table.grantReadWriteData(setup);
    humans.grant(setup, "cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser");

    // With no identity sources, API Gateway runs the authorizer on every call and answers 401
    // when it fails with "Unauthorized". It caches nothing, so a session ends when its token does.
    const authorizer = new HttpLambdaAuthorizer("Authorizer", authorizerHandler, {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      identitySource: [],
      resultsCacheTtl: Duration.seconds(0),
    });

    // One route per operation in the OpenAPI document, so the route key names the operation.
    const api = new HttpApi(this, "Api", {
      description: "Duva's API",
      corsPreflight: { allowOrigins: [webUrl], allowHeaders: ["authorization", "content-type"], allowMethods: [CorsHttpMethod.ANY] },
    });
    const integration = new HttpLambdaIntegration("Handler", handler);
    for (const operation of operations) {
      const method = HttpMethod[operation.method.toUpperCase() as keyof typeof HttpMethod];
      api.addRoutes({ path: operation.path, methods: [method], integration, authorizer: operation.signIn ? authorizer : undefined });
    }

    new CfnOutput(this, stackOutputs.apiUrl, { value: api.apiEndpoint, description: "The URL of Duva's API" });
    new CfnOutput(this, stackOutputs.webUrl, { value: webUrl, description: "The URL of Duva's web app" });
    new CfnOutput(this, stackOutputs.webBucket, { value: web.bucketName, description: "The bucket the web app is served from" });
    new CfnOutput(this, stackOutputs.signInUrl, { value: signIn.baseUrl(), description: "The URL of managed login" });
    new CfnOutput(this, stackOutputs.webClientId, { value: webClient.userPoolClientId, description: "The web app's app client" });
    new CfnOutput(this, stackOutputs.cliClientId, { value: cliClient.userPoolClientId, description: "The CLI's app client" });
    new CfnOutput(this, stackOutputs.setupFunction, { value: setup.functionName, description: "The function that sets up the organization" });
    new CfnOutput(this, stackOutputs.receiptRuleSet, { value: receiving.receiptRuleSetName, description: "Duva's receipt rule set" });
    new CfnOutput(this, stackOutputs.inboundFailures, { value: inboundFailures.queueUrl, description: "The queue of received mail that failed processing" });
    ([1, 2, 3] as const).forEach((n, index) => {
      const { name, value } = identity.dkimRecords[index]!;
      new CfnOutput(this, stackOutputs.dkimName(n), { value: name, description: "A DKIM CNAME record's name" });
      new CfnOutput(this, stackOutputs.dkimValue(n), { value, description: "A DKIM CNAME record's value" });
    });
  }
}
