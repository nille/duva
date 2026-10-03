// The names deploy and the Duva stack share. Kept apart from the CDK app, so the CLI can import
// them without aws-cdk-lib.

/** The Duva stack's name. */
export const stackName = "Duva";

/** The stack's parameters, which deploy sets when it runs. */
export const stackParameters = { domain: "Domain" } as const;

/** The stack's outputs. SES gives a domain identity three DKIM records, numbered 1 to 3. */
export const stackOutputs = {
  apiUrl: "ApiUrl",
  receiptRuleSet: "ReceiptRuleSet",
  dkimName: (n: 1 | 2 | 3) => `DkimName${n}`,
  dkimValue: (n: 1 | 2 | 3) => `DkimValue${n}`,
} as const;
