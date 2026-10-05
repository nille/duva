import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import { startDuva } from "./harness.ts";

const mail = (name: string) => readFile(new URL(`./mail/${name}.eml`, import.meta.url), "utf8");

/**
 * A deployment on example.com where Ada is the first admin. Linus sponsors the agent Hermes, and
 * each has a personal mailbox, linus@example.com and hermes@example.com. Grace is another human,
 * with her own at grace@example.com, and sponsors the agent Iris.
 */
async function withSponsor() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: hermesCreated } = await linus.POST("/agents", { body: { name: "Hermes" } });
  const { data: irisCreated } = await grace.POST("/agents", { body: { name: "Iris" } });
  const hermesId = hermesCreated!.agent.id;
  const { data: linusMailbox } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const { data: hermesMailbox } = await ada.POST("/mailboxes", { body: { owner: hermesId, address: "hermes@example.com" } });
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  const settings = { params: { path: { agent: hermesId } } };
  /** Linus gives Hermes the sponsor access. */
  const giveAccess = async (sponsorAccess: "none" | "read" | "full") => {
    const { response } = await linus.PATCH("/agents/{agent}/settings", { ...settings, body: { sponsorAccess } });
    expect(response.status).toBe(200);
  };
  return {
    duva,
    ada,
    linus,
    linusId: linusActor!.id,
    grace,
    hermes: duva.withKey(hermesCreated!.key),
    hermesId,
    iris: duva.withKey(irisCreated!.key),
    irisId: irisCreated!.agent.id,
    linusMailbox: linusMailbox!,
    hermesMailbox: hermesMailbox!,
    graceMailbox: graceMailbox!,
    settings,
    giveAccess,
  };
}

const defaults = { sponsorAccess: "none", approvalForOwnMailbox: true, approvalAsSponsor: true, disclosureLineForOwnMailbox: true, disclosureLineAsSponsor: true };

test("an agent starts with no sponsor access and every switch on, which its sponsor and the agent read", async () => {
  const { linus, hermes, settings } = await withSponsor();

  for (const actor of [linus, hermes]) {
    const { response, data } = await actor.GET("/agents/{agent}/settings", settings);
    expect(response.status).toBe(200);
    expect(data).toEqual(defaults);
  }
});

test("nobody but the agent's sponsor and the agent reads its settings, not even an admin", async () => {
  const { ada, grace, iris, settings } = await withSponsor();

  for (const actor of [ada, grace, iris]) {
    const { response, error } = await actor.GET("/agents/{agent}/settings", settings);
    expect(response.status).toBe(403);
    expect(error).toEqual({ message: "Only the agent's sponsor and the agent can read its settings. Ask its sponsor." });
  }
});

test("reading the settings of an agent that doesn't exist gets 404", async () => {
  const { linus } = await withSponsor();

  const { response } = await linus.GET("/agents/{agent}/settings", { params: { path: { agent: "nope" } } });

  expect(response.status).toBe(404);
});

test("the sponsor changes an agent's settings, which works at once and is in their mailbox's change feed under them", async () => {
  const { linus, linusId, hermes, hermesId, linusMailbox, settings } = await withSponsor();

  const { response, data } = await linus.PATCH("/agents/{agent}/settings", { ...settings, body: { sponsorAccess: "read", approvalAsSponsor: false } });

  const changed = { ...defaults, sponsorAccess: "read", approvalAsSponsor: false };
  expect(response.status).toBe(200);
  expect(data).toEqual(changed);
  expect((await hermes.GET("/agents/{agent}/settings", settings)).data).toEqual(changed);
  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: linusMailbox.id } } });
  expect(feed!.changes).toEqual([
    {
      position: 1,
      at: expect.any(String),
      actor: linusId,
      type: "agentSettingsChanged",
      agent: hermesId,
      before: { sponsorAccess: "none", approvalAsSponsor: true },
      after: { sponsorAccess: "read", approvalAsSponsor: false },
    },
  ]);
});

