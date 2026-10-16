import { expect, test } from "vitest";
import type { DuvaOptions } from "@duva/api/harness";
import type { Page } from "playwright-core";
import { startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

type Model = NonNullable<DuvaOptions["model"]>;
type Request = Parameters<Model>[0];
type Event = ReturnType<Model> extends AsyncIterable<infer Each> ? Each : never;

const use = (name: string, input: Record<string, unknown> = {}): Event => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

/** A stand-in for Claude: Coo's steps for its own run, and the page's for a browsing run, told apart by its finish tool. */
function scripted({ coo, page }: { coo: ((request: Request) => Event[])[]; page: ((request: Request) => Event[])[] }): Model {
  let [cooStep, pageStep] = [0, 0];
  return async function* (request) {
    const browsing = request.tools.some(({ name }) => name === "finish");
    const events = browsing ? (page[pageStep++]?.(request) ?? [use("finish", { done: false, said: "It stopped." })]) : (coo[cooStep++]?.(request) ?? [{ text: "Done." }]);
    for (const event of events) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
}

/** Opens Secrets from Settings' index, as the human does. */
async function openSecrets(page: Page) {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Secrets", exact: true }).click();
  await page.getByRole("heading", { level: 2, name: "Secrets" }).waitFor(wait);
}

/** The web app for a deployment where the human Grace has a mailbox at grace@example.com, and Claude Sonnet 5.5 does every job. */
async function withMailbox(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-sonnet-5-5", mailboxAgentHarderModel: "anthropic.claude-sonnet-5-5" } });
  const grace = app.duva.signIn("grace@example.org");
  const { data: whoami } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: whoami!.id, address: "grace@example.com" } });
  return { ...app, grace, mailbox: mailbox! };
}

