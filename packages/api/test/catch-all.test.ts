import type { components } from "@duva/openapi";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

type Mailbox = components["schemas"]["Mailbox"];

/**
 * A deployment on example.com, with example.se its alias domain, where ada, the first admin, has
 * grace as another human, with a mailbox at grace@example.com whose Screener is on, as a human's
 * is by default, and hermes, ada's agent, with a mailbox at hermes@example.com.
 */
async function withCatchAllCandidates() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const { data: agent } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: hermesMailbox } = await ada.POST("/mailboxes", { body: { owner: agent!.agent.id, address: "hermes@example.com" } });
  const graces = { path: { mailbox: mailbox!.id } };
  const hermess = { path: { mailbox: hermesMailbox!.id } };
  return { duva, ada, grace, hermes: duva.withKey(agent!.key), agent: agent!.agent, mailbox: mailbox as Mailbox, graces, hermess };
}

const message = (from: string, to: string, subject = "Hello") => `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${subject.replaceAll(" ", "-")}@mail.test>\r\n\r\nHej.\r\n`;

const onExampleCom = (body: { mailbox?: string; group?: string }) => ({ params: { path: { domain: "example.com" } }, body });

/** The messages in the mailbox's threads with the label, newest thread first. */
async function messagesIn(client: ReturnType<Awaited<ReturnType<typeof startDuva>>["signIn"]>, params: { path: { mailbox: string } }, label = "inbox") {
  const { data } = await client.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } });
  const threads = await Promise.all((data?.threads ?? []).map(({ id }) => client.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: id } } })));
  return threads.flatMap(({ data: thread }) => thread?.messages ?? []);
}

/** The subjects of the threads waiting in the mailbox's Screener. */
async function waiting(client: ReturnType<Awaited<ReturnType<typeof startDuva>>["signIn"]>, params: { path: { mailbox: string } }) {
  const { data } = await client.GET("/mailboxes/{mailbox}/screener", { params });
  return (data?.senders ?? []).flatMap(({ threads }) => threads.map(({ subject }) => subject));
}

test("a domain has no catch-all to start with, so mail to an address the organization doesn't have is refused", async () => {
  const { duva, ada } = await withCatchAllCandidates();

  const { data } = await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } });

  expect(data).not.toHaveProperty("catchAll");
  expect((await duva.receive(message("linus@example.net", "nobody@example.com"), { to: ["nobody@example.com", "nobody@example.se"] })).refused).toEqual(["nobody@example.com", "nobody@example.se"]);
});

test("with a mailbox as the catch-all, mail to unknown and removed addresses on the domain and its alias domain reaches it, waiting in its Screener", async () => {
  const { duva, ada, grace, mailbox, graces } = await withCatchAllCandidates();
  await ada.POST("/addresses", { body: { address: "orders@example.com", mailbox: mailbox.id } });
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "orders@example.com" } } });

  const { response, data } = await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ domain: "example.com", catchAll: { mailbox: mailbox.id } });
  const { refused } = await duva.receive(message("linus@example.net", "nobody@example.com", "To nobody"), { to: ["Nobody+News@example.com"] });
  await duva.receive(message("linus@example.net", "orders@example.com", "To orders"), { to: ["orders@example.com"] });
  await duva.receive(message("linus@example.net", "someone@example.se", "To the alias"), { to: ["someone@example.se"] });
  expect(refused).toEqual([]);
  expect((await waiting(grace, graces)).sort()).toEqual(["To nobody", "To orders", "To the alias"]);
  await grace.POST("/mailboxes/{mailbox}/screener/let-in", { params: graces, body: { address: "linus@example.net" } });
  const recipients = (await messagesIn(grace, graces)).map(({ recipient, plusTag, group }) => ({ recipient, plusTag, group }));
  expect(recipients).toEqual(
    expect.arrayContaining([
      { recipient: "nobody+News@example.com", plusTag: "News", group: undefined },
      { recipient: "orders@example.com", plusTag: undefined, group: undefined },
      { recipient: "someone@example.se", plusTag: undefined, group: undefined },
    ]),
  );
});

test("mail to the organization's own addresses still reaches their mailboxes, not the catch-all", async () => {
  const { duva, ada, grace, mailbox, graces, hermes, hermess } = await withCatchAllCandidates();
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));

  await duva.receive(message("linus@example.net", "hermes@example.com, nobody@example.com"), { to: ["hermes@example.com", "nobody@example.com"] });

  expect(await messagesIn(hermes, hermess)).toHaveLength(1);
  expect(await waiting(grace, graces)).toEqual(["Hello"]);
});

