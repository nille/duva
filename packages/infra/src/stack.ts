import { fileURLToPath } from "node:url";
import { Aspects, Aws, CfnCondition, CfnOutput, CfnParameter, CfnResource, CustomResource, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AgentCoreRuntime, AgentRuntimeArtifact, BrowserCustom, BrowserNetworkConfiguration, type CfnBrowserCustom, Runtime as AgentRuntime } from "aws-cdk-lib/aws-bedrockagentcore";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AllowedMethods, CachePolicy, Distribution, FunctionUrlOriginAccessControl, OriginRequestCookieBehavior, OriginRequestHeaderBehavior, OriginRequestPolicy, OriginRequestQueryStringBehavior, ResponseHeadersPolicy, S3OriginAccessControl, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  type CfnUserPool,
  ClientAttributes,
  FeaturePlan,
  ManagedLoginVersion,
  OAuthScope,
  UserPool,
  UserPoolClientIdentityProvider,
  UserPoolOperation,
} from "aws-cdk-lib/aws-cognito";
import { AttributeType, Billing, StreamViewType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Policy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Architecture, Code, FilterCriteria, Function as LambdaFunctionResource, FunctionUrlAuthType, InvokeMode, Runtime, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";
import { DynamoEventSource, SqsDlq, SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { ScheduleGroup } from "aws-cdk-lib/aws-scheduler";
import { ConfigurationSet, EmailIdentity, EmailSendingEvent, EventDestination, Identity, ReceiptRuleSet } from "aws-cdk-lib/aws-ses";
import { Topic } from "aws-cdk-lib/aws-sns";
import { LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct, IConstruct } from "constructs";
import {
  browserProfileTagged,
  embeddingModel,
  translationModel,
  environmentVariables,
  alertMailFilter,
  feederFilter,
  taskGiverFilter,
  hostedLogoHeaders,
  hostedLogosPath,
  conversationPath,
  mcpCallbackPath,
  mcpRoutes,
  tokenHeader,
  cooRequestsPrefix,
  inboundPrefix,
  receiptRuleName,
  searchIndexesPrefix,
  senderFilter,
  senderRetries,
  sentPrefix,
  signInFrom,
  signInLinkPrefix,
  tableKey,
  tableStreamView,
  timeToLiveAttribute,
} from "@duva/api/infrastructure";
import { operations } from "@duva/openapi";
import { cliRedirectUri, stackOutputs, stackParameters } from "./outputs.ts";
import { searchCode } from "./search-code.ts";
import { agentCode, agentEntryPoint } from "./agent-code.ts";
import { deciderModel, type MailboxAgentModel, mailboxAgentModels, type SuggestionModel, suggestionModels } from "@duva/api/agent-models";

/** The regions where SES receives mail but AgentCore Runtime doesn't run (docs/research/agentcore.md). */
export const regionsWithoutAgentCore = ["af-south-1", "ap-northeast-3", "ap-southeast-3", "il-central-1", "me-south-1"];

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

    // duva deploy names the organization's first domain when it runs, so it reaches the stack as a
    // parameter. Admins add every later domain at run time, through the API (ADR-0018).
    const domain = new CfnParameter(this, stackParameters.domain, {
      type: "String",
      description: "The organization's first domain, a standalone domain",
    }).valueAsString;
    // The API changes the user pool's sender when an admin chooses another domain, and deploy gives
    // the stack the one the pool has, so a deploy never reverts it.
    const signInDomain = new CfnParameter(this, stackParameters.signInDomain, {
      type: "String",
      description: "The domain sign-in codes come from, the first domain until an admin chooses another",
    }).valueAsString;
    const admin = new CfnParameter(this, stackParameters.admin, {
      type: "String",
      description: "The first admin's email address",
    }).valueAsString;
    const recovery = new CfnParameter(this, stackParameters.recovery, {
      type: "String",
      default: "",
      description: "The first admin's recovery address, outside the first domain, where setup mails their first sign-in link (ADR-0041)",
    }).valueAsString;
    const domainVerified = new CfnCondition(this, "DomainVerifiedCondition", {
      expression: Fn.conditionEquals(
        new CfnParameter(this, stackParameters.domainVerified, {
          type: "String",
          allowedValues: ["true", "false"],
          description: "Whether SES has verified the sign-in domain",
        }).valueAsString,
        "true",
      ),
    });

    // Every send goes through this configuration set. It turns off engagement metrics, so SES
    // tracks no opens or clicks, and publishes only bounces, complaints and rejects, which the
    // feedback Lambda reads.
    const sending = new ConfigurationSet(this, "Sending", { vdmOptions: { engagementMetrics: false } });
    // Only SES may publish to the topic, for this configuration set, as CDK's event destination allows.
    const feedbackTopic = new Topic(this, "Feedback", { enforceSSL: true });
    sending.addEventDestination("FeedbackEvents", {
      destination: EventDestination.snsTopic(feedbackTopic),
      events: [EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT, EmailSendingEvent.REJECT],
    });
    // Every SES identity in this account and region, which admins' domains are, and the configuration set.
    const identities = this.formatArn({ service: "ses", resource: "identity", resourceName: "*" });
    const configurationSet = this.formatArn({ service: "ses", resource: "configuration-set", resourceName: sending.configurationSetName });
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

    // The organization's own logos, and the mark certificates attached to them, are public, for
    // receivers that honor BIMI to fetch (ADR-0026). The API puts them in a bucket of their own,
    // which only CloudFront reads, through the web app's origin access control, and serves under
    // /bimi/ on the web app's domain, so no Lambda serves them. The headers keep an SVG opened
    // there from running anything.
    const logos = new Bucket(this, "Logos", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    distribution.addBehavior(`/${hostedLogosPath}*`, S3BucketOrigin.withOriginAccessControl(logos, { originAccessControl: webAccess }), {
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      // Each logo says how long to keep it, so another logo shows within minutes.
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: new ResponseHeadersPolicy(this, "LogoHeaders", {
        responseHeadersPolicyName: `Duva-Logos-${this.region}`,
        // CloudFront takes these only as security headers, never as custom ones (docs/aws.md).
        securityHeadersBehavior: {
          contentSecurityPolicy: { contentSecurityPolicy: hostedLogoHeaders["content-security-policy"], override: true },
          contentTypeOptions: { override: true },
        },
      }),
    });
    const logosUrl = `${webUrl}/${hostedLogosPath}`;

    // Files uploaded to drafts (ADR-0034). Browsers and agents PUT them straight to this bucket, in
    // parts, with the presigned URLs the API gives, since API Gateway takes at most 10 MB a request.
    // It keeps no versions, so deleting a file deletes it, and gives up an upload never completed
    // after a day. A browser may PUT only from the web app's domain, and reads each part's ETag.
    const uploads = new Bucket(this, "Uploads", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      cors: [{ allowedOrigins: [webUrl], allowedMethods: [HttpMethods.PUT], allowedHeaders: ["*"], exposedHeaders: ["ETag"], maxAge: 3600 }],
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    // Those that delete a draft's files list them, and give up the uploads not completed.
    const removesUploads = (grantee: LambdaFunctionResource) => {
      uploads.grantRead(grantee);
      uploads.grantDelete(grantee);
      grantee.addToRolePolicy(new PolicyStatement({ actions: ["s3:AbortMultipartUpload"], resources: [uploads.arnForObjects("*")] }));
    };

    // Humans sign in through managed login with their passkeys, or a code emailed to them as a
    // fallback (ADR-0041). Only Duva adds humans, and without a password. Cognito requires PASSWORD
    // among the first factors, so it is listed, but nobody has one. The stack names no relying party
    // for passkeys, so they belong to the pool's prefix domain, which a stack that creates the pool
    // can't name before the domain exists (docs/aws.md). The pool outlives the stack. It replaced
    // the "Humans" pool, whose sign-in names were case-sensitive, which a pool can't change (#30).
    // The stack kept that one when it was removed, and deploy deletes it once setup has moved every
    // human here.
    const humans = new UserPool(this, "UserPool", {
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      signInPolicy: { allowedFirstAuthFactors: { password: true, emailOtp: true, passkey: true } },
      accountRecovery: AccountRecovery.NONE,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    // Cognito refuses an SES identity SES hasn't verified, which a new domain's isn't yet. Until it
    // is, codes come from Cognito's own sender, and deploy switches once SES has verified the domain.
    // An admin can choose another verified domain later, which the API sets in the pool.
    humans.node.addDependency(identity);
    (humans.node.defaultChild as CfnUserPool).addPropertyOverride(
      "EmailConfiguration",
      Fn.conditionIf(
        domainVerified.logicalId,
        {
          EmailSendingAccount: "DEVELOPER",
          SourceArn: this.formatArn({ service: "ses", resource: "identity", resourceName: signInDomain }),
          From: signInFrom(signInDomain),
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
    // Their sessions list and remove the human's passkeys, which takes Cognito's own scope, whose
    // tokens may change the human's attributes. A client that names none may change any, the email
    // they sign in with included, so each names one Duva never reads (docs/aws.md).
    const client = (id: string, callbackUrls: string[], logoutUrls: string[], { passkeys = false, signInLinks = false } = {}) => {
      const appClient = humans.addClient(id, {
        generateSecret: false,
        authFlows: { user: true, custom: signInLinks },
        oAuth: { flows: { authorizationCodeGrant: true }, scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, ...(passkeys ? [OAuthScope.COGNITO_ADMIN] : [])], callbackUrls, logoutUrls },
        writeAttributes: new ClientAttributes().withStandardAttributes({ locale: true }),
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
    // The API signs a sign-in link's human in for the web app with a custom challenge (ADR-0041).
    const webClient = client("WebClient", [`${webUrl}/`], [`${webUrl}/`], { passkeys: true, signInLinks: true });
    const cliClient = client("CliClient", [cliRedirectUri], [], { passkeys: true });

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

    // Erasing raw mail under a prefix, which in a versioned bucket means deleting each version.
    const erasesUnder = (fn: NodejsFunction, prefix: string) => {
      fn.addToRolePolicy(new PolicyStatement({ actions: ["s3:DeleteObjectVersion"], resources: [mail.arnForObjects(`${prefix}*`)] }));
      fn.addToRolePolicy(new PolicyStatement({ actions: ["s3:ListBucketVersions"], resources: [mail.bucketArn], conditions: { StringLike: { "s3:prefix": `${prefix}*` } } }));
    };

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
      { [environmentVariables.tableName]: table.tableName, [environmentVariables.mailBucket]: mail.bucketName, [environmentVariables.configurationSet]: sending.configurationSetName },
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
    // It keeps a copy of each request mailed to a Coo's address, for the task runner (ADR-0040).
    mail.grantPut(inbound, `${cooRequestsPrefix}*`);

    // It re-sends a group's mail to external members from the group's address (ADR-0003), and
    // bounces mail a group refuses, both from the identity of one of the organization's domains,
    // which admins add at run time (ADR-0018).
    inbound.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: [identities, configurationSet] }));
    inbound.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendBounce"], resources: [identities] }));

    // Duva creates its receipt rules as addresses come, so only they may use the bucket and the
    // Lambda. Each is named after the first, and Lambda compares a source ARN with StringLike.
    const ruleArn = this.formatArn({ service: "ses", resource: "receipt-rule-set", resourceName: `${receiving.receiptRuleSetName}:receipt-rule/${receiptRuleName}*` });
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
      { [environmentVariables.tableName]: table.tableName, [environmentVariables.mailBucket]: mail.bucketName, [environmentVariables.uploadsBucket]: uploads.bucketName },
      { timeout: Duration.minutes(15) },
    );
    table.grantReadWriteData(eraser);
    // It erases the files uploaded to a deleted mailbox's drafts.
    removesUploads(eraser);
    // It erases raw mail, received and sent, which in a versioned bucket means deleting each version.
    // It erases requests mailed to a Coo's address that were never verified too (ADR-0040).
    for (const prefix of [inboundPrefix, sentPrefix, cooRequestsPrefix]) erasesUnder(eraser, prefix);
    new Rule(this, "EraserSchedule", { description: "Erases Trash and Spam past the retention period", schedule: Schedule.rate(Duration.days(1)), targets: [new LambdaFunction(eraser)] });
    // Download links lead to the web app's domain, under /download/, since a browser follows a link
    // without credentials: the link's ticket is what the download Lambda checks. CloudFront signs
    // each request to its function URL, which only the distribution may call, since the account
    // disables a Lambda anyone may invoke (docs/aws.md). It streams its answer, since a buffered one
    // can't exceed 6 MB, and takes the attachment from the raw message, which is parsed whole. It
    // also serves linked files' pages, and their Download hands out a URL that reads the file from
    // the uploads bucket for minutes, so it never carries a file itself, and counts the download,
    // recording the first in the mailbox's change feed (ADR-0034).
    // The uploads bucket names the distribution in its CORS, so its name reaches the Lambda through a
    // parameter, and its grant is a policy the Lambda doesn't wait for, as the API's URL does the
    // conversation Lambda's.
    const uploadsBucketParameter = `/${Aws.STACK_NAME}/${this.region}/UploadsBucket`;
    const download = lambda(
      "DownloadHandler",
      "@duva/api/download-lambda",
      { [environmentVariables.tableName]: table.tableName, [environmentVariables.mailBucket]: mail.bucketName, [environmentVariables.uploadsBucketParameter]: uploadsBucketParameter },
      { memorySize: 1024, timeout: Duration.seconds(60) },
    );
    table.grantReadWriteData(download);
    mail.grantRead(download);
    new StringParameter(this, "UploadsBucketParameter", { parameterName: uploadsBucketParameter, simpleName: false, stringValue: uploads.bucketName, description: "The bucket of the files uploaded to drafts" });
    new Policy(this, "DownloadReadsUploads", {
      roles: [download.role!],
      statements: [
        new PolicyStatement({ actions: ["s3:GetObject"], resources: [uploads.arnForObjects("*")] }),
        new PolicyStatement({ actions: ["ssm:GetParameter"], resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: uploadsBucketParameter.slice(1) })] }),
      ],
    });
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

    // Sending a sender's mail nowhere unsubscribes by one-click: one POST to a URL from someone's
    // mail. So it goes from a Lambda of its own, which nothing but the API and the inbound Lambda,
    // for each message it drops, may invoke, through IAM, and whose role may do nothing but write its
    // log (ADR-0016, ADR-0025). Its POST gives up well within its time.
    const unsubscriber = lambda("UnsubscriberHandler", "@duva/api/unsubscriber-lambda", {}, { memorySize: 256 });
    unsubscriber.grantInvoke(inbound);
    inbound.addEnvironment(environmentVariables.unsubscriberFunction, unsubscriber.functionArn);

    // A sender's logo, and its mark certificate, come from URLs in the sender's DNS, so the inbound
    // Lambda fetches them through a Lambda of its own, which only it may invoke, through IAM, and
    // whose role may do nothing but write its log (ADR-0023). Each fetch gives up well within its
    // time. Logos are served under the URL download links lead to, so a browser never reaches the sender.
    const logoFetcher = lambda("LogoFetcherHandler", "@duva/api/logo-fetcher-lambda", {}, { memorySize: 256 });
    logoFetcher.grantInvoke(inbound);
    inbound.addEnvironment(environmentVariables.logoFetcherFunction, logoFetcher.functionArn);
    inbound.addEnvironment(environmentVariables.downloadUrl, downloadUrl);

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
    // Search embeds its words, and the indexer each message, with Titan in the deployment's own
    // region, so mail stays there (ADR-0007). The conversation Lambda embeds each turn's words there too (#132),
    // and the API Coo's memories (ADR-0036).
    const embedding = new PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [this.formatArn({ service: "bedrock", account: "", resource: "foundation-model", resourceName: embeddingModel })] });
    searcher.addToRolePolicy(embedding);
    // Search also translates its words with Nova Lite there, into the organization's search languages (#67).
    searcher.addToRolePolicy(new PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [this.formatArn({ service: "bedrock", account: "", resource: "foundation-model", resourceName: translationModel })] }));

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
    indexer.addToRolePolicy(embedding);

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

    // The humans' secrets are sealed with a key of the stack's own, in its region, which only the
    // API uses (ADR-0039). It stays with the table, which keeps the sealed values.
    const secretsKey = new Key(this, "SecretsKey", {
      description: "Seals the secrets each Duva human keeps for Coo to use but never read",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

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
      [environmentVariables.configurationSet]: sending.configurationSetName,
      [environmentVariables.indexQueue]: indexQueue.queueUrl,
      [environmentVariables.logosBucket]: logos.bucketName,
      [environmentVariables.logosUrl]: logosUrl,
      [environmentVariables.uploadsBucket]: uploads.bucketName,
      [environmentVariables.signInClientId]: webClient.userPoolClientId,
      [environmentVariables.secretsKey]: secretsKey.keyArn,
      [environmentVariables.webUrl]: webUrl,
    });
    table.grantReadWriteData(handler);
    // Only the API seals and opens the humans' secrets; a browsing run gets a part through it (ADR-0039).
    secretsKey.grantEncryptDecrypt(handler);
    // The API starts and completes uploads to drafts, and signs the URLs their parts go to and
    // their files open from, which work with the API's own permissions.
    uploads.grantReadWrite(handler);
    removesUploads(handler);
    // Admins and humans set the organization's own logos, which the API puts in the logos bucket.
    logos.grantPut(handler, `${hostedLogosPath}*`);
    logos.grantDelete(handler, `${hostedLogosPath}*`);
    // Each search waits for the search Lambda's answer.
    searcher.grantInvoke(handler);
    // The API embeds Coo's memories, and what they are searched for, with Titan there too (ADR-0036).
    handler.addToRolePolicy(embedding);
    // Changing the search languages has the indexer rebuild the indexes that file mail in others (#67).
    indexQueue.grantSendMessages(handler);
    // Message bodies are read from the raw mail.
    mail.grantRead(handler);
    // Emptying Trash hands the eraser the threads, without waiting.
    eraser.grantInvoke(handler);
    // Sending a sender's mail nowhere waits for the unsubscriber's POST.
    unsubscriber.grantInvoke(handler);
    // Admins add humans, who can then sign in, and remove them, who then can't.
    humans.grant(handler, "cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser", "cognito-idp:AdminDeleteUser");
    // Revealing a secret mails the human a sign-in code and checks it, as signing in does (ADR-0039),
    // and following a sign-in link answers the pool's custom challenge (ADR-0041).
    humans.grant(handler, "cognito-idp:AdminInitiateAuth", "cognito-idp:AdminRespondToAuthChallenge");
    // It mails sign-in links, from the domain sign-in codes come from, which admins may choose.
    handler.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: [identities, configurationSet] }));
    // Choosing the sign-in domain changes the pool's sender, which UpdateUserPool can do only by
    // giving every setting the pool has.
    humans.grant(handler, "cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool");
    // Admins add and remove domains at run time, each an SES identity in this account and region
    // (ADR-0018). A new identity sends through the configuration set by default.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:CreateEmailIdentity", "ses:GetEmailIdentity", "ses:DeleteEmailIdentity", "ses:PutEmailIdentityMailFromAttributes"],
        resources: [identities],
      }),
    );
    handler.addToRolePolicy(new PolicyStatement({ actions: ["ses:CreateEmailIdentity"], resources: [configurationSet] }));
    // Adding and removing addresses changes the receipt rules' recipients. IAM has no resource type
    // for receipt rules, so these actions can't be limited to Duva's rule set.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:DescribeReceiptRuleSet", "ses:CreateReceiptRule", "ses:UpdateReceiptRule", "ses:DeleteReceiptRule"],
        resources: ["*"],
      }),
    );
    // A new address is taken off the account's suppression list, which IAM has no resource type for.
    handler.addToRolePolicy(new PolicyStatement({ actions: ["ses:ListSuppressedDestinations", "ses:DeleteSuppressedDestination"], resources: ["*"] }));

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
        [environmentVariables.uploadsBucket]: uploads.bucketName,
        // Linked files' pages are under the download URL (ADR-0034).
        [environmentVariables.downloadUrl]: downloadUrl,
      },
      // A message with its attachments is up to 10 MB, encoded, past which files go as links, and a
      // forwarded attachment it links up to SES's 40 MB, held whole while it is sent or put.
      { memorySize: 1024, timeout: Duration.seconds(60) },
    );
    sender.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.TRIM_HORIZON,
        batchSize: 1,
        retryAttempts: senderRetries,
        onFailure: new SqsDlq(sendFailures),
        // The sender also mails each urgent alert to its sponsor.
        filters: [FilterCriteria.filter(senderFilter), FilterCriteria.filter(alertMailFilter)],
      }),
    );
    table.grantReadWriteData(sender);
    // The sender reads the message it answers or forwards, and stores the raw MIME it sends.
    mail.grantRead(sender);
    mail.grantPut(sender, `${sentPrefix}*`);
    // It attaches the files uploaded to a draft, and deletes them once they went out, or their
    // links ended. A forwarded attachment it links goes to the bucket first.
    removesUploads(sender);
    uploads.grantPut(sender);
    // SES checks both the identity and the configuration set a send uses: any of the organization's
    // domains, which admins add at run time. SESv2 SendEmail with raw content is authorized as
    // ses:SendRawEmail (see docs/aws.md).
    sender.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: [identities, configurationSet] }));
    // An agent's sends over its send limits wait, and the sender schedules itself for when the limits
    // allow them: a one-time schedule, deleted once it ran, through which EventBridge Scheduler
    // invokes it with a role of its own, so no resource policy lets anyone invoke it. Deleting the
    // group deletes its schedules.
    const senderSchedules = new ScheduleGroup(this, "SenderSchedules", { removalPolicy: RemovalPolicy.DESTROY });
    const schedulerRole = new Role(this, "SenderSchedulerRole", {
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": this.account }, ArnLike: { "aws:SourceArn": senderSchedules.scheduleGroupArn } },
      }),
    });
    sender.grantInvoke(schedulerRole);
    senderSchedules.grants.writeSchedules(sender);
    sender.addToRolePolicy(
      new PolicyStatement({ actions: ["iam:PassRole"], resources: [schedulerRole.roleArn], conditions: { StringEquals: { "iam:PassedToService": "scheduler.amazonaws.com" } } }),
    );
    sender.addEnvironment(environmentVariables.scheduleGroup, senderSchedules.scheduleGroupName);
    sender.addEnvironment(environmentVariables.schedulerRole, schedulerRole.roleArn);
    // Unpausing an agent, and raising its limits, hand the sender what waits, without waiting.
    handler.addEnvironment(environmentVariables.senderFunction, sender.functionArn);
    sender.grantInvoke(handler);
    // Setting a thread aside in Remind me schedules the sender to bring it back, in the same group with the same role.
    senderSchedules.grants.writeSchedules(handler);
    handler.addToRolePolicy(
      new PolicyStatement({ actions: ["iam:PassRole"], resources: [schedulerRole.roleArn], conditions: { StringEquals: { "iam:PassedToService": "scheduler.amazonaws.com" } } }),
    );
    handler.addEnvironment(environmentVariables.scheduleGroup, senderSchedules.scheduleGroupName);
    handler.addEnvironment(environmentVariables.schedulerRole, schedulerRole.roleArn);

    // SNS invokes the feedback Lambda, without waiting, with each event SES publishes, and only SNS
    // may, for this topic. Lambda retries a failed event twice, then leaves it in the failure queue.
    const feedbackFailures = new Queue(this, "FeedbackFailures", {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const feedback = lambda("FeedbackHandler", "@duva/api/feedback-lambda", { [environmentVariables.tableName]: table.tableName });
    feedback.configureAsyncInvoke({ retryAttempts: 2, onFailure: new SqsDestination(feedbackFailures) });
    feedbackTopic.addSubscription(new LambdaSubscription(feedback));
    table.grantReadWriteData(feedback);
    // A hard bounce of one of the organization's own addresses takes it off the account's suppression list.
    feedback.addToRolePolicy(new PolicyStatement({ actions: ["ses:DeleteSuppressedDestination"], resources: ["*"] }));

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
        [environmentVariables.eraserFunction]: eraser.functionArn,
        [environmentVariables.mailBucket]: mail.bucketName,
        [environmentVariables.receiptRuleSet]: receiving.receiptRuleSetName,
        [environmentVariables.inboundFunction]: inbound.functionArn,
        [environmentVariables.recovery]: recovery,
        [environmentVariables.webUrl]: webUrl,
        [environmentVariables.configurationSet]: sending.configurationSetName,
      },
      { timeout: Duration.minutes(5) },
    );
    table.grantReadWriteData(setup);
    // It mails the first admin their first sign-in link, from the domain sign-in codes come from (ADR-0041).
    humans.grant(setup, "cognito-idp:DescribeUserPool");
    setup.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: [identities, configurationSet] }));
    // It starts each mailbox's backfill.
    indexQueue.grantSendMessages(setup);
    humans.grant(setup, "cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser");
    // It erases the mailboxes agents owned before they owned none (ADR-0030), handing each to the
    // eraser and taking their addresses out of the receipt rules, as the API does. IAM has no
    // resource type for receipt rules or the suppression list, so these can't be limited.
    eraser.grantInvoke(setup);
    setup.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:DescribeReceiptRuleSet", "ses:CreateReceiptRule", "ses:UpdateReceiptRule", "ses:DeleteReceiptRule", "ses:ListSuppressedDestinations", "ses:DeleteSuppressedDestination"],
        resources: ["*"],
      }),
    );

    // A sign-in link is the user pool's custom challenge, whose three triggers are one Lambda only
    // the pool may invoke, as CDK's permission for each names the pool (ADR-0041). It deletes the
    // link it checks, and may touch nothing else in the table.
    const signInLinks = lambda("SignInLinksHandler", "@duva/api/sign-in-links-lambda", { [environmentVariables.tableName]: table.tableName });
    signInLinks.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:DeleteItem"],
        resources: [table.tableArn],
        conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": [`${signInLinkPrefix}*`] } },
      }),
    );
    for (const operation of [UserPoolOperation.DEFINE_AUTH_CHALLENGE, UserPoolOperation.CREATE_AUTH_CHALLENGE, UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE]) {
      humans.addTrigger(operation, signInLinks);
    }

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
    // One permission for the whole API, never one per route: Lambda caps a function's resource
    // policy at 20 KB, and a statement per route outgrew it (docs/aws.md).
    const integration = new HttpLambdaIntegration("Handler", handler, { scopePermissionToRoute: false });
    for (const operation of operations) {
      const method = HttpMethod[operation.method.toUpperCase() as keyof typeof HttpMethod];
      api.addRoutes({ path: operation.path, methods: [method], integration, authorizer: operation.signIn ? authorizer : undefined });
    }

    // Mailbox agents (ADR-0027). One AgentCore Runtime serves them all, running their own Converse
    // tool loop, and bills only while a session runs. Each run is a session the conversation Lambda
    // stops when the run ends, and one left open ends after a minute idle. Only IAM invokes it.
    // AgentCore isn't in every region where SES receives mail, and without it the stack leaves the
    // runtime out and the conversation Lambda refuses every turn.
    const agentsHere = new CfnCondition(this, "MailboxAgentsCondition", {
      expression: Fn.conditionNot(Fn.conditionOr(...regionsWithoutAgentCore.map((region) => Fn.conditionEquals(Aws.REGION, region)))),
    });
    // They browse, and unsubscribe on senders' pages (ADR-0031, ADR-0038), in AgentCore Browser: a
    // browser in a microVM of its own for each session, wiped when it ends, on AWS's network rather
    // than one of the account's, recording nothing. It bills only while a session runs, which the
    // runtime starts and stops (docs/research/unsubscribe-browser-and-bounce.md). Its managed
    // Chrome policy, which no session can override, refuses every download and saves no password,
    // card or address. CloudFormation reads the policy from the file's asset as it creates the
    // browser, which keeps it (docs/aws.md).
    const browserPolicy = new Asset(this, "BrowserPolicy", { path: fileURLToPath(new URL("browser-policy.json", import.meta.url)) });
    const browser = new BrowserCustom(this, "Browser", {
      description: "The browser Duva's mailbox agents browse in",
      networkConfiguration: BrowserNetworkConfiguration.usingPublicNetwork(),
    });
    (browser.node.defaultChild as CfnBrowserCustom).enterprisePolicies = [{ type: "MANAGED", location: { bucket: browserPolicy.s3BucketName, prefix: browserPolicy.s3ObjectKey } }];
    // They search the web (ADR-0037) through an AgentCore Gateway with Web Search's target, which
    // takes only SigV4 calls. Web Search runs only in three regions, so the gateway is in the one
    // nearest the deployment, where CloudFormation can't create it: a custom resource of the
    // stack's does, which only CloudFormation invokes, and deletes it with the stack (docs/aws.md).
    // The gateway searches with a role of its own, allowed only Web Search, AWS's tool.
    const searchRole = new Role(this, "WebSearchRole", {
      assumedBy: new ServicePrincipal("bedrock-agentcore.amazonaws.com", { conditions: { StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID } } }),
      description: "The role Duva's gateway to Web Search searches with",
    });
    searchRole.addToPolicy(new PolicyStatement({ actions: ["bedrock-agentcore:InvokeWebSearch"], resources: ["arn:aws:bedrock-agentcore:*:aws:tool/web-search.v1"] }));
    const gatewayMaker = lambda("WebSearchGatewayHandler", "@duva/api/web-search-gateway-lambda", {}, { timeout: Duration.minutes(5) });
    const gateways = this.formatArn({ service: "bedrock-agentcore", region: "*", resource: "gateway", resourceName: "*" });
    gatewayMaker.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock-agentcore:CreateGateway", "bedrock-agentcore:GetGateway", "bedrock-agentcore:UpdateGateway", "bedrock-agentcore:DeleteGateway", "bedrock-agentcore:CreateGatewayTarget", "bedrock-agentcore:GetGatewayTarget", "bedrock-agentcore:DeleteGatewayTarget", "bedrock-agentcore:ListGatewayTargets"],
        resources: [gateways, `${gateways}/*`],
      }),
    );
    // Listing gateways names no resource, and a gateway's creation gives it a workload identity.
    gatewayMaker.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:ListGateways"], resources: ["*"] }));
    gatewayMaker.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock-agentcore:CreateWorkloadIdentity", "bedrock-agentcore:GetWorkloadIdentity", "bedrock-agentcore:DeleteWorkloadIdentity"],
        resources: [this.formatArn({ service: "bedrock-agentcore", region: "*", resource: "workload-identity-directory", resourceName: "*" })],
      }),
    );
    searchRole.grantPassRole(gatewayMaker.role!);
    const searchGateway = new CustomResource(this, "WebSearchGateway", {
      serviceToken: gatewayMaker.functionArn,
      resourceType: "Custom::WebSearchGateway",
      properties: { Name: `${Aws.STACK_NAME}-${Aws.REGION}-web-search`, Role: searchRole.roleArn },
    });
    const agentRuntime = new AgentRuntime(this, "MailboxAgents", {
      description: "Duva's mailbox agents",
      agentRuntimeArtifact: AgentRuntimeArtifact.fromCodeAsset({ path: agentCode(), runtime: AgentCoreRuntime.NODE_22, entrypoint: [agentEntryPoint] }),
      lifecycleConfiguration: { idleRuntimeSessionTimeout: Duration.seconds(60), maxLifetime: Duration.hours(1) },
      environmentVariables: { [environmentVariables.browser]: browser.browserId, [environmentVariables.webSearchGateway]: searchGateway.getAttString("Url") },
    });
    browser.grantUse(agentRuntime.role);
    // Each human's Coo browses in a profile of their own, which the runtime finds by its name,
    // creates on their first browsing run, starts sessions with and saves back to (ADR-0038). Duva's
    // profiles are named duva_ and the human, and are listed by name. The API deletes one when its
    // human signs Coo out of every site, or is removed. Creating and listing name no profile, so IAM
    // asks for them on browser-profile/*, and the runtime may create only profiles it tags as Duva's
    // (docs/aws.md).
    const browserProfiles = this.formatArn({ service: "bedrock-agentcore", resource: "browser-profile", resourceName: "duva_*" });
    const allProfiles = this.formatArn({ service: "bedrock-agentcore", resource: "browser-profile", resourceName: "*" });
    agentRuntime.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:StartBrowserSession", "bedrock-agentcore:SaveBrowserSessionProfile"], resources: [browserProfiles] }));
    agentRuntime.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:SaveBrowserSessionProfile"], resources: [browser.browserArn] }));
    agentRuntime.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock-agentcore:CreateBrowserProfile", "bedrock-agentcore:TagResource"],
        resources: [allProfiles],
        conditions: browserProfileTagged,
      }),
    );
    handler.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:DeleteBrowserProfile"], resources: [browserProfiles] }));
    for (const listing of [agentRuntime, handler]) listing.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:ListBrowserProfiles"], resources: [allProfiles] }));
    handler.addEnvironment(environmentVariables.browser, Fn.conditionIf(agentsHere.logicalId, browser.browserId, "").toString());
    agentRuntime.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:InvokeGateway"], resources: [searchGateway.getAttString("Arn")] }));
    const searching = [searchRole, gatewayMaker, this.node.findChild("WebSearchGatewayLogs"), searchGateway];
    // As an aspect, so it reaches what CDK adds as it synthesizes too, as the policy the runtime's role outgrows.
    const conditioned = {
      visit(node: IConstruct) {
        if (node instanceof CfnResource) node.cfnOptions.condition = agentsHere;
      },
    };
    for (const construct of [agentRuntime, browser, ...searching]) Aspects.of(construct).add(conditioned);
    // The agents call their model in the model region the organization chose, through its eu, us or
    // global inference profile, which may send it on to that profile's regions (docs/aws.md). So
    // the role may invoke the models admins can choose through the profiles each has in any region,
    // and the models themselves only through one of them, or in the regions where they run without one.
    // The decider, Nova Micro, goes through the eu or us profile (#132).
    const models: (MailboxAgentModel | typeof deciderModel)[] = [...(Object.keys(mailboxAgentModels) as MailboxAgentModel[]), deciderModel];
    const profiles = models.flatMap((model) =>
      (model === deciderModel ? ["eu", "us"] : mailboxAgentModels[model].profiles.filter((profile) => profile !== "none")).map((profile) =>
        this.formatArn({ service: "bedrock", region: "*", resource: "inference-profile", resourceName: `${profile}.${model}` }),
      ),
    );
    const inRegion = models.flatMap((model) => (model === deciderModel ? [] : mailboxAgentModels[model].inRegion).map((region) => `arn:aws:bedrock:${region}::foundation-model/${model}`));
    agentRuntime.addToRolePolicy(new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], resources: [...profiles, ...inRegion] }));
    agentRuntime.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: models.flatMap((model) => [`arn:aws:bedrock:*::foundation-model/${model}`, `arn:aws:bedrock:::foundation-model/${model}`]),
        conditions: { StringLike: { "bedrock:InferenceProfileArn": profiles } },
      }),
    );

    // Suggestions and style notes call their model from the API and the sender (#156): gpt-oss-20b
    // and Qwen3 32B on demand, in the deployment's region or, outside the EU and the US, eu-central-1,
    // and Nova Micro and Claude Haiku 4.5 through their eu or us profile, which may send them on to
    // that profile's regions (docs/aws.md).
    const suggesting = (Object.keys(suggestionModels) as SuggestionModel[]).map((model) => ({ model, profiled: suggestionModels[model].profiled }));
    const suggestionProfiles = suggesting
      .filter(({ profiled }) => profiled)
      .flatMap(({ model }) => ["eu", "us"].map((profile) => this.formatArn({ service: "bedrock", region: "*", resource: "inference-profile", resourceName: `${profile}.${model}` })));
    for (const writer of [handler, sender]) {
      writer.addToRolePolicy(
        new PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: [
            ...suggesting.filter(({ profiled }) => !profiled).map(({ model }) => `arn:aws:bedrock:*::foundation-model/${model}`),
            ...suggestionProfiles,
          ],
        }),
      );
      writer.addToRolePolicy(
        new PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: suggesting.filter(({ profiled }) => profiled).map(({ model }) => `arn:aws:bedrock:*::foundation-model/${model}`),
          conditions: { StringLike: { "bedrock:InferenceProfileArn": suggestionProfiles } },
        }),
      );
    }
    // The sender embeds each style note it writes, as memories are, with Titan in the deployment's region.
    sender.addToRolePolicy(embedding);

    // Ask Coo posts each turn to the web app's domain, under /agent/, where CloudFront signs
    // the request to the conversation Lambda's function URL, which only the distribution may call
    // (docs/aws.md). CloudFront's signature takes the Authorization header, so the human's access
    // token comes in a header of its own, and a POST carries its body's SHA-256 to CloudFront, as OAC asks. The
    // Lambda asks the API whose token it is, and streams the run as it goes.
    // The API's URL reaches the conversation Lambda through a parameter, since the API names the
    // distribution in its CORS and the distribution the Lambda's function URL.
    const apiUrlParameter = `/${Aws.STACK_NAME}/${this.region}/ApiUrl`;
    const conversation = lambda(
      "ConversationHandler",
      "@duva/api/conversation-lambda",
      {
        [environmentVariables.tableName]: table.tableName,
        [environmentVariables.apiUrlParameter]: apiUrlParameter,
        [environmentVariables.agentRuntime]: Fn.conditionIf(agentsHere.logicalId, agentRuntime.agentRuntimeArn, "").toString(),
      },
      { timeout: Duration.minutes(15) },
    );
    table.grantReadWriteData(conversation);
    new StringParameter(this, "ApiUrlParameter", { parameterName: apiUrlParameter, simpleName: false, stringValue: api.apiEndpoint, description: "The URL of Duva's API" });
    conversation.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter"], resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: apiUrlParameter.slice(1) })] }));
    const runtimes = this.formatArn({ service: "bedrock-agentcore", resource: "runtime", resourceName: "*" });
    conversation.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:InvokeAgentRuntime", "bedrock-agentcore:StopRuntimeSession"], resources: [runtimes, `${runtimes}/*`] }));
    // It keeps each turn's routing with its words' Titan embedding, made in the deployment's own region (#132).
    conversation.addToRolePolicy(embedding);
    const conversationUrl = conversation.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM, invokeMode: InvokeMode.RESPONSE_STREAM });
    distribution.addBehavior(
      `/${conversationPath}*`,
      FunctionUrlOrigin.withOriginAccessControl(conversationUrl, {
        originAccessControl: new FunctionUrlOriginAccessControl(this, "ConversationAccess", { originAccessControlName: `Duva-Conversation-${this.region}` }),
        readTimeout: Duration.seconds(60),
      }),
      {
        allowedMethods: AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: new OriginRequestPolicy(this, "ConversationRequests", {
          originRequestPolicyName: `Duva-Conversation-${this.region}`,
          // CloudFront refuses x-amz- headers in a policy. The body's hash reaches the signature without one (docs/aws.md).
          headerBehavior: OriginRequestHeaderBehavior.allowList(tokenHeader, "content-type"),
          queryStringBehavior: OriginRequestQueryStringBehavior.none(),
          cookieBehavior: OriginRequestCookieBehavior.none(),
        }),
      },
    );
    conversation.addPermission("CloudFrontInvoke", {
      principal: new ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: distribution.distributionArn,
    });

    // Duva's MCP endpoint (ADR-0028), on the API's domain. Its routes have no authorizer: the MCP
    // Lambda answers 401 with where to sign in, as MCP clients need, and takes only access tokens
    // issued to the MCP app client, which the authorizer refuses. MCP clients register with it, and
    // sign in through it to that one app client, whose only callback is the endpoint's, since a user
    // pool has at most 20 managed login styles (docs/aws.md). It hands each turn it prepares to the
    // conversation Lambda.
    const mcpClient = client("McpClient", [`${api.apiEndpoint}${mcpCallbackPath}`], []);
    const mcp = lambda(
      "McpHandler",
      "@duva/api/mcp-lambda",
      {
        [environmentVariables.version]: version,
        [environmentVariables.tableName]: table.tableName,
        [environmentVariables.userPoolId]: humans.userPoolId,
        [environmentVariables.signInUrl]: signIn.baseUrl(),
        [environmentVariables.mcpClientId]: mcpClient.userPoolClientId,
        [environmentVariables.conversationFunction]: conversation.functionName,
        [environmentVariables.agentRuntime]: Fn.conditionIf(agentsHere.logicalId, agentRuntime.agentRuntimeArn, "").toString(),
      },
      // API Gateway ends a call after 30 seconds.
      { timeout: Duration.seconds(30) },
    );
    table.grantReadWriteData(mcp);
    conversation.grantInvoke(mcp);
    // One permission for the MCP Lambda's routes, as for the API's, with the API's own ARN.
    const mcpIntegration = new HttpLambdaIntegration("Mcp", mcp, { scopePermissionToRoute: false });
    for (const { path, methods } of mcpRoutes) api.addRoutes({ path, methods: methods.map((method) => HttpMethod[method]), integration: mcpIntegration });

    // Label prompts (ADR-0029). The table's stream hands the task giver each change that may add a
    // label in a mailbox, and the giver hands each task a prompt gives to the task runner, without
    // waiting, as unpausing a mailbox agent does with its tasks that wait. The runner runs the agent
    // as the conversation Lambda does, for up to Lambda's 15 minutes, and Lambda retries none, since
    // a run that started has acted on the mail. Only IAM invokes it.
    const taskRunner = lambda(
      "TaskRunnerHandler",
      "@duva/api/task-runner-lambda",
      {
        [environmentVariables.tableName]: table.tableName,
        [environmentVariables.apiUrlParameter]: apiUrlParameter,
        [environmentVariables.agentRuntime]: Fn.conditionIf(agentsHere.logicalId, agentRuntime.agentRuntimeArn, "").toString(),
      },
      { timeout: Duration.minutes(15) },
    );
    taskRunner.configureAsyncInvoke({ retryAttempts: 0 });
    table.grantReadWriteData(taskRunner);
    taskRunner.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter"], resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: apiUrlParameter.slice(1) })] }));
    taskRunner.addToRolePolicy(new PolicyStatement({ actions: ["bedrock-agentcore:InvokeAgentRuntime", "bedrock-agentcore:StopRuntimeSession"], resources: [runtimes, `${runtimes}/*`] }));
    // It also goes on unsubscribing where one-click didn't (ADR-0031), which the API and the inbound
    // Lambda hand it, and as a last resort bounces the sender's mail, from the identity of the
    // organization's domain it was sent to, as the inbound Lambda bounces mail a group refuses.
    taskRunner.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendBounce"], resources: [identities] }));
    // It settles and runs requests mailed to a Coo's address, kept in the mail bucket, keeps each
    // turn's routing with its Titan embedding, as the conversation Lambda does, and mails Coo's
    // codes and answers from its address, which is on one of the organization's domains (ADR-0040).
    taskRunner.addEnvironment(environmentVariables.mailBucket, mail.bucketName);
    taskRunner.addEnvironment(environmentVariables.configurationSet, sending.configurationSetName);
    mail.grantRead(taskRunner, `${cooRequestsPrefix}*`);
    erasesUnder(taskRunner, cooRequestsPrefix);
    taskRunner.addToRolePolicy(embedding);
    taskRunner.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: [identities, configurationSet] }));
    const taskGiver = lambda("TaskGiverHandler", "@duva/api/task-giver-lambda", {
      [environmentVariables.tableName]: table.tableName,
      [environmentVariables.taskRunnerFunction]: taskRunner.functionArn,
    });
    taskGiver.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 10,
        bisectBatchOnError: true,
        filters: [FilterCriteria.filter(taskGiverFilter)],
      }),
    );
    table.grantReadWriteData(taskGiver);
    taskRunner.grantInvoke(taskGiver);
    for (const invoker of [handler, inbound]) {
      invoker.addEnvironment(environmentVariables.taskRunnerFunction, taskRunner.functionArn);
      taskRunner.grantInvoke(invoker);
    }

    new CfnOutput(this, stackOutputs.apiUrl, { value: api.apiEndpoint, description: "The URL of Duva's API" });
    new CfnOutput(this, stackOutputs.mcpFunction, { value: mcp.functionName, description: "The function API Gateway invokes for Duva's MCP endpoint" });
    new CfnOutput(this, stackOutputs.conversationFunction, { value: conversation.functionName, description: "The function Ask Coo's turns invoke through CloudFront" });
    new CfnOutput(this, stackOutputs.agentRuntime, { value: Fn.conditionIf(agentsHere.logicalId, agentRuntime.agentRuntimeArn, "").toString(), description: "The mailbox agents' AgentCore Runtime, empty where AgentCore isn't" });
    new CfnOutput(this, stackOutputs.webUrl, { value: webUrl, description: "The URL of Duva's web app" });
    new CfnOutput(this, stackOutputs.webBucket, { value: web.bucketName, description: "The bucket the web app is served from" });
    new CfnOutput(this, stackOutputs.signInUrl, { value: signIn.baseUrl(), description: "The URL of managed login" });
    new CfnOutput(this, stackOutputs.userPoolId, { value: humans.userPoolId, description: "The user pool humans sign in with" });
    new CfnOutput(this, stackOutputs.webClientId, { value: webClient.userPoolClientId, description: "The web app's app client" });
    new CfnOutput(this, stackOutputs.cliClientId, { value: cliClient.userPoolClientId, description: "The CLI's app client" });
    new CfnOutput(this, stackOutputs.setupFunction, { value: setup.functionName, description: "The function that sets up the organization" });
    new CfnOutput(this, stackOutputs.receiptRuleSet, { value: receiving.receiptRuleSetName, description: "Duva's receipt rule set" });
    new CfnOutput(this, stackOutputs.sendFailures, { value: sendFailures.queueUrl, description: "The queue of approved sends that failed processing" });
    new CfnOutput(this, stackOutputs.feedbackFunction, { value: feedback.functionName, description: "The function SNS invokes with SES's bounces, complaints and rejects" });
    new CfnOutput(this, stackOutputs.feedbackFailures, { value: feedbackFailures.queueUrl, description: "The queue of SES's events that failed processing" });
    new CfnOutput(this, stackOutputs.downloadUrl, { value: downloadUrl, description: "Where download links lead, on the web app's domain" });
    new CfnOutput(this, stackOutputs.downloadFunction, { value: download.functionName, description: "The function download links invoke through CloudFront" });
    new CfnOutput(this, stackOutputs.unsubscriberFunction, { value: unsubscriber.functionName, description: "The function that sends one-click unsubscribes" });
    new CfnOutput(this, stackOutputs.logoFetcherFunction, { value: logoFetcher.functionName, description: "The function that fetches senders' logos" });
    new CfnOutput(this, stackOutputs.searchFunction, { value: searcher.functionName, description: "The function that runs searches, which only the API invokes" });
    new CfnOutput(this, stackOutputs.indexFailures, { value: indexFailures.queueUrl, description: "The queue of the indexer's tasks that failed" });
    new CfnOutput(this, stackOutputs.logosBucket, { value: logos.bucketName, description: "The bucket the organization's own logos are in, which CloudFront serves" });
    new CfnOutput(this, stackOutputs.logosUrl, { value: logosUrl, description: "Where the organization's own logos are served, on the web app's domain" });
    new CfnOutput(this, stackOutputs.uploadsBucket, { value: uploads.bucketName, description: "The bucket the files uploaded to drafts are in" });
    new CfnOutput(this, stackOutputs.searchBucket, { value: search.bucketName, description: "The bucket the mailboxes' search indexes are in" });
    new CfnOutput(this, stackOutputs.inboundFailures, { value: inboundFailures.queueUrl, description: "The queue of received mail that failed processing" });
    ([1, 2, 3] as const).forEach((n, index) => {
      const { name, value } = identity.dkimRecords[index]!;
      new CfnOutput(this, stackOutputs.dkimName(n), { value: name, description: "A DKIM CNAME record's name" });
      new CfnOutput(this, stackOutputs.dkimValue(n), { value, description: "A DKIM CNAME record's value" });
    });
  }
}
