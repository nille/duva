import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada, the first admin, has a personal mailbox at ada@example.com
 * and sponsors the agent Hermes, which she gives send sponsor access there, to send as her without
 * approval. Grace is another human.
 */
async function withAgent() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const agent = created!.agent;
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: (await ada.GET("/whoami")).data!.id, address: "ada@example.com" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sponsorAccess: "send", approvalAsSponsor: false } });
  const hermes = duva.withKey(created!.key);
  const own = mailbox!.id;

  /** Hermes sends a message to the recipients, and gets back the draft, sent, and the ID SES gave the message. */
  const send = async (to: string[]) => {
    const params = { path: { mailbox: own } };
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to, subject: "Hello", text: "Hej." } });
    await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { mailbox: own, draft: draft!.id } } });
    const { data: sent } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: own, draft: draft!.id } } });
    const messageId = /^<(.+)@eu-north-1\.amazonses\.com>$/.exec(sent!.send!.messageId!)![1]!;
    return { draft: sent!, messageId };
  };
  /** Hermes sends a message to the recipients, and SES reports that each hard-bounced. */
  const bounced = async (to: string[], at?: Date) => {
    const sent = await send(to);
    await duva.sendingEvent(sent.messageId, { type: "Bounce", bounceType: "Permanent" }, at && { at });
    return sent;
  };
  /** Whether SES delivered Hermes's next message to the address. */
  const delivered = async (address: string) => {
    await send([address]);
    return duva.sentTo().at(-1)!.includes(address);
  };
  const paused = async () => (await ada.GET("/agents")).data?.agents.find(({ id }) => id === agent.id)?.paused;
  return { duva, ada, hermes, own, send, bounced, delivered, paused };
}

const suppressed = (duva: { suppressionList(): { address: string }[] }) => duva.suppressionList().map(({ address }) => address);

test("an address that hard-bounced before the organization had it leaves SES's suppression list when an admin adds it to a mailbox", async () => {
  const { duva, ada, own, bounced, delivered } = await withAgent();
  await bounced(["support@example.com"]);
  expect(suppressed(duva)).toEqual(["support@example.com"]);
  expect(await delivered("support@example.com")).toBe(false);

  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: own } });

  expect(suppressed(duva)).toEqual([]);
  expect(await delivered("support@example.com")).toBe(true);
});

test("an address's plus-tagged addresses leave SES's suppression list with it", async () => {
  const { duva, ada, own, bounced } = await withAgent();
  await bounced(["support+billing@example.com", "Support+News@example.com"]);

  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: own } });

  expect(suppressed(duva)).toEqual([]);
});

test("every address on a domain leaves SES's suppression list when an admin gives the domain a catch-all", async () => {
  const { duva, ada, own, bounced } = await withAgent();
  await bounced(["nobody@example.com", "nobody@example.net"]);

  await ada.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } }, body: { mailbox: own } });

  expect(suppressed(duva)).toEqual(["nobody@example.net"]);
});

test("a group's address leaves SES's suppression list when an admin creates the group", async () => {
  const { duva, ada, bounced, delivered } = await withAgent();
  await bounced(["team@example.com", "ken@example.net"]);

  await ada.POST("/groups", { body: { address: "team@example.com", members: ["ada@example.com"] } });

  expect(suppressed(duva)).toEqual(["ken@example.net"]);
  expect(await delivered("team@example.com")).toBe(true);
});

test("a new mailbox's address leaves SES's suppression list", async () => {
  const { duva, ada, bounced } = await withAgent();
  await bounced(["grace@example.com"]);
  const { data: grace } = await duva.signIn("grace@example.org").GET("/whoami");

  await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });

  expect(suppressed(duva)).toEqual([]);
});

test("the addresses an alias domain mirrors leave SES's suppression list when an admin adds the alias domain", async () => {
  const { duva, ada, bounced } = await withAgent();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["ada@example.com"] } });
  await bounced(["ada@example.se", "team@example.se", "nobody@example.se"]);

  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });

  expect(suppressed(duva)).toEqual(["nobody@example.se"]);
});

test("a hard bounce of one of the organization's addresses takes it off SES's suppression list, and the feedback says it was local", async () => {
  const { duva, ada, own, bounced, delivered } = await withAgent();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["ada@example.com"] } });
  const at = new Date();

  const { draft } = await bounced(["Team@example.com", "ken@example.net"], at);

  expect(suppressed(duva)).toEqual(["ken@example.net"]);
  expect(await delivered("team@example.com")).toBe(true);
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: own, thread: draft.send!.thread! } } });
  expect(thread?.messages[0]?.feedback).toEqual([
    { kind: "hardBounce", at: at.toISOString(), recipients: ["Team@example.com", "ken@example.net"], reason: "General", localRecipients: ["Team@example.com"] },
  ]);
});

test("a hard bounce of one of the organization's addresses that SNS delivers twice is recorded once", async () => {
  const { duva, ada, own, send } = await withAgent();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["ada@example.com"] } });
  const { draft, messageId } = await send(["team@example.com"]);

  await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent" }, { deliveries: 2 });

  expect(suppressed(duva)).toEqual([]);
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: own, thread: draft.send!.thread! } } });
  expect(thread?.messages[0]?.feedback).toMatchObject([{ kind: "hardBounce", localRecipients: ["team@example.com"] }]);
});

test("hard bounces of the organization's own addresses never pause the agent, while its other recipients' still count", async () => {
  const { ada, bounced, paused } = await withAgent();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["ada@example.com"] } });
  const start = Date.UTC(2026, 9, 6, 12, 0);
  const minute = (n: number) => new Date(start + n * 60_000);

  for (const n of [0, 1, 2, 3, 4, 5]) await bounced(["team@example.com", "ada@example.com"], minute(n));
  expect(await paused()).toBeUndefined();

  for (const n of [10, 11, 12, 13]) await bounced(["team@example.com", `gone-${n}@example.net`], minute(n));
  expect(await paused()).toBeUndefined();
  await bounced(["team@example.com", "gone-14@example.net"], minute(14));
  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "Its mail hard-bounced 5 times within an hour." });
});

test("an address the organization removed stays on SES's suppression list after a hard bounce, and counts toward pausing the agent", async () => {
  const { duva, ada, own, bounced, paused } = await withAgent();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: own } });
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "support@example.com" } } });
  const start = Date.UTC(2026, 9, 6, 12, 0);

  for (const n of [0, 1, 2, 3, 4]) await bounced(["support@example.com"], new Date(start + n * 60_000));

  expect(suppressed(duva)).toEqual(["support@example.com"]);
  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "Its mail hard-bounced 5 times within an hour." });
});

test("an address on a domain with a catch-all leaves SES's suppression list after a hard bounce, since the catch-all takes its mail", async () => {
  const { duva, ada, own, bounced } = await withAgent();
  await ada.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } }, body: { mailbox: own } });

  await bounced(["anything@example.com"]);

  expect(suppressed(duva)).toEqual([]);
});
