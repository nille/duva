import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A message from Grace to the address, with the subject. */
const note = (to: string, subject: string) =>
  [
    "From: Grace Hopper <grace@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Wed, 07 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Hej. ${subject}.`,
  ].join("\r\n");

/**
 * A deployment where Linus sponsors the agent Hermes, which owns a mailbox at hermes@example.com
 * with mail in it and is a member of the group team@example.com, as admins could set up before
 * agents owned no mailboxes. Linus has a mailbox of his own at linus@example.com.
 */
async function withAgentsMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: human } = await linus.GET("/whoami");
  const { data: own } = await ada.POST("/mailboxes", { body: { owner: human!.id, address: "linus@example.com" } });
  const { data: created } = await linus.POST("/agents", { body: { name: "Hermes" } });
  const agent = created!.agent;
  const mailbox = await duva.agentMailbox(agent.id, "hermes@example.com");
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["linus@example.com", "hermes@example.com"] } });
  await duva.receive(note("hermes@example.com", "Till Hermes"), { to: ["hermes@example.com"] });
  return { duva, ada, linus, agent, mailbox, own: own! };
}

test("the deploy erases each mailbox an agent owns, with its mail and its search index", async () => {
  const { duva, ada, mailbox, own } = await withAgentsMailbox();
  expect(duva.stored().some((raw) => raw.includes("Till Hermes"))).toBe(true);
  expect(duva.searchObjects().some((file) => file.includes("Till Hermes"))).toBe(true);

  await duva.setUp({ admin: "ada@example.org" });

  const { data } = await ada.GET("/organization/mailboxes");
  expect(data!.mailboxes.map(({ id }) => id)).toEqual([own.id]);
  expect(duva.stored().some((raw) => raw.includes("Till Hermes"))).toBe(false);
  expect(duva.searchObjects().some((file) => file.includes("Till Hermes"))).toBe(false);
});

test("the deploy frees the addresses of agents' mailboxes, so SES refuses mail to them, and they leave their groups and catch-alls", async () => {
  const { duva, ada, mailbox } = await withAgentsMailbox();
  await ada.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } }, body: { mailbox } });

  await duva.setUp({ admin: "ada@example.org" });

  expect(duva.receiptRules().flatMap(({ Recipients = [] }) => Recipients)).not.toContain("hermes@example.com");
  expect((await duva.receive(note("hermes@example.com", "Again"), { to: ["hermes@example.com"] })).refused).toEqual(["hermes@example.com"]);
  const { data: group } = await ada.GET("/groups/{group}", { params: { path: { group: "team@example.com" } } });
  expect(group!.members).toEqual(["linus@example.com"]);
  const { data: domain } = await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } });
  expect(domain).not.toHaveProperty("catchAll");
  const { data: addresses } = await ada.GET("/addresses");
  expect(addresses!.addresses.map(({ address }) => address)).not.toContain("hermes@example.com");
});

test("the deploy records each agent mailbox's erasure in the organization's changes, under Duva", async () => {
  const { duva, ada, mailbox } = await withAgentsMailbox();
  const { data: before } = await ada.GET("/organization/changes");

  await duva.setUp({ admin: "ada@example.org" });

  const { data: after } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(after!.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "mailboxDeleted", mailbox, actor: "duva" }),
      expect.objectContaining({ type: "addressRemoved", address: "hermes@example.com", mailbox, actor: "duva" }),
    ]),
  );
});

test("an address freed by the deploy can be given to a human's mailbox, where its mail then lands", async () => {
  const { duva, ada, linus, own } = await withAgentsMailbox();
  await duva.setUp({ admin: "ada@example.org" });

  const { response } = await ada.POST("/addresses", { body: { address: "hermes@example.com", mailbox: own.id } });
  expect(response.status).toBe(201);
  const params = { path: { mailbox: own.id } };
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  expect((await duva.receive(note("hermes@example.com", "Till Linus"), { to: ["hermes@example.com"] })).refused).toEqual([]);
  const { data } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  expect(data!.threads.map(({ subject }) => subject)).toEqual(["Till Linus"]);
});

test("the agent stays after the deploy, with its sponsor, and a deploy again erases nothing more", async () => {
  const { duva, ada, linus, agent, own } = await withAgentsMailbox();
  await duva.setUp({ admin: "ada@example.org" });
  const { data: once } = await ada.GET("/organization/changes");

  await duva.setUp({ admin: "ada@example.org" });

  const { data: twice } = await ada.GET("/organization/changes");
  expect(twice!.position).toBe(once!.position);
  const { data: agents } = await linus.GET("/agents");
  expect(agents!.agents.map(({ name }) => name)).toEqual(expect.arrayContaining(["Hermes"]));
  expect(agents!.agents.find(({ id }) => id === agent.id)).not.toHaveProperty("admin");
  const { data: mailboxes } = await linus.GET("/mailboxes");
  expect(mailboxes!.mailboxes.map(({ id }) => id)).toEqual([own.id]);
});