test("each switch turns off and on again", async () => {
  const { linus, settings } = await withSponsor();
  const switches = ["approvalForOwnMailbox", "approvalAsSponsor", "disclosureLineForOwnMailbox", "disclosureLineAsSponsor"] as const;

  for (const name of switches) {
    expect((await linus.PATCH("/agents/{agent}/settings", { ...settings, body: { [name]: false } })).data).toEqual({ ...defaults, [name]: false });
    expect((await linus.PATCH("/agents/{agent}/settings", { ...settings, body: { [name]: true } })).data).toEqual(defaults);
  }
});

test("giving a setting the value it has records no change", async () => {
  const { linus, linusMailbox, settings } = await withSponsor();

  const { response, data } = await linus.PATCH("/agents/{agent}/settings", { ...settings, body: { sponsorAccess: "none", approvalAsSponsor: true } });

  expect(response.status).toBe(200);
  expect(data).toEqual(defaults);
  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: linusMailbox.id } } });
  expect(feed!.changes).toEqual([]);
});

test("a sponsor without a mailbox changes an agent's switches, recorded in the agent's mailbox's change feed", async () => {
  const { duva, ada } = await withSponsor();
  await ada.POST("/humans", { body: { email: "ken@example.org" } });
  const ken = duva.signIn("ken@example.org");
  const { data: me } = await ken.GET("/whoami");
  const { data: created } = await ken.POST("/agents", { body: { name: "Hugin" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hugin@example.com" } });

  await ken.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { approvalForOwnMailbox: false } });

  const { data: feed } = await ken.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: mailbox!.id } } });
  expect(feed!.changes).toEqual([
    {
      position: 1,
      at: expect.any(String),
      actor: me!.id,
      type: "agentSettingsChanged",
      agent: created!.agent.id,
      before: { approvalForOwnMailbox: true },
      after: { approvalForOwnMailbox: false },
    },
  ]);
});

test("a change to an agent's settings is refused when neither it nor its sponsor has a mailbox to record it in", async () => {
  const { duva, ada } = await withSponsor();
  await ada.POST("/humans", { body: { email: "ken@example.org" } });
  const ken = duva.signIn("ken@example.org");
  const { data: created } = await ken.POST("/agents", { body: { name: "Hugin" } });
  const settings = { params: { path: { agent: created!.agent.id } } };

  const { response, error } = await ken.PATCH("/agents/{agent}/settings", { ...settings, body: { approvalForOwnMailbox: false } });

  expect(response.status).toBe(409);
  expect(error).toEqual({ message: "Neither you nor the agent has a mailbox, whose change feed would record the change. Ask an admin to create one for you first." });
  expect((await ken.GET("/agents/{agent}/settings", settings)).data).toEqual(defaults);
});

test("nobody but the agent's sponsor changes its settings, not the agent, another human or an admin", async () => {
  const { ada, grace, hermes, iris, linus, settings } = await withSponsor();

  for (const actor of [hermes, ada, grace, iris]) {
    const { response, error } = await actor.PATCH("/agents/{agent}/settings", { ...settings, body: { sponsorAccess: "full" } });
    expect(response.status).toBe(403);
    expect(error).toEqual({ message: "Only the agent's sponsor can change its settings. Ask them to." });
  }
  expect((await linus.GET("/agents/{agent}/settings", settings)).data).toEqual(defaults);
});

