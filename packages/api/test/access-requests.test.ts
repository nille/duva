import { expect, test } from "vitest";
import type { components } from "@duva/openapi";
import { startDuva } from "./harness.ts";

/**
 * A deployment on example.com where Ada is the first admin and Linus another human, with two
 * personal mailboxes, linus@example.com and linus.work@example.com. Grace has her own at
 * grace@example.com. An agent that has no key yet calls without sign-in.
 */
async function withHumans() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: home } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const { data: work } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus.work@example.com" } });
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  return { duva, ada, linus, linusId: linusActor!.id, grace, home: home!, work: work!, graceMailbox: graceMailbox! };
}

type Fixture = Awaited<ReturnType<typeof withHumans>>;

/** The agent asks for access, as duva login --agent does, and gets its code and device code. */
async function ask({ duva }: Fixture, body: Record<string, unknown> = { name: "Hermes", host: "build-box", mailboxes: ["linus.work@example.com"], wants: "draft" }) {
  const { response, data } = await duva.client.POST("/access-requests", { body });
  expect(response.status).toBe(201);
  return data!;
}

const inCode = (code: string) => ({ params: { path: { code } } });

/** The agent and its key, which the agent collects once the human approved its request. */
async function collected({ duva }: Fixture, deviceCode: string) {
  const { response, data } = await duva.client.POST("/access-requests/collect", { body: { deviceCode } });
  expect(response.status).toBe(200);
  return data as components["schemas"]["AgentWithKey"];
}

test("an agent asks for access without sign-in, and the human reads its request by the code: its name, where it asked from, their mailboxes and what it asks", async () => {
  const fixture = await withHumans();
  const { linus, home, work } = fixture;

  const asked = await ask(fixture);

  expect(asked).toEqual({ code: expect.stringMatching(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/), deviceCode: expect.any(String), expiresAt: expect.any(String), interval: 5 });
  expect(Date.parse(asked.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
  expect(Date.parse(asked.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  const { response, data } = await linus.GET("/access-requests/{code}", inCode(asked.code));
  expect(response.status).toBe(200);
  expect(data).toEqual({
    code: asked.code,
    name: "Hermes",
    from: { address: "127.0.0.1", host: "build-box" },
    wants: "draft",
    mailboxes: expect.arrayContaining([
      { mailbox: home, asked: false },
      { mailbox: work, asked: true },
    ]),
    expiresAt: asked.expiresAt,
  });
  expect(data!.mailboxes).toHaveLength(2);
});

test("an agent that names no mailbox asks for every mailbox of the human, read only, named for its host, and approving covers each one they get later too", async () => {
  const fixture = await withHumans();
  const { duva, ada, linus, linusId } = fixture;

  const asked = await ask(fixture, { host: "build-box" });

  const { data } = await linus.GET("/access-requests/{code}", inCode(asked.code));
  expect(data).toMatchObject({ name: "build-box", wants: "read" });
  expect(data!.mailboxes.map(({ asked }) => asked)).toEqual([true, true]);
  const { data: agent } = await linus.POST("/access-requests/{code}/approve", inCode(asked.code));
  expect((await linus.GET("/agents/{agent}/settings", { params: { path: { agent: agent!.id } } })).data).toMatchObject({ sponsorAccess: "read", sponsorMailboxes: null });
  const { data: later } = await ada.POST("/mailboxes", { body: { owner: linusId, address: "linus.later@example.com" } });
  const key = await collected(fixture, asked.deviceCode);
  expect((await duva.withKey(key.key).GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: later!.id } } })).response.status).toBe(200);
});

