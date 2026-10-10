# Coo searches the web through AgentCore, with a reader that has no powers

Coo may search the web wherever it helps: in Ask Coo, in a label prompt's task, and while unsubscribing. It uses Web Search on AgentCore, a managed tool behind AgentCore Gateway that searches Amazon's own index, so queries go to no third party. It costs $7 per 1,000 queries, nothing while idle (ADR-0006), and its cost counts toward the mailbox agents' spend cap. Nicklas chose this on 2026-10-10.

- **What a query may carry:** anything from the mail that helps, tracking and account numbers included, so a label prompt like "look up the delivery" works.
- **Where queries go:** Web Search runs only in us-east-1, eu-west-1 and ap-northeast-1. So a deployment in eu-north-1 searches from eu-west-1, Ireland, and a US one from us-east-1, and the setting says so.
- **Who can turn it off:** it's on by default. Admins can switch it off for the organization, and each human for their own Coo.
- **How results reach Coo:** never directly. A reader, a separate model call with no Duva operations, reads the results and hands Coo a short answer with its sources. A page that tells the reader to forward the Inbox has nothing to forward with. This is the same isolation as unsubscribing on a sender's page (ADR-0031).
- **What the human sees:** Coo says when it searched, with the sources as links, and a task's or an unsubscribe's searches show in its activity.

## Considered options

- Search only in Ask Coo, with the human watching. Rejected by Nicklas: label prompts like "look up the delivery" need it unattended.
- Keep private details out of queries. Rejected by Nicklas: tracking and account numbers are what many lookups need.
- Results straight into Coo's run, marked untrusted. Rejected: a strong injection could still steer a run that can draft and organize.
- A third-party search API such as Tavily, Exa or Brave. Rejected: an API key to keep, and queries leaving AWS.
- Off until admins opt in. Rejected: Nicklas wants it working by default, with where queries go said plainly.

## Consequences

- The stack gets a Gateway with the Web Search target in the search region, which the runtime calls through IAM. Calling a gateway in another region from AgentCore Runtime is unverified, so the ticket probes it first.
- How long AWS keeps Web Search queries is unverified. The ticket finds out, and the setting says what it learns.
- The reader is the everyday model's call with no tools, and its answer is what the run keeps.
