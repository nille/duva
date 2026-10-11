import { afterEach, expect, test, vi } from "vitest";
import type { Model, ModelEvent, ModelMessage } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";
import type { ReceivedRequest } from "./web.ts";

type Request = Parameters<Model>[0];

/**
 * A stand-in for Claude that takes one step of Coo's script per model call Coo's run makes, and
 * one step of the page's script per call a browsing run makes, told apart by the tools each has.
 * It records every request, and past a script's end Coo answers "Done." and a browsing run finishes.
 */
function scripted({ coo = [], page = [] }: { coo?: ((request: Request) => ModelEvent[])[]; page?: ((request: Request) => ModelEvent[])[] }) {
  const requests: Request[] = [];
  let [cooStep, pageStep] = [0, 0];
  const browsing = (request: Request) => request.tools.some(({ name }) => name === "finish");
  const model: Model = async function* (request) {
    requests.push(structuredClone(request));
    const events = browsing(request)
      ? (page[pageStep++]?.(request) ?? [use("finish", { done: false, said: "It stopped." })])
      : request.tools.length === 0
        ? [{ text: "Nothing." }]
        : (coo[cooStep++]?.(request) ?? [{ text: "Done." }]);
    for (const event of events) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  return { model, requests, coo: () => requests.filter((request) => !browsing(request) && request.tools.length > 0), pages: () => requests.filter(browsing) };
}

const use = (name: string, input: Record<string, unknown> = {}): ModelEvent => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

/** What the tool the model used last answered. */
const lastResult = (messages: ModelMessage[]) => {
  for (const block of messages.at(-1)!.content.toReversed()) if ("toolResult" in block) return block.toolResult.content[0]!.text;
  throw new Error("No tool answered.");
};

const html = (body: string) => new Response(`<!doctype html><html><head><title>Example Shop</title></head><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });
const form = (action: string, fields: string, button: string) => `<form method="post" action="${action}">${fields}<button>${button}</button></form>`;
const field = (id: string, label: string, attributes = "") => `<label for="${id}">${label}</label><input id="${id}" name="${id}" ${attributes}>`;

// RFC 6238's test seed, the ASCII 12345678901234567890 in base32, whose eight-digit SHA-1 code at
// 2000000000 seconds past 1970, 2033-05-18T03:33:20Z, is 69279037, as its test vectors give.
const seed = "otpauth://totp/Example%20Shop:linus?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&issuer=Example%20Shop";
const seedsCode = "69279037";
const atTheCode = new Date(1_999_999_990_000);

const login = { kind: "login" as const, name: "Example Shop", username: "linus.t", password: "correct horse battery staple", totpSeed: seed };
const membership = { kind: "other" as const, name: "Membership", value: "SJ-4471-2209" };
const visa = { kind: "card" as const, name: "Visa", number: "4242 4242 4242 4242", expiry: "12/29", cvc: "123", cardholder: "Linus Torvalds" };
const limits = { currency: "SEK", perPayment: "100.00", perMonth: "150.00" };
/** Every value of the secrets above, none of which may reach a model, a turn, a change or a log. */
const values = [login.username, login.password, "GEZDGNBVGY3TQOJQ", seedsCode, membership.value, "4242424242424242", "4242 4242 4242 4242", "12/29", "Linus Torvalds"];

/** What was logged, as CloudWatch Logs keeps the Lambdas' and the runtime's lines. */
const logged: string[] = [];
for (const method of ["log", "info", "warn", "error"] as const) {
  const original = console[method].bind(console);
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    original(...args);
  });
}
afterEach(() => void (logged.length = 0));

/**
 * A deployment on example.com where Linus has the mailbox linus@example.com, and shop.example.net
 * is a shop with a login and a one-time code, a membership form that says back what it saved, and a
 * checkout that takes a card and pays on "Pay now".
 */
async function withShop(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-sonnet-5-5", mailboxAgentHarderModel: "anthropic.claude-sonnet-5-5" } });
  const agent = (await linus.GET("/mailbox-agent")).data!.agent;
  const shop = async (request: ReceivedRequest) => {
    const { pathname } = new URL(request.url);
    const fields = new URLSearchParams(request.body);
    const signedIn = String(request.headers.cookie ?? "").includes("session=s3cret");
    if (pathname === "/login" && request.method === "GET") return html(`<h1>Sign in</h1>${form("/login", field("user", "Username") + field("password", "Password", 'type="password"'), "Sign in")}`);
    if (pathname === "/login") return fields.get("user") === login.username && fields.get("password") === login.password ? html(form("/verify", field("code", "Code from your app", 'autocomplete="one-time-code"'), "Verify")) : html("<p>Wrong password.</p>");
    if (pathname === "/verify") return fields.get("code") === seedsCode ? new Response(null, { status: 303, headers: { location: "/account", "set-cookie": "session=s3cret; Path=/" } }) : html("<p>Wrong code.</p>");
    if (pathname === "/account") return signedIn ? html(`<h1>Your account</h1>${form("/membership", field("member", "Membership number"), "Save")}`) : html("<p>Sign in first.</p>");
    if (pathname === "/membership") return html(`<p>Saved. Your membership number is ${fields.get("member")}.</p>`);
    if (pathname === "/checkout") return html(`<p>Coffee beans, 1 kg. Total: 49.90 SEK</p>${form("/pay", field("number", "Card number", 'autocomplete="cc-number"') + field("exp", "Expiry", 'autocomplete="cc-exp"') + field("cvc", "CVC", 'autocomplete="cc-csc"'), "Pay now")}`);
    if (pathname === "/pay") return html(`<p>Paid with the card ${fields.get("number")?.replace(/(\d{4})(?=\d)/g, "$1 ")}. Thank you!</p>`);
    return html("<p>Not found.</p>");
  };
  const requests = await duva.webServer("shop.example.net", { answer: shop });
  const ask = (words: string) => duva.askAgent("linus@example.org", { mailbox: mailbox!.id, words });
  const keep = async (secret: Record<string, unknown>) => (await linus.POST("/secrets", { body: secret as never })).data!;
  const events = async (kinds?: ("payments" | "conversations")[]) => (await linus.GET("/agents/{agent}/events", { params: { path: { agent: agent.id }, query: kinds === undefined ? {} : { kinds } } })).data!.events;
  return { duva, ada, linus, params, agent, ask, keep, events, requests, linusId: linusActor!.id };
}

const posts = (requests: ReceivedRequest[]) => requests.filter(({ method }) => method === "POST").map(({ url, body }) => `${new URL(url).pathname} ${body}`);

/** Everything Duva kept or said of the runs: the turns, the mailbox's changes, Coo's activity and each event's detail. */
async function everythingKept({ duva, params, agent }: Awaited<ReturnType<typeof withShop>>) {
  // Signed in now, as the clock may have moved past an earlier session.
  const linus = duva.signIn("linus@example.org");
  const turns = (await linus.GET("/mailbox-agent")).data;
  const changes = (await linus.GET("/mailboxes/{mailbox}/changes", { params })).data;
  const events = (await linus.GET("/agents/{agent}/events", { params: { path: { agent: agent.id } } })).data!.events;
  const details = await Promise.all(events.map(async ({ id }) => (await linus.GET("/agents/{agent}/events/{event}", { params: { path: { agent: agent.id, event: id } } })).data));
  return JSON.stringify({ turns, changes, events, details });
}

test("a human keeps logins, cards and other values, and listing them shows names, kinds and the last four characters only, never to admins, agents or other humans", async () => {
  const { duva, ada, linus, keep } = await withShop();
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Helper" } });

  const kept = [await keep(login), await keep(visa), await keep(membership)];
  const { data: listed } = await linus.GET("/secrets");
  const { data: read } = await linus.GET("/secrets/{secret}", { params: { path: { secret: kept[1]!.id } } });

  expect(listed!.secrets.map(({ name, kind, lastFour, oneTimeCodes, limits: limited }) => ({ name, kind, lastFour, oneTimeCodes, limits: limited }))).toEqual([
    { name: "Example Shop", kind: "login", lastFour: "us.t", oneTimeCodes: true, limits: undefined },
    { name: "Membership", kind: "other", lastFour: "2209", oneTimeCodes: undefined, limits: undefined },
    { name: "Visa", kind: "card", lastFour: "4242", oneTimeCodes: undefined, limits: undefined },
  ]);
  expect(read).toMatchObject({ name: "Visa", uses: [] });
  for (const value of ["correct horse", "SJ-4471", "12/29", "GEZDGNBV"]) expect(JSON.stringify([listed, read])).not.toContain(value);
  // An admin and another human list only their own, and Linus's are none of theirs.
  for (const other of [ada, grace]) {
    expect((await other.GET("/secrets")).data!.secrets).toEqual([]);
    expect((await other.GET("/secrets/{secret}", { params: { path: { secret: kept[0]!.id } } })).response.status).toBe(404);
    expect((await other.POST("/secrets/{secret}/reveal", { params: { path: { secret: kept[0]!.id } }, body: {} })).response.status).toBe(404);
    expect((await other.POST("/secrets/{secret}/use", { params: { path: { secret: kept[0]!.id } }, body: { part: "password", site: "example.net" } })).response.status).toBe(403);
  }
  const agent = duva.withKey(created!.key);
  expect((await agent.GET("/secrets")).response.status).toBe(403);
  expect((await agent.GET("/secrets/{secret}", { params: { path: { secret: kept[0]!.id } } })).response.status).toBe(403);
  expect((await agent.POST("/secrets/{secret}/use", { params: { path: { secret: kept[0]!.id } }, body: { part: "password", site: "example.net" } })).response.status).toBe(403);
});

test("a secret is renamed, replaced in part, given a card's limits and deleted, each name used once, and what doesn't do is refused with what to give", async () => {
  const { linus, keep } = await withShop();
  const card = await keep(visa);
  await keep(membership);
  const path = { path: { secret: card.id } };

  const renamed = await linus.PATCH("/secrets/{secret}", { params: path, body: { name: "Everyday Visa" } });
  const taken = await linus.PATCH("/secrets/{secret}", { params: path, body: { name: "membership" } });
  const replaced = await linus.PATCH("/secrets/{secret}", { params: path, body: { number: "5555 5555 5555 4444" } });
  const limited = await linus.PATCH("/secrets/{secret}", { params: path, body: limits });
  const halfLimited = await linus.PATCH("/secrets/{secret}", { params: path, body: { perPayment: "10.00" } });
  const badNumber = await linus.POST("/secrets", { body: { ...visa, name: "Typo", number: "4242 4242 4242 4241" } });
  const loginNumber = await linus.POST("/secrets", { body: { kind: "login", name: "Shop", username: "linus", password: "x", number: "4242424242424242" } });
  const badSeed = await linus.POST("/secrets", { body: { ...login, name: "Other shop", totpSeed: "not a seed" } });
  const deleted = await linus.DELETE("/secrets/{secret}", { params: path });

  expect(renamed.data).toMatchObject({ name: "Everyday Visa", lastFour: "4242", changedAt: expect.any(String) });
  expect(taken.response.status).toBe(409);
  expect((taken.error as { message: string }).message).toBe("You have a secret called membership already. Give this one another name.");
  expect(replaced.data).toMatchObject({ name: "Everyday Visa", lastFour: "4444" });
  expect(limited.data!.limits).toEqual({ currency: "SEK", perPayment: "100.00", perMonth: "150.00", spentThisMonth: "0.00" });
  expect((halfLimited.error as { message: string }).message).toBe("Give currency, perPayment and perMonth together, as SEK, 500.00 and 2000.00, or null for each to clear the limits.");
  expect((badNumber.error as { message: string }).message).toBe("Give number as the card's number, 12 to 19 digits.");
  expect((loginNumber.error as { message: string }).message).toBe("A login has no number. Give username, password, totpSeed.");
  expect((badSeed.error as { message: string }).message).toBe("Give totpSeed as the base32 key or the otpauth:// URI the site's setup shows.");
  expect(deleted.data).toMatchObject({ name: "Everyday Visa" });
  expect((await linus.GET("/secrets")).data!.secrets.map(({ name }) => name)).toEqual(["Membership"]);
  expect((await linus.POST("/secrets", { body: { ...visa, name: "Everyday Visa" } })).response.status).toBe(201);
});

test("revealing a value needs the sign-in code Duva just mailed its human, once, and each reveal is in the secret's history", async () => {
  const { duva, linus, keep } = await withShop();
  const kept = await keep(login);
  const path = { path: { secret: kept.id } };

  const withoutAsking = await linus.POST("/secrets/{secret}/reveal", { params: path, body: { code: "123456" } });
  const asked = await linus.POST("/secrets/{secret}/reveal", { params: path, body: {} });
  const code = duva.signInCode("linus@example.org")!;
  const wrong = await linus.POST("/secrets/{secret}/reveal", { params: path, body: { code: code === "00000000" ? "11111111" : "00000000" } });
  const wrongUsedItUp = await linus.POST("/secrets/{secret}/reveal", { params: path, body: { code } });
  await linus.POST("/secrets/{secret}/reveal", { params: path, body: {} });
  const revealed = await linus.POST("/secrets/{secret}/reveal", { params: path, body: { code: duva.signInCode("linus@example.org")! } });

  expect(withoutAsking.response.status).toBe(409);
  expect(asked.response.status).toBe(202);
  expect(asked.data).toEqual({ sentTo: "linus@example.org" });
  expect(code).toMatch(/^[0-9]{8}$/);
  expect(wrong.response.status).toBe(403);
  expect((wrong.error as { message: string }).message).toBe("That isn't the code Duva mailed you, or it expired. Ask for a new one.");
  expect(wrongUsedItUp.response.status).toBe(409);
  expect(revealed.data).toEqual({ id: kept.id, name: "Example Shop", kind: "login", username: "linus.t", password: "correct horse battery staple", totpSeed: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
  expect((await linus.GET("/secrets/{secret}", { params: path })).data!.uses).toEqual([{ at: expect.any(String), kind: "revealed" }]);
});

test("Coo logs in with a stored login and its one-time code, and fills a stored value, which Duva types into the page while no value reaches a model, a tool's result, the turn, a change or a log", async () => {
  const { model, coo, pages, requests: modelRequests } = scripted({
    coo: [
      () => [use("browse", { url: "https://shop.example.net/login", goal: "Log in and save my membership number.", secrets: ["Example Shop", "Membership"] })],
      () => [{ text: "I logged in to Example Shop and saved your membership number." }],
    ],
    page: [
      () => [use("fillSecret", { element: 1, secret: "Example Shop", part: "username" })],
      () => [use("fillSecret", { element: 2, secret: "Example Shop", part: "password" })],
      () => [use("submit", { element: 2 })],
      () => [use("fillSecret", { element: 1, secret: "Example Shop", part: "code" })],
      () => [use("submit", { element: 1 })],
      () => [use("fillSecret", { element: 1, secret: "Membership", part: "value" })],
      () => [use("submit", { element: 1 })],
      () => [use("finish", { done: true, said: "It logged in and saved the membership number." })],
    ],
  });
  const shop = await withShop({ model });
  const { duva, ask, keep, requests } = shop;
  const [kept] = [await keep(login), await keep(membership), await keep({ ...visa, ...limits })];
  await duva.clock(atTheCode);
  const linus = duva.signIn("linus@example.org");

  const { events } = await ask("Log in to Example Shop and save my membership number there.");

  expect(posts(requests)).toEqual([`/login user=linus.t&password=correct+horse+battery+staple`, `/verify code=${seedsCode}`, `/membership member=SJ-4471-2209`]);
  // Coo knows its human's secrets by name and kind, and names those the run may use.
  expect(coo()[0]!.system).toContain(`linus@example.org keeps secrets that browse can type into a page without you or it ever seeing them: "Example Shop" (login), "Membership" (other), "Visa" (card).`);
  expect(pages()[0]!.tools.map(({ name }) => name)).toContain("fillSecret");
  expect(pages()[0]!.system).toContain(`"Example Shop", a login, with username and password, and code for its one-time code; "Membership", a value, with value`);
  expect(pages()[0]!.system).not.toContain("Visa");
  // Each page after shows a typed value as its name, even where the page says it back.
  expect(lastResult(pages()[2]!.messages)).toContain(`[2] field (password) "Password", holding "[Example Shop password]"`);
  expect(lastResult(pages()[7]!.messages)).toContain("Your membership number is [Membership value].");
  const kept_ = await everythingKept(shop);
  for (const value of values) {
    expect(JSON.stringify(modelRequests)).not.toContain(value);
    expect(JSON.stringify(events)).not.toContain(value);
    expect(kept_).not.toContain(value);
    expect(logged.join("\n")).not.toContain(value);
  }
  const run = { turn: (await linus.GET("/mailbox-agent")).data!.turns.find(({ from }) => from === "human")!.id };
  expect((await linus.GET("/secrets/{secret}", { params: { path: { secret: kept.id } } })).data!.uses).toEqual([
    { at: expect.any(String), kind: "filled", site: "example.net", part: "code", run },
    { at: expect.any(String), kind: "filled", site: "example.net", part: "password", run },
    { at: expect.any(String), kind: "filled", site: "example.net", part: "username", run },
  ]);
});

test("a browsing run fills only the secrets Coo named, and never types a password or card details itself", async () => {
  const { model, pages } = scripted({
    coo: [() => [use("browse", { url: "https://shop.example.net/login", goal: "Log in.", values: ["4242424242424242"], secrets: ["Example Shop"] })]],
    page: [
      () => [use("fillSecret", { element: 1, secret: "Membership", part: "value" })],
      () => [use("type", { element: 2, value: "correct horse battery staple" })],
    ],
  });
  const { ask, keep, requests } = await withShop({ model });
  await keep(login);
  await keep(membership);

  await ask("Log in to Example Shop.");

  expect(pages().slice(1).map((request) => lastResult(request.messages))).toEqual(['You can fill only the secrets you were given: "Example Shop".', "A password is typed only from a login secret, with fillSecret."]);
  expect(posts(requests)).toEqual([]);
});

/** Coo's steps: browse the checkout with the card, then answer. */
const buysTheBeans = (secrets = ["Visa"]) => [() => [use("browse", { url: "https://shop.example.net/checkout", goal: "Buy the coffee beans in the cart.", secrets })], () => [{ text: "I bought the coffee beans." }]];
/** The browsing run's steps: the card's number, expiry and code for the amount, then pay. */
const paysWithTheCard = (amount = "49.90") => [
  () => [use("fillSecret", { element: 1, secret: "Visa", part: "number", amount, currency: "SEK", for: "Coffee beans, 1 kg" })],
  () => [use("fillSecret", { element: 2, secret: "Visa", part: "expiry", amount, currency: "SEK", for: "Coffee beans, 1 kg" })],
  () => [use("fillSecret", { element: 3, secret: "Visa", part: "cvc", amount, currency: "SEK", for: "Coffee beans, 1 kg" })],
  () => [use("click", { element: 4 })],
  () => [use("finish", { done: true, said: "It paid 49.90 SEK for the coffee beans." })],
];

test("a card pays within its limits: Duva types it into the checkout, the month counts it, and the payment shows in Coo's activity with its amount and site, and in its history", async () => {
  const { model, pages, requests: modelRequests } = scripted({ coo: buysTheBeans(), page: paysWithTheCard() });
  const shop = await withShop({ model });
  const { linus, ask, keep, events, requests } = shop;
  const card = await keep({ ...visa, ...limits });

  await ask("Buy the coffee beans in my cart at Example Shop.");

  expect(posts(requests)).toEqual(["/pay number=4242424242424242&exp=12%2F29&cvc=123"]);
  expect(lastResult(pages()[4]!.messages)).toContain("Paid with the card [Visa number]. Thank you!");
  const { data: payments } = await linus.GET("/payments");
  expect(payments!.payments).toEqual([expect.objectContaining({ state: "paid", card: card.id, cardName: "Visa", site: "example.net", amount: "49.90", currency: "SEK", for: "Coffee beans, 1 kg" })]);
  expect((await events(["payments"])).map(({ type, summary }) => ({ type, summary }))).toEqual([{ type: "paymentMade", summary: "Coo paid 49.90 SEK on example.net with Visa, for Coffee beans, 1 kg." }]);
  const { data: read } = await linus.GET("/secrets/{secret}", { params: { path: { secret: card.id } } });
  expect(read!.limits!.spentThisMonth).toBe("49.90");
  expect(read!.uses.map(({ kind, part, amount }) => ({ kind, part, amount }))).toEqual([
    { kind: "filled", part: "cvc", amount: undefined },
    { kind: "filled", part: "expiry", amount: undefined },
    { kind: "paid", part: "number", amount: "49.90" },
  ]);
  const kept = await everythingKept(shop);
  for (const value of ["4242424242424242", "12/29", "123\"", "Linus Torvalds"]) {
    expect(JSON.stringify(modelRequests)).not.toContain(value);
    expect(kept).not.toContain(value);
    expect(logged.join("\n")).not.toContain(value);
  }
});

test("a payment above the card's limits stops the run and waits in Approvals with its site, amount, card and what it is for, and once approved, a fresh run pays it", async () => {
  const { model, coo } = scripted({ coo: [...buysTheBeans(), ...buysTheBeans()], page: [...paysWithTheCard("149.00").slice(0, 1), ...paysWithTheCard("149.00")] });
  const { linus, ask, keep, events, requests } = await withShop({ model });
  await keep({ ...visa, ...limits });

  await ask("Buy the coffee beans in my cart at Example Shop.");
  const { data: waiting } = await linus.GET("/payments");
  const approved = await linus.POST("/payments/{payment}/approve", { params: { path: { payment: waiting!.payments[0]!.id } } });
  const again = await linus.POST("/payments/{payment}/decline", { params: { path: { payment: waiting!.payments[0]!.id } } });
  const before = posts(requests);
  await ask("I approved it. Buy them now.");

  expect(lastResult(coo()[1]!.messages)).toBe("Not done: The payment of 149.00 SEK on example.net is above Visa's limits, so it waits for linus@example.org's approval in Approvals.");
  expect(before).toEqual([]);
  expect(waiting!.payments).toEqual([expect.objectContaining({ state: "waiting", cardName: "Visa", site: "example.net", amount: "149.00", currency: "SEK", for: "Coffee beans, 1 kg" })]);
  expect(approved.data).toMatchObject({ state: "approved", decidedAt: expect.any(String) });
  expect(again.response.status).toBe(409);
  expect(posts(requests)).toEqual(["/pay number=4242424242424242&exp=12%2F29&cvc=123"]);
  expect((await linus.GET("/payments")).data!.payments).toEqual([expect.objectContaining({ state: "paid", amount: "149.00", paidAt: expect.any(String) })]);
  const activity = await events(["payments"]);
  expect(activity.map(({ summary, needsYou }) => ({ summary, needsYou }))).toEqual([
    { summary: "Coo paid 149.00 SEK on example.net with Visa, as approved, for Coffee beans, 1 kg.", needsYou: false },
    { summary: "You approved Coo's payment of 149.00 SEK on example.net.", needsYou: false },
    { summary: "Coo asked for approval to pay 149.00 SEK on example.net with Visa, for Coffee beans, 1 kg, above the card's limits.", needsYou: false },
  ]);
});

test("a payment that would take the card past its month waits too, and while it waits, it needs its human in Coo's activity", async () => {
  const { model } = scripted({ coo: [...buysTheBeans(), ...buysTheBeans(), ...buysTheBeans()], page: [...paysWithTheCard("60.00"), ...paysWithTheCard("60.00"), ...paysWithTheCard("60.00").slice(0, 1)] });
  const { linus, ask, keep, events, requests } = await withShop({ model });
  await keep({ ...visa, ...limits });

  for (const words of ["Buy the beans.", "Buy them again.", "And once more."]) await ask(words);

  expect(posts(requests)).toHaveLength(2);
  expect((await linus.GET("/payments")).data!.payments.map(({ state, amount }) => `${state} ${amount}`)).toEqual(["waiting 60.00", "paid 60.00", "paid 60.00"]);
  expect((await events(["payments"]))[0]).toMatchObject({ type: "paymentAsked", needsYou: true });
});

test("a card with no limits doesn't pay, nor does any card once an admin turns paying off for the organization, and only admins turn it off", async () => {
  const { model, pages } = scripted({ coo: [...buysTheBeans(), ...buysTheBeans()], page: [...paysWithTheCard().slice(0, 1), () => [use("finish", { done: false, said: "The card doesn't pay." })], ...paysWithTheCard().slice(0, 1)] });
  const { ada, linus, ask, keep, requests } = await withShop({ model });
  const card = await keep(visa);

  await ask("Buy the beans.");
  await linus.PATCH("/secrets/{secret}", { params: { path: { secret: card.id } }, body: limits });
  const byLinus = await linus.PATCH("/organization/settings", { body: { mailboxAgentPayments: false } });
  const before = (await ada.GET("/organization/settings")).data!.mailboxAgentPayments;
  await ada.PATCH("/organization/settings", { body: { mailboxAgentPayments: false } });
  await ask("Buy the beans.");

  expect(lastResult(pages()[1]!.messages)).toBe("Visa has no limits set, so it doesn't pay. Its human sets them in Settings, under Secrets.");
  expect(lastResult(pages()[3]!.messages)).toBe("An admin turned paying off for the organization, so no card pays.");
  expect([before, byLinus.response.status]).toEqual([true, 403]);
  expect(posts(requests)).toEqual([]);
  expect((await linus.GET("/payments")).data!.payments).toEqual([]);
});

test("a run of the same turn again, as Think harder, never pays twice, and a run given no card stops at the checkout as before", async () => {
  const { model, coo } = scripted({
    coo: [...buysTheBeans(), ...buysTheBeans(), ...buysTheBeans([])],
    page: [...paysWithTheCard(), ...paysWithTheCard().slice(0, 1)],
  });
  const { duva, ask, keep, requests } = await withShop({ model });
  await keep({ ...visa, ...limits });

  await ask("Buy the beans.");
  await duva.askAgent("linus@example.org", { harder: true });
  await ask("Look at my cart, but don't buy anything.");

  expect(posts(requests)).toHaveLength(1);
  expect(lastResult(coo()[3]!.messages)).toMatch(/^Not done: /);
  expect(JSON.stringify(coo()[3]!.messages)).not.toContain("4242");
  expect(lastResult(coo()[5]!.messages)).toBe("Not done: It stopped at a payment step on example.net, since it was given no card to pay with.");
});

test("removing a human erases their secrets and their Coo's payments with them", async () => {
  const { model } = scripted({ coo: buysTheBeans(), page: paysWithTheCard() });
  const { duva, ada, linus, ask, keep, params, linusId } = await withShop({ model });
  const card = await keep({ ...visa, ...limits });
  await ask("Buy the beans.");
  const before = [(await linus.GET("/secrets")).data!.secrets.length, (await linus.GET("/payments")).data!.payments.length];

  await ada.POST("/humans/{human}/remove", { params: { path: { human: linusId } }, body: { delete: [params.path.mailbox] } });
  await ada.POST("/humans", { body: { email: "linus@example.org" } });
  const again = duva.signIn("linus@example.org");

  expect(before).toEqual([1, 1]);
  expect((await again.GET("/secrets")).data!.secrets).toEqual([]);
  expect((await again.GET("/payments")).data!.payments).toEqual([]);
  expect((await again.GET("/secrets/{secret}", { params: { path: { secret: card.id } } })).response.status).toBe(404);
});

test("a run whose card paid once on a site needs the card again to pay a second time, so a site that keeps the card can't be paid outside its limits", async () => {
  const { model, pages } = scripted({
    coo: buysTheBeans(),
    page: [...paysWithTheCard().slice(0, 4), () => [use("open", { url: "https://shop.example.net/checkout" })], () => [use("click", { element: 4 })]],
  });
  const { ask, keep, requests } = await withShop({ model });
  await keep({ ...visa, ...limits });

  await ask("Buy the coffee beans in my cart at Example Shop.");

  expect(posts(requests)).toHaveLength(1);
  expect(pages()).toHaveLength(6);
  expect(lastResult(pages()[5]!.messages)).not.toContain("Paid with");
});
