import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import PostalMime from "postal-mime";
import type { DuvaClient } from "@duva/client";
import { expect, test } from "vitest";
import { type Duva, startDuva } from "./harness.ts";

const mail = (name: string) => readFile(new URL(`./mail/${name}.eml`, import.meta.url), "utf8");

/** The count of mebibytes in bytes, as an upload's part size is given. */
const mebibytes = (count: number) => count * 1024 * 1024;

/**
 * A deployment on example.com where ada, the first admin, has a personal mailbox at ada@example.com,
 * without a Screener, and sponsors the agent Hermes, which she gives send sponsor access there.
 * Linus is another human, with no access to it.
 */
async function withMailbox() {
  // Sessions outlast the clock moved a day on.
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"], accessTokenLifetime: 2 * 24 * 60 * 60 });
  const ada = duva.signIn("ada@example.org");
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: sponsor!.id, address: "ada@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);
  const draft = async (as: DuvaClient = ada, body: { to?: string[]; subject?: string; text?: string; forwards?: string } = { to: ["grace@example.org"], subject: "The report", text: "Here it is." }) =>
    (await as.POST("/mailboxes/{mailbox}/drafts", { params, body })).data!;
  const at = (id: string) => ({ params: { path: { ...params.path, draft: id } } });
  return { duva, ada, hermes, agent: created!.agent, mailbox: mailbox!, params, draft, at };
}

/** Uploads the file to the draft as a client does: starts the upload, PUTs each part to its URL, then completes it. */
async function attach(duva: Duva, as: DuvaClient, mailbox: string, draft: string, file: { name: string; type?: string; content: Uint8Array<ArrayBuffer> }) {
  const path = { mailbox, draft };
  const { data: upload } = await as.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { params: { path }, body: { name: file.name, type: file.type, size: file.content.byteLength } });
  for (const { number, url } of upload!.parts) {
    const answer = await duva.upload(url, file.content.subarray((number - 1) * upload!.partSize, number * upload!.partSize));
    expect(answer.status).toBe(200);
  }
  return as.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...path, upload: upload!.id } } });
}

const text = (content: string) => new TextEncoder().encode(content);
const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

test("a human uploads a file to a draft, and the draft lists it with its name, type and size", async () => {
  const { duva, ada, mailbox, draft, at } = await withMailbox();
  const { id } = await draft();

  const { response, data } = await attach(duva, ada, mailbox.id, id, { name: "Kvartalsrapport.pdf", type: "application/pdf", content: text("Hello, PDF!") });

  expect(response.status).toBe(200);
  expect(data!.attachments).toEqual([{ id: expect.any(String), name: "Kvartalsrapport.pdf", type: "application/pdf", size: 11, source: "uploaded" }]);
  expect((await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", at(id))).data!.attachments).toEqual(data!.attachments);
});

test("a file larger than a part goes in parts, which make it whole in any order, and its link downloads it", async () => {
  const { duva, ada, mailbox, draft, at, params } = await withMailbox();
  const { id } = await draft();
  const content = new Uint8Array(mebibytes(32) + 5).map((_, index) => index % 251);

  const { data: upload } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "big.bin", size: content.byteLength } });
  expect(upload).toMatchObject({ name: "big.bin", type: "application/octet-stream", size: mebibytes(32) + 5, partSize: mebibytes(32), parts: [{ number: 1 }, { number: 2 }] });
  await duva.upload(upload!.parts[1]!.url, content.subarray(mebibytes(32)));
  await duva.upload(upload!.parts[0]!.url, content.subarray(0, mebibytes(32)));
  const { data: completed } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...at(id).params.path, upload: upload!.id } } });
  const { data: link } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { ...params.path, draft: id, attachment: completed!.attachments![0]!.id } } });
  const downloaded = await duva.download(link!.url);

  expect(link).toEqual({ name: "big.bin", type: "application/octet-stream", size: mebibytes(32) + 5, url: expect.any(String), expiresAt: expect.any(String) });
  expect(downloaded.status).toBe(200);
  // Compared by their hashes, as the diff of 32 MB would fill the heap.
  expect(sha256(new Uint8Array(await downloaded.arrayBuffer()))).toBe(sha256(content));
});

