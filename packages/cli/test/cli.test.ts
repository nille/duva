import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDuva } from "@duva/api/harness";
import { expect, onTestFinished, test, vi } from "vitest";

test("deploy refuses a region where SES can't receive mail", async () => {
  const machine = await newMachine();
  await writeFile(join(machine.home, ".aws", "config"), "[default]\nregion = ca-west-1\n");

  const result = await machine.duva("deploy");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/ca-west-1/);
});

test("deploy asks for a region when the AWS configuration names none", async () => {
  const machine = await newMachine();

  const result = await machine.duva("deploy");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/No AWS region.*AWS_REGION/);
});

test("status reaches the deployment saved in the CLI's config", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ version: "2.3.4", region: "eu-west-1" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const result = await machine.duva("status");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ version: "2.3.4", region: "eu-west-1" });
});

test("status says to run deploy first when no deployment is saved", async () => {
  const machine = await newMachine();

  const result = await machine.duva("status");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/duva deploy/);
});

test("login signs in through the browser, and whoami then names the signed-in admin", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const login = await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const whoami = await machine.duva("whoami");

  expect(login.exitCode).toBe(0);
  expect(JSON.parse(login.stdout)).toEqual({ signedIn: { id: expect.any(String), kind: "human", email: "ada@example.com", admin: true } });
  expect(whoami.exitCode).toBe(0);
  expect(JSON.parse(whoami.stdout)).toEqual({ id: expect.any(String), kind: "human", email: "ada@example.com", admin: true });
});

test("whoami says to run login first when nobody has signed in", async () => {
  const machine = await newMachine();
  const server = await (await startDuva()).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/duva login/);
});

test("a session renews itself once its access token has expired", async () => {
  const machine = await newMachine();
  // The CLI renews a session whose access token expires within a minute, so with this lifetime it renews on every call.
  const server = await (await startDuva({ admin: "ada@example.com", accessTokenLifetime: 30 })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  // The CLI runs as its own process, so the test can't stand in for its clock, but it stands in for
  // Duva's: there the token login got has expired, and only a renewed one gets through.
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
  onTestFinished(() => void vi.useRealTimers());

  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ email: "ada@example.com" });
});

test("once the session can't be renewed, whoami says to run login again", async () => {
  const machine = await newMachine();
  // The CLI renews a session whose access token expires within a minute, so with this lifetime it renews on every call.
  const duva = await startDuva({ admin: "ada@example.com", accessTokenLifetime: 30 });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  duva.endSessions();

  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/expired.*duva login/);
});

test("once deploy has saved a new user pool's sign-in, a session from the old one says to run login again", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  await machine.saveDeployment({ ...server, signIn: { ...server.signIn, clientId: "new-pool-cli-client" } });

  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/expired.*duva login/);
});

test("login fails when the browser comes back from another sign-in", async () => {
  const machine = await newMachine();
  const server = await (await startDuva()).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const result = await machine.duva("login", { browserOpens: (redirectUri) => `${redirectUri}?code=stolen&state=other` });

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/another sign-in/);
});

test("organization changes lists the setup changes after a position", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ domain: "duva.example.com", admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const result = await machine.duva("organization", "changes", "--after", "1");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    changes: [
      { position: 2, type: "domainAdded", domain: "duva.example.com" },
      { position: 3, type: "actorAdded", added: { email: "ada@example.com" } },
    ],
    position: 3,
  });
});

test("organization changes refuses a position that isn't a number", async () => {
  const machine = await newMachine();

  const result = await machine.duva("organization", "changes", "--after", "first");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/"first" isn't a whole number. Give --after/);
});

test("an admin turns erasure of approval records on with a flag, and off with its --no- form", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ domain: "duva.example.com", admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const before = await machine.duva("organization", "settings");
  const on = await machine.duva("organization", "change-settings", "--erasureErasesApprovals");
  const off = await machine.duva("organization", "change-settings", "--no-erasureErasesApprovals");

  expect(JSON.parse(before.stdout)).toEqual({ erasureErasesApprovals: false });
  expect(on.exitCode).toBe(0);
  expect(JSON.parse(on.stdout)).toEqual({ erasureErasesApprovals: true });
  expect(off.exitCode).toBe(0);
  expect(JSON.parse(off.stdout)).toEqual({ erasureErasesApprovals: false });
});

