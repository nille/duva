import { createHash } from "node:crypto";
import PostalMime from "postal-mime";
import type { DuvaClient } from "@duva/client";
import { expect, test } from "vitest";
import { type Duva, startDuva } from "./harness.ts";

const mebibytes = (count: number) => count * 1024 * 1024;
const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");
const text = (content: string) => new TextEncoder().encode(content);
const day = 24 * 60 * 60 * 1000;

// Sent at noon on 9 October 2026, a link works until 8 November, 30 days on.
const sentAt = new Date("2026-10-09T12:00:00Z");
// The clock goes on from there, so the send is a moment later.
const thirtyDaysOn = expect.stringMatching(/^2026-11-08T12:00:/);

/**
 * A deployment on example.com where ada, the first admin, has a personal mailbox at ada@example.com,
 * without a Screener, and sponsors the agent Hermes, which she gives send sponsor access there.
 * Linus is another human, with a mailbox at linus@example.com. The clock reads noon on 9 October 2026.
 */
async function withMailbox(options: { undoWindowSeconds?: number } = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"], accessTokenLifetime: 400 * 24 * 60 * 60 });
  await duva.clock(sentAt);
  const ada = duva.signIn("ada@example.org");
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: humans } = await ada.GET("/humans");
  const linus = humans!.humans.find(({ email }) => email === "linus@example.org")!;
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: sponsor!.id, address: "ada@example.com" } });
  await ada.POST("/mailboxes", { body: { owner: linus.id, address: "linus@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  if (options.undoWindowSeconds !== undefined) await ada.PATCH("/organization/settings", { body: { undoWindowSeconds: options.undoWindowSeconds } });
  const hermes = duva.withKey(created!.key);
  const draft = async (as: DuvaClient = ada, body: { to?: string[]; cc?: string[]; subject?: string; text?: string; forwards?: string; linkDays?: 7 | 30 | 365 } = { to: ["grace@example.org"], subject: "The film", text: "Here it is." }) =>
    (await as.POST("/mailboxes/{mailbox}/drafts", { params, body })).data!;
  const at = (id: string) => ({ params: { path: { ...params.path, draft: id } } });
  const attach = (as: DuvaClient, id: string, file: { name: string; type?: string; content: Uint8Array<ArrayBuffer> }) => upload(duva, as, mailbox!.id, id, file);
  return { duva, ada, hermes, sponsor: sponsor!, mailbox: mailbox!, params, draft, at, attach };
}

/** Uploads the file to the draft as a client does: starts the upload, PUTs each part to its URL, then completes it. */
async function upload(duva: Duva, as: DuvaClient, mailbox: string, draft: string, file: { name: string; type?: string; content: Uint8Array<ArrayBuffer> }) {
  const path = { mailbox, draft };
  const { data: started } = await as.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { params: { path }, body: { name: file.name, type: file.type, size: file.content.byteLength } });
  for (const { number, url } of started!.parts) await duva.upload(url, file.content.subarray((number - 1) * started!.partSize, number * started!.partSize));
  return (await as.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...path, upload: started!.id } } })).data!;
}

/** The pages of the linked files the raw message lists, in its text. */
const pagesIn = (message: string) => [...message.matchAll(/https?:\/\/\S+\/download\/files\/[\w-]+/g)].map(([url]) => url);

/** The sent message in the mailbox, as Duva shows it. */
async function sentMessage(ada: DuvaClient, mailbox: string) {
  const { data: sent } = await ada.GET("/mailboxes/{mailbox}/sent", { params: { path: { mailbox } } });
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox, thread: sent!.threads[0]!.id } } });
  return thread!.messages.at(-1)!;
}

/** Opens the linked file's page, presses Download, and follows the browser on to the file. */
async function downloadFrom(duva: Duva, page: string) {
  const pressed = await duva.download(`${page}/file`);
  expect(pressed.status).toBe(302);
  return duva.download(pressed.headers.get("location")!);
}

