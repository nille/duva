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

  expect(JSON.parse(before.stdout)).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 0 });
  expect(on.exitCode).toBe(0);
  expect(JSON.parse(on.stdout)).toEqual({ erasureErasesApprovals: true, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 0 });
  expect(off.exitCode).toBe(0);
  expect(JSON.parse(off.stdout)).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 0 });
});

test("an admin previews a retention period and sets it", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const preview = await machine.duva("organization", "preview-retention", "--retentionDays", "7");
  const changed = await machine.duva("organization", "change-settings", "--retentionDays", "7");

  expect(preview.exitCode).toBe(0);
  expect(JSON.parse(preview.stdout)).toEqual({ retentionDays: 7, threads: 0 });
  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout)).toEqual({ erasureErasesApprovals: false, retentionDays: 7, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 0 });
});

test("an admin gives the search languages to organization change-settings, once for each", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ domain: "duva.example.com", admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const result = await machine.duva("organization", "change-settings", "--searchLanguages", "Swedish", "--searchLanguages", "Danish", "--searchLanguages", "English");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish", "Danish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 0 });
});

test("organization change-settings with no setting says which there are", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const result = await machine.duva("organization", "change-settings");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/400.*Give a setting to change: erasureErasesApprovals, retentionDays/);
});

test("a human chooses to read mail as text", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const changed = await machine.duva("preferences", "change", "--mailView", "text");

  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout)).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "text", keyboardShortcuts: "on" });
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

  expect(JSON.parse(before.stdout)).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on" });
  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout)).toEqual({ hourCycle: "h23", dateFormat: "dayMonth", mailView: "html", keyboardShortcuts: "on" });
  const times = (JSON.parse(changes.stdout) as { changes: { at: string }[] }).changes.map(({ at }) => at);
  expect(times).not.toHaveLength(0);
  for (const at of times) expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("a human chooses a time zone, and removes it again", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const chosen = await machine.duva("preferences", "change", "--timeZone", "Europe/Stockholm");
  const removed = await machine.duva("preferences", "change", "--no-timeZone");

  expect(JSON.parse(chosen.stdout)).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", timeZone: "Europe/Stockholm" });
  expect(removed.stderr).toBe("");
  expect(removed.exitCode).toBe(0);
  expect(JSON.parse(removed.stdout)).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on" });
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

test("the sponsor pauses an agent, its key is refused saying so, and unpausing lets it work again", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };

  const paused = await machine.duva("agents", "pause", "--agent", agent.id);
  const refused = await machine.duva("whoami", { env: { DUVA_AGENT_KEY: key } });
  const unpaused = await machine.duva("agents", "unpause", "--agent", agent.id);
  const whoami = await machine.duva("whoami", { env: { DUVA_AGENT_KEY: key } });

  expect(paused.exitCode).toBe(0);
  expect(JSON.parse(paused.stdout)).toEqual({ ...agent, paused: { by: expect.any(String), at: expect.any(String) } });
  expect(refused.exitCode).toBe(1);
  expect(errorIn(refused.stderr)).toMatch(/403.*This agent is paused by ada@example\.com\./);
  expect(JSON.parse(unpaused.stdout)).toEqual(agent);
  expect(JSON.parse(whoami.stdout)).toEqual(agent);
});

test("the sponsor reads their agent's daily summaries and a day's timeline from the CLI", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { agent } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string } };
  await machine.duva("agents", "pause", "--agent", agent.id);
  const today = new Date().toISOString().slice(0, 10);

  const summaries = await machine.duva("agents", "activity", "--agent", agent.id, "--from", today, "--to", today, "--timeZone", "UTC");
  const timeline = await machine.duva("agents", "timeline", "--agent", agent.id, "--day", today, "--timeZone", "UTC");

  expect(summaries.exitCode).toBe(0);
  expect(JSON.parse(summaries.stdout)).toEqual({ timeZone: "UTC", days: [{ day: today, sent: 0, approved: 0, rejected: 0, received: 0, organized: 0, screened: 0, alerts: 0 }] });
  expect(timeline.exitCode).toBe(0);
  expect((JSON.parse(timeline.stdout) as { entries: { change: { type: string } }[] }).entries.map(({ change }) => change.type)).toEqual(["agentPaused", "actorAdded"]);
});

