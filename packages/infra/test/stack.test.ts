// These tests check the cloud assembly the CDK app synthesizes, which is what duva deploy ships.
// Each rule holds for every resource, so it also covers what later tickets add.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentVariables, senderFilter, senderRetries, timeToLiveAttribute } from "@duva/api/infrastructure";
import { operations } from "@duva/openapi";
import { buildSync } from "esbuild";
import { expect, test } from "vitest";
import { duvaApp } from "../src/app.ts";

interface Resource {
  Type: string;
  /** Untyped CloudFormation JSON. */
  Properties?: Record<string, any>;
}

/**
 * Resource types an idle deployment pays nothing for beyond storage (ADR-0006). Add a type only
 * once you know that holds for it.
 */
const payPerUse = new Set([
  "AWS::ApiGatewayV2::Api",
  "AWS::ApiGatewayV2::Authorizer",
  "AWS::ApiGatewayV2::Integration",
  "AWS::ApiGatewayV2::Route",
  "AWS::ApiGatewayV2::Stage",
  "AWS::CloudFront::Distribution",
  "AWS::CloudFront::OriginAccessControl",
  // The Essentials plan is paid per monthly active human, past a free tier.
  "AWS::Cognito::ManagedLoginBranding",
  "AWS::Cognito::UserPool",
  "AWS::Cognito::UserPoolClient",
  "AWS::Cognito::UserPoolDomain",
  "AWS::DynamoDB::GlobalTable",
  // A scheduled rule on the default event bus costs nothing; only the invocations it makes do.
  "AWS::Events::Rule",
  "AWS::IAM::Policy",
  "AWS::IAM::Role",
  "AWS::Lambda::EventInvokeConfig",
  // Lambda reads a DynamoDB stream at no charge, so a mapping costs only the invocations it makes.
  "AWS::Lambda::EventSourceMapping",
  "AWS::Lambda::Function",
  "AWS::Lambda::Permission",
  // A function URL costs nothing of its own, only the invocations it makes.
  "AWS::Lambda::Url",
  "AWS::Logs::LogGroup",
  "AWS::S3::Bucket",
  "AWS::S3::BucketPolicy",
  "AWS::SES::ConfigurationSet",
  "AWS::SES::EmailIdentity",
  "AWS::SES::ReceiptRuleSet",
  "AWS::SQS::Queue",
  "AWS::SQS::QueuePolicy",
]);

const outdir = mkdtempSync(join(tmpdir(), "duva-assembly-"));
const assembly = duvaApp({ outdir, version: "0.0.0-test" }).synth();
const stack = assembly.getStackByName("Duva");
const resources = Object.entries(stack.template.Resources as Record<string, Resource>);
const ofType = (type: string) => resources.filter(([, resource]) => resource.Type === type);

test("an idle deployment pays for nothing beyond storage", () => {
  const types = new Set(resources.map(([, resource]) => resource.Type));
  expect([...types].filter((type) => !payPerUse.has(type))).toEqual([]);
});

test("every Lambda runs Node.js 24 on arm64, outside any VPC", () => {
  const functions = ofType("AWS::Lambda::Function");
  expect(functions).not.toHaveLength(0);
  for (const [id, { Properties }] of functions) {
    const { Runtime: runtime, Architectures: architectures, VpcConfig: vpc } = Properties ?? {};
    expect({ id, runtime, architectures, vpc }).toEqual({ id, runtime: "nodejs24.x", architectures: ["arm64"], vpc: undefined });
  }
});

test("every Lambda carries its own AWS SDK, so a CLI version pins all the code it deploys", () => {
  const assets = JSON.parse(readFileSync(join(outdir, `${stack.id}.assets.json`), "utf8")) as {
    files: Record<string, { source: { path: string } }>;
  };
  for (const [id, { Properties }] of ofType("AWS::Lambda::Function")) {
    const asset = assets.files[String(Properties?.Code?.S3Key).replace(/\.zip$/, "")];
    if (asset === undefined) throw new Error(`${id} has no asset in the assembly`);
    const directory = join(outdir, asset.source.path);
    const sdkImports = readdirSync(directory, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.[cm]?js$/.test(file))
      .flatMap((file) => importsOf(join(directory, file)))
      .filter((path) => path.startsWith("@aws-sdk/"));
    expect({ id, sdkImports }).toEqual({ id, sdkImports: [] });
  }
});

