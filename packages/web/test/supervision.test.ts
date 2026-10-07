import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import { phone, startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment where Grace, who isn't an admin, has a personal mailbox at
 * grace@example.com and sponsors the agent Hermes, which owns a mailbox at hermes@example.com and
 * sends from it without her approval. Ada is the admin.
 */
async function withAgent(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  const { data: created } = await grace.POST("/agents", { body: { name: "Hermes" } });
  const agent = created!.agent;
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: agent.id, address: "hermes@example.com" } });
  const hermes = app.duva.withKey(created!.key);
  const settings = { params: { path: { agent: agent.id } } };
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { approvalForOwnMailbox: false } });
  const params = { path: { mailbox: mailbox!.id } };

  /** Hermes drafts a message to the recipient and sends it, and gets back the draft as it is then, and the ID SES gave it if SES sent it. */
  const send = async (to: string, subject = "Hello", by: DuvaClient = hermes) => {
    const { data: draft } = await by.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: [to], subject, text: "Hej." } });
    await by.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    const { data: sent } = await grace.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: draft!.id } } });
    const messageId = /^<(.+)@eu-north-1\.amazonses\.com>$/.exec(sent!.send!.messageId ?? "")?.[1];
    return { draft: sent!, messageId };
  };
  const paused = async () => (await grace.GET("/agents")).data!.agents.find(({ name }) => name === "Hermes")!.paused;
  return { ...app, ada, grace, hermes, agent, settings, params, send, paused };
}

/** Hermes's line on the Agents sheet, which also lists the mailbox agent of Grace's mailbox. */
const agentsSheet = (page: Page) =>
  page
    .getByRole("region", { name: "Your agents" })
    .locator("details")
    .filter({ has: page.getByRole("heading", { level: 3, name: "Hermes" }) });
/** What the page shows of the element, a line for each block in it. */
const lines = (text: string) => text.replace(/\n+/g, "\n");
const summary = (page: Page) => ({ innerText: async () => lines(await agentsSheet(page).locator("summary").innerText()) });
/** Opens Settings from the bar, and Hermes's line on the Agents sheet, as the sponsor does. */
const openHermes = async (page: Page) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
  await agentsSheet(page).getByRole("heading", { level: 3, name: "Hermes" }).click();
  await expect.poll(() => agentsSheet(page).getByRole("form", { name: "Hermes" }).isVisible(), wait).toBe(true);
};
const alertsLink = (page: Page) => page.getByRole("navigation").getByRole("link", { name: /^Alerts/ });
const alertItems = (page: Page) => page.getByRole("list", { name: "Alerts" }).getByRole("listitem");
/** The alert open in the reading pane. */
const openAlert = (page: Page) => page.getByRole("article");
/** The queue's rows on Approvals, each opening what waits in the reading pane. */
const rows = (page: Page) => page.getByRole("list", { name: "Approvals" }).getByRole("button");

test("a sponsor pauses an agent on its line, which then says who paused it and since when, and unpauses it", budget, async () => {
  const { page, signIn, hermes, paused } = await withAgent();
  await signIn("grace@example.org");
  await openHermes(page);

  await agentsSheet(page).getByRole("button", { name: "Pause" }).click();

  await expect.poll(() => summary(page).innerText(), wait).toMatch(/^Hermes\nPaused\nPaused by you since \d\d:\d\d [AP]M\./);
  expect(await paused()).toMatchObject({ by: expect.any(String) });
  expect((await hermes.GET("/whoami")).response.status).toBe(403);
  expect(await agentsSheet(page).getByText("Its key is refused, and its approved sends are held.").isVisible()).toBe(true);

  await agentsSheet(page).getByRole("button", { name: "Unpause" }).click();

  await expect.poll(() => summary(page).innerText(), wait).not.toMatch(/Paused/);
  expect(await paused()).toBeUndefined();
  expect((await hermes.GET("/whoami")).response.status).toBe(200);
});