test("the sponsor lists their agents' alerts with the unseen count, and marks one seen", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  await machine.duva("agents", "pause", "--agent", agent.id);
  await machine.duva("whoami", { env: { DUVA_AGENT_KEY: key } });

  const listed = await machine.duva("alerts", "list");
  const { alerts } = JSON.parse(listed.stdout) as { alerts: { id: string }[] };
  const seen = await machine.duva("alerts", "mark-seen", "--alerts", alerts[0]!.id);

  expect(JSON.parse(listed.stdout)).toEqual({ alerts: [expect.objectContaining({ kind: "keyUsedWhilePaused", agent: agent.id, seen: false })], unseen: 1 });
  expect(seen.exitCode).toBe(0);
  expect(JSON.parse(seen.stdout)).toEqual({ unseen: 0 });
});

test("the sponsor limits an agent to one send an hour, and sends its second message now from the CLI", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  const limited = await machine.duva("agents", "change-settings", "--agent", agent.id, "--sendsPerHour", "1", "--no-approvalForOwnMailbox");
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const send = async (to: string) => {
    const draft = JSON.parse((await machine.duva("drafts", "create", "--mailbox", mailbox.id, "--to", to, "--subject", "Hello", "--text", "Hej.", asAgent)).stdout) as { id: string };
    await machine.duva("drafts", "send", "--mailbox", mailbox.id, "--draft", draft.id, asAgent);
    return draft.id;
  };
  await send("grace@example.org");
  const second = await send("linus@example.org");

  const waiting = await machine.duva("drafts", "get", "--mailbox", mailbox.id, "--draft", second);
  const now = await machine.duva("drafts", "send-now", "--mailbox", mailbox.id, "--draft", second);

  expect(JSON.parse(limited.stdout)).toMatchObject({ sendsPerHour: 1, approvalForOwnMailbox: false });
  expect(JSON.parse(waiting.stdout)).toMatchObject({ send: { state: "waitingForLimit" } });
  expect(now.exitCode).toBe(0);
  expect(JSON.parse(now.stdout)).toMatchObject({ id: second, send: { state: "approved" } });
  expect(duva.sentTo()).toEqual([["grace@example.org"], ["linus@example.org"]]);
});

test("an admin makes their agent an admin, which asks to add an address, and the admin approves it from the CLI", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ domain: "example.com", admin: "ada@example.com", humans: ["grace@example.com"] })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  const asAgent = { env: { DUVA_AGENT_KEY: key } };

  const made = await machine.duva("agents", "change", "--agent", agent.id, "--admin");
  const asked = await machine.duva("addresses", "add", "--address", "sales@example.com", "--mailbox", mailbox.id, asAgent);
  const { id } = JSON.parse(asked.stdout) as { id: string };
  const approved = await machine.duva("setup-approvals", "approve", "--approval", id);
  const grace = JSON.parse((await machine.duva("humans", "list")).stdout).humans.find(({ email }: { email: string }) => email === "grace@example.com");
  const removal = await machine.duva("humans", "remove", "--human", grace.id, asAgent);
  const unmade = await machine.duva("agents", "change", "--agent", agent.id, "--no-admin");

  expect(JSON.parse(made.stdout)).toEqual({ ...agent, admin: true });
  expect(asked.exitCode).toBe(0);
  expect(JSON.parse(asked.stdout)).toMatchObject({ state: "pending", preview: ["Gives Hermes's mailbox at hermes@example.com the address sales@example.com."] });
  expect(JSON.parse(approved.stdout)).toMatchObject({ state: "approved", result: { status: 201 } });
  expect(JSON.parse((await machine.duva("addresses", "list")).stdout).addresses.map(({ address }: { address: string }) => address)).toContain("sales@example.com");
  expect(removal.exitCode).toBe(1);
  expect(errorIn(removal.stderr)).toMatch(/403.*Agents can't remove humans/);
  expect(JSON.parse(unmade.stdout)).toEqual(agent);
});