test("completing an upload with a part missing or the wrong size says which, and attaches nothing", async () => {
  const { duva, ada, draft, at } = await withMailbox();
  const { id } = await draft();
  const { data: upload } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "big.bin", size: mebibytes(32) + 5 } });
  const complete = () => ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...at(id).params.path, upload: upload!.id } } });

  await duva.upload(upload!.parts[1]!.url, new Uint8Array(4));
  const { response, error } = await complete();

  expect(response.status).toBe(409);
  expect(error).toEqual({
    message: `Part 1 of 2 isn't uploaded yet. Part 2 has the wrong size: each part but the last has ${mebibytes(32)} bytes. Upload them, then complete the upload.`,
  });
  expect((await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", at(id))).data!.attachments ?? []).toEqual([]);
});

test("a part's link stops working after an hour, and getting the upload again gives links that work", async () => {
  const { duva, ada, draft, at } = await withMailbox();
  const { id } = await draft();
  const { data: upload } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "notes.txt", type: "text/plain", size: 5 } });

  await duva.clock(new Date(Date.now() + 61 * 60_000));
  const expired = await duva.upload(upload!.parts[0]!.url, text("Notes"));
  const { data: again } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}", { params: { path: { ...at(id).params.path, upload: upload!.id } } });
  const renewed = await duva.upload(again!.parts[0]!.url, text("Notes"));
  const { data: completed } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...at(id).params.path, upload: upload!.id } } });

  expect(expired.status).toBe(403);
  expect(renewed.status).toBe(200);
  expect(completed!.attachments).toEqual([{ id: upload!.id, name: "notes.txt", type: "text/plain", size: 5, source: "uploaded" }]);
});

test("an upload never completed is given up after a day, and can't be completed then", async () => {
  const { duva, ada, draft, at } = await withMailbox();
  const { id } = await draft();
  const { data: upload } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "notes.txt", size: 5 } });
  await duva.upload(upload!.parts[0]!.url, text("Notes"));
  expect(duva.uploads().incomplete).toBe(1);

  await duva.clock(new Date(Date.now() + 25 * 60 * 60_000));
  const { response, error } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...at(id).params.path, upload: upload!.id } } });

  expect(duva.uploads()).toEqual({ files: [], incomplete: 0 });
  expect(response.status).toBe(404);
  expect(error!.message).toBe(`The draft has no upload ${JSON.stringify(upload!.id)} waiting: it was completed, or given up after a day. Start it again.`);
});

test("a file must have a name and a size from 1 byte to 5 GB", async () => {
  const { ada, draft, at } = await withMailbox();
  const { id } = await draft();
  const start = (body: { name: string; size: number }) => ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body });

  const empty = await start({ name: "empty.txt", size: 0 });
  const huge = await start({ name: "huge.iso", size: 5 * 1024 ** 3 + 1 });
  const nameless = await start({ name: " ", size: 5 });
  const largest = await start({ name: "largest.iso", size: 5 * 1024 ** 3 });

  expect([empty.response.status, huge.response.status, nameless.response.status]).toEqual([400, 400, 400]);
  expect(empty.error!.message).toBe("Give the file's size in bytes, from 1 to 5 GB. An empty file can't be attached.");
  expect(nameless.error!.message).toBe("Give the file's name as one line of 1 to 255 characters.");
  expect(largest.data!.parts).toHaveLength(160);
});

test("only those who can draft in the mailbox upload to its drafts", async () => {
  const { duva, ada, draft, at } = await withMailbox();
  const { id } = await draft();
  const linus = duva.signIn("linus@example.org");
  const { data: reader } = await ada.POST("/agents", { body: { name: "Reader" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: reader!.agent.id } }, body: { sponsorAccess: "read" } });

  const asLinus = await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "a.txt", size: 1 } });
  const asReader = await duva.withKey(reader!.key).POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "a.txt", size: 1 } });

  expect(asLinus.response.status).toBe(403);
  expect(asReader.response.status).toBe(403);
});

