import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A deployment on example.com where ada, the first admin, sponsors the agent Hermes. */
async function withAgent(options: Parameters<typeof startDuva>[0] = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = duva.signIn("ada@example.org");
  const { data } = await ada.POST("/agents", { body: { name: "Hermes" } });
  return { duva, ada, hermes: data!.agent, key: data!.key };
}

test("an admin creates a personal mailbox for an agent, and its address becomes the default address", async () => {
  const { ada, hermes } = await withAgent();

  const { response, data } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });

  expect(response.status).toBe(201);
  expect(data).toEqual({ id: expect.any(String), kind: "personal", owner: hermes.id, defaultAddress: "hermes@example.com", addresses: ["hermes@example.com"] });
});

test("an address is kept in lower case", async () => {
  const { ada, hermes } = await withAgent();

  const { data } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "Hermes@Example.COM" } });

  expect(data).toMatchObject({ defaultAddress: "hermes@example.com" });
});

test("only an admin can create a mailbox", async () => {
  const { duva, hermes, key } = await withAgent({ humans: ["grace@example.org"] });

  const byHuman = await duva.signIn("grace@example.org").POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });
  const byAgent = await duva.withKey(key).POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
});

test("a taken address is refused", async () => {
  const { ada, hermes } = await withAgent();
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });
  await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });

  const { response, error } = await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "HERMES@example.com" } });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/hermes@example.com is taken/);
});

test.each([
  ["on another domain", "hermes@example.net"],
  ["with a plus tag", "hermes+news@example.com"],
  ["with no local part", "@example.com"],
  ["that isn't an address", "hermes"],
  ["with a space", "her mes@example.com"],
])("an address %s is refused", async (_, address) => {
  const { ada, hermes } = await withAgent();

  const { response, error } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/address/);
});

test("an admin creates a personal mailbox for a human, and its address becomes the default address", async () => {
  const { duva, ada } = await withAgent({ humans: ["grace@example.org"] });
  const { data: grace } = await duva.signIn("grace@example.org").GET("/whoami");

  const { response, data } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });

  expect(response.status).toBe(201);
  expect(data).toEqual({ id: expect.any(String), kind: "personal", owner: grace?.id, defaultAddress: "grace@example.com", addresses: ["grace@example.com"] });
});

test("a mailbox's owner must be an actor in the organization", async () => {
  const { ada } = await withAgent();

  const { response, error } = await ada.POST("/mailboxes", { body: { owner: "nobody", address: "nobody@example.com" } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/no human or agent/);
});

test("creating a mailbox and its address are in the change feed, attributed to the admin", async () => {
  const { ada, hermes } = await withAgent();
  const { data: admin } = await ada.GET("/whoami");
  const { data: before } = await ada.GET("/organization/changes");

  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(data?.changes).toEqual([
    { position: before!.position + 1, at: expect.any(String), actor: admin?.id, type: "mailboxAdded", mailbox },
    { position: before!.position + 2, at: expect.any(String), actor: admin?.id, type: "addressAdded", address: "hermes@example.com", mailbox: mailbox?.id },
  ]);
});

test("an agent lists its own mailboxes, and its sponsor lists them too", async () => {
  const { duva, ada, hermes, key } = await withAgent();
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });

  const { data: agents } = await duva.withKey(key).GET("/mailboxes");
  const { data: sponsors } = await ada.GET("/mailboxes");

  expect(agents).toEqual({ mailboxes: [{ ...mailbox, groups: [] }] });
  expect(sponsors).toEqual({ mailboxes: [{ ...mailbox, groups: [] }] });
});

test("a human lists their own mailbox", async () => {
  const { duva, ada } = await withAgent({ humans: ["grace@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });

  const { data } = await grace.GET("/mailboxes");

  expect(data).toEqual({ mailboxes: [{ ...mailbox, groups: [] }] });
  expect((await ada.GET("/mailboxes")).data).toEqual({ mailboxes: [] });
});

test("an admin who isn't the sponsor doesn't list an agent's mailboxes", async () => {
  const { duva } = await withAgent({ humans: ["grace@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });

  const { data } = await duva.signIn("ada@example.org").GET("/mailboxes");

  expect(data).toEqual({ mailboxes: [] });
});

test("the sponsor reads their agent's mailbox, with how many threads in its Inbox are unread", async () => {
  const { duva, ada, hermes, key } = await withAgent();
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  for (const subject of ["One", "Two", "Three"]) {
    await duva.receive(`From: grace@example.org\r\nTo: hermes@example.com\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@example.org>\r\n\r\nHej.\r\n`, { to: ["hermes@example.com"] });
  }
  const { data: list } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  await ada.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [list!.threads[0]!.id] } });

  const { data, response } = await ada.GET("/mailboxes/{mailbox}", { params });

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...mailbox, groups: [], unread: 2 });
  expect((await duva.withKey(key).GET("/mailboxes/{mailbox}", { params })).data).toEqual({ ...mailbox, groups: [], unread: 2 });
});

test("spam isn't counted among a mailbox's unread threads", async () => {
  const { duva, ada, hermes } = await withAgent();
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });
  await duva.receive("From: grace@example.org\r\nTo: hermes@example.com\r\nSubject: Buy\r\n\r\nBuy now.\r\n", { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });

  const { data } = await ada.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox!.id } } });

  expect(data?.unread).toBe(0);
});

test("only those who can read a mailbox can read its unread count, so not even the admin who created it", async () => {
  const { duva, ada } = await withAgent({ humans: ["grace@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });

  const { response } = await ada.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox!.id } } });
  const { response: missing } = await grace.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: "nope" } } });

  expect(response.status).toBe(403);
  expect(missing.status).toBe(404);
});

test("an admin lists every mailbox in the organization, with its addresses and its owner, a mailbox without an address included", async () => {
  const { duva, ada, hermes } = await withAgent({ humans: ["grace@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: graces } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: graces!.id } });
  await grace.POST("/agents", { body: { name: "Iris" } }).then(async ({ data }) => ada.POST("/mailboxes", { body: { owner: data!.agent.id, address: "iris@example.com" } }));
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "iris@example.com" } } });
  await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "hermes@example.com" } });

  const { response, data } = await ada.GET("/organization/mailboxes");

  expect(response.status).toBe(200);
  const mailboxes = data!.mailboxes.map(({ owner, defaultAddress, addresses }) => ({ owner: data!.owners.find(({ id }) => id === owner), defaultAddress, addresses }));
  expect(mailboxes).toHaveLength(3);
  expect(mailboxes).toEqual(
    expect.arrayContaining([
      { owner: { id: me!.id, kind: "human", email: "grace@example.org", admin: false }, defaultAddress: "grace@example.com", addresses: ["grace@example.com", "support@example.com"] },
      { owner: expect.objectContaining({ kind: "agent", name: "Iris", sponsor: me!.id }), defaultAddress: undefined, addresses: [] },
      { owner: expect.objectContaining({ id: hermes.id, name: "Hermes" }), defaultAddress: "hermes@example.com", addresses: ["hermes@example.com"] },
    ]),
  );
  expect(data!.mailboxes.find(({ owner }) => owner === me!.id)?.id).toBe(graces!.id);
  expect(data!.owners).toHaveLength(3);
});

test("only an admin lists the organization's mailboxes", async () => {
  const { duva, key } = await withAgent({ humans: ["grace@example.org"] });

  const byHuman = await duva.signIn("grace@example.org").GET("/organization/mailboxes");
  const byAgent = await duva.withKey(key).GET("/organization/mailboxes");

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
});
