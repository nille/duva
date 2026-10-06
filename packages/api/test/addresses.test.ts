import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada, the first admin, sponsors the agent Hermes, which owns a
 * mailbox at hermes@example.com. Grace is a human with a mailbox at grace@example.com.
 */
async function withMailboxes() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const { data: me } = await grace.GET("/whoami");
  const { data: gracesMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const graces = { path: { mailbox: gracesMailbox!.id } };
  // Grace's mail goes straight to her Inbox.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  return { duva, ada, grace, hermes, key: created!.key, mailbox: mailbox!, params, gracesMailbox: gracesMailbox!, graces };
}

const message = (to: string, subject = "Hello") => `From: linus@example.net\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@example.net>\r\n\r\nHej.\r\n`;

test("an admin gives a mailbox another address, and mail to it, plus-tagged too, reaches the mailbox", async () => {
  const { duva, ada, grace, graces, gracesMailbox } = await withMailboxes();

  const { response, data } = await ada.POST("/addresses", { body: { address: "Support@Example.com", mailbox: gracesMailbox.id } });

  expect(response.status).toBe(201);
  expect(data).toEqual({ address: "support@example.com", mailbox: gracesMailbox.id });
  expect((await grace.GET("/mailboxes/{mailbox}", { params: graces })).data).toMatchObject({
    defaultAddress: "grace@example.com",
    addresses: ["grace@example.com", "support@example.com"],
  });
  const { refused } = await duva.receive(message("support+orders@example.com"), { to: ["support+orders@example.com", "SUPPORT@example.com"] });
  expect(refused).toEqual([]);
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  expect(list?.threads).toHaveLength(1);
});

test("a mailbox lists its addresses, the earliest first, with its default address", async () => {
  const { ada, mailbox } = await withMailboxes();

  expect(mailbox).toEqual({ id: expect.any(String), kind: "personal", owner: expect.any(String), defaultAddress: "hermes@example.com", addresses: ["hermes@example.com"] });
  await ada.POST("/addresses", { body: { address: "post@example.com", mailbox: mailbox.id } });
  await ada.POST("/addresses", { body: { address: "agent@example.com", mailbox: mailbox.id } });

  const { data } = await ada.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox.id } } });
  expect(data).toMatchObject({ defaultAddress: "hermes@example.com", addresses: ["hermes@example.com", "post@example.com", "agent@example.com"] });
});

test("an admin lists every address in the organization, with the mailbox it delivers to", async () => {
  const { ada, mailbox, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });

  const { data } = await ada.GET("/addresses");

  expect(data).toEqual({
    addresses: [
      { address: "grace@example.com", mailbox: gracesMailbox.id },
      { address: "hermes@example.com", mailbox: mailbox.id },
      { address: "support@example.com", mailbox: gracesMailbox.id },
    ],
  });
});

test("only an admin adds, removes, lists and chooses addresses, so not even the mailbox's owner", async () => {
  const { grace, hermes, mailbox, gracesMailbox, graces } = await withMailboxes();

  for (const actor of [grace, hermes]) {
    const added = await actor.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });
    const removed = await actor.DELETE("/addresses/{address}", { params: { path: { address: "grace@example.com" } } });
    const listed = await actor.GET("/addresses");
    const chosen = await actor.PATCH("/mailboxes/{mailbox}", { params: graces, body: { defaultAddress: "grace@example.com" } });
    expect([added, removed, listed, chosen].map(({ response }) => response.status)).toEqual([403, 403, 403, 403]);
    expect(added.error?.message).toMatch(/admin/);
  }
  expect((await hermes.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox.id } } })).data?.addresses).toEqual(["hermes@example.com"]);
});

