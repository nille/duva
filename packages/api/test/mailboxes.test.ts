import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A deployment on example.com where ada is the first admin and grace sponsors the agent Hermes. */
async function withAgent(options: Parameters<typeof startDuva>[0] = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data } = await grace.POST("/agents", { body: { name: "Hermes" } });
  return { duva, ada, grace, graceId: me!.id, hermes: data!.agent, key: data!.key };
}

test("an admin creates a personal mailbox for a human, and its address becomes the default address", async () => {
  const { ada, graceId } = await withAgent();

  const { response, data } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });

  expect(response.status).toBe(201);
  expect(data).toEqual({ id: expect.any(String), kind: "personal", owner: graceId, defaultAddress: "grace@example.com", addresses: ["grace@example.com"] });
});

test("an admin can't create a mailbox for an agent, since agents own none", async () => {
  const { ada, hermes } = await withAgent();

  const { response, error } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });

  expect(response.status).toBe(400);
  expect(error?.message).toBe("Agents own no mailboxes. Give the ID of a human, and have them give the agent sponsor access to theirs.");
  expect((await ada.GET("/organization/mailboxes")).data!.mailboxes).toEqual([]);
});

test("an address is kept in lower case", async () => {
  const { ada, graceId } = await withAgent();

  const { data } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "Grace@Example.COM" } });

  expect(data).toMatchObject({ defaultAddress: "grace@example.com" });
});

test("only an admin can create a mailbox", async () => {
  const { duva, grace, graceId, key } = await withAgent();

  const byHuman = await grace.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });
  const byAgent = await duva.withKey(key).POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
  expect(byAgent.error?.message).toMatch(/admin/);
});

test("a taken address is refused", async () => {
  const { ada, graceId } = await withAgent();
  const { data: admin } = await ada.GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });

  const { response, error } = await ada.POST("/mailboxes", { body: { owner: admin!.id, address: "GRACE@example.com" } });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/grace@example.com is taken/);
});

test.each([
  ["on another domain", "grace@example.net"],
  ["with a plus tag", "grace+news@example.com"],
  ["with no local part", "@example.com"],
  ["that isn't an address", "grace"],
  ["with a space", "gra ce@example.com"],
])("an address %s is refused", async (_, address) => {
  const { ada, graceId } = await withAgent();

  const { response, error } = await ada.POST("/mailboxes", { body: { owner: graceId, address } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/address/);
});

test("a mailbox's owner must be a human in the organization", async () => {
  const { ada } = await withAgent();

  const { response, error } = await ada.POST("/mailboxes", { body: { owner: "nobody", address: "nobody@example.com" } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/no human "nobody"/);
});

test("creating a mailbox and its address are in the change feed, attributed to the admin, before its mailbox agent and its address", async () => {
  const { ada, graceId } = await withAgent();
  const { data: admin } = await ada.GET("/whoami");
  const { data: before } = await ada.GET("/organization/changes");

  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(data?.changes).toEqual([
    { position: before!.position + 1, at: expect.any(String), actor: admin?.id, type: "mailboxAdded", mailbox },
    { position: before!.position + 2, at: expect.any(String), actor: admin?.id, type: "addressAdded", address: "grace@example.com", mailbox: mailbox?.id },
    expect.objectContaining({ type: "actorAdded", added: expect.objectContaining({ kind: "agent", mailboxAgent: true }) }),
    // Duva gives the mailbox agent its address (ADR-0040).
    { position: before!.position + 4, at: expect.any(String), actor: "duva", type: "cooAddressChanged", human: graceId, address: "grace-coo@example.com" },
  ]);
});

test("a human lists their own mailboxes only, not the admin who created them nor the agent they sponsor without sponsor access", async () => {
  const { duva, ada, grace, graceId, key } = await withAgent();
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });

  const { data } = await grace.GET("/mailboxes");

  expect(data).toEqual({ mailboxes: [{ ...mailbox, groups: [] }] });
  expect((await ada.GET("/mailboxes")).data).toEqual({ mailboxes: [] });
  expect((await duva.withKey(key).GET("/mailboxes")).data).toEqual({ mailboxes: [] });
});

test("the owner reads their mailbox, with how many threads in its Inbox are unread, and so does their agent with read sponsor access", async () => {
  const { duva, ada, grace, graceId, hermes, key } = await withAgent();
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: hermes.id } }, body: { sponsorAccess: "read" } });
  for (const subject of ["One", "Two", "Three"]) {
    await duva.receive(`From: linus@example.org\r\nTo: grace@example.com\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@example.org>\r\n\r\nHej.\r\n`, { to: ["grace@example.com"] });
  }
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params });
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [list!.threads[0]!.id] } });

  const { data, response } = await grace.GET("/mailboxes/{mailbox}", { params });

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...mailbox, groups: [], unread: 2 });
  expect((await duva.withKey(key).GET("/mailboxes/{mailbox}", { params })).data).toEqual({ ...mailbox, groups: [], unread: 2 });
});