test("approving makes the human the agent's sponsor with the access it asked for, and the agent collects its key once and works in that mailbox only", async () => {
  const fixture = await withHumans();
  const { duva, linus, linusId, home, work, graceMailbox } = fixture;
  const asked = await ask(fixture);
  const collect = () => duva.client.POST("/access-requests/collect", { body: { deviceCode: asked.deviceCode } });
  const waiting = await collect();
  expect(waiting.response.status).toBe(202);

  const { response, data: agent } = await linus.POST("/access-requests/{code}/approve", inCode(asked.code));

  expect(response.status).toBe(201);
  expect(agent).toEqual({ id: expect.any(String), kind: "agent", name: "Hermes", sponsor: linusId, admin: false });
  expect((await linus.GET("/agents")).data!.agents.filter(({ mailbox }) => mailbox === undefined)).toEqual([expect.objectContaining({ id: agent!.id, name: "Hermes" })]);
  expect((await linus.GET("/agents/{agent}/settings", { params: { path: { agent: agent!.id } } })).data).toMatchObject({
    sponsorAccess: "draft",
    sponsorMailboxes: [work.id],
    approvalAsSponsor: true,
    disclosureLineAsSponsor: true,
  });
  const key = await collected(fixture, asked.deviceCode);
  expect(key).toEqual({ agent, key: expect.stringMatching(/^duva_agent_/) });
  const hermes = duva.withKey(key.key);
  expect((await hermes.GET("/whoami")).data).toEqual(agent);
  expect((await hermes.GET("/mailboxes")).data!.mailboxes).toEqual([{ ...work, groups: [], sponsorAccess: "draft" }]);
  expect((await hermes.POST("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: work.id } }, body: { to: ["grace@example.com"] } })).response.status).toBe(201);
  for (const mailbox of [home, graceMailbox]) {
    expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id } } })).response.status).toBe(403);
  }
  const again = await collect();
  expect(again.response.status).toBe(404);
  expect(again.error).toEqual({ message: `The key for the access request ${asked.code} was collected already. Ask your sponsor to rotate your key if you lost it.` });
});

test("the human adjusts what the agent asked for before approving: its name, its access, the mailboxes and the switches for its sends", async () => {
  const fixture = await withHumans();
  const { duva, linus, home, work } = fixture;
  const asked = await ask(fixture);

  const { data: agent } = await linus.POST("/access-requests/{code}/approve", {
    ...inCode(asked.code),
    body: { name: "Hermes at work", sponsorAccess: "send", sponsorMailboxes: [home.id, work.id], approvalAsSponsor: false, disclosureLineAsSponsor: false },
  });

  expect(agent!.name).toBe("Hermes at work");
  expect((await linus.GET("/agents/{agent}/settings", { params: { path: { agent: agent!.id } } })).data).toMatchObject({
    sponsorAccess: "send",
    sponsorMailboxes: [home.id, work.id],
    approvalAsSponsor: false,
    disclosureLineAsSponsor: false,
  });
  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: home.id } } });
  expect(feed!.changes.at(-1)).toMatchObject({ type: "agentSettingsChanged", agent: agent!.id, after: { sponsorAccess: "send", approvalAsSponsor: false, disclosureLineAsSponsor: false } });
  const key = await collected(fixture, asked.deviceCode);
  expect((await duva.withKey(key.key).GET("/mailboxes")).data!.mailboxes).toHaveLength(2);
});

test("approving with no mailbox gives the agent no access", async () => {
  const fixture = await withHumans();
  const { duva, linus } = fixture;
  const asked = await ask(fixture);

  const { data: agent } = await linus.POST("/access-requests/{code}/approve", { ...inCode(asked.code), body: { sponsorMailboxes: [] } });

  const key = await collected(fixture, asked.deviceCode);
  expect(key.agent).toEqual(agent);
  expect((await duva.withKey(key.key).GET("/mailboxes")).data!.mailboxes).toEqual([]);
});

test("approving names only the human's own mailboxes, so another's gets 400 and creates no agent", async () => {
  const fixture = await withHumans();
  const { linus, graceMailbox } = fixture;
  const asked = await ask(fixture);

  const { response, error } = await linus.POST("/access-requests/{code}/approve", { ...inCode(asked.code), body: { sponsorMailboxes: [graceMailbox.id] } });

  expect(response.status).toBe(400);
  expect(error).toEqual({ message: `${JSON.stringify(graceMailbox.id)} isn't one of your mailboxes. List your mailboxes to find their IDs.` });
  expect((await linus.GET("/agents")).data!.agents.filter(({ mailbox }) => mailbox === undefined)).toEqual([]);
  expect((await linus.GET("/access-requests/{code}", inCode(asked.code))).response.status).toBe(200);
});

