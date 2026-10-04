import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A fixture in test/mail, as the sender's server sends it. */
const mail = (name: string) => readFile(new URL(`mail/${name}.eml`, import.meta.url));

/**
 * A deployment on example.com where ada, the first admin, added the human Linus and created his
 * personal mailbox at linus@example.com. Grace is another human.
 */
async function withHumansMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const { data: human } = await ada.POST("/humans", { body: { email: "linus@example.org" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: human!.id, address: "linus@example.com" } });
  const linus = duva.signIn("linus@example.org");
  return { duva, ada, linus, mailbox: mailbox!, params: { path: { mailbox: mailbox!.id } } };
}

test("an admin adds a human by email address, and the human can sign in", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });

  const { response, data } = await duva.signIn("ada@example.org").POST("/humans", { body: { email: "grace@example.org" } });

  expect(response.status).toBe(201);
  expect(data).toEqual({ id: expect.any(String), kind: "human", email: "grace@example.org", admin: false });
  expect((await duva.signIn("grace@example.org").GET("/whoami")).data).toEqual(data);
});

test("a new human has no mailbox until an admin creates one", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  await duva.signIn("ada@example.org").POST("/humans", { body: { email: "grace@example.org" } });

  const { data } = await duva.signIn("grace@example.org").GET("/mailboxes");

  expect(data).toEqual({ mailboxes: [] });
});

test("a human's email address is kept in lower case", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });

  const { data } = await duva.signIn("ada@example.org").POST("/humans", { body: { email: " Grace@Example.ORG " } });

  expect(data?.email).toBe("grace@example.org");
});

test("only an admin can add a human", async () => {
  const duva = await startDuva({ admin: "ada@example.org", humans: ["grace@example.org"] });
  const { data: agent } = await duva.signIn("ada@example.org").POST("/agents", { body: { name: "Hermes" } });

  const byHuman = await duva.signIn("grace@example.org").POST("/humans", { body: { email: "alan@example.org" } });
  const byAgent = await duva.withKey(agent!.key).POST("/humans", { body: { email: "alan@example.org" } });

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
});

test("adding a human who is already in the organization is refused", async () => {
  const duva = await startDuva({ admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");

  const again = await ada.POST("/humans", { body: { email: "GRACE@example.org" } });
  const admin = await ada.POST("/humans", { body: { email: "ada@example.org" } });

  expect(again.response.status).toBe(409);
  expect(again.error?.message).toMatch(/grace@example.org is already a human/);
  expect(admin.response.status).toBe(409);
  expect((await ada.GET("/humans")).data?.humans).toHaveLength(2);
});

test("an address that differs from a human's only in case is refused", async () => {
  const duva = await startDuva({ admin: "Ada@example.org" });

  const { response } = await duva.signIn("Ada@example.org").POST("/humans", { body: { email: "ada@example.org" } });

  expect(response.status).toBe(409);
});

test.each([
  ["with no @", "grace"],
  ["with no local part", "@example.org"],
  ["with no domain", "grace@"],
  ["with a space", "gr ace@example.org"],
  ["that is empty", ""],
])("an email address %s is refused", async (_, email) => {
  const duva = await startDuva({ admin: "ada@example.org" });

  const { response, error } = await duva.signIn("ada@example.org").POST("/humans", { body: { email } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/email address/);
});

test("adding a human is in the change feed, attributed to the admin", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: admin } = await ada.GET("/whoami");
  const { data: before } = await ada.GET("/organization/changes");

  const { data: grace } = await ada.POST("/humans", { body: { email: "grace@example.org" } });

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(data?.changes).toEqual([{ position: before!.position + 1, at: expect.any(String), actor: admin?.id, type: "actorAdded", added: grace }]);
});

test("an admin lists the organization's humans, the first admin included", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: admin } = await ada.GET("/whoami");
  const { data: grace } = await ada.POST("/humans", { body: { email: "grace@example.org" } });
  await ada.POST("/agents", { body: { name: "Hermes" } });

  const { response, data } = await ada.GET("/humans");

  expect(response.status).toBe(200);
  expect(data?.humans).toHaveLength(2);
  expect(data?.humans).toEqual(expect.arrayContaining([admin, grace]));
});