test("a mailbox that gets mail both as itself and as the catch-all gets one copy, for its own address", async () => {
  const { duva, ada, grace, mailbox, graces } = await withCatchAllCandidates();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));

  await duva.receive(message("linus@example.net", "nobody@example.com, grace@example.com"), { to: ["nobody@example.com", "grace@example.com"] });

  const messages = await messagesIn(grace, graces);
  expect(messages.map(({ recipient }) => recipient)).toEqual(["grace@example.com"]);
});

test("a mailbox that gets mail both as a group's member and as the catch-all gets one copy, marked with the group", async () => {
  const { duva, ada, grace, mailbox, graces } = await withCatchAllCandidates();
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com"] } });
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));

  await duva.receive(message("linus@example.net", "nobody@example.com, support@example.com"), { to: ["nobody@example.com", "support@example.com"] });

  expect((await messagesIn(grace, graces)).map(({ recipient, group }) => ({ recipient, group }))).toEqual([{ recipient: "support@example.com", group: "support@example.com" }]);
});

test("with a group as the catch-all, its members get the mail marked with the group, skipping their Screeners, and external members get it re-sent", async () => {
  const { duva, ada, grace, graces } = await withCatchAllCandidates();
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com", "linus@example.org"] } });

  const { data } = await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ group: "Support@example.com" }));

  expect(data).toMatchObject({ catchAll: { group: "support@example.com" } });
  expect((await duva.receive(message("margaret@example.net", "help@example.se"), { to: ["help@example.se"] })).refused).toEqual([]);
  expect(await waiting(grace, graces)).toEqual([]);
  expect((await messagesIn(grace, graces)).map(({ recipient, group }) => ({ recipient, group }))).toEqual([{ recipient: "help@example.se", group: "support@example.com" }]);
  expect(duva.sentTo()).toEqual([["linus@example.org"]]);
});

test("a member mailing a catch-all group, from an alias domain's mirror of its address, gets no copy of its own mail", async () => {
  const { duva, ada, grace, hermes, graces, hermess } = await withCatchAllCandidates();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com", "hermes@example.com"] } });
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ group: "support@example.com" }));

  await duva.receive(message("grace@example.se", "help@example.com", "From Grace"), { from: "bounces@mail.example.net", to: ["help@example.com"] });

  expect((await messagesIn(hermes, hermess)).map(({ subject }) => subject)).toEqual(["From Grace"]);
  expect(await messagesIn(grace, graces)).toEqual([]);
});

test("a group as the catch-all bounces mail from senders it doesn't take", async () => {
  const { duva, ada } = await withCatchAllCandidates();
  await ada.POST("/groups", { body: { address: "family@example.com", members: ["grace@example.com"], sendPolicy: "organization" } });
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ group: "family@example.com" }));

  await duva.receive(message("linus@example.net", "nobody@example.com"), { to: ["nobody@example.com"] });

  expect(duva.bounces()).toMatchObject([{ recipients: ["nobody@example.com"], explanation: "family@example.com takes mail only from the organization." }]);
});

test("clearing the catch-all refuses mail to unknown addresses again", async () => {
  const { duva, ada, mailbox } = await withCatchAllCandidates();
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));

  const { response, data } = await ada.DELETE("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } } });

  expect(response.status).toBe(200);
  expect(data).not.toHaveProperty("catchAll");
  expect((await duva.receive(message("linus@example.net", "nobody@example.com"), { to: ["nobody@example.com", "nobody@example.se", "grace@example.se"] })).refused).toEqual([
    "nobody@example.com",
    "nobody@example.se",
  ]);
});

test("removing the agent whose mailbox is the catch-all, or deleting the group that is, clears the catch-all", async () => {
  const { duva, ada, agent, hermess } = await withCatchAllCandidates();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com"] } });
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: hermess.path.mailbox }));
  await ada.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.net" } }, body: { group: "support@example.com" } });

  await ada.DELETE("/agents/{agent}", { params: { path: { agent: agent.id } } });
  await ada.DELETE("/groups/{group}", { params: { path: { group: "support@example.com" } } });

  const { data } = await ada.GET("/domains");
  expect(data?.domains.map(({ catchAll }) => catchAll)).toEqual([undefined, undefined, undefined]);
  expect((await duva.receive(message("linus@example.org", "nobody@example.com"), { to: ["nobody@example.com", "nobody@example.net"] })).refused).toEqual(["nobody@example.com", "nobody@example.net"]);
});