test("a declined request gives the agent no key, and can't be approved after", async () => {
  const fixture = await withHumans();
  const { duva, linus } = fixture;
  const asked = await ask(fixture);

  const { response, data } = await linus.POST("/access-requests/{code}/decline", inCode(asked.code));

  expect(response.status).toBe(200);
  expect(data).toEqual({ code: asked.code });
  const refused = await duva.client.POST("/access-requests/collect", { body: { deviceCode: asked.deviceCode } });
  expect(refused.response.status).toBe(403);
  expect(refused.error).toEqual({ message: `The human declined the access request ${asked.code}. Ask them why before asking again.` });
  expect((await linus.POST("/access-requests/{code}/approve", inCode(asked.code))).response.status).toBe(404);
  expect((await linus.GET("/agents")).data!.agents.filter(({ mailbox }) => mailbox === undefined)).toEqual([]);
});

test("a code is approved once, so a second human approving it gets 404", async () => {
  const fixture = await withHumans();
  const { linus, grace } = fixture;
  const asked = await ask(fixture);
  await linus.POST("/access-requests/{code}/approve", inCode(asked.code));

  const { response, error } = await grace.POST("/access-requests/{code}/approve", inCode(asked.code));

  expect(response.status).toBe(404);
  expect(error).toEqual({ message: `No access request waits with the code "${asked.code}". A code works for 10 minutes and once. Ask the agent to ask again.` });
  expect((await grace.GET("/agents")).data!.agents.filter(({ mailbox }) => mailbox === undefined)).toEqual([]);
});

test("a code expires 10 minutes after the agent asked, and then neither shows nor gives a key", async () => {
  const fixture = await withHumans();
  const { duva, linus } = fixture;
  const asked = await ask(fixture);

  await duva.clock(new Date(Date.parse(asked.expiresAt) + 1000));

  expect((await linus.GET("/access-requests/{code}", inCode(asked.code))).response.status).toBe(404);
  expect((await linus.POST("/access-requests/{code}/approve", inCode(asked.code))).response.status).toBe(404);
  const refused = await duva.client.POST("/access-requests/collect", { body: { deviceCode: asked.deviceCode } });
  expect(refused.response.status).toBe(404);
  expect(refused.error).toEqual({ message: `The code ${asked.code} expired before anyone approved it. Ask for access again with duva login --agent.` });
});

test("a code reads in any case, with or without its dash", async () => {
  const fixture = await withHumans();
  const asked = await ask(fixture);

  for (const code of [asked.code.toLowerCase(), asked.code.replace("-", "")]) {
    expect((await fixture.linus.GET("/access-requests/{code}", inCode(code))).data!.code).toBe(asked.code);
  }
});

test("collecting with a device code that isn't the request's gets 404", async () => {
  const fixture = await withHumans();
  const { duva, linus } = fixture;
  const asked = await ask(fixture);
  await linus.POST("/access-requests/{code}/approve", inCode(asked.code));
  const [code] = asked.deviceCode.split(".");

  for (const deviceCode of [`${code}.guessed`, "nothing"]) {
    const { response, error } = await duva.client.POST("/access-requests/collect", { body: { deviceCode } });
    expect(response.status).toBe(404);
    expect(error).toEqual({ message: "No access request has this device code. Ask for access again with duva login --agent." });
  }
});

test("only humans read, approve and decline access requests, never an agent, and not without sign-in", async () => {
  const fixture = await withHumans();
  const { duva, linus } = fixture;
  const { data: created } = await linus.POST("/agents", { body: { name: "Iris" } });
  const iris = duva.withKey(created!.key);
  const asked = await ask(fixture);

  for (const call of [
    () => iris.GET("/access-requests/{code}", inCode(asked.code)),
    () => iris.POST("/access-requests/{code}/approve", inCode(asked.code)),
    () => iris.POST("/access-requests/{code}/decline", inCode(asked.code)),
  ]) {
    const { response, error } = await call();
    expect(response.status).toBe(403);
    expect(error).toEqual({ message: "Only humans approve access requests, and an agent never does. Ask the human who will be its sponsor." });
  }
  expect((await duva.client.GET("/access-requests/{code}", inCode(asked.code))).response.status).toBe(401);
  expect((await linus.GET("/access-requests/{code}", inCode(asked.code))).response.status).toBe(200);
});