test("only an admin can list the organization's humans", async () => {
  const duva = await startDuva({ admin: "ada@example.org", humans: ["grace@example.org"] });

  const { data: agent } = await duva.signIn("ada@example.org").POST("/agents", { body: { name: "Hermes" } });

  const { response, error } = await duva.signIn("grace@example.org").GET("/humans");
  const byAgent = await duva.withKey(agent!.key).GET("/humans");

  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
});

test("setting the organization up again keeps its humans listed", async () => {
  const duva = await startDuva({ admin: "ada@example.org", humans: ["grace@example.org"] });

  await duva.setUp({ admin: "ada@example.org" });

  expect((await duva.signIn("ada@example.org").GET("/humans")).data?.humans).toHaveLength(2);
});

// Until the Screener exists, mail to a human reaches their Inbox at once (spec #22).
test("mail to a human's address, plus-tagged too, lands in their Inbox, and they read it", async () => {
  const { duva, linus, params } = await withHumansMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["linus@example.com"] });
  await duva.receive(await mail("plus-tagged"), { to: ["Linus+News@example.com"] });

  expect(refused).toEqual([]);
  expect(duva.receiptRules()[0]?.Recipients).toEqual(["linus@example.com"]);
  const { data } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  expect(data?.threads.map(({ subject, labels }) => ({ subject, labels }))).toEqual([
    { subject: "October news", labels: ["inbox"] },
    { subject: "Compiler notes", labels: ["inbox"] },
  ]);
  const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: data!.threads[0]!.id } } });
  expect(thread?.messages).toMatchObject([{ recipient: "linus+News@example.com", plusTag: "News", text: expect.stringContaining("What happened in October") }]);
});

test("a human catches up on their mailbox's change feed", async () => {
  const { duva, linus, params } = await withHumansMailbox();
  await duva.receive(await mail("plain"), { to: ["linus@example.com"] });

  const { data } = await linus.GET("/mailboxes/{mailbox}/changes", { params });

  expect(data?.changes).toEqual([{ position: 1, at: expect.any(String), type: "messageReceived", thread: expect.any(String), message: expect.any(String) }]);
});

test("a reply to mail in a human's mailbox joins its thread", async () => {
  const { duva, linus, params } = await withHumansMailbox();
  await duva.receive(await mail("plain"), { to: ["linus@example.com"] });

  await duva.receive(await mail("reply"), { to: ["linus@example.com"] });

  const { data } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  expect(data?.threads.map(({ subject, messages }) => ({ subject, messages }))).toEqual([{ subject: "Compiler notes", messages: 2 }]);
});

test("spam to a human is kept under the Spam label, and mail carrying a virus or failing a reject DMARC policy is dropped", async () => {
  const { duva, linus, params } = await withHumansMailbox();

  await duva.receive(await mail("plain"), { to: ["linus@example.com"] }, { verdicts: { spam: "FAIL" } });
  await duva.receive(await mail("attachment"), { to: ["linus@example.com"] }, { verdicts: { virus: "FAIL" } });
  await duva.receive(await mail("html-only"), { to: ["linus@example.com"] }, { verdicts: { dmarc: "FAIL", dmarcPolicy: "reject" } });

  const inbox = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  const spam = await linus.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "spam" } } });
  expect(inbox.data?.threads).toEqual([]);
  expect(spam.data?.threads.map(({ subject }) => subject)).toEqual(["Compiler notes"]);
});

test("only the human reads their mailbox: the admin who created it, other humans and agents get 403", async () => {
  const { duva, ada, mailbox, params } = await withHumansMailbox();
  await duva.receive(await mail("plain"), { to: ["linus@example.com"] });
  const thread = (await duva.signIn("linus@example.org").GET("/mailboxes/{mailbox}/threads", { params })).data!.threads[0]!.id;
  const { data: agent } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: agent!.agent.id, address: "hermes@example.com" } });

  for (const outsider of [ada, duva.signIn("grace@example.org"), duva.withKey(agent!.key)]) {
    const changes = await outsider.GET("/mailboxes/{mailbox}/changes", { params });
    const threads = await outsider.GET("/mailboxes/{mailbox}/threads", { params });
    const read = await outsider.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: mailbox.id, thread } } });
    expect([changes, threads, read].map(({ response }) => response.status)).toEqual([403, 403, 403]);
  }
  expect((await ada.GET("/mailboxes")).data?.mailboxes.map(({ id }) => id)).not.toContain(mailbox.id);
});
