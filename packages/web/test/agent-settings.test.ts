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
  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const { data: hermes } = await grace.POST("/agents", { body: { name: "Hermes" } });
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  return { ...app, grace, hermes: hermes!.agent.id, iris: iris!.agent.id };
}

const agentsSheet = (page: Page) => page.getByRole("region", { name: "Your agents" });
const agentForm = (page: Page, name: string) => agentsSheet(page).getByRole("form", { name });

test("a sponsor who isn't an admin opens Settings from the bar and finds each of their agents on the Agents sheet, with no access and every switch on", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const hermes = agentForm(page, "Hermes");
  await expect.poll(() => hermes.getByRole("radio", { name: /^None/ }).isChecked(), wait).toBe(true);
  expect(await agentsSheet(page).getByRole("heading", { level: 3 }).allTextContents()).toEqual(["Hermes", "Iris"]);
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

test("a sponsor gives an agent full access and switches off approval of its sends as them, and both hold", budget, async () => {
  const { page, signIn, grace, hermes, iris } = await withSponsor();
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const form = agentForm(page, "Hermes");
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
  });
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: iris } } })).data?.sponsorAccess).toBe("none");

  await page.reload();

  const reloaded = agentForm(page, "Hermes");
  await expect.poll(() => reloaded.getByRole("radio", { name: /^Full/ }).isChecked(), wait).toBe(true);
  expect(await reloaded.getByRole("checkbox", { name: /^My approval before it sends as me/ }).isChecked()).toBe(false);
  expect(await agentForm(page, "Iris").getByRole("radio", { name: /^None/ }).isChecked()).toBe(true);
});

test("lowering an agent's full access says its sends waiting as the sponsor are withdrawn and its drafts stay", budget, async () => {
  const { page, signIn, grace, hermes } = await withSponsor();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: hermes } }, body: { sponsorAccess: "full" } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const form = agentForm(page, "Hermes");
  await expect.poll(() => form.getByRole("radio", { name: /^Full/ }).isChecked(), wait).toBe(true);
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

  await expect.poll(() => agentForm(page, "Iris").getByRole("radio", { name: /^None/ }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