test("a human adds a login and a card in Settings, sees only their last four, sets the card's limits, reveals the login with a sign-in code, renames it and deletes the card", budget, async () => {
  const { page, signIn, duva, grace } = await withMailbox();
  await signIn("grace@example.org");
  await openSecrets(page);
  await page.getByText("You keep no secrets yet.").waitFor(wait);
  const add = page.getByRole("form", { name: "Add a secret" });

  await add.getByRole("textbox", { name: "Name", exact: true }).fill("Example Shop");
  await add.getByRole("textbox", { name: "Username or email" }).fill("grace.h");
  await add.getByLabel("Password").fill("correct horse battery staple");
  await add.getByRole("button", { name: "Add a secret" }).click();
  await page.getByRole("status").filter({ hasText: "Added Example Shop." }).waitFor(wait);

  await add.getByRole("radio", { name: "Card" }).check();
  await add.getByRole("textbox", { name: "Name", exact: true }).fill("Visa");
  await add.getByRole("textbox", { name: "Card number" }).fill("4242 4242 4242 4242");
  await add.getByRole("textbox", { name: "Expiry" }).fill("12/29");
  await add.getByRole("textbox", { name: "Security code" }).fill("123");
  await add.getByRole("button", { name: "Add a secret" }).click();
  await page.getByRole("status").filter({ hasText: "Added Visa." }).waitFor(wait);

  const lines = page.locator(".secret-line");
  await expect.poll(() => lines.locator("summary").allInnerTexts(), wait).toEqual(["Example Shop\n\nLogin for …ce.h", "Visa\n\nCard ending 4242, doesn't pay until you set its limits"]);
  expect(await page.locator(".settings-page").innerText()).not.toContain("correct horse");

  // The card opened as it was added; its limits make it pay.
  const visa = lines.filter({ hasText: "Visa" });
  await visa.getByRole("textbox", { name: "Currency" }).fill("SEK");
  await visa.getByRole("textbox", { name: "Per payment" }).fill("100");
  await visa.getByRole("textbox", { name: "Per month" }).fill("300");
  await visa.getByRole("button", { name: "Save limits" }).click();
  await visa.locator("summary").getByText("Card ending 4242, pays up to 100.00 SEK at a time, 300.00 SEK a month, on no site yet").waitFor(wait);

  const shop = lines.filter({ hasText: "Example Shop" });
  await shop.locator("summary").click();
  await shop.getByRole("button", { name: "Mail me a code" }).click();
  await shop.getByText("Duva mailed a sign-in code to grace@example.org. It works for three minutes.").waitFor(wait);
  await shop.getByRole("textbox", { name: "Sign-in code" }).fill(duva.signInCode("grace@example.org")!);
  await shop.getByRole("button", { name: "Show" }).click();
  await shop.getByText("correct horse battery staple").waitFor(wait);
  await shop.getByRole("button", { name: "Hide" }).click();
  await expect.poll(() => shop.getByText("correct horse battery staple").count(), wait).toBe(0);
  await shop.locator(".secret-uses").getByText("You revealed it").waitFor(wait);

  await shop.getByRole("textbox", { name: "Name", exact: true }).fill("Example Shop login");
  await shop.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("status").filter({ hasText: "Renamed to Example Shop login." }).waitFor(wait);

  await visa.locator("summary").click();
  await visa.getByRole("button", { name: "Delete" }).click();
  await visa.getByRole("group", { name: "Delete" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("status").filter({ hasText: "Deleted Visa." }).waitFor(wait);
  expect((await grace.GET("/secrets")).data!.secrets.map(({ name }) => name)).toEqual(["Example Shop login"]);
});

test("a human names the sites a card pays on as they add it, then adds and removes them on the card's line", budget, async () => {
  const { page, signIn, grace } = await withMailbox();
  await signIn("grace@example.org");
  await openSecrets(page);
  const add = page.getByRole("form", { name: "Add a secret" });

  await add.getByRole("radio", { name: "Card" }).check();
  await add.getByRole("textbox", { name: "Name", exact: true }).fill("Visa");
  await add.getByRole("textbox", { name: "Card number" }).fill("4242 4242 4242 4242");
  await add.getByRole("textbox", { name: "Expiry" }).fill("12/29");
  await add.getByRole("textbox", { name: "Security code" }).fill("123");
  await add.getByRole("textbox", { name: "Currency" }).fill("SEK");
  await add.getByRole("textbox", { name: "Per payment" }).fill("100");
  await add.getByRole("textbox", { name: "Per month" }).fill("300");
  await add.getByRole("textbox", { name: "Sites it pays on" }).fill("https://www.sj.se/biljetter, netflix.com");
  await add.getByRole("button", { name: "Add a secret" }).click();
  await page.getByRole("status").filter({ hasText: "Added Visa." }).waitFor(wait);

  const visa = page.locator(".secret-line").filter({ hasText: "Visa" });
  await visa.locator("summary").getByText("Card ending 4242, pays up to 100.00 SEK at a time, 300.00 SEK a month, on www.sj.se and netflix.com").waitFor(wait);
  const sites = visa.getByRole("list", { name: "Sites" });
  await expect.poll(() => sites.getByRole("listitem").allInnerTexts(), wait).toEqual(["www.sj.se\nRemove", "netflix.com\nRemove"]);

  await visa.getByRole("textbox", { name: "Site", exact: true }).fill("co.uk");
  await visa.getByRole("button", { name: "Add site" }).click();
  await visa.getByRole("alert").getByText(`"co.uk" isn't a site a card can pay on.`, { exact: false }).waitFor(wait);
  await visa.getByRole("textbox", { name: "Site", exact: true }).fill("SJ.se");
  await visa.getByRole("button", { name: "Add site" }).click();
  await page.getByRole("status").filter({ hasText: "Added sj.se." }).waitFor(wait);
  await visa.getByRole("button", { name: "Remove www.sj.se" }).click();
  await page.getByRole("status").filter({ hasText: "Removed www.sj.se." }).waitFor(wait);
  await expect.poll(() => visa.getByRole("list", { name: "Sites" }).getByRole("listitem").allInnerTexts(), wait).toEqual(["netflix.com\nRemove", "sj.se\nRemove"]);
  expect((await grace.GET("/secrets")).data!.secrets[0]!.sites).toEqual(["netflix.com", "sj.se"]);

  await visa.getByRole("button", { name: "Remove netflix.com" }).click();
  await visa.getByRole("button", { name: "Remove sj.se" }).click();
  await visa.getByText("None yet, so each payment waits for you.").waitFor(wait);
});

test("a payment above a card's limits waits in Approvals with its amount, site and card, and Coo's bubble says so; approved, Coo goes back to the page, its bubble says it couldn't pay once the page expired, opening into what going back cost, and Approvals says the approval lapsed 24 hours on", budget, async () => {
  const model = scripted({
    coo: [() => [use("browse", { url: "https://shop.example.net/checkout", goal: "Buy the coffee beans.", secrets: ["Visa"] })], () => [{ text: "The payment waits for your approval." }]],
    page: [
      () => [use("fillSecret", { element: 1, secret: "Visa", part: "number", amount: "149.00", currency: "SEK", for: "Coffee beans, 1 kg" })],
      () => [use("finish", { done: false, said: "The checkout had expired" })],
    ],
  });
  const { page, signIn, duva, grace, mailbox, hide, show } = await withMailbox({ model, hiddenPollInterval: 600_000 });
  let expired = false;
  await duva.webServer("shop.example.net", {
    answer: () =>
      new Response(
        expired
          ? "<!doctype html><title>Shop</title><p>This checkout has expired.</p>"
          : `<!doctype html><title>Shop</title><p>Total: 149.00 SEK</p><form method="post" action="/pay"><label for="n">Card number</label><input id="n" name="n" autocomplete="cc-number"><button>Pay now</button></form>`,
        { headers: { "content-type": "text/html" } },
      ),
  });
  await grace.POST("/secrets", { body: { kind: "card", name: "Visa", number: "4242424242424242", expiry: "12/29", cvc: "123", currency: "SEK", perPayment: "100.00", perMonth: "300.00", sites: ["example.net"] } });
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /^Ask Coo/ }).first().waitFor(wait);

  await duva.askAgent("grace@example.org", { mailbox: mailbox.id, words: "Buy the coffee beans in my cart." });

  await page.locator(".coo-says").getByRole("link", { name: "A payment of mine waits for your approval." }).click();
  const row = page.locator(".queue-row").filter({ hasText: "149.00 SEK on example.net" });
  await row.waitFor(wait);
  expect(await row.innerText()).toContain("With Visa, for Coffee beans, 1 kg");
  const galley = page.locator(".galley-payment:not([hidden])");
  await galley.getByRole("heading", { level: 2 }).filter({ hasText: "149.00 SEK on example.net" }).waitFor(wait);
  await galley.getByText("It's above Visa's limits, so the run stopped before paying and waits for you. Approved, Coo goes back to the page and pays it, once.").waitFor(wait);
  expired = true;
  await galley.getByRole("button", { name: "Approve" }).click();
  await galley.getByText("Approved. Coo goes back to the page and pays it, and says in its activity how it went.").waitFor(wait);

  await page.locator(".coo-says").getByRole("link", { name: "I couldn't pay 149.00 SEK on example.net as you approved: The checkout had expired." }).waitFor(wait);
  expect((await grace.GET("/payments")).data!.payments.map(({ state }) => state)).toEqual(["approved"]);

  // A day on, with Approvals still open. The tab is hidden while both clocks move, so no read
  // reaches Duva with a session the browser's clock hasn't renewed, and once the read that was due
  // has passed, the next is ten minutes away.
  await hide();
  await page.waitForTimeout(2_000);
  const dayOn = new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000);
  await duva.clock(dayOn);
  await page.clock.setSystemTime(dayOn);
  await show();

  await galley.getByText("Lapsed. It went unpaid for 24 hours after you approved it. Ask Coo again if you still want it.").waitFor(wait);
  expect(await row.locator(".queue-state").innerText()).toBe("Lapsed");

  // What going back cost, in Coo's activity.
  await page.getByRole("link", { name: /^Ask Coo/ }).first().click();
  await page.getByRole("link", { name: "What Coo did" }).click();
  await page.getByRole("region", { name: "Events" }).getByRole("link").filter({ hasText: "went back to pay 149.00 SEK on example.net" }).click();
  const cost = page.getByRole("main").locator(".event-fact").filter({ has: page.getByRole("term").filter({ hasText: "Cost" }) }).getByRole("definition");
  await expect.poll(() => cost.innerText(), wait).toMatch(/^[\d.]+ cents?$/);
});