test("when the files would make the message more than 10 MB, the largest goes as a linked file, listed after the text, for every recipient", async () => {
  const { duva, ada, mailbox, draft, at, attach } = await withMailbox();
  const film = new Uint8Array(mebibytes(4)).map((_, index) => index % 251);
  const { id } = await draft(ada, { to: ["grace@example.org"], cc: ["linus@example.com"], subject: "The film", text: "Here it is." });
  await attach(ada, id, { name: "film.mov", type: "video/quicktime", content: film });
  await attach(ada, id, { name: "stills.zip", type: "application/zip", content: new Uint8Array(mebibytes(3)) });
  const { attachments } = await attach(ada, id, { name: "notes.txt", type: "text/plain", content: text("Notes") });

  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const raw = duva.sent().at(-1)!;
  const sent = await PostalMime.parse(raw, { attachmentEncoding: "utf8" });
  const [page] = pagesIn(sent.text!);

  // 4 MiB and 3 MiB are 10.04 MB as base64, so the 4 MiB file goes as a link and the rest fits.
  expect(attachments!.map(({ name, linked }) => ({ name, linked }))).toEqual([{ name: "film.mov", linked: "needed" }, { name: "stills.zip" }, { name: "notes.txt" }]);
  expect(sent.attachments.map(({ filename }) => filename)).toEqual(["stills.zip", "notes.txt"]);
  expect(sent.text).toBe(`Here it is.\n\n1 file, until 8 November 2026\nfilm.mov, 4.0 MB: ${page}\n`);
  expect(sent.html).toContain(`<p>1 file, until 8 November 2026</p>\n<ul>\n<li><a href="${page}">film.mov</a>, 4.0 MB</li>\n</ul>`);
  expect(duva.sentTo().at(-1)).toEqual(["grace@example.org", "linus@example.com"]);
  const message = await sentMessage(ada, mailbox.id);
  expect(message.text).toBe("Here it is.");
  expect(message.html).toBeUndefined();
  expect(message.linkedFiles).toEqual([{ id: attachments![0]!.id, name: "film.mov", type: "video/quicktime", size: mebibytes(4), until: thirtyDaysOn, state: "sharing", downloads: 0 }]);
  expect(sha256(new Uint8Array(await (await downloadFrom(duva, page!)).arrayBuffer()))).toBe(sha256(film));
});

test("the sender links any file by choice, for 7 days, 30 or a year", async () => {
  const { duva, ada, params, draft, at, attach } = await withMailbox();
  const { id } = await draft();
  const { attachments } = await attach(ada, id, { name: "notes.txt", type: "text/plain", content: text("Notes") });
  const attachment = { params: { path: { ...params.path, draft: id, attachment: attachments![0]!.id } } };

  const { data: linked } = await ada.PATCH("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { ...attachment, body: { linked: true } });
  const { data: weekly } = await ada.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...at(id), body: { linkDays: 7 } });
  const wrong = await ada.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...at(id), body: { linkDays: 14 as 7 } });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const sent = await PostalMime.parse(duva.sent().at(-1)!);

  expect(linked!.attachments).toEqual([{ id: attachments![0]!.id, name: "notes.txt", type: "text/plain", size: 5, source: "uploaded", linked: "chosen" }]);
  expect(weekly!.linkDays).toBe(7);
  expect(wrong.response.status).toBe(400);
  expect(wrong.error!.message).toBe("Give linkDays as 7, 30 or 365: how many days the links of its linked files work after the send.");
  expect(sent.attachments).toEqual([]);
  expect(sent.text).toBe(`Here it is.\n\n1 file, until 16 October 2026\nnotes.txt, 5 bytes: ${pagesIn(sent.text!)[0]}\n`);
});

test("a linked file's page names it, its size, its sender and its end, and only its Download button counts", async () => {
  const { duva, ada, mailbox, draft, at, attach } = await withMailbox();
  const { id } = await draft(ada, { to: ["grace@example.org"], subject: "The film", text: "Here it is.", linkDays: 365 });
  await attach(ada, id, { name: "film <final>.mov", type: "video/quicktime", content: new Uint8Array(mebibytes(11)) });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const [page] = pagesIn((await PostalMime.parse(duva.sent().at(-1)!)).text!);

  const opened = await duva.download(page!);
  const html = await opened.text();
  await duva.download(page!);
  await downloadFrom(duva, page!);
  await downloadFrom(duva, page!);
  const { data: changes } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: mailbox.id } } });
  const message = await sentMessage(ada, mailbox.id);

  expect(opened.status).toBe(200);
  expect(opened.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(html).toContain("<h1>film &lt;final&gt;.mov</h1>");
  expect(html).toContain("<p>ada@example.com sent you a file.</p>");
  expect(html).toContain("<p>11.0 MB, until 9 October 2027</p>");
  expect(html).toContain('<button type="submit">Download</button>');
  // The page is small, so a link scanner that opens it fetches nothing large.
  expect(html.length).toBeLessThan(4000);
  expect(message.linkedFiles![0]).toMatchObject({ state: "sharing", downloads: 2 });
  expect(changes!.changes.filter(({ type }) => type === "linkedFileDownloaded")).toEqual([
    { position: expect.any(Number), at: expect.any(String), type: "linkedFileDownloaded", thread: expect.any(String), message: message.id, file: message.linkedFiles![0]!.id, name: "film <final>.mov" },
  ]);
});

