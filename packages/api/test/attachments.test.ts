import { readFile } from "node:fs/promises";
import PostalMime from "postal-mime";
import { expect, onTestFinished, test, vi } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

const mail = (name: string) => readFile(new URL(`./mail/${name}.eml`, import.meta.url), "utf8");

/**
 * A deployment on example.com where ada, the first admin, added the human Linus and created his
 * personal mailbox at linus@example.com. Grace is another human.
 */
async function withHumansMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const { data: human } = await ada.POST("/humans", { body: { email: "linus@example.org" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: human!.id, address: "linus@example.com" } });
  const linus = duva.signIn("linus@example.org");
  const params = { path: { mailbox: mailbox!.id } };
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  /** Hands SES the message for Linus's mailbox, and returns it as Linus reads it. */
  const receive = async (raw: string) => {
    await duva.receive(raw, { to: ["linus@example.com"] });
    const { data: list } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
    const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
    return thread!.messages.at(-1)!;
  };
  const link = (message: string, attachment: number, as = linus) =>
    as.GET("/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}", { params: { path: { ...params.path, message, attachment } } });
  const forward = async (body: { forwards: string; to?: string[]; text?: string }) => (await linus.POST("/mailboxes/{mailbox}/drafts", { params, body })).data!;
  /** Asks to send the draft, and returns it as it is once the send is done. */
  const send = async (draft: string) => {
    const draftParams = { params: { path: { ...params.path, draft } } };
    await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/send", draftParams);
    return (await linus.GET("/mailboxes/{mailbox}/drafts/{draft}", draftParams)).data!;
  };
  return { duva, ada, linus, linusId: human!.id, mailbox: mailbox!, params, receive, link, forward, send };
}

test("a human downloads an attachment of a received message through a short-lived link", async () => {
  const { duva, receive, link } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));

  const before = Date.now();
  const { data, response } = await link(message.id, 0);
  const download = await duva.download(data!.url);

  expect(response.status).toBe(200);
  expect(data).toEqual({ name: "report.pdf", type: "application/pdf", size: 11, url: expect.any(String), expiresAt: expect.any(String) });
  expect(Date.parse(data!.expiresAt) - before).toBeGreaterThan(4 * 60_000);
  expect(Date.parse(data!.expiresAt) - before).toBeLessThanOrEqual(5 * 60_000 + 1000);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/pdf");
  expect(download.headers.get("content-disposition")).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  expect(await download.text()).toBe("Hello, PDF!");
});

/** A message to Linus with an attachment whose name is in Swedish and Danish, as a mail client encodes it per RFC 2231. */
const nordic = [
  "From: Grace Hopper <grace@example.org>",
  "To: linus@example.com",
  "Subject: Ritningar",
  "Date: Sat, 03 Oct 2026 10:15:00 +0000",
  "Message-ID: <nordic-1@example.org>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="part"',
  "",
  "--part",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Här är ritningarna.",
  "--part",
  "Content-Type: image/png",
  "Content-Disposition: attachment; filename*=UTF-8''r%C3%A5%20%C3%A6bler%C3%B8d%20%C3%A4ng.png",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]).toString("base64"),
  "--part--",
].join("\r\n");

test("an attachment keeps its Swedish and Danish name, and downloads byte for byte", async () => {
  const { duva, receive, link } = await withHumansMailbox();
  const message = await receive(nordic);

  const { data } = await link(message.id, 0);
  const download = await duva.download(data!.url);

  expect(data!.name).toBe("rå æblerød äng.png");
  expect(download.headers.get("content-disposition")).toBe(`attachment; filename="r_ _bler_d _ng.png"; filename*=UTF-8''r%C3%A5%20%C3%A6bler%C3%B8d%20%C3%A4ng.png`);
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]));
});

test("an attachment without a name downloads without one", async () => {
  const { duva, receive, link } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));

  const { data } = await link(message.id, 1);
  const download = await duva.download(data!.url);

  expect(data).toEqual({ type: "text/csv", size: 8, url: expect.any(String), expiresAt: expect.any(String) });
  expect(download.headers.get("content-disposition")).toBe("attachment");
  expect(await download.text()).toBe("a,b\n1,2\n");
});

test("only those who read the mailbox get a link: an admin or another human gets 403", async () => {
  const { duva, ada, receive, link } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));

  const byAdmin = await link(message.id, 0, ada);
  const byGrace = await link(message.id, 0, duva.signIn("grace@example.org"));

  expect(byAdmin.response.status).toBe(403);
  expect(byGrace.response.status).toBe(403);
  expect(byGrace.error).toEqual({ message: expect.stringMatching(/owner/) });
});