test("an address in use is refused, whichever mailbox has it", async () => {
  const { ada, mailbox, gracesMailbox } = await withMailboxes();

  const theirs = await ada.POST("/addresses", { body: { address: "Hermes@example.com", mailbox: gracesMailbox.id } });
  const own = await ada.POST("/addresses", { body: { address: "hermes@example.com", mailbox: mailbox.id } });
  const asMailbox = await ada.POST("/mailboxes", { body: { owner: mailbox.owner, address: "grace@example.com" } });

  expect([theirs, own, asMailbox].map(({ response }) => response.status)).toEqual([409, 409, 409]);
  expect(theirs.error?.message).toMatch(/hermes@example.com is taken/);
});

test.each([
  ["on another domain", "support@example.net"],
  ["with a plus tag", "support+news@example.com"],
  ["that isn't an address", "support"],
])("an address %s is refused", async (_, address) => {
  const { ada, mailbox } = await withMailboxes();

  const { response, error } = await ada.POST("/addresses", { body: { address, mailbox: mailbox.id } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/address/);
});

test("an address is given only to a mailbox the organization has", async () => {
  const { ada } = await withMailboxes();

  const { response, error } = await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: "nope" } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/no mailbox "nope"/);
});

test("new mail goes from the default address the admin chooses", async () => {
  const { duva, ada, grace, graces, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });

  const { response, data } = await ada.PATCH("/mailboxes/{mailbox}", { params: graces, body: { defaultAddress: "Support@example.com" } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...gracesMailbox, defaultAddress: "support@example.com", addresses: ["grace@example.com", "support@example.com"] });
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { to: ["linus@example.net"], subject: "News", text: "Hej." } });
  expect(draft?.from).toBe("support@example.com");
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: draft!.id } } });
  expect((await PostalMime.parse(duva.sent()[0]!)).from?.address).toBe("support@example.com");
});

test("the default address is one of the mailbox's addresses", async () => {
  const { ada, graces } = await withMailboxes();

  const { response, error } = await ada.PATCH("/mailboxes/{mailbox}", { params: graces, body: { defaultAddress: "hermes@example.com" } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/grace@example.com/);
});

test("a reply goes out from the address the original was sent to, not the default address", async () => {
  const { duva, ada, grace, graces, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });
  await duva.receive(message("support@example.com"), { to: ["support@example.com"] });
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...graces.path, thread: list!.threads[0]!.id } } });

  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: thread!.messages[0]!.id, text: "Thanks." } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: draft!.id } } });

  expect(draft?.from).toBe("support@example.com");
  expect((await PostalMime.parse(duva.sent()[0]!)).from?.address).toBe("support@example.com");
});

test("a reply to all leaves out every one of the mailbox's addresses", async () => {
  const { duva, ada, grace, graces, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });
  await duva.receive("From: linus@example.net\r\nTo: support@example.com, grace@example.com, ken@example.net\r\nSubject: Hi\r\n\r\nHej.\r\n", {
    to: ["support@example.com", "grace@example.com"],
  });
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...graces.path, thread: list!.threads[0]!.id } } });

  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: thread!.messages[0]!.id, replyAll: true } });

  expect(draft?.to.map(({ address }) => address)).toEqual(["linus@example.net", "ken@example.net"]);
});

test("removing an address refuses its mail at once, and the mail the mailbox has stays", async () => {
  const { duva, ada, grace, graces, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });
  await duva.receive(message("support@example.com", "Before"), { to: ["support@example.com"] });

  const { response, data } = await ada.DELETE("/addresses/{address}", { params: { path: { address: "Support@example.com" } } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ address: "support@example.com", mailbox: gracesMailbox.id });
  const { refused } = await duva.receive(message("support+news@example.com", "After"), { to: ["support+news@example.com", "support@example.com"] });
  expect(refused).toEqual(["support+news@example.com", "support@example.com"]);
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  expect(list?.threads.map(({ subject }) => subject)).toEqual(["Before"]);
  expect((await grace.GET("/mailboxes/{mailbox}", { params: graces })).data?.addresses).toEqual(["grace@example.com"]);
});

