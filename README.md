# Duva

Duva is a self-hosted mailbox platform on Amazon SES, where humans and agents are both actors. An organization, such as a family or a small company, deploys it into its own AWS account. Its humans read and send mail in a web app. Its agents work through a CLI, the API or MCP, in their sponsor's mailboxes, and a human approves what they send.

Duva is Swedish for dove, as in brevduva, the carrier pigeon. Each human mailbox comes with Coo, a mailbox agent that Duva hosts itself.

The code is open source under the MIT license.

## Status

As of 2026-10-09:

- **v1 is shipped**, and so is everything after it listed under _What Duva does_.
- **The standing deployment** runs in eu-north-1 for `duva.nille.xyz`. Every ticket ends with a deploy there, then a real run against it.
- **135 issues are closed.** Four are open:

| Issue | What | State |
|---|---|---|
| #139 | Deliveries, second pass: Feed and Paper Trail counts, archived threads follow, old blocks erased | In a lane, committed |
| #140 | Coo grounds what it says about agents and sends in their real state | In a lane, committed |
| #105 | Field Desk, the web app's look: the finish review and the DESIGN.md pass | After #139 and #140 |
| #127 | Nicklas's second-pass notes | Decided. What's left is his own steps |
| #33 | Suggest labels for incoming mail when no rule applies | Later |

- **Left for Nicklas:**
  - add the `default._bimi` and `_dmarc` DNS records for `duva.nille.xyz`;
  - try the MCP endpoint;
  - subscribe to a real newsletter for #131's unsubscribe run.

## What Duva does

**Mail for humans**
- **The web app** works on a desk and on a phone. It's built on the Field Desk design: three panes, a status strip, and Gmail's keyboard shortcuts.
- **Mail is organized with labels.** Inbox, Spam and Trash are built in. Trash and Spam are erased after the retention period, 30 days by default.
- **The Screener** holds mail from first-time senders until a human decides on them.
- **Each sender gets a delivery:** the Inbox, the Feed, the Paper Trail, a label of the human's, or Nowhere. Nowhere has Coo unsubscribe, and bounce the sender's mail as a last resort.
- **Remind me** sets a thread aside until a chosen time.
- **Search** finds mail by meaning as well as by words, and translates each search into the organization's other search languages (English and Swedish by default), so a Swedish word finds English mail. It runs on LanceDB on S3 with Titan embeddings.
- **Sender logos (BIMI)** are shown for verified senders. The organization can also publish its own logos.
- **Tracking protection** removes known trackers from HTML mail. It's always on.
- **Groups** take mail for their members, and members send as the group.
- **Domains** are added at run time, each standalone or as an alias of another. A domain can have a catch-all, and every address takes plus tags.

**Agents as actors**
- **Every action is attributed** to exactly one actor: a human, an agent, or nobody, for mail that simply arrived.
- **Agents own no mailboxes.** An agent works in its sponsor's mailboxes with the sponsor access it was given. It's never an admin.
- **A self-hosted agent asks for access** with `duva login --agent`. Its sponsor approves it in the web app.
- **An agent's sends wait for its sponsor's approval.** Then they wait out an undo window. The approval log records every decision, and a send can be undone within the window.
- **Every agent-sent message carries the disclosure:** a header, and by default a visible line such as "Sent by Hermes for Nicklas".
- **Send limits** cap how much an agent sends. Duva pauses an agent whose mail draws a complaint or keeps bouncing.
- **An agent's activity** is one list of its events, filterable by kind.

**Coo, the hosted mailbox agent**
- **Runs on Amazon Bedrock AgentCore Runtime,** one per deployment, for every human mailbox.
- **Can be asked in the web app** (Ask Coo), or from an MCP client such as Claude Code.
- **Label prompts give it tasks.** A label's prompt runs on each message that gets the label.
- **Thinks with Claude Haiku 4.5** by default, and hands drafting and opt-out browsing to Claude Sonnet 5.5. The models run in eu-central-1 through the `eu.` profile for an EU deployment. See `docs/research/coo-models.md` for what each setup achieved and cost.

## How it's built

Every part is serverless, so an idle deployment costs close to nothing:

- **Mail in:** SES receiving stores each message in S3 and invokes the inbound Lambda.
- **Mail out:** a sender Lambda, started from DynamoDB's stream, sends through SES. EventBridge Scheduler handles undo windows, send limits and Remind me.
- **The API** is one Lambda behind API Gateway, with a Lambda authorizer for Cognito tokens and agent keys.
- **The data** is one DynamoDB table, which keeps each mailbox's change feed. Its stream drives the sender, the search indexer and label tasks.
- **Search** is LanceDB on S3, with an index per mailbox.
- **Coo** runs on AgentCore Runtime and AgentCore Browser.
- **The web app** is served from S3 through CloudFront.
- **Sign-in** is Cognito managed login, with a code emailed from the organization's domain.

There's no VPC, and no Lambda anyone in the world can invoke.

The contract for every client is one OpenAPI document, `packages/openapi/openapi.yaml`. So the web app can do nothing the API can't. `docs/agents/handbook.md` has the full architecture.

```
packages/
  openapi/   the API contract, and the types generated from it
  api/       every Lambda, the mailbox agent and the search module
  client/    the TypeScript client generated from the contract
  web/       the React web app (Vite)
  infra/     the CDK app, synthesized at build time
  cli/       duva, one binary built with Bun, with the CDK assembly and the web app inside
skills/duva/ the skill the CLI publishes for agents
scripts/     generation, deployment checks, the end-to-end run
docs/        ADRs, AWS facts, research, the agents' docs
```

## Running it

**What the build needs**
- x64 Linux, since the search Lambdas ship LanceDB's x64 native module;
- Node.js 24 or newer;
- Java 17 or newer, for DynamoDB Local in the tests;
- Chromium or Google Chrome, for the web app's tests, found at `CHROMIUM` or a usual path.

Bun comes as a dev dependency.

```sh
npm ci
npm run build   # generated code check, every test, typecheck, CDK synth, web app, CLI binary
```

The tests need no AWS. Bedrock's answers are recorded in `packages/api/test/`.

**Deploying** takes an AWS account with SES, a domain whose DNS you control, and AWS credentials for the account and region:

```sh
AWS_REGION=eu-north-1 packages/cli/dist/duva deploy --domain example.org --admin you@example.org
```

`duva deploy` prints the DNS records to add. Run it again to update the deployment to that build. The CLI can't synthesize the CDK app, so it deploys only what `npm run build` built.

**Using it**
- **Humans** sign in to the web app at the CloudFront URL that deploy prints.
- **Agents** run `duva login --agent`, then the rest of the CLI. `duva skill install` installs the skill that teaches them how. Agents can also call the API with a key their sponsor creates.
- **MCP clients** connect to the MCP endpoint, which they sign in to as a human.

## Documentation

| Document | What it holds |
|---|---|
| `PRODUCT.md` | Who Duva is for, its principles, and the copy rules |
| `GLOSSARY.md` | The domain language. Code, tests and copy use its terms |
| `DESIGN.md` | Field Desk, the web app's design system |
| `docs/adr/` | 32 decisions, from "agents are actors" on |
| `docs/aws.md` | The AWS behavior Duva's design rests on, each fact probed or sourced |
| `docs/disclosure.md` | How agent-sent mail is marked |
| `docs/research/` | AgentCore, Coo's models, unsubscribing and bouncing |
| `AGENTS.md` | The rules for agents working on Duva |
| `docs/agents/handbook.md` | The architecture, the practices and the workflow, for an agent picking up the code |
| `CODING_STANDARDS.md` | What a review checks |

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
