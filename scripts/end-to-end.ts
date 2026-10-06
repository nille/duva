// The end-to-end run on a real deployment, on demand rather than on every commit:
//
//   AWS_REGION=eu-north-1 npm run end-to-end
//
// npm run end-to-end builds first. The script re-deploys the deployment in the region with the
// duva binary the build made, then has a second agent mail the first through real SES. The first
// agent catches up on its change feed, reads the message and replies, both agents using the binary
// with their keys, and the sponsor approves each send through the API. The reply must land in the
// second agent's mailbox, in the thread of the original, with the disclosure. The raw copies SES
// stored show its verdicts and the headers the recipient saw. Last, one message goes to a known and
// an unknown address at once, straight to SES's inbound SMTP endpoint, and check-deployment.ts runs.
//
// The sponsor is the human signed in to the CLI's config (duva login), an admin. The two agents
// and their mailboxes are made on the first run and reused after, with new keys each run. Reports
// each step as passed or failed, then what the run found. Exits 1 if any step fails.
//
// A step that fails skips the steps that need it. A step that only checks what came of earlier ones
// fails alone.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveMx, resolveTxt } from "node:dns/promises";
import { access } from "node:fs/promises";
import { connect } from "node:net";
import { hostname } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { DescribeReceiptRuleSetCommand, SESClient } from "@aws-sdk/client-ses";
import { inboundPrefix, sentPrefix } from "@duva/api/infrastructure";
import { createDuvaClient } from "@duva/client";
import { stackName, stackOutputs } from "@duva/infra/outputs";
import type { components } from "@duva/openapi";
import { readConfig } from "../packages/cli/src/config.ts";
import { accessToken } from "../packages/cli/src/session.ts";

type Schemas = components["schemas"];

const region = process.env.AWS_REGION;
if (!region) throw new Error("Set AWS_REGION to the region of the deployment to run on.");
const binary = fileURLToPath(new URL("../packages/cli/dist/duva", import.meta.url));
const runId = randomUUID().slice(0, 8);
const startedAt = new Date();
const agentNames = { first: "End-to-end first", second: "End-to-end second" };
const subject = `End-to-end run ${runId}`;

const findings: string[] = [];
let failed = false;
/** Steps later ones need have failed, so those are skipped. */
let blocked = false;
/**
 * Runs a step and reports it. Its result is undefined only once the step failed or was skipped,
 * and then no step that reads it runs, so it is typed as always there.
 */
async function step<T>(name: string, perform: () => Promise<T>, { needed = true } = {}): Promise<T> {
  if (blocked) {
    console.log(`skip  ${name}`);
    return undefined as T;
  }
  try {
    const result = await perform();
    console.log(`ok    ${name}`);
    return result;
  } catch (error) {
    failed = true;
    if (needed) blocked = true;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined as T;
  }
}
/** A step no later one needs. */
const check = (name: string, perform: () => Promise<void>) => step(name, perform, { needed: false });

// The deployment, re-deployed with this build.
const s3 = new S3Client({ region });
let mailBucket: Promise<string> | undefined;
const stored = new Map<string, MailHeaders>();

const duvaStack = async () => {
  const { Stacks = [] } = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }));
  return Stacks[0];
};
const stackUpdatedAt = async () => {
  const stack = await duvaStack();
  return (stack?.LastUpdatedTime ?? stack?.CreationTime)?.toISOString();
};
const deployed = await step("duva deploy re-deploys the deployment, with its DNS records live and its domain verified", async () => {
  await access(binary).catch(() => {
    throw new Error(`There is no duva binary at ${binary}. Run npm run build.`);
  });
  const before = await stackUpdatedAt();
  const result = (await duva(undefined, ["deploy"])) as {
    domain: { name: string; records: { name: string; type: string; status: string }[]; ses: { dkim: string; mailFrom: string } };
  };
  const after = await stackUpdatedAt();
  findings.push(
    before === after
      ? "Re-deploying left the stack unchanged."
      : `Re-deploying updated the stack, last updated ${before ?? "never"} and now ${after}. A second run with the same build should leave it unchanged.`,
  );
  const notLive = result.domain.records.filter(({ status }) => status !== "live");
  if (notLive.length > 0) throw new Error(`these DNS records aren't live: ${notLive.map(({ type, name, status }) => `${type} ${name} (${status})`).join(", ")}`);
  const { dkim, mailFrom } = result.domain.ses;
  if (dkim !== "verified" || mailFrom !== "verified") throw new Error(`SES has DKIM ${dkim} and MAIL FROM ${mailFrom} for ${result.domain.name}`);
  return { domain: result.domain.name };
});

