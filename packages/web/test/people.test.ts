import { expect, test } from "vitest";
import type { Page } from "playwright-core";
import { phone, startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com, where Ada is the admin and sponsors Hermes, an agent
 * without a mailbox. Grace is a human with mailboxes at grace@example.com and grace.old@example.com,
 * and sponsors Iris, an agent with a mailbox at iris@example.com. Linus is a human without one.
 * Signed in as Ada on Settings.
 */
async function withPeople(options: { viewport?: { width: number; height: number } } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: graceActor } = await grace.GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace.old@example.com" } });
  await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });
  const { page } = app;
  await app.signIn("ada@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => line(page, "grace@example.org").count(), wait).toBe(1);
  return { ...app, ada, iris: iris!.agent };
}

const sheet = (page: Page) => page.getByRole("region", { name: "People" });
const line = (page: Page, email: string) => sheet(page).locator("details").filter({ has: page.getByRole("heading", { name: email, exact: true }) });
const summary = (page: Page, email: string) => line(page, email).locator(".line-summary-text").textContent();
const open = (page: Page, email: string) => line(page, email).getByRole("heading").click();

test("an admin sees each human with their mailboxes, whether they're an admin, and the agents they sponsor", budget, async () => {
  const { page } = await withPeople();

  expect(await sheet(page).locator("summary").getByRole("heading").allTextContents()).toEqual(["ada@example.org", "grace@example.org", "linus@example.org"]);
  expect(await summary(page, "ada@example.org")).toBe("You. Admin. No mailbox. 1 agent.");
  expect(await summary(page, "grace@example.org")).toBe("2 mailboxes. 1 agent.");
  expect(await summary(page, "linus@example.org")).toBe("No mailbox. No agents.");

  await open(page, "grace@example.org");

  const grace = line(page, "grace@example.org");
  expect(await grace.getByRole("list", { name: "Mailboxes of grace@example.org" }).getByRole("listitem").allInnerTexts()).toEqual(["grace.old@example.com", "grace@example.com"]);
  expect(await grace.getByRole("list", { name: "Agents grace@example.org sponsors" }).getByRole("listitem").allInnerTexts()).toEqual([expect.stringMatching(/^Iris\s+iris@example\.com\s+Remove$/)]);
});

test("an admin adds a human, whose line opens with no mailbox, saying where to give them one", budget, async () => {
  const { page, ada } = await withPeople();

  await sheet(page).getByRole("textbox", { name: "Email address" }).fill("Margaret@Example.org");
  await sheet(page).getByRole("button", { name: "Add human" }).click();

  await expect.poll(() => summary(page, "margaret@example.org"), wait).toBe("No mailbox. No agents.");
  expect(await line(page, "margaret@example.org").getByRole("status").first().textContent()).toBe(
    "Added margaret@example.org. They sign in with a code emailed there. Give them a mailbox on the Addresses sheet.",
  );
  expect(await sheet(page).getByRole("textbox", { name: "Email address" }).inputValue()).toBe("");
  expect((await ada.GET("/humans")).data?.humans.map(({ email }) => email)).toContain("margaret@example.org");
});

test("an address Duva refuses for a human says why under the field", budget, async () => {
  const { page } = await withPeople();

  await sheet(page).getByRole("textbox", { name: "Email address" }).fill("grace@example.org");
  await sheet(page).getByRole("button", { name: "Add human" }).click();

  await expect.poll(() => sheet(page).getByRole("form", { name: "Add a human" }).getByRole("alert").textContent(), wait).toBe(
    "grace@example.org is already a human in the organization. List the humans to find their ID.",
  );
});

test("an admin makes a human an admin and takes it away again, said beside the button", budget, async () => {
  const { page, ada } = await withPeople();
  await open(page, "grace@example.org");
  const grace = line(page, "grace@example.org");

  await grace.getByRole("button", { name: "Make admin" }).click();

  await expect.poll(() => summary(page, "grace@example.org"), wait).toBe("Admin. 2 mailboxes. 1 agent.");
  expect(await grace.getByRole("group", { name: "Admin" }).getByRole("status").textContent()).toBe("grace@example.org is an admin now.");
  expect((await ada.GET("/humans")).data?.humans.find(({ email }) => email === "grace@example.org")?.admin).toBe(true);

  await grace.getByRole("button", { name: "Take admin away" }).click();

  await expect.poll(() => summary(page, "grace@example.org"), wait).toBe("2 mailboxes. 1 agent.");
  expect(await grace.getByRole("group", { name: "Admin" }).getByRole("status").textContent()).toBe("grace@example.org isn't an admin now.");
});

