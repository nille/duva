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
import type { Language } from "../src/languages.ts";
import type { SearchEngine, SearchHit, Search, SearchTerm } from "../src/search-engine.ts";
import { fixture } from "./search-fixture.ts";
import { recordedTitan } from "./titan.ts";

const directories: string[] = [];
function localDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "duva-search-"));
  directories.push(directory);
  return directory;
}
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

const titan = recordedTitan();
const locations: [string, () => SearchEngine][] = [["a table on local disk", () => lanceSearch({ uri: localDirectory(), embedder: titan })]];
const s3 = process.env.DUVA_SEARCH_S3_URI;
if (s3) locations.push(["a table on S3", () => lanceSearch({ uri: s3, storageOptions: { region: process.env.AWS_REGION ?? "eu-north-1" }, embedder: titan })]);

const words = (text: string): SearchTerm[] => text.split(" ").map((word) => ({ text: word, phrase: false, in: "anywhere" }));
const phrase = (text: string, within: SearchTerm["in"] = "anywhere"): SearchTerm => ({ text, phrase: true, in: within });
const notSpamOrTrash = { labels: { exclude: ["Spam", "Trash"] } };
const ids = (hits: SearchHit[]) => hits.map((hit) => hit.message);
/** The languages most of the suite's mail is filed in, as an organization's are by default. */
const englishAndSwedish: Language[] = ["English", "Swedish"];