test.each([
  ["no setting", {}, "Give a setting to change: sponsorAccess, approvalForOwnMailbox, approvalAsSponsor, disclosureLineForOwnMailbox, disclosureLineAsSponsor."],
  ["a setting agents don't have", { admin: true }, `An agent has no setting "admin". Its settings are sponsorAccess, approvalForOwnMailbox, approvalAsSponsor, disclosureLineForOwnMailbox, disclosureLineAsSponsor.`],
  ["a sponsor access there isn't", { sponsorAccess: "write" }, "Give sponsorAccess as none, read or full."],
  ["a switch that isn't on or off", { approvalAsSponsor: "no" }, "Give approvalAsSponsor as true to turn it on, or false to turn it off."],
])("changing an agent's settings with %s gets 400", async (_, body, message) => {
  const { linus, settings } = await withSponsor();

  const { response, error } = await linus.PATCH("/agents/{agent}/settings", { ...settings, body: body as never });

  expect(response.status).toBe(400);
  expect(error).toEqual({ message });
  expect((await linus.GET("/agents/{agent}/settings", settings)).data).toEqual(defaults);
});

test("an agent without sponsor access lists only its own mailbox", async () => {
  const { hermes, hermesMailbox } = await withSponsor();

  const { data } = await hermes.GET("/mailboxes");

  expect(data).toEqual({ mailboxes: [hermesMailbox] });
});

test.each(["read", "full"] as const)("an agent with %s sponsor access lists its sponsor's mailbox beside its own, with its access", async (access) => {
  const { hermes, hermesMailbox, linusMailbox, giveAccess } = await withSponsor();

  await giveAccess(access);

  const { data } = await hermes.GET("/mailboxes");
  expect(data).toEqual({ mailboxes: [hermesMailbox, { ...linusMailbox, sponsorAccess: access }] });
});

test("a sponsor with two mailboxes gives an agent sponsor access to both, recorded in each one's change feed", async () => {
  const { ada, linus, linusId, linusMailbox, hermes, hermesMailbox, giveAccess } = await withSponsor();
  const { data: second } = await ada.POST("/mailboxes", { body: { owner: linusId, address: "linus.work@example.com" } });

  await giveAccess("read");

  const { data } = await hermes.GET("/mailboxes");
  expect(data!.mailboxes[0]).toEqual(hermesMailbox);
  // The sponsor's mailboxes come in no particular order.
  expect(data!.mailboxes.slice(1)).toHaveLength(2);
  expect(data!.mailboxes.slice(1)).toEqual(expect.arrayContaining([{ ...linusMailbox, sponsorAccess: "read" }, { ...second!, sponsorAccess: "read" }]));
  for (const mailbox of [linusMailbox, second!]) {
    const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: mailbox.id } } });
    expect(feed!.changes.map(({ type }) => type)).toEqual(["agentSettingsChanged"]);
    expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id } } })).response.status).toBe(200);
  }
});

/** Linus's mailbox with a received message that has attachments, and a draft. */
async function withMail(fixture: Awaited<ReturnType<typeof withSponsor>>) {
  const { duva, linus, linusMailbox } = fixture;
  const params = { path: { mailbox: linusMailbox.id } };
  await duva.receive((await mail("attachment")).replace("To: hermes@example.com", "To: linus@example.com"), { to: ["linus@example.com"] });
  const { data: list } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = list!.threads[0]!.id;
  const { data: read } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
  const message = read!.messages[0]!.id;
  const { data: draft } = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Plans", text: "Hej." } });
  return { params, thread, message, draft: draft!.id };
}

/** Everything a sponsor reads in their agent's mailbox, as the actor calls it in the mailbox, each with what it answers. */
function readings(as: DuvaClient, { params, thread, message, draft }: Awaited<ReturnType<typeof withMail>>) {
  return {
    mailbox: () => as.GET("/mailboxes/{mailbox}", { params }),
    changes: () => as.GET("/mailboxes/{mailbox}/changes", { params }),
    inbox: () => as.GET("/mailboxes/{mailbox}/threads", { params }),
    sent: () => as.GET("/mailboxes/{mailbox}/sent", { params }),
    allMail: () => as.GET("/mailboxes/{mailbox}/all-mail", { params }),
    thread: () => as.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } }),
    labels: () => as.GET("/mailboxes/{mailbox}/labels", { params }),
    drafts: () => as.GET("/mailboxes/{mailbox}/drafts", { params }),
    draft: () => as.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft } } }),
    attachment: () => as.GET("/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}", { params: { path: { ...params.path, message, attachment: 0 } } }),
  };
}