test("the last admin can't lose admin or be removed, and says why", budget, async () => {
  const { page } = await withPeople();
  await open(page, "ada@example.org");
  const ada = line(page, "ada@example.org");

  expect(await ada.getByRole("group", { name: "Admin" }).innerText()).toContain("The organization's only admin. Make another human an admin before taking it away or removing them.");
  expect(await ada.getByRole("button", { name: "Take admin away" }).count()).toBe(0);
  expect(await ada.getByRole("button", { name: "Remove human" }).count()).toBe(0);
});

test("an admin removes a human, handing one mailbox to another human and deleting the other, and their agents go with them", budget, async () => {
  const { page, ada } = await withPeople();
  await open(page, "grace@example.org");
  const grace = line(page, "grace@example.org");

  await grace.getByRole("button", { name: "Remove human" }).click();
  const confirm = grace.getByRole("group", { name: "Remove grace@example.org" });
  await expect.poll(() => confirm.innerText(), wait).toContain("grace@example.org can't sign in from now on.");
  expect(await confirm.innerText()).toContain("Iris, the agent they sponsor, is removed too, and its mailbox iris@example.com erased with its mail.");
  await confirm.getByRole("group", { name: "grace.old@example.com" }).getByRole("radio", { name: /^Delete/ }).check();
  await confirm.getByRole("combobox", { name: "Hand over to" }).selectOption("linus@example.org");
  expect(await confirm.innerText()).toContain("grace.old@example.com is erased with its mail. This can't be undone.");
  await confirm.getByRole("button", { name: "Remove grace@example.org" }).click();

  await expect.poll(() => sheet(page).getByRole("status").filter({ hasText: "Removed grace@example.org" }).textContent(), wait).toBe(
    "Removed grace@example.org. linus@example.org has grace@example.com now.",
  );
  await expect.poll(() => summary(page, "linus@example.org"), wait).toBe("1 mailbox. No agents.");
  expect(await sheet(page).locator("summary").getByRole("heading").allTextContents()).toEqual(["ada@example.org", "linus@example.org"]);
  const { data: mailboxes } = await ada.GET("/organization/mailboxes");
  const linus = (await ada.GET("/humans")).data?.humans.find(({ email }) => email === "linus@example.org");
  expect(mailboxes?.mailboxes.map(({ owner, addresses }) => ({ owner, addresses }))).toEqual([{ owner: linus!.id, addresses: ["grace@example.com"] }]);
  expect((await ada.GET("/organization/agents")).data?.agents.map(({ name }) => name)).toEqual(["Hermes"]);
});

test("an admin removes an agent after confirming it, said where it was", budget, async () => {
  const { page, ada } = await withPeople();
  await open(page, "grace@example.org");
  const grace = line(page, "grace@example.org");

  await grace.getByRole("button", { name: "Remove Iris" }).click();
  const confirm = grace.getByRole("group", { name: "Remove Iris" });
  expect(await confirm.innerText()).toContain("Iris's key stops working, and its mailbox iris@example.com is erased with its mail. This can't be undone.");
  await confirm.getByRole("button", { name: "Remove agent" }).click();

  await expect.poll(() => grace.getByRole("list", { name: "Agents grace@example.org sponsors" }).getByRole("listitem").allInnerTexts(), wait).toEqual(["Removed Iris."]);
  await expect.poll(() => summary(page, "grace@example.org"), wait).toBe("2 mailboxes. No agents.");
  expect((await ada.GET("/organization/agents")).data?.agents.map(({ name }) => name)).toEqual(["Hermes"]);
});

test("on a phone, a human's line and their removal fit the screen", budget, async () => {
  const { page } = await withPeople({ viewport: phone });
  await open(page, "grace@example.org");

  await line(page, "grace@example.org").getByRole("button", { name: "Remove human" }).click();
  await expect.poll(() => line(page, "grace@example.org").getByRole("combobox", { name: "Hand over to" }).count(), wait).toBe(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
