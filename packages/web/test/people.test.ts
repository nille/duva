import { expect, test } from "vitest";
import type { Page } from "playwright-core";
import { phone, startWebApp, textLeft } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com, where Ada is the admin and sponsors the agent Hermes.
 * Grace is a human with mailboxes at grace@example.com and grace.old@example.com, and sponsors the
 * agent Iris. Linus is a human without a mailbox. Agents own none.
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
  const { page } = app;
  await app.signIn("ada@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "People" }).click();
  await expect.poll(() => line(page, "grace@example.org").count(), wait).toBe(1);
  return { ...app, ada, iris: iris!.agent };
}

const sheet = (page: Page) => page.getByRole("region", { name: "People" });
const line = (page: Page, email: string) => sheet(page).locator("details").filter({ has: page.getByRole("heading", { name: email, exact: true }) });
const summary = (page: Page, email: string) => line(page, email).locator(".line-summary-text").textContent();
const open = (page: Page, email: string) => line(page, email).getByRole("heading").click();
const create = (page: Page) => page.getByRole("region", { name: "Addresses" }).getByRole("form", { name: "Add a mailbox" });

test("an admin sees each human with their mailboxes, whether they're an admin, and the agents they sponsor", budget, async () => {
  const { page } = await withPeople();

  expect(await sheet(page).locator("summary").getByRole("heading").allTextContents()).toEqual(["ada@example.org", "grace@example.org", "linus@example.org"]);
  expect(await summary(page, "ada@example.org")).toBe("You. Admin. No mailbox. 1 agent.");
  expect(await summary(page, "grace@example.org")).toBe("2 mailboxes. 1 agent.");
  expect(await summary(page, "linus@example.org")).toBe("No mailbox. No agents.");

  await open(page, "grace@example.org");

  const grace = line(page, "grace@example.org");
  expect(await grace.getByRole("list", { name: "Mailboxes of grace@example.org" }).getByRole("listitem").allInnerTexts()).toEqual(["grace.old@example.com", "grace@example.com"]);
  expect(await grace.getByRole("list", { name: "Agents grace@example.org sponsors" }).getByRole("listitem").allInnerTexts()).toEqual([expect.stringMatching(/^Iris\s+Remove$/)]);
});

test("an admin adds a human, whose line opens with no mailbox, offering to give them one", budget, async () => {
  const { page, ada } = await withPeople();

  await sheet(page).getByRole("textbox", { name: "Email address" }).fill("Margaret@Example.org");
  await sheet(page).getByRole("button", { name: "Add human" }).click();

  await expect.poll(() => summary(page, "margaret@example.org"), wait).toBe("No mailbox. No agents.");
  expect(await line(page, "margaret@example.org").getByRole("status").first().textContent()).toBe("Added margaret@example.org. They sign in with a code emailed there.");
  expect(await line(page, "margaret@example.org").getByRole("button", { name: "Give margaret@example.org a mailbox" }).isVisible()).toBe(true);
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
  expect(await confirm.innerText()).toContain("Iris, the agent they sponsor, is removed too.");
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
  expect((await ada.GET("/organization/agents")).data?.agents.filter(({ mailbox }) => mailbox === undefined).map(({ name }) => name)).toEqual(["Hermes"]);
});

test("an admin removes an agent after confirming it, said where it was", budget, async () => {
  const { page, ada } = await withPeople();
  await open(page, "grace@example.org");
  const grace = line(page, "grace@example.org");

  await grace.getByRole("button", { name: "Remove Iris" }).click();
  const confirm = grace.getByRole("group", { name: "Remove Iris" });
  expect(await confirm.innerText()).toContain("Iris's key stops working. This can't be undone.");
  await confirm.getByRole("button", { name: "Remove agent" }).click();

  await expect.poll(() => grace.getByRole("list", { name: "Agents grace@example.org sponsors" }).getByRole("listitem").allInnerTexts(), wait).toEqual(["Removed Iris."]);
  await expect.poll(() => summary(page, "grace@example.org"), wait).toBe("2 mailboxes. No agents.");
  expect((await ada.GET("/organization/agents")).data?.agents.filter(({ mailbox }) => mailbox === undefined).map(({ name }) => name)).toEqual(["Hermes"]);
});

test("on a phone, a human's line and their removal fit the screen", budget, async () => {
  const { page } = await withPeople({ viewport: phone });
  await open(page, "grace@example.org");

  await line(page, "grace@example.org").getByRole("button", { name: "Remove human" }).click();
  await expect.poll(() => line(page, "grace@example.org").getByRole("combobox", { name: "Hand over to" }).count(), wait).toBe(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("a human just added is given a mailbox from their line, in the Addresses sheet's form with them chosen, and mail to it reaches them", budget, async () => {
  const { page, duva } = await withPeople();
  await sheet(page).getByRole("textbox", { name: "Email address" }).fill("margaret@example.org");
  await sheet(page).getByRole("button", { name: "Add human" }).click();
  const margaret = line(page, "margaret@example.org");
  await expect.poll(() => margaret.getByRole("group", { name: "margaret@example.org" }).innerText(), wait).toContain("No mailbox yet.");

  await margaret.getByRole("button", { name: "Give margaret@example.org a mailbox" }).click();

  await expect.poll(() => create(page).getByRole("combobox", { name: "For" }).locator("option:checked").textContent(), wait).toBe("margaret@example.org");
  await expect.poll(() => create(page).getByRole("textbox", { name: "Address" }).evaluate((element) => element === document.activeElement), wait).toBe(true);
  await create(page).getByRole("textbox", { name: "Address" }).fill("margaret@example.com");
  await create(page).getByRole("button", { name: "Add mailbox" }).click();
  await expect.poll(() => page.getByText("Added a mailbox for margaret@example.org at margaret@example.com.").isVisible(), wait).toBe(true);
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "People" }).click();

  await expect.poll(() => summary(page, "margaret@example.org"), wait).toBe("1 mailbox. No agents.");
  await open(page, "margaret@example.org");
  expect(await margaret.getByRole("list", { name: "Mailboxes of margaret@example.org" }).getByRole("listitem").allInnerTexts()).toEqual(["margaret@example.com"]);
  const raw = ["From: Customer <customer@example.edu>", "To: margaret@example.com", "Subject: Welcome", "Message-ID: <welcome@example.edu>", "", "Hello."].join("\r\n");
  expect((await duva.receive(raw, { to: ["margaret@example.com"] })).refused).toEqual([]);
  const own = duva.signIn("margaret@example.org");
  const [mailbox] = (await own.GET("/mailboxes")).data!.mailboxes;
  const { data: screener } = await own.GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } } });
  expect(screener?.senders.map(({ address }) => address)).toEqual(["customer@example.edu"]);
});

test("an agent's row on its sponsor's line offers no mailbox, since agents own none", budget, async () => {
  const { page } = await withPeople();
  await open(page, "ada@example.org");
  const agents = line(page, "ada@example.org").getByRole("list", { name: "Agents ada@example.org sponsors" });

  await expect.poll(() => agents.getByRole("listitem").allInnerTexts(), wait).toEqual([expect.stringMatching(/^Hermes\s+Remove$/)]);
  expect(await agents.getByRole("button", { name: "Give Hermes a mailbox" }).count()).toBe(0);
});

test("Remove human lines up with the parts above it", budget, async () => {
  const { page } = await withPeople();
  await open(page, "grace@example.org");
  const grace = line(page, "grace@example.org");

  const [heading, button] = await textLeft([grace.getByRole("heading", { name: "Agents", exact: true }), grace.getByRole("button", { name: "Remove human" })]);

  expect(button).toBe(heading);
});
