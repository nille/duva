# Handbook for agents working on Duva

How Duva is built, how its code is written and tested, and how a ticket goes from the issue to the standing deployment. `AGENTS.md` has the rules. This explains what they rest on. Read it before your first change, and before a change that crosses packages, adds a Lambda, touches the table's keys or changes the mailbox agent.

## 1. Read first

Read these, in this order. Each is the authority for its subject, so this handbook only points at them.

1. `README.md`: what Duva does and where it stands.
2. `GLOSSARY.md`: the domain language. Names in code, test names, CLI output, comments and copy all use its terms, never those under _Avoid_. For example: a human, never a user; a thread, never a conversation; a label, never a folder; a sponsor, never an owner, for an agent.
3. `docs/adr/`: 32 decisions. A change that contradicts one says so in its ticket and why, or asks. It never overrides one silently.
4. `PRODUCT.md`: the principles and the copy rules.
5. `CODING_STANDARDS.md`: what a review checks.
6. `docs/aws.md`: the AWS behavior the design rests on. Every fact there was probed, seen in a real run or sourced. Don't undo a choice it explains without showing the fact no longer holds.
7. `DESIGN.md`: Field Desk, before any change to the web app.

## 2. The shape of the system

One organization per deployment (ADR-0002), in its own AWS account. Everything is serverless, with no VPC, so an idle deployment costs close to nothing (ADR-0006). One CDK stack, `packages/infra/src/stack.ts`, holds all of it.

### The data

- **One DynamoDB table,** keyed `pk` and `sk`. Its key schema comes from `@duva/api/infrastructure`.
- **Each mailbox's items sit under `mailbox#<id>` partitions.** Its **change feed** is entries at `change#<position>` there (`packages/api/src/feed.ts`). Every change to a mailbox is recorded in its feed, in the same transaction as the change, attributed to one actor. Clients catch up from a position, and so does Duva itself.
- **The organization has a change feed of its own** for its setup.
- **The table's stream drives the work that follows a change.** Each consumer has its filter in `infrastructure.ts`:
  - the **feeder** turns new changes into the indexer's tasks;
  - the **sender** sends what a decision approved;
  - the **task giver** gives label prompts' tasks.
- **Four S3 buckets hold everything else:**
  - `Mail`: the raw messages SES stored, and attachments;
  - `Uploads`: the files uploaded to drafts, which browsers and agents PUT straight to it with presigned URLs, without versions, and the linked files sent from them until their links end (ADR-0034);
  - `Search`: each mailbox's LanceDB index;
  - `Logos`: the organization's own BIMI logos, served by CloudFront under `/bimi/`.
- **The web app's build** is in the `Web` bucket.

### Mail in

1. SES receives the mail. Duva's receipt rules list every address, and each domain that has a catch-all (`receiving.ts`).
2. SES stores the raw message in the `Mail` bucket.
3. SES invokes the **inbound** Lambda (`inbound.ts`) without waiting, so a failure is retried, then lands in `InboundFailures`. Inbound is idempotent per SES message ID. It does five things:
   - records SES's verdicts on the message;
   - files the message into each recipient mailbox, through the Screener and the sender's delivery;
   - lets groups refuse it, with SendBounce;
   - strips known trackers;
   - hands logo fetching and one-click unsubscribes to Lambdas of their own.
4. Only FAIL verdicts act.

### Mail out

1. A draft's send is approved: by a decision, or straight away for a human's own mailbox.
2. The approved draft lands in the table, and the stream invokes the **sender** (`sending.ts`).
3. The sender waits out the organization's undo window. EventBridge Scheduler hands the draft back when the window is over.
4. It checks the agent's send limits, and sends through SES's configuration set, with the disclosure for an agent's mail (`docs/disclosure.md`).
5. Each step is conditional on the last, so a retried record never sends twice. The sender makes one SDK attempt per call, so a lost answer never sends a message again.
6. SES reports bounces, complaints and rejects to SNS. SNS invokes the **feedback** Lambda (`feedback.ts`), which records them, and pauses an agent whose mail hurts the domain (ADR-0021).

### The API

