import type { components } from "@duva/openapi";
import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

type SetupApproval = components["schemas"]["SetupApproval"];

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com where the admin Ada sponsors the agent Hermes, an
 * admin too, which owns a mailbox at hermes@example.com.
 */
async function withAgentAdmin(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  await ada.PATCH("/agents/{agent}", { params: { path: { agent: created!.agent.id } }, body: { admin: true } });
  const hermes = app.duva.withKey(created!.key);
  /** Hermes asks to give its mailbox the address, and answers the setup approval it waits for. */
  const askForAddress = async (address: string) => (await hermes.POST("/addresses", { body: { address, mailbox: mailbox!.id } })).data as SetupApproval;
  const addresses = async () => (await ada.GET("/addresses")).data!.addresses.map(({ address }) => address);
  return { ...app, ada, hermes, mailbox: mailbox!, askForAddress, addresses };
}

const setupGalley = (page: Page) => page.getByRole("article", { name: /Hermes asks to change the setup/ });

test("an agent admin's setup change waits in Approvals beside its sends, saying what it would do", budget, async () => {
  const { page, signIn, hermes, mailbox, askForAddress } = await withAgentAdmin();
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox.id } }, body: { to: ["linus@example.net"], subject: "Hej", text: "Hej." } });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { mailbox: mailbox.id, draft: draft!.id } } });
  await askForAddress("sales@example.com");

  await signIn("ada@example.org");
  await page.getByRole("link", { name: /^Approvals/ }).click();

  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);
  // The setup change was asked for last, so it comes first.
  await expect.poll(() => page.getByRole("article").first().getByRole("heading", { level: 2 }).textContent(), wait).toBe("Hermes asks to change the setup");
  expect(await setupGalley(page).innerText()).toContain("Gives Hermes's mailbox at hermes@example.com the address sales@example.com.");
  await expect.poll(() => page.getByRole("link", { name: /^Approvals/ }).textContent(), wait).toContain("2");
  expect(await page.getByText("2 waiting", { exact: true }).isVisible()).toBe(true);
});

test("approving an agent admin's setup change makes it, and the galley folds into a slip", budget, async () => {
  const { page, signIn, askForAddress, addresses } = await withAgentAdmin();
  await askForAddress("sales@example.com");
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /^Approvals/ }).click();

  await setupGalley(page).getByRole("button", { name: "Approve" }).click();

  await expect.poll(() => page.getByText("You approved it").isVisible(), wait).toBe(true);
  expect(await page.getByText("Made as Hermes asked.").isVisible()).toBe(true);
  expect(await addresses()).toContain("sales@example.com");
  expect(await page.getByText("Nothing is waiting for you.").isVisible()).toBe(true);
});

test("rejecting an agent admin's setup change takes a note the agent reads, and changes nothing", budget, async () => {
  const { page, signIn, hermes, askForAddress, addresses } = await withAgentAdmin();
  const asked = await askForAddress("sales@example.com");
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /^Approvals/ }).click();

  await setupGalley(page).getByRole("button", { name: "Reject" }).click();
  await setupGalley(page).getByRole("button", { name: "Reject with note" }).click();
  await expect.poll(() => page.getByRole("alert").filter({ hasText: "Write a note" }).isVisible(), wait).toBe(true);
  await page.getByLabel("Note for Hermes").fill("Use support@ instead.");
  await setupGalley(page).getByRole("button", { name: "Reject with note" }).click();

  await expect.poll(() => page.getByText("You rejected it").isVisible(), wait).toBe(true);
  expect(await page.getByText("Your note: “Use support@ instead.”").isVisible()).toBe(true);
  const { data } = await hermes.GET("/setup-approvals/{approval}", { params: { path: { approval: asked.id } } });
  expect(data).toMatchObject({ state: "rejected", note: "Use support@ instead." });
  expect(await addresses()).toEqual(["hermes@example.com"]);
});

test("a setup change asked for while Approvals is open arrives by itself, marked new", budget, async () => {
  const { page, signIn, askForAddress } = await withAgentAdmin();
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /^Approvals/ }).click();
  await expect.poll(() => page.getByText("Nothing is waiting for you").isVisible(), wait).toBe(true);

  await askForAddress("sales@example.com");

  await expect.poll(() => setupGalley(page).count(), wait).toBe(1);
  expect(await setupGalley(page).getByText("New").isVisible()).toBe(true);
  await expect.poll(() => page.getByRole("link", { name: /^Approvals/ }).textContent(), wait).toContain("1");
});

test("when the setup changed what a change would do, approving shows the new preview to read first", budget, async () => {
  const { page, signIn, ada, hermes, mailbox, addresses } = await withAgentAdmin();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: mailbox.id } });
  await hermes.DELETE("/addresses/{address}", { params: { path: { address: "hermes@example.com" } } });
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /^Approvals/ }).click();
  await expect.poll(() => setupGalley(page).innerText(), wait).toContain("The mailbox's default address becomes support@example.com.");
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "support@example.com" } } });

  await setupGalley(page).getByRole("button", { name: "Approve" }).click();

  await expect.poll(() => setupGalley(page).innerText(), wait).toContain("The mailbox is left with no address, so it receives and sends no new mail.");
  expect(await setupGalley(page).getByRole("alert").innerText()).toMatch(/changed/);
  expect(await addresses()).toEqual(["hermes@example.com"]);

  await setupGalley(page).getByRole("button", { name: "Approve" }).click();

  await expect.poll(() => page.getByText("You approved it").isVisible(), wait).toBe(true);
  expect(await addresses()).toEqual([]);
});

test("on a phone, a setup change and its decision fit the screen", budget, async () => {
  const { page, signIn, askForAddress } = await withAgentAdmin({ viewport: phone });
  await askForAddress("a-rather-long-address-for-sales@example.com");
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /^Approvals/ }).click();

  await expect.poll(() => setupGalley(page).count(), wait).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  const approve = await setupGalley(page).getByRole("button", { name: "Approve" }).boundingBox();
  expect(approve!.height).toBeGreaterThanOrEqual(44);
});
