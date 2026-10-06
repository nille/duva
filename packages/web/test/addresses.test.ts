import { expect, test } from "vitest";
import type { Page } from "playwright-core";
import { phone, startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com and example.net, where Ada is the admin, Grace a
 * human with a mailbox at grace@example.com, Linus a human without one, Hermes Ada's agent, with a
 * mailbox at hermes@example.com, and Athena Ada's agent without one. Signed in as Ada on Settings,
 * with Grace's mailbox's line open.
 */
async function withMailboxes(options: { viewport?: { width: number; height: number } } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  await ada.POST("/domains", { body: { domain: "example.net" } });
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: graces } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: hermes!.agent.id, address: "hermes@example.com" } });
  const { data: athena } = await ada.POST("/agents", { body: { name: "Athena" } });
  const { page } = app;
  await app.signIn("ada@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Addresses" }).click();
  await expect.poll(() => line(page, "grace@example.com").count(), wait).toBe(1);
  await line(page, "grace@example.com").getByRole("heading").click();
  return { ...app, ada, graces: graces!, athena: athena!.agent };
}

const sheet = (page: Page) => page.getByRole("region", { name: "Addresses" });
/** A mailbox's line, by its title: its default address, or what it is without one. */
const line = (page: Page, title: string) => sheet(page).locator("details").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const summary = (page: Page, title: string) => line(page, title).locator(".line-summary-text").textContent();
const addresses = (page: Page, title: string) => line(page, title).getByRole("list", { name: `Addresses of ${title}` }).getByRole("listitem").allInnerTexts();
const said = (page: Page, title: string) => line(page, title).getByRole("status").textContent();
const create = (page: Page) => sheet(page).getByRole("form", { name: "Add a mailbox" });

/** A first-time sender's note to the address. */
const note = (to: string) => ["From: Customer <customer@example.edu>", `To: ${to}`, "Subject: Hello", "Message-ID: <hello@example.edu>", "", "Are you there?"].join("\r\n");

test("an admin sees each mailbox by its default address with its owner under it, humans' first, then agents'", budget, async () => {
  const { page } = await withMailboxes();

  const titles = await sheet(page).locator("summary").getByRole("heading").allTextContents();

  expect(titles).toEqual(["grace@example.com", "hermes@example.com"]);
  expect(await summary(page, "grace@example.com")).toBe("grace@example.org");
  expect(await summary(page, "hermes@example.com")).toBe("Hermes, an agent");
});

test("an admin gives a mailbox another address on another domain, and makes it the default", budget, async () => {
  const { page, ada, graces } = await withMailboxes();

  await line(page, "grace@example.com").getByRole("textbox", { name: "New address" }).fill("Grace@Example.NET");
  await line(page, "grace@example.com").getByRole("button", { name: "Add address" }).click();

  await expect.poll(() => said(page, "grace@example.com"), wait).toBe("Added grace@example.net.");
  await expect.poll(() => addresses(page, "grace@example.com"), wait).toEqual([expect.stringMatching(/^grace@example\.com\s+Default/), expect.stringMatching(/^grace@example\.net\s+Make default/)]);
  expect(await summary(page, "grace@example.com")).toBe("grace@example.org. 1 more address.");

  await line(page, "grace@example.com").getByRole("button", { name: "Make grace@example.net the default" }).click();

  // The line takes its new default address as its title, and stays open.
  await expect.poll(() => summary(page, "grace@example.net"), wait).toBe("grace@example.org. 1 more address.");
  expect(await said(page, "grace@example.net")).toBe("New mail goes from grace@example.net from now on.");
  expect(await line(page, "grace@example.net").getByRole("button", { name: "Make grace@example.com the default" }).isVisible()).toBe(true);
  const { data } = await ada.GET("/organization/mailboxes");
  expect(data?.mailboxes.find(({ id }) => id === graces.id)).toMatchObject({ defaultAddress: "grace@example.net", addresses: ["grace@example.com", "grace@example.net"] });
});

