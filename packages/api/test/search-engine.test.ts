// The search module's behavior suite, from the search spike (#2): the module through its interface
// only, on the fixture mailbox. It is the contract any engine behind the module passes (ADR-0007).
// It runs on a table on local disk, and on S3 too when DUVA_SEARCH_S3_URI is set.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { lanceSearch } from "../src/lancedb-search.ts";
import type { SearchEngine, SearchHit, Search, SearchTerm } from "../src/search-engine.ts";
import { fixture } from "./search-fixture.ts";

const directories: string[] = [];
function localDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "duva-search-"));
  directories.push(directory);
  return directory;
}
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

const locations: [string, () => SearchEngine][] = [["a table on local disk", () => lanceSearch({ uri: localDirectory() })]];
const s3 = process.env.DUVA_SEARCH_S3_URI;
if (s3) locations.push(["a table on S3", () => lanceSearch({ uri: s3, storageOptions: { region: process.env.AWS_REGION ?? "eu-north-1" } })]);

const words = (text: string): SearchTerm[] => text.split(" ").map((word) => ({ text: word, phrase: false, in: "anywhere" }));
const phrase = (text: string, within: SearchTerm["in"] = "anywhere"): SearchTerm => ({ text, phrase: true, in: within });
const notSpamOrTrash = { labels: { exclude: ["Spam", "Trash"] } };
const ids = (hits: SearchHit[]) => hits.map((hit) => hit.message);

