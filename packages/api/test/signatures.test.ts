import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { startDuva } from "./harness.ts";

/**
 * A deployment on example.com where Grace owns a mailbox at grace@example.com and
 * support@example.com, without a Screener, and sponsors the agent Hermes. Ada is the first admin.
 */
async function withGrace() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: mailbox!.id } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  const { data: created } = await grace.POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(created!.key);
  /** Gives Hermes the sponsor access in Grace's mailbox. */
  const access = (sponsorAccess: "read" | "organize" | "draft" | "send") => grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess } });
  const sign = (body: { address?: string; text: string | null }, as: DuvaClient = grace) => as.PATCH("/mailboxes/{mailbox}/signature", { params, body });
  /** Writes the draft as the actor and sends it, and answers the draft as written. */
  const send = async (body: components["schemas"]["NewDraft"], as: DuvaClient = grace) => {
    const { data: draft } = await as.POST("/mailboxes/{mailbox}/drafts", { params, body });
    await as.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    return draft!;
  };
  /** The text part of the last message SES accepted for sending. */
  const lastText = async () => (await PostalMime.parse(duva.sent().at(-1)!)).text;
  return { duva, ada, grace, hermes, access, mailbox: mailbox!, params, sign, send, lastText };
}

const signature = "Grace Hopper\nExample Ltd";

test("the mailbox's signature closes new mail sent from it, after a line of \"-- \" below what was written", async () => {
  const { grace, params, sign, send, lastText } = await withGrace();
  const { response, data } = await sign({ text: signature });
  expect(response.status).toBe(200);
  expect(data).toEqual({ text: signature, addresses: [{ address: "grace@example.com" }, { address: "support@example.com" }] });

  const draft = await send({ to: ["ada@example.org"], subject: "Lunch", text: "Lunch on Friday?" });

  expect(draft).toMatchObject({ text: "Lunch on Friday?", signature });
  expect(await lastText()).toBe("Lunch on Friday?\n\n-- \nGrace Hopper\nExample Ltd\n");
  expect((await grace.GET("/mailboxes/{mailbox}/signature", { params })).data).toEqual(data);
});

test("an address's own signature wins for mail from it, and the mailbox's goes on mail from its other addresses", async () => {
  const { sign, send, lastText } = await withGrace();
  await sign({ text: signature });
  const { data } = await sign({ address: "Support@example.com", text: "Example Support\nhttps://example.com/help" });
  expect(data?.addresses).toEqual([{ address: "grace@example.com" }, { address: "support@example.com", text: "Example Support\nhttps://example.com/help" }]);

  await send({ from: "support@example.com", to: ["ada@example.org"], subject: "Your ticket", text: "It's fixed." });
  const fromSupport = await lastText();
  await send({ from: "grace@example.com", to: ["ada@example.org"], subject: "Lunch", text: "Lunch on Friday?" });

  expect(fromSupport).toBe("It's fixed.\n\n-- \nExample Support\nhttps://example.com/help\n");
  expect(await lastText()).toBe("Lunch on Friday?\n\n-- \nGrace Hopper\nExample Ltd\n");
});

test("a reply carries the signature of the address it goes from, and a forward's goes above the quoted original", async () => {
  const { duva, grace, params, sign, send, lastText } = await withGrace();
  await sign({ text: signature });
  await sign({ address: "support@example.com", text: "Example Support" });
  await duva.receive(
    "From: Ada Lovelace <ada@example.org>\r\nTo: support@example.com\r\nSubject: Broken\r\nDate: Sat, 10 Oct 2026 10:00:00 +0000\r\nMessage-ID: <broken@example.org>\r\n\r\nIt broke.\r\n",
    { to: ["support@example.com"] },
  );
  const { data: inbox } = await grace.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: inbox!.threads[0]!.id } } });
  const original = thread!.messages[0]!.id;

  await send({ answers: original, text: "Looking into it." });
  const reply = await lastText();
  const { data: forward } = await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { forwards: original, to: ["joan@example.org"] } });
  await grace.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: forward!.id } }, body: { text: `Joan, can you look?${forward!.text}` } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: forward!.id } } });

  expect(reply).toBe("Looking into it.\n\n-- \nExample Support\n");
  expect(forward!.signature).toBe("Example Support");
  expect(await lastText()).toMatch(/^Joan, can you look\?\n\n-- \nExample Support\n\nForwarded message\nFrom: Ada Lovelace <ada@example\.org>\n[^]*\n\n> It broke\.\n$/);
});

test("an agent's draft in the mailbox carries the signature, with the disclosure's line below it", async () => {
  const { grace, hermes, access, sign, send, lastText } = await withGrace();
  await access("send");
  await sign({ text: signature });

  const draft = await send({ to: ["ada@example.org"], subject: "Lunch", text: "Lunch on Friday?" }, hermes);
  const { data: approvals } = await grace.GET("/approvals");
  await grace.POST("/approvals/{approval}/send", { params: { path: { approval: approvals!.approvals[0]!.id } } });

  expect(draft.signature).toBe(signature);
  expect(approvals!.approvals[0]!.draft.signature).toBe(signature);
  expect(await lastText()).toBe("Lunch on Friday?\n\n-- \nGrace Hopper\nExample Ltd\n\nSent by Hermes for grace@example.org\n");
});