// The sponsor, through the API.
const sponsor = await step("the sponsor is signed in to the CLI's config as an admin", async () => {
  const { apiUrl, signIn } = await readConfig();
  if (apiUrl === undefined) throw new Error("No Duva deployment is configured. Run duva deploy first.");
  const client = createDuvaClient(apiUrl, { headers: { authorization: `Bearer ${await accessToken(signIn)}` } });
  const human = answer(await client.GET("/whoami"));
  if (human.kind !== "human" || !human.admin) throw new Error(`the CLI is signed in as ${JSON.stringify(human)}, who isn't an admin`);
  return { client, email: human.email };
});

interface Agent {
  name: string;
  key: string;
  mailbox: string;
  address: string;
  /** Where the agent has caught up to in its mailbox's change feed. */
  position: number;
}
const agents = await step("the sponsor has two agents, each with a mailbox on the domain and a new key", async () => {
  const { client } = sponsor;
  const { agents } = answer(await client.GET("/agents"));
  const { mailboxes } = answer(await client.GET("/mailboxes"));
  const agentNamed = async (name: string): Promise<Agent> => {
    const existing = agents.find((agent) => agent.name === name);
    const { agent, key } = existing
      ? answer(await client.POST("/agents/{agent}/key", { params: { path: { agent: existing.id } } }))
      : answer(await client.POST("/agents", { body: { name } }));
    const address = `${name.toLowerCase().replaceAll(" ", "-")}@${deployed.domain}`;
    const mailbox =
      // A human's change never waits for approval, so the answer is the mailbox.
      mailboxes.find(({ owner }) => owner === agent.id) ?? (answer(await client.POST("/mailboxes", { body: { owner: agent.id, address } })) as Schemas["Mailbox"]);
    return { name, key, mailbox: mailbox.id, address: mailbox.defaultAddress ?? address, position: 0 };
  };
  return { first: await agentNamed(agentNames.first), second: await agentNamed(agentNames.second) };
});

await step("both agents catch up on their change feeds with the duva binary", async () => {
  for (const agent of [agents.first, agents.second]) await catchUp(agent);
});

const original = await step("the second agent mails the first, and SES accepts it once the sponsor approves the send through the API", async () => {
  const draft = (await asAgent(agents.second, ["drafts", "create"], [
    "--to", agents.first.address, "--subject", subject, "--text", `Hello from the second agent, in the end-to-end run ${runId}.`,
  ])) as Schemas["Draft"];
  return await sendApproved(agents.second, draft);
});

const received = await step("the first agent catches up on its change feed and reads the message, with its disclosure line", async () => {
  const [arrival] = await arrivals(agents.first, (message) => message.subject === subject);
  const message = arrival!.message;
  if (arrival!.spam) throw new Error("SES judged it to be spam");
  checkDisclosureLine(message, agentNames.second);
  if (message.messageId !== original.messageId) {
    throw new Error(`it arrived with the Message-ID ${message.messageId}, but Duva recorded ${original.messageId} for the sent message`);
  }
  return message;
});

await check("SES's verdicts on the first agent's copy are present, none fails, and SPF, DKIM and DMARC pass", async () => {
  const headers = await rawCopy(received.messageId!);
  findings.push(`Verdicts on the first agent's copy: ${verdicts(headers)}.`);
  checkVerdicts(headers);
});

