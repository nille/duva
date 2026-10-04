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
  expect(data).toEqual({ id: expect.any(String), kind: "personal", owner: hermes.id, defaultAddress: "hermes@example.com" });
});

test("an address is kept in lower case", async () => {
  const { ada, hermes } = await withAgent();

  const { data } = await ada.POST("/mailboxes", { body: { owner: hermes.id, address: "Hermes@Example.COM" } });

  expect(data?.defaultAddress).toBe("hermes@example.com");
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
  expect(data).toEqual({ id: expect.any(String), kind: "personal", owner: grace?.id, defaultAddress: "grace@example.com" });
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

  expect(agents).toEqual({ mailboxes: [mailbox] });
  expect(sponsors).toEqual({ mailboxes: [mailbox] });
});

test("a human lists their own mailbox", async () => {
  const { duva, ada } = await withAgent({ humans: ["grace@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });

  const { data } = await grace.GET("/mailboxes");

  expect(data).toEqual({ mailboxes: [mailbox] });
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
