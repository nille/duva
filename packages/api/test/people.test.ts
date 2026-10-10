import type { components } from "@duva/openapi";
import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

/** A message from Alan to the address, with the subject, which starts its own thread. */
const note = (subject: string, to: string) =>
  [
    "From: Alan Turing <alan@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Tue, 06 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Hej. ${subject}.`,
  ].join("\r\n");

/**
 * A deployment on example.com where the admin Ada added the humans Grace and Linus. Grace has a
 * personal mailbox at grace@example.com, with a message in it, and sponsors the agent Hermes.
 */
async function withGraceAndHermes(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: adaActor } = await ada.GET("/whoami");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  const { data: created } = await grace.POST("/agents", { body: { name: "Hermes" } });
  await duva.receive(note("Till Grace", "grace@example.com"), { to: ["grace@example.com"] });
  const hermes = duva.withKey(created!.key);
  const remove = (body: components["schemas"]["HumanRemovalChoices"]) =>
    ada.POST("/humans/{human}/remove", { params: { path: { human: graceActor!.id } }, body });
  return {
    duva,
    ada,
    grace,
    linus,
    hermes,
    adaId: adaActor!.id,
    graceActor: graceActor!,
    linusId: linusActor!.id,
    agent: created!.agent,
    mailbox: mailbox!,
    remove,
  };
}

/** Whether the mail bucket keeps a raw message with the text. */
const keeps = (duva: Awaited<ReturnType<typeof startDuva>>, text: string) => duva.stored().some((raw) => raw.includes(text));

test("a dry run of removing a human lists their mailboxes and their agents, and removes nothing", async () => {
  const { duva, ada, grace, hermes, graceActor, agent, mailbox, remove } = await withGraceAndHermes();

  const { response, data } = await remove({ dryRun: true });

  expect(response.status).toBe(200);
  // The mailbox agent of her mailbox goes with her too.
  expect(data).toEqual({
    human: graceActor,
    mailboxes: [mailbox],
    agents: expect.arrayContaining([agent, expect.objectContaining({ name: "Coo", mailboxAgent: true })]),
    removed: false,
  });
  expect(data!.agents).toHaveLength(2);
  expect((await grace.GET("/whoami")).response.status).toBe(200);
  expect((await hermes.GET("/whoami")).response.status).toBe(200);
  expect((await ada.GET("/humans")).data?.humans).toContainEqual({ ...graceActor, linkedSize: 0 });
  expect(keeps(duva, "Hej. Till Grace.")).toBe(true);
});

test("a mailbox handed over becomes another personal mailbox of the human it goes to, with its address and mail", async () => {
  const { duva, linus, linusId, mailbox, remove } = await withGraceAndHermes();

  const { data } = await remove({ handTo: linusId, handOver: [mailbox.id], delete: [] });
  await duva.receive(note("Efteråt", "grace@example.com"), { to: ["grace@example.com"] });

  expect(data?.removed).toBe(true);
  const handed = { ...mailbox, owner: linusId, groups: [] };
  expect((await linus.GET("/mailboxes")).data).toEqual({ mailboxes: [handed] });
  const { data: threads } = await linus.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id } } });
  expect(threads?.threads.map(({ subject }) => subject)).toEqual(["Efteråt", "Till Grace"]);
});