const reply = await step("the first agent drafts a reply and asks to send it, and SES accepts it once the sponsor approves it through the API", async () => {
  const draft = (await asAgent(agents.first, ["drafts", "create"], [
    "--answers", received.id, "--text", `A reply from the first agent, in the end-to-end run ${runId}.`,
  ])) as Schemas["Draft"];
  return await sendApproved(agents.first, draft);
});

const replyReceived = await step("the reply lands in the second agent's mailbox, in the thread of the original, with the disclosure line", async () => {
  const [arrival] = await arrivals(agents.second, ({ messageId }) => messageId === reply.messageId);
  const { thread, message, spam } = arrival!;
  if (spam) throw new Error("SES judged it to be spam");
  if (thread !== original.thread) throw new Error(`it is in thread ${thread}, but the original is in ${original.thread}`);
  checkDisclosureLine(message, agentNames.first);
  return message;
});

await check("the reply's copy carries the Duva-Agent header, answers the Message-ID the first agent saw, and SES's verdicts on it pass", async () => {
  const headers = await rawCopy(replyReceived.messageId!);
  findings.push(`Verdicts on the second agent's copy of the reply: ${verdicts(headers)}.`);
  const disclosure = `${agentNames.first} for ${sponsor.email}`;
  if (headers.get("duva-agent")?.[0] !== disclosure) throw new Error(`its Duva-Agent header is ${JSON.stringify(headers.get("duva-agent"))}, not "${disclosure}"`);
  const inReplyTo = headers.get("in-reply-to")?.[0];
  if (inReplyTo !== received.messageId) throw new Error(`its In-Reply-To is ${inReplyTo}, but the first agent saw ${received.messageId}`);
  checkVerdicts(headers);
});

await check("the Message-ID the recipient saw is the one Duva recorded for the reply", async () => {
  const generated = headersOf(await mailObject(`${sentPrefix}${reply.message}`)).get("message-id")?.[0];
  const seen = replyReceived.messageId;
  findings.push(
    generated === seen
      ? `SES kept the Message-ID Duva generated, ${generated}.`
      : `SES replaced the Message-ID Duva generated, ${generated}, with ${seen}. Duva recorded ${reply.messageId}, and the reply's In-Reply-To named the original's as the first agent saw it, ${received.messageId}.`,
  );
  if (reply.messageId !== seen) throw new Error(`the recipient saw ${seen}, but Duva recorded ${reply.messageId}`);
});

await check("a message to a known and an unknown address at once reaches the known one only", async () => {
  const probeSubject = `${subject}, a known and an unknown address`;
  const known = agents.first.address;
  const unknown = `end-to-end-unknown-${runId}@${deployed.domain}`;
  // The sender is on the domain, from a server it doesn't authorize. That fails DMARC, which drops the message only under a reject policy.
  const sender = `end-to-end@${deployed.domain}`;
  const policy = await dmarcPolicy(deployed.domain);
  if (policy === "reject") throw new Error(`the DMARC policy covering ${deployed.domain} is reject, so Duva would drop the message, which comes from this machine`);
  const [mx] = (await resolveMx(deployed.domain)).sort((a, b) => a.priority - b.priority);
  if (mx === undefined) throw new Error(`${deployed.domain} has no MX record`);
  const probe = [
    `From: ${sender}`, `To: ${known}, ${unknown}`, `Subject: ${probeSubject}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${runId}.probe@${deployed.domain}>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "",
    `To a known and an unknown address, in the end-to-end run ${runId}.`,
  ].join("\r\n");
  const answers = await smtp(mx.exchange, sender, [known, unknown], probe);
  const copies = answers.recipients[known]?.startsWith("250") ? await arrivals(agents.first, (message) => message.subject === probeSubject) : [];
  findings.push(
    `Over SMTP to ${mx.exchange}, SES answered RCPT TO the known ${known} with "${answers.recipients[known]}" ` +
      `and the unknown ${unknown} with "${answers.recipients[unknown]}", then DATA with "${answers.data}". ` +
      `The known address's mailbox got ${copies.length} ${copies.length === 1 ? "copy" : "copies"}${copies.some(({ spam }) => spam) ? ", judged to be spam" : ""}.`,
  );
  if (!answers.recipients[known]?.startsWith("250")) throw new Error(`SES refused the known address: ${answers.recipients[known]}`);
  if (!answers.recipients[unknown]?.startsWith("5")) throw new Error(`SES didn't refuse the unknown address: ${answers.recipients[unknown]}`);
  if (copies.length !== 1) throw new Error(`the known address's mailbox got ${copies.length} copies`);
});