- **One Lambda,** `lambda.ts` and `api.ts`, behind an API Gateway HTTP API.
- **Its operations are those of `packages/openapi/openapi.yaml`** (ADR-0009). That one document is the contract for the web app, the CLI, agents, the mailbox agent's tools and MCP.
- **The authorizer** (`authorizer.ts`) resolves each call to one actor:
  - a human, from a Cognito token;
  - an agent, from its key, of which only the hash is stored (ADR-0013);
  - a mailbox agent, from its run's token (`run-tokens.ts`).
- **Each handler takes that actor.** It checks rights itself, and answers a refusal that says what to do next.

### Search

- **The search module is `search-engine.ts`** (ADR-0007), with LanceDB behind it (`lancedb-search.ts`).
- **Each mailbox has its own index.** Its one writer is the **indexer**, fed through a FIFO queue grouped by mailbox. It catches up from the mailbox's change feed (`indexing.ts`).
- **Messages are embedded with Titan,** and each search is translated with Nova Lite into the organization's search languages.
- **The search and indexer Lambdas are one x64 zip,** because LanceDB's native module must sit beside the bundle (`packages/infra/src/search-code.ts`).

### Coo, the mailbox agent

- **One AgentCore Runtime serves every human's mailbox agent,** one per human, working in all their mailboxes (ADR-0027, ADR-0033). Its code is `agent-runtime.ts` around `agent-loop.ts`, Duva's own Converse tool loop.
- **Its tools are API operations,** which it calls over HTTP with its run's token, as any agent calls Duva. So it can do only what an agent with that access can, attributed to it.
- **It's run from four places:**
  - **Ask Coo:** the **conversation** Lambda (`conversation.ts`) takes each turn and streams back what Coo says. The web app reaches it through CloudFront with origin access control.
  - **Label prompts:** the **task runner** runs a label prompt's task (`tasks.ts`, ADR-0029).
  - **MCP:** the **MCP** Lambda serves Duva's MCP endpoint (`mcp.ts`, ADR-0028).
  - **Unsubscribing:** when one-click fails for a sender set to Nowhere, the task runner has Coo go on with it (`unsubscribe-runs.ts`, ADR-0031). Coo tries the opt-out page in AgentCore Browser, with only page tools (`unsubscribe-agent.ts`), then mailing the List-Unsubscribe address, then a link in the body, and last bounces the mail. The one-click POST itself is the **unsubscriber** Lambda's (`unsubscriber.ts`).
- **Models:** `agent-models.ts` holds the models, the regions and the prices. Routing and handover are in ADR-0032 and `docs/research/coo-models.md`.
- **Claude is never called from eu-north-1,** where the Marketplace agreement fails. An EU deployment calls it in eu-central-1 through the `eu.` profile.

### Sign-in and the web app

- **Humans sign in through Cognito managed login,** with a code emailed from the organization's domain (ADR-0010). PKCE is in `packages/web/src/session.ts`.
- **The web app is React and Vite,** served from S3 through one CloudFront distribution. That distribution also fronts the download, conversation and logo paths. Linked files' pages are under the download path, served by the download Lambda, whose Download sends the browser on to S3 (`linked-files.ts`).
- **Every string it shows is in `packages/web/src/strings.ts`.**

### Security posture

- **No world-invocable Lambda, ever.** No resource policy with `Principal: "*"`, or any principal without a source condition. No function URL with `AuthType NONE`.
  - Lambdas are invoked by IAM, or by a service principal scoped by `SourceArn` or `SourceAccount`: API Gateway, SES, SNS, EventBridge, or CloudFront with origin access control.
  - The account's security tooling disables any function that breaks this.
  - The only wildcard principals allowed are Deny statements, such as those refusing requests not sent over TLS.
- **Admins can't read personal mailboxes.** Agents own none, and work only with sponsor access (ADR-0015, ADR-0030).
- **Requests to URLs found in mail** (one-click unsubscribes, logo fetches) go through `internet.ts`, each from its own Lambda that may do nothing else:
  - only public addresses;
  - only ports 80 and 443;
  - connected to the address that was checked;
  - no cookies.

### Build and deploy

- **`npm run build`, in order:**
  1. checks the generated code and the text;
  2. runs every test;
  3. typechecks;
  4. synthesizes the CDK app (`packages/infra/src/synth.ts`);
  5. builds the web app;
  6. compiles `duva` with Bun, embedding the cloud assembly and the web app.