test.each(["read", "full"] as const)("an agent with %s sponsor access reads everything its sponsor reads in their mailbox", async (access) => {
  const fixture = await withSponsor();
  const { duva, linus, hermes, giveAccess } = fixture;
  const placed = await withMail(fixture);
  await giveAccess(access);

  const asSponsor = readings(linus, placed);
  for (const [name, read] of Object.entries(readings(hermes, placed))) {
    const { response, data } = await read();
    expect(response.status, name).toBe(200);
    const sponsors = (await asSponsor[name as keyof typeof asSponsor]()).data;
    // An attachment link is new each time it's given, and both work.
    if (name === "attachment") expect(await (await duva.download((data as { url: string }).url)).text()).toBe("Hello, PDF!");
    else expect(data, name).toEqual(sponsors);
  }
});

test("an agent without sponsor access gets 403 for everything in its sponsor's mailbox, saying what's missing", async () => {
  const fixture = await withSponsor();
  const placed = await withMail(fixture);

  for (const [name, read] of Object.entries(readings(fixture.hermes, placed))) {
    const { response, error } = await read();
    expect(response.status, name).toBe(403);
    expect(error, name).toEqual({ message: "Your sponsor hasn't given you sponsor access to their mailbox. Ask them for read access." });
  }
});

test("taking sponsor access away works at once", async () => {
  const fixture = await withSponsor();
  const { hermes, hermesMailbox, giveAccess } = fixture;
  const placed = await withMail(fixture);
  await giveAccess("read");
  expect((await readings(hermes, placed).inbox()).response.status).toBe(200);

  await giveAccess("none");

  expect((await readings(hermes, placed).inbox()).response.status).toBe(403);
  expect((await hermes.GET("/mailboxes")).data).toEqual({ mailboxes: [hermesMailbox] });
});

/** What the actor can't do in the mailbox with read sponsor access, each as it calls it. */
function changes(as: DuvaClient, { params, thread, draft }: Awaited<ReturnType<typeof withMail>>) {
  const threads = { threads: [thread] };
  const inDraft = { params: { path: { ...params.path, draft } } };
  return {
    markRead: () => as.POST("/mailboxes/{mailbox}/threads/read", { params, body: threads }),
    markUnread: () => as.POST("/mailboxes/{mailbox}/threads/unread", { params, body: threads }),
    archive: () => as.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { ...threads, remove: ["inbox"] } }),
    trash: () => as.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { ...threads, add: ["trash"] } }),
    createLabel: () => as.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } }),
    renameLabel: () => as.PATCH("/mailboxes/{mailbox}/labels/{label}", { params: { path: { ...params.path, label: "some" } }, body: { name: "Kvitton" } }),
    deleteLabel: () => as.DELETE("/mailboxes/{mailbox}/labels/{label}", { params: { path: { ...params.path, label: "some" } } }),
    writeDraft: () => as.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"] } }),
    changeDraft: () => as.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...inDraft, body: { text: "Hej igen." } }),
    deleteDraft: () => as.DELETE("/mailboxes/{mailbox}/drafts/{draft}", inDraft),
    sendDraft: () => as.POST("/mailboxes/{mailbox}/drafts/{draft}/send", inDraft),
    emptyTrash: () => as.POST("/mailboxes/{mailbox}/trash/empty", { params }),
  };
}