test("an address Duva refuses says why under the field", budget, async () => {
  const { page } = await withMailboxes();

  await line(page, "grace@example.com").getByRole("textbox", { name: "New address" }).fill("hermes@example.com");
  await line(page, "grace@example.com").getByRole("button", { name: "Add address" }).click();

  await expect.poll(() => line(page, "grace@example.com").getByRole("alert").textContent(), wait).toBe("hermes@example.com is taken. Give another address.");
  expect(await line(page, "grace@example.com").getByRole("textbox", { name: "New address" }).getAttribute("aria-invalid")).toBe("true");
});

test("an admin removes an address after confirming it, and the mailbox's next address becomes its default", budget, async () => {
  const { page, ada, graces } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: graces.id } });
  await page.reload();
  await line(page, "grace@example.com").getByRole("heading").click();

  await line(page, "grace@example.com").getByRole("button", { name: "Remove grace@example.com" }).click();
  const confirm = line(page, "grace@example.com").getByRole("group", { name: "Remove grace@example.com" });
  expect(await confirm.innerText()).toContain("Mail to grace@example.com is refused from now on, or goes to its domain's catch-all. The mail already here stays. support@example.com becomes the default address.");
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();

  await expect.poll(() => said(page, "support@example.com"), wait).toBe("Removed grace@example.com.");
  expect(await summary(page, "support@example.com")).toBe("grace@example.org");
  expect((await ada.GET("/addresses")).data?.addresses.map(({ address }) => address)).not.toContain("grace@example.com");
});

test("removing an address that's a member of groups says which groups it leaves", budget, async () => {
  const { page, ada } = await withMailboxes();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "hermes@example.com"] } });
  await ada.POST("/groups", { body: { address: "all@example.com", members: ["Grace@Example.com"] } });
  await ada.POST("/groups", { body: { address: "agents@example.com", members: ["hermes@example.com"] } });
  await page.reload();
  await line(page, "grace@example.com").getByRole("heading").click();

  await line(page, "grace@example.com").getByRole("button", { name: "Remove grace@example.com" }).click();

  const confirm = line(page, "grace@example.com").getByRole("group", { name: "Remove grace@example.com" });
  await expect.poll(() => confirm.innerText(), wait).toContain("It leaves the groups all@example.com and team@example.com.");
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(() => summary(page, "Without an address"), wait).toMatch(/^grace@example\.org/);
  const { data } = await ada.GET("/groups");
  expect(data?.groups.map(({ address, members }) => [address, members])).toEqual([
    ["agents@example.com", ["hermes@example.com"]],
    ["all@example.com", []],
    ["team@example.com", ["hermes@example.com"]],
  ]);
});

test("removing an address that's in no group says nothing of groups", budget, async () => {
  const { page } = await withMailboxes();

  await line(page, "grace@example.com").getByRole("button", { name: "Remove grace@example.com" }).click();

  expect(await line(page, "grace@example.com").getByRole("group", { name: "Remove grace@example.com" }).innerText()).not.toContain("group");
});

test("what the default address does is said once, before the addresses, so what a change did ends the row", budget, async () => {
  const { page } = await withMailboxes();
  const opened = line(page, "grace@example.com").getByRole("group", { name: "grace@example.com" });

  await opened.getByRole("textbox", { name: "New address" }).fill("grace@example.net");
  await opened.getByRole("button", { name: "Add address" }).click();
  await expect.poll(() => addresses(page, "grace@example.com"), wait).toEqual([expect.stringMatching(/^grace@example\.com/), expect.stringMatching(/^grace@example\.net\s+Make default\s+Remove\s+Added grace@example\.net\.$/)]);

  const text = await opened.innerText();
  const lead = text.indexOf("New mail goes from the default address.");
  expect(lead).toBeGreaterThanOrEqual(0);
  expect(lead).toBeLessThan(text.indexOf("grace@example.com"));
  expect(text.lastIndexOf("New mail goes from the default address.")).toBe(lead);
  // The field follows what was said with only the room between a sheet's parts.
  const status = (await opened.getByRole("status").boundingBox())!;
  const next = (await opened.getByText("New address", { exact: true }).boundingBox())!;
  expect(next.y - (status.y + status.height)).toBeLessThanOrEqual(32);
});

