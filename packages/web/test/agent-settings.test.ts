import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp, textLeft } from "./web-app.ts";

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
/** The lines of the agents the human brought themselves, without the mailbox agent each of their mailboxes has. */
const ownSummaries = async (page: Page) => (await summaries(page)).filter((summary) => !summary.startsWith("Mailbox agent"));

test("a sponsor who isn't an admin opens Settings from the bar and finds each of their agents on the Agents sheet, with no access and every switch on", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  // Her mailbox has its mailbox agent too.
  await expect.poll(() => agentsSheet(page).getByRole("heading", { level: 3 }).allTextContents(), wait).toEqual(["Hermes", "Iris", "Mailbox agent"]);
  const hermes = await openAgent(page, "Hermes");
  expect(await hermes.getByRole("radio", { name: /^None/ }).isChecked()).toBe(true);
  const access = hermes.getByRole("group", { name: "Access to your mailbox" });
  expect(await access.getByRole("radio").count()).toBe(5);
  for (const name of [/^Read/, /^Organize/, /^Draft/, /^Send/]) expect(await access.getByRole("radio", { name }).isChecked()).toBe(false);
  for (const name of ["Your approval before it sends as you", "Your approval before it sends from its own mailbox"]) {
    expect(await hermes.getByRole("checkbox", { name: new RegExp(`^${name}`) }).isChecked()).toBe(true);
  }
  for (const group of ["When it sends as you", "When it sends from its own mailbox"]) {
    expect(await hermes.getByRole("group", { name: group }).getByRole("checkbox", { name: /^Add a line saying an agent sent it/ }).isChecked()).toBe(true);
  }
  expect(await hermes.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
});

test("each agent shows as one line, its access and whether its sends wait for approval, and opens into its form, one at a time", budget, async () => {
  const { page, signIn, grace, iris } = await withSponsor();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: iris } }, body: { sponsorAccess: "read", approvalForOwnMailbox: false } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  await expect.poll(() => ownSummaries(page), wait).toEqual(["Hermes\nRunning, 100 sends left this hour.\nNo access to your mailbox. Its sends wait for your approval.", "Iris\nRunning, 100 sends left this hour.\nReads your mailbox. Its sends go out without your approval."]);
  expect(await agentsSheet(page).getByRole("form").count()).toBe(0);

  await openAgent(page, "Hermes");
  await openAgent(page, "Iris");

  expect(await agentForm(page, "Hermes").isVisible()).toBe(false);
  expect(await agentForm(page, "Iris").getByRole("radio", { name: /^Read/ }).isChecked()).toBe(true);
});

test("a sponsor gives an agent send access and switches off approval of its sends as them, and both hold", budget, async () => {
  const { page, signIn, grace, hermes, iris } = await withSponsor();
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  const form = await openAgent(page, "Hermes");
  await form.getByRole("radio", { name: /^Send/ }).check();
  await form.getByRole("checkbox", { name: /^Your approval before it sends as you/ }).uncheck();
  await form.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => form.getByRole("status").textContent(), wait).toBe("Saved. This applies at once.");
  expect(await form.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: hermes } } })).data).toEqual({
    sponsorAccess: "send",
    sponsorMailboxes: null,
    approvalForOwnMailbox: true,
    approvalAsSponsor: false,
    disclosureLineForOwnMailbox: true,
    disclosureLineAsSponsor: true,
    sendsPerHour: 100,
    newRecipientsPerDay: 50,
    approvalForSetup: true,
  });
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: iris } } })).data?.sponsorAccess).toBe("none");
  expect((await summaries(page))[0]).toBe("Hermes\nRunning, 100 sends left this hour.\nSends from your mailbox. Its sends from its own mailbox wait for your approval.");

  await page.reload();

  const reloaded = await openAgent(page, "Hermes");
  expect(await reloaded.getByRole("radio", { name: /^Send/ }).isChecked()).toBe(true);
  expect(await reloaded.getByRole("checkbox", { name: /^Your approval before it sends as you/ }).isChecked()).toBe(false);
  expect(await (await openAgent(page, "Iris")).getByRole("radio", { name: /^None/ }).isChecked()).toBe(true);
});

