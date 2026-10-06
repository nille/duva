import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Ada to Grace, copying Iris, that starts its own thread. */
const note = (subject: string, text = "Hej Grace.") =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    "Cc: Iris <iris@example.net>",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");

/** The web app for a deployment where the human Grace has a personal mailbox at grace@example.com. */
async function withPersonalMailbox(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  const receive = async (raw: string) => {
    await app.duva.receive(raw, { to: ["grace@example.com"] });
  };
  return { ...app, receive };
}

test("a human writes a new message and sends it at once, and Sent lists its thread", budget, async () => {
  const { page, signIn } = await withPersonalMailbox();
  await signIn("grace@example.org");

  await page.getByRole("button", { name: "Write" }).click();
  await page.getByLabel("To", { exact: true }).fill("ada@example.org");
  await page.getByRole("button", { name: "Add Cc or Bcc" }).click();
  await page.getByLabel("Bcc", { exact: true }).fill("iris@example.net");
  await page.getByLabel("Subject", { exact: true }).fill("Lunch på fredag");
  await page.getByLabel("Message", { exact: true }).fill("Ska vi äta lunch på fredag?");
  await page.getByRole("button", { name: "Send" }).click();

  const slip = page.getByRole("status").filter({ hasText: "Sent to ada@example.org and iris@example.net." });
  await expect.poll(() => slip.count(), wait).toBe(1);
  expect(await slip.innerText()).toContain("Lunch på fredag");
  expect(await page.getByLabel("Message", { exact: true }).count()).toBe(0);

  await page.getByRole("link", { name: "Sent", exact: true }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Sent");
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").allInnerTexts(), wait).toEqual([expect.stringContaining("Lunch på fredag")]);
});

test("a human replies at the thread's foot, under the message, and the sent reply joins the thread", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Möte", "Kan vi ses på måndag?"));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Möte/ }).click();

  await page.getByRole("button", { name: "Reply", exact: true }).click();

  const reply = page.getByRole("form", { name: "Reply" });
  await expect.poll(() => reply.getByLabel("To", { exact: true }).inputValue(), wait).toBe("ada@example.org");
  expect(await reply.getByLabel("Subject", { exact: true }).inputValue()).toBe("Re: Möte");
  // The thread is still there to read, above the reply, and the cursor is where the reply is written.
  expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Möte");
  const message = page.getByRole("article");
  expect(await message.innerText()).toContain("Kan vi ses på måndag?");
  expect((await message.boundingBox())!.y).toBeLessThan((await reply.boundingBox())!.y);
  expect(await reply.getByLabel("Message", { exact: true }).evaluate((text) => text === document.activeElement)).toBe(true);
  await page.keyboard.type("Måndag passar.");
  await reply.getByRole("button", { name: "Send" }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(2);
  expect(await letters.nth(1).innerText()).toContain("You sent this");
  expect(await letters.nth(1).innerText()).toContain("Måndag passar.");
  await expect.poll(() => letters.nth(1).evaluate((letter) => letter === document.activeElement), wait).toBe(true);
  expect(await page.getByRole("form", { name: "Reply" }).count()).toBe(0);
  expect(await page.getByRole("button", { name: "Reply", exact: true }).count()).toBe(1);
});

test("a reply deleted at the thread's foot gives the replies back", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Möte"));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Möte/ }).click();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect.poll(() => page.getByRole("form", { name: "Reply" }).count(), wait).toBe(1);

  await page.getByRole("button", { name: "Delete draft" }).click();

  await expect.poll(() => page.getByRole("form", { name: "Reply" }).count(), wait).toBe(0);
  expect(await page.getByRole("button", { name: "Reply", exact: true }).evaluate((button) => button === document.activeElement)).toBe(true);
  expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Möte");
});

test("a reply finished from Drafts returns to its thread once it is sent", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Möte"));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Möte/ }).click();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("form", { name: "Reply" }).getByLabel("Message", { exact: true }).fill("Jag återkommer.");
  await expect.poll(() => page.getByText(/^Saved/).count(), wait).toBe(1);

  await page.getByRole("navigation").getByRole("link", { name: "Drafts" }).click();
  await page.getByRole("list", { name: "Drafts" }).getByRole("link").first().click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Reply");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Möte");
  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);
  expect(await page.getByRole("article").nth(1).innerText()).toContain("Jag återkommer.");
});