const readRefusals: Record<keyof ReturnType<typeof changes>, string> = {
  markRead: "Your sponsor access is read, which doesn't let you organize your sponsor's mailbox. Ask your sponsor for full access.",
  markUnread: "Your sponsor access is read, which doesn't let you organize your sponsor's mailbox. Ask your sponsor for full access.",
  archive: "Your sponsor access is read, which doesn't let you organize your sponsor's mailbox. Ask your sponsor for full access.",
  trash: "Your sponsor access is read, which doesn't let you move threads to Trash or back in your sponsor's mailbox. Ask your sponsor for full access.",
  createLabel: "Your sponsor access is read, which doesn't let you organize your sponsor's mailbox. Ask your sponsor for full access.",
  renameLabel: "Your sponsor access is read, which doesn't let you organize your sponsor's mailbox. Ask your sponsor for full access.",
  deleteLabel: "Your sponsor access is read, which doesn't let you organize your sponsor's mailbox. Ask your sponsor for full access.",
  writeDraft: "Your sponsor access is read, which doesn't let you write or change drafts in your sponsor's mailbox. Ask your sponsor for full access.",
  changeDraft: "Your sponsor access is read, which doesn't let you write or change drafts in your sponsor's mailbox. Ask your sponsor for full access.",
  deleteDraft: "Your sponsor access is read, which doesn't let you write or change drafts in your sponsor's mailbox. Ask your sponsor for full access.",
  sendDraft: "Your sponsor access is read, which doesn't let you send as your sponsor. Ask your sponsor for full access.",
  emptyTrash: "Only your sponsor can empty their Trash. Ask them to.",
};

test("an agent with read sponsor access gets 403 changing anything in its sponsor's mailbox, saying what's missing, and nothing changes", async () => {
  const fixture = await withSponsor();
  const { linus, hermes, giveAccess } = fixture;
  const placed = await withMail(fixture);
  await giveAccess("read");
  // An attachment link is new each time it's given, so it is left out.
  const everything = async () => Promise.all(Object.entries(readings(linus, placed)).filter(([name]) => name !== "attachment").map(async ([, read]) => (await read()).data));
  const before = await everything();

  for (const [name, change] of Object.entries(changes(hermes, placed))) {
    const { response, error } = await change();
    expect(response.status, name).toBe(403);
    expect(error, name).toEqual({ message: readRefusals[name as keyof typeof readRefusals] });
  }
  expect(await everything()).toEqual(before);
});

test("an agent with full sponsor access organizes its sponsor's mailbox as its sponsor does, each change in the feed naming it", async () => {
  const fixture = await withSponsor();
  const { linus, hermes, hermesId, giveAccess } = fixture;
  const { params, thread } = await withMail(fixture);
  await giveAccess("full");
  const threads = { threads: [thread] };
  const label = (body: { add?: string[]; remove?: string[] }) => hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { ...threads, ...body } });
  const labels = async () => (await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } })).data!.labels;

  expect((await hermes.POST("/mailboxes/{mailbox}/threads/read", { params, body: threads })).response.status).toBe(200);
  expect((await hermes.POST("/mailboxes/{mailbox}/threads/unread", { params, body: threads })).response.status).toBe(200);
  expect((await label({ remove: ["inbox"] })).response.status).toBe(200);
  expect(await labels()).toEqual([]);
  expect((await label({ add: ["inbox"] })).response.status).toBe(200);
  expect((await label({ add: ["spam"] })).response.status).toBe(200);
  expect(await labels()).toEqual(["spam"]);
  expect((await label({ remove: ["spam"] })).response.status).toBe(200);
  expect((await label({ add: ["trash"] })).response.status).toBe(200);
  expect(await labels()).toEqual(["trash"]);
  expect((await label({ remove: ["trash"] })).response.status).toBe(200);
  expect(await labels()).toEqual(["inbox"]);
  const { response: created, data: kvitton } = await hermes.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  expect(created.status).toBe(201);
  const inLabel = { params: { path: { ...params.path, label: kvitton!.id } } };
  expect((await label({ add: [kvitton!.id] })).response.status).toBe(200);
  expect(await labels()).toEqual(expect.arrayContaining(["inbox", kvitton!.id]));
  expect((await label({ remove: [kvitton!.id] })).response.status).toBe(200);
  expect((await hermes.PATCH("/mailboxes/{mailbox}/labels/{label}", { ...inLabel, body: { name: "Kvitton 2026" } })).response.status).toBe(200);
  expect((await linus.GET("/mailboxes/{mailbox}/labels", { params })).data!.labels).toContainEqual(expect.objectContaining({ id: kvitton!.id, name: "Kvitton 2026" }));
  expect((await hermes.DELETE("/mailboxes/{mailbox}/labels/{label}", inLabel)).response.status).toBe(200);

  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params });
  const byHermes = feed!.changes.filter((change) => "actor" in change && change.actor === hermesId);
  expect(byHermes.map(({ type }) => type)).toEqual([
    "threadRead",
    "threadUnread",
    ...Array(6).fill("threadLabelsChanged"),
    "labelCreated",
    "threadLabelsChanged",
    "threadLabelsChanged",
    "labelRenamed",
    "labelDeleted",
  ]);
});