test("lowering an agent's send access says its sends waiting as the sponsor are withdrawn and its drafts stay", budget, async () => {
  const { page, signIn, grace, hermes } = await withSponsor();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: hermes } }, body: { sponsorAccess: "send" } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  const form = await openAgent(page, "Hermes");
  expect(await form.getByRole("radio", { name: /^Send/ }).isChecked()).toBe(true);
  const withdrawn = "Saving withdraws its sends as you that wait for your approval. Its drafts stay in your mailbox.";
  expect(await form.innerText()).not.toContain(withdrawn);

  await form.getByRole("radio", { name: /^Read/ }).check();

  expect(await form.innerText()).toContain(withdrawn);
  await form.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => form.getByRole("status").textContent(), wait).toBe("Saved. Its sends waiting as you are withdrawn, and its drafts stay.");
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: hermes } } })).data?.sponsorAccess).toBe("read");
});

test("a sponsor with two mailboxes chooses which of them an agent's access covers, and organize access holds", budget, async () => {
  const { page, signIn, duva, grace, hermes } = await withSponsor();
  const { data: me } = await grace.GET("/whoami");
  const { data: work } = await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me!.id, address: "grace.work@example.com" } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  const form = await openAgent(page, "Hermes");
  const covered = form.getByRole("group", { name: "Which of your mailboxes" });
  expect(await covered.getByRole("checkbox").evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).checked))).toEqual([true, true]);
  await form.getByRole("radio", { name: /^Organize/ }).check();
  await covered.getByRole("checkbox", { name: "grace@example.com" }).uncheck();
  await form.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => form.getByRole("status").textContent(), wait).toBe("Saved. This applies at once.");
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: hermes } } })).data).toMatchObject({ sponsorAccess: "organize", sponsorMailboxes: [work!.id] });
  expect((await summaries(page))[0]).toBe("Hermes\nRunning, 100 sends left this hour.\nOrganizes your mailbox. Its sends wait for your approval.");
});

test("a sponsor rotates an agent's key, which shows the new key once, and the old key stops working at once", budget, async () => {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const { page, signIn, duva } = app;
  const { data: created } = await duva.signIn("grace@example.org").POST("/agents", { body: { name: "Hermes" } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
  await openAgent(page, "Hermes");
  const key = agentsSheet(page).getByRole("region", { name: "Key" });

  await key.getByRole("button", { name: "Rotate key" }).click();

  const shown = key.getByRole("textbox", { name: "Its new key" });
  await expect.poll(() => shown.inputValue(), wait).toMatch(/^duva_agent_/);
  expect(await key.innerText()).toContain("Duva shows it only now.");
  expect((await duva.withKey(created!.key).GET("/whoami")).response.status).toBe(401);
  expect((await duva.withKey(await shown.inputValue()).GET("/whoami")).data).toMatchObject({ name: "Hermes" });
});

test("a sponsor removes an agent from its line after confirming, its line goes and its key stops working", budget, async () => {
  const { page, signIn, duva, grace } = await withSponsor();
  const { data: agents } = await grace.GET("/agents");
  const { data: rotated } = await grace.POST("/agents/{agent}/key", { params: { path: { agent: agents!.agents.find(({ name }) => name === "Hermes")!.id } } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
  await openAgent(page, "Hermes");
  const remove = agentsSheet(page).getByRole("region", { name: "Remove" });

  await remove.getByRole("button", { name: "Remove" }).click();
  const asked = remove.getByRole("group", { name: "Remove Hermes" });
  expect(await asked.innerText()).toContain("Hermes's key stops working, and any mailbox of its own is erased with its mail. This can't be undone.");
  await asked.getByRole("button", { name: "Remove agent" }).click();

  await expect.poll(() => agentsSheet(page).getByRole("heading", { level: 3 }).allTextContents(), wait).toEqual(["Iris", "Mailbox agent"]);
  expect((await duva.withKey(rotated!.key).GET("/whoami")).response.status).toBe(401);
});

test("an admin who sponsors no agents finds no Agents sheet in Settings", budget, async () => {
  const { page, signIn } = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  await signIn("ada@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => page.getByRole("region", { name: "You" }).isVisible(), wait).toBe(true);
  expect(await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).count()).toBe(0);
  expect(await agentsSheet(page).count()).toBe(0);
});

test("the Agents sheet fits a phone's screen", budget, async () => {
  const { page, signIn } = await withSponsor({ viewport: phone });
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();

  await expect.poll(() => agentsSheet(page).getByRole("heading", { level: 3 }).count(), wait).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  await openAgent(page, "Iris");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("under Your agents in the index each agent is a link saying whether it is paused, which opens its line", budget, async () => {
  const { page, signIn, grace, hermes } = await withSponsor();
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: hermes } } });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  const index = page.getByRole("navigation", { name: "Settings" });

  await expect.poll(() => index.getByRole("link", { name: /^(Hermes|Iris)/ }).allInnerTexts(), wait).toEqual(["Hermes\nPaused", "Iris\nRunning"]);
  await index.getByRole("link", { name: /^Iris/ }).click();

  await expect.poll(() => agentForm(page, "Iris").isVisible(), wait).toBe(true);
  expect(await agentForm(page, "Hermes").isVisible()).toBe(false);
  expect(await index.getByRole("link", { name: /^Iris/ }).getAttribute("aria-current")).toBe("page");
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/settings\/agents\//);
});

/**
 * The web app for a deployment where Ada, the admin, has a personal mailbox at ada@example.com and
 * sponsors the agent Hermes, which owns a mailbox at hermes@example.com.
 */
async function withAdminSponsor(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: adaMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: adaMailbox!.id } }, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  return { ...app, ada, hermes: created!.agent.id };
}