test("organization change-settings with no setting says which there are", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const result = await machine.duva("organization", "change-settings");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/400.*Give a setting to change: erasureErasesApprovals/);
});

test("a human chooses to read mail as text", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const changed = await machine.duva("preferences", "change", "--mailView", "text");

  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout)).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "text" });
});

test("a human chooses 24-hour time and ISO dates, and the CLI's own timestamps stay ISO 8601", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const before = await machine.duva("preferences", "get");
  const changed = await machine.duva("preferences", "change", "--hourCycle", "h23", "--dateFormat", "dayMonth");
  const changes = await machine.duva("organization", "changes");

  expect(JSON.parse(before.stdout)).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html" });
  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout)).toEqual({ hourCycle: "h23", dateFormat: "dayMonth", mailView: "html" });
  const times = (JSON.parse(changes.stdout) as { changes: { at: string }[] }).changes.map(({ at }) => at);
  expect(times).not.toHaveLength(0);
  for (const at of times) expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("preferences change with a date format Duva doesn't have says which there are", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const result = await machine.duva("preferences", "change", "--dateFormat", "yearFirst");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/400.*Give dateFormat as locale, iso, dayMonth or monthDay/);
});

test("a human creates an agent, and the agent calls Duva with its key from the environment", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const ada = JSON.parse((await machine.duva("whoami")).stdout) as { id: string };

  const created = await machine.duva("agents", "create", "--name", "Hermes");
  const { agent, key } = JSON.parse(created.stdout) as { agent: { id: string }; key: string };
  // The agent's own machine has the deployment's config, but nobody has signed in there.
  const agentMachine = await newMachine();
  await agentMachine.saveDeployment(server);
  const whoami = await agentMachine.duva("whoami", { env: { DUVA_AGENT_KEY: key } });

  expect(created.exitCode).toBe(0);
  expect(JSON.parse(created.stdout)).toEqual({
    agent: { id: expect.any(String), kind: "agent", name: "Hermes", sponsor: ada.id, admin: false },
    key: expect.stringMatching(/^duva_agent_/),
  });
  expect(whoami.exitCode).toBe(0);
  expect(JSON.parse(whoami.stdout)).toEqual({ id: agent.id, kind: "agent", name: "Hermes", sponsor: ada.id, admin: false });
});

test("the sponsor rotates an agent's key, and the agent's old key is refused", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };

  const rotated = await machine.duva("agents", "rotate-key", "--agent", agent.id);
  const whoami = await machine.duva("whoami", { env: { DUVA_AGENT_KEY: key } });

  expect(rotated.exitCode).toBe(0);
  expect(JSON.parse(rotated.stdout)).toEqual({ agent, key: expect.stringMatching(/^duva_agent_/) });
  expect(whoami.exitCode).toBe(1);
  expect(errorIn(whoami.stderr)).toMatch(/DUVA_AGENT_KEY.*sponsor/);
});

test("agents list shows the agents the signed-in human sponsors", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { agent } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: unknown };

  const result = await machine.duva("agents", "list");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ agents: [agent] });
});

test("the sponsor gives an agent read sponsor access and turns a switch off, and the agent then lists and reads the sponsor's mailbox", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const ada = JSON.parse((await machine.duva("whoami")).stdout) as { id: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", ada.id, "--address", "ada@example.com")).stdout) as { id: string };
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const asAgent = { env: { DUVA_AGENT_KEY: key } };

  const refused = await machine.duva("threads", "list", "--mailbox", mailbox.id, asAgent);
  const changed = await machine.duva("agents", "change-settings", "--agent", agent.id, "--sponsorAccess", "read", "--no-approvalAsSponsor");
  const settings = await machine.duva("agents", "settings", "--agent", agent.id, asAgent);
  const mailboxes = await machine.duva("mailboxes", "list", asAgent);
  const threads = await machine.duva("threads", "list", "--mailbox", mailbox.id, asAgent);

  const expected = { sponsorAccess: "read", approvalForOwnMailbox: true, approvalAsSponsor: false, disclosureLineForOwnMailbox: true, disclosureLineAsSponsor: true };
  expect(refused.exitCode).toBe(1);
  expect(errorIn(refused.stderr)).toMatch(/403.*Ask them for read access/);
  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout)).toEqual(expected);
  expect(JSON.parse(settings.stdout)).toEqual(expected);
  expect(JSON.parse(mailboxes.stdout)).toEqual({ mailboxes: [{ ...mailbox, sponsorAccess: "read" }] });
  expect(threads.exitCode).toBe(0);
  expect(JSON.parse(threads.stdout)).toEqual({ threads: [] });
});