describe.each(locations)("Search on %s", (_, start) => {
  let engine: SearchEngine;
  let mailbox: string;
  const search = (asked: Partial<Search>) => engine.search(mailbox, { terms: [], filters: {}, sort: "relevance", limit: 10, ...asked });

  beforeEach(async () => {
    engine = start();
    mailbox = `mailbox-${randomUUID()}`;
    await (await engine.writer(mailbox, englishAndSwedish)).put(fixture);
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

  test("several words find the messages that have every one of them, the sender's address counting too, and rank them with those near in meaning", async () => {
    const hits = await search({ terms: words("hosting invoice april") });
    expect(ids(hits).slice(0, 2).sort()).toEqual(["invoice-april", "invoice-question"]);
    expect(ids(hits).slice(2).sort()).toEqual(["invoice-march", "invoice-may"]);
  });

  test("a search by meaning finds a message that shares none of its words, English and Swedish", async () => {
    expect(ids(await search({ terms: words("when should I see someone about my teeth") }))[0]).toBe("dentist");
    expect(ids(await search({ terms: words("räkningen för hösten") }))[0]).toBe("faktura-sv");
  });

  test("a search by meaning finds only what is near it, and nothing for words unlike any message", async () => {
    const bills = ids(await search({ terms: words("power bill") }));
    expect(bills[0]).toBe("electricity");
    expect(bills.filter((id) => id !== "electricity" && !id.startsWith("invoice-"))).toEqual([]);
    expect(await search({ terms: words("zebra") })).toEqual([]);
  });

  test("once maintenance builds the vector index, a search by meaning finds what it found before", async () => {
    const indexed = lanceSearch({ uri: localDirectory(), embedder: titan, vectorIndexFrom: fixture.length });
    await (await indexed.writer(mailbox, englishAndSwedish)).put(fixture);
    const meanings = ["when should I see someone about my teeth", "power bill", "renting a boat for the weekend", "räkningen för hösten"];
    const found = (engine: SearchEngine) => Promise.all(meanings.map(async (meaning) => ids(await engine.search(mailbox, { terms: words(meaning), filters: notSpamOrTrash, sort: "relevance", limit: 3 }))));
    const before = await found(indexed);
    await (await indexed.writer(mailbox, englishAndSwedish)).maintain();
    expect(await found(indexed)).toEqual(before);
  });

  test("filters narrow a search by meaning before the limit takes the best", async () => {
    const hits = await search({ terms: words("paddling on the sea"), filters: { labels: { include: ["Trash"] } }, limit: 1 });
    expect(ids(hits)).toEqual(["kayak-trash"]);
  });

  test("a phrase or a subject is matched by its words alone, never by meaning", async () => {
    expect(ids(await search({ terms: [phrase("power bill")] }))).toEqual([]);
    expect(ids(await search({ terms: [{ text: "power bill", phrase: false, in: "subject" }] }))).toEqual([]);
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
    await (await engine.writer(mailbox, englishAndSwedish)).put([{ ...fixture[0]!, id: "kayak-for-ada", thread: "kayak-for-ada", recipients: [{ name: "Ada Lovelace", address: "ada@example.org" }] }]);
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
    await (await engine.writer(mailbox, englishAndSwedish)).relabel([{ id: "kayak-club", labels: [], unread: true }]);
    expect(ids(await search({ terms: words("kayak"), filters: { unread: true } }))).toEqual(["kayak-club"]);
    expect(ids(await search({ terms: words("kayak"), filters: { unread: false } }))).not.toContain("kayak-club");
  });

  test("a thread filter keeps the messages in some threads, or leaves them out", async () => {
    expect(ids(await search({ terms: words("kayak"), filters: { threads: { include: ["kayak-club", "kayak-spam"] } } })).sort()).toEqual(["kayak-club", "kayak-spam"]);
    expect(ids(await search({ terms: words("kayak"), filters: { threads: { include: [] } } }))).toEqual([]);
    expect(ids(await search({ terms: words("kayak"), filters: { threads: { exclude: ["kayak-club", "kayak-spam"] } } })).sort()).toEqual(["kayak-rental", "kayak-trash"]);
  });

  test("label and read state filters leave out none of the threads exempt from them, and the other filters still hold", async () => {
    const exempt = { unread: true, labels: { exclude: ["Spam", "Trash"] }, threads: { exempt: ["kayak-spam", "kayak-trash"] } };
    expect(ids(await search({ terms: words("kayak"), filters: exempt })).sort()).toEqual(["kayak-spam", "kayak-trash"]);
    expect(ids(await search({ terms: words("kayak"), filters: { ...exempt, hasAttachment: true } }))).toEqual(["kayak-trash"]);
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
    await (await engine.writer(mailbox, englishAndSwedish)).relabel([{ id: "kayak-club", labels: ["Trash"], unread: false }]);
    expect(ids(await search({ terms: words("kayak"), filters: notSpamOrTrash }))).toEqual(["kayak-rental"]);

    await (await engine.writer(mailbox, englishAndSwedish)).relabel([{ id: "kayak-spam", labels: ["Inbox"], unread: false }]);
    const inbox = await search({ terms: words("kayak"), filters: { labels: { include: ["Inbox"] } } });
    expect(ids(inbox).sort()).toEqual(["kayak-rental", "kayak-spam"]);
  });

  test("a removed thread's messages are no longer found", async () => {
    await (await engine.writer(mailbox, englishAndSwedish)).removeThreads(["kayak-rental", "kayak-spam"]);
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-trash"]);
  });

  test("messages added later are found next to the first ones, and adding one again replaces it", async () => {
    const writer = await engine.writer(mailbox, englishAndSwedish);
    const returned = { ...fixture[0]!, id: "kayak-return", subject: "Kayak returned", text: "Thanks for bringing the kayak back on time." };
    await writer.put([returned]);
    await writer.put([returned]);
    expect(ids(await search({ terms: words("kayak"), filters: notSpamOrTrash })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-return"]);
  });

  test("maintenance leaves every message found as before", async () => {
    const writer = await engine.writer(mailbox, englishAndSwedish);
    await writer.removeThreads(["kayak-spam"]);
    await writer.maintain();
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-trash"]);
  });

  test("compaction leaves every message found as before, by words, meaning, phrases and filters, with its text", async () => {
    const writer = await engine.writer(mailbox, englishAndSwedish);
    await writer.removeThreads(["kayak-spam"]);
    await writer.relabel([{ id: "kayak-club", labels: ["Inbox", "Travel"], unread: true }]);
    await writer.compact();
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-trash"]);
    expect(ids(await search({ filters: { labels: { include: ["Travel"] }, unread: true } }))).toEqual(["kayak-club"]);
    expect(ids(await search({ terms: [phrase("förra mötet")] }))).toEqual(["mote-sv"]);
    expect(ids(await search({ terms: words("hosting invoice april") })).slice(0, 2).sort()).toEqual(["invoice-april", "invoice-question"]);
    expect(ids(await search({ terms: words("when should I see someone about my teeth") }))[0]).toBe("dentist");
    expect(await engine.texts(mailbox, ["kayak-club"])).toEqual(new Map([["kayak-club", fixture.find(({ id }) => id === "kayak-club")!.text]]));
  });

  test("an index with nothing removed, or nothing in it, compacts", async () => {
    await (await engine.writer(mailbox, englishAndSwedish)).compact();
    expect(ids(await search({ terms: words("kayak") })).sort()).toEqual(["kayak-club", "kayak-rental", "kayak-spam", "kayak-trash"]);
    const empty = `mailbox-${randomUUID()}`;
    await (await engine.writer(empty, englishAndSwedish)).compact();
    expect(await engine.search(empty, { terms: words("kayak"), filters: {}, sort: "relevance", limit: 10 })).toEqual([]);
  });

  test("Swedish words and English words each find their other forms", async () => {
    expect(ids(await search({ terms: words("fakturor") }))).toEqual(["faktura-sv"]);
    expect(ids(await search({ terms: words("möten") }))).toEqual(["mote-sv"]);
    expect(ids(await search({ terms: [phrase("förra mötet")] }))).toEqual(["mote-sv"]);
    expect(ids(await search({ terms: words("invoices") })).sort()).toEqual(["invoice-april", "invoice-march", "invoice-may", "invoice-question"]);
  });

  test("a Swedish word finds its definite form, and the definite form the word", async () => {
    await (await engine.writer(mailbox, englishAndSwedish)).put([{ ...fixture.find(({ id }) => id === "mote-sv")!, id: "hyra-sv", thread: "hyra-sv", subject: "Hyran för november", text: "Hej! Betala senast fredag." }]);
    const inSubject = (text: string): SearchTerm[] => [{ text, phrase: false, in: "subject" }];
    expect(ids(await search({ terms: inSubject("hyra") }))).toEqual(["hyra-sv"]);
    expect(ids(await search({ terms: inSubject("fakturan") }))).toEqual(["faktura-sv"]);
    expect(ids(await search({ terms: [phrase("hyra", "subject")] }))).toEqual([]);
  });

  test("an index written in Danish too files Danish mail as Danish, so its words find their other Danish forms", async () => {
    const danish = { ...fixture.find(({ id }) => id === "faktura-sv")!, id: "regning-da", thread: "regning-da", subject: "Din regning for vand", text: "Hej! Din regning er klar, og beløbet skal betales senest fredag. Du kan ikke betale med kort." };
    const regningerne: SearchTerm[] = [{ text: "regningerne", phrase: false, in: "subject" }];
    await (await engine.writer(mailbox, englishAndSwedish)).put([danish]);
    expect(ids(await search({ terms: regningerne }))).toEqual([]);

    await engine.drop(mailbox);
    await (await engine.writer(mailbox, ["English", "Swedish", "Danish"])).put([...fixture, danish]);

    expect(ids(await search({ terms: regningerne }))).toEqual(["regning-da"]);
    expect(ids(await search({ terms: words("fakturor") }))).toEqual(["faktura-sv"]);
    expect((await engine.texts(mailbox, ["regning-da"])).get("regning-da")).toBe(danish.text);
  });

  test("a translated search also finds what each translation's words find, and a translation that fails leaves the search its own", async () => {
    const translator = {
      async translate(words: string, into: string) {
        if (into === "Danish") throw new Error("Nova Lite took too long.");
        return into === "English" && words === "räkningarna" ? "invoices" : undefined;
      },
    };
    const translating = lanceSearch({ uri: localDirectory(), embedder: titan, translator });
    await (await translating.writer(mailbox, englishAndSwedish)).put(fixture);
    const found = async (translateInto: Language[]) =>
      ids(await translating.search(mailbox, { terms: words("räkningarna"), filters: notSpamOrTrash, sort: "relevance", limit: 10, translateInto })).sort();

    expect(await found([])).not.toContain("invoice-may");
    expect(await found(["English", "Swedish", "Danish"])).toEqual(expect.arrayContaining(["invoice-april", "invoice-march", "invoice-may", "invoice-question"]));
    expect(ids(await translating.search(mailbox, { terms: [phrase("räkningarna")], filters: {}, sort: "relevance", limit: 10, translateInto: ["English"] }))).toEqual([]);
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
    await (await engine.writer(other, englishAndSwedish)).put([{ ...fixture[1]!, id: "elsewhere" }]);
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
  const titanModule = new URL("./titan.ts", import.meta.url).href;
  const script = `
    import { lanceSearch } from ${JSON.stringify(engine)};
    import { fixture } from ${JSON.stringify(fixtureModule)};
    import { recordedTitan } from ${JSON.stringify(titanModule)};
    const search = lanceSearch({ uri: process.argv[1], embedder: recordedTitan() });
    await (await search.writer("crash-check", ["English", "Swedish", "Danish"])).put(fixture);
    const hits = await search.search("crash-check", { terms: [{ text: "out of office", phrase: true, in: "anywhere" }], filters: {}, sort: "relevance", limit: 10 });
    console.log(JSON.stringify(hits.map((hit) => hit.message)));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, localDirectory()], { encoding: "utf8" });
  expect(child.signal).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual(["out-of-office"]);
});