test("a human's draft goes out with its uploaded files and a forward's beside them, and the bucket no longer keeps them", async () => {
  const { duva, ada, mailbox, params, draft, at } = await withMailbox();
  await duva.receive(await mail("attachment"), { to: ["ada@example.com"] });
  const { data: list } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
  const forward = await draft(ada, { forwards: thread!.messages[0]!.id, to: ["grace@example.org"] });
  await attach(duva, ada, mailbox.id, forward.id, { name: "Bilaga åäö.txt", type: "text/plain", content: text("Hej Grace!") });

  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(forward.id));
  const sent = await PostalMime.parse(duva.sent().at(-1)!, { attachmentEncoding: "utf8" });

  expect((await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", at(forward.id))).data!.send?.state).toBe("sent");
  expect(sent.attachments.map(({ filename, mimeType, content }) => ({ filename, mimeType, content }))).toEqual([
    { filename: "report.pdf", mimeType: "application/pdf", content: "Hello, PDF!" },
    { filename: null, mimeType: "text/csv", content: "a,b\n1,2\n" },
    { filename: "Bilaga åäö.txt", mimeType: "text/plain", content: "Hej Grace!" },
  ]);
  expect(duva.uploads()).toEqual({ files: [], incomplete: 0 });
});

test("removing attachments takes a forward's off the message and deletes an uploaded file", async () => {
  const { duva, ada, mailbox, params, draft, at } = await withMailbox();
  await duva.receive(await mail("attachment"), { to: ["ada@example.com"] });
  const { data: list } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
  const forward = await draft(ada, { forwards: thread!.messages[0]!.id, to: ["grace@example.org"] });
  const { data: attached } = await attach(duva, ada, mailbox.id, forward.id, { name: "notes.txt", type: "text/plain", content: text("Notes") });
  const [report, , notes] = attached!.attachments!;
  const remove = (attachment: string) => ada.DELETE("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { ...params.path, draft: forward.id, attachment } } });

  await remove(report!.id);
  const { data: left } = await remove(notes!.id);
  const missing = await remove(notes!.id);
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(forward.id));
  const sent = await PostalMime.parse(duva.sent().at(-1)!);

  expect(left!.attachments).toEqual([{ id: expect.any(String), type: "text/csv", size: 8, source: "forwarded" }]);
  expect(missing.response.status).toBe(404);
  expect(duva.uploads().files).toEqual([]);
  expect(sent.attachments.map(({ mimeType }) => mimeType)).toEqual(["text/csv"]);
});

test("deleting a draft deletes its files, those of uploads not completed too", async () => {
  const { duva, ada, mailbox, draft, at } = await withMailbox();
  const { id } = await draft();
  await attach(duva, ada, mailbox.id, id, { name: "notes.txt", content: text("Notes") });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "later.txt", size: 5 } });
  expect(duva.uploads()).toEqual({ files: ["Notes"], incomplete: 1 });

  await ada.DELETE("/mailboxes/{mailbox}/drafts/{draft}", at(id));

  expect(duva.uploads()).toEqual({ files: [], incomplete: 0 });
});

test("an agent's files wait with its send, each listed in Approvals for its sponsor to open, and go out with the disclosure", async () => {
  const { duva, ada, hermes, mailbox, draft, at } = await withMailbox();
  const { id } = await draft(hermes);
  await attach(duva, hermes, mailbox.id, id, { name: "plan.txt", type: "text/plain", content: text("The plan") });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));

  const { data: approvals } = await ada.GET("/approvals");
  const pending = approvals!.approvals[0]!;
  const file = pending.draft.attachments![0]!;
  const { data: link } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { mailbox: pending.mailbox, draft: pending.draft.id, attachment: file.id } } });
  const opened = await duva.download(link!.url);
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: pending.id } }, body: {} });
  const sent = await PostalMime.parse(duva.sent().at(-1)!, { attachmentEncoding: "utf8" });

  expect(file).toEqual({ id: expect.any(String), name: "plan.txt", type: "text/plain", size: 8, source: "uploaded" });
  expect(opened.headers.get("content-disposition")).toContain("plan.txt");
  expect(await opened.text()).toBe("The plan");
  expect(sent.headers.find(({ key }) => key === "duva-agent")?.value).toBe("Hermes for ada@example.org");
  expect(sent.text).toContain("Sent by Hermes for ada@example.org");
  expect(sent.attachments.map(({ filename, content }) => ({ filename, content }))).toEqual([{ filename: "plan.txt", content: "The plan" }]);
});

