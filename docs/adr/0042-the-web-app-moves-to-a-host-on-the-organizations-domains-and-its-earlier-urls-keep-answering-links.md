# The web app moves to a host on the organization's domains, and its earlier URLs keep answering links

The web app can be at a host of the organization's own, such as duva.nille.world, instead of CloudFront's own domain, which PRODUCT.md left undecided. `duva deploy --web <host>` puts it there, a later deploy keeps it, and one given another host moves it again. Nicklas chose the host for the new deployment on 2026-10-13 (#174).

- **The host** is under one of the organization's domains: never a domain itself, whose MX record leaves no room for a CNAME, nor its MAIL FROM subdomain, for the same reason.
- **The certificate:** deploy requests it from ACM in us-east-1, where CloudFront takes certificates, through the AWS SDK, tagged project=duva and with the deployment's region. It prints the CNAME records that validate it, waits until ACM has, for an hour at most, and then gives the stack the hosts and the certificate as parameters. A re-run waits for the same certificate.
- **Everything that names the web app's URL follows it:** sign-in's callback and sign-out URLs, the sign-in links mailed to recovery addresses (ADR-0041), the API's and the uploads bucket's CORS, download links and linked files' pages, own and sender logos' URLs, status, and the MCP endpoint's website. The API and the MCP endpoint stay on the API's domain (ADR-0028).
- **What was sent keeps working where it was sent.** CloudFront answers download links, linked files' pages, logos and Ask Coo's turns at its own domain and at every host the web app was at, and a CloudFront Function sends only the web app itself on to the host. So a move keeps the earlier host on the distribution, and on its one certificate.

## Considered options

- A setting in the web app, which the API applies at run time, as it adds domains (ADR-0018). Rejected: the API would change the distribution, the user pool's app client, CORS and the Lambdas' environment outside the stack, and every deploy would have to read them all back, as it reads back the sign-in domain.
- The certificate as a resource of the stack. Rejected: CloudFormation creates resources only in the stack's own region, and its wait for validation would hold the deploy without saying which records DNS needs.
- Sending every path of the earlier URLs on to the host. Rejected: a link's page or a logo answered where it was sent costs nothing, and needs no receiver or link scanner to follow a redirect.
- Dropping an earlier host when the web app moves again. Rejected: links sent there work for up to a year, and BIMI records in DNS name logos there.

## Consequences

- **One certificate covers every host,** so ACM renews it only while each host's validation record stays in DNS. Deploy lists those records on every run, with whether DNS has them.
- **Each host needs a CNAME record to CloudFront's own domain,** which deploy prints. Once the web app has a host, CloudFront's own domain sends browsers there, so until DNS has that record the web app opens nowhere. Deploy prints a new host's record before it waits, when the stack already has a distribution.
- **Moving the web app moves its logos' URLs,** so the BIMI records Duva lists change, while the URLs DNS already has keep answering (ADR-0026). The same holds for linked files' pages (ADR-0034), and a forward carries an earlier link at the host.
- **Sign-in stays on Cognito's own domain,** and passkeys with it, bound to the user pool's prefix domain (ADR-0041), so moving the web app keeps every passkey. A custom domain for managed login is still undecided.
- **A sign-in link leads to the host,** so until DNS has the host's CNAME record it opens nowhere. It works for 30 minutes, after which the human asks for another on the sign-in page, once DNS has it.