test("while a catch-all is set, the receipt rules list its domain and alias domains, one added later too, next to the addresses, until it is cleared", async () => {
  const { duva, ada, mailbox } = await withCatchAllCandidates();
  const listed = () => duva.receiptRules().flatMap(({ Recipients = [] }) => Recipients).sort();

  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));
  await ada.POST("/domains", { body: { domain: "example.fi", aliasOf: "example.com" } });
  const whileSet = listed();
  await ada.DELETE("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } } });

  const addresses = ["grace@example.com", "grace@example.fi", "grace@example.se", "hermes@example.com", "hermes@example.fi", "hermes@example.se"];
  expect(whileSet).toEqual([...addresses, "example.com", "example.fi", "example.se"].sort());
  expect(listed()).toEqual(addresses);
});

test("removing a domain whose group is another domain's catch-all clears that catch-all", async () => {
  const { duva, ada } = await withCatchAllCandidates();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/groups", { body: { address: "support@example.net", members: ["grace@example.com"] } });
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ group: "support@example.net" }));

  await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.net" } }, body: {} });

  expect((await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } })).data?.catchAll).toBeUndefined();
  expect((await duva.receive(message("linus@example.org", "nobody@example.com"), { to: ["nobody@example.com"] })).refused).toEqual(["nobody@example.com"]);
});

test("a mailbox that is the catch-all stays it when handed over, and its new owner gets the mail", async () => {
  const { duva, ada, mailbox, graces } = await withCatchAllCandidates();
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));
  const { data: me } = await ada.GET("/whoami");

  await ada.POST("/humans/{human}/remove", { params: { path: { human: mailbox.owner } }, body: { handTo: me!.id, handOver: [mailbox.id] } });
  await duva.receive(message("linus@example.org", "nobody@example.com", "After the handover"), { to: ["nobody@example.com"] });

  expect((await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } })).data?.catchAll).toEqual({ mailbox: mailbox.id });
  expect(await waiting(ada, graces)).toEqual(["After the handover"]);
});

test("an alias domain has no catch-all of its own, since it mirrors its standalone domain's", async () => {
  const { ada, mailbox } = await withCatchAllCandidates();

  const { response, error } = await ada.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.se" } }, body: { mailbox: mailbox.id } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/example\.se is an alias domain.*Set example\.com's catch-all/);
});

test("the catch-all is one mailbox or one group the organization has", async () => {
  const { ada, mailbox } = await withCatchAllCandidates();
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com"] } });

  const both = await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id, group: "support@example.com" }));
  const neither = await ada.PUT("/domains/{domain}/catch-all", onExampleCom({}));
  const noMailbox = await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: "no-such-mailbox" }));
  const noGroup = await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ group: "grace@example.com" }));
  const noDomain = await ada.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.org" } }, body: { mailbox: mailbox.id } });

  expect([both, neither, noMailbox, noGroup, noDomain].map(({ response }) => response.status)).toEqual([400, 400, 400, 400, 404]);
  expect(noGroup.error?.message).toMatch(/no group "grace@example\.com"/);
  expect((await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } })).data?.catchAll).toBeUndefined();
});

test("only an admin sets and clears a catch-all", async () => {
  const { ada, grace, mailbox } = await withCatchAllCandidates();
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));

  const set = await grace.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));
  const cleared = await grace.DELETE("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } } });

  expect([set.response.status, cleared.response.status]).toEqual([403, 403]);
  expect((await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } })).data?.catchAll).toEqual({ mailbox: mailbox.id });
});

test("setting, changing and clearing a catch-all are in the organization's change feed, attributed to the admin, and repeating one records nothing", async () => {
  const { ada, mailbox } = await withCatchAllCandidates();
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com"] } });
  const { data: admin } = await ada.GET("/whoami");
  const { data: before } = await ada.GET("/organization/changes");

  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ mailbox: mailbox.id }));
  await ada.PUT("/domains/{domain}/catch-all", onExampleCom({ group: "support@example.com" }));
  await ada.DELETE("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } } });
  await ada.DELETE("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } } });

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  const change = (offset: number, details: object) => ({ position: before!.position + offset, at: expect.any(String), actor: admin?.id, ...details });
  expect(data?.changes).toEqual([
    change(1, { type: "catchAllChanged", domain: "example.com", catchAll: { mailbox: mailbox.id } }),
    change(2, { type: "catchAllChanged", domain: "example.com", catchAll: { group: "support@example.com" } }),
    change(3, { type: "catchAllChanged", domain: "example.com" }),
  ]);
});