test("a human who gives 10 codes no request waits with is refused every code for 10 minutes, so codes can't be guessed", async () => {
  const fixture = await withHumans();
  const { duva, linus, grace } = fixture;
  const asked = await ask(fixture);
  for (let guess = 0; guess < 10; guess++) expect((await linus.GET("/access-requests/{code}", inCode("BBBB-BBBB"))).response.status).toBe(404);

  const { response, error } = await linus.GET("/access-requests/{code}", inCode(asked.code));

  expect(response.status).toBe(429);
  expect(error).toEqual({ message: "You gave 10 codes no access request waits with in the last 10 minutes. Wait 10 minutes and try again." });
  expect((await linus.POST("/access-requests/{code}/approve", inCode(asked.code))).response.status).toBe(429);
  expect((await grace.GET("/access-requests/{code}", inCode(asked.code))).response.status).toBe(200);
  await duva.clock(new Date(Date.now() + 10 * 60_000));
  const later = await ask(fixture);
  expect((await linus.GET("/access-requests/{code}", inCode(later.code))).response.status).toBe(200);
});

test("an address asks for at most 10 codes in 10 minutes", async () => {
  const fixture = await withHumans();
  const { duva } = fixture;
  for (let asked = 0; asked < 10; asked++) await ask(fixture);

  const { response, error } = await duva.client.POST("/access-requests", { body: { name: "Hermes" } });

  expect(response.status).toBe(429);
  expect(error).toEqual({ message: "Your address asked for 10 codes in the last 10 minutes. Wait 10 minutes and ask again." });
  await duva.clock(new Date(Date.now() + 10 * 60_000));
  await ask(fixture);
});

test.each([
  ["a name too long", { name: "x".repeat(65) }, "Give the agent a name of 1 to 64 characters."],
  ["mailboxes that aren't addresses", { mailboxes: ["work"] }, "Give mailboxes as the addresses of up to 20 mailboxes the agent asks for."],
  ["access there isn't", { wants: "full" }, "Give wants as read, organize, draft or send."],
  ["something an access request doesn't have", { admin: true }, 'An access request has no "admin". Give name, host, mailboxes and wants.'],
])("asking for access with %s gets 400", async (_, body, message) => {
  const { duva } = await withHumans();

  const { response, error } = await duva.client.POST("/access-requests", { body: body as never });

  expect(response.status).toBe(400);
  expect(error).toEqual({ message });
});

test("removing an agent approved through an access request refuses its key at once", async () => {
  const fixture = await withHumans();
  const { duva, linus } = fixture;
  const asked = await ask(fixture);
  const { data: agent } = await linus.POST("/access-requests/{code}/approve", inCode(asked.code));
  const key = await collected(fixture, asked.deviceCode);

  await linus.DELETE("/agents/{agent}", { params: { path: { agent: agent!.id } } });

  expect((await duva.withKey(key.key).GET("/whoami")).response.status).toBe(401);
});

test("an agent its sponsor removes or rotates before it collects its key gets none", async () => {
  const fixture = await withHumans();
  const { duva, linus } = fixture;
  const removed = await ask(fixture);
  const rotated = await ask(fixture);
  const { data: first } = await linus.POST("/access-requests/{code}/approve", inCode(removed.code));
  const { data: second } = await linus.POST("/access-requests/{code}/approve", inCode(rotated.code));
  await linus.DELETE("/agents/{agent}", { params: { path: { agent: first!.id } } });
  const { data: key } = await linus.POST("/agents/{agent}/key", { params: { path: { agent: second!.id } } });

  for (const { deviceCode } of [removed, rotated]) {
    expect((await duva.client.POST("/access-requests/collect", { body: { deviceCode } })).response.status).toBe(404);
  }
  expect((await duva.withKey(key!.key).GET("/whoami")).data).toEqual(second);
});