test("the writer can change the signature or drop it for one message, and the mailbox's stays as it was", async () => {
  const { grace, params, sign, send, lastText } = await withGrace();
  await sign({ text: signature });

  await send({ to: ["ada@example.org"], subject: "Lunch", text: "Lunch on Friday?", signature: "Grace" });
  const changed = await lastText();
  const dropped = await send({ to: ["ada@example.org"], subject: "Lunch", text: "Lunch on Friday?", signature: null });

  expect(changed).toBe("Lunch on Friday?\n\n-- \nGrace\n");
  expect(dropped).not.toHaveProperty("signature");
  expect(await lastText()).toBe("Lunch on Friday?\n");
  expect((await grace.GET("/mailboxes/{mailbox}/signature", { params })).data?.text).toBe(signature);
});

test("changing a draft's From swaps its signature for the new From's, unless the writer changed it", async () => {
  const { grace, params, sign } = await withGrace();
  await sign({ text: signature });
  await sign({ address: "support@example.com", text: "Example Support" });
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { text: "Hi." } });
  const at = { params: { path: { ...params.path, draft: draft!.id } } };

  const { data: swapped } = await grace.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...at, body: { from: "support@example.com" } });
  await grace.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...at, body: { signature: "Grace, for Support" } });
  const { data: kept } = await grace.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...at, body: { from: "grace@example.com" } });

  expect(draft?.signature).toBe(signature);
  expect(swapped?.signature).toBe("Example Support");
  expect(kept).toMatchObject({ from: "grace@example.com", signature: "Grace, for Support" });
});

test("in the HTML part, the signature is its text, with its web addresses as links and no image", async () => {
  const { duva, sign, send } = await withGrace();
  await sign({ text: "Grace Hopper\nhttps://example.com/grace, and <b>bold</b>" });

  await send({ to: ["ada@example.org"], subject: "Lunch", text: "Lunch on Friday?" });

  const { html } = await PostalMime.parse(duva.sent().at(-1)!);
  expect(html).toContain(
    '<div style="white-space:pre-wrap">Lunch on Friday?\n\n-- \nGrace Hopper\n<a href="https://example.com/grace">https://example.com/grace</a>, and &lt;b&gt;bold&lt;/b&gt;</div>',
  );
  expect(html).not.toContain("<img");
});

test("mail sent as a group carries the member's mailbox's signature", async () => {
  const { ada, sign, send, lastText } = await withGrace();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "joan@example.org"] } });
  await sign({ text: signature });
  await sign({ address: "support@example.com", text: "Example Support" });

  await send({ from: "team@example.com", to: ["ada@example.org"], subject: "From the team", text: "Hello from the team." });

  expect(await lastText()).toBe("Hello from the team.\n\n-- \nGrace Hopper\nExample Ltd\n");
});

test("an away message carries no signature", async () => {
  const { duva, grace, mailbox, sign } = await withGrace();
  await sign({ text: signature });
  await grace.PATCH("/away-message", { body: { mailbox: mailbox.id, text: "I'm away this week." } });
  await grace.PATCH("/away-message", { body: { on: true } });

  await duva.receive(
    "From: Ada Lovelace <ada@example.org>\r\nTo: grace@example.com\r\nSubject: Lunch\r\nDate: Sat, 10 Oct 2026 10:00:00 +0000\r\nMessage-ID: <lunch@example.org>\r\n\r\nLunch?\r\n",
    { to: ["grace@example.com"] },
  );

  const [reply] = duva.sent();
  expect(reply).toMatch(/^Auto-Submitted: auto-replied/im);
  const { text, html } = await PostalMime.parse(reply!);
  expect(text).toContain("I'm away this week.");
  expect(text).not.toContain("-- \n");
  expect(text).not.toContain("Grace Hopper");
  expect(html).not.toContain("Grace Hopper");
});

test("only the owner and agents with organize sponsor access or more change the signature, and the mailbox's change feed records who did", async () => {
  const { grace, hermes, access, params, sign } = await withGrace();
  await access("read");

  const read = await sign({ text: "Hermes was here" }, hermes);
  await access("organize");
  const organized = await sign({ address: "support@example.com", text: "Example Support" }, hermes);
  const removed = await sign({ text: null });
  const { data: me } = await grace.GET("/whoami");
  const { data: hermesMe } = await hermes.GET("/whoami");

  expect(read.response.status).toBe(403);
  expect(read.error?.message).toMatch(/Ask your sponsor for organize access/);
  expect(organized.response.status).toBe(200);
  expect(removed.data).toEqual({ addresses: [{ address: "grace@example.com" }, { address: "support@example.com", text: "Example Support" }] });
  const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params });
  expect(data!.changes.filter(({ type }) => type === "signatureChanged")).toEqual([
    expect.objectContaining({ actor: hermesMe!.id, address: "support@example.com" }),
    expect.objectContaining({ actor: me!.id }),
  ]);
  expect(data!.changes.findLast(({ type }) => type === "signatureChanged")).not.toHaveProperty("address");
});

test("a signature longer than 1,000 characters, or for another mailbox's address, is refused with what to give", async () => {
  const { sign } = await withGrace();

  const long = await sign({ text: "x".repeat(1001) });
  const other = await sign({ address: "ada@example.com", text: "Ada" });

  expect(long.response.status).toBe(400);
  expect(long.error?.message).toMatch(/Give text as up to 1,000 characters/);
  expect(other.response.status).toBe(400);
  expect(other.error?.message).toMatch(/isn't one of the mailbox's addresses\. Give one of grace@example\.com, support@example\.com/);
});