test("an admin removes a human from the CLI, first with --dryRun, handing their mailbox to another human", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.com", humans: ["grace@example.com", "linus@example.com"] });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { humans } = JSON.parse((await machine.duva("humans", "list")).stdout) as { humans: { id: string; email: string }[] };
  const [grace, linus] = ["grace@example.com", "linus@example.com"].map((email) => humans.find((human) => human.email === email)!);
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", grace!.id, "--address", "grace@example.com")).stdout) as { id: string };

  const dryRun = await machine.duva("humans", "remove", "--human", grace!.id, "--dryRun");
  const removed = await machine.duva("humans", "remove", "--human", grace!.id, "--handTo", linus!.id, "--handOver", mailbox.id);

  expect(JSON.parse(dryRun.stdout)).toMatchObject({ human: grace, mailboxes: [mailbox], agents: [], removed: false });
  expect(removed.exitCode).toBe(0);
  expect(JSON.parse(removed.stdout)).toMatchObject({ human: grace, removed: true });
  expect((await duva.signIn("linus@example.com").GET("/mailboxes")).data?.mailboxes).toEqual([{ ...mailbox, owner: linus!.id, groups: [] }]);
});

test("an admin makes a human an admin with --admin, and the last admin can't take away their own with --no-admin", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com", humans: ["grace@example.com"] })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { humans } = JSON.parse((await machine.duva("humans", "list")).stdout) as { humans: { id: string; email: string }[] };
  const ada = humans.find(({ email }) => email === "ada@example.com")!;
  const grace = humans.find(({ email }) => email === "grace@example.com")!;

  const last = await machine.duva("humans", "change", "--human", ada.id, "--no-admin");
  const made = await machine.duva("humans", "change", "--human", grace.id, "--admin");

  expect(last.exitCode).toBe(1);
  expect(errorIn(last.stderr)).toMatch(/last admin/);
  expect(JSON.parse(made.stdout)).toEqual({ ...grace, admin: true });
});

test("an admin adds an alias domain from the CLI, sees its records, and removes it, first with --dryRun", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });

  const added = await machine.duva("domains", "add", "--domain", "example.se", "--aliasOf", "example.com");
  const dryRun = await machine.duva("domains", "remove", "--domain", "example.se", "--dryRun");
  const removed = await machine.duva("domains", "remove", "--domain", "example.se");

  expect(JSON.parse(added.stdout)).toMatchObject({ domain: "example.se", kind: "alias", aliasOf: "example.com", ses: { verified: false } });
  expect(JSON.parse(added.stdout).records.map(({ status }: { status: string }) => status)).toEqual(Array(7).fill("missing"));
  expect(JSON.parse(dryRun.stdout)).toMatchObject({ domains: ["example.se"], removed: false });
  expect(JSON.parse(removed.stdout)).toMatchObject({ domains: ["example.se"], removed: true });
  expect(JSON.parse((await machine.duva("domains", "list")).stdout).domains.map(({ domain }: { domain: string }) => domain)).toEqual(["example.com"]);
});

test("an admin sets a domain's catch-all from the CLI, and clears it", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  await machine.duva("groups", "create", "--address", "support@example.com", "--members", "linus@example.net");

  const set = await machine.duva("domains", "set-catch-all", "--domain", "example.com", "--group", "support@example.com");
  const cleared = await machine.duva("domains", "clear-catch-all", "--domain", "example.com");

  expect(JSON.parse(set.stdout)).toMatchObject({ domain: "example.com", catchAll: { group: "support@example.com" } });
  expect(JSON.parse(cleared.stdout)).toMatchObject({ domain: "example.com" });
  expect(JSON.parse(cleared.stdout).catchAll).toBeUndefined();
});