test("a sponsor downloads an attachment their agent received", async () => {
  const { duva, ada } = await withHumansMailbox();
  const linus = duva.signIn("linus@example.org");
  const { data: agent } = await linus.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: agent!.agent.id, address: "hermes@example.com" } });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });
  const params = { path: { mailbox: mailbox!.id } };
  const { data: list } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });

  const { data } = await linus.GET("/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}", {
    params: { path: { ...params.path, message: thread!.messages[0]!.id, attachment: 0 } },
  });

  expect(await (await duva.download(data!.url)).text()).toBe("Hello, PDF!");
});

test("a link stops working once it expires", async () => {
  const { duva, receive, link } = await withHumansMailbox({ downloadLinkLifetime: 1 });
  const message = await receive(await mail("attachment"));
  const { data } = await link(message.id, 0);

  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1_100 });
  onTestFinished(() => void vi.useRealTimers());
  const download = await duva.download(data!.url);

  expect(download.status).toBe(404);
  expect(await download.text()).toMatch(/expired/);
});

test("a link Duva never gave doesn't work", async () => {
  const { duva, receive, link } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));
  const { data } = await link(message.id, 0);

  const download = await duva.download(`${data!.url.slice(0, -4)}AAAA`);

  expect(download.status).toBe(404);
});

test("asking for an attachment the message doesn't have, or a message the mailbox doesn't have, gets 404", async () => {
  const { receive, link } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));

  const beyond = await link(message.id, 2);
  const unknown = await link("no-such-message", 0);

  expect(beyond.response.status).toBe(404);
  expect(beyond.error).toEqual({ message: "The message has 2 attachments. Give attachment from 0 to 1." });
  expect(unknown.response.status).toBe(404);
});

test("forwarding a message makes a draft with Fwd:, the original's text quoted, and its attachments", async () => {
  const { linusId, receive, forward } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));

  const draft = await forward({ forwards: message.id });

  expect(draft).toEqual({
    id: expect.any(String),
    forwards: message.id,
    thread: expect.any(String),
    from: "linus@example.com",
    to: [],
    cc: [],
    bcc: [],
    subject: "Fwd: The report",
    text: [
      "",
      "",
      "Forwarded message",
      "From: Grace Hopper <grace@example.org>",
      "Date: Sat, 03 Oct 2026 10:15:00 GMT",
      "Subject: The report",
      "To: hermes@example.com",
      "",
      "> The report and its data are attached.",
    ].join("\n"),
    attachments: [
      { name: "report.pdf", type: "application/pdf", size: 11 },
      { type: "text/csv", size: 8 },
    ],
    updatedAt: expect.any(String),
    updatedBy: linusId,
  });
});

test("a forward of a forward carries a single Fwd:", async () => {
  const { receive, forward } = await withHumansMailbox();
  const message = await receive((await mail("attachment")).replace("Subject: The report", "Subject: FWD: fw: The report"));

  const draft = await forward({ forwards: message.id });

  expect(draft.subject).toBe("Fwd: The report");
});

test("a human's forward goes out at once with the attachments, their names and types, and joins the thread", async () => {
  const { duva, linus, params, receive, forward, send, link } = await withHumansMailbox();
  const message = await receive(nordic);
  const draft = await forward({ forwards: message.id, to: ["iris@example.net"], text: "Se bilagan.\n\n> Här är ritningarna." });

  const sent = await send(draft.id);

  expect(sent.send?.state).toBe("sent");
  expect(duva.sentTo()).toEqual([["iris@example.net"]]);
  const raw = duva.sent()[0]!;
  expect(raw).toMatch(/^Content-Type: multipart\/mixed;\r\n boundary=/m);
  const parsed = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  expect(parsed.subject).toBe("Fwd: Ritningar");
  expect(parsed.text?.replaceAll("\r\n", "\n").trimEnd()).toBe("Se bilagan.\n\n> Här är ritningarna.");
  expect(parsed.attachments.map(({ filename, mimeType, content }) => ({ filename, mimeType, content: new Uint8Array(content as ArrayBuffer) }))).toEqual([
    { filename: "rå æblerød äng.png", mimeType: "image/png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]) },
  ]);
  expect(parsed.headers.some(({ key }) => key === "duva-agent")).toBe(false);
  const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: sent.send!.thread! } } });
  expect(sent.send!.thread).toBe(draft.thread);
  expect(thread!.messages.map(({ subject }) => subject)).toEqual(["Ritningar", "Fwd: Ritningar"]);
  const forwarded = thread!.messages[1]!;
  expect(forwarded.attachments).toEqual([{ name: "rå æblerød äng.png", type: "image/png", size: 6 }]);
  const { data: again } = await link(forwarded.id, 0);
  expect(new Uint8Array(await (await duva.download(again!.url)).arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]));
});