test("a mailbox deleted with its human is erased everywhere Duva keeps its mail, and mail to its address is refused", async () => {
  const { duva, linus, linusId, mailbox, remove } = await withGraceAndHermes();
  const { data: kept } = await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: linusId, address: "linus@example.com" } });

  await remove({ delete: [mailbox.id] });

  expect(keeps(duva, "Hej. Till Grace.")).toBe(false);
  expect(duva.searchObjects().some((file) => file.includes("Till Grace"))).toBe(false);
  expect((await duva.receive(note("Efteråt", "grace@example.com"), { to: ["grace@example.com"] })).refused).toEqual(["grace@example.com"]);
  expect(duva.receiptRules().flatMap(({ Recipients }) => Recipients)).toEqual(["linus@example.com"]);
  expect((await linus.GET("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox.id } } })).response.status).toBe(404);
  expect((await linus.GET("/mailboxes")).data).toEqual({ mailboxes: [{ ...kept, groups: [] }] });
});

test("removing a human removes the agents they sponsor, whose keys stop working", async () => {
  const { hermes, mailbox, remove } = await withGraceAndHermes();

  await remove({ delete: [mailbox.id] });

  expect((await hermes.GET("/whoami")).response.status).toBe(401);
});

test("a removed human's sessions stop working at once, and they are no longer among the humans", async () => {
  const { ada, grace, graceActor, mailbox, remove } = await withGraceAndHermes();

  await remove({ delete: [mailbox.id] });

  expect((await grace.GET("/whoami")).response.status).toBe(401);
  expect((await ada.GET("/humans")).data?.humans).not.toContainEqual({ ...graceActor, linkedSize: 0 });
});

test("an address freed by a deleted mailbox can be given to another mailbox at once", async () => {
  const { duva, ada, linus, linusId, mailbox, remove } = await withGraceAndHermes();
  await remove({ delete: [mailbox.id] });

  const { response, data: again } = await ada.POST("/mailboxes", { body: { owner: linusId, address: "grace@example.com" } });
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: again!.id } }, body: { on: false } });
  await duva.receive(note("Ny", "grace@example.com"), { to: ["grace@example.com"] });

  expect(response.status).toBe(201);
  const { data: threads } = await linus.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: again!.id } } });
  expect(threads?.threads.map(({ subject }) => subject)).toEqual(["Ny"]);
});

test("a removal must say what happens to each of the human's mailboxes, once, and hand them to another human", async () => {
  const { duva, ada, grace, graceActor, agent, mailbox, remove } = await withGraceAndHermes();
  const { data: other } = await ada.POST("/mailboxes", { body: { owner: graceActor.id, address: "grace.hopper@example.com" } });

  const missing = await remove({ delete: [mailbox.id] });
  const twice = await remove({ delete: [mailbox.id, other!.id], handOver: [mailbox.id] });
  const notHers = await remove({ delete: [mailbox.id, other!.id, "nowhere"] });
  const noHuman = await remove({ handOver: [mailbox.id, other!.id] });
  const toAgent = await remove({ handTo: agent.id, handOver: [mailbox.id, other!.id] });
  const toHerself = await remove({ handTo: graceActor.id, handOver: [mailbox.id, other!.id] });

  for (const refused of [missing, twice, notHers, noHuman, toAgent, toHerself]) expect(refused.response.status).toBe(400);
  expect(missing.error?.message).toContain(other!.id);
  expect(notHers.error?.message).toMatch(/dryRun/);
  expect(toAgent.error?.message).toMatch(/another human/);
  expect((await grace.GET("/whoami")).response.status).toBe(200);
  expect(keeps(duva, "Hej. Till Grace.")).toBe(true);
});

test("only an admin can remove a human", async () => {
  const { linus, hermes, graceActor, mailbox } = await withGraceAndHermes();
  const removal = { params: { path: { human: graceActor.id } }, body: { delete: [mailbox.id] } };

  const byHuman = await linus.POST("/humans/{human}/remove", removal);
  const byAgent = await hermes.POST("/humans/{human}/remove", removal);

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
});

test("removing a human who doesn't exist gets 404", async () => {
  const { ada, agent } = await withGraceAndHermes();

  const nobody = await ada.POST("/humans/{human}/remove", { params: { path: { human: "nobody" } }, body: { dryRun: true } });
  const anAgent = await ada.POST("/humans/{human}/remove", { params: { path: { human: agent.id } }, body: { dryRun: true } });

  expect(nobody.response.status).toBe(404);
  expect(anAgent.response.status).toBe(404);
});

test("the organization's last admin can't be removed", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");

  const { response, error } = await ada.POST("/humans/{human}/remove", { params: { path: { human: me!.id } }, body: {} });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/last admin/);
  expect((await ada.GET("/whoami")).data).toEqual(me);
});

test("an admin can remove another admin, and themselves while another admin is left", async () => {
  const { ada, adaId, linus, linusId } = await withGraceAndHermes();
  await ada.PATCH("/humans/{human}", { params: { path: { human: linusId } }, body: { admin: true } });

  const { response } = await ada.POST("/humans/{human}/remove", { params: { path: { human: adaId } }, body: {} });

  expect(response.status).toBe(200);
  expect((await ada.GET("/whoami")).response.status).toBe(401);
  const last = await linus.POST("/humans/{human}/remove", { params: { path: { human: linusId } }, body: {} });
  expect(last.response.status).toBe(409);
});