test("a file completed or removed while the draft waits for approval withdraws the request", async () => {
  const { duva, ada, hermes, mailbox, draft, at, params } = await withMailbox();
  const { id } = await draft(hermes);
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));

  const { data: attached } = await attach(duva, hermes, mailbox.id, id, { name: "plan.txt", content: text("The plan") });
  const afterAttaching = (await ada.GET("/approvals")).data!.approvals;
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  await hermes.DELETE("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { ...params.path, draft: id, attachment: attached!.attachments![0]!.id } } });

  expect(attached!.send?.state).toBe("withdrawn");
  expect(afterAttaching).toEqual([]);
  expect((await ada.GET("/approvals")).data!.approvals).toEqual([]);
  expect((await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", at(id))).data!.send?.state).toBe("withdrawn");
});

test("a draft that was sent takes no more files and keeps those it has", async () => {
  const { duva, ada, mailbox, draft, at, params } = await withMailbox();
  const { id } = await draft();
  const { data: attached } = await attach(duva, ada, mailbox.id, id, { name: "notes.txt", content: text("Notes") });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));

  const start = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "more.txt", size: 4 } });
  const remove = await ada.DELETE("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { ...params.path, draft: id, attachment: attached!.attachments![0]!.id } } });

  expect(start.response.status).toBe(409);
  expect(start.error!.message).toBe("The draft was sent, so it takes no more files. Write a new draft instead.");
  expect(remove.response.status).toBe(409);
  expect(remove.error!.message).toBe("The draft was sent, so its attachments stay as they are.");
});

test("erasing a deleted mailbox erases the files uploaded to its drafts", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: linus } = await ada.POST("/humans", { body: { email: "linus@example.org" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: linus!.id, address: "linus@example.com" } });
  const asLinus = duva.signIn("linus@example.org");
  const { data: written } = await asLinus.POST("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox!.id } }, body: {} });
  await attach(duva, asLinus, mailbox!.id, written!.id, { name: "notes.txt", content: text("Notes") });

  await ada.POST("/humans/{human}/remove", { params: { path: { human: linus!.id } }, body: { delete: [mailbox!.id] } });

  expect(duva.uploads()).toEqual({ files: [], incomplete: 0 });
});

test("deleting a rejected draft deletes its files", async () => {
  const { duva, ada, hermes, mailbox, draft, at } = await withMailbox();
  const { id } = await draft(hermes);
  await attach(duva, hermes, mailbox.id, id, { name: "plan.txt", content: text("The plan") });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", at(id));
  const { data: approvals } = await ada.GET("/approvals");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval: approvals!.approvals[0]!.id } }, body: { note: "Not this file." } });

  await hermes.DELETE("/mailboxes/{mailbox}/drafts/{draft}", at(id));

  expect(duva.uploads()).toEqual({ files: [], incomplete: 0 });
});

test("completing an upload twice at once, and once more, attaches the file once", async () => {
  const { duva, ada, draft, at } = await withMailbox();
  const { id } = await draft();
  const { data: upload } = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { ...at(id), body: { name: "notes.txt", size: 5 } });
  await duva.upload(upload!.parts[0]!.url, text("Notes"));
  const complete = () => ada.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...at(id).params.path, upload: upload!.id } } });

  const [first, second] = await Promise.all([complete(), complete()]);
  const again = await complete();

  expect([first.response.status, second.response.status, again.response.status]).toEqual([200, 200, 200]);
  expect(again.data!.attachments).toEqual([{ id: upload!.id, name: "notes.txt", type: "application/octet-stream", size: 5, source: "uploaded" }]);
  expect(duva.uploads().files).toEqual(["Notes"]);
});