test("spam isn't counted among a mailbox's unread threads", async () => {
  const { duva, ada, grace, graceId } = await withAgent();
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await duva.receive("From: linus@example.org\r\nTo: grace@example.com\r\nSubject: Buy\r\n\r\nBuy now.\r\n", { to: ["grace@example.com"] }, { verdicts: { spam: "FAIL" } });

  const { data } = await grace.GET("/mailboxes/{mailbox}", { params });

  expect(data?.unread).toBe(0);
});

test("only those who can read a mailbox can read its unread count, so not even the admin who created it", async () => {
  const { ada, grace, graceId } = await withAgent();
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });

  const { response } = await ada.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox!.id } } });
  const { response: missing } = await grace.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: "nope" } } });

  expect(response.status).toBe(403);
  expect(missing.status).toBe(404);
});

test("an admin lists every mailbox in the organization, with its addresses and its owner, a mailbox without an address included", async () => {
  const { duva, ada, graceId } = await withAgent({ humans: ["grace@example.org", "linus@example.org"] });
  const { data: linus } = await duva.signIn("linus@example.org").GET("/whoami");
  const { data: graces } = await ada.POST("/mailboxes", { body: { owner: graceId, address: "grace@example.com" } });
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: graces!.id } });
  await ada.POST("/mailboxes", { body: { owner: linus!.id, address: "linus@example.com" } });
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "linus@example.com" } } });

  const { response, data } = await ada.GET("/organization/mailboxes");

  expect(response.status).toBe(200);
  const mailboxes = data!.mailboxes.map(({ owner, defaultAddress, addresses }) => ({ owner: data!.owners.find(({ id }) => id === owner), defaultAddress, addresses }));
  expect(mailboxes).toHaveLength(2);
  expect(mailboxes).toEqual(
    expect.arrayContaining([
      { owner: { id: graceId, kind: "human", email: "grace@example.org", admin: false }, defaultAddress: "grace@example.com", addresses: ["grace@example.com", "support@example.com"] },
      { owner: { id: linus!.id, kind: "human", email: "linus@example.org", admin: false }, defaultAddress: undefined, addresses: [] },
    ]),
  );
  expect(data!.mailboxes.find(({ owner }) => owner === graceId)?.id).toBe(graces!.id);
  expect(data!.owners).toHaveLength(2);
});

test("only an admin lists the organization's mailboxes", async () => {
  const { duva, grace, key } = await withAgent();

  const byHuman = await grace.GET("/organization/mailboxes");
  const byAgent = await duva.withKey(key).GET("/organization/mailboxes");

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
});

/** A deployment on example.com whose first admin, Ada, signs in at the address, with her recovery address outside, as duva deploy gives them. */
const withFirstAdmin = (admin: string, options: Parameters<typeof startDuva>[0] = {}) => startDuva({ domain: "example.com", admin, recovery: "ada@elsewhere.org", ...options });

/** The code managed login mails before it registers a passkey, from no-reply@ the sign-in domain, through SES. */
const signInCodeTo = (address: string) =>
  `From: Duva <no-reply@example.com>\r\nTo: ${address}\r\nSubject: Your sign-in code\r\nDate: Tue, 13 Oct 2026 09:00:00 +0000\r\nMessage-ID: <code-1@example.com>\r\n\r\nYour code is 123456.\r\n`;

test("setup gives a first admin who signs in at an address on the organization's domain a mailbox there, as creating one does, and answers deploy with it", async () => {
  const duva = await withFirstAdmin("ada@example.com");
  const ada = duva.signIn("ada@example.com");
  const { data: admin } = await ada.GET("/whoami");
  const { data: before } = await ada.GET("/organization/changes");

  const answer = await duva.setUp({ admin: "ada@example.com" });

  const { data } = await ada.GET("/mailboxes");
  const mailbox = { id: expect.any(String), kind: "personal", owner: admin!.id, defaultAddress: "ada@example.com", addresses: ["ada@example.com"] };
  expect(data?.mailboxes).toEqual([{ ...mailbox, groups: [] }]);
  expect(answer).toMatchObject({ email: "ada@example.com", mailbox: { ...mailbox, id: data!.mailboxes[0]!.id } });
  const { data: changes } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(changes?.changes).toEqual([
    { position: before!.position + 1, at: expect.any(String), actor: admin!.id, type: "mailboxAdded", mailbox },
    { position: before!.position + 2, at: expect.any(String), actor: admin!.id, type: "addressAdded", address: "ada@example.com", mailbox: data!.mailboxes[0]!.id },
    expect.objectContaining({ type: "actorAdded", added: expect.objectContaining({ kind: "agent", mailboxAgent: true }) }),
    expect.objectContaining({ type: "cooAddressChanged", human: admin!.id, address: "ada-coo@example.com" }),
  ]);
});

