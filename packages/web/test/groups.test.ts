import { expect, test } from "vitest";
import type { Page } from "playwright-core";
import { phone, startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com, where Ada is the admin and sponsors Hermes, an agent
 * with a mailbox at hermes@example.com, and Grace is a human with one at grace@example.com. The
 * group team@example.com has Grace, Hermes and linus@example.net as members. Signed in as Ada on
 * Settings.
 */
async function withTeam(options: { viewport?: { width: number; height: number } } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: hermes!.agent.id, address: "hermes@example.com" } });
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "hermes@example.com", "linus@example.net"] } });
  const { page } = app;
  await app.signIn("ada@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => line(page, "team@example.com").count(), wait).toBe(1);
  return { ...app, ada };
}

const sheet = (page: Page) => page.getByRole("region", { name: "Groups" });
const line = (page: Page, address: string) => sheet(page).locator("details").filter({ has: page.getByRole("heading", { name: address, exact: true }) });
const summary = (page: Page, address: string) => line(page, address).locator(".line-summary-text").textContent();
const members = (page: Page, address: string) => line(page, address).getByRole("list", { name: `Members of ${address}` }).getByRole("listitem").allInnerTexts();
const open = (page: Page, address: string) => line(page, address).getByRole("heading").click();

test("an admin sees each group with its members, local or external, and who can send to it", budget, async () => {
  const { page } = await withTeam();

  expect(await summary(page, "team@example.com")).toBe("3 members. Anyone can send to it.");

  await open(page, "team@example.com");

  expect(await members(page, "team@example.com")).toEqual([
    expect.stringMatching(/^grace@example\.com\s+grace@example\.org's mailbox\s+Remove$/),
    expect.stringMatching(/^hermes@example\.com\s+Hermes's mailbox, an agent\s+Remove$/),
    expect.stringMatching(/^linus@example\.net\s+External address\s+Remove$/),
  ]);
  expect(await line(page, "team@example.com").getByRole("radio", { name: /^Anyone/ }).isChecked()).toBe(true);
  expect(await line(page, "team@example.com").getByRole("radio", { name: /^To the sender/ }).isChecked()).toBe(true);
});

test("an admin creates a group with its first members, and it opens, saying so", budget, async () => {
  const { page, ada } = await withTeam();
  const form = sheet(page).getByRole("form", { name: "New group" });

  await form.getByRole("textbox", { name: "Address" }).fill("Support@Example.com");
  await form.getByRole("textbox", { name: "Members" }).fill("grace@example.com, team@example.com");
  await form.getByRole("button", { name: "Create group" }).click();

  await expect.poll(() => line(page, "support@example.com").getByRole("status").first().textContent(), wait).toBe(
    "Created support@example.com. Anyone can send to it until you choose otherwise.",
  );
  expect(await members(page, "support@example.com")).toEqual([expect.stringMatching(/^grace@example\.com/), expect.stringMatching(/^team@example\.com\s+A group/)]);
  expect(await form.getByRole("textbox", { name: "Address" }).inputValue()).toBe("");
  expect((await ada.GET("/groups/{group}", { params: { path: { group: "support@example.com" } } })).data).toEqual({
    address: "support@example.com",
    members: ["grace@example.com", "team@example.com"],
    sendPolicy: "anyone",
    replyTo: "sender",
  });
});

test("a group Duva refuses to create says why", budget, async () => {
  const { page } = await withTeam();
  const form = sheet(page).getByRole("form", { name: "New group" });

  await form.getByRole("textbox", { name: "Address" }).fill("grace@example.com");
  await form.getByRole("button", { name: "Create group" }).click();

  await expect.poll(() => form.getByRole("alert").textContent(), wait).toMatch(/^grace@example\.com is taken/);
});

test("an admin adds a member and removes another, each said in its row", budget, async () => {
  const { page, ada } = await withTeam();
  await open(page, "team@example.com");
  const team = line(page, "team@example.com");

  await team.getByRole("textbox", { name: "New member" }).fill("Margaret@Example.net");
  await team.getByRole("button", { name: "Add member" }).click();

  await expect.poll(() => members(page, "team@example.com"), wait).toHaveLength(4);
  expect((await members(page, "team@example.com"))[3]).toMatch(/^margaret@example\.net\s+External address\s+Remove\s+Added margaret@example\.net\. It gets a copy of the group's mail from now on\.$/);
  await expect.poll(() => summary(page, "team@example.com"), wait).toBe("4 members. Anyone can send to it.");

  await team.getByRole("button", { name: "Remove linus@example.net from the group" }).click();

  await expect.poll(() => members(page, "team@example.com"), wait).toContain("Removed linus@example.net. It gets no copies from now on.");
  expect((await ada.GET("/groups/{group}", { params: { path: { group: "team@example.com" } } })).data?.members).toEqual(["grace@example.com", "hermes@example.com", "margaret@example.net"]);
});

test("an admin lets only the group's members send to it, and sends external members' replies to the group", budget, async () => {
  const { page, ada } = await withTeam();
  await open(page, "team@example.com");
  const team = line(page, "team@example.com");

  await team.getByRole("radio", { name: /^Its members/ }).check();
  await team.getByRole("radio", { name: /^To the group/ }).check();
  await team.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => team.getByRole("status").filter({ hasText: "Saved" }).textContent(), wait).toBe("Saved. This applies to mail that arrives from now on.");
  await expect.poll(() => summary(page, "team@example.com"), wait).toBe("3 members. Only its members can send to it.");
  expect((await ada.GET("/groups/{group}", { params: { path: { group: "team@example.com" } } })).data).toMatchObject({ sendPolicy: "members", replyTo: "group" });
  expect(await team.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
});

test("an admin deletes a group after confirming it, said where it was", budget, async () => {
  const { page, ada } = await withTeam();
  await open(page, "team@example.com");

  await line(page, "team@example.com").getByRole("button", { name: "Delete group" }).click();
  const confirm = sheet(page).getByRole("group", { name: "Delete team@example.com" });
  expect(await confirm.innerText()).toContain("Mail to team@example.com is refused from now on, or goes to its domain's catch-all. The copies members got stay theirs.");
  await confirm.getByRole("button", { name: "Delete group" }).click();

  await expect.poll(() => sheet(page).getByRole("status").filter({ hasText: "Deleted" }).textContent(), wait).toBe("Deleted team@example.com.");
  expect(await line(page, "team@example.com").count()).toBe(0);
  expect((await ada.GET("/groups")).data?.groups).toEqual([]);
});

test("on a phone, a group's members fit the screen", budget, async () => {
  const { page } = await withTeam({ viewport: phone });
  await open(page, "team@example.com");

  await expect.poll(() => members(page, "team@example.com"), wait).toHaveLength(3);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