test("agents create asks for the name when it's missing", async () => {
  const machine = await newMachine();

  const result = await machine.duva("agents", "create");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/--name/);
});

test("login refuses to sign in while an agent key is set", async () => {
  const machine = await newMachine();
  const server = await (await startDuva()).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const result = await machine.duva("login", { env: { DUVA_AGENT_KEY: "duva_agent_x" } });

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/DUVA_AGENT_KEY/);
});

test("an admin gives an agent a mailbox, and the agent catches up on it, lists its Inbox and reads the mail", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };

  const created = await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com");
  const mailbox = JSON.parse(created.stdout) as { id: string };
  await duva.receive(
    "From: Grace <grace@example.org>\r\nTo: hermes+cli@example.com\r\nSubject: Hello\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\n\r\nHi Hermes.\r\n",
    { to: ["hermes+cli@example.com"] },
  );
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const mailboxes = await machine.duva("mailboxes", "list", asAgent);
  const changes = await machine.duva("mailboxes", "changes", "--mailbox", mailbox.id, "--after", "0", asAgent);
  const threads = await machine.duva("threads", "list", "--mailbox", mailbox.id, asAgent);
  const { thread } = (JSON.parse(changes.stdout) as { changes: { thread: string }[] }).changes[0]!;
  const read = await machine.duva("threads", "get", "--mailbox", mailbox.id, "--thread", thread, asAgent);

  expect(created.exitCode).toBe(0);
  expect(mailbox).toEqual({ id: expect.any(String), kind: "personal", owner: agent.id, defaultAddress: "hermes@example.com" });
  expect(JSON.parse(mailboxes.stdout)).toEqual({ mailboxes: [mailbox] });
  expect(JSON.parse(changes.stdout)).toEqual({ changes: [{ position: 1, at: expect.any(String), type: "messageReceived", thread, message: expect.any(String) }], position: 1 });
  expect(JSON.parse(threads.stdout)).toMatchObject({ threads: [{ id: thread, subject: "Hello", labels: ["inbox"] }] });
  expect(read.exitCode).toBe(0);
  expect(JSON.parse(read.stdout)).toMatchObject({
    id: thread,
    messages: [{ from: { name: "Grace", address: "grace@example.org" }, recipient: "hermes+cli@example.com", plusTag: "cli", text: "Hi Hermes." }],
  });
});

test("mailboxes changes leaves spam arrivals out unless it's given --spam", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  await duva.receive("From: Mallory <mallory@example.net>\r\nTo: hermes@example.com\r\nSubject: Prize\r\n\r\nYou won.\r\n", { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });
  const asAgent = { env: { DUVA_AGENT_KEY: key } };

  const without = await machine.duva("mailboxes", "changes", "--mailbox", mailbox.id, asAgent);
  const withSpam = await machine.duva("mailboxes", "changes", "--mailbox", mailbox.id, "--spam", asAgent);

  expect(JSON.parse(without.stdout)).toEqual({ changes: [], position: 1 });
  expect(JSON.parse(withSpam.stdout)).toMatchObject({ changes: [{ position: 1, type: "messageReceived", spam: true }], position: 1 });
});