test("an admin sets a domain's logo from the CLI with an SVG file's text, and the record it needs comes back, with the URL Duva serves it at", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0b5fff"/></svg>';

  const set = await machine.duva("domains", "set-logo", "--domain", "example.com", "--svg", svg);
  const picture = await machine.duva("domains", "set-logo", "--domain", "example.com", "--svg", "GIF89a");

  const { logo, record } = JSON.parse(set.stdout) as { logo: { url: string }; record: { name: string; value: string; status: string } };
  expect(record).toEqual({ name: "default._bimi.example.com", value: `v=BIMI1; l=${logo.url};`, status: "missing" });
  expect((await duva.download(logo.url)).headers.get("content-type")).toBe("image/svg+xml");
  expect(picture.exitCode).toBe(1);
  expect(errorIn(picture.stderr)).toMatch(/isn't an SVG file/);
});

test("agents list shows the agents the signed-in human sponsors", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const { agent } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: object };

  const result = await machine.duva("agents", "list");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ agents: [{ ...agent, sendsLeftThisHour: 100 }] });
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

  const expected = { sponsorAccess: "read", sponsorMailboxes: null, approvalForOwnMailbox: true, approvalAsSponsor: false, disclosureLineForOwnMailbox: true, disclosureLineAsSponsor: true, sendsPerHour: 100, newRecipientsPerDay: 50, approvalForSetup: true };
  expect(refused.exitCode).toBe(1);
  expect(errorIn(refused.stderr)).toMatch(/403.*Ask them for read access/);
  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout)).toEqual(expected);
  expect(JSON.parse(settings.stdout)).toEqual(expected);
  expect(JSON.parse(mailboxes.stdout)).toEqual({ mailboxes: [{ ...mailbox, groups: [], sponsorAccess: "read" }] });
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

test("an agent asks for access with login --agent, the human approves the code it prints, and every command then acts as the agent", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  const ada = duva.signIn("ada@example.org");
  const { data: adaActor } = await ada.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: adaActor!.id, address: "ada@example.com" } });
  await ada.POST("/mailboxes", { body: { owner: adaActor!.id, address: "ada.home@example.com" } });

  const login = machine.start("login", "--agent", "--name", "Hermes", "--mailbox", "ada@example.com", "--wants", "organize");
  const [, link, code] = await login.stderrMatching(/open (\S+) and approve the code (\S+)\. It works until /);
  const { data: request } = await ada.GET("/access-requests/{code}", { params: { path: { code: code! } } });
  await ada.POST("/access-requests/{code}/approve", { params: { path: { code: code! } } });
  const result = await login.done;
  const mailboxes = await machine.duva("mailboxes", "list");

  expect(link).toBe(`${machine.webUrl}/#/access/${code}`);
  expect(request).toMatchObject({ name: "Hermes", from: { host: expect.any(String) }, wants: "organize" });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ signedIn: { id: expect.any(String), kind: "agent", name: "Hermes", sponsor: adaActor!.id, admin: false } });
  expect(JSON.parse(mailboxes.stdout)).toEqual({ mailboxes: [{ ...mailbox, groups: [], sponsorAccess: "organize" }] });
});

test("login --agent says so when the human declines, and saves no key", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const login = machine.start("login", "--agent");
  const [, code] = await login.stderrMatching(/approve the code (\S+)\./);
  await duva.signIn("ada@example.org").POST("/access-requests/{code}/decline", { params: { path: { code: code! } } });
  const result = await login.done;
  const whoami = await machine.duva("whoami");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toBe(`The human declined the access request ${code}. Ask them why before asking again.`);
  expect(errorIn(whoami.stderr)).toMatch(/duva login/);
});

test("once the agent's sponsor removes it, a command with the key login --agent saved says to ask for access again", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  const ada = duva.signIn("ada@example.org");
  const login = machine.start("login", "--agent");
  const [, code] = await login.stderrMatching(/approve the code (\S+)\./);
  const { data: agent } = await ada.POST("/access-requests/{code}/approve", { params: { path: { code: code! } } });
  await login.done;

  await ada.DELETE("/agents/{agent}", { params: { path: { agent: agent!.id } } });
  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/login --agent/);
});