test("a send that takes a while shows as sent once it goes out, also with no news from the mailbox", { timeout: 90_000 }, async () => {
  // While the tab is hidden the change feeds are read only every ten minutes, so only the composer's own reads can learn the send went.
  const { page, signIn, duva, hide } = await withPersonalMailbox({ sendsHeld: true, hiddenPollInterval: 600_000 });
  await signIn("grace@example.org");
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByLabel("To", { exact: true }).fill("ada@example.org");
  await page.getByLabel("Subject", { exact: true }).fill("Långsamt");
  await page.getByLabel("Message", { exact: true }).fill("Det här tar tid.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sending…" }).count(), wait).toBe(1);

  // After half a minute it says the human needn't wait.
  await expect.poll(() => page.getByText("This takes longer than usual. You can leave, and Duva finishes the send.").count(), { timeout: 40_000 }).toBe(1);
  await hide();
  await duva.releaseSends();

  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sent to ada@example.org." }).count(), wait).toBe(1);
});

test("reply all fills in the sender and every other recipient", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Möte"));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Möte/ }).click();

  await page.getByRole("button", { name: "Reply all" }).click();

  const reply = page.getByRole("form", { name: "Reply" });
  await expect.poll(() => reply.getByLabel("To", { exact: true }).inputValue(), wait).toBe("ada@example.org");
  expect(await reply.getByLabel("Cc", { exact: true }).inputValue()).toBe("iris@example.net");
});

test("a draft is saved as the human writes, listed in Drafts, and can be deleted", budget, async () => {
  const { page, signIn } = await withPersonalMailbox();
  await signIn("grace@example.org");
  await page.getByRole("button", { name: "Write" }).click();

  await page.getByLabel("Subject", { exact: true }).fill("Halvfärdigt");
  await page.getByLabel("Message", { exact: true }).fill("Jag skriver klart sen.");
  await expect.poll(() => page.getByText(/^Saved/).count(), wait).toBe(1);
  await page.getByRole("navigation").getByRole("link", { name: "Drafts" }).click();

  const drafts = page.getByRole("list", { name: "Drafts" }).getByRole("listitem");
  await expect.poll(() => drafts.allInnerTexts(), wait).toEqual([expect.stringContaining("Halvfärdigt")]);
  await drafts.first().getByRole("link").click();
  await expect.poll(() => page.getByLabel("Message", { exact: true }).inputValue(), wait).toBe("Jag skriver klart sen.");
  await page.getByRole("button", { name: "Delete draft" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Drafts");
  await expect.poll(() => page.getByText("No drafts").count(), wait).toBe(1);
});

test("a send SES refuses shows its reason, and the human fixes the address and sends again", budget, async () => {
  const { page, signIn } = await withPersonalMailbox({ sandbox: true });
  await signIn("grace@example.org");
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByLabel("To", { exact: true }).fill("iris@example.net");
  await page.getByLabel("Subject", { exact: true }).fill("Hej");
  await page.getByLabel("Message", { exact: true }).fill("Hej Iris.");

  await page.getByRole("button", { name: "Send" }).click();

  const refused = page.getByRole("alert").filter({ hasText: "Not sent" });
  await expect.poll(() => refused.count(), wait).toBe(1);
  expect(await refused.innerText()).toContain("Email address is not verified");
  await page.getByLabel("To", { exact: true }).fill("ada@example.com");
  await page.getByRole("button", { name: "Send again" }).click();
  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sent" }).count(), wait).toBeGreaterThan(0);
  expect(await page.getByRole("alert").filter({ hasText: "Not sent" }).count()).toBe(0);
});

test("sending without a recipient, or to something that isn't an address, says what to fix", budget, async () => {
  const { page, signIn } = await withPersonalMailbox();
  await signIn("grace@example.org");
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByLabel("Message", { exact: true }).fill("Hej.");

  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.getByRole("alert").filter({ hasText: "Add a recipient" }).count(), wait).toBe(1);

  await page.getByLabel("To", { exact: true }).fill("ada");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.getByText("“ada” isn't an email address").count(), wait).toBeGreaterThan(0);
  expect(await page.getByLabel("To", { exact: true }).getAttribute("aria-invalid")).toBe("true");
  expect(await page.getByRole("button", { name: "Send" }).isEnabled()).toBe(true);
});

test("the composer fits a phone's screen", budget, async () => {
  const { page, signIn } = await withPersonalMailbox({ viewport: phone });
  await signIn("grace@example.org");

  await page.getByRole("button", { name: "Write" }).click();

  await expect.poll(() => page.getByLabel("Message", { exact: true }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
