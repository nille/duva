# AWS behavior Duva depends on

Facts about AWS that shaped Duva's design, each with how it was established. A change that relies on one of them, or would undo a choice made because of one, cites it here. When a run or a probe settles a new one, add it.

## Cognito

- **CreateUserPool refuses an SES identity that SES hasn't verified.** With `EmailSendingAccount: DEVELOPER`, it fails with "Email address is not verified". A new domain's identity never is on its first deploy, so the stack takes `DomainVerified`, and until SES has verified the domain the pool sends with `COGNITO_DEFAULT`. _Probed in 925039213717, 2026-10-03._
- **A pool on `COGNITO_DEFAULT` can still offer email OTP sign-in.** Codes then come from `no-reply@verificationemail.com`, which isn't in the account's SES sandbox. _Probed, and signed in through it in eu-west-3, 2026-10-03._
- **Humans created without a password are confirmed at once,** when a passwordless factor such as email OTP is available, and Cognito can't generate a password for them. PASSWORD must still be listed among the first factors. _[Creating user accounts as administrator](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html)._
- **Choice-based and passwordless sign-in exist only in the newer managed login,** never in the classic hosted UI. An app client needs `ALLOW_USER_AUTH`. _[re:Post, passwordless authentication](https://repost.aws/knowledge-center/cognito-passwordless-authentication)._
- **Callback URLs match exactly, port included.** HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`. So `duva login` listens on a fixed port. _[CreateUserPoolClient, CallbackURLs](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html)._
- **Prefix domains are unique per region.** Deployments in eu-north-1 and eu-west-3 of the same account both took `duva-925039213717`. _Real run, 2026-10-03._

## API Gateway HTTP APIs

- **A Lambda authorizer answers 401 by failing with "Unauthorized",** but only when it has no identity sources. With identity sources, API Gateway answers 401 itself when one is missing, and `isAuthorized: false` gives 403. Caching needs an identity source, so Duva's authorizer caches nothing. _[HTTP API Lambda authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html); 401 for a missing and a forged token seen in the real run, 2026-10-03._

## CloudFront

- **Names are global to the account.** Two regions' stacks collided on the origin access control's CDK default name, so every CloudFront name carries the region. _Real run, 2026-10-03._

## SES

- **An active receipt rule set with no rules refuses all mail** with `550 5.1.1`. _Real run of #4._
- **SES answers each recipient on its own.** In one SMTP transaction, an address no rule lists gets `550 5.1.1` at RCPT TO while a listed one gets `250`, and the message goes to the listed one only. So Duva never bounces. _Probed over SMTP to inbound-smtp.eu-north-1, real run of #7._
- **A rule's address also takes its plus-tagged addresses, in any case.** With `realrun7@duva.nille.xyz` listed, SES took `RealRun7+Probe@duva.nille.xyz`, and the receipt's recipient keeps the case it was sent in. _Real run of #7._
- **A rule without recipients takes every address on the account's verified domains,** so Duva never writes one. _[ReceiptRule, Recipients](https://docs.aws.amazon.com/ses/latest/APIReference/API_ReceiptRule.html)._
- **A rule takes at most 500 recipients,** so while Duva has one rule an organization has at most 500 addresses. With 200 rules a rule set could hold 100,000, more than ADR-0004's estimate of roughly 20,000. _[SES quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html)._
- **`ScanEnabled` defaults to off** when CreateReceiptRule doesn't set it, so Duva sets it. _Probed with a throwaway rule set in eu-north-1, 2026-10-03._
- **SES's scanning marks the standard test strings.** A message with the EICAR test file attached got a virus FAIL and one with the GTUBE string a spam FAIL, while SES still took both with `250` and stored them, so Duva's verdict handling can be checked from outside. _Real run of #8._
- **A receipt names the sender's DMARC policy only when DMARC fails,** as `dmarcPolicy`: none, quarantine or reject. The guide writes it in lower case and SES's blog in upper case, so Duva ignores case. _[Contents of notifications for SES email receiving](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html)._
- **SES replaces the Message-ID of a message sent with raw SendEmail** with `<MessageId@region.amazonses.com>`, where MessageId is the ID SendEmail answers with. Duva's own `<uuid@duva.nille.xyz>` never reached the recipient, so Duva records SES's. _Real run of #11, eu-north-1._
- **SESv2 SendEmail with raw content is authorized as `ses:SendRawEmail`**, on both the identity and the configuration set. With only `ses:SendEmail` on the configuration set, every send failed with "not authorized to perform 'ses:SendRawEmail' on resource '...configuration-set/...'". _Real run of #11._
- **IAM has no resource type for receipt rules or rule sets.** CreateReceiptRule, DescribeReceiptRule and UpdateReceiptRule need `Resource: "*"`; naming the rule set's ARN is denied. _[Service Authorization Reference for SES](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ses.html); AccessDenied in the real run of #7._

## S3

- **In a versioned bucket a delete without a version ID only adds a delete marker,** and the earlier versions stay. So erasing dropped mail lists the key's versions and delete markers, which needs `s3:ListBucketVersions`, and deletes each by ID, which needs `s3:DeleteObjectVersion`. _[Deleting object versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html); in the real run of #8 a dropped message left no version and no delete marker._

## DynamoDB

- **Two transactions on the same item at once can cancel one with `TransactionConflict`,** not `ConditionalCheckFailed`. Two messages arriving together in one mailbox both claimed its feed's next position, and one was cancelled that way, so a feed write retries on both. _Real run of #7._
- **A transaction can't include two operations on the same item.** DynamoDB refuses it with a ValidationException. So a reply that leaves its thread's place unchanged overwrites the thread's label entries, and deletes only those that move. _[TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)._
- **A condition can compare a list attribute with `=`.** A thread is written only if its `labels` list equals the one read, and real DynamoDB evaluates that as DynamoDB Local does: five replies sent at once all joined their thread. _Real run of #9._

## Lambda

- **LanceDB's native module loads in Lambda,** on `nodejs24.x` as an x64 zip and as an arm64 container image, and answers a full-text query from a table on S3 there. _Search spike, #15, 2026-10-03._
- **Only x64 fits a zip.** A zip's unzipped limit is 262,144,000 bytes. LanceDB 0.39.0 with its x64 native module and Apache Arrow takes 213.8 MB, which leaves about 48 MB for Duva's own code. The arm64 native module alone is 389 MB, so arm64 needs an image. _Search spike, #15, 2026-10-03; [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)._
- **A cold start costs more than its Init Duration.** Seen by the caller, cold invocations of the 213.8 MB x64 zip took about 620 ms longer than init plus handler time, and of the arm64 image about 160 ms. _Search spike, #17, 2026-10-04, 1,080 cold starts._
- **With LanceDB, the arm64 image inits faster than the x64 zip:** about 0.6 s to 0.8 s at every memory size from 1,769 to 10,240 MB. _Search spike, #17, 2026-10-04._

## Bedrock

- **Titan Text Embeddings V2 runs on demand in eu-north-1,** at $0.000021 per 1,000 input tokens, so mail embedded with it stays in the region. A message's subject and the first 2,000 characters of its body average 261 tokens, which makes 100,000 messages cost $0.55. It takes one text per request; 64 concurrent requests from one client ran at about 13,000 a minute without throttling. _Search spike, #16, 2026-10-03; AWS Price List._
