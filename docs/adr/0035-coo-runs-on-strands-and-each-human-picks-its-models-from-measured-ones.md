# Coo runs on Strands, and each human picks its models from measured ones

Coo's tool loop moves to the Strands Agents SDK for TypeScript (`@strands-agents/sdk`, Apache-2.0, 1.20.0 on 2026-10-08), with Bedrock's ConverseStream behind it, in place of the loop of Duva's own that ADR-0027 chose. Coo keeps every behavior it has, as Strands hooks and middleware and Duva's own code beside them:
- the tools taken from the OpenAPI contract;
- the step budget, failed calls, the writing rule and asking for help, each a handover to the harder model (ADR-0032);
- the answer check and its correction (#140), held text, and think harder;
- spend counted by tokens, run tokens (ADR-0027), and the lines of JSON streamed to the conversation Lambda.

Nicklas chose this on 2026-10-10, after hearing that Strands would replace only Duva's core loop, about 80 lines, and grow Coo's bundle by about 1.3 MB.

Each human picks their Coo's everyday model and harder model, from the models admins allow. Admins set the organization's defaults, and the monthly spend cap still stops every run past it. Only measured models can be allowed: models Duva has recorded on Coo's evaluation, each listed with its success by kind of work, its cost per task, and where it processes mail. A model available only in the US can be chosen in an EU deployment too. A small flag beside each model in the picker says where its inference runs.

Nicklas wanted GPT-6 Luna as the everyday model and GPT-6 Sol as the harder one, and chose them as the defaults for every deployment on 2026-10-10, from #150's numbers (#158). Alone, each did every run of Coo's evaluation, Luna at 0.05 cents a task and Sol at 1.68, where Claude Haiku 4.5 did 97% at 1.99 and Sonnet 5.5 every run at 4.81. Together, as the defaults, they did every run at 0.73 cents a task, about $2.18 for a small organization's month, where Haiku with Sonnet did 97% at 3.18 cents, about $14 (docs/research/coo-models.md). In the EU both run only through Bedrock's global profile, so with them an EU deployment's mail may be processed outside the EU: the model settings say so while either is one of the organization's models, and deploy says so once, on the first deploy. A new organization allows Claude Haiku 4.5 and Sonnet 5.5 beside them. An organization set up before keeps the models it had: setup stores Haiku and Sonnet, allowed, where its admins chose no others, and admins change them in Settings.

## Considered options

- Keep Duva's own loop. It was recommended, since Strands would replace only the loop and everything that makes Coo behave stays Duva's code. Nicklas chose Strands for a framework others know, and for its MCP client and multi-agent patterns later.
- Strands in Python, where it began. Rejected: the TypeScript SDK covers what Coo needs, and Duva is one TypeScript monorepo (ADR-0005).
- Strands' ModelRouter for the handover. Rejected: it switches models only on model errors, never on evidence such as failed calls or an answer that didn't hold up.
- Every model Bedrock offers, read live. Rejected: an unmeasured model can fail Coo's tasks quietly, as Nova 2 Lite did on about 40% of them.

## Consequences

- **Strands' defaults change:** tool calls run one at a time, and its printer is off. It has no dollar budget, so Duva keeps counting spend itself.
- **The test seam gets an adapter,** a Strands `Model` per stand-in model, so `coo-answers.json` keeps its format. The move re-records only the Haiku and Sonnet setup, to show Coo behaves as before.
- **Then every listed model is recorded once,** on the loop that ships:
  - GPT-6 Luna and GPT-6 Sol;
  - Grok 4.7;
  - the open-weight models that run in eu-north-1 itself: gpt-oss-120b, Qwen3 235B, DeepSeek V3.2, GLM-5, Kimi K2.5 and MiniMax M2.5;
  - Kimi K3 and GLM-5.3;
  - Llama 4 Maverick, for US deployments.

  Claude and Nova stay measured.
- **Luna's Marketplace agreement is NOT_AVAILABLE from eu-north-1,** as Claude's is, yet a call worked from there. So Coo keeps calling models from its model region, eu-central-1 for an EU deployment, and the evaluation retests each model from where it would be called.
- **ADR-0032's routing by job stands.** The task model follows the everyday model, so a human chooses two models where admins chose three.