test("a link ends 30 days after the send, and its file is deleted then", async () => {
  const { duva, ada, mailbox, params, draft, at, attach } = await withMailbox();
  const { id } = await draft();
  const { attachments } = await attach(ada, id, { name: "notes.txt", content: text("Notes") });
  await ada.PATCH("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { ...params.path, draft: id, attachment: attachments![0]!.id } }, body: { linked: true } });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const [page] = pagesIn((await PostalMime.parse(duva.sent().at(-1)!)).text!);

  await duva.clock(new Date(sentAt.getTime() + 30 * day - 60_000));
  const before = await downloadFrom(duva, page!);
  const kept = duva.uploads().files;
  await duva.clock(new Date(sentAt.getTime() + 30 * day + 60_000));
  const after = await duva.download(page!);
  const pressed = await duva.download(`${page}/file`);

  expect(await before.text()).toBe("Notes");
  expect(kept).toEqual(["Notes"]);
  expect(after.status).toBe(410);
  expect(await after.text()).toContain("The link to notes.txt expired on 8 November 2026, so the file was deleted. Ask ada@example.com to send it again.");
  expect(pressed.status).toBe(410);
  expect(duva.uploads().files).toEqual([]);
  expect((await sentMessage(ada, mailbox.id)).linkedFiles![0]).toMatchObject({ state: "expired", downloads: 1 });
});

test("stopping sharing a linked file ends its link at once and deletes the file", async () => {
  const { duva, ada, mailbox, params, draft, at, attach } = await withMailbox();
  const { id } = await draft();
  await attach(ada, id, { name: "film.mov", content: new Uint8Array(mebibytes(11)) });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const [page] = pagesIn((await PostalMime.parse(duva.sent().at(-1)!)).text!);
  const message = await sentMessage(ada, mailbox.id);
  const stop = (as: DuvaClient) => as.DELETE("/mailboxes/{mailbox}/messages/{message}/linked-files/{file}", { params: { path: { ...params.path, message: message.id, file: message.linkedFiles![0]!.id } } });

  const refused = await stop(duva.signIn("linus@example.org"));
  const { data: stopped } = await stop(ada);
  const again = await stop(ada);
  const opened = await duva.download(page!);
  const pressed = await duva.download(`${page}/file`);
  const { data: changes } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: mailbox.id } } });

  expect(refused.response.status).toBe(403);
  expect(stopped).toEqual({ id: message.linkedFiles![0]!.id, name: "film.mov", type: "application/octet-stream", size: mebibytes(11), until: thirtyDaysOn, state: "stopped", downloads: 0 });
  expect(again.data).toEqual(stopped);
  expect(opened.status).toBe(410);
  expect(await opened.text()).toContain("ada@example.com stopped sharing film.mov, so it was deleted. Ask them to send it again.");
  expect(pressed.status).toBe(410);
  expect(duva.uploads().files).toEqual([]);
  expect(changes!.changes.filter(({ type }) => type === "sharingStopped")).toEqual([
    { position: expect.any(Number), at: expect.any(String), actor: expect.any(String), type: "sharingStopped", message: message.id, file: message.linkedFiles![0]!.id },
  ]);
});

test("erasing the sent mail ends its links and deletes their files", async () => {
  const { duva, ada, params, draft, at, attach } = await withMailbox();
  const { id } = await draft();
  await attach(ada, id, { name: "film.mov", content: new Uint8Array(mebibytes(11)) });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const [page] = pagesIn((await PostalMime.parse(duva.sent().at(-1)!)).text!);
  const { data: sent } = await ada.GET("/mailboxes/{mailbox}/sent", { params });

  await ada.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [sent!.threads[0]!.id], add: ["trash"] } });
  await ada.POST("/mailboxes/{mailbox}/trash/empty", { params });
  const opened = await duva.download(page!);

  expect(opened.status).toBe(404);
  expect(await opened.text()).toContain("This link never worked, or the mail it came in was erased.");
  expect(duva.uploads().files).toEqual([]);
  expect((await ada.GET("/humans")).data!.humans.find(({ email }) => email === "ada@example.org")!.linkedSize).toBe(0);
});