// check-deployment.ts also sees whether anything this run sent or received waits in a failure queue.
await check("check-deployment.ts passes", async () => {
  const { exitCode, stdout } = await runProcess(process.execPath, [fileURLToPath(new URL("check-deployment.ts", import.meta.url))]);
  if (exitCode !== 0) throw new Error(`it failed:\n${stdout.split("\n").filter((line) => line.startsWith("FAIL")).join("\n")}`);
});

if (findings.length > 0) console.log(`\nFindings\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
process.exitCode = failed ? 1 : 0;

/** Runs the duva binary as the agent with the key, or as the signed-in human, and returns what it printed. */
async function duva(key: string | undefined, args: string[]): Promise<unknown> {
  const { DUVA_AGENT_KEY: _, ...environment } = process.env;
  const { exitCode, stdout, stderr } = await runProcess(binary, args, key === undefined ? environment : { ...environment, DUVA_AGENT_KEY: key });
  if (exitCode !== 0) throw new Error(`duva ${args.slice(0, 2).join(" ")} failed: ${stderr.trim()}`);
  return JSON.parse(stdout);
}

/** Runs the duva command as the agent, in its mailbox. */
function asAgent(agent: Agent, command: string[], args: string[]) {
  return duva(agent.key, [...command, "--mailbox", agent.mailbox, ...args]);
}

function runProcess(command: string, args: string[], env = process.env) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Throws unless the text of a message the agent sent ends with the line saying so. */
function checkDisclosureLine(message: Schemas["Message"], agentName: string) {
  const line = `Sent by ${agentName} for ${sponsor.email}`;
  if (!message.text.trimEnd().endsWith(line)) throw new Error(`its text doesn't end with "${line}": ${JSON.stringify(message.text)}`);
}

/** What an API call through the client answered, or an error naming its status. */
function answer<T>({ data, error, response }: { data?: T; error?: unknown; response: Response }): T {
  if (data === undefined) throw new Error(`the API answered ${response.status}: ${JSON.stringify(error)}`);
  return data;
}

/** Calls again until it gives something, for up to two minutes. */
async function until<T>(what: string, attempt: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const result = await attempt();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`${what} didn't happen within two minutes`);
    await sleep(3_000);
  }
}

/** The changes in the agent's mailbox since it last caught up, read with the binary until it lists no more. */
async function catchUp(agent: Agent, { spam = false } = {}): Promise<Schemas["MailboxChange"][]> {
  const changes: Schemas["MailboxChange"][] = [];
  for (;;) {
    const page = (await asAgent(agent, ["mailboxes", "changes"], ["--after", String(agent.position), ...(spam ? ["--spam"] : [])])) as Schemas["MailboxChangePage"];
    agent.position = page.position;
    if (page.changes.length === 0) return changes;
    changes.push(...page.changes);
  }
}

/**
 * The mail that arrives in the agent's mailbox, as the agent catches up and reads each new message's
 * thread, until a message matches. Then waits a little longer, so a second copy would show.
 */