test("a human lets a waiting sender in from the CLI, and switches the Screener off with --no-on", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { id: ada } = JSON.parse((await machine.duva("whoami")).stdout) as { id: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", ada, "--address", "ada@example.com")).stdout) as { id: string };
  await duva.receive("From: Grace <grace@example.org>\r\nTo: ada@example.com\r\nSubject: Hello\r\n\r\nHi Ada.\r\n", { to: ["ada@example.com"] });

  const waiting = await machine.duva("screener", "get", "--mailbox", mailbox.id);
  const letIn = await machine.duva("screener", "let-in", "--mailbox", mailbox.id, "--address", "grace@example.org");
  const off = await machine.duva("screener", "switch", "--mailbox", mailbox.id, "--no-on");

  expect(JSON.parse(waiting.stdout)).toMatchObject({ on: true, senders: [{ address: "grace@example.org", threads: [{ subject: "Hello", labels: ["screener"] }] }] });
  expect(JSON.parse(letIn.stdout)).toMatchObject({ sender: { address: "grace@example.org", decision: "letIn", actor: ada }, threads: [{ subject: "Hello", labels: ["inbox"] }] });
  expect(JSON.parse(off.stdout)).toEqual({ on: false, senders: [], letIn: 1, blocked: 0 });
});

test("mailboxes create says why an address is refused", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ domain: "example.com", admin: "ada@example.org" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string } };

  const result = await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.net");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/400.*isn't an address on example.com/);
});

test("skill install writes the skill where agents look for skills, and says where", async () => {
  const machine = await newMachine();

  const result = await machine.duva("skill", "install");

  expect(result.exitCode).toBe(0);
  const skills = [join(machine.home, ".agents", "skills", "duva", "SKILL.md"), join(machine.home, ".claude", "skills", "duva", "SKILL.md")];
  expect(JSON.parse(result.stdout)).toEqual({ installed: skills });
  for (const skill of skills) {
    const text = await readFile(skill, "utf8");
    expect(text).toMatch(/^---\nname: duva\ndescription: .+\n---\n/);
    expect(text).toContain("DUVA_AGENT_KEY");
    expect(text).toContain("## duva agents create\n\nCreate an agent, with you as its sponsor, and show its key once.");
    expect(text).toContain("`--name` (required): The agent's name.");
  }
});

test("the skill describes every command the CLI has, and no other", async () => {
  const machine = await newMachine();
  const commands = errorIn((await machine.duva("no-such-command")).stderr).replace(/.*The commands are: /, "").replace(/\.$/, "").split(", ");

  await machine.duva("skill", "install");

  const skill = await readFile(join(machine.home, ".agents", "skills", "duva", "SKILL.md"), "utf8");
  const described = [...skill.matchAll(/^## duva (.+)$/gm)].map(([, words]) => words);
  expect(described).toEqual(commands);
  expect(commands).toContain("skill install");
});

test("skill install again replaces the old copy", async () => {
  const machine = await newMachine();
  const skill = join(machine.home, ".agents", "skills", "duva");
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "An old skill.\n");
  await writeFile(join(skill, "old-command.md"), "An old command.\n");

  const result = await machine.duva("skill", "install");

  expect(result.exitCode).toBe(0);
  expect(await readFile(join(skill, "SKILL.md"), "utf8")).toMatch(/^---\nname: duva\n/);
  expect(await readdir(skill)).toEqual(["SKILL.md"]);
});

test("the agent drafts a reply and asks to send it, and the sponsor lists it and rejects it with a note", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  await duva.receive("From: Grace <grace@example.org>\r\nTo: hermes@example.com\r\nSubject: Meeting\r\n\r\nMonday?\r\n", { to: ["hermes@example.com"] });
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const changes = JSON.parse((await machine.duva("mailboxes", "changes", "--mailbox", mailbox.id, asAgent)).stdout) as { changes: { message: string }[] };

  const drafted = await machine.duva("drafts", "create", "--mailbox", mailbox.id, "--answers", changes.changes[0]!.message, "--text", "Monday works.", asAgent);
  const draft = JSON.parse(drafted.stdout) as { id: string };
  const asked = await machine.duva("drafts", "send", "--mailbox", mailbox.id, "--draft", draft.id, asAgent);
  const listed = await machine.duva("approvals", "list");
  const { approvals } = JSON.parse(listed.stdout) as { approvals: { id: string }[] };
  const rejected = await machine.duva("approvals", "reject", "--approval", approvals[0]!.id, "--note", "Say Tuesday.");
  const read = await machine.duva("drafts", "get", "--mailbox", mailbox.id, "--draft", draft.id, asAgent);

  expect(drafted.exitCode).toBe(0);
  expect(draft).toMatchObject({ from: "hermes@example.com", to: [{ name: "Grace", address: "grace@example.org" }], subject: "Re: Meeting", text: "Monday works." });
  expect(JSON.parse(asked.stdout)).toMatchObject({ send: { state: "waiting" } });
  expect(approvals).toMatchObject([{ state: "pending", draft: { id: draft.id, text: "Monday works." }, original: { subject: "Meeting", text: "Monday?" } }]);
  expect(rejected.exitCode).toBe(0);
  expect(JSON.parse(read.stdout)).toMatchObject({ send: { approval: approvals[0]!.id, state: "rejected", note: "Say Tuesday." } });
});