test("each change of a removal is in the organization's feed under the admin, and older entries keep naming the removed by ID", async () => {
  const { ada, adaId, graceActor, linusId, agent, mailbox, remove } = await withGraceAndHermes();
  const { data: before } = await ada.GET("/organization/changes");

  await remove({ handTo: linusId, handOver: [mailbox.id] });

  const { data: after } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  const stamp = { position: expect.any(Number), at: expect.any(String), actor: adaId };
  // Her agents go first, the mailbox agent of her mailbox among them, in no particular order, and the
  // mailbox handed over gets a mailbox agent its new owner sponsors.
  const removedAgents = after!.changes.slice(0, 2);
  expect(removedAgents).toEqual(
    expect.arrayContaining([
      { ...stamp, type: "actorRemoved", removed: agent },
      { ...stamp, type: "actorRemoved", removed: expect.objectContaining({ name: "Coo", mailboxAgent: true, sponsor: graceActor.id }) },
    ]),
  );
  expect(after?.changes.slice(2)).toEqual([
    { ...stamp, type: "mailboxHandedOver", mailbox: mailbox.id, from: graceActor.id, to: linusId },
    { ...stamp, actor: linusId, type: "actorAdded", added: expect.objectContaining({ name: "Coo", mailboxAgent: true, sponsor: linusId }) },
    { ...stamp, type: "actorRemoved", removed: graceActor },
  ]);
  expect(before?.changes).toContainEqual(expect.objectContaining({ type: "actorAdded", added: graceActor }));
  expect(before?.changes).toContainEqual(expect.objectContaining({ type: "actorAdded", added: agent, actor: graceActor.id }));
});

test("an agent's sponsor removes it: its key stops working, and the removal is in the feed under them", async () => {
  const { ada, grace, hermes, graceActor, agent } = await withGraceAndHermes();
  const { data: before } = await ada.GET("/organization/changes");

  const { response, data } = await grace.DELETE("/agents/{agent}", { params: { path: { agent: agent.id } } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ agent });
  expect((await hermes.GET("/whoami")).response.status).toBe(401);
  expect((await grace.GET("/agents")).data!.agents.filter(({ mailboxAgent }) => !mailboxAgent)).toEqual([]);
  const { data: after } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(after?.changes.at(-1)).toMatchObject({ type: "actorRemoved", removed: agent, actor: graceActor.id });
});

test("an admin can remove any agent, and other humans and agents can't", async () => {
  const { ada, linus, hermes, agent } = await withGraceAndHermes();
  const params = { params: { path: { agent: agent.id } } };

  const byHuman = await linus.DELETE("/agents/{agent}", params);
  const byItself = await hermes.DELETE("/agents/{agent}", params);
  const byAdmin = await ada.DELETE("/agents/{agent}", params);

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/sponsor/);
  expect(byItself.response.status).toBe(403);
  expect(byItself.error?.message).toBe("Agents can't remove agents. Ask the agent's sponsor or an admin.");
  expect(byAdmin.response.status).toBe(200);
  expect((await hermes.GET("/whoami")).response.status).toBe(401);
  expect((await ada.DELETE("/agents/{agent}", params)).response.status).toBe(404);
});

test("removing an agent withdraws its sends waiting for approval in its sponsor's mailbox, and leaves its drafts there", async () => {
  const { grace, hermes, agent, mailbox } = await withGraceAndHermes();
  const params = { path: { mailbox: mailbox.id } };
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sponsorAccess: "send" } });
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["alan@example.org"], text: "Hej." } });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  expect((await grace.GET("/approvals")).data?.approvals).toHaveLength(1);

  await grace.DELETE("/agents/{agent}", { params: { path: { agent: agent.id } } });

  expect((await grace.GET("/approvals")).data?.approvals).toEqual([]);
  const { data: left } = await grace.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: draft!.id } } });
  expect(left?.send?.state).toBe("withdrawn");
});

