import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Grace to Ada that starts its own thread. */
const note = (subject: string, text = "Hej.") =>
  [
    "From: Grace Hopper <grace@example.org>",
    "To: ada@example.com",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");

/**
 * The web app for a deployment where Ada, the admin, has a personal mailbox at ada@example.com
 * and sponsors the agent Hermes, which owns hermes@example.com and has full sponsor access to
 * Ada's mailbox.
 */
async function withAgentInSponsorsMailbox() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: adaMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("ada@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: adaMailbox!.id } }, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: hermesMailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const settings = { params: { path: { agent: created!.agent.id } } };
  await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { sponsorAccess: "full" } });
  const hermes = app.duva.withKey(created!.key);
  const inAdas = { path: { mailbox: adaMailbox!.id } };
  const inHermess = { path: { mailbox: hermesMailbox!.id } };

  /** Grace's message reaches Ada, and answers its ID in Duva. */
  const receive = async (raw: string) => {
    await app.duva.receive(raw, { to: ["ada@example.com"] });
    const { data: list } = await ada.GET("/mailboxes/{mailbox}/threads", { params: inAdas });
    const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...inAdas.path, thread: list!.threads[0]!.id } } });
    return thread!.messages.at(-1)!.id;
  };
  /** The actor drafts in the mailbox and asks to send it, and answers the approval it waits for, if it waits. */
  const ask = async (actor: typeof ada, params: typeof inAdas, body: { answers?: string; to?: string[]; subject?: string; text: string }) => {
    const { data: draft } = await actor.POST("/mailboxes/{mailbox}/drafts", { params, body });
    const { data: asked } = await actor.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    return asked!.send!.approval;
  };
  return { ...app, ada, hermes, settings, inAdas, inHermess, receive, ask };
}

test("in the sponsor's own mailbox, a message their agent sent as them names the agent, and theirs says they sent it", budget, async () => {
  const { page, signIn, ada, hermes, inAdas, receive, ask } = await withAgentInSponsorsMailbox();
  const original = await receive(note("Möte", "Kan vi ses på måndag?"));
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: (await ask(hermes, inAdas, { answers: original, text: "Måndag går bra." }))! } } });
  await ask(ada, inAdas, { answers: original, text: "Hermes svarade för mig." });
  await signIn("ada@example.org");

  await page.getByRole("link", { name: /Möte/ }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(3);
  // The mark is a line of its own: the text of Hermes's message also carries the disclosure's line, which names Hermes.
  const marks = (index: number) => letters.nth(index).getByText(/^(Sent by .*|You sent this|Sent from this mailbox)$/).allInnerTexts();
  expect(await marks(0)).toEqual([]);
  expect(await marks(1)).toEqual(["Sent by Hermes"]);
  // Read before, it is folded, and opens to say who approved it.
  await letters.nth(1).getByRole("button", { expanded: false }).click();
  await expect.poll(() => letters.nth(1).innerText(), wait).toContain("You approved it as written");
  expect(await marks(1)).toEqual(["Sent by Hermes"]);
  expect(await marks(2)).toEqual(["You sent this"]);
});

test("a draft the agent wrote or changed last in its sponsor's mailbox names it, in Drafts and when opened", budget, async () => {
  const { page, signIn, ada, hermes, inAdas } = await withAgentInSponsorsMailbox();
  await hermes.POST("/mailboxes/{mailbox}/drafts", { params: inAdas, body: { to: ["grace@example.org"], subject: "Från Hermes", text: "Utkast." } });
  const { data: changed } = await ada.POST("/mailboxes/{mailbox}/drafts", { params: inAdas, body: { to: ["grace@example.org"], subject: "Ändrad av Hermes", text: "Hej." } });
  await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...inAdas.path, draft: changed!.id } }, body: { text: "Hej, Grace." } });
  await ada.POST("/mailboxes/{mailbox}/drafts", { params: inAdas, body: { to: ["grace@example.org"], subject: "Adas eget", text: "Hej." } });
  await signIn("ada@example.org");

  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Drafts" }).click();

  const rows = page.getByRole("list", { name: "Drafts" }).getByRole("link");
  await expect.poll(() => rows.count(), wait).toBe(3);
  expect(await page.getByRole("link", { name: /Från Hermes/ }).getAttribute("aria-label")).toMatch(/^By Hermes, /);
  expect(await page.getByRole("link", { name: /Från Hermes/ }).innerText()).toContain("By Hermes");
  expect(await page.getByRole("link", { name: /Ändrad av Hermes/ }).getAttribute("aria-label")).toMatch(/^By Hermes, /);
  expect(await page.getByRole("link", { name: /Adas eget/ }).innerText()).not.toContain("Hermes");

  await page.getByRole("link", { name: /Ändrad av Hermes/ }).click();

  await expect.poll(() => page.getByText("Last saved by Hermes").isVisible(), wait).toBe(true);
  await page.getByLabel("Message").fill("Hej, Grace. Ada här.");
  await expect.poll(() => page.getByRole("status").innerText(), wait).toMatch(/^Saved at /);
});

test("Approvals marks a send as the sponsor apart from the agent's sends from its own mailbox", budget, async () => {
  const { page, signIn, hermes, inAdas, inHermess, ask } = await withAgentInSponsorsMailbox();
  await ask(hermes, inAdas, { to: ["grace@example.org"], subject: "Som Ada", text: "Hej Grace." });
  await ask(hermes, inHermess, { to: ["grace@example.org"], subject: "Som Hermes", text: "Hej Grace." });
  await signIn("ada@example.org");

  await page.getByRole("link", { name: /Approvals/ }).click();

  const asAda = page.getByRole("article", { name: /Som Ada/ });
  const asHermes = page.getByRole("article", { name: /Som Hermes/ });
  await expect.poll(() => asAda.innerText(), wait).toContain("As you, from ada@example.com");
  expect(await asHermes.innerText()).not.toContain("As you");
  expect(await asHermes.innerText()).toContain("From its own mailbox, hermes@example.com");
});

test("on Approvals, a send carries the disclosure's line only if its sponsor left it on for where it sends from", budget, async () => {
  const { page, signIn, ada, hermes, settings, inAdas, inHermess, ask } = await withAgentInSponsorsMailbox();
  await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { disclosureLineAsSponsor: false } });
  await ask(hermes, inAdas, { to: ["grace@example.org"], subject: "Som Ada", text: "Hej Grace." });
  await ask(hermes, inHermess, { to: ["grace@example.org"], subject: "Som Hermes", text: "Hej Grace." });
  await signIn("ada@example.org");

  await page.getByRole("link", { name: /Approvals/ }).click();

  const asAda = page.getByRole("article", { name: /Som Ada/ });
  const asHermes = page.getByRole("article", { name: /Som Hermes/ });
  await expect.poll(() => asAda.innerText(), wait).toContain("Duva adds no line to it");
  expect(await asAda.innerText()).not.toContain("Sent by Hermes for ada@example.org");
  expect(await asHermes.innerText()).toContain("Sent by Hermes for ada@example.org");
});