test("the sponsor sends a pending draft from the CLI, as is or with their own text, and the agent sees it sent", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const ask = async (text: string) => {
    const draft = JSON.parse((await machine.duva("drafts", "create", "--mailbox", mailbox.id, "--to", "grace@example.org", "--subject", "Hello", "--text", text, asAgent)).stdout) as { id: string };
    const asked = JSON.parse((await machine.duva("drafts", "send", "--mailbox", mailbox.id, "--draft", draft.id, asAgent)).stdout) as { send: { approval: string } };
    return { draft: draft.id, approval: asked.send.approval };
  };
  const first = await ask("Hej Grace.");
  const second = await ask("Hej.");

  const asIs = await machine.duva("approvals", "send", "--approval", first.approval);
  const edited = await machine.duva("approvals", "send", "--approval", second.approval, "--text", "Hej Grace, hur mår du?");
  const read = await machine.duva("drafts", "get", "--mailbox", mailbox.id, "--draft", first.draft, asAgent);

  expect([asIs.exitCode, edited.exitCode]).toEqual([0, 0]);
  expect(JSON.parse(asIs.stdout)).toMatchObject({ id: first.approval, state: "approved" });
  expect(JSON.parse(edited.stdout)).toMatchObject({ id: second.approval, state: "approved", edits: { text: "Hej Grace, hur mår du?" } });
  expect(JSON.parse(read.stdout)).toMatchObject({ send: { approval: first.approval, state: "sent" } });
  expect(duva.sent()).toHaveLength(2);
});

test("drafts create takes a new message's recipients as --to, once for each", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };

  const result = await machine.duva(
    "drafts", "create", "--mailbox", mailbox.id, "--to", "grace@example.org", "--to", "ada@example.org", "--subject", "Hello", "--text", "Hej.",
    { env: { DUVA_AGENT_KEY: key } },
  );

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ from: "hermes@example.com", to: [{ address: "grace@example.org" }, { address: "ada@example.org" }] });
});

/** A message to Hermes with one attachment, whose name is in Swedish. */
const withAttachment = [
  "From: Grace <grace@example.org>",
  "To: hermes@example.com",
  "Subject: Rapporten",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="part"',
  "",
  "--part",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Rapporten bifogas.",
  "--part",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Disposition: attachment; filename*=UTF-8''r%C3%A4kenskaper.txt",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("Siffror.").toString("base64"),
  "--part--",
].join("\r\n");

/** A deployment where the agent Hermes, which Ada sponsors, got a message with an attachment. */
async function withAgentAttachment(machine: Awaited<ReturnType<typeof newMachine>>) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  await duva.receive(withAttachment, { to: ["hermes@example.com"] });
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const changes = JSON.parse((await machine.duva("mailboxes", "changes", "--mailbox", mailbox.id, asAgent)).stdout) as { changes: { message: string }[] };
  return { mailbox: mailbox.id, message: changes.changes[0]!.message, asAgent };
}

test("attachments download saves an attachment in the working directory under its name, and says where it wrote it", async () => {
  const machine = await newMachine();
  const { mailbox, message, asAgent } = await withAgentAttachment(machine);

  const result = await machine.duva("attachments", "download", "--mailbox", mailbox, "--message", message, "--attachment", "0", asAgent);

  expect(result.exitCode).toBe(0);
  const file = join(machine.home, "räkenskaper.txt");
  expect(JSON.parse(result.stdout)).toEqual({ file, name: "räkenskaper.txt", type: "text/plain", size: 8 });
  expect(await readFile(file, "utf8")).toBe("Siffror.");
});