/** Opens Settings from the bar, and Your agents from its index. */
const openYourAgents = async (page: Page) => {
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
};

test("an agent admin's line says Admin after its name and whether its setup changes wait, and its sponsor switches that approval off", budget, async () => {
  const { page, signIn, ada, hermes } = await withAdminSponsor();
  await ada.PATCH("/agents/{agent}", { params: { path: { agent: hermes } }, body: { admin: true } });
  await signIn("ada@example.org");
  await openYourAgents(page);

  await expect.poll(() => ownSummaries(page), wait).toEqual(["Hermes\nAdmin\nRunning, 100 sends left this hour.\nNo access to your mailbox. Its sends and setup changes wait for your approval."]);
  const form = await openAgent(page, "Hermes");
  const approval = form.getByRole("group", { name: "When it changes the setup" }).getByRole("checkbox", { name: /^Your approval before it changes the setup/ });
  expect(await approval.isChecked()).toBe(true);

  // By keyboard, as a screen reader's user does.
  await approval.focus();
  await page.keyboard.press("Space");
  await form.getByRole("button", { name: "Save" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => form.getByRole("status").textContent(), wait).toBe("Saved. This applies at once.");
  expect((await ada.GET("/agents/{agent}/settings", { params: { path: { agent: hermes } } })).data?.approvalForSetup).toBe(false);
  expect((await summaries(page))[0]).toBe("Hermes\nAdmin\nRunning, 100 sends left this hour.\nNo access to your mailbox. Its sends wait for your approval. Its setup changes go through without your approval.");
});

test("an admin makes the agent they sponsor an admin on its line, and takes it away again", budget, async () => {
  const { page, signIn, ada, hermes } = await withAdminSponsor();
  await signIn("ada@example.org");
  await openYourAgents(page);
  await openAgent(page, "Hermes");
  const part = agentsSheet(page).getByRole("region", { name: "Admin" });
  expect(await part.getByText("An agent admin may change the organization's setup", { exact: false }).isVisible()).toBe(true);
  expect(await agentForm(page, "Hermes").getByRole("group", { name: "When it changes the setup" }).count()).toBe(0);

  await part.getByRole("button", { name: "Make it an admin" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(async () => (await summaries(page))[0], wait).toMatch(/^Hermes\nAdmin\n/);
  expect((await ada.GET("/agents")).data!.agents.find(({ name }) => name === "Hermes")!.admin).toBe(true);
  expect(await agentForm(page, "Hermes").getByRole("group", { name: "When it changes the setup" }).isVisible()).toBe(true);

  await part.getByRole("button", { name: "Take admin away" }).click();

  await expect.poll(async () => (await summaries(page))[0], wait).not.toMatch(/Admin/);
  expect((await ada.GET("/agents")).data!.agents.find(({ name }) => name === "Hermes")!.admin).toBe(false);
  expect(await part.getByRole("button", { name: "Make it an admin" }).isVisible()).toBe(true);
});

test("a sponsor who isn't an admin is told only admins make agents admins, and offered no button for it", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("grace@example.org");
  await openYourAgents(page);
  await openAgent(page, "Hermes");

  const part = agentsSheet(page).getByRole("region", { name: "Admin" }).first();
  await expect.poll(() => part.innerText(), wait).toContain("Only an admin can make an agent an admin.");
  expect(await part.getByRole("button").count()).toBe(0);
});

test("a checked box on an agent's line lies on paper, and only a chosen radio lies on the field grey", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("grace@example.org");
  await openYourAgents(page);
  const form = await openAgent(page, "Hermes");
  const background = (control: ReturnType<typeof form.getByRole>) => control.evaluate((input) => getComputedStyle(input.closest(".choice")!).backgroundColor);

  const box = form.getByRole("checkbox", { name: /^Your approval before it sends from its own mailbox/ });
  expect(await box.isChecked()).toBe(true);
  expect(await background(box)).toBe("rgba(0, 0, 0, 0)");
  expect(await background(form.getByRole("radio", { name: /^None/ }))).toBe("rgb(226, 226, 221)");
});

test("the part on pausing is named for what it holds, not for its button", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("grace@example.org");
  await openYourAgents(page);
  await openAgent(page, "Hermes");

  const part = agentsSheet(page).getByRole("region", { name: "Running or paused" }).first();
  expect(await part.getByRole("button", { name: "Pause" }).isVisible()).toBe(true);
});