test("the Addresses sheet's hints are at most 60 characters wide", budget, async () => {
  const { page } = await withMailboxes();

  const widths = await sheet(page).evaluate((sheet) => {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(60);
    return [...sheet.querySelectorAll<HTMLElement>("details[open] .hint, details[open] .setting-lead, .setting-add .hint, .setting-add .setting-lead")].map((hint) => {
      hint.append(probe);
      probe.style.cssText = "position: absolute; white-space: nowrap; font: inherit; visibility: hidden";
      const limit = probe.getBoundingClientRect().width;
      probe.remove();
      return { text: hint.textContent, over: Math.round(hint.getBoundingClientRect().width - limit) };
    });
  });

  expect(widths.length).toBeGreaterThan(1);
  for (const width of widths) expect(width, width.text ?? "").toMatchObject({ over: expect.toSatisfy((over: number) => over <= 1) });
});

test("a mailbox whose last address is removed says it has none", budget, async () => {
  const { page } = await withMailboxes();

  await line(page, "grace@example.com").getByRole("button", { name: "Remove grace@example.com" }).click();
  const confirm = line(page, "grace@example.com").getByRole("group", { name: "Remove grace@example.com" });
  expect(await confirm.innerText()).toContain("The mailbox is left without an address, and gets and sends no mail until it has one.");
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();

  await expect.poll(() => summary(page, "Without an address"), wait).toBe("grace@example.org. It gets and sends no mail until it has one.");
  expect(await addresses(page, "Without an address")).toEqual(["Removed grace@example.com."]);
});

test("what a change did is said in the row of its address, or where the row was", budget, async () => {
  const { page, ada, graces } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: graces.id } });
  await page.reload();
  await line(page, "grace@example.com").getByRole("heading").click();

  await line(page, "grace@example.com").getByRole("button", { name: "Make support@example.com the default" }).click();

  await expect.poll(() => addresses(page, "support@example.com"), wait).toEqual([
    expect.stringMatching(/^grace@example\.com\s+Make default\s+Remove$/),
    expect.stringMatching(/^support@example\.com\s+Default\s+Remove\s+New mail goes from support@example\.com from now on\.$/),
  ]);

  await line(page, "support@example.com").getByRole("button", { name: "Remove grace@example.com" }).click();
  await line(page, "support@example.com").getByRole("group", { name: "Remove grace@example.com" }).getByRole("button", { name: "Remove", exact: true }).click();

  await expect.poll(() => addresses(page, "support@example.com"), wait).toEqual(["Removed grace@example.com.", expect.stringMatching(/^support@example\.com\s+Default\s+Remove$/)]);
});

test("an owner's two mailboxes never look the same", budget, async () => {
  const { page, ada } = await withMailboxes();
  const grace = (await ada.GET("/humans")).data!.humans.find(({ email }) => email === "grace@example.org")!;
  await ada.POST("/mailboxes", { body: { owner: grace.id, address: "grace.second@example.com" } });
  await ada.DELETE("/addresses/{address}", { params: { path: { address: "grace.second@example.com" } } });
  await page.reload();

  await expect.poll(() => sheet(page).locator("summary").getByRole("heading").allTextContents(), wait).toEqual(["grace@example.com", "Mailbox 2, without an address", "hermes@example.com"]);
  expect(await sheet(page).locator(".line-summary-text").allTextContents()).toEqual([
    "grace@example.org. Mailbox 1 of 2.",
    "grace@example.org. Mailbox 2 of 2. It gets and sends no mail until it has one.",
    "Hermes, an agent",
  ]);
});