test("an agent's send that would link a file shows so in Approvals, and an undone approval shares nothing", async () => {
  const { duva, ada, hermes, draft, at, attach } = await withMailbox({ undoWindowSeconds: 30 });
  const { id } = await draft(hermes);
  await attach(hermes, id, { name: "film.mov", content: new Uint8Array(mebibytes(11)) });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));

  const { data: approvals } = await ada.GET("/approvals");
  const pending = approvals!.approvals[0]!;
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: pending.id } }, body: {} });
  await ada.POST("/approvals/{approval}/undo", { params: { path: { approval: pending.id } } });
  await duva.clock(new Date(sentAt.getTime() + 60_000));
  const humans = (await ada.GET("/humans")).data!.humans;

  expect(pending.draft.attachments).toEqual([{ id: expect.any(String), name: "film.mov", type: "application/octet-stream", size: mebibytes(11), source: "uploaded", linked: "needed" }]);
  expect(duva.sent()).toEqual([]);
  expect(humans.find(({ email }) => email === "ada@example.org")!.linkedSize).toBe(0);
});

test("an agent's linked files count toward its sponsor's total, and past the organization's cap a send that would link more is refused", async () => {
  const { ada, hermes, draft, at, attach } = await withMailbox();
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: (await hermes.GET("/whoami")).data!.id } }, body: { approvalAsSponsor: false } });
  const { id } = await draft(hermes);
  await attach(hermes, id, { name: "film.mov", content: new Uint8Array(mebibytes(11)) });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const shared = (await ada.GET("/humans")).data!.humans.find(({ email }) => email === "ada@example.org")!.linkedSize;

  await ada.PATCH("/organization/settings", { body: { linkedFilesCapGb: 0 } });
  const { id: next } = await draft(ada);
  await attach(ada, next, { name: "cut.mov", content: new Uint8Array(mebibytes(11)) });
  const refused = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(next));
  const { id: small } = await draft(ada);
  await attach(ada, small, { name: "notes.txt", content: text("Notes") });
  const carried = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(small));

  expect(shared).toBe(mebibytes(11));
  expect(refused.response.status).toBe(409);
  expect(refused.error!.message).toBe(
    "Its linked files would take you past the 0 GB of linked files the organization lets each human have linked at once. Stop sharing older files in the sent mail, or ask an admin to raise the cap.",
  );
  expect(carried.response.status).toBe(202);
});

test("forwarding a sent mail with linked files carries the same links, with their dates", async () => {
  const { duva, ada, mailbox, draft, at, attach } = await withMailbox();
  const { id } = await draft();
  await attach(ada, id, { name: "film.mov", content: new Uint8Array(mebibytes(11)) });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const [page] = pagesIn((await PostalMime.parse(duva.sent().at(-1)!)).text!);
  const original = await sentMessage(ada, mailbox.id);

  await duva.clock(new Date(sentAt.getTime() + 2 * day));
  const forward = await draft(ada, { forwards: original.id, to: ["linus@example.com"] });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(forward.id));
  const forwarded = await PostalMime.parse(duva.sent().at(-1)!);
  await downloadFrom(duva, page!);

  expect(forward.attachments).toEqual([{ id: expect.any(String), name: "film.mov", type: "application/octet-stream", size: mebibytes(11), source: "linked", until: thirtyDaysOn }]);
  expect(forwarded.attachments).toEqual([]);
  expect(forwarded.text!.endsWith(`\n\n1 file, until 8 November 2026\nfilm.mov, 11.0 MB: ${page}\n`)).toBe(true);
  expect(pagesIn(forwarded.text!)).toEqual([page]);
  expect((await sentMessage(ada, mailbox.id)).linkedFiles).toEqual([{ id: forward.attachments![0]!.id, name: "film.mov", type: "application/octet-stream", size: mebibytes(11), until: thirtyDaysOn, state: "sharing", downloads: 1 }]);
});

test("a made-up link's page answers 404", async () => {
  const { duva, ada, draft, at, attach } = await withMailbox();
  const { id } = await draft();
  await attach(ada, id, { name: "film.mov", content: new Uint8Array(mebibytes(11)) });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const [page] = pagesIn((await PostalMime.parse(duva.sent().at(-1)!)).text!);

  const answer = await duva.download(page!.replace(/[\w-]+$/, "made-up-token"));

  expect(answer.status).toBe(404);
});