- **The binary can't synthesize the CDK app,** so `duva deploy` ships only what the build built.
- **What deploy learns at run time,** like the domain and the first admin, reaches the stack as CloudFormation parameters, or the CLI sets it up through the AWS SDK (`packages/cli/src/deployment.ts`).
- **Later domains** are the API's to add at run time (ADR-0018).

## 3. Where code goes

| Package | Holds | Notes |
|---|---|---|
| `packages/openapi` | `openapi.yaml`, and `*.gen.ts` generated from it | Edit the YAML and run `npm run generate`. Never hand-edit `*.gen.ts` |
| `packages/api` | Every Lambda (`*-lambda.ts`), each feature's module, the mailbox agent, search | `infrastructure.ts` is what the API expects of the stack: table keys, environment variable names, stream filters. The CDK app and the harness import it |
| `packages/client` | The typed client and sign-in helper | Used by the web app, the CLI and the tests |
| `packages/web` | The web app, one `.tsx` per view or part | Copy lives in `strings.ts` |
| `packages/infra` | `stack.ts`, the code bundlers, `synth.ts` | Infra tests read the synthesized assembly |
| `packages/cli` | `duva`: commands from the contract (`api-commands.ts`), `deploy`, `login`, `skill` | Every command prints JSON on stdout. Errors go to stderr as JSON with exit 1, saying what to do next |
| `skills/duva` | The skill `duva skill install` writes | Generated by `npm run generate` |
| `scripts` | generate, check-text, check-deployment, end-to-end, destroy-test-deployment | |

A new feature usually touches four of these, in this order:
1. the contract;
2. a module in `packages/api` beside its handlers;
3. the stack, if it needs a resource or permission;
4. the web app or the CLI.

## 4. How the code is written

- **Each module opens with a comment saying what it is and why,** in plain sentences with ADR and issue numbers. The comments inside are sparse, and explain decisions and AWS facts, never the obvious. Match the surrounding density.
- **Names come from the glossary.** A new domain concept gets a glossary entry first (the `domain-modeling` skill).
- **One source for anything shared.** Operations come from `@duva/openapi`. The table's keys, the environment variables and the stream filters come from `@duva/api/infrastructure`. The CDK app, the API and the test harness all import these, never copy them.
- **Every handler and stream consumer is idempotent.** Use conditional puts (`isNew` in `table.ts`), claims recorded before acting (a bounce, a feedback report, a task), and steps conditional on the last. Events are delivered more than once, and Lambda retries.
- **Writes and their change go in one transaction,** with the change attributed to exactly one actor, or to nobody for mail that simply arrived.
- **A Lambda bundles everything it imports,** the AWS SDK included. Where a lost answer would repeat an action, give the SDK one attempt per call.
- **Refusals say what to do next,** in the product's voice: plain, direct and short, with no em dash (`npm run check:text` fails on one), no spaced hyphen as a dash, and no "not X but Y".
- **Copy is the glossary's.** The web app's strings live in `strings.ts`. The CLI's help comes from the contract's descriptions, which also become the skill.
- **Commits:**
  - The title states the behavior, ending with the issue, like `Coo bounces a legitimate sender's mail from what SES judged as it arrived, and says why when it can't (#136)`.
  - Bullets follow, if there's more to say.
  - One commit per ticket, rebased onto `main`.

## 5. How it's tested

**The seams.** Tests sit only at the six seams `AGENTS.md` lists, and observe only what comes out of them. The `tdd` skill in `.agents/skills/tdd/` covers what a good test is.
- The API, through `startDuva()` in `packages/api/test/harness.ts`. This is most tests. The harness stands in for SES, S3, Scheduler, DNS, the internet, Bedrock and AgentCore, and drives them through the methods `AGENTS.md` lists.
- The CLI as a process.
- `duva deploy`'s logic with stand-ins.
- The synthesized cloud assembly.
- The search module's behavior suite, and its evaluation.
- The built web app in headless Chromium, through `startWebApp()`.

**What a test is not allowed to do:**
- read a DynamoDB item, an S3 key or a private function, since each sits outside every seam;
- take expected values from the code under test. They come from a literal, a worked example or the spec.

**Test names** state behavior in the glossary's terms.