test("an agent Duva paused says so on its line, with why, and one an admin paused names an admin", budget, async () => {
  const { page, signIn, duva, ada, grace, agent, send } = await withAgent();
  const { messageId } = await send("ken@example.net");
  await duva.sendingEvent(messageId!, { type: "Complaint" });
  await signIn("grace@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  await expect.poll(() => summary(page).innerText(), wait).toMatch(/^Hermes\nPaused\nPaused by Duva since \d\d:\d\d [AP]M\. A recipient complained about its mail\./);

  await grace.POST("/agents/{agent}/unpause", { params: { path: { agent: agent.id } } });
  await ada.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  await page.reload();

  await expect.poll(() => summary(page).innerText(), wait).toMatch(/^Hermes\nPaused\nPaused by an admin since \d\d:\d\d [AP]M\./);
});

test("a sponsor sets an agent's two send limits up to the organization's caps", budget, async () => {
  const { page, signIn, grace, ada, settings } = await withAgent();
  await ada.PATCH("/organization/settings", { body: { agentSendsPerHourCap: 80 } });
  await signIn("grace@example.org");
  await openHermes(page);
  const form = agentsSheet(page).getByRole("form", { name: "Hermes" });
  const perHour = form.getByRole("textbox", { name: "Sends an hour" });
  const newPerDay = form.getByRole("textbox", { name: "New recipients a day" });

  expect(await perHour.inputValue()).toBe("80");
  expect(await newPerDay.inputValue()).toBe("50");
  expect(await form.getByText("Up to 80, the organization's cap.").isVisible()).toBe(true);
  expect(await form.getByText("Up to 50, the organization's cap.").isVisible()).toBe(true);

  await perHour.fill("81");
  expect(await form.getByText("Give a whole number from 1 to 80.").isVisible()).toBe(true);
  expect(await form.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);

  await perHour.fill("20");
  await newPerDay.fill("5");
  await form.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => form.getByRole("status").textContent(), wait).toBe("Saved. This applies at once.");
  expect((await grace.GET("/agents/{agent}/settings", settings)).data).toMatchObject({ sendsPerHour: 20, newRecipientsPerDay: 5 });
});

test("a send waiting for the send limit shows on its agent's line, and Send now sends it", budget, async () => {
  const { page, signIn, duva, grace, settings, send } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  await send("ken@example.net", "First");
  const { draft } = await send("lou@example.net", "Second");
  expect(draft.send?.state).toBe("waitingForLimit");
  await signIn("grace@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  await expect.poll(() => summary(page).innerText(), wait).toMatch(/1 send waits for the send limit\./);
  expect(await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /^Hermes/ }).innerText()).toBe("Hermes\nRunning, 1 waiting");
  await agentsSheet(page).getByRole("heading", { level: 3, name: "Hermes" }).click();
  const waiting = agentsSheet(page).getByRole("region", { name: "Waiting for the send limit" });
  await expect.poll(async () => (await waiting.getByRole("listitem").allInnerTexts()).map(lines), wait).toEqual([expect.stringMatching(/^Second\nTo lou@example\.net\nSend now$/)]);
  const before = duva.sent().length;

  await waiting.getByRole("button", { name: "Send now" }).click();

  await expect.poll(() => duva.sent().length, wait).toBe(before + 1);
  await expect.poll(async () => lines(await waiting.getByRole("listitem").first().innerText()), wait).toMatch(/Sent\.$/);
  expect(await summary(page).innerText()).not.toMatch(/waits for the send limit/);
});

test("while its agent is paused, a send waiting for the send limit is held until it is unpaused, with Send now disabled, and the line and the index catch up without a reload", budget, async () => {
  const { page, signIn, duva, grace, settings, send } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  await send("ken@example.net", "First");
  await send("lou@example.net", "Second");
  await signIn("grace@example.org");
  await openHermes(page);
  const index = page.getByRole("navigation", { name: "Settings" });
  const waiting = agentsSheet(page).getByRole("region", { name: "Waiting for the send limit" });
  expect(await waiting.getByRole("button", { name: "Send now" }).isEnabled()).toBe(true);

  await agentsSheet(page).getByRole("button", { name: "Pause" }).click();

  await expect.poll(() => waiting.getByText("Held until you unpause Hermes.").isVisible(), wait).toBe(true);
  const sendNow = waiting.getByRole("button", { name: "Send now" });
  expect(await sendNow.isDisabled()).toBe(true);
  expect(await sendNow.getAttribute("aria-describedby").then((id) => page.locator(`[id="${id}"]`).textContent())).toBe("Held until you unpause Hermes.");
  await expect.poll(() => index.getByRole("link", { name: /^Hermes/ }).innerText(), wait).toBe("Hermes\nPaused, 1 waiting");

  // A higher limit lets the send go out once Hermes is unpaused.
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 2 } });
  const before = duva.sent().length;
  await agentsSheet(page).getByRole("button", { name: "Unpause" }).click();

  await expect.poll(() => duva.sent().length, wait).toBe(before + 1);
  await expect.poll(() => waiting.count(), wait).toBe(0);
  expect(await summary(page).innerText()).not.toMatch(/waits for the send limit|Paused/);
  await expect.poll(() => index.getByRole("link", { name: /^Hermes/ }).innerText(), wait).toBe("Hermes\nRunning");
});

