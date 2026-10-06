# Domains after the first are added at runtime, not by deploy

`duva deploy` brings the first domain, as a CloudFormation parameter, so a deployment works from its first run. Every later domain, standalone or alias, is added by an admin through the API, the CLI or the web app's Settings. The API creates its SES identity through the AWS SDK, lists the DNS records to add, and reports SES's verification as it comes. Removing a domain deletes its identity, with its addresses. So adding a domain needs no AWS access and no redeploy. PRODUCT.md promises that nobody needs to understand AWS. Nicklas chose this on 2026-10-06.

## Considered options

- `duva deploy --domain b.com` for each domain, as the first one is done. Rejected: only someone with AWS access could add a domain, and the stack would need a parameter list it can't grow at runtime anyway.

## Consequences

- The API's role gains `ses:CreateEmailIdentity`, `ses:DeleteEmailIdentity`, `ses:GetEmailIdentity` and `ses:PutEmailIdentityMailFromAttributes`, limited to identities in this account and region, and `cognito-idp:DescribeUserPool` and `UpdateUserPool` on the stack's pool, to change the sign-in sender (#70). Receipt rules already follow addresses at runtime (#7).
- The first domain stays in the stack, so it's removed only when another domain sends sign-in codes. An admin chooses the sign-in domain at runtime, and deploy passes the pool's current sender back as a parameter, so it never reverts that choice. Removing the first domain deletes an identity the stack owns, which drifts from the template; deploy copes.
- Removing a standalone domain removes its alias domains too.
- Duva doesn't manage anyone's DNS. It shows the records and checks them, as deploy does for the first domain.