**Recorded answers:** Bedrock's answers are recorded, so tests need no AWS.
- **Titan's vectors** are in `titan-vectors.json`, and **Nova Lite's translations** in `nova-translations.json`. After changing a search test's mail or words, record them again with `DUVA_RECORD_EMBEDDINGS=1`.
- **Coo's evaluation** replays `coo-answers.json`. A change to the agent's prompt, tools or loop can make a recorded run diverge. Delete that setup's runs and record them again with `DUVA_RECORD_MODELS=1 DUVA_RECORD_EMBEDDINGS=1`. That costs real money, about $4 for every setup, so say so in the ticket.

**The web tests** cover what a human sees and does, through roles and text. They leave the domain rules to the API's tests.

**Commands:**
- `npm run check` runs everything. Run single files while you work: `npx vitest run packages/api/test/<file>`.
- `npm run typecheck` runs the typecheck often.
- The suite runs DynamoDB Local and Chromium, and is heavy. Run one full suite at a time per machine.

## 6. How a ticket goes

1. **The ticket** is a GitHub issue on `nille/duva` (`docs/agents/issue-tracker.md`), labelled per `docs/agents/triage-labels.md`. Read it, its parent spec, and the ADRs it touches.
2. **If it contradicts an ADR, or the code and specs can't settle it,** ask before building. Nicklas decides product questions. Bring them with a recommendation.
3. **Build it test first, at the seams.** Keep the contract, the generated code and the skill in step (`npm run generate`).
4. **Add to `scripts/check-deployment.ts`** each behavior the ticket makes visible from outside a deployment.
5. **Finish the code:**
   1. rebase onto `main`;
   2. run `npm run check` once;
   3. review the diff (the `code-review` skill against `CODING_STANDARDS.md`);
   4. fix what the review found;
   5. commit.
6. **Merge and build:** fast-forward `main`, then run `npm run build`.
7. **Audit the template** in `packages/infra/dist/assembly/Duva.template.json`. It must have no Allow for a wildcard principal, and no function URL with `AuthType NONE`.
8. **Deploy, only once the build has succeeded:** `AWS_REGION=eu-north-1 packages/cli/dist/duva deploy`. Then run `AWS_REGION=eu-north-1 node scripts/check-deployment.ts`.
9. **Do the real run in the test account** (`docs/agents/test-deployment.md`):
   - exercise the ticket from outside, through the CLI, real mail, or the web app headless as the test human;
   - record any AWS fact you learn in `docs/aws.md`, with how you learned it.
10. **Close the issue** with what the real run showed.

**Decisions:** a new decision that's hard to reverse, surprising, or a real trade-off gets an ADR, numbered after the last one. A change of an AWS fact gets an entry in `docs/aws.md`.

## 7. Hard rules

- **No world-invocable Lambda, ever.** See section 2.
- **Privacy:** never read `nicklas@duva.nille.xyz`'s threads, messages or raw copies. Find a test message's raw copy by its exact Message-ID or S3 key, never by "latest". Real runs use the test mailboxes only.
- **Set `AWS_REGION` on every AWS command,** since the shell's default points at a region Duva doesn't use.
- **Throwaway AWS resources** for probing a service are allowed only if the same script deletes them.
- **Never kill processes by pattern** (`pkill -f vitest`). Other agents run the same tools as the same user. Stop only the PIDs you started.
- **Don't deploy a build that failed.**

## 8. Traps others hit

- The build needs **x64 Linux**, **Node 24 or newer**, **Java 17 or newer** and **Chromium**. Bun comes as a dev dependency.
- **CloudFront names are global to the account,** so each carries the region.
- **Security headers go only in `SecurityHeadersConfig`,** never in custom headers.
- **An origin request policy can't forward `x-amz-content-sha256`.**
- **Cognito's `UpdateUserPool` resets every setting it isn't given.**
- **SES replaces the Message-ID of raw sends.** Record the ID SES answers with.
- **SES's own spam scan can fail Duva's own alert mail.** Inbound trusts the system address's own Message-IDs.
- **An HTTP API joins a repeated query parameter with commas,** and ends an integration after 30 seconds. That's why Coo's long runs stream through the conversation Lambda's function URL.
- **A receipt rule takes at most 500 recipients.** Duva spreads addresses over `Addresses`, `Addresses-2` and on.
- **A rule with no recipients takes every address** on the account's verified domains, so Duva never writes one.

`docs/aws.md` has each of these with its evidence, and many more.
