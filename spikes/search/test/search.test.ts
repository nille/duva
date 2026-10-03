// The behavior suite: the search module through its interface only, on the
// fixture mailbox. It is the contract any engine behind the module passes.
// It runs on a table on local disk, and on S3 when SEARCH_SPIKE_S3_URI is set.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { lanceSearch } from "../src/lancedb-search.ts";
import type { MailboxSearch, SearchEngine, SearchHit } from "../src/search.ts";
import { fixture } from "./fixture.ts";

const localDirectories: string[] = [];
function localDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "duva-search-"));
  localDirectories.push(directory);
  return directory;
}
afterAll(() => {
  for (const directory of localDirectories) rmSync(directory, { recursive: true, force: true });
});

const locations: [string, () => SearchEngine][] = [
  ["a table on local disk", () => lanceSearch({ uri: localDirectory() })],
];
const s3 = process.env.SEARCH_SPIKE_S3_URI;
if (s3) {
  locations.push([
    "a table on S3",
    () => lanceSearch({ uri: s3, storageOptions: { region: process.env.AWS_REGION ?? "eu-north-1" } }),
  ]);
}

const notSpamOrTrash = { labels: { exclude: ["Spam", "Trash"] } };
const ids = (hits: SearchHit[]) => hits.map((h) => h.messageId);