test("on a phone, a mailbox's addresses fit the screen", budget, async () => {
  const { page } = await withMailboxes({ viewport: phone });

  await expect.poll(() => addresses(page, "grace@example.com"), wait).toHaveLength(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("an admin creates a mailbox for a human who has none, whose line opens with it, and mail to its address reaches them", budget, async () => {
  const { page, duva } = await withMailboxes();

  expect(await create(page).getByRole("combobox", { name: "For" }).locator("option").allTextContents()).toEqual([
    "Choose a human or an agent",
    "ada@example.org",
    "grace@example.org",
    "linus@example.org",
    "Athena, ada@example.org's agent",
    "Hermes, ada@example.org's agent",
  ]);
  await create(page).getByRole("combobox", { name: "For" }).selectOption({ label: "linus@example.org" });
  await create(page).getByRole("textbox", { name: "Address" }).fill("Linus@Example.com");
  await create(page).getByRole("button", { name: "Add mailbox" }).click();

  await expect.poll(() => said(page, "linus@example.com"), wait).toBe("Added a mailbox for linus@example.org at linus@example.com.");
  expect(await summary(page, "linus@example.com")).toBe("linus@example.org");
  expect(await addresses(page, "linus@example.com")).toEqual([expect.stringMatching(/^linus@example\.com\s+Default/)]);
  expect(await create(page).getByRole("textbox", { name: "Address" }).inputValue()).toBe("");
  expect(await create(page).getByRole("combobox", { name: "For" }).inputValue()).toBe("");

  expect((await duva.receive(note("linus@example.com"), { to: ["linus@example.com"] })).refused).toEqual([]);
  const linus = duva.signIn("linus@example.org");
  const { data: mailboxes } = await linus.GET("/mailboxes");
  expect(mailboxes?.mailboxes.map(({ defaultAddress }) => defaultAddress)).toEqual(["linus@example.com"]);
  const { data: screener } = await linus.GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailboxes!.mailboxes[0]!.id } } });
  expect(screener?.senders.map(({ address }) => address)).toEqual(["customer@example.edu"]);
});

test("an admin creates a mailbox for an agent, and mail to its address reaches its Inbox", budget, async () => {
  const { page, duva, ada, athena } = await withMailboxes();

  await create(page).getByRole("combobox", { name: "For" }).selectOption({ label: "Athena, ada@example.org's agent" });
  await create(page).getByRole("textbox", { name: "Address" }).fill("athena@example.net");
  await create(page).getByRole("button", { name: "Add mailbox" }).click();

  await expect.poll(() => said(page, "athena@example.net"), wait).toBe("Added a mailbox for Athena at athena@example.net.");
  expect(await summary(page, "athena@example.net")).toBe("Athena, an agent");

  expect((await duva.receive(note("athena@example.net"), { to: ["athena@example.net"] })).refused).toEqual([]);
  const mailbox = (await ada.GET("/mailboxes")).data!.mailboxes.find(({ owner }) => owner === athena.id)!;
  const { data: inbox } = await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id } } });
  expect(inbox?.threads.map(({ subject }) => subject)).toEqual(["Hello"]);
});

test("an address in use or invalid for a new mailbox says why under the field, and no mailbox is created", budget, async () => {
  const { page, ada } = await withMailboxes();
  const address = create(page).getByRole("textbox", { name: "Address" });
  await create(page).getByRole("combobox", { name: "For" }).selectOption({ label: "linus@example.org" });

  await address.fill("hermes@example.com");
  await create(page).getByRole("button", { name: "Add mailbox" }).click();

  await expect.poll(() => create(page).getByRole("alert").textContent(), wait).toBe("hermes@example.com is taken. Give another address.");
  expect(await address.getAttribute("aria-invalid")).toBe("true");

  await address.fill("linus@example.org");
  await create(page).getByRole("button", { name: "Add mailbox" }).click();

  await expect.poll(() => create(page).getByRole("alert").textContent(), wait).toBe('"linus@example.org" isn\'t an address on example.com or example.net. Give one like hermes@example.com.');
  expect((await ada.GET("/organization/mailboxes")).data?.mailboxes).toHaveLength(2);
});