test("on a phone, the link to an agent's activity lines up with its line and its settings", budget, async () => {
  const { page, signIn } = await withSponsor({ viewport: phone });
  await signIn("grace@example.org");
  await openYourAgents(page);
  await openAgent(page, "Hermes");

  const [name, activity, part] = await textLeft([
    agentsSheet(page).getByRole("heading", { level: 3, name: "Hermes" }),
    agentsSheet(page).getByRole("link", { name: "Hermes's activity" }),
    agentsSheet(page).getByRole("heading", { level: 4, name: "Running or paused" }).first(),
  ]);
  expect(activity).toBe(name);
  expect(part).toBe(name);
});

test("on a phone, Your agents gives the focus to its title, and an agent opened from the index to its line, as other pages do", budget, async () => {
  const { page, signIn } = await withSponsor({ viewport: phone });
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  const index = page.getByRole("navigation", { name: "Settings" });

  await index.getByRole("link", { name: "Your agents" }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent), wait).toBe("Your agents");
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H2");

  await page.goBack();
  await index.getByRole("link", { name: /^Iris/ }).click();
  await expect.poll(() => agentForm(page, "Iris").isVisible(), wait).toBe(true);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName), wait).toBe("SUMMARY");
  expect(await page.evaluate(() => document.activeElement?.querySelector("h3")?.textContent)).toBe("Iris");
});

test("on a wide screen too, Your agents gives the focus to its title, and an agent's sub-entry to its line", budget, async () => {
  const { page, signIn } = await withSponsor();
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  const index = page.getByRole("navigation", { name: "Settings" });

  await index.getByRole("link", { name: "Your agents" }).click();
  await expect.poll(() => page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent}`), wait).toBe("H2 Your agents");

  await index.getByRole("link", { name: /^Iris/ }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("summary")?.querySelector("h3")?.textContent), wait).toBe("Iris");
});