test("a removed address can be given to another mailbox at once, and its mail reaches that one", async () => {
  const { duva, ada, hermes, grace, params, graces, mailbox, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });

  await ada.DELETE("/addresses/{address}", { params: { path: { address: "support@example.com" } } });
  const { response } = await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: mailbox.id } });

  expect(response.status).toBe(201);
  await duva.receive(message("support@example.com"), { to: ["support@example.com"] });
  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
  expect((await grace.GET("/mailboxes/{mailbox}/threads", { params: graces })).data?.threads).toEqual([]);
});

test("removing an address the organization doesn't have answers 404", async () => {
  const { ada } = await withMailboxes();

  const { response, error } = await ada.DELETE("/addresses/{address}", { params: { path: { address: "nobody@example.com" } } });

  expect(response.status).toBe(404);
  expect(error?.message).toMatch(/nobody@example.com/);
});

test("removing the default address makes the mailbox's earliest other address its default", async () => {
  const { ada, grace, graces, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });
  await ada.POST("/addresses", { body: { address: "office@example.com", mailbox: gracesMailbox.id } });

  await ada.DELETE("/addresses/{address}", { params: { path: { address: "grace@example.com" } } });

  expect((await grace.GET("/mailboxes/{mailbox}", { params: graces })).data).toMatchObject({
    defaultAddress: "support@example.com",
    addresses: ["support@example.com", "office@example.com"],
  });
});

test("a mailbox left with no address keeps its mail, but receives no new mail and can't draft, and says why", async () => {
  const { duva, ada, grace, graces, gracesMailbox } = await withMailboxes();
  await duva.receive(message("grace@example.com", "Before"), { to: ["grace@example.com"] });

  await ada.DELETE("/addresses/{address}", { params: { path: { address: "grace@example.com" } } });

  const { data: mailbox } = await grace.GET("/mailboxes/{mailbox}", { params: graces });
  expect(mailbox).toEqual({ id: gracesMailbox.id, kind: "personal", owner: gracesMailbox.owner, addresses: [], groups: [], unread: 1 });
  expect((await grace.GET("/mailboxes")).data?.mailboxes).toEqual([{ id: gracesMailbox.id, kind: "personal", owner: gracesMailbox.owner, addresses: [], groups: [] }]);
  const { refused } = await duva.receive(message("grace@example.com", "After"), { to: ["grace@example.com"] });
  expect(refused).toEqual(["grace@example.com"]);
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  expect(list?.threads.map(({ subject }) => subject)).toEqual(["Before"]);
  const fresh = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { to: ["linus@example.net"], text: "Hej." } });
  const reply = await grace.POST("/mailboxes/{mailbox}/drafts", {
    params: graces,
    body: { answers: (await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...graces.path, thread: list!.threads[0]!.id } } })).data!.messages[0]!.id },
  });
  for (const { response, error } of [fresh, reply]) {
    expect(response.status).toBe(409);
    expect(error?.message).toMatch(/no address.*admin/);
  }
});

test("a mailbox that had no address takes the next one given it as its default", async () => {
  const { ada, grace, graces, gracesMailbox } = await withMailboxes();
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "grace@example.com" } } });

  await ada.POST("/addresses", { body: { address: "grace.hopper@example.com", mailbox: gracesMailbox.id } });

  expect((await grace.GET("/mailboxes/{mailbox}", { params: graces })).data).toMatchObject({ defaultAddress: "grace.hopper@example.com", addresses: ["grace.hopper@example.com"] });
});

test("a draft from an address since removed isn't sent, and says why", async () => {
  const { duva, ada, grace, graces, gracesMailbox } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: gracesMailbox.id } });
  await ada.PATCH("/mailboxes/{mailbox}", { params: graces, body: { defaultAddress: "support@example.com" } });
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { to: ["linus@example.net"], text: "Hej." } });

  await ada.DELETE("/addresses/{address}", { params: { path: { address: "support@example.com" } } });

  const { response, error } = await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: draft!.id } } });
  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/support@example.com.*no longer/);
  expect(duva.sent()).toEqual([]);
});

