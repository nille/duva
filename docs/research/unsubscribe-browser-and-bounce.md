# Can Coo open opt-out pages in AgentCore Browser, and bounce with SendBounce?

Research for #131. Checked on 2026-10-08 against AWS documentation, the AWS Price List API and read-only AgentCore calls in account 925039213717. Nothing was created.

## Short answer

Yes to both. AgentCore Browser runs in eu-north-1, where Duva deploys, and in eu-central-1, the model region. It bills only while a session runs, so an idle deployment pays nothing for it (ADR-0006). An attempt costs about $0.0005 in browser compute. The model's tokens cost about a hundred times more. SendBounce's limits are those docs/aws.md already records for groups: up to 24 hours after SES received the message, at most once a second, from an identity Duva verified.

## AgentCore Browser

- **Availability: "AgentCore Built-in Tools", the Browser and Code Interpreter, run in all 22 regions the regions table lists, eu-north-1 and eu-central-1 included.** `AWS::BedrockAgentCore::BrowserCustom` is in CloudFormation in both. Duva calls the browser from the deployment's region. It needs no model, so the model region doesn't matter for it. The five SES regions without AgentCore Runtime also lack the tools, and mailbox agents are already left out there (ADR-0027). _[Supported AWS Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html); AWS regional availability, cfn, 2026-10-08._
- **Idle cost: none.** Browser bills per second for the CPU a session uses and the peak memory it has used so far, from microVM boot until the session ends, with a 128 MB minimum. Without a session it bills nothing. A custom browser resource has no charge of its own, and neither does the AWS-managed `aws.browser.v1`. Only Browser Profiles, which Duva doesn't use, bill S3 storage. _[AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)._
- **Price in eu-north-1: $0.0895 per vCPU-hour and $0.00945 per GB-hour,** the same as Runtime v1 and as us-east-1. _Price List API, `AmazonBedrockAgentCore`, regionCode eu-north-1, usage types `EUN1-BrowserTool:Consumption-based:vCPU` and `:Memory`._
- **Per attempt:** a 60-second session that uses 10 CPU-seconds and peaks at 1.5 GB costs $0.00025 in CPU and $0.00024 in memory. At four steps with about 5,000 tokens of page text each, plus 1,000 tokens out, Claude Sonnet 5.5 through `eu.` costs about $0.055. So the model's tokens are what an attempt costs, and they count toward the mailbox agents' cap.
- **Sessions:** 15 minutes by default and up to 8 hours. Each runs in its own microVM, which is terminated and wiped when the session ends, so no cookies or storage outlive it. Duva stops each session when the attempt ends and sets a short timeout, in case it doesn't. At most 500 sessions run at once per browser. _[Browser fundamentals](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-resource-session-management.html)._
- **Driving it:** StartBrowserSession is SigV4-signed, and the session is driven over a SigV4-signed WebSocket automation stream that speaks the Chrome DevTools Protocol, as Playwright's `connectOverCDP` does. A role needs `StartBrowserSession`, `ConnectBrowserAutomationStream` and `StopBrowserSession` on the browser's ARN. CDK's `BrowserCustom` construct has `grantUse`. _Same source; [AgentCore construct library](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)._
- **Network:** a custom browser with `usingPublicNetwork()` reaches the internet from AWS's network, not from a VPC of the account's, so a page can't reach anything of Duva's. It records nothing unless a recording bucket is configured. Duva needs no invocable endpoint for it, so the rule that no Lambda is world-invocable is unaffected.
- **The account already has two custom browsers in eu-north-1,** `nilleAgentBrowser` and `nilleAgentBrowserStealth`. They're Nicklas's own, not Duva's, and Duva leaves them alone. Duva's stack creates its own browser with public network mode and no recording. _ListBrowsers in eu-north-1, 2026-10-08._

## SES SendBounce

- **It works only on a message SES received, for up to 24 hours after receipt, and at most once a second.** It can't bounce mail SES didn't receive. _[SendBounce](https://docs.aws.amazon.com/ses/latest/APIReference/API_SendBounce.html); SDK reference for SendBounce._
- **`BounceSender` must be on an identity Duva verified.** SES sends the DSN from its own `MAILER-DAEMON@<region>.amazonses.com` all the same, with Return-Path `<>`, to the message's envelope sender (docs/aws.md, real run of #71).
- **So what Duva can't bounce:**
  - a message more than 24 hours old, so a sender's newest mail older than that waits for their next message;
  - mail with an empty envelope sender (`<>`), which has nowhere to go and is itself a bounce or a report;
  - mail from the organization's own domains, which ADR-0025's decision rules out anyway;
  - spam, since its envelope sender is most likely forged and a bounce would hit an innocent address (backscatter).
- **The rate:** once a second per account. Groups already bounce with it, so a burst of messages sent nowhere has to share the second with them. Duva retries a throttled bounce.

## Recommendation

Go ahead as #131 asks. Use a custom AgentCore Browser that the stack creates in the deployment's region, with public network mode and no recording. Drive it from the mailbox agent's run over CDP, and stop each session when the attempt ends. Bounce with SendBounce within the 24 hours, never for mail with an empty envelope sender.
