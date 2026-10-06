import { fileURLToPath } from "node:url";
import { CfnCondition, CfnOutput, CfnParameter, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AllowedMethods, CachePolicy, Distribution, FunctionUrlOriginAccessControl, S3OriginAccessControl, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
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
import { AttributeType, Billing, StreamViewType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Code, FilterCriteria, Function as LambdaFunctionResource, FunctionUrlAuthType, InvokeMode, Runtime, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";
import { DynamoEventSource, SqsDlq, SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { ConfigurationSet, EmailIdentity, Identity, ReceiptRuleSet } from "aws-cdk-lib/aws-ses";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import {
  environmentVariables,
  feederFilter,
  inboundPrefix,
  receiptRuleName,
  searchIndexesPrefix,
  senderFilter,
  senderRetries,
  sentPrefix,
  tableKey,
  tableStreamView,
  timeToLiveAttribute,
} from "@duva/api/infrastructure";
import { operations } from "@duva/openapi";
import { cliRedirectUri, signInSender, stackOutputs, stackParameters } from "./outputs.ts";
import { searchCode } from "./search-code.ts";

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
    // first creation fails, so a retried deploy starts clean. The table's stream starts each send.
    // Its time to live deletes what is kept only for a while, like download links' tickets.
    const table = new TableV2(this, "Table", {
      partitionKey: { name: tableKey.partitionKey, type: AttributeType.STRING },
      sortKey: { name: tableKey.sortKey, type: AttributeType.STRING },
      dynamoStream: StreamViewType[tableStreamView],
      timeToLiveAttribute,
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
    // nobody has one. The pool outlives the stack. It replaced the "Humans" pool, whose sign-in
    // names were case-sensitive, which a pool can't change (#30). The stack kept that one when it
    // was removed, and deploy deletes it once setup has moved every human here.
    const humans = new UserPool(this, "UserPool", {
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
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
    // Cognito's prefix domains are unique per region, and a deployment is the only one in its account
    // and region. The retired pool had duva-<account>, which it keeps until deploy deletes it.
    const signIn = humans.addDomain("SignIn", {
      cognitoDomain: { domainPrefix: `duva-signin-${this.account}` },
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
    // It erases dropped mail for good, which in a versioned bucket means deleting each version.
    inbound.addToRolePolicy(new PolicyStatement({ actions: ["s3:DeleteObjectVersion"], resources: [mail.arnForObjects(`${inboundPrefix}*`)] }));
    inbound.addToRolePolicy(
      new PolicyStatement({ actions: ["s3:ListBucketVersions"], resources: [mail.bucketArn], conditions: { StringLike: { "s3:prefix": `${inboundPrefix}*` } } }),
    );

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

    // The eraser erases threads for good: once a day those that have had Trash or Spam for the
    // retention period, and each Trash emptied when the API invokes it. Lambda retries a failed
    // run, which finishes what it left. The daily run also gives the indexer tasks, below.
    const eraser = lambda(
      "EraserHandler",
      "@duva/api/eraser-lambda",
      { [environmentVariables.tableName]: table.tableName, [environmentVariables.mailBucket]: mail.bucketName },
      { timeout: Duration.minutes(15) },
    );
    table.grantReadWriteData(eraser);
    // It erases raw mail, received and sent, which in a versioned bucket means deleting each version.
    for (const prefix of [inboundPrefix, sentPrefix]) {
      eraser.addToRolePolicy(new PolicyStatement({ actions: ["s3:DeleteObjectVersion"], resources: [mail.arnForObjects(`${prefix}*`)] }));
      eraser.addToRolePolicy(
        new PolicyStatement({ actions: ["s3:ListBucketVersions"], resources: [mail.bucketArn], conditions: { StringLike: { "s3:prefix": `${prefix}*` } } }),
      );
    }
    new Rule(this, "EraserSchedule", { description: "Erases Trash and Spam past the retention period", schedule: Schedule.rate(Duration.days(1)), targets: [new LambdaFunction(eraser)] });
    // Download links lead to the web app's domain, under /download/, since a browser follows a link
    // without credentials: the link's ticket is what the download Lambda checks. CloudFront signs
    // each request to its function URL, which only the distribution may call, since the account
    // disables a Lambda anyone may invoke (docs/aws.md). It streams its answer, since a buffered one
    // can't exceed 6 MB, and takes the attachment from the raw message, which is parsed whole.
    const download = lambda(
      "DownloadHandler",
      "@duva/api/download-lambda",
      { [environmentVariables.tableName]: table.tableName, [environmentVariables.mailBucket]: mail.bucketName },
      { memorySize: 1024, timeout: Duration.seconds(60) },
    );
    table.grantReadData(download);
    mail.grantRead(download);
    const downloadFunctionUrl = download.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM, invokeMode: InvokeMode.RESPONSE_STREAM });
    // A GET has no body, so it needs no payload hash, which OAC asks of a POST or PUT.
    distribution.addBehavior(
      "/download/*",
      FunctionUrlOrigin.withOriginAccessControl(downloadFunctionUrl, {
        originAccessControl: new FunctionUrlOriginAccessControl(this, "DownloadAccess", { originAccessControlName: `Duva-Download-${this.region}` }),
        readTimeout: Duration.seconds(60),
      }),
      {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Each link stops working after minutes, so CloudFront keeps no answer.
        cachePolicy: CachePolicy.CACHING_DISABLED,
      },
    );
    // The origin adds lambda:InvokeFunctionUrl, and a function URL needs lambda:InvokeFunction too.
    download.addPermission("CloudFrontInvoke", {
      principal: new ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: distribution.distributionArn,
    });
    const downloadUrl = `${webUrl}/download/`;

    // Blocking a sender unsubscribes by one-click: one POST to a URL from someone's mail. So it goes
    // from a Lambda of its own, which nothing but the API may invoke, through IAM, and whose role may
    // do nothing but write its log (ADR-0016). Its POST gives up well within its time.
    const unsubscriber = lambda("UnsubscriberHandler", "@duva/api/unsubscriber-lambda", {}, { memorySize: 256 });

    // Search (ADR-0007). Each mailbox's index is a LanceDB table in the search bucket, which keeps no
    // old versions, so what LanceDB deletes is gone. Only the indexer writes there, and the search
    // Lambda reads. Both are an x64 zip of one code, with LanceDB's native module.
    const search = new Bucket(this, "Search", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const searchIndexes = `s3://${search.bucketName}/${searchIndexesPrefix}`;
    const lanceCode = Code.fromAsset(searchCode());
    const lanceLambda = (id: string, handler: string, environment: Record<string, string>, { memorySize, timeout }: { memorySize: number; timeout: Duration }) =>
      new LambdaFunctionResource(this, id, {
        code: lanceCode,
        handler,
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.X86_64,
        memorySize,
        timeout,
        environment: { ...environment, [environmentVariables.searchIndexes]: searchIndexes, NODE_OPTIONS: "--enable-source-maps" },
        logGroup: new LogGroup(this, `${id.replace(/Handler$/, "")}Logs`, { retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
      });
    // The size where every one of ADR-0007's targets held, cold starts included. Only the API
    // invokes it, through IAM, so it has no resource policy (docs/aws.md).
    const searcher = lanceLambda("SearchHandler", "search.handler", {}, { memorySize: 10_240, timeout: Duration.seconds(30) });
    search.grantRead(searcher);

    // The indexer reads a FIFO queue with each mailbox as a message group, so each mailbox's index
    // has one writer at a time (#18). A task that keeps failing goes to a queue of its own, and the
    // mailbox's next task catches up on what it missed. A visibility timeout six times the
    // indexer's, as Lambda asks of a queue it reads.
    const indexFailures = new Queue(this, "IndexFailures", {
      fifo: true,
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const indexerTimeout = Duration.minutes(5);
    const indexQueue = new Queue(this, "IndexQueue", {
      fifo: true,
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      visibilityTimeout: Duration.minutes(30),
      deadLetterQueue: { queue: indexFailures, maxReceiveCount: 5 },
    });
    // Maintenance takes up to 1.1 GB on 100,000 messages (#18).
    const indexer = lanceLambda(
      "IndexerHandler",
      "indexer.handler",
      { [environmentVariables.tableName]: table.tableName, [environmentVariables.mailBucket]: mail.bucketName, [environmentVariables.indexQueue]: indexQueue.queueUrl },
      { memorySize: 2048, timeout: indexerTimeout },
    );
    indexer.addEventSource(new SqsEventSource(indexQueue, { batchSize: 10 }));
    // It continues a backfill and a long catch-up with tasks of its own.
    indexQueue.grantSendMessages(indexer);
    table.grantReadWriteData(indexer);
    mail.grantRead(indexer);
    search.grantReadWrite(indexer);
    search.grantDelete(indexer);

    // The table's stream hands the feeder each new change in a mailbox's change feed, and the
    // feeder gives the indexer a task for the mailbox. A record it keeps failing on is left, and the
    // mailbox's next change brings its index up to date.
    const feeder = lambda("FeederHandler", "@duva/api/feeder-lambda", { [environmentVariables.indexQueue]: indexQueue.queueUrl });
    feeder.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 100,
        retryAttempts: 10,
        bisectBatchOnError: true,
        filters: [FilterCriteria.filter(feederFilter)],
      }),
    );
    indexQueue.grantSendMessages(feeder);
    // The eraser's daily run has the indexer compact each mailbox's index, so erased text leaves it.
    eraser.addEnvironment(environmentVariables.indexQueue, indexQueue.queueUrl);
    indexQueue.grantSendMessages(eraser);

    const handler = lambda("ApiHandler", "@duva/api/lambda", {
      [environmentVariables.version]: version,
      [environmentVariables.tableName]: table.tableName,
      [environmentVariables.mailBucket]: mail.bucketName,
      [environmentVariables.userPoolId]: humans.userPoolId,
      [environmentVariables.receiptRuleSet]: receiving.receiptRuleSetName,
      [environmentVariables.inboundFunction]: inbound.functionArn,
      [environmentVariables.eraserFunction]: eraser.functionArn,
      [environmentVariables.unsubscriberFunction]: unsubscriber.functionArn,
      [environmentVariables.downloadUrl]: downloadUrl,
      [environmentVariables.searchFunction]: searcher.functionArn,
    });
    table.grantReadWriteData(handler);
    // Each search waits for the search Lambda's answer.
    searcher.grantInvoke(handler);
    // Message bodies are read from the raw mail.
    mail.grantRead(handler);
    // Emptying Trash hands the eraser the threads, without waiting.
    eraser.grantInvoke(handler);
    // Blocking a sender waits for the unsubscriber's POST.
    unsubscriber.grantInvoke(handler);
    // Admins add humans, who can then sign in.
    humans.grant(handler, "cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser");
    // Creating an address adds it to the receipt rule's recipients. IAM has no resource type for
    // receipt rules, so these actions can't be limited to Duva's rule set.
    handler.addToRolePolicy(
      new PolicyStatement({ actions: ["ses:DescribeReceiptRule", "ses:CreateReceiptRule", "ses:UpdateReceiptRule"], resources: ["*"] }),
    );

    // Sending starts from the recorded decision: the table's stream invokes the sender for each draft
    // a decision approved, in order, one at a time. Lambda retries a failed record, then records it
    // in the failure queue, while the stream keeps it for 24 hours. The sender's steps are
    // conditional, so a retried record never sends twice.
    const sendFailures = new Queue(this, "SendFailures", {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const sender = lambda(
      "SenderHandler",
      "@duva/api/sender-lambda",
      {
        [environmentVariables.tableName]: table.tableName,
        [environmentVariables.mailBucket]: mail.bucketName,
        [environmentVariables.configurationSet]: sending.configurationSetName,
      },
      { timeout: Duration.seconds(30) },
    );
    sender.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.TRIM_HORIZON,
        batchSize: 1,
        retryAttempts: senderRetries,
        onFailure: new SqsDlq(sendFailures),
        filters: [FilterCriteria.filter(senderFilter)],
      }),
    );
    table.grantReadWriteData(sender);
    // The sender reads the message it answers or forwards, and stores the raw MIME it sends.
    mail.grantRead(sender);
    mail.grantPut(sender, `${sentPrefix}*`);
    // SES checks both the identity and the configuration set a send uses. SESv2 SendEmail with raw
    // content is authorized as ses:SendRawEmail (see docs/aws.md).
    identity.grantSendEmail(sender);
    sender.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: [this.formatArn({ service: "ses", resource: "configuration-set", resourceName: sending.configurationSetName })],
      }),
    );

    const authorizerHandler = lambda("AuthorizerHandler", "@duva/api/authorizer-lambda", {
      [environmentVariables.tableName]: table.tableName,
      [environmentVariables.userPoolId]: humans.userPoolId,
      [environmentVariables.userPoolClientIds]: Fn.join(",", [webClient.userPoolClientId, cliClient.userPoolClientId]),
    });
    table.grantReadData(authorizerHandler);

    // duva deploy invokes it after each deploy, to set up the organization with its first admin and
    // give every human a user in the user pool, one at a time.
    const setup = lambda(
      "SetupHandler",
      "@duva/api/setup-lambda",
      {
        [environmentVariables.tableName]: table.tableName,
        [environmentVariables.userPoolId]: humans.userPoolId,
        [environmentVariables.domain]: domain,
        [environmentVariables.admin]: admin,
        [environmentVariables.indexQueue]: indexQueue.queueUrl,
      },
      { timeout: Duration.minutes(5) },
    );
    table.grantReadWriteData(setup);
    // It starts each mailbox's backfill.
    indexQueue.grantSendMessages(setup);
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
    new CfnOutput(this, stackOutputs.userPoolId, { value: humans.userPoolId, description: "The user pool humans sign in with" });
    new CfnOutput(this, stackOutputs.webClientId, { value: webClient.userPoolClientId, description: "The web app's app client" });
    new CfnOutput(this, stackOutputs.cliClientId, { value: cliClient.userPoolClientId, description: "The CLI's app client" });
    new CfnOutput(this, stackOutputs.setupFunction, { value: setup.functionName, description: "The function that sets up the organization" });
    new CfnOutput(this, stackOutputs.receiptRuleSet, { value: receiving.receiptRuleSetName, description: "Duva's receipt rule set" });
    new CfnOutput(this, stackOutputs.sendFailures, { value: sendFailures.queueUrl, description: "The queue of approved sends that failed processing" });
    new CfnOutput(this, stackOutputs.downloadUrl, { value: downloadUrl, description: "Where download links lead, on the web app's domain" });
    new CfnOutput(this, stackOutputs.downloadFunction, { value: download.functionName, description: "The function download links invoke through CloudFront" });
    new CfnOutput(this, stackOutputs.unsubscriberFunction, { value: unsubscriber.functionName, description: "The function that sends one-click unsubscribes" });
    new CfnOutput(this, stackOutputs.searchFunction, { value: searcher.functionName, description: "The function that runs searches, which only the API invokes" });
    new CfnOutput(this, stackOutputs.indexFailures, { value: indexFailures.queueUrl, description: "The queue of the indexer's tasks that failed" });
    new CfnOutput(this, stackOutputs.searchBucket, { value: search.bucketName, description: "The bucket the mailboxes' search indexes are in" });
    new CfnOutput(this, stackOutputs.inboundFailures, { value: inboundFailures.queueUrl, description: "The queue of received mail that failed processing" });
    ([1, 2, 3] as const).forEach((n, index) => {
      const { name, value } = identity.dkimRecords[index]!;
      new CfnOutput(this, stackOutputs.dkimName(n), { value: name, description: "A DKIM CNAME record's name" });
      new CfnOutput(this, stackOutputs.dkimValue(n), { value, description: "A DKIM CNAME record's value" });
    });
  }
}