describe.each(locations)("Search on %s", (_, start) => {
  let engine: SearchEngine;
  let mailbox: string;
  const search = (asked: Partial<Search>) => engine.search(mailbox, { terms: [], filters: {}, sort: "relevance", limit: 10, ...asked });

  beforeEach(async () => {
    engine = start();
    mailbox = `mailbox-${randomUUID()}`;
    await (await engine.writer(mailbox)).put(fixture);
  });

  test("a word finds every message that has it, in its subject or its text", async () => {
    const hits = await search({ terms: words("kayak") });
    expect(ids(hits).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-spam", "kayak-trash"]);
  });

  test("the message that is most about a word ranks first", async () => {
    const hits = await search({ terms: words("kayak"), filters: notSpamOrTrash });
    expect(ids(hits)).toEqual(["kayak-rental", "kayak-club"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  test("several words find only messages that have every one of them, the sender's address counting too", async () => {
    const hits = await search({ terms: words("hosting invoice april") });
    expect(ids(hits).sort()).toEqual(["invoice-april", "invoice-question"]);
  });

  test("the words of a phrase out of order don't match the phrase", async () => {
    const shuffled = await search({ terms: words("quarterly budget review") });
    expect(ids(shuffled).sort()).toEqual(["budget-review", "budget-shuffled", "budget-slides"]);

    const together = await search({ terms: [phrase("quarterly budget review")] });
    expect(ids(together).sort()).toEqual(["budget-review", "budget-slides"]);
  });

  test("a phrase of common words matches only where they stand together", async () => {
    const hits = await search({ terms: [phrase("out of office")] });
    expect(ids(hits)).toEqual(["out-of-office"]);
  });

  test("words and a phrase together find messages that have both", async () => {
    const hits = await search({ terms: [...words("slides"), phrase("quarterly budget review")] });
    expect(ids(hits)).toEqual(["budget-slides"]);
  });

  test("a word or phrase in the subject matches only there", async () => {
    expect(ids(await search({ terms: [{ text: "review", phrase: false, in: "subject" }] }))).toEqual(["budget-slides"]);
    expect(ids(await search({ terms: [phrase("budget review", "subject")] }))).toEqual(["budget-slides"]);
  });

  test("a message with every included label is found, and one with some of them isn't", async () => {
    const hits = await search({ terms: words("invoice"), filters: { labels: { include: ["Inbox", "Invoices"] } } });
    expect(ids(hits)).toEqual(["invoice-may"]);
  });

  test("a message with an excluded label is left out", async () => {
    const hits = await search({ terms: words("kayak"), filters: notSpamOrTrash });
    expect(ids(hits)).not.toContain("kayak-spam");
    expect(ids(hits)).not.toContain("kayak-trash");
  });

  test("a sender filter keeps the messages whose sender's address or name has it, in any case", async () => {
    const hits = await search({ terms: words("invoice"), filters: { from: ["Billing@Hosting"] } });
    expect(ids(hits).sort()).toEqual(["invoice-april", "invoice-march", "invoice-may"]);
  });

  test("a recipient filter keeps the messages one of whose recipients has it", async () => {
    await (await engine.writer(mailbox)).put([{ ...fixture[0]!, id: "kayak-for-ada", thread: "kayak-for-ada", recipients: [{ name: "Ada Lovelace", address: "ada@example.org" }] }]);
    expect(ids(await search({ terms: words("kayak"), filters: { to: ["lovelace"] } }))).toEqual(["kayak-for-ada"]);
    expect(ids(await search({ terms: words("kayak"), filters: { to: ["ada@example"] } }))).toEqual(["kayak-for-ada"]);
  });

  test("a date range keeps messages from its start up to its end", async () => {
    const hits = await search({ terms: words("invoice"), filters: { received: { from: new Date("2026-04-01T00:00:00Z"), to: new Date("2026-05-02T13:40:00Z") } } });
    expect(ids(hits)).toEqual(["invoice-april"]);
  });

  test("an attachment filter keeps messages with or without one", async () => {
    const withOne = await search({ terms: words("invoice"), filters: { hasAttachment: true } });
    expect(ids(withOne).sort()).toEqual(["invoice-april", "invoice-march", "invoice-may"]);

    const without = await search({ terms: words("invoice"), filters: { hasAttachment: false } });
    expect(ids(without)).toEqual(["invoice-question"]);
  });

  test("a read state filter keeps the unread or the read", async () => {
    await (await engine.writer(mailbox)).relabel([{ id: "kayak-club", labels: [], unread: true }]);
    expect(ids(await search({ terms: words("kayak"), filters: { unread: true } }))).toEqual(["kayak-club"]);
    expect(ids(await search({ terms: words("kayak"), filters: { unread: false } }))).not.toContain("kayak-club");
  });

  test("a thread filter keeps the messages in some threads, or leaves them out", async () => {
    expect(ids(await search({ terms: words("kayak"), filters: { threads: { include: ["kayak-club", "kayak-spam"] } } })).sort()).toEqual(["kayak-club", "kayak-spam"]);
    expect(ids(await search({ terms: words("kayak"), filters: { threads: { include: [] } } }))).toEqual([]);
    expect(ids(await search({ terms: words("kayak"), filters: { threads: { exclude: ["kayak-club", "kayak-spam"] } } })).sort()).toEqual(["kayak-rental", "kayak-trash"]);
  });

  test("filters narrow the messages before the limit takes the best", async () => {
    const hits = await search({ terms: words("kayak"), filters: { labels: { include: ["Trash"] } }, limit: 1 });
    expect(ids(hits)).toEqual(["kayak-trash"]);
  });

  test("a limit returns that many hits, best first", async () => {
    const hits = await search({ terms: words("kayak"), filters: notSpamOrTrash, limit: 1 });
    expect(ids(hits)).toEqual(["kayak-rental"]);
  });

  test("sorted by newest, the newest matches come first", async () => {
    const hits = await search({ terms: words("kayak"), sort: "newest", limit: 3 });
    expect(ids(hits)).toEqual(["kayak-rental", "kayak-spam", "kayak-club"]);
  });

  test("filters alone find every message they keep, newest first", async () => {
    const hits = await search({ filters: { labels: { include: ["Travel"] } } });
    expect(ids(hits)).toEqual(["flight", "hotel", "train-tickets", "kayak-rental"]);
  });

  test("a label change is what the next search filters on", async () => {
    await (await engine.writer(mailbox)).relabel([{ id: "kayak-club", labels: ["Trash"], unread: false }]);
    expect(ids(await search({ terms: words("kayak"), filters: notSpamOrTrash }))).toEqual(["kayak-rental"]);

    await (await engine.writer(mailbox)).relabel([{ id: "kayak-spam", labels: ["Inbox"], unread: false }]);
    const inbox = await search({ terms: words("kayak"), filters: { labels: { include: ["Inbox"] } } });
    expect(ids(inbox).sort()).toEqual(["kayak-rental", "kayak-spam"]);
  });

  test("a removed thread's messages are no longer found", async () => {
    await (await engine.writer(mailbox)).removeThreads(["kayak-rental", "kayak-spam"]);
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-trash"]);
  });

  test("messages added later are found next to the first ones, and adding one again replaces it", async () => {
    const writer = await engine.writer(mailbox);
    const returned = { ...fixture[0]!, id: "kayak-return", subject: "Kayak returned", text: "Thanks for bringing the kayak back on time." };
    await writer.put([returned]);
    await writer.put([returned]);
    expect(ids(await search({ terms: words("kayak"), filters: notSpamOrTrash })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-return"]);
  });

  test("maintenance leaves every message found as before", async () => {
    const writer = await engine.writer(mailbox);
    await writer.removeThreads(["kayak-spam"]);
    await writer.maintain();
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-trash"]);
  });

  test("compaction leaves every message found as before, by words, phrases and filters, with its text", async () => {
    const writer = await engine.writer(mailbox);
    await writer.removeThreads(["kayak-spam"]);
    await writer.relabel([{ id: "kayak-club", labels: ["Inbox", "Travel"], unread: true }]);
    await writer.compact();
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-trash"]);
    expect(ids(await search({ filters: { labels: { include: ["Travel"] }, unread: true } }))).toEqual(["kayak-club"]);
    expect(ids(await search({ terms: [phrase("förra mötet")] }))).toEqual(["mote-sv"]);
    expect(ids(await search({ terms: words("hosting invoice april") })).sort()).toEqual(["invoice-april", "invoice-question"]);
    expect(await engine.texts(mailbox, ["kayak-club"])).toEqual(new Map([["kayak-club", fixture.find(({ id }) => id === "kayak-club")!.text]]));
  });

  test("an index with nothing removed, or nothing in it, compacts", async () => {
    await (await engine.writer(mailbox)).compact();
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-spam", "kayak-trash"]);
    const empty = `mailbox-${randomUUID()}`;
    await (await engine.writer(empty)).compact();
    expect(await engine.search(empty, { terms: words("kayak"), filters: {}, sort: "relevance", limit: 10 })).toEqual([]);
  });

  test("Swedish words and English words each find their other forms", async () => {
    expect(ids(await search({ terms: words("fakturor") }))).toEqual(["faktura-sv"]);
    expect(ids(await search({ terms: words("möten") }))).toEqual(["mote-sv"]);
    expect(ids(await search({ terms: [phrase("förra mötet")] }))).toEqual(["mote-sv"]);
    expect(ids(await search({ terms: words("invoices") })).sort()).toEqual(["invoice-april", "invoice-march", "invoice-may", "invoice-question"]);
  });

  test("a message's text is given by its ID", async () => {
    const texts = await engine.texts(mailbox, ["kayak-club", "mote-sv", "missing"]);
    expect(texts).toEqual(new Map([
      ["kayak-club", fixture.find(({ id }) => id === "kayak-club")!.text],
      ["mote-sv", fixture.find(({ id }) => id === "mote-sv")!.text],
    ]));
  });

  test("a search finds only its own mailbox's messages", async () => {
    const other = `mailbox-${randomUUID()}`;
    await (await engine.writer(other)).put([{ ...fixture[1]!, id: "elsewhere" }]);
    expect(ids(await engine.search(other, { terms: words("kayak"), filters: {}, sort: "relevance", limit: 10 }))).toEqual(["elsewhere"]);
    expect(ids(await search({ terms: words("kayak") }))).not.toContain("elsewhere");
  });

  test("a mailbox without an index finds nothing, and one whose index was dropped finds nothing again", async () => {
    expect(await engine.search(`mailbox-${randomUUID()}`, { terms: words("kayak"), filters: {}, sort: "relevance", limit: 10 })).toEqual([]);
    await engine.drop(mailbox);
    expect(await search({ terms: words("kayak") })).toEqual([]);
  });
});

// LanceDB 0.39.0 aborts the whole process, past any catch, when the full-text index's language is
// spelled differently from its enum (lancedb/lancedb#4367). A child process builds the indexes, so
// a crash fails this test instead of taking the test runner down with it.
test("building the full-text indexes leaves the process running", () => {
  const engine = new URL("../src/lancedb-search.ts", import.meta.url).href;
  const fixtureModule = new URL("./search-fixture.ts", import.meta.url).href;
  const script = `
    import { lanceSearch } from ${JSON.stringify(engine)};
    import { fixture } from ${JSON.stringify(fixtureModule)};
    const search = lanceSearch({ uri: process.argv[1] });
    await (await search.writer("crash-check")).put(fixture);
    const hits = await search.search("crash-check", { terms: [{ text: "out of office", phrase: true, in: "anywhere" }], filters: {}, sort: "relevance", limit: 10 });
    console.log(JSON.stringify(hits.map((hit) => hit.message)));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, localDirectory()], { encoding: "utf8" });
  expect(child.signal).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual(["out-of-office"]);
});