test("login takes --name, --mailbox and --wants only with --agent", async () => {
  const machine = await newMachine();

  const result = await machine.duva("login", "--name", "Hermes");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/--agent/);
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
  expect(mailbox).toEqual({ id: expect.any(String), kind: "personal", owner: agent.id, defaultAddress: "hermes@example.com", addresses: ["hermes@example.com"] });
  expect(JSON.parse(mailboxes.stdout)).toEqual({ mailboxes: [{ ...mailbox, groups: [] }] });
  expect(JSON.parse(changes.stdout)).toEqual({ changes: [{ position: 1, at: expect.any(String), type: "messageReceived", thread, message: expect.any(String) }], position: 1 });
  expect(JSON.parse(threads.stdout)).toMatchObject({ threads: [{ id: thread, subject: "Hello", labels: ["inbox"] }] });
  expect(read.exitCode).toBe(0);
  expect(JSON.parse(read.stdout)).toMatchObject({
    id: thread,
    messages: [{ from: { name: "Grace", address: "grace@example.org" }, recipient: "hermes+cli@example.com", plusTag: "cli", text: "Hi Hermes." }],
  });
});

test("an agent sets a thread aside in its sponsor's Remind me with a preset, lists Remind me, changes the time and cancels it", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const ada = (JSON.parse((await machine.duva("whoami")).stdout) as { id: string }).id;
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", ada, "--address", "ada@example.com")).stdout) as { id: string };
  await machine.duva("agents", "change-settings", "--agent", agent.id, "--sponsorAccess", "send");
  await machine.duva("screener", "switch", "--mailbox", mailbox.id, "--no-on");
  await duva.receive("From: Grace <grace@example.org>\r\nTo: ada@example.com\r\nSubject: Hello\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\n\r\nHi Ada.\r\n", { to: ["ada@example.com"] });
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const thread = (JSON.parse((await machine.duva("threads", "list", "--mailbox", mailbox.id, asAgent)).stdout) as { threads: { id: string }[] }).threads[0]!.id;
  const later = new Date(Math.ceil(Date.now() / 1000) * 1000 + 3 * 86_400_000).toISOString();

  const set = await machine.duva("threads", "remind", "--mailbox", mailbox.id, "--threads", thread, "--preset", "tomorrowMorning", "--timeZone", "UTC", asAgent);
  const listed = await machine.duva("threads", "reminders", "--mailbox", mailbox.id, asAgent);
  const changed = await machine.duva("threads", "remind", "--mailbox", mailbox.id, "--threads", thread, "--at", later, asAgent);
  const cancelled = await machine.duva("threads", "cancel-reminder", "--mailbox", mailbox.id, "--threads", thread, asAgent);

  expect(set.exitCode).toBe(0);
  expect(JSON.parse(set.stdout)).toMatchObject({ threads: [{ id: thread, labels: [], reminder: { at: expect.stringMatching(/T08:00:00\.000Z$/) } }] });
  expect(JSON.parse(listed.stdout)).toMatchObject({ threads: [{ id: thread, reminder: { at: expect.stringMatching(/T08:00:00\.000Z$/) } }] });
  expect(JSON.parse(changed.stdout)).toMatchObject({ threads: [{ id: thread, reminder: { at: later } }] });
  expect(cancelled.exitCode).toBe(0);
  expect(JSON.parse(cancelled.stdout)).toEqual({ threads: [expect.not.objectContaining({ reminder: expect.anything() })] });
  expect(JSON.parse(cancelled.stdout)).toMatchObject({ threads: [{ id: thread, labels: ["inbox"] }] });
});