describe.each(locations)("Search on %s", (_, engine) => {
  let mailbox: MailboxSearch;

  beforeEach(async () => {
    mailbox = await engine().mailbox(`mailbox-${randomUUID()}`);
    await mailbox.add(fixture);
  });

  test("a word finds every message that has it, in its subject or its text", async () => {
    const hits = await mailbox.search({ words: "kayak", limit: 10 });
    expect(ids(hits).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-spam", "kayak-trash"]);
  });

  test("the message that is most about a word ranks first", async () => {
    const hits = await mailbox.search({ words: "kayak", filters: notSpamOrTrash, limit: 10 });
    expect(ids(hits)).toEqual(["kayak-rental", "kayak-club"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  test("several words find only messages that have every one of them", async () => {
    const hits = await mailbox.search({ words: "hosting invoice april", limit: 10 });
    expect(ids(hits).sort()).toEqual(["invoice-question"]);
  });

  test("the words of a phrase out of order don't match the phrase", async () => {
    const words = await mailbox.search({ words: "quarterly budget review", limit: 10 });
    expect(ids(words).sort()).toEqual(["budget-review", "budget-shuffled", "budget-slides"]);

    const phrase = await mailbox.search({ phrase: "quarterly budget review", limit: 10 });
    expect(ids(phrase).sort()).toEqual(["budget-review", "budget-slides"]);
  });

  test("a phrase of common words matches only where they stand together", async () => {
    const hits = await mailbox.search({ phrase: "out of office", limit: 10 });
    expect(ids(hits)).toEqual(["out-of-office"]);
  });

  test("words and a phrase together find messages that have both", async () => {
    const hits = await mailbox.search({ words: "slides", phrase: "quarterly budget review", limit: 10 });
    expect(ids(hits)).toEqual(["budget-slides"]);
  });

  test("a message with every included label is found, and one with some of them isn't", async () => {
    const hits = await mailbox.search({ words: "invoice", filters: { labels: { include: ["Inbox", "Invoices"] } }, limit: 10 });
    expect(ids(hits)).toEqual(["invoice-may"]);
  });

  test("a message with an excluded label is left out", async () => {
    const hits = await mailbox.search({ words: "kayak", filters: notSpamOrTrash, limit: 10 });
    expect(ids(hits)).not.toContain("kayak-spam");
    expect(ids(hits)).not.toContain("kayak-trash");
  });

  test("a sender filter keeps only that sender's messages", async () => {
    const hits = await mailbox.search({ words: "invoice", filters: { sender: "billing@hosting.example" }, limit: 10 });
    expect(ids(hits).sort()).toEqual(["invoice-april", "invoice-march", "invoice-may"]);
  });

  test("a date range keeps messages from its start up to its end", async () => {
    const hits = await mailbox.search({
      words: "invoice",
      filters: { date: { from: new Date("2026-04-01T00:00:00Z"), to: new Date("2026-05-02T13:40:00Z") } },
      limit: 10,
    });
    expect(ids(hits)).toEqual(["invoice-april"]);
  });

  test("an attachment filter keeps messages with or without one", async () => {
    const withOne = await mailbox.search({ words: "invoice", filters: { hasAttachment: true }, limit: 10 });
    expect(ids(withOne).sort()).toEqual(["invoice-april", "invoice-march", "invoice-may"]);

    const without = await mailbox.search({ words: "invoice", filters: { hasAttachment: false }, limit: 10 });
    expect(ids(without)).toEqual(["invoice-question"]);
  });

  test("filters narrow the messages before the limit takes the best", async () => {
    const hits = await mailbox.search({ words: "kayak", filters: { labels: { include: ["Trash"] } }, limit: 1 });
    expect(ids(hits)).toEqual(["kayak-trash"]);
  });

  test("a limit returns that many hits, best first", async () => {
    const hits = await mailbox.search({ words: "kayak", filters: notSpamOrTrash, limit: 1 });
    expect(ids(hits)).toEqual(["kayak-rental"]);
  });

  test("a label change is what the next search filters on", async () => {
    await mailbox.changeLabels("kayak-club", ["Trash"]);
    const hits = await mailbox.search({ words: "kayak", filters: notSpamOrTrash, limit: 10 });
    expect(ids(hits)).toEqual(["kayak-rental"]);

    await mailbox.changeLabels("kayak-spam", ["Inbox"]);
    const inbox = await mailbox.search({ words: "kayak", filters: { labels: { include: ["Inbox"] } }, limit: 10 });
    expect(ids(inbox).sort()).toEqual(["kayak-rental", "kayak-spam"]);
  });

  test("a removed message is no longer found", async () => {
    await mailbox.remove(["kayak-rental", "kayak-spam"]);
    const hits = await mailbox.search({ words: "kayak", limit: 10 });
    expect(ids(hits).sort()).toEqual(["kayak-club", "kayak-trash"]);
  });

  test("messages added later are found next to the first ones", async () => {
    await mailbox.add([
      { ...fixture[0]!, id: "kayak-return", subject: "Kayak returned", text: "Thanks for bringing the kayak back on time." },
    ]);
    const hits = await mailbox.search({ words: "kayak", filters: notSpamOrTrash, limit: 10 });
    expect(ids(hits).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-return"]);
  });

  test("Swedish words and English words each find their other forms", async () => {
    expect(ids(await mailbox.search({ words: "fakturor", limit: 10 }))).toEqual(["faktura-sv"]);
    expect(ids(await mailbox.search({ words: "möten", limit: 10 }))).toEqual(["mote-sv"]);
    expect(ids(await mailbox.search({ phrase: "förra mötet", limit: 10 }))).toEqual(["mote-sv"]);

    const invoices = await mailbox.search({ words: "invoices", limit: 10 });
    expect(ids(invoices).sort()).toEqual(["invoice-april", "invoice-march", "invoice-may", "invoice-question"]);
  });

  test("a search by meaning finds a message that shares none of its words", async () => {
    const hits = await mailbox.search({ meaning: "when should I see someone about my teeth", limit: 5 });
    expect(ids(hits)[0]).toBe("dentist");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  test("filters narrow a search by meaning before the limit takes the best", async () => {
    const hits = await mailbox.search({ meaning: "paddling on the sea", filters: { labels: { include: ["Trash"] } }, limit: 1 });
    expect(ids(hits)).toEqual(["kayak-trash"]);
  });

  test("a hybrid search finds messages by their words or by their meaning", async () => {
    const hits = await mailbox.search({ words: "invoice", meaning: "electricity bill", limit: 10 });
    expect(ids(hits)).toContain("invoice-may");
    expect(ids(hits)).toContain("electricity");
  });

  test("filters narrow a hybrid search before the limit takes the best", async () => {
    const hits = await mailbox.search({
      words: "kayak",
      meaning: "renting a boat for the weekend",
      filters: { labels: { include: ["Trash"] } },
      limit: 1,
    });
    expect(ids(hits)).toEqual(["kayak-trash"]);
  });

  test("a hybrid search ranks first the message both its words and its meaning rank high", async () => {
    const words = await mailbox.search({ words: "kayak", filters: notSpamOrTrash, limit: 10 });
    expect(ids(words)).toEqual(["kayak-rental", "kayak-club"]);

    const hybrid = await mailbox.search({
      words: "kayak",
      meaning: "a club newsletter about courses and new members",
      filters: notSpamOrTrash,
      limit: 10,
    });
    expect(ids(hybrid)[0]).toBe("kayak-club");
    expect(ids(hybrid)).not.toContain("kayak-spam");
  });

  test("a search finds only its own mailbox's messages", async () => {
    const other = await engine().mailbox(`mailbox-${randomUUID()}`);
    await other.add([{ ...fixture[1]!, id: "elsewhere" }]);
    expect(ids(await other.search({ words: "kayak", limit: 10 }))).toEqual(["elsewhere"]);
    expect(ids(await mailbox.search({ words: "kayak", limit: 10 }))).not.toContain("elsewhere");
  });
});

// LanceDB 0.39.0 aborts the whole process, past any catch, when the full-text
// index's language is spelled differently from its enum (lancedb/lancedb#4367).
// A child process builds the index, so a crash fails this test instead of
// taking the test runner down with it.
test("building the full-text index leaves the process running", () => {
  const module = new URL("../src/lancedb-search.ts", import.meta.url).href;
  const fixtureModule = new URL("./fixture.ts", import.meta.url).href;
  const script = `
    import { lanceSearch } from ${JSON.stringify(module)};
    import { fixture } from ${JSON.stringify(fixtureModule)};
    const mailbox = await lanceSearch({ uri: process.argv[1] }).mailbox("crash-check");
    await mailbox.add(fixture);
    const hits = await mailbox.search({ phrase: "out of office", limit: 10 });
    console.log(JSON.stringify(hits.map((h) => h.messageId)));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, localDirectory()], {
    encoding: "utf8",
  });
  expect(child.signal).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual(["out-of-office"]);
});