test("attachments download writes where --file says, and never over a file that's there", async () => {
  const machine = await newMachine();
  const { mailbox, message, asAgent } = await withAgentAttachment(machine);
  const file = join(machine.home, "saved.txt");

  const saved = await machine.duva("attachments", "download", "--mailbox", mailbox, "--message", message, "--attachment", "0", "--file", file, asAgent);
  const again = await machine.duva("attachments", "download", "--mailbox", mailbox, "--message", message, "--attachment", "0", "--file", file, asAgent);

  expect(saved.exitCode).toBe(0);
  expect(JSON.parse(saved.stdout)).toMatchObject({ file });
  expect(again.exitCode).toBe(1);
  expect(errorIn(again.stderr)).toMatch(/already.*--file/);
  expect(await readFile(file, "utf8")).toBe("Siffror.");
});

test("approvals reject asks for the note when it's missing", async () => {
  const machine = await newMachine();

  const result = await machine.duva("approvals", "reject", "--approval", "x");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/--note/);
});

/**
 * A machine with nothing configured: no AWS settings and no Duva config. Like the environment,
 * its home directory is input at this seam. The CLI's config file there is part of the CLI's
 * behavior: duva deploy writes it and the API commands read it.
 */
async function newMachine() {
  const home = await mkdtemp(join(tmpdir(), "duva-cli-"));
  await mkdir(join(home, ".aws"));
  let redirectUri = "";
  return {
    home,
    /**
     * Runs duva, with the variables in env added to the environment. With browserSignsIn, the
     * browser login opens signs in as that human. With browserOpens, it opens the URL the function
     * makes from the loopback redirect instead.
     */
    async duva(...args: [...string[], Options] | string[]) {
      const last = args.at(-1);
      const options = typeof last === "object" ? last : undefined;
      const words = (options ? args.slice(0, -1) : args) as string[];
      const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home, ...options?.env };
      if (options !== undefined && ("browserSignsIn" in options || "browserOpens" in options)) {
        env.BROWSER = await browserScript(home, options as Browser, redirectUri);
      }
      return run(words, env);
    },
    /**
     * Saves a deployment in the CLI's config, as duva deploy does: its API, and its managed login
     * with a loopback redirect on a free port.
     */
    async saveDeployment(server: { url: string; signIn: { url: string; clientId: string } }) {
      redirectUri = `http://127.0.0.1:${await freePort()}/callback`;
      await mkdir(join(home, ".config", "duva"), { recursive: true });
      await writeFile(
        join(home, ".config", "duva", "config.json"),
        JSON.stringify({ apiUrl: server.url, signIn: { ...server.signIn, redirectUri } }),
      );
    },
  };
}

type Browser = { browserSignsIn: string } | { browserOpens: (redirectUri: string) => string };
type Options = (Browser | {}) & { env?: Record<string, string> };

const browserJs = fileURLToPath(new URL("browser.ts", import.meta.url));

/** A script to give duva as $BROWSER, which acts as a browser does: see browser.ts. */
async function browserScript(home: string, browser: Browser, redirectUri: string): Promise<string> {
  const script = join(home, "browser");
  const action = "browserSignsIn" in browser ? `--sign-in-as '${browser.browserSignsIn}'` : `--open '${browser.browserOpens(redirectUri)}'`;
  await writeFile(script, `#!/bin/sh\nexec node '${browserJs}' ${action} "$1"\n`);
  await chmod(script, 0o755);
  return script;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

const bun = fileURLToPath(new URL("../../../node_modules/.bin/bun", import.meta.url));
const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));

function run(args: string[], env: Record<string, string>) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    // The machine's working directory is its home.
    const child = spawn(bun, [main, ...args], { env, cwd: env.HOME });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/** The message of the error the CLI printed as JSON on stderr. */
function errorIn(stderr: string): string {
  const lastLine = stderr.trim().split("\n").at(-1) ?? "";
  return (JSON.parse(lastLine) as { error: string }).error;
}
