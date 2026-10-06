// The names deploy and the Duva stack share. Kept apart from the CDK app, so the CLI can import
// them without aws-cdk-lib.

/** The Duva stack's name. */
export const stackName = "Duva";

/** The stack's parameters, which deploy sets when it runs. */
export const stackParameters = { domain: "Domain", admin: "Admin", domainVerified: "DomainVerified" } as const;

/** The stack's outputs. SES gives a domain identity three DKIM records, numbered 1 to 3. */
export const stackOutputs = {
  apiUrl: "ApiUrl",
  webUrl: "WebUrl",
  webBucket: "WebBucket",
  signInUrl: "SignInUrl",
  userPoolId: "UserPoolId",
  webClientId: "WebClientId",
  cliClientId: "CliClientId",
  setupFunction: "SetupFunction",
  receiptRuleSet: "ReceiptRuleSet",
  inboundFailures: "InboundFailuresUrl",
  sendFailures: "SendFailuresUrl",
  downloadUrl: "DownloadUrl",
  downloadFunction: "DownloadFunction",
  unsubscriberFunction: "UnsubscriberFunction",
  searchFunction: "SearchFunction",
  indexFailures: "IndexFailuresUrl",
  searchBucket: "SearchBucket",
  dkimName: (n: 1 | 2 | 3) => `DkimName${n}`,
  dkimValue: (n: 1 | 2 | 3) => `DkimValue${n}`,
} as const;

/**
 * Where managed login sends the CLI back to after sign-in: a loopback address duva login listens
 * on. Cognito matches the port too, so it is fixed.
 */
export const cliRedirectUri = "http://127.0.0.1:8976/callback";

/** The address sign-in codes come from once SES has verified the domain. */
export const signInSender = (domain: string) => `no-reply@${domain}`;