async function arrivals(agent: Agent, matches: (message: Schemas["Message"]) => boolean) {
  const found: { thread: string; message: Schemas["Message"]; spam: boolean }[] = [];
  const read = async () => {
    // Spam arrivals too, so mail judged to be spam shows as that.
    for (const change of await catchUp(agent, { spam: true })) {
      if (change.type !== "messageReceived") continue;
      const thread = (await asAgent(agent, ["threads", "get"], ["--thread", change.thread])) as Schemas["Thread"];
      const message = thread.messages.find(({ id }) => id === change.message);
      if (message !== undefined && matches(message)) found.push({ thread: change.thread, message, spam: change.spam === true });
    }
  };
  await until(`mail arriving in ${agent.address}`, async () => {
    await read();
    return found.length > 0 || undefined;
  });
  await sleep(10_000);
  await read();
  return found;
}

/** Asks for the agent's draft to be sent, has the sponsor approve it through the API, and waits for SES to accept it. */
async function sendApproved(agent: Agent, draft: Schemas["Draft"]) {
  await asAgent(agent, ["drafts", "send"], ["--draft", draft.id]);
  const { approvals } = answer(await sponsor.client.GET("/approvals"));
  const approval = approvals.find((approval) => approval.draft.id === draft.id && approval.state === "pending");
  if (approval === undefined) throw new Error(`no approval waits for the sponsor for draft ${draft.id}`);
  answer(await sponsor.client.POST("/approvals/{approval}/send", { params: { path: { approval: approval.id } }, body: {} }));
  const send = await until(`SES answering for draft ${draft.id}`, async () => {
    const { send } = (await asAgent(agent, ["drafts", "get"], ["--draft", draft.id])) as Schemas["Draft"];
    return send !== undefined && ["sent", "failed", "unclear"].includes(send.state) ? send : undefined;
  });
  if (send.state !== "sent") throw new Error(`the send is ${send.state}${send.reason === undefined ? "" : `: ${send.reason}`}`);
  return send as Required<Pick<Schemas["SendStatus"], "thread" | "message" | "messageId">>;
}

/** The mail bucket, which SES's receipt rule stores mail in. */
function bucket(): Promise<string> {
  mailBucket ??= (async () => {
    const ruleSet = (await duvaStack())?.Outputs?.find(({ OutputKey }) => OutputKey === stackOutputs.receiptRuleSet)?.OutputValue;
    const { Rules = [] } = await new SESClient({ region }).send(new DescribeReceiptRuleSetCommand({ RuleSetName: ruleSet }));
    const name = Rules[0]?.Actions?.find(({ S3Action }) => S3Action)?.S3Action?.BucketName;
    if (name === undefined) throw new Error("Duva's receipt rule stores mail in no bucket");
    return name;
  })();
  return mailBucket;
}

/** A raw message in the mail bucket. */
async function mailObject(key: string): Promise<string> {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: await bucket(), Key: key }));
  return (await Body?.transformToString()) ?? "";
}

/** The headers of the copies SES stored during this run, by key, read once each. */
/** The headers of the copy SES stored of the message it received with the Message-ID during this run. */
async function rawCopy(messageId: string): Promise<MailHeaders> {
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: await bucket(), Prefix: inboundPrefix, ContinuationToken }));
    keys.push(...(page.Contents ?? []).filter(({ LastModified }) => LastModified && LastModified >= startedAt).map(({ Key }) => Key!));
    ContinuationToken = page.NextContinuationToken;
  } while (ContinuationToken);
  for (const key of keys) {
    if (!stored.has(key)) stored.set(key, headersOf(await mailObject(key)));
    if (stored.get(key)!.get("message-id")?.[0] === messageId) return stored.get(key)!;
  }
  throw new Error(`SES stored no copy with the Message-ID ${messageId} during this run`);
}

/** A message's headers by lower-case name, each with its values in order, unfolded. */
type MailHeaders = Map<string, string[]>;

function headersOf(raw: string): MailHeaders {
  const headers: MailHeaders = new Map();
  const head = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), line.slice(colon + 1).trim()]);
  }
  return headers;
}