test("a forward's MIME names attachments in both RFC 2231 and RFC 2047, so every client reads a Nordic name", async () => {
  const { duva, receive, forward, send } = await withHumansMailbox();
  const message = await receive(nordic);
  await send((await forward({ forwards: message.id, to: ["iris@example.net"] })).id);

  const raw = duva.sent()[0]!;

  expect(raw).toContain(`Content-Type: image/png;\r\n name="=?UTF-8?B?${Buffer.from("rå æblerød äng.png").toString("base64")}?="`);
  expect(raw).toContain("Content-Disposition: attachment;\r\n filename*=UTF-8''r%C3%A5%20%C3%A6bler%C3%B8d%20%C3%A4ng.png");
  // SES writes the Message-ID, so only Duva's lines count.
  expect(raw.split("\r\n").filter((line) => line.length > 78 && !line.startsWith("Message-ID:"))).toEqual([]);
});

test("an agent's forward waits for its sponsor's approval, which shows the attachments, and goes out with them", async () => {
  const { duva, ada } = await withHumansMailbox();
  const linus = duva.signIn("linus@example.org");
  const { data: created } = await linus.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { forwards: thread!.messages[0]!.id, to: ["iris@example.net"] } });

  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  const { data: approvals } = await linus.GET("/approvals");

  expect(asked!.send?.state).toBe("waiting");
  expect(duva.sent()).toEqual([]);
  expect(approvals!.approvals[0]!.draft).toMatchObject({ forwards: thread!.messages[0]!.id, attachments: [{ name: "report.pdf", type: "application/pdf", size: 11 }, { type: "text/csv", size: 8 }] });

  await linus.POST("/approvals/{approval}/send", { params: { path: { approval: approvals!.approvals[0]!.id } }, body: {} });

  const parsed = await PostalMime.parse(duva.sent()[0]!);
  expect(parsed.subject).toBe("Fwd: The report");
  expect(parsed.attachments.map(({ filename, mimeType }) => ({ filename, mimeType }))).toEqual([
    { filename: "report.pdf", mimeType: "application/pdf" },
    { filename: null, mimeType: "text/csv" },
  ]);
  expect(parsed.headers.find(({ key }) => key === "duva-agent")?.value).toBe("Hermes for linus@example.org");
});

test("a draft can't both reply and forward, and can't forward a message the mailbox doesn't have", async () => {
  const { linus, params, receive } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));

  const both = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: message.id, forwards: message.id } });
  const unknown = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body: { forwards: "no-such-message" } });

  expect(both.response.status).toBe(400);
  expect(unknown.response.status).toBe(404);
});

test("an attachment name with a line break can't add header fields to a forward", async () => {
  const { duva, receive, forward, send } = await withHumansMailbox();
  const message = await receive(nordic.replace("filename*=UTF-8''r%C3%A5%20%C3%A6bler%C3%B8d%20%C3%A4ng.png", "filename*=UTF-8''a.png%0D%0AX-Injected:%20yes"));
  await send((await forward({ forwards: message.id, to: ["iris@example.net"] })).id);

  const parsed = await PostalMime.parse(duva.sent()[0]!);

  expect(duva.sent()[0]).not.toMatch(/^X-Injected/m);
  expect(parsed.attachments).toHaveLength(1);
});

/** Moves the thread of the message to Trash and empties it, erasing the thread for good. */
async function erase(linus: ReturnType<Awaited<ReturnType<typeof startDuva>>["signIn"]>, params: { path: { mailbox: string } }, thread: string) {
  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"] } });
  await linus.POST("/mailboxes/{mailbox}/trash/empty", { params });
}

test("a download link stops working once its thread is erased", async () => {
  const { duva, linus, params, receive, link } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));
  const { data } = await link(message.id, 0);
  const { data: list } = await linus.GET("/mailboxes/{mailbox}/threads", { params });

  await erase(linus, params, list!.threads[0]!.id);
  const download = await duva.download(data!.url);

  expect(download.status).toBe(404);
  expect(await link(message.id, 0).then(({ response }) => response.status)).toBe(404);
});

test("a forward whose message was erased isn't sent without its attachments, and says why", async () => {
  const { duva, linus, params, receive, forward, send } = await withHumansMailbox();
  const message = await receive(await mail("attachment"));
  const draft = await forward({ forwards: message.id, to: ["iris@example.net"] });

  await erase(linus, params, draft.thread!);
  const sent = await send(draft.id);

  expect(sent.send).toMatchObject({ state: "failed", reason: expect.stringMatching(/no longer in the mailbox/) });
  expect(duva.sent()).toEqual([]);
});