test("a send waiting for the send limit as the sponsor shows in their draft, with Send now", budget, async () => {
  const { page, signIn, duva, grace, hermes, settings } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sponsorAccess: "send", approvalAsSponsor: false, sendsPerHour: 1 } });
  const { data: mailboxes } = await grace.GET("/mailboxes");
  const own = { path: { mailbox: mailboxes!.mailboxes.find(({ defaultAddress }) => defaultAddress === "grace@example.com")!.id } };
  for (const subject of ["First", "Second"]) {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: own, body: { to: ["ken@example.net"], subject, text: "Hej." } });
    await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...own.path, draft: draft!.id } } });
  }
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /^Drafts/ }).click();
  await page.getByRole("link", { name: /Waiting for the send limit/ }).click();

  await expect.poll(() => page.getByText("Waiting for the send limit. It goes out by itself when Hermes's send limit allows.").isVisible(), wait).toBe(true);
  expect(await page.getByRole("textbox", { name: "Subject" }).getAttribute("readonly")).not.toBeNull();
  const before = duva.sent().length;

  await page.getByRole("button", { name: "Send now" }).click();

  await expect.poll(() => duva.sent().length, wait).toBe(before + 1);
});

test("admins see the agents' caps on the Organization page and change them, and other humans don't see them", budget, async () => {
  const { page, signIn, ada } = await withAgent();
  await signIn("ada@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Organization" }).click();
  const organization = page.getByRole("region", { name: "Agents", exact: true });
  const caps = organization.getByRole("group", { name: "Agents' send limits" });
  await expect.poll(() => caps.getByRole("textbox", { name: "Sends an hour" }).inputValue(), wait).toBe("100");
  expect(await caps.getByRole("textbox", { name: "New recipients a day" }).inputValue()).toBe("50");

  await caps.getByRole("textbox", { name: "New recipients a day" }).fill("30");
  expect(await caps.getByText("Saving lowers any agent with a higher limit to this cap.").isVisible()).toBe(true);
  await organization.getByRole("button", { name: "Save" }).click();

  await expect.poll(async () => (await ada.GET("/organization/settings")).data?.agentNewRecipientsPerDayCap, wait).toBe(30);

  const other = await withAgent();
  await other.signIn("grace@example.org");
  await other.page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect.poll(() => other.page.getByRole("region", { name: "You" }).isVisible(), wait).toBe(true);
  expect(await other.page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Organization" }).count()).toBe(0);
  expect(await other.page.getByRole("group", { name: "Agents' send limits" }).count()).toBe(0);
});