test("an agent with full sponsor access never empties its sponsor's Trash, and can't send as them yet", async () => {
  const fixture = await withSponsor();
  const { hermes, giveAccess } = fixture;
  const { params, draft } = await withMail(fixture);
  await giveAccess("full");

  const { response: emptied, error: notEmptied } = await hermes.POST("/mailboxes/{mailbox}/trash/empty", { params });
  const { response: sent, error: notSent } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft } } });

  expect(emptied.status).toBe(403);
  expect(notEmptied).toEqual({ message: "Only your sponsor can empty their Trash. Ask them to." });
  expect(sent.status).toBe(403);
  expect(notSent).toEqual({ message: "Full sponsor access doesn't let you send as your sponsor yet. Ask your sponsor to do it." });
});

test("an agent with full sponsor access drafts replies, replies to all, forwards and new mail in its sponsor's mailbox, as its sponsor's own drafts are", async () => {
  const fixture = await withSponsor();
  const { linus, hermes, hermesId, giveAccess } = fixture;
  const { params, message } = await withMail(fixture);
  await giveAccess("full");
  const linusAddress = "linus@example.com";
  const drafts: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ answers: message, text: "Tack!" }, { from: linusAddress, to: [{ name: "Grace Hopper", address: "grace@example.org" }], subject: "Re: The report", text: "Tack!" }],
    [{ answers: message, replyAll: true }, { from: linusAddress, to: [{ name: "Grace Hopper", address: "grace@example.org" }], cc: [] }],
    [{ forwards: message, to: ["ada@example.org"] }, { from: linusAddress, to: [{ address: "ada@example.org" }], subject: "Fwd: The report", attachments: expect.any(Array) }],
    [{ to: ["grace@example.org"], subject: "Lunch", text: "Hej." }, { from: linusAddress, to: [{ address: "grace@example.org" }], subject: "Lunch", text: "Hej." }],
  ];
  const withoutIdAndTime = ({ id: _, updatedAt: __, ...draft }: { id: string; updatedAt: string }) => draft;

  for (const [body, expected] of drafts) {
    const { response, data } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body });
    expect(response.status).toBe(201);
    expect(data).toMatchObject(expected);
    const { data: sponsors } = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body });
    expect(withoutIdAndTime(data!)).toEqual(withoutIdAndTime(sponsors!));
    expect((await linus.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: data!.id } } })).data).toEqual(data);
  }
  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params });
  expect(feed!.changes.filter((change) => change.type === "draftWritten" && "actor" in change && change.actor === hermesId)).toHaveLength(drafts.length);
});