test("an agent searches its mailbox, and a search that can't be read says what to do", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  await duva.receive("From: Grace <grace@example.org>\r\nTo: hermes@example.com\r\nSubject: Ferry\r\n\r\nThe ferry leaves at noon.\r\n", { to: ["hermes@example.com"] });
  await duva.receive("From: Linus <linus@example.org>\r\nTo: hermes@example.com\r\nSubject: Lunch\r\n\r\nLunch at noon?\r\n", { to: ["hermes@example.com"] });
  const asAgent = { env: { DUVA_AGENT_KEY: key } };

  const found = await machine.duva("search", "--mailbox", mailbox.id, "--q", "noon from:grace", asAgent);
  const refused = await machine.duva("search", "--mailbox", mailbox.id, "--q", "noon size:large", asAgent);

  expect(found.exitCode).toBe(0);
  expect(JSON.parse(found.stdout)).toMatchObject({
    results: [{ thread: { subject: "Ferry" }, snippet: "The ferry leaves at noon.", highlights: [{ start: 20, end: 24 }] }],
  });
  expect(refused.exitCode).toBe(1);
  expect(errorIn(refused.stderr)).toMatch(/size: isn't a filter/);
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

test("a human sends a waiting sender's mail to the Inbox from the CLI, and switches the Screener off with --no-on", async () => {
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
  const sheet = await machine.duva("senders", "get", "--mailbox", mailbox.id, "--sender", "grace@example.org");
  const letIn = await machine.duva("senders", "set", "--mailbox", mailbox.id, "--sender", "grace@example.org", "--delivery", "inbox");
  const off = await machine.duva("screener", "switch", "--mailbox", mailbox.id, "--no-on");

  expect(JSON.parse(waiting.stdout)).toMatchObject({ on: true, senders: [{ address: "grace@example.org", threads: [{ subject: "Hello", labels: ["screener"] }] }] });
  expect(JSON.parse(sheet.stdout)).toEqual({ address: "grace@example.org", name: "Grace", threads: 1, goesTo: "screener" });
  expect(JSON.parse(letIn.stdout)).toMatchObject({ sender: { address: "grace@example.org", delivery: "inbox", actor: ada }, threads: [{ subject: "Hello", labels: ["inbox"] }] });
  expect(JSON.parse(off.stdout)).toEqual({ on: false, senders: [], decided: 1 });
});

test("a human files a domain's mail in the Paper Trail from the CLI, lists the senders and removes the decision", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { id: ada } = JSON.parse((await machine.duva("whoami")).stdout) as { id: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", ada, "--address", "ada@example.com")).stdout) as { id: string };

  const filed = await machine.duva("senders", "set", "--mailbox", mailbox.id, "--sender", "example.net", "--delivery", "paperTrail");
  const provider = await machine.duva("senders", "set", "--mailbox", mailbox.id, "--sender", "gmail.com", "--delivery", "inbox");
  const listed = await machine.duva("senders", "list", "--mailbox", mailbox.id);
  const removed = await machine.duva("senders", "remove", "--mailbox", mailbox.id, "--sender", "example.net");

  expect(JSON.parse(filed.stdout)).toMatchObject({ sender: { domain: "example.net", delivery: "paperTrail", actor: ada }, threads: [] });
  expect(provider.exitCode).toBe(1);
  expect(errorIn(provider.stderr)).toMatch(/gmail.com is a public mail provider/);
  expect(JSON.parse(listed.stdout)).toEqual({ senders: [{ domain: "example.net", delivery: "paperTrail", decidedAt: expect.any(String), actor: ada }] });
  expect(JSON.parse(removed.stdout)).toMatchObject({ sender: { domain: "example.net", delivery: "paperTrail" }, threads: [] });
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

test("the sponsor undoes an approved send from the CLI during the undo window, and reads each decision in the approval log", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", undoWindow: null });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const draft = JSON.parse((await machine.duva("drafts", "create", "--mailbox", mailbox.id, "--to", "grace@example.org", "--subject", "Hello", "--text", "Hej.", asAgent)).stdout) as { id: string };
  const { send } = JSON.parse((await machine.duva("drafts", "send", "--mailbox", mailbox.id, "--draft", draft.id, asAgent)).stdout) as { send: { approval: string } };

  const approved = await machine.duva("approvals", "send", "--approval", send.approval);
  const logged = await machine.duva("approvals", "log");
  const undone = await machine.duva("approvals", "undo", "--approval", send.approval);
  const again = await machine.duva("approvals", "undo", "--approval", send.approval);

  expect(JSON.parse(approved.stdout)).toMatchObject({ state: "approved", undoUntil: expect.any(String) });
  expect(JSON.parse(logged.stdout)).toMatchObject({ entries: [{ approval: send.approval, agentName: "Hermes", outcome: "approved", reversal: "undo" }] });
  expect(undone.exitCode).toBe(0);
  expect(JSON.parse(undone.stdout)).toMatchObject({ id: send.approval, state: "pending" });
  expect(again.exitCode).toBe(1);
  expect(errorIn(again.stderr)).toMatch(/409.*can't be undone/);
  expect(JSON.parse((await machine.duva("approvals", "log")).stdout)).toEqual({ entries: [] });
  expect(duva.sent()).toEqual([]);
});

test("an admin sets the undo window from the CLI, and a sponsor sends a rejected draft after all", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", undoWindow: null });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.org" });
  const { agent, key } = JSON.parse((await machine.duva("agents", "create", "--name", "Hermes")).stdout) as { agent: { id: string }; key: string };
  const mailbox = JSON.parse((await machine.duva("mailboxes", "create", "--owner", agent.id, "--address", "hermes@example.com")).stdout) as { id: string };
  const asAgent = { env: { DUVA_AGENT_KEY: key } };
  const draft = JSON.parse((await machine.duva("drafts", "create", "--mailbox", mailbox.id, "--to", "grace@example.org", "--subject", "Hello", "--text", "Hej.", asAgent)).stdout) as { id: string };
  const { send } = JSON.parse((await machine.duva("drafts", "send", "--mailbox", mailbox.id, "--draft", draft.id, asAgent)).stdout) as { send: { approval: string } };

  const changed = await machine.duva("organization", "change-settings", "--undoWindowSeconds", "0");
  await machine.duva("approvals", "reject", "--approval", send.approval, "--note", "Not yet.");
  const afterAll = await machine.duva("approvals", "send", "--approval", send.approval);

  expect(JSON.parse(changed.stdout)).toMatchObject({ undoWindowSeconds: 0 });
  expect(afterAll.exitCode).toBe(0);
  expect(JSON.parse(afterAll.stdout)).toMatchObject({ id: send.approval, state: "approved" });
  expect(duva.sent()).toHaveLength(1);
  expect(JSON.parse((await machine.duva("approvals", "log")).stdout)).toMatchObject({ entries: [{ approval: send.approval, outcome: "sent", reversal: "correction" }] });
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
      return run(words, env).done;
    },
    /** Starts duva, and lets the test read its stderr while it runs. */
    start(...args: string[]) {
      return run(args, { PATH: process.env.PATH ?? "", HOME: home });
    },
    /** The web app's URL that saveDeployment saves. */
    webUrl: "https://web.example.com",
    /**
     * Saves a deployment in the CLI's config, as duva deploy does: its API, and its managed login
     * with a loopback redirect on a free port.
     */
    async saveDeployment(server: { url: string; signIn: { url: string; clientId: string } }) {
      redirectUri = `http://127.0.0.1:${await freePort()}/callback`;
      await mkdir(join(home, ".config", "duva"), { recursive: true });
      await writeFile(
        join(home, ".config", "duva", "config.json"),
        JSON.stringify({ apiUrl: server.url, webUrl: "https://web.example.com", signIn: { ...server.signIn, redirectUri } }),
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

/**
 * Runs duva. `done` settles once it exits, and `stderrMatching` once what it wrote to stderr so far
 * matches, with the match.
 */
function run(args: string[], env: Record<string, string>) {
  // The machine's working directory is its home.
  const child = spawn(bun, [main, ...args], { env, cwd: env.HOME });
  let stdout = "";
  let stderr = "";
  const written: (() => void)[] = [];
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    for (const heard of written) heard();
  });
  const done = new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
  onTestFinished(() => void child.kill());
  return {
    done,
    stderrMatching: (pattern: RegExp) =>
      new Promise<RegExpExecArray>((resolve, reject) => {
        const heard = () => {
          const match = pattern.exec(stderr);
          if (match !== null) resolve(match);
        };
        written.push(heard);
        heard();
        void done.then(() => reject(new Error(`duva exited without writing ${pattern} to stderr: ${stderr}`)));
      }),
  };
}

/** The message of the error the CLI printed as JSON on stderr. */
function errorIn(stderr: string): string {
  const lastLine = stderr.trim().split("\n").at(-1) ?? "";
  return (JSON.parse(lastLine) as { error: string }).error;
}