test("an admin makes a human an admin, who can then change the setup, and takes it away again, each change in the feed", async () => {
  const { ada, adaId, linus, linusId } = await withGraceAndHermes();
  const human = { params: { path: { human: linusId } } };

  const { response, data: made } = await ada.PATCH("/humans/{human}", { ...human, body: { admin: true } });
  const asAdmin = await linus.POST("/humans", { body: { email: "alan@example.org" } });
  const { data: unmade } = await ada.PATCH("/humans/{human}", { ...human, body: { admin: false } });
  const asHuman = await linus.POST("/humans", { body: { email: "alonzo@example.org" } });

  expect(response.status).toBe(200);
  expect(made).toEqual({ id: linusId, kind: "human", email: "linus@example.org", admin: true });
  expect(asAdmin.response.status).toBe(201);
  expect(unmade).toEqual({ ...made, admin: false });
  expect(asHuman.response.status).toBe(403);
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes?.changes.filter(({ type }) => type === "adminChanged")).toEqual([
    { position: expect.any(Number), at: expect.any(String), actor: adaId, type: "adminChanged", human: linusId, admin: true },
    { position: expect.any(Number), at: expect.any(String), actor: adaId, type: "adminChanged", human: linusId, admin: false },
  ]);
});

test("making an admin of a human who already is one changes nothing", async () => {
  const { ada, adaId } = await withGraceAndHermes();
  const { data: before } = await ada.GET("/organization/changes");

  const { data } = await ada.PATCH("/humans/{human}", { params: { path: { human: adaId } }, body: { admin: true } });

  expect(data?.admin).toBe(true);
  expect((await ada.GET("/organization/changes", { params: { query: { after: before!.position } } })).data?.changes).toEqual([]);
});

test("the last admin can't take away their own admin, and another admin can once there is one", async () => {
  const { ada, adaId, linus, linusId } = await withGraceAndHermes();
  const adas = { params: { path: { human: adaId } } };

  const last = await ada.PATCH("/humans/{human}", { ...adas, body: { admin: false } });
  await ada.PATCH("/humans/{human}", { params: { path: { human: linusId } }, body: { admin: true } });
  const byLinus = await linus.PATCH("/humans/{human}", { ...adas, body: { admin: false } });
  const lastAgain = await linus.PATCH("/humans/{human}", { params: { path: { human: linusId } }, body: { admin: false } });

  expect(last.response.status).toBe(409);
  expect(last.error?.message).toMatch(/last admin/);
  expect(byLinus.data?.admin).toBe(false);
  expect(lastAgain.response.status).toBe(409);
});

test("two admins taking each other's admin away at once leave one of them an admin", async () => {
  const { ada, adaId, linus, linusId } = await withGraceAndHermes();
  await ada.PATCH("/humans/{human}", { params: { path: { human: linusId } }, body: { admin: true } });

  const answers = await Promise.all([
    ada.PATCH("/humans/{human}", { params: { path: { human: linusId } }, body: { admin: false } }),
    linus.PATCH("/humans/{human}", { params: { path: { human: adaId } }, body: { admin: false } }),
  ]);

  expect(answers.map(({ response }) => response.status).sort()).toEqual([200, 409]);
  // Whichever kept their admin lists the humans.
  const listed = (await ada.GET("/humans")).data ?? (await linus.GET("/humans")).data;
  expect(listed?.humans.filter(({ admin }) => admin)).toHaveLength(1);
});

test("only an admin can change who is an admin, and only of a human", async () => {
  const { ada, linus, hermes, linusId, agent } = await withGraceAndHermes();
  const change = { params: { path: { human: linusId } }, body: { admin: true } };

  const byHuman = await linus.PATCH("/humans/{human}", change);
  const byAgent = await hermes.PATCH("/humans/{human}", change);
  const ofAgent = await ada.PATCH("/humans/{human}", { params: { path: { human: agent.id } }, body: { admin: true } });
  const notOnOrOff = await ada.PATCH("/humans/{human}", { params: { path: { human: linusId } }, body: { admin: "yes" as unknown as boolean } });

  expect(byHuman.response.status).toBe(403);
  expect(byAgent.response.status).toBe(403);
  expect(ofAgent.response.status).toBe(404);
  expect(notOnOrOff.response.status).toBe(400);
});

/**
 * Grace gives Hermes send sponsor access, Hermes replies to the message in her mailbox and Grace
 * approves the reply, then Hermes drafts another, which Grace rejects. Answers both approvals.
 */