test("in the sponsor's mailbox, an agent with full access and its sponsor each change and delete the other's drafts, each change in the feed naming who", async () => {
  const fixture = await withSponsor();
  const { linus, linusId, hermes, hermesId, giveAccess } = fixture;
  const { params, draft: linusDraft } = await withMail(fixture);
  await giveAccess("full");
  const { data: hermesDraft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], text: "Utkast." } });
  const inDraft = (draft: string) => ({ params: { path: { ...params.path, draft } } });

  const { response: hermesEdits, data: editedByHermes } = await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...inDraft(linusDraft), body: { text: "Hej igen." } });
  const { response: linusEdits, data: editedByLinus } = await linus.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { ...inDraft(hermesDraft!.id), body: { subject: "Lunch" } });

  expect(hermesEdits.status).toBe(200);
  expect(editedByHermes).toMatchObject({ id: linusDraft, text: "Hej igen." });
  expect(linusEdits.status).toBe(200);
  expect(editedByLinus).toMatchObject({ id: hermesDraft!.id, subject: "Lunch", text: "Utkast." });

  expect((await hermes.DELETE("/mailboxes/{mailbox}/drafts/{draft}", inDraft(linusDraft))).response.status).toBe(200);
  expect((await linus.DELETE("/mailboxes/{mailbox}/drafts/{draft}", inDraft(hermesDraft!.id))).response.status).toBe(200);
  expect((await linus.GET("/mailboxes/{mailbox}/drafts", { params })).data).toEqual({ drafts: [] });
  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params });
  const drafting = feed!.changes.filter(({ type }) => type === "draftChanged" || type === "draftDeleted");
  expect(drafting).toEqual([
    expect.objectContaining({ type: "draftChanged", draft: linusDraft, actor: hermesId }),
    expect.objectContaining({ type: "draftChanged", draft: hermesDraft!.id, actor: linusId }),
    expect.objectContaining({ type: "draftDeleted", draft: linusDraft, actor: hermesId }),
    expect.objectContaining({ type: "draftDeleted", draft: hermesDraft!.id, actor: linusId }),
  ]);
});

test("lowering sponsor access from full to read stops the agent changing anything at once, its drafts staying", async () => {
  const fixture = await withSponsor();
  const { linus, hermes, giveAccess } = fixture;
  const { params, thread } = await withMail(fixture);
  await giveAccess("full");
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"] } });

  await giveAccess("read");

  const { response } = await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"] } });
  expect(response.status).toBe(403);
  expect((await linus.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: draft!.id } } })).data).toEqual(draft);
});

test("sponsor access reaches only the sponsor's mailbox, so an agent with full access gets 403 in another human's and another agent's", async () => {
  const fixture = await withSponsor();
  const { hermes, graceMailbox, giveAccess, iris, irisId, ada } = fixture;
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: irisId, address: "iris@example.com" } });
  await giveAccess("full");

  for (const mailbox of [graceMailbox, irisMailbox!]) {
    const { response, error } = await hermes.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id } } });
    expect(response.status).toBe(403);
    expect(error).toEqual({ message: "Only the mailbox's owner can read it, its sponsor if an agent owns it, and the agents its owner gives sponsor access." });
  }
  expect((await iris.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: fixture.linusMailbox.id } } })).response.status).toBe(403);
});

test("no human reaches another human's mailbox, admins included", async () => {
  const fixture = await withSponsor();
  const { ada, grace, linusMailbox, giveAccess } = fixture;
  await giveAccess("full");

  for (const actor of [ada, grace]) {
    const { response } = await actor.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: linusMailbox.id } } });
    expect(response.status).toBe(403);
    expect((await actor.GET("/mailboxes")).data!.mailboxes.map(({ id }) => id)).not.toContain(linusMailbox.id);
  }
});

test("the sponsor still reads their agent's mailbox, but doesn't write drafts there", async () => {
  const { linus, hermesMailbox } = await withSponsor();
  const params = { path: { mailbox: hermesMailbox.id } };

  const { response: read } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  const { response: drafted, error } = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"] } });

  expect(read.status).toBe(200);
  expect(drafted.status).toBe(403);
  expect(error).toEqual({
    message: "Only the mailbox's owner can write drafts in it and ask to send them. For an agent's mailbox, the agent's sponsor decides its sends in approvals.",
  });
});