/** The modules a bundle still imports at run time, read by esbuild so strings that name a module don't count. */
function importsOf(file: string): string[] {
  const { metafile } = buildSync({
    entryPoints: [file],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  return Object.values(metafile.inputs).flatMap(({ imports }) => imports.map(({ path }) => path));
}

test("the deployment has one table, on demand, with point-in-time recovery", () => {
  const tables = ofType("AWS::DynamoDB::GlobalTable");
  expect(tables).toHaveLength(1);
  for (const [, { Properties }] of tables) {
    expect(Properties?.BillingMode).toBe("PAY_PER_REQUEST");
    for (const replica of Properties?.Replicas ?? []) {
      expect(replica.PointInTimeRecoverySpecification).toEqual({ PointInTimeRecoveryEnabled: true });
    }
  }
});

test("every bucket is encrypted with SSE-S3 and blocks public access", () => {
  const buckets = ofType("AWS::S3::Bucket");
  expect(buckets).not.toHaveLength(0);
  for (const [id, { Properties }] of buckets) {
    const { BucketEncryption: encryption, PublicAccessBlockConfiguration: publicAccess } = Properties ?? {};
    expect({ id, encryption, publicAccess }).toEqual({
      id,
      encryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
      publicAccess: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
  }
});

test("the mail bucket keeps every version of raw mail", () => {
  const mailBuckets = new Set(
    ofType("AWS::Lambda::Function").flatMap(([, { Properties }]) => {
      const ref: unknown = Properties?.Environment?.Variables?.[environmentVariables.mailBucket]?.Ref;
      return typeof ref === "string" ? [ref] : [];
    }),
  );
  expect(mailBuckets.size).toBe(1);
  for (const id of mailBuckets) {
    expect(stack.template.Resources[id].Properties.VersioningConfiguration).toEqual({ Status: "Enabled" });
  }
});

/** The ID and resource of the one Lambda whose ID starts with `prefix`. */
function lambda(prefix: string): [string, Resource] {
  const [found, ...others] = resources.filter(([id, { Type }]) => Type === "AWS::Lambda::Function" && id.startsWith(prefix));
  if (found === undefined || others.length > 0) throw new Error(`There isn't exactly one Lambda whose ID starts with ${prefix}`);
  return found;
}

/** The statements of the IAM policies on the role of the Lambda whose ID starts with `prefix`. */
function statements(prefix: string): { Action: string | string[]; Resource: unknown }[] {
  const role = JSON.stringify(lambda(prefix)[1].Properties?.Role?.["Fn::GetAtt"]?.[0]);
  return ofType("AWS::IAM::Policy")
    .filter(([, { Properties }]) => (Properties?.Roles ?? []).some((ref: unknown) => JSON.stringify((ref as { Ref?: string }).Ref) === role))
    .flatMap(([, { Properties }]) => Properties?.PolicyDocument?.Statement ?? []);
}

/** The actions of the service the IAM policies let the Lambda whose ID starts with `prefix` take. */
function actions(prefix: string, service: string): string[] {
  return statements(prefix)
    .flatMap(({ Action }) => [Action].flat())
    .filter((action) => action.startsWith(`${service}:`));
}

const tableActions = (prefix: string) => actions(prefix, "dynamodb");

test("the API can write the table, and the authorizer can only read it", () => {
  expect(tableActions("ApiHandler")).toEqual(expect.arrayContaining(["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem"]));
  const authorizer = tableActions("AuthorizerHandler");
  expect(authorizer).toContain("dynamodb:GetItem");
  expect(authorizer.filter((action) => /Put|Update|Delete|Write/.test(action))).toEqual([]);
});

test("the inbound Lambda can write the table and read raw mail, and the API can read raw mail too", () => {
  expect(tableActions("InboundHandler")).toEqual(expect.arrayContaining(["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"]));
  expect(actions("InboundHandler", "s3")).toContain("s3:GetObject*");
  expect(actions("ApiHandler", "s3")).toContain("s3:GetObject*");
});

test("the inbound Lambda can erase raw mail for good, every version of it, and only under the inbound prefix", () => {
  const erasing = statements("InboundHandler").filter(({ Action }) => [Action].flat().some((action) => /s3:(DeleteObjectVersion|ListBucketVersions)/.test(action)));
  expect(erasing.flatMap(({ Action }) => [Action].flat()).sort()).toEqual(["s3:DeleteObjectVersion", "s3:ListBucketVersions"]);
  const scoped = JSON.stringify(erasing);
  expect(scoped).toContain('"/inbound/*"');
  expect(scoped).toContain('{"StringLike":{"s3:prefix":"inbound/*"}}');
  expect(actions("ApiHandler", "s3").filter((action) => /Delete/.test(action))).toEqual([]);
});

test("the eraser runs once a day, and has 15 minutes for a run", () => {
  const [eraserId, { Properties: eraser }] = lambda("EraserHandler");
  const rules = ofType("AWS::Events::Rule");
  expect(rules).toHaveLength(1);
  const [[ruleId, { Properties: rule }]] = rules as [[string, Resource]];
  expect(rule).toMatchObject({ ScheduleExpression: "rate(1 day)", State: "ENABLED", Targets: [{ Arn: { "Fn::GetAtt": [eraserId, "Arn"] } }] });
  const permissions = ofType("AWS::Lambda::Permission").filter(([, { Properties }]) => Properties?.Principal === "events.amazonaws.com");
  expect(permissions.map(([, { Properties }]) => Properties)).toEqual([
    expect.objectContaining({ Action: "lambda:InvokeFunction", FunctionName: { "Fn::GetAtt": [eraserId, "Arn"] }, SourceArn: { "Fn::GetAtt": [ruleId, "Arn"] } }),
  ]);
  expect(eraser?.Timeout).toBe(15 * 60);
});

test("the eraser can write the table and erase raw mail for good, every version of it, under the inbound and sent prefixes only", () => {
  expect(tableActions("EraserHandler")).toEqual(expect.arrayContaining(["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem"]));
  const erasing = statements("EraserHandler").filter(({ Action }) => [Action].flat().some((action) => action.startsWith("s3:")));
  expect([...new Set(erasing.flatMap(({ Action }) => [Action].flat()))].sort()).toEqual(["s3:DeleteObjectVersion", "s3:ListBucketVersions"]);
  const scoped = JSON.stringify(erasing);
  for (const prefix of ["inbound", "sent"]) {
    expect(scoped).toContain(`"/${prefix}/*"`);
    expect(scoped).toContain(`{"StringLike":{"s3:prefix":"${prefix}/*"}}`);
  }
  expect(scoped).not.toMatch(/"\/\*"|"s3:prefix":"\*"/);
});

test("the API invokes the eraser to empty a Trash, and may invoke no other Lambda", () => {
  const [eraserId] = lambda("EraserHandler");
  const invoking = statements("ApiHandler").filter(({ Action }) => [Action].flat().some((action) => action.startsWith("lambda:")));
  expect(JSON.stringify(invoking.map(({ Resource }) => Resource))).toContain(`{"Fn::GetAtt":["${eraserId}","Arn"]}`);
  expect(JSON.stringify(invoking.map(({ Resource }) => Resource)).match(/Fn::GetAtt":\["(\w+)"/g)?.every((ref) => ref.includes(eraserId))).toBe(true);
  expect(lambda("ApiHandler")[1].Properties?.Environment?.Variables?.[environmentVariables.eraserFunction]).toEqual({ "Fn::GetAtt": [eraserId, "Arn"] });
});

const [ruleSetId] = ofType("AWS::SES::ReceiptRuleSet")[0]!;

test("SES may invoke the inbound Lambda, only for Duva's receipt rule in this account", () => {
  const [inboundId] = lambda("InboundHandler");
  const permissions = ofType("AWS::Lambda::Permission").filter(([, { Properties }]) => Properties?.Principal === "ses.amazonaws.com");
  expect(permissions).toHaveLength(1);
  const [[, { Properties: permission }]] = permissions as [[string, Resource]];
  expect(permission).toMatchObject({ Action: "lambda:InvokeFunction", FunctionName: { "Fn::GetAtt": [inboundId, "Arn"] }, SourceAccount: { Ref: "AWS::AccountId" } });
  expect(JSON.stringify(permission?.SourceArn)).toContain(`{"Ref":"${ruleSetId}"},":receipt-rule/Addresses"`);
});

test("SES may store raw mail in the mail bucket, only under the inbound prefix and for Duva's receipt rule", () => {
  const sesStatements = ofType("AWS::S3::BucketPolicy")
    .flatMap(([, { Properties }]) => Properties?.PolicyDocument?.Statement ?? [])
    .filter(({ Principal }: { Principal?: { Service?: string } }) => Principal?.Service === "ses.amazonaws.com");
  expect(sesStatements).toHaveLength(1);
  const [statement] = sesStatements;
  expect(statement).toMatchObject({ Effect: "Allow", Action: "s3:PutObject", Condition: { StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } } } });
  expect(JSON.stringify(statement.Resource)).toContain('"/inbound/*"');
  expect(JSON.stringify(statement.Condition.ArnLike["aws:SourceArn"])).toContain(`{"Ref":"${ruleSetId}"},":receipt-rule/Addresses"`);
});

test("the inbound Lambda retries a failed event, then leaves it in a queue for replay", () => {
  const [inboundId] = lambda("InboundHandler");
  const configs = ofType("AWS::Lambda::EventInvokeConfig").filter(([, { Properties }]) => Properties?.FunctionName?.Ref === inboundId);
  expect(configs).toHaveLength(1);
  const [[, { Properties: config }]] = configs as [[string, Resource]];
  expect(config?.MaximumRetryAttempts).toBe(2);
  const queueId = config?.DestinationConfig?.OnFailure?.Destination?.["Fn::GetAtt"]?.[0];
  const queue = stack.template.Resources[queueId];
  expect(queue?.Type).toBe("AWS::SQS::Queue");
  expect(queue?.Properties?.MessageRetentionPeriod).toBe(14 * 24 * 3600);
});

test("the table's stream invokes the sender for each draft a decision approved, one record at a time, from the oldest", () => {
  const [[tableId, { Properties: table }]] = ofType("AWS::DynamoDB::GlobalTable") as [[string, Resource]];
  expect(table?.StreamSpecification).toEqual({ StreamViewType: "NEW_IMAGE" });
  const mappings = ofType("AWS::Lambda::EventSourceMapping");
  expect(mappings).toHaveLength(1);
  const [[, { Properties: mapping }]] = mappings as [[string, Resource]];
  expect(mapping).toMatchObject({
    FunctionName: { Ref: lambda("SenderHandler")[0] },
    EventSourceArn: { "Fn::GetAtt": [tableId, "StreamArn"] },
    StartingPosition: "TRIM_HORIZON",
    BatchSize: 1,
    FilterCriteria: { Filters: [{ Pattern: JSON.stringify(senderFilter) }] },
  });
});

test("the sender retries a failed record, then records it in a queue for replay", () => {
  const [[, { Properties: mapping }]] = ofType("AWS::Lambda::EventSourceMapping") as [[string, Resource]];
  expect(mapping?.MaximumRetryAttempts).toBe(senderRetries);
  const queueId = mapping?.DestinationConfig?.OnFailure?.Destination?.["Fn::GetAtt"]?.[0];
  const queue = stack.template.Resources[queueId];
  expect(queue?.Type).toBe("AWS::SQS::Queue");
  expect(queue?.Properties?.MessageRetentionPeriod).toBe(14 * 24 * 3600);
});

test("the sender sends through SES under Duva's configuration set, and stores what it sent only under the sent prefix", () => {
  expect([...new Set(actions("SenderHandler", "ses"))].sort()).toEqual(["ses:SendEmail", "ses:SendRawEmail"]);
  const [[setId]] = ofType("AWS::SES::ConfigurationSet") as [[string, Resource]];
  // SESv2 SendEmail with raw content is authorized as ses:SendRawEmail, on the configuration set too.
  const onSet = statements("SenderHandler").filter(({ Resource }) => JSON.stringify(Resource).includes(`configuration-set/",{"Ref":"${setId}"}`));
  expect(onSet.flatMap(({ Action }) => [Action].flat())).toContain("ses:SendRawEmail");
  expect(lambda("SenderHandler")[1].Properties?.Environment?.Variables?.[environmentVariables.configurationSet]).toEqual({ Ref: setId });
  const sesResources = JSON.stringify(statements("SenderHandler").filter(({ Action }) => [Action].flat().some((action) => action.startsWith("ses:"))).map(({ Resource }) => Resource));
  expect(sesResources).toContain(`configuration-set/",{"Ref":"${setId}"}`);
  const [[identityId]] = ofType("AWS::SES::EmailIdentity") as [[string, Resource]];
  expect(sesResources).toContain(`identity/",{"Ref":"${identityId}"}`);
  const puts = statements("SenderHandler").filter(({ Action }) => [Action].flat().some((action) => action.startsWith("s3:PutObject")));
  expect(puts).toHaveLength(1);
  expect(JSON.stringify(puts[0]!.Resource)).toContain('"/sent/*"');
});

test("the API manages receipt rules in Duva's rule set, and may take no other SES action", () => {
  // IAM has no resource type for receipt rules, so the rule set is named only in the environment.
  expect(actions("ApiHandler", "ses").sort()).toEqual(["ses:CreateReceiptRule", "ses:DescribeReceiptRule", "ses:UpdateReceiptRule"]);
  const variables = lambda("ApiHandler")[1].Properties?.Environment?.Variables;
  expect(variables?.[environmentVariables.receiptRuleSet]).toEqual({ Ref: ruleSetId });
  expect(variables?.[environmentVariables.inboundFunction]).toEqual({ "Fn::GetAtt": [lambda("InboundHandler")[0], "Arn"] });
});

test("the domain is a parameter, so deploy names it when it runs", () => {
  expect(stack.template.Parameters?.Domain?.Type).toBe("String");
});

test("the domain's identity signs with Easy DKIM and sends from a custom MAIL FROM subdomain", () => {
  const identities = ofType("AWS::SES::EmailIdentity");
  expect(identities).toHaveLength(1);
  for (const [, { Properties }] of identities) {
    expect(Properties?.EmailIdentity).toEqual({ Ref: "Domain" });
    expect(Properties?.DkimAttributes?.SigningEnabled ?? true).toBe(true);
    expect(Properties?.DkimSigningAttributes).toBeUndefined();
    expect(Properties?.MailFromAttributes?.MailFromDomain).toEqual({ "Fn::Join": ["", ["mail.", { Ref: "Domain" }]] });
  }
});

test("every send goes through a configuration set with no open or click tracking", () => {
  const sets = ofType("AWS::SES::ConfigurationSet");
  expect(sets).toHaveLength(1);
  const [[id, { Properties }]] = sets as [[string, Resource]];
  expect(Properties?.TrackingOptions).toBeUndefined();
  expect(Properties?.VdmOptions?.DashboardOptions).toEqual({ EngagementMetrics: "DISABLED" });
  expect(ofType("AWS::SES::ConfigurationSetEventDestination")).toEqual([]);
  for (const [, identity] of ofType("AWS::SES::EmailIdentity")) {
    expect(identity.Properties?.ConfigurationSetAttributes).toEqual({ ConfigurationSetName: { Ref: id } });
  }
});

test("receiving starts with an empty rule set, so SES refuses all mail until the first address exists", () => {
  expect(ofType("AWS::SES::ReceiptRuleSet")).toHaveLength(1);
  expect(ofType("AWS::SES::ReceiptRule")).toEqual([]);
});

test("the domain, the first admin and whether SES has verified the domain are parameters, so deploy names them when it runs", () => {
  expect(stack.template.Parameters?.Admin?.Type).toBe("String");
  expect(stack.template.Parameters?.DomainVerified?.AllowedValues).toEqual(["true", "false"]);
});

const [[, userPool]] = ofType("AWS::Cognito::UserPool") as [[string, Resource]];

test("humans sign in to one user pool on the Essentials plan, with no sign-up of their own", () => {
  expect(ofType("AWS::Cognito::UserPool")).toHaveLength(1);
  expect(userPool.Properties?.UserPoolTier).toBe("ESSENTIALS");
  expect(userPool.Properties?.AdminCreateUserConfig?.AllowAdminCreateUserOnly).toBe(true);
  expect(userPool.Properties?.UsernameAttributes).toEqual(["email"]);
});

test("sign-in names are the same in any case, so a human who types capitals in their address gets a code", () => {
  expect(userPool.Properties?.UsernameConfiguration).toEqual({ CaseSensitive: false });
});

test("setup adds humans to the user pool, and may take no other Cognito action", () => {
  const [[userPoolId]] = ofType("AWS::Cognito::UserPool") as [[string, Resource]];
  expect(actions("SetupHandler", "cognito-idp").sort()).toEqual(["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser"]);
  expect(lambda("SetupHandler")[1].Properties?.Environment?.Variables?.[environmentVariables.userPoolId]).toEqual({ Ref: userPoolId });
});

test("setup has minutes to move every human to the user pool, one at a time", () => {
  expect(lambda("SetupHandler")[1].Properties?.Timeout).toBe(300);
});

test("the API adds humans to the user pool, and may take no other Cognito action", () => {
  const [[userPoolId]] = ofType("AWS::Cognito::UserPool") as [[string, Resource]];
  expect(actions("ApiHandler", "cognito-idp").sort()).toEqual(["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser"]);
  expect(JSON.stringify(statements("ApiHandler").filter(({ Action }) => [Action].flat().some((action) => action.startsWith("cognito-idp:"))))).toContain(userPoolId);
  expect(lambda("ApiHandler")[1].Properties?.Environment?.Variables?.[environmentVariables.userPoolId]).toEqual({ Ref: userPoolId });
});

test("humans sign in with an emailed code, and the password Cognito requires is offered to nobody", () => {
  expect(userPool.Properties?.Policies?.SignInPolicy?.AllowedFirstAuthFactors).toEqual(["PASSWORD", "EMAIL_OTP"]);
});

test("sign-in codes go through SES from the domain once SES has verified it, and from Cognito until then", () => {
  const { EmailConfiguration: email } = userPool.Properties ?? {};
  const [condition, verified, unverified] = email?.["Fn::If"] ?? [];
  expect(stack.template.Conditions?.[condition]).toEqual({ "Fn::Equals": [{ Ref: "DomainVerified" }, "true"] });
  expect(verified).toMatchObject({
    EmailSendingAccount: "DEVELOPER",
    From: { "Fn::Join": ["", ["Duva <no-reply@", { Ref: "Domain" }, ">"]] },
  });
  expect(JSON.stringify(verified.SourceArn)).toContain('{"Ref":"Domain"}');
  expect(unverified).toEqual({ EmailSendingAccount: "COGNITO_DEFAULT" });
});

test("every app client signs in through managed login with PKCE, and gives no hint that an address is unknown", () => {
  const clients = ofType("AWS::Cognito::UserPoolClient");
  expect(clients).toHaveLength(2);
  for (const [id, { Properties }] of clients) {
    const { GenerateSecret, AllowedOAuthFlows, PreventUserExistenceErrors, ExplicitAuthFlows } = Properties ?? {};
    expect({ id, secret: GenerateSecret ?? false, AllowedOAuthFlows, PreventUserExistenceErrors, ExplicitAuthFlows }).toEqual({
      id,
      secret: false,
      AllowedOAuthFlows: ["code"],
      PreventUserExistenceErrors: "ENABLED",
      ExplicitAuthFlows: ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    });
  }
  expect(clients.map(([, { Properties }]) => Properties?.CallbackURLs)).toContainEqual(["http://127.0.0.1:8976/callback"]);
});

test("managed login is the newer one, which offers choice-based sign-in", () => {
  const [[, domain]] = ofType("AWS::Cognito::UserPoolDomain") as [[string, Resource]];
  expect(domain.Properties?.ManagedLoginVersion).toBe(2);
  // Prefix domains are unique per region, and duva-<account> was the retired user pool's.
  expect(domain.Properties?.Domain).toEqual({ "Fn::Join": ["", ["duva-signin-", { Ref: "AWS::AccountId" }]] });
  expect(ofType("AWS::Cognito::ManagedLoginBranding")).toHaveLength(2);
});

test("every operation that needs sign-in goes through the one Lambda authorizer, which answers 401 to any call it can't resolve", () => {
  const authorizers = ofType("AWS::ApiGatewayV2::Authorizer");
  expect(authorizers).toHaveLength(1);
  const [[authorizerId, { Properties: authorizer }]] = authorizers as [[string, Resource]];
  // With identity sources, API Gateway would answer 403 to a token the authorizer refuses.
  expect(authorizer).toMatchObject({ AuthorizerType: "REQUEST", EnableSimpleResponses: true, AuthorizerResultTtlInSeconds: 0 });
  expect(authorizer?.IdentitySource ?? []).toEqual([]);

  const routes = Object.fromEntries(ofType("AWS::ApiGatewayV2::Route").map(([, { Properties }]) => [Properties?.RouteKey, Properties]));
  for (const { routeKey, signIn } of operations) {
    expect({ routeKey, auth: routes[routeKey]?.AuthorizationType, authorizer: routes[routeKey]?.AuthorizerId }).toEqual({
      routeKey,
      auth: signIn ? "CUSTOM" : "NONE",
      authorizer: signIn ? { Ref: authorizerId } : undefined,
    });
  }
});

test("the web app is served through CloudFront from its bucket, which only CloudFront reads", () => {
  const [[, { Properties: distribution }]] = ofType("AWS::CloudFront::Distribution") as [[string, Resource]];
  const [origin] = distribution?.DistributionConfig?.Origins ?? [];
  expect(origin?.OriginAccessControlId).toBeDefined();
  expect(distribution?.DistributionConfig?.ViewerCertificate).toBeUndefined();
});

/**
 * Where resource types whose names are global to the account, or to all of AWS, keep the name.
 * CloudFormation makes up a unique name when none is set, but a name the stack sets must hold the
 * region, since each region of an account can have a deployment. Add a type once you know its
 * names are global.
 */
const globalNames: Record<string, (properties: Record<string, any>) => unknown> = {
  "AWS::CloudFront::CachePolicy": (p) => p.CachePolicyConfig?.Name,
  "AWS::CloudFront::Function": (p) => p.Name,
  "AWS::CloudFront::OriginAccessControl": (p) => p.OriginAccessControlConfig?.Name,
  "AWS::CloudFront::OriginRequestPolicy": (p) => p.OriginRequestPolicyConfig?.Name,
  "AWS::CloudFront::ResponseHeadersPolicy": (p) => p.ResponseHeadersPolicyConfig?.Name,
  "AWS::IAM::InstanceProfile": (p) => p.InstanceProfileName,
  "AWS::IAM::ManagedPolicy": (p) => p.ManagedPolicyName,
  "AWS::IAM::Role": (p) => p.RoleName,
  "AWS::S3::Bucket": (p) => p.BucketName,
};

test("every name the stack sets in a namespace wider than its region holds the region", () => {
  const named = resources.flatMap(([id, { Type, Properties }]) => {
    const name = globalNames[Type]?.(Properties ?? {});
    return name === undefined ? [] : [{ id, name: JSON.stringify(name) }];
  });
  // The web app's origin access control always has a name, so the rule never checks nothing.
  expect(named.map(({ id }) => id)).toContainEqual(expect.stringMatching(/^WebAccess/));
  for (const { id, name } of named) expect({ id, name }).toEqual({ id, name: expect.stringContaining('{"Ref":"AWS::Region"}') });
});

// A Lambda anyone may invoke sets off the account's security alert, which strips the permission and
// disables the function (docs/aws.md).
test("no Lambda can be invoked by anyone: each permission names a service and the source it acts for, and each function URL takes only signed requests", () => {
  // Every stack in the assembly, should the app ever make more than one.
  const everywhere = assembly.stacks.flatMap(({ template }) => Object.entries(template.Resources as Record<string, Resource>));
  const ofTypeEverywhere = (type: string) => everywhere.filter(([, resource]) => resource.Type === type);
  const permissions = ofTypeEverywhere("AWS::Lambda::Permission");
  expect(permissions).not.toHaveLength(0);
  for (const [id, { Properties }] of permissions) {
    const principal = String(Properties?.Principal);
    expect({ id, principal, sourced: (Properties?.SourceArn ?? Properties?.SourceAccount) !== undefined }).toEqual({
      id,
      principal: expect.stringMatching(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.amazonaws\.com$/),
      sourced: true,
    });
  }
  for (const [id, { Properties }] of ofTypeEverywhere("AWS::Lambda::Url")) expect({ id, authType: Properties?.AuthType }).toEqual({ id, authType: "AWS_IAM" });
});

test("every Lambda keeps its log a month, so nothing it logs, a drop's record included, outlives that", () => {
  for (const [id, { Properties }] of ofType("AWS::Lambda::Function")) {
    const logGroup = Properties?.LoggingConfig?.LogGroup?.Ref;
    expect({ id, retention: stack.template.Resources[logGroup]?.Properties?.RetentionInDays }).toEqual({ id, retention: 30 });
  }
});

test("the inbound Lambda may publish the drop metric: its role may write its log, which is kept as text, as the metric's lines are written", () => {
  const [, { Properties }] = lambda("InboundHandler");
  // Real runs check the metric with the text log format, where each line reaches CloudWatch as written.
  expect(Properties?.LoggingConfig?.LogFormat ?? "Text").toBe("Text");
  const roleId = Properties?.Role?.["Fn::GetAtt"]?.[0];
  expect(JSON.stringify(stack.template.Resources[roleId]?.Properties?.ManagedPolicyArns)).toContain("service-role/AWSLambdaBasicExecutionRole");
});

test("download links lead to the web app's domain, where CloudFront signs each request to the download Lambda's function URL, which streams its answer", () => {
  const [downloadId] = lambda("DownloadHandler");
  const urls = ofType("AWS::Lambda::Url");
  expect(urls).toHaveLength(1);
  const [[urlId, { Properties: url }]] = urls as [[string, Resource]];
  expect(url).toMatchObject({ TargetFunctionArn: { "Fn::GetAtt": [downloadId, "Arn"] }, AuthType: "AWS_IAM", InvokeMode: "RESPONSE_STREAM" });

  const [[distributionId, { Properties: distribution }]] = ofType("AWS::CloudFront::Distribution") as [[string, Resource]];
  const config = distribution?.DistributionConfig;
  const behaviors = (config?.CacheBehaviors ?? []).filter(({ PathPattern }: { PathPattern: string }) => PathPattern === "/download/*");
  expect(behaviors).toHaveLength(1);
  const [behavior] = behaviors;
  // Each link stops working after minutes, so CloudFront keeps no answer: the ID is AWS's CachingDisabled policy.
  expect(behavior).toMatchObject({ AllowedMethods: ["GET", "HEAD"], ViewerProtocolPolicy: "redirect-to-https", CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" });
  // Viewer headers would break the signature, which names the function URL's host.
  expect(behavior.OriginRequestPolicyId).toBeUndefined();
  const origin = config?.Origins?.find(({ Id }: { Id: string }) => Id === behavior.TargetOriginId);
  expect(JSON.stringify(origin?.DomainName)).toContain(`{"Fn::GetAtt":["${urlId}","FunctionUrl"]}`);
  expect(origin?.CustomOriginConfig?.OriginProtocolPolicy).toBe("https-only");
  const access = stack.template.Resources[origin?.OriginAccessControlId?.["Fn::GetAtt"]?.[0]];
  expect(access?.Properties?.OriginAccessControlConfig).toMatchObject({ OriginAccessControlOriginType: "lambda", SigningBehavior: "always", SigningProtocol: "sigv4" });

  expect(lambda("ApiHandler")[1].Properties?.Environment?.Variables?.[environmentVariables.downloadUrl]).toEqual({
    "Fn::Join": ["", ["https://", { "Fn::GetAtt": [distributionId, "DomainName"] }, "/download/"]],
  });
});

test("only the web app's distribution may invoke the download Lambda, as its function URL needs", () => {
  const [downloadId] = lambda("DownloadHandler");
  const [[distributionId]] = ofType("AWS::CloudFront::Distribution") as [[string, Resource]];
  const [[urlId]] = ofType("AWS::Lambda::Url") as [[string, Resource]];
  // The origin names the function by its URL's FunctionArn, which is the function's ARN.
  const permissions = ofType("AWS::Lambda::Permission").filter(([, { Properties }]) =>
    [`{"Fn::GetAtt":["${downloadId}","Arn"]}`, `{"Fn::GetAtt":["${urlId}","FunctionArn"]}`].includes(JSON.stringify(Properties?.FunctionName)),
  );
  expect(permissions.map(([, { Properties }]) => Properties?.Action).sort()).toEqual(["lambda:InvokeFunction", "lambda:InvokeFunctionUrl"]);
  for (const [id, { Properties }] of permissions) {
    expect({ id, principal: Properties?.Principal, source: JSON.stringify(Properties?.SourceArn) }).toEqual({
      id,
      principal: "cloudfront.amazonaws.com",
      source: expect.stringContaining(`distribution/",{"Ref":"${distributionId}"}`),
    });
  }
});

test("the download Lambda only reads: the table and raw mail", () => {
  expect(tableActions("DownloadHandler")).toContain("dynamodb:GetItem");
  expect(tableActions("DownloadHandler").filter((action) => /Put|Update|Delete|Write/.test(action))).toEqual([]);
  expect(actions("DownloadHandler", "s3")).toContain("s3:GetObject*");
  expect(actions("DownloadHandler", "s3").filter((action) => /Put|Delete/.test(action))).toEqual([]);
});

test("the table deletes download links' tickets once they expire, by its time to live", () => {
  const [[, { Properties }]] = ofType("AWS::DynamoDB::GlobalTable") as [[string, Resource]];
  expect(Properties?.TimeToLiveSpecification).toEqual({ AttributeName: timeToLiveAttribute, Enabled: true });
});