async function hermesSends({ grace, hermes, agent, mailbox }: Awaited<ReturnType<typeof withGraceAndHermes>>) {
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sponsorAccess: "send" } });
  const params = { path: { mailbox: mailbox.id } };
  const { data: threads } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: threads!.threads[0]!.id } } });
  const ask = async (body: { answers?: string; to?: string[]; text: string }) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    return asked!.send!.approval!;
  };
  const sent = await ask({ answers: thread!.messages[0]!.id, text: "Ja, gärna." });
  await grace.POST("/approvals/{approval}/send", { params: { path: { approval: sent } }, body: { text: "Ja, gärna. Hälsningar, Grace." } });
  const rejected = await ask({ to: ["alan@example.org"], text: "Hej igen." });
  await grace.POST("/approvals/{approval}/reject", { params: { path: { approval: rejected } }, body: { note: "Inte nu." } });
  /** Whether the approval can still be read: rejecting it again is refused as decided, rather than as missing. */
  const kept = async (approval: string) => (await grace.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Igen." } })).response.status === 409;
  return { sent, rejected, kept };
}

test("by default an agent's approval records stay when it is removed", async () => {
  const fixture = await withGraceAndHermes();
  const { sent, rejected, kept } = await hermesSends(fixture);

  await fixture.grace.DELETE("/agents/{agent}", { params: { path: { agent: fixture.agent.id } } });

  expect(await kept(sent)).toBe(true);
  expect(await kept(rejected)).toBe(true);
});

test("once an agent is removed, its sponsor can't send its rejected draft after all, which stays in their mailbox", async () => {
  const fixture = await withGraceAndHermes();
  const { rejected } = await hermesSends(fixture);
  await fixture.grace.DELETE("/agents/{agent}", { params: { path: { agent: fixture.agent.id } } });
  const sentBefore = fixture.duva.sent().length;

  const { response, error } = await fixture.grace.POST("/approvals/{approval}/send", { params: { path: { approval: rejected } }, body: {} });

  expect(response.status).toBe(409);
  expect(error).toEqual({ message: "The agent was removed, so its sends can't be decided any more. Send the draft yourself if you still want it to go." });
  expect(fixture.duva.sent()).toHaveLength(sentBefore);
});

test("a deleted mailbox whose erasure failed is erased by the eraser's next daily run", async () => {
  const { duva, mailbox, remove } = await withGraceAndHermes({ eraserRunsLost: true });
  await remove({ delete: [mailbox.id] });
  expect(keeps(duva, "Hej. Till Grace.")).toBe(true);

  await duva.erase(new Date());

  expect(keeps(duva, "Hej. Till Grace.")).toBe(false);
  expect(duva.searchObjects().some((file) => file.includes("Till Grace"))).toBe(false);
});

test("a removed human can be added again, as a new actor with no mailboxes", async () => {
  const { duva, ada, graceActor, mailbox, remove } = await withGraceAndHermes();
  await remove({ delete: [mailbox.id] });

  const { data: again } = await ada.POST("/humans", { body: { email: "grace@example.org" } });

  expect(again?.id).not.toBe(graceActor.id);
  expect((await duva.signIn("grace@example.org").GET("/whoami")).data).toEqual(again);
  expect((await duva.signIn("grace@example.org").GET("/mailboxes")).data).toEqual({ mailboxes: [] });
});

test("setup re-runs as before after the first admin was removed", async () => {
  const { duva, ada, adaId, linus, linusId } = await withGraceAndHermes();
  await ada.PATCH("/humans/{human}", { params: { path: { human: linusId } }, body: { admin: true } });
  await linus.POST("/humans/{human}/remove", { params: { path: { human: adaId } }, body: {} });

  await duva.setUp({ admin: "ada@example.org" });

  expect((await linus.GET("/humans")).data?.humans.map(({ email }) => email).sort()).toEqual(["grace@example.org", "linus@example.org"]);
});

test("deleting a mailbox with several addresses removes each, and mail to any of them is refused", async () => {
  const { duva, ada, adaId, mailbox, remove } = await withGraceAndHermes();
  await ada.POST("/addresses", { body: { address: "hopper@example.com", mailbox: mailbox.id } });
  const { data: before } = await ada.GET("/organization/changes");

  await remove({ delete: [mailbox.id] });

  const refused = await duva.receive(note("Efteråt", "grace@example.com, hopper@example.com"), { to: ["grace@example.com", "hopper@example.com"] });
  expect(refused.refused.sort()).toEqual(["grace@example.com", "hopper@example.com"]);
  expect((await ada.GET("/addresses")).data?.addresses.map(({ address }) => address)).toEqual([]);
  const { data: after } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(after?.changes.filter(({ type }) => type === "addressRemoved")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actor: adaId, address: "grace@example.com", mailbox: mailbox.id }),
      expect.objectContaining({ actor: adaId, address: "hopper@example.com", mailbox: mailbox.id }),
    ]),
  );
});