test("the code managed login mails the first admin before they add a passkey lands in the Inbox of the mailbox setup gave them", async () => {
  const duva = await withFirstAdmin("ada@example.com");
  const ada = duva.signIn("ada@example.com");
  await duva.setUp({ admin: "ada@example.com" });
  const [mailbox] = (await ada.GET("/mailboxes")).data!.mailboxes;

  const { refused } = await duva.receive(signInCodeTo("ada@example.com"), { to: ["ada@example.com"] });

  expect(refused).toEqual([]);
  const { data } = await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox!.id } } });
  expect(data?.threads.map(({ subject, from }) => ({ subject, from }))).toEqual([{ subject: "Your sign-in code", from: { name: "Duva", address: "no-reply@example.com" } }]);
});

test("setup gives the first admin a mailbox at their sign-in address on a domain an admin added", async () => {
  const duva = await withFirstAdmin("ada@example.net");
  const ada = duva.signIn("ada@example.net");
  await duva.setUp({ admin: "ada@example.net" });
  await ada.POST("/domains", { body: { domain: "example.net" } });

  await duva.setUp({ admin: "ada@example.net" });

  expect((await ada.GET("/mailboxes")).data?.mailboxes.map(({ addresses }) => addresses)).toEqual([["ada@example.net"]]);
});

test("a re-run of setup gives the first admin no other mailbox, and answers deploy with the one they have", async () => {
  const duva = await withFirstAdmin("ada@example.com");
  const ada = duva.signIn("ada@example.com");
  const { mailbox } = await duva.setUp({ admin: "ada@example.com" });
  const { data: before } = await ada.GET("/organization/changes");

  const again = await duva.setUp({ admin: "ada@example.com" });

  expect((await ada.GET("/organization/changes")).data).toEqual(before);
  expect(again.mailbox).toEqual(mailbox);
});

test("once no mailbox has the first admin's sign-in address, the next setup gives them one there again, where their codes go", async () => {
  const duva = await withFirstAdmin("ada@example.com");
  const ada = duva.signIn("ada@example.com");
  await duva.setUp({ admin: "ada@example.com" });
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "ada@example.com" } } });

  await duva.setUp({ admin: "ada@example.com" });

  expect((await ada.GET("/mailboxes")).data?.mailboxes.map(({ addresses }) => addresses)).toEqual(expect.arrayContaining([[], ["ada@example.com"]]));
});

test("setup leaves alone the first admin's sign-in address when their own mailbox has it, and answers deploy with it", async () => {
  const duva = await withFirstAdmin("ada@example.com");
  const ada = duva.signIn("ada@example.com");
  const { data: admin } = await ada.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: admin!.id, address: "ada@example.com" } });
  const { data: before } = await ada.GET("/organization/changes");

  const answer = await duva.setUp({ admin: "ada@example.com" });

  expect((await ada.GET("/organization/changes")).data).toEqual(before);
  expect((await ada.GET("/organization/mailboxes")).data?.mailboxes).toEqual([mailbox]);
  expect(answer.mailbox).toEqual(mailbox);
});

test("setup leaves alone the first admin's sign-in address when another human's mailbox has it, and answers deploy with no mailbox", async () => {
  const duva = await withFirstAdmin("ada@example.com", { humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.com");
  const { data: grace } = await duva.signIn("grace@example.org").GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "ada@example.com" } });
  const { data: before } = await ada.GET("/organization/changes");

  const answer = await duva.setUp({ admin: "ada@example.com" });

  expect((await ada.GET("/organization/changes")).data).toEqual(before);
  expect((await ada.GET("/organization/mailboxes")).data?.mailboxes).toEqual([mailbox]);
  expect(answer.mailbox).toBeUndefined();
});

test("setup gives a first admin who signs in at an address outside the organization's domains no mailbox", async () => {
  const duva = await withFirstAdmin("ada@example.org");
  const ada = duva.signIn("ada@example.org");
  const { data: before } = await ada.GET("/organization/changes");

  const answer = await duva.setUp({ admin: "ada@example.org" });

  expect((await ada.GET("/organization/changes")).data).toEqual(before);
  expect((await ada.GET("/organization/mailboxes")).data?.mailboxes).toEqual([]);
  expect(answer.mailbox).toBeUndefined();
});