/** The Authentication-Results SES wrote into the copy it stored. */
function sesResults(headers: MailHeaders) {
  return headers.get("authentication-results")?.find((value) => value.startsWith("amazonses.com"));
}

/** SES's verdicts, as it writes them into the copy it stores. */
function verdicts(headers: MailHeaders): string {
  return `spam ${headers.get("x-ses-spam-verdict")?.[0] ?? "missing"}, virus ${headers.get("x-ses-virus-verdict")?.[0] ?? "missing"}, Authentication-Results ${sesResults(headers) ?? "missing"}`;
}

function checkVerdicts(headers: MailHeaders) {
  const problems: string[] = [];
  // Only FAIL acts. GRAY and PROCESSING_FAILED count as passes.
  for (const name of ["x-ses-spam-verdict", "x-ses-virus-verdict"]) {
    const verdict = headers.get(name)?.[0];
    if (verdict === undefined || verdict === "FAIL") problems.push(`${name} is ${verdict ?? "missing"}`);
  }
  for (const method of ["spf", "dkim", "dmarc"]) {
    if (!new RegExp(`\\b${method}=pass\\b`).test(sesResults(headers) ?? "")) problems.push(`${method} didn't pass`);
  }
  if (problems.length > 0) throw new Error(`${problems.join(", ")}: ${verdicts(headers)}`);
}

/** The p of the DMARC record at the domain or, without one, the nearest parent domain with one. */
async function dmarcPolicy(domain: string): Promise<string | undefined> {
  for (let name = domain; name.includes("."); name = name.slice(name.indexOf(".") + 1)) {
    const records = await resolveTxt(`_dmarc.${name}`).catch(() => []);
    const record = records.map((strings) => strings.join("")).find((text) => text.startsWith("v=DMARC1"));
    if (record !== undefined) return /\bp=(\w+)/.exec(record)?.[1]?.toLowerCase();
  }
  return undefined;
}

/** Hands the message to the SMTP server as a sender's server does, and returns its answers to each recipient and to the message. */
async function smtp(host: string, sender: string, recipients: string[], message: string) {
  const socket = connect({ host, port: 25 });
  let failure: Error | undefined;
  socket.on("error", (error) => (failure = error));
  socket.setTimeout(30_000, () => socket.destroy(new Error(`${host}:25 stopped answering`)));
  const lines = createInterface({ input: socket, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const reply = async () => {
    const text: string[] = [];
    for (;;) {
      const { value, done } = await lines.next();
      if (done) throw failure ?? new Error(`${host}:25 closed the connection${text.length > 0 ? ` after ${text.join(" ")}` : ""}`);
      text.push(value);
      if (/^\d{3}( |$)/.test(value)) return text.join(" ");
    }
  };
  const say = (command: string) => {
    socket.write(`${command}\r\n`);
    return reply();
  };
  const expect = async (code: string, command?: string) => {
    const answer = command === undefined ? await reply() : await say(command);
    if (!answer.startsWith(code)) throw new Error(`${host} answered ${command ?? "the connection"} with ${answer}`);
  };
  try {
    await expect("220");
    await expect("250", `EHLO ${hostname()}`);
    await expect("250", `MAIL FROM:<${sender}>`);
    const recipientAnswers: Record<string, string> = {};
    for (const recipient of recipients) recipientAnswers[recipient] = await say(`RCPT TO:<${recipient}>`);
    let data = "not sent, since SES refused every recipient";
    if (Object.values(recipientAnswers).some((answer) => answer.startsWith("250"))) {
      const ready = await say("DATA");
      if (!ready.startsWith("354")) throw new Error(`SES answered DATA with ${ready}`);
      // A line starting with a dot gets another, so it isn't read as the end.
      data = await say(`${message.replace(/^\./gm, "..")}\r\n.`);
    }
    await say("QUIT");
    return { recipients: recipientAnswers, data };
  } finally {
    socket.destroy();
  }
}
