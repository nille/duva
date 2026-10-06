import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment where Grace, who isn't an admin, has a personal mailbox at
 * grace@example.com and sponsors the agents Hermes and Iris.
 */
async function withSponsor(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  const { data: hermes } = await grace.POST("/agents", { body: { name: "Hermes" } });
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  return { ...app, grace, hermes: hermes!.agent.id, iris: iris!.agent.id };
}

const agentsSheet = (page: Page) => page.getByRole("region", { name: "Your agents" });
const agentForm = (page: Page, name: string) => agentsSheet(page).getByRole("form", { name });
/** Opens the agent's form by clicking its line on the Agents sheet, as the sponsor does. */
const openAgent = async (page: Page, name: string) => {
  await agentsSheet(page).getByRole("heading", { level: 3, name }).click();
  await expect.poll(() => agentForm(page, name).isVisible(), wait).toBe(true);
  return agentForm(page, name);
};
/** The one-line summaries of the agents on the Agents sheet, in order. */
const summaries = async (page: Page) => (await agentsSheet(page).locator("summary").allInnerTexts()).map((text) => text.replace(/\n+/g, "\n"));

test("a sponsor who isn't an admin opens Settings from the bar and finds each of their agents on the Agents sheet, with no access and every switch on", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => agentsSheet(page).getByRole("heading", { level: 3 }).allTextContents(), wait).toEqual(["Hermes", "Iris"]);
  const hermes = await openAgent(page, "Hermes");
  expect(await hermes.getByRole("radio", { name: /^None/ }).isChecked()).toBe(true);
  const access = hermes.getByRole("group", { name: "Access to my mailbox" });
  expect(await access.getByRole("radio").count()).toBe(3);
  expect(await access.getByRole("radio", { name: /^Read/ }).isChecked()).toBe(false);
  expect(await access.getByRole("radio", { name: /^Full/ }).isChecked()).toBe(false);
  for (const name of ["My approval before it sends as me", "My approval before it sends from its own mailbox"]) {
    expect(await hermes.getByRole("checkbox", { name: new RegExp(`^${name}`) }).isChecked()).toBe(true);
  }
  for (const group of ["When it sends as me", "When it sends from its own mailbox"]) {
    expect(await hermes.getByRole("group", { name: group }).getByRole("checkbox", { name: /^Add a line saying an agent sent it/ }).isChecked()).toBe(true);
  }
  expect(await hermes.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
});

test("each agent shows as one line, its access and whether its sends wait for approval, and opens into its form, one at a time", budget, async () => {
  const { page, signIn, grace, iris } = await withSponsor();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: iris } }, body: { sponsorAccess: "read", approvalForOwnMailbox: false } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => summaries(page), wait).toEqual(["Hermes\nNo access to your mailbox. Its sends wait for your approval.", "Iris\nReads your mailbox. Its sends go out without your approval."]);
  expect(await agentsSheet(page).getByRole("form").count()).toBe(0);

  await openAgent(page, "Hermes");
  await openAgent(page, "Iris");

  expect(await agentForm(page, "Hermes").isVisible()).toBe(false);
  expect(await agentForm(page, "Iris").getByRole("radio", { name: /^Read/ }).isChecked()).toBe(true);
});

test("a sponsor gives an agent full access and switches off approval of its sends as them, and both hold", budget, async () => {
  const { page, signIn, grace, hermes, iris } = await withSponsor();
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const form = await openAgent(page, "Hermes");
  await form.getByRole("radio", { name: /^Full/ }).check();
  await form.getByRole("checkbox", { name: /^My approval before it sends as me/ }).uncheck();
  await form.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => form.getByRole("status").textContent(), wait).toBe("Saved. This applies at once.");
  expect(await form.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: hermes } } })).data).toEqual({
    sponsorAccess: "full",
    approvalForOwnMailbox: true,
    approvalAsSponsor: false,
    disclosureLineForOwnMailbox: true,
    disclosureLineAsSponsor: true,
    sendsPerHour: 100,
    newRecipientsPerDay: 50,
  });
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: iris } } })).data?.sponsorAccess).toBe("none");
  expect((await summaries(page))[0]).toBe("Hermes\nFull access to your mailbox. Its sends from its own mailbox wait for your approval.");

  await page.reload();

  const reloaded = await openAgent(page, "Hermes");
  expect(await reloaded.getByRole("radio", { name: /^Full/ }).isChecked()).toBe(true);
  expect(await reloaded.getByRole("checkbox", { name: /^My approval before it sends as me/ }).isChecked()).toBe(false);
  expect(await (await openAgent(page, "Iris")).getByRole("radio", { name: /^None/ }).isChecked()).toBe(true);
});

test("lowering an agent's full access says its sends waiting as the sponsor are withdrawn and its drafts stay", budget, async () => {
  const { page, signIn, grace, hermes } = await withSponsor();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: hermes } }, body: { sponsorAccess: "full" } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const form = await openAgent(page, "Hermes");
  expect(await form.getByRole("radio", { name: /^Full/ }).isChecked()).toBe(true);
  const withdrawn = "Saving withdraws its sends as you that wait for your approval. Its drafts stay in your mailbox.";
  expect(await form.innerText()).not.toContain(withdrawn);

  await form.getByRole("radio", { name: /^Read/ }).check();

  expect(await form.innerText()).toContain(withdrawn);
  await form.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => form.getByRole("status").textContent(), wait).toBe("Saved. Its sends waiting as you are withdrawn, and its drafts stay.");
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: hermes } } })).data?.sponsorAccess).toBe("read");
});

test("an admin who sponsors no agents finds no Agents sheet in Settings", budget, async () => {
  const { page, signIn } = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  await signIn("ada@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => page.getByRole("radio", { name: /^Keep them/ }).isChecked(), wait).toBe(true);
  expect(await agentsSheet(page).count()).toBe(0);
});

test("the Agents sheet fits a phone's screen", budget, async () => {
  const { page, signIn } = await withSponsor({ viewport: phone });
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => agentsSheet(page).getByRole("heading", { level: 3 }).count(), wait).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  await openAgent(page, "Iris");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