test("the bar counts unseen alerts, the Alerts view lists them newest first with the urgent ones marked, and marking one seen counts it no more", budget, async () => {
  const { page, signIn, duva, send } = await withAgent();
  const bounced = await send("nobody@example.net", "Bounces");
  await duva.sendingEvent(bounced.messageId!, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail" }, { at: new Date(Date.now() - 60_000) });
  const complained = await send("ken@example.net", "Complained about");
  await duva.sendingEvent(complained.messageId!, { type: "Complaint" });
  await signIn("grace@example.org");

  await expect.poll(() => alertsLink(page).getAttribute("aria-label"), wait).toBe("Alerts, 3 unseen");
  await alertsLink(page).click();

  await expect.poll(() => alertItems(page).count(), wait).toBe(3);
  const texts = (await alertItems(page).allInnerTexts()).map(lines);
  expect(texts[0]).toMatch(/^Hermes\nPaused by Duva\n.+\nUrgent /);
  expect(texts[1]).toMatch(/^Hermes\nComplaint\n.+\nUrgent /);
  expect(texts[2]).toMatch(/^Hermes\nBounced\n.+\nMail from Hermes to nobody@example\.net hard-bounced/);
  expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Alerts");
  // The newest unseen lies open beside the list.
  await expect.poll(() => openAlert(page).getByRole("heading", { level: 2 }).textContent(), wait).toBe("Hermes Paused by Duva");
  expect(await openAlert(page).getByText("Urgent").isVisible()).toBe(true);

  await alertItems(page).nth(2).getByRole("button").click();
  await openAlert(page).getByRole("button", { name: /^Mark as seen/ }).click();

  await expect.poll(() => alertsLink(page).getAttribute("aria-label"), wait).toBe("Alerts, 2 unseen");
  expect(await openAlert(page).getByRole("button", { name: /^Mark as seen/ }).count()).toBe(0);
  expect(await alertItems(page).nth(2).innerText()).not.toContain("Unseen");

  await page.getByRole("button", { name: "Mark all as seen" }).click();

  await expect.poll(() => alertsLink(page).getAttribute("aria-label"), wait).toBe("Alerts");
  expect(await page.getByRole("button", { name: /^Mark as seen/ }).count()).toBe(0);
});

test("an alert opens the message it is about, or its agent's line in Settings, and is seen once opened", budget, async () => {
  const { page, signIn, duva, ada, agent, send } = await withAgent();
  const bounced = await send("nobody@example.net", "Bounces");
  await duva.sendingEvent(bounced.messageId!, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail" }, { at: new Date(Date.now() - 60_000) });
  await ada.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  await signIn("grace@example.org");
  await alertsLink(page).click();
  await expect.poll(() => alertItems(page).count(), wait).toBe(2);

  await alertItems(page).nth(1).getByRole("button").click();
  await openAlert(page).getByRole("link", { name: /^Open the message/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Bounces");
  await expect.poll(() => alertsLink(page).getAttribute("aria-label"), wait).toBe("Alerts, 1 unseen");

  await alertsLink(page).click();
  await alertItems(page).first().getByRole("button").click();
  await openAlert(page).getByRole("link", { name: /^Open Hermes at Pause/ }).click();

  await expect.poll(() => agentsSheet(page).getByRole("form", { name: "Hermes" }).isVisible(), wait).toBe(true);
  expect(await agentsSheet(page).getByRole("button", { name: "Unpause" }).isVisible()).toBe(true);
});

test("a sponsor without alerts finds the Alerts view saying so", budget, async () => {
  const { page, signIn } = await withAgent();
  await signIn("grace@example.org");
  await alertsLink(page).click();

  await expect.poll(() => page.getByRole("heading", { name: "No alerts" }).isVisible(), wait).toBe(true);
});

test("on a phone, the Alerts view and an agent's line with its limits fit the screen", budget, async () => {
  const { page, signIn, duva, grace, settings, send } = await withAgent({ viewport: phone });
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  const { messageId } = await send("ken@example.net", "A first message with a long subject that has to wrap on a phone");
  await duva.sendingEvent(messageId!, { type: "Complaint" });
  await grace.POST("/agents/{agent}/unpause", settings);
  await send("lou@example.net", "Waiting for the limit, with a subject long enough to wrap");
  await signIn("grace@example.org");
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  await alertsLink(page).click();
  await expect.poll(() => alertItems(page).count(), wait).toBeGreaterThan(0);
  expect(await fits()).toBe(true);
  const button = await page.getByRole("button", { name: "Mark all as seen" }).boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);

  await openHermes(page);
  await expect.poll(() => agentsSheet(page).getByRole("button", { name: "Send now" }).isVisible(), wait).toBe(true);
  expect(await fits()).toBe(true);
  expect((await agentsSheet(page).getByRole("button", { name: "Pause" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const form = agentsSheet(page).getByRole("form", { name: "Hermes" });
  for (const name of ["Sends an hour", "New recipients a day"]) {
    const field = await form.getByRole("textbox", { name }).boundingBox();
    expect(field!.x + field!.width).toBeLessThanOrEqual(phone.width);
  }
});

test("a send the sponsor approves over its agent's send limit says it waits, and Send now sends it", budget, async () => {
  const { page, signIn, duva, grace, settings, send } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { approvalForOwnMailbox: true, sendsPerHour: 1 } });
  await send("ken@example.net", "First");
  await send("lou@example.net", "Second");
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: /^Approvals/ }).click();
  for (const subject of ["First", "Second"]) {
    await rows(page).filter({ hasText: subject }).click();
    const galley = page.getByRole("article", { name: new RegExp(`${subject}$`) });
    await galley.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => galley.getByRole("button", { name: "Send", exact: true }).count(), wait).toBe(0);
  }

  const slip = page.getByRole("article").filter({ hasText: "Second" });
  await expect.poll(() => slip.getByText("Approved. It waits for Hermes's send limit, and goes out by itself when the limit allows.").isVisible(), wait).toBe(true);
  const before = duva.sent().length;
  await slip.getByRole("button", { name: "Send now" }).click();

  await expect.poll(() => duva.sent().length, wait).toBe(before + 1);
});

const approvalsLink = (page: Page) => page.getByRole("navigation").getByRole("link", { name: /^Approvals/ });

test("an approved send waiting for its send limit stays in Approvals under Waiting for the send limit, after a reload too, until it goes out", budget, async () => {
  const { page, signIn, duva, grace, settings, send } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  await send("ken@example.net", "First");
  await send("lou@example.net", "Second");
  await signIn("grace@example.org");
  await approvalsLink(page).click();
  const waiting = page.getByRole("region", { name: "Waiting for the send limit" });

  await expect.poll(async () => lines(await rows(page).first().innerText()), wait).toMatch(/^Hermes\nHeld\n.+\nSecond To lou@example\.net·?Waiting for the send limit$/);
  expect(lines(await waiting.innerText())).toMatch(/^Waiting for the send limit\nSecond\nHermes\n.+\nApproved\. Each goes out by itself.*\nTo\nlou@example\.net\n/s);
  expect(await page.getByText("Nothing is waiting for you").count()).toBe(0);
  await page.reload();
  await expect.poll(() => waiting.count(), wait).toBe(1);
  const before = duva.sent().length;

  await waiting.getByRole("button", { name: "Send now Second" }).click();

  await expect.poll(() => duva.sent().length, wait).toBe(before + 1);
  await page.reload();
  await expect.poll(() => page.getByRole("heading", { name: "Nothing is waiting for you" }).isVisible(), wait).toBe(true);
  expect(await waiting.count()).toBe(0);
});

test("a send approved before its agent was paused is held in Approvals, beside a link to the agent's line at Pause", budget, async () => {
  const { page, signIn, grace, settings, agent, send } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  await send("ken@example.net", "First");
  await send("lou@example.net", "Held back");
  await grace.POST("/agents/{agent}/pause", settings);
  await signIn("grace@example.org");
  await approvalsLink(page).click();
  const held = page.getByRole("region", { name: "Held while Hermes is paused" });

  await expect.poll(async () => lines(await held.innerText()), wait).toMatch(/^Held while Hermes is paused\nHeld back\n.+\nApproved\. Unpausing Hermes sends these.*\nTo\nlou@example\.net\n/s);
  expect(await page.getByRole("region", { name: "Waiting for the send limit" }).count()).toBe(0);
  await held.getByRole("link", { name: "Open Hermes at Pause" }).click();

  await expect.poll(() => location(page), wait).toBe(`#/settings/agents/${agent.id}`);
  await expect.poll(() => agentsSheet(page).getByRole("button", { name: "Unpause" }).isVisible(), wait).toBe(true);
});

const location = (page: Page) => page.evaluate(() => window.location.hash);

test("the urgent pause alert links to the held sends and to the agent's line at Pause", budget, async () => {
  const { page, signIn, duva, grace, settings, agent, send } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  const { messageId } = await send("ken@example.net", "Complained about");
  await send("lou@example.net", "Held back");
  // A send waiting for approval would otherwise open first.
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { approvalForOwnMailbox: true } });
  await send("max@example.net", "Asks first");
  await duva.sendingEvent(messageId!, { type: "Complaint" });
  await signIn("grace@example.org");
  await alertsLink(page).click();
  const pause = alertItems(page).filter({ hasText: "Paused by Duva" });

  await pause.getByRole("button").click();
  await openAlert(page).getByRole("link", { name: /^See the held sends/ }).click();

  await expect.poll(() => location(page), wait).toBe("#/approvals");
  await expect.poll(() => page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Held" }).getAttribute("aria-pressed"), wait).toBe("true");
  await expect.poll(() => page.getByRole("region", { name: "Held while Hermes is paused" }).getByText("Held back").first().isVisible(), wait).toBe(true);
  await alertsLink(page).click();
  await pause.getByRole("button").click();
  await openAlert(page).getByRole("link", { name: /^Open Hermes at Pause/ }).click();
  await expect.poll(() => location(page), wait).toBe(`#/settings/agents/${agent.id}`);
  await expect.poll(() => agentsSheet(page).getByRole("button", { name: "Unpause" }).isVisible(), wait).toBe(true);
});

test("each alert's controls have names that say which agent and event they are for", budget, async () => {
  const { page, signIn, duva, send } = await withAgent();
  for (const to of ["nobody@example.net", "noone@example.net"]) {
    const bounced = await send(to, "Bounces");
    await duva.sendingEvent(bounced.messageId!, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail" });
  }
  await signIn("grace@example.org");
  await alertsLink(page).click();
  await expect.poll(() => alertItems(page).count(), wait).toBe(2);

  for (const to of ["nobody", "noone"]) {
    await alertItems(page).filter({ hasText: `${to}@` }).getByRole("button").click();
    expect(await page.getByRole("button", { name: new RegExp(`^Mark as seen Hermes Bounced Mail from Hermes to ${to}@example\\.net hard-bounced`) }).count()).toBe(1);
    expect(await page.getByRole("link", { name: new RegExp(`^Open the message Hermes Bounced Mail from Hermes to ${to}@example\\.net hard-bounced`) }).count()).toBe(1);
  }
});

/** Presses Tab until the element has the keyboard's focus, as someone without a mouse gets there. */
const tabTo = async (page: Page, target: ReturnType<Page["getByRole"]>) => {
  for (let presses = 0; presses < 80; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached it");
};

test("on a phone, the sends waiting for the send limit and those held fit the screen, and the keyboard reaches Send now and the agent's line", budget, async () => {
  const { page, signIn, duva, grace, ada, settings, send } = await withAgent({ viewport: phone });
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  await send("ken@example.net", "First");
  await send("lou@example.net", "Waiting for a long while before it may go out to everyone it names");
  const { data: other } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: other!.agent.id, address: "iris@example.com" } });
  const iris = { params: { path: { agent: other!.agent.id } } };
  await grace.PATCH("/agents/{agent}/settings", { ...iris, body: { approvalForOwnMailbox: false, sendsPerHour: 1 } });
  const irisKey = duva.withKey(other!.key);
  for (const subject of ["Iris first", "Iris held"]) {
    const { data: draft } = await irisKey.POST("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: irisMailbox!.id } }, body: { to: ["max@example.net"], subject, text: "Hej." } });
    await irisKey.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { mailbox: irisMailbox!.id, draft: draft!.id } } });
  }
  await grace.POST("/agents/{agent}/pause", iris);
  await signIn("grace@example.org");
  await approvalsLink(page).click();
  const waiting = page.getByRole("region", { name: "Waiting for the send limit" });
  const held = page.getByRole("region", { name: "Held while Iris is paused" });
  const width = phone.width;
  const fits = async (section: typeof waiting) => {
    const box = (await section.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  };
  await expect.poll(() => rows(page).count(), wait).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await rows(page).filter({ hasText: "Waiting for a long while" }).click();
  await expect.poll(() => waiting.isVisible(), wait).toBe(true);
  await fits(waiting);
  const before = duva.sent().length;
  const sendNow = waiting.getByRole("button", { name: /^Send now Waiting for a long while/ });
  await tabTo(page, sendNow);
  await page.keyboard.press("Enter");

  await expect.poll(() => duva.sent().length, wait).toBe(before + 1);
  await expect.poll(() => waiting.getByText("Sent.").isVisible(), wait).toBe(true);
  await page.getByRole("button", { name: "All approvals" }).click();
  await rows(page).filter({ hasText: "Iris held" }).click();
  await expect.poll(() => held.getByText("Iris held").first().isVisible(), wait).toBe(true);
  await fits(held);
  await tabTo(page, held.getByRole("link", { name: "Open Iris at Pause" }));
  await page.keyboard.press("Enter");
  await expect.poll(() => location(page), wait).toBe(`#/settings/agents/${other!.agent.id}`);
});

test("s sends the draft open in the reading pane as written, and the queue's row says so", budget, async () => {
  const { page, signIn, duva, grace, settings, send } = await withAgent();
  await grace.PATCH("/agents/{agent}/settings", { ...settings, body: { approvalForOwnMailbox: true } });
  await send("ken@example.net", "Snabbt");
  await signIn("grace@example.org");
  await approvalsLink(page).click();
  const galley = page.getByRole("article", { name: /Snabbt$/ });
  await expect.poll(() => galley.getByRole("button", { name: "Send", exact: true }).getAttribute("aria-keyshortcuts"), wait).toBe("s");
  const before = duva.sent().length;

  await page.keyboard.press("s");

  await expect.poll(() => page.getByRole("article").getByText("You approved it as written").isVisible(), wait).toBe(true);
  await expect.poll(() => duva.sent().length, wait).toBe(before + 1);
  await expect.poll(() => rows(page).first().innerText(), wait).toContain("You approved it as written");
});
