// The names deploy, the scripts that check and destroy a deployment, and the Duva stack share.
// Kept apart from the CDK app, so the CLI can import them without aws-cdk-lib.

/** The Duva stack's name. */
export const stackName = "Duva";

/** The stack's parameters, which deploy sets when it runs. */
export const stackParameters = {
  domain: "Domain",
  admin: "Admin",
  signInDomain: "SignInDomain",
  domainVerified: "DomainVerified",
  recovery: "Recovery",
  webHosts: "WebHosts",
  webCertificate: "WebCertificate",
} as const;

/** The stack's outputs. SES gives a domain identity three DKIM records, numbered 1 to 3. */
export const stackOutputs = {
  apiUrl: "ApiUrl",
  webUrl: "WebUrl",
  distributionDomain: "WebDistributionDomain",
  webBucket: "WebBucket",
  signInUrl: "SignInUrl",
  userPoolId: "UserPoolId",
  webClientId: "WebClientId",
  cliClientId: "CliClientId",
  setupFunction: "SetupFunction",
  receiptRuleSet: "ReceiptRuleSet",
  inboundFailures: "InboundFailuresUrl",
  sendFailures: "SendFailuresUrl",
  feedbackFunction: "FeedbackFunction",
  feedbackFailures: "FeedbackFailuresUrl",
  downloadUrl: "DownloadUrl",
  downloadFunction: "DownloadFunction",
  unsubscriberFunction: "UnsubscriberFunction",
  logoFetcherFunction: "LogoFetcherFunction",
  searchFunction: "SearchFunction",
  indexFailures: "IndexFailuresUrl",
  searchBucket: "SearchBucket",
  logosBucket: "LogosBucket",
  logosUrl: "LogosUrl",
  uploadsBucket: "UploadsBucket",
  conversationFunction: "ConversationFunction",
  agentRuntime: "AgentRuntime",
  mcpFunction: "McpFunction",
  dkimName: (n: 1 | 2 | 3) => `DkimName${n}`,
  dkimValue: (n: 1 | 2 | 3) => `DkimValue${n}`,
} as const;

/** The log group AgentCore makes for the runtime's DEFAULT endpoint, by the runtime's ID (docs/aws.md). */
export const runtimeLogGroup = (agentRuntimeId: string) => `/aws/bedrock-agentcore/runtimes/${agentRuntimeId}-DEFAULT`;

/**
 * The log groups a deletion of the stack may leave, from its resources as CloudFormation lists them:
 * each of the stack's own, which a Lambda invoked as the stack is deleted can make again once
 * CloudFormation deleted it, as the gateway's custom resource did, and the runtime's, which AgentCore
 * makes and CloudFormation never deletes (docs/aws.md, #181).
 */
export const logGroupsLeft = (resources: { ResourceType?: string; PhysicalResourceId?: string }[]) =>
  resources.flatMap(({ ResourceType, PhysicalResourceId: id }) =>
    id === undefined ? [] : ResourceType === "AWS::Logs::LogGroup" ? [id] : ResourceType === "AWS::BedrockAgentCore::Runtime" ? [runtimeLogGroup(id)] : [],
  );

/** The tag that names the region of the deployment a certificate in us-east-1 serves, as one account may have a deployment in each region. */
export const deploymentTag = "duva-deployment";

/** Whether the tags say the deployment in the region requested what they're on. */
export const deploymentTagged = (tags: { Key?: string; Value?: string }[], region: string) => tags.some(({ Key, Value }) => Key === deploymentTag && Value === region);

/** The web app's hosts as the WebHosts parameter holds them, comma-separated, and the hosts it holds. */
export const webHostsValue = (hosts: string[]) => hosts.join(",");
export const webHostsIn = (value: string) => value.split(",").filter((host) => host !== "");

/**
 * Where managed login sends the CLI back to after sign-in: a loopback address duva login listens
 * on. Cognito matches the port too, so it is fixed.
 */
export const cliRedirectUri = "http://127.0.0.1:8976/callback";