test("an approved send from an address removed while it waited fails, and says why", async () => {
  const { duva, ada, hermes, params } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "news@example.com", mailbox: params.path.mailbox } });
  await ada.PATCH("/mailboxes/{mailbox}", { params, body: { defaultAddress: "news@example.com" } });
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["linus@example.net"], text: "Hej." } });
  const inDraft = { params: { path: { ...params.path, draft: draft!.id } } };
  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", inDraft);
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "news@example.com" } } });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } } });

  expect(duva.sent()).toEqual([]);
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", inDraft)).data?.send).toMatchObject({
    state: "failed",
    reason: expect.stringMatching(/news@example.com.*no longer/),
  });
});

test("adding, removing and choosing addresses are in the organization's change feed, attributed to the admin", async () => {
  const { ada, gracesMailbox, graces } = await withMailboxes();
  const { data: admin } = await ada.GET("/whoami");
  const { data: before } = await ada.GET("/organization/changes");
  const mailbox = gracesMailbox.id;

  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox } });
  await ada.PATCH("/mailboxes/{mailbox}", { params: graces, body: { defaultAddress: "support@example.com" } });
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "support@example.com" } } });
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "grace@example.com" } } });

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  const change = (offset: number, details: object) => ({ position: before!.position + offset, at: expect.any(String), actor: admin?.id, ...details });
  expect(data?.changes).toEqual([
    change(1, { type: "addressAdded", address: "support@example.com", mailbox }),
    change(2, { type: "defaultAddressChanged", mailbox, defaultAddress: "support@example.com" }),
    change(3, { type: "addressRemoved", address: "support@example.com", mailbox }),
    change(4, { type: "defaultAddressChanged", mailbox, defaultAddress: "grace@example.com" }),
    change(5, { type: "addressRemoved", address: "grace@example.com", mailbox }),
    change(6, { type: "defaultAddressChanged", mailbox }),
  ]);
});

test("choosing the address that is already the default records nothing", async () => {
  const { ada, graces } = await withMailboxes();
  const { data: before } = await ada.GET("/organization/changes");

  await ada.PATCH("/mailboxes/{mailbox}", { params: graces, body: { defaultAddress: "grace@example.com" } });

  expect((await ada.GET("/organization/changes", { params: { query: { after: before!.position } } })).data?.changes).toEqual([]);
});

test("past 500 addresses, as many as an SES receipt rule takes, Duva's rules share them, and an emptied rule goes", async () => {
  const { duva, ada, hermes, grace, mailbox, params, graces } = await withMailboxes();
  const addresses = Array.from({ length: 499 }, (_, index) => `extra-${index}@example.com`);
  for (let start = 0; start < addresses.length; start += 5) {
    await Promise.all(addresses.slice(start, start + 5).map((address) => ada.POST("/addresses", { body: { address, mailbox: mailbox.id } })));
  }
  // With hermes@ and grace@, the organization has 501 addresses.
  const rules = duva.receiptRules();
  expect(rules.map(({ Recipients = [] }) => Recipients.length).sort()).toEqual([1, 500]);
  expect(new Set(rules.flatMap(({ Recipients = [] }) => Recipients)).size).toBe(501);
  expect(rules.every(({ Actions }) => Actions?.length === 2)).toBe(true);
  const [lone] = rules.find(({ Recipients = [] }) => Recipients.length === 1)!.Recipients!;
  // Hermes's mailbox has an address in each rule, and each rule hands the message to the inbound Lambda.
  expect((await duva.receive(message(lone!), { to: ["hermes@example.com", lone!, "grace@example.com"] })).refused).toEqual([]);
  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
  expect((await grace.GET("/mailboxes/{mailbox}/threads", { params: graces })).data?.threads).toHaveLength(1);

  await ada.DELETE("/addresses/{address}", { params: { path: { address: lone! } } });

  expect(duva.receiptRules().map(({ Recipients = [] }) => Recipients.length)).toEqual([500]);
  expect((await duva.receive(message(lone!, "Later"), { to: [lone!] })).refused).toEqual([lone]);
}, 120_000);
