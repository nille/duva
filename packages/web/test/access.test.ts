import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import type { components } from "@duva/openapi";
import { phone, startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment where Grace has two personal mailboxes, grace@example.com and
 * grace.work@example.com, and an agent that has no key yet asks for access, as duva login --agent
 * does, for the second, to draft.
 */
async function withRequest(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: home } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const { data: work } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace.work@example.com" } });
  const { data: asked } = await app.duva.client.POST("/access-requests", { body: { name: "Hermes", host: "build-box", mailboxes: ["grace.work@example.com"], wants: "draft" } });
  const collect = () => app.duva.client.POST("/access-requests/collect", { body: { deviceCode: asked!.deviceCode } });
  /** The agent and its key, which the agent collects once the human approved. */
  const collected = async () => {
    const { response, data } = await collect();
    expect(response.status).toBe(200);
    return data as components["schemas"]["AgentWithKey"];
  };
  return { ...app, grace, graceId: me!.id, home: home!, work: work!, asked: asked!, link: `${app.url}#/access/${asked!.code}`, collect, collected };
}

/** Signs in on managed login, from the door the link opened, as the human would. */
async function signInAt(page: Page, email: string) {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("input[name=email]").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const request = (page: Page) => page.getByRole("main");

test("a human opens an agent's link signed out, signs in, and lands on its request: its name, the code, where it asked from and what it asks", budget, async () => {
  const { page, link, asked } = await withRequest();
  await page.goto(link);

  expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Sign in to see the request");
  await signInAt(page, "grace@example.org");

  const main = request(page);
  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes asks for access");
  expect(page.url()).toBe(link);
  expect(await main.locator("dl").innerText()).toMatch(new RegExp(`Code\\s+${asked.code}\\s+Asked from\\s+127\\.0\\.0\\.1, on a computer it calls build-box\\s+Works until`));
  expect(await main.getByRole("textbox", { name: "Its name" }).inputValue()).toBe("Hermes");
  const mailboxes = main.getByRole("group", { name: "Your mailboxes" });
  expect(await mailboxes.getByRole("checkbox", { name: /^grace\.work@example\.com/ }).isChecked()).toBe(true);
  expect(await mailboxes.getByRole("checkbox", { name: /^grace@example\.com/ }).isChecked()).toBe(false);
  expect(await mailboxes.innerText()).toContain("It asked for this one.");
  const access = main.getByRole("group", { name: "What it may do" });
  expect(await access.getByRole("radio").count()).toBe(5);
  expect(await access.getByRole("radio", { name: /^Draft/ }).isChecked()).toBe(true);
  const sends = main.getByRole("group", { name: "When it sends" });
  expect(await sends.getByRole("checkbox", { name: /^Your approval before it sends/ }).isChecked()).toBe(true);
  expect(await sends.innerText()).toContain("With this access it can't send.");
  expect(await sends.innerText()).toContain('Its mail ends with the line "Sent by Hermes for grace@example.org"');
});

test("approving makes the human the agent's sponsor with what it asked for, the agent collects its key, and it shows in Your agents", budget, async () => {
  const { page, link, grace, graceId, work, collected: collectKey } = await withRequest();
  await page.goto(link);
  await signInAt(page, "grace@example.org");
  const main = request(page);
  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes asks for access");

  await main.getByRole("button", { name: "Approve" }).click();

  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes has access");
  const collected = await collectKey();
  expect(collected.agent).toEqual({ id: expect.any(String), kind: "agent", name: "Hermes", sponsor: graceId, admin: false });
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: collected.agent.id } } })).data).toMatchObject({ sponsorAccess: "draft", sponsorMailboxes: [work.id] });
  await main.getByRole("link", { name: "Hermes in Your agents" }).click();
  const agents = page.getByRole("region", { name: "Your agents" });
  await expect.poll(() => agents.getByRole("heading", { level: 3 }).allTextContents(), wait).toEqual(["Hermes"]);
  const line = agents.getByRole("form", { name: "Hermes" });
  await expect.poll(() => line.isVisible(), wait).toBe(true);
  expect(await line.getByRole("radio", { name: /^Draft/ }).isChecked()).toBe(true);
  for (const part of ["Running or paused", "Key", "Remove"]) expect(await agents.getByRole("region", { name: part }).isVisible()).toBe(true);
});

test("the human names the agent, picks both mailboxes and lets it send as them without approval before approving", budget, async () => {
  const { page, link, grace, home, work, collected: collectKey } = await withRequest();
  await page.goto(link);
  await signInAt(page, "grace@example.org");
  const main = request(page);
  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes asks for access");

  await main.getByRole("textbox", { name: "Its name" }).fill("Hermes at work");
  await main.getByRole("checkbox", { name: /^grace@example\.com/ }).check();
  await main.getByRole("radio", { name: /^Send on your behalf/ }).check();
  const sends = main.getByRole("group", { name: "When it sends" });
  expect(await sends.getByRole("checkbox", { name: /^Your approval before it sends/ }).isChecked()).toBe(true);
  expect(await sends.innerText()).toContain('Its mail ends with the line "Sent by Hermes at work for grace@example.org"');
  await main.getByRole("radio", { name: /^Send as you/ }).check();
  expect(await sends.innerText()).toContain("Its mail carries no visible line.");
  await sends.getByRole("checkbox", { name: /^Your approval before it sends/ }).uncheck();
  await main.getByRole("button", { name: "Approve" }).click();

  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes at work has access");
  const collected = await collectKey();
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: collected.agent.id } } })).data).toMatchObject({
    sponsorAccess: "send",
    sponsorMailboxes: expect.arrayContaining([home.id, work.id]),
    approvalAsSponsor: false,
    disclosureLineAsSponsor: false,
  });
});

test("declining says the agent gets no access, and the agent is refused its key", budget, async () => {
  const { page, link, collect, grace } = await withRequest();
  await page.goto(link);
  await signInAt(page, "grace@example.org");
  const main = request(page);
  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes asks for access");

  await main.getByRole("button", { name: "Decline" }).click();

  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes gets no access");
  expect((await collect()).response.status).toBe(403);
  expect((await grace.GET("/agents")).data!.agents).toEqual([]);
});

test("a link whose code expired says it can't be used and to ask the agent again", budget, async () => {
  const { page, link, duva, asked } = await withRequest();
  await duva.clock(new Date(Date.parse(asked.expiresAt) + 1000));

  await page.goto(link);
  await signInAt(page, "grace@example.org");

  const main = request(page);
  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("This access request can't be used");
  expect(await main.getByRole("alert").innerText()).toBe("No access request waits with this code. A code works for 10 minutes and once, so ask the agent to ask again.");
});

test("on a phone the request takes the screen, and approving works the same", budget, async () => {
  const { page, link, collect } = await withRequest({ viewport: phone });
  await page.goto(link);
  await signInAt(page, "grace@example.org");
  const main = request(page);
  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes asks for access");

  const approve = main.getByRole("button", { name: "Approve" });
  const box = await approve.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width);
  await approve.click();

  await expect.poll(() => main.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes has access");
  expect((await collect()).response.status).toBe(200);
});
