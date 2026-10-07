import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Ada to Grace in the thread about the planning, answering the one before it, if any. */
const planning = (number: number, text: string, { subject = number === 1 ? "Planering" : "Re: Planering", date = "Sun, 04 Oct 2026 09:00:00 +0200" } = {}) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: <planering-${number}@example.org>`,
    ...(number === 1 ? [] : [`In-Reply-To: <planering-${number - 1}@example.org>`, `References: <planering-1@example.org>`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");

/** The web app for a deployment where the human Grace has a personal mailbox at grace@example.com. */
async function withPersonalMailbox(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: whoami } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: whoami!.id, address: "grace@example.com" } });
  const path = { mailbox: mailbox!.id };
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path }, body: { on: false } });
  const receive = async (raw: string, at?: Date) => {
    await app.duva.receive(raw, { to: ["grace@example.com"] }, at === undefined ? undefined : { at });
  };
  /** The thread Grace's Inbox lists first. */
  const thread = async () => {
    const { data } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { path, query: { label: "inbox" } } });
    return (await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...path, thread: data!.threads[0]!.id } } })).data!;
  };
  /** Grace replies to the thread's newest message from the API, as from another device. */
  const reply = async (text: string) => {
    const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: { path }, body: { answers: (await thread()).messages.at(-1)!.id, text } });
    await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...path, draft: draft!.id } } });
  };
  const markRead = async () => {
    await grace.POST("/mailboxes/{mailbox}/threads/read", { params: { path }, body: { threads: [(await thread()).id] } });
  };
  return { ...app, receive, reply, markRead };
}

test("a thread folds what came before the human last wrote, and opens at the first message after it", budget, async () => {
  const { page, signIn, receive, reply } = await withPersonalMailbox();
  await receive(planning(1, "Ska vi planera hösten? Jag tänkte att vi kunde ses en eftermiddag och gå igenom budgeten, resorna och vem som gör vad under vintern."), new Date("2026-10-04T07:00:00Z"));
  await reply("Ja, gärna.");
  await receive(planning(2, "Bra. Jag föreslår tisdag."));
  await receive(planning(3, "Eller onsdag, om det passar bättre."));
  await signIn("grace@example.org");

  await page.getByRole("link", { name: /Planering/ }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(4);
  // A long first line is cut short, so the slug keeps to the sheet's width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  // What was read is folded to a line: who sent it, the start of what they wrote, and when.
  const folded = letters.getByRole("button", { expanded: false });
  expect(await folded.count()).toBe(2);
  expect(await folded.first().innerText()).toMatch(/^Ada Lovelace\s+Ska vi planera hösten\? Jag tänkte.*\s+Oct 4$/);
  expect(await folded.nth(1).innerText()).toContain("You sent this");
  // What arrived after the human wrote is open, and the thread opens at the first of it.
  expect(await letters.nth(2).innerText()).toContain("Bra. Jag föreslår tisdag.");
  expect(await letters.nth(3).innerText()).toContain("Eller onsdag, om det passar bättre.");
  await expect.poll(() => letters.nth(2).evaluate((letter) => letter === document.activeElement), wait).toBe(true);

  await folded.first().click();
  await expect.poll(() => letters.first().innerText(), wait).toContain("To");
  expect(await letters.first().innerText()).toContain("vem som gör vad under vintern.");
  await letters.getByRole("button", { expanded: false }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => letters.nth(1).innerText(), wait).toContain("Ja, gärna.");
  // The opened letter takes the focus its slug had.
  await expect.poll(() => letters.nth(1).evaluate((letter) => letter === document.activeElement), wait).toBe(true);
});

test("a thread read before shows its newest message open, with the replies once at its foot, and a subject only where it changed", budget, async () => {
  const { page, signIn, receive, markRead } = await withPersonalMailbox();
  await receive(planning(1, "Ska vi planera hösten?"));
  await receive(planning(2, "Jag föreslår tisdag."));
  await receive(planning(3, "Tisdag går inte längre.", { subject: "Ny tid för planeringen" }));
  await markRead();
  await signIn("grace@example.org");

  await page.getByRole("link", { name: /Planering/ }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(3);
  expect(await letters.getByRole("button", { expanded: false }).count()).toBe(2);
  const newest = letters.nth(2);
  expect(await newest.innerText()).toContain("Tisdag går inte längre.");
  expect(await page.getByRole("button", { name: "Reply", exact: true }).count()).toBe(1);
  expect(await newest.getByRole("button", { name: "Reply", exact: true }).count()).toBe(1);
  expect(await newest.getByRole("term").allInnerTexts()).toEqual(["To", "Subject"]);
  expect(await newest.getByRole("definition").last().innerText()).toBe("Ny tid för planeringen");

  await letters.nth(1).getByRole("button").click();
  await expect.poll(() => letters.nth(1).getByRole("term").allInnerTexts(), wait).toEqual(["To"]);
});

test("a message's time is when it arrived, as the list shows it, with the sender's own date beside it when that is far off", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  // The sender's clock says 07:00 UTC, but the message arrived at 10:00.
  await receive(planning(1, "Ska vi planera hösten?"), new Date("2026-10-04T10:00:00Z"));
  await receive(planning(2, "Jag föreslår tisdag.", { date: "Sun, 04 Oct 2026 12:05:00 +0200" }), new Date("2026-10-04T10:10:00Z"));
  await signIn("grace@example.org");

  await page.getByRole("link", { name: /Planering/ }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(2);
  const times = (letter: number) => letters.nth(letter).locator(".letter-meta time").allInnerTexts();
  expect(await times(0)).toEqual(["Oct 4, 10:00 AM", "Dated Oct 4, 07:00 AM"]);
  expect(await times(1)).toEqual(["Oct 4, 10:10 AM"]);
});

test("the sender's name and address read apart in a letter's head", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(planning(1, "Ska vi planera hösten?"));
  await signIn("grace@example.org");

  await page.getByRole("link", { name: /Planering/ }).click();

  await expect.poll(() => page.getByRole("article").getByRole("heading", { level: 2 }).textContent(), wait).toBe("Ada Lovelace ada@example.org");
});

test("on a phone the thread's actions lie in a bar at the screen's foot, with the rest behind More", budget, async () => {
  const { page, signIn, receive, markRead } = await withPersonalMailbox({ viewport: phone });
  await receive(planning(1, "Ska vi planera hösten? Jag tänkte att vi kunde ses en eftermiddag och gå igenom budgeten och resorna."));
  await receive(planning(2, "Jag föreslår tisdag."));
  await markRead();
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Planering/ }).click();

  const bar = page.getByRole("toolbar", { name: "Actions" });
  await expect.poll(() => bar.getByRole("button").allInnerTexts(), wait).toEqual(["Reply", "Archive", "Trash", "More"]);
  const box = (await bar.boundingBox())!;
  // The bar sits on the tab bar, just above it.
  const tabBar = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.height = "var(--tab-bar-height, 0px)";
    document.body.append(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  });
  expect(tabBar).toBeGreaterThan(0);
  expect(Math.round(box.y + box.height)).toBe(Math.round(phone.height - tabBar));
  // The folded message keeps to one line, cut short.
  expect((await page.getByRole("article").first().boundingBox())!.height).toBeLessThan(56);
  expect(await page.getByRole("toolbar", { name: "Thread actions" }).count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);

  await bar.getByRole("button", { name: "More" }).click();
  const more = page.getByRole("toolbar", { name: "Thread actions" });
  await expect.poll(() => more.getByRole("button", { name: "Mark as spam" }).isVisible(), wait).toBe(true);
  expect(await more.getByRole("button", { name: "Forward" }).isVisible()).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => more.count(), wait).toBe(0);
  expect(await bar.getByRole("button", { name: "More" }).evaluate((button) => button === document.activeElement)).toBe(true);

  await bar.getByRole("button", { name: "Archive" }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await expect.poll(() => page.getByText("Archived 1 thread.").count(), wait).toBe(1);
});

test("on a phone a reply opens at the thread's foot, and the bar steps aside while it is written", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox({ viewport: phone });
  await receive(planning(1, "Ska vi planera hösten?"));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Planering/ }).click();

  await page.getByRole("toolbar", { name: "Actions" }).getByRole("button", { name: "Reply" }).click();

  await expect.poll(() => page.getByRole("form", { name: "Reply" }).isVisible(), wait).toBe(true);
  expect(await page.getByRole("toolbar", { name: "Actions" }).count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test.each([
  ["a desk", { width: 1280, height: 800 }],
  ["a phone", phone],
])("on %s, mail an agent sent carries its diamond in the recipient's own mailbox, folded and open, beside the human's dot", budget, async (_, viewport) => {
  const app = await withPersonalMailbox({ viewport });
  const { page, signIn, duva, receive, reply, markRead } = app;
  // Ada's agent writes to Grace as Ada, and Grace doesn't sponsor it, so only the mail itself says an agent sent it.
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send", approvalAsSponsor: false } });
  const hermes = duva.withKey(created!.key);
  const path = { mailbox: mailbox!.id };
  const send = async (body: { to?: string[]; subject?: string; answers?: string; text: string }) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: { path }, body });
    await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...path, draft: draft!.id } } });
    await receive(duva.sent().at(-1)!);
  };
  await send({ to: ["grace@example.com"], subject: "Anteckningar", text: "Här är anteckningarna." });
  const { data: sent } = await hermes.GET("/mailboxes/{mailbox}/sent", { params: { path } });
  const { data: first } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...path, thread: sent!.threads[0]!.id } } });
  await send({ answers: first!.messages[0]!.id, text: "Och en sak till." });
  await markRead();
  await reply("Tack.");
  await signIn("grace@example.org");

  await page.getByRole("link", { name: /Anteckningar/ }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(3);
  const marks = await letters.evaluateAll((all) => all.map((letter) => letter.querySelector(".actor-mark")!.className));
  expect(marks).toEqual(["actor-mark actor-mark-agent", "actor-mark actor-mark-agent", "actor-mark actor-mark-human"]);
  // The first is folded to its slug, which carries the diamond too.
  expect(await letters.nth(0).getByRole("button", { expanded: false }).locator(".actor-mark-agent").count()).toBe(1);
});
