# The mailbox agent routes each run by its job, and hands over to a harder model on evidence

A mailbox agent's run starts with the model its job takes, and goes over to a harder model when it shows it needs one. Admins choose three models, not one: for answering in Ask Coo and over MCP, for the tasks labels' prompts give (ADR-0029), and for the harder work. Claude Haiku 4.5 answers and does tasks by default, and Claude Sonnet 5.5 does the harder work: drafting a reply that may be sent, and unsubscribing on a sender's page (ADR-0031). Amazon's Nova models stay choices. Nicklas chose the routing on 2026-10-08 (#132), first with Nova 2 Lite as the everyday model, then these defaults from the measurements in `docs/research/coo-models.md`, where they did every task at 3.1 cents, against Sonnet alone's 4.9 and Nova 2 Lite with Sonnet's 90% at 4.0. It refines ADR-0027, where admins chose one model.

Duva's own code decides, in three layers:

1. **The job.** A task starts with the task model. A conversation turn starts with the everyday model, unless the decider, when an admin turns it on, settles otherwise. Think harder answers the human's last turn again with the harder model, after the turns before it, and its answer is a new turn.
2. **The decider, for a turn the job doesn't settle, off by default.** One Amazon Nova Micro call, through the eu or us profile, chooses simple or complex for the human's words, with its confidence, through a tool it must use. Complex, or less than 0.7 sure, starts the turn with the harder model. It costs about $0.00002 and 400 ms. On #132's tasks it said 0.95 every time and was right on 4 of 10, so it is off unless an admin turns it on (`mailboxAgentDecider`).
3. **Evidence within the run.** The everyday model hands the run to the harder one, with the work so far, when it comes to writing mail that may be sent (its first createDraft, editDraft or sendDraft, which the harder model then takes again), when Duva refuses two of its tool calls, after 6 steps, when it uses the ask_for_help tool its prompt tells it to use when unsure, or when its answer doesn't hold up: it is empty, it names an ID nothing in the run gave it, or a conversation turn answered without looking anything up. Until the run can't hand over, each step's text waits for the step to end, so the human reads no answer that was set aside.

Each handover is kept on the turn or the task, with its reason, and is a change in the mailbox's change feed, so it shows in the agent's activity. Each conversation turn's routing is kept with its words' Titan embedding, labelled everyday, decided, its handover's reason, or thought harder, in the human's own partition of the organization's table. Admins read the month's counts, never the words or the embeddings. That history is for a nearest-neighbour router a later ticket may turn on. Nothing of it leaves the account (ADR-0002).

## Considered options

- One model for everything, as before. Rejected: on #132's tasks Claude Sonnet 5.5 alone succeeded most and cost the most, Claude Haiku 4.5 alone missed a triage run, and Nova 2 Lite alone did the everyday work at a fraction of the price but failed at writing and guessed rather than looked.
- Nova 2 Lite as the everyday model, as first built. Rejected after measuring: its turns handed over half the time, which cost nearly as much as Sonnet alone, and its label tasks failed a quarter of the time with nothing in the run to show it.
- A learned router now, as Strands Decider, a 2B model. Set aside: it needs a warm CPU or GPU host, which breaks ADR-0006's near-zero idle cost. The kept history makes a nearest-neighbour router possible later, in the account.
- A decider shared by all deployments. Rejected: mail would leave each organization's account (ADR-0002).
- AgentCore hosting a small model, or Bedrock's prompt routers. Rejected: AgentCore bills a CPU microVM per session, and prompt routers route only within one family of older models and aren't in eu-north-1.
- Writing on the harder model only when a reply is to be sent. Not possible from the words alone, so writing any draft hands over: a draft is what the agent may later ask to send.

## Consequences

- The three models must each run through the chosen profile from the chosen region. Nova Micro has only the eu and us profiles, so the decider uses eu from an EU region and us from any other.
- The runtime's role may call Nova Micro through its eu and us profiles, and the conversation Lambda Titan in the deployment's own region.
- A conversation turn that needs no lookup, as a greeting, goes to the harder model, since the answer check can't tell it from a guess. That costs a harder model's call, not a wrong answer.
- Unsubscribing on a sender's page (ADR-0031) is harder work, and starts with the harder model.

## Note

On 2026-10-08 (#140) Coo told Nicklas an agent was paused, from an old alert in the mail, while it was running. So the mailbox agent lists its owner's agents with listAgents, as Duva has them now, its prompt says to look there, and at its drafts, before it says where an agent or a send stands, and the answer check also reads each clause of an answer that names one of the owner's agents for whether it says the agent is paused or running, and compares that with Duva's list. An everyday model's answer that gets it wrong is set aside, and the harder model is told what Duva has. The harder model's answer has streamed by then, so Duva tells it what it got wrong once, and its correction follows.
