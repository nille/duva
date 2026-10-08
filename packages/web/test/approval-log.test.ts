import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { follow, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com where Ada, the admin, has a mailbox at
 * ada@example.com and sponsors the agent Hermes, which has send access to it.
 */
async function withSponsor(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: own } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = app.duva.withKey(created!.key);
  const params = { path: { mailbox: own!.id } };
  /** Hermes drafts a message to Grace and Linus and asks to send it, and answers the approval it waits for. */
  const ask = async (subject: string) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], cc: ["linus@example.net"], subject, text: "Monday works." } });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    return asked!.send!.approval!;
  };
  return { ...app, ada, hermes, agent: created!.agent, own: own!, ask };
}

const openApprovals = (page: Page) => page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: /^Approvals/ }).click();
const lists = (page: Page) => page.getByRole("group", { name: "Which list" });
const logRows = (page: Page) => page.getByRole("list", { name: "Approval log" }).getByRole("button");
/** What the page shows of the element, a line for each block in it. */
const lines = (text: string) => text.replace(/\n+/g, "\n");

test("the sponsor sends an agent's draft and undoes it from its slip while the window counts down, so it waits for them again", budget, async () => {
  const { page, signIn, duva, ada, ask } = await withSponsor({ undoWindow: 30 });
  const approval = await ask("Meeting");
  await signIn("ada@example.org");
  await openApprovals(page);

  await page.getByRole("button", { name: "Send", exact: true }).click();

  const undo = page.getByRole("button", { name: "Undo" });
  await expect.poll(() => undo.isVisible(), wait).toBe(true);
  expect(await page.getByText(/^\d+ seconds left$/).innerText()).toMatch(/^(2\d|30) seconds left$/);
  await expect.poll(() => page.getByRole("article").innerText(), wait).toContain("It goes out once the undo window is over, unless you undo it.");
  await undo.click();

  await expect.poll(() => page.getByRole("button", { name: "Send", exact: true }).isVisible(), wait).toBe(true);
  expect((await ada.GET("/approvals")).data?.approvals.map(({ id, state }) => [id, state])).toEqual([[approval, "pending"]]);
  expect(duva.sent()).toEqual([]);
});

test("the Log beside Waiting lists each decision with how it went, and a sent one opens with Write a correction to its recipients", budget, async () => {
  const { page, signIn, ada, own, ask } = await withSponsor();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: await ask("Meeting") } } });
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval: await ask("Lunch") } }, body: { note: "Not this week." } });
  await signIn("ada@example.org");
  await openApprovals(page);

  await lists(page).getByRole("button", { name: "Log" }).click();

  await expect.poll(() => logRows(page).count(), wait).toBe(2);
  expect(await lists(page).getByRole("button", { name: "Log" }).getAttribute("aria-pressed")).toBe("true");
  expect(lines(await logRows(page).nth(0).innerText())).toMatch(/^Hermes\nRejected\n.+\nLunch To grace@example.org, linus@example.net$/);
  expect(lines(await logRows(page).nth(1).innerText())).toMatch(/^Hermes\nSent\n/);
  expect(await page.getByRole("article").innerText()).toContain("Your note: “Not this week.”");

  await logRows(page).nth(1).click();
  const entry = page.getByRole("article", { name: /You approved Hermes/ });
  await expect.poll(() => entry.innerText(), wait).toContain("Mail that went out stays sent.");
  expect(await entry.getByRole("link", { name: "Open the thread" }).isVisible()).toBe(true);
  await entry.getByRole("button", { name: "Write a correction" }).click();

  await expect.poll(() => page.url(), wait).toMatch(new RegExp(`#/mailboxes/${own.id}/drafts/`));
  const { data: drafts } = await ada.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: own.id } } });
  expect(drafts?.drafts.filter(({ subject }) => subject === "Re: Meeting")).toMatchObject([{ from: "ada@example.com", to: [{ address: "grace@example.org" }], cc: [{ address: "linus@example.net" }] }]);
});

test("a correction to mail the agent sent as the sponsor replies to it in its thread, to all its recipients", budget, async () => {
  const { page, signIn, ada, hermes, own } = await withSponsor();
  const params = { path: { mailbox: own.id } };
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], cc: ["linus@example.net"], subject: "Meeting", text: "Monday works." } });
  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } } });
  const { data: sent } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: draft!.id } } });
  await signIn("ada@example.org");
  await openApprovals(page);
  await lists(page).getByRole("button", { name: "Log" }).click();

  await page.getByRole("article", { name: /You approved Hermes/ }).getByRole("button", { name: "Write a correction" }).click();

  await expect.poll(() => page.url(), wait).toMatch(new RegExp(`#/mailboxes/${own.id}/drafts/`));
  const { data: drafts } = await ada.GET("/mailboxes/{mailbox}/drafts", { params });
  const correction = drafts!.drafts.find(({ id }) => id !== draft!.id);
  expect(correction).toMatchObject({ answers: sent!.send!.message, thread: sent!.send!.thread, to: [{ address: "grace@example.org" }], cc: [{ address: "linus@example.net" }], subject: "Re: Meeting" });
});

test("a rejected send is sent after all from the log, and its tag then says it was sent", budget, async () => {
  const { page, signIn, duva, ada, ask } = await withSponsor();
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval: await ask("Lunch") } }, body: { note: "Not this week." } });
  await signIn("ada@example.org");
  await openApprovals(page);
  await lists(page).getByRole("button", { name: "Log" }).click();
  const entry = page.getByRole("article", { name: /You rejected Hermes/ });
  await expect.poll(() => entry.innerText(), wait).toContain("The draft is still as Hermes asked it, so you can send it after all.");

  await entry.getByRole("button", { name: "Send after all" }).click();

  await expect.poll(async () => lines(await logRows(page).nth(0).innerText()), wait).toMatch(/^Hermes\nSent\n/);
  expect(duva.sent()).toHaveLength(1);
});

test("with no decisions yet, the Log says so, and Waiting is a click away", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("ada@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  // Nothing has waited for Ada, so Approvals isn't among the places, and a link opens it.
  await follow(page, "#/approvals");

  await lists(page).getByRole("button", { name: "Log" }).click();

  await expect.poll(() => page.getByRole("heading", { name: "No decisions yet" }).isVisible(), wait).toBe(true);
  await lists(page).getByRole("button", { name: "Waiting" }).click();
  await expect.poll(() => page.getByRole("heading", { name: "Nothing is waiting for you" }).isVisible(), wait).toBe(true);
});
