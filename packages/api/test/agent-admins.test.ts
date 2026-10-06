import type { components } from "@duva/openapi";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

type SetupApproval = components["schemas"]["SetupApproval"];

/** The setup approval an agent admin's call was answered with. */
const setupApprovalIn = ({ data }: { data?: unknown }) => data as SetupApproval;

const message = (to: string, subject = "Hello") => `From: linus@example.net\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@example.net>\r\n\r\nHej.\r\n`;

/**
 * A deployment on example.com where the admin Grace sponsors the agent Hermes, which owns a mailbox
 * at hermes@example.com, and Ada, who isn't an admin, sponsors the agent Iris.
 */
async function withAgents() {
  const duva = await startDuva({ domain: "example.com", admin: "grace@example.org", humans: ["ada@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const ada = duva.signIn("ada@example.org");
  const { data: hermesCreated } = await grace.POST("/agents", { body: { name: "Hermes" } });
  const { data: irisCreated } = await ada.POST("/agents", { body: { name: "Iris" } });
  const { data: mailbox } = await grace.POST("/mailboxes", { body: { owner: hermesCreated!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(hermesCreated!.key);
  const agent = hermesCreated!.agent;
  const ids = {
    grace: (await grace.GET("/whoami")).data!.id,
    ada: (await ada.GET("/whoami")).data!.id,
  };
  /** Makes the agent an admin, or takes it away, as `by`. */
  const makeAdmin = (admin = true, by = grace, id = agent.id) => by.PATCH("/agents/{agent}", { params: { path: { agent: id } }, body: { admin } });
  const changes = async (by = grace) => (await by.GET("/organization/changes")).data!.changes;
  return { duva, grace, ada, hermes, agent, iris: irisCreated!.agent, irisKey: irisCreated!.key, mailbox: mailbox!, ids, makeAdmin, changes };
}

test("an admin makes the agent they sponsor an admin, recorded under them", async () => {
  const { hermes, agent, ids, makeAdmin, changes } = await withAgents();

  const { response, data } = await makeAdmin();

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...agent, admin: true });
  expect((await hermes.GET("/whoami")).data).toEqual({ ...agent, admin: true });
  expect((await changes()).at(-1)).toEqual({ position: expect.any(Number), at: expect.any(String), actor: ids.grace, type: "agentAdminChanged", agent: agent.id, admin: true });
});

test("a sponsor who isn't an admin can't make their agent an admin", async () => {
  const { ada, iris, makeAdmin } = await withAgents();

  const { response, error } = await makeAdmin(true, ada, iris.id);

  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/aren't one/);
  expect((await ada.GET("/agents")).data?.agents).toEqual([iris]);
});

test("an admin can't make an agent they don't sponsor an admin", async () => {
  const { grace, ada, iris, ids, makeAdmin } = await withAgents();
  await grace.PATCH("/humans/{human}", { params: { path: { human: ids.ada } }, body: { admin: true } });

  const { response } = await makeAdmin(true, grace, iris.id);

  expect(response.status).toBe(403);
  expect((await ada.GET("/agents")).data?.agents).toEqual([iris]);
});

test("no agent changes who is an admin, an agent admin included", async () => {
  const { hermes, agent, ids, makeAdmin } = await withAgents();
  await makeAdmin();

  expect((await makeAdmin(false, hermes)).response.status).toBe(403);
  const { response, error } = await hermes.PATCH("/humans/{human}", { params: { path: { human: ids.grace } }, body: { admin: false } });
  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/Agents can't/);
  expect((await hermes.GET("/whoami")).data).toEqual({ ...agent, admin: true });
});

test("an agent admin can't remove a human, not even with approval", async () => {
  const { ada, hermes, ids, makeAdmin } = await withAgents();
  await makeAdmin();

  for (const body of [{ delete: [] }, { dryRun: true }]) {
    const { response, error } = await hermes.POST("/humans/{human}/remove", { params: { path: { human: ids.ada } }, body });
    expect(response.status).toBe(403);
    expect(error?.message).toMatch(/Agents can't remove humans/);
  }
  expect((await ada.GET("/whoami")).response.status).toBe(200);
});

test("the sponsor takes an agent's admin away", async () => {
  const { hermes, agent, ids, makeAdmin, changes } = await withAgents();
  await makeAdmin();

  const { response, data } = await makeAdmin(false);

  expect(response.status).toBe(200);
  expect(data).toEqual(agent);
  expect((await hermes.GET("/whoami")).data).toEqual(agent);
  expect((await changes()).at(-1)).toMatchObject({ actor: ids.grace, type: "agentAdminChanged", agent: agent.id, admin: false });
});

test("an agent stops being an admin when its sponsor does, recorded under whoever took the sponsor's away", async () => {
  const { grace, ada, hermes, agent, ids, makeAdmin, changes } = await withAgents();
  await makeAdmin();
  const changeAdmin = (human: string, admin: boolean, by = grace) => by.PATCH("/humans/{human}", { params: { path: { human } }, body: { admin } });
  // Ada becomes an admin, so Grace isn't the last one, and takes Grace's away.
  await changeAdmin(ids.ada, true);

  expect((await changeAdmin(ids.grace, false, ada)).response.status).toBe(200);

  expect((await hermes.GET("/whoami")).data).toEqual(agent);
  expect((await changes(ada)).slice(-2)).toMatchObject([
    { actor: ids.ada, type: "adminChanged", human: ids.grace, admin: false },
    { actor: ids.ada, type: "agentAdminChanged", agent: agent.id, admin: false },
  ]);
  expect((await makeAdmin()).response.status).toBe(403);
});

test("an agent admin's new address waits for its sponsor's approval, with a preview of what it does", async () => {
  const { grace, hermes, agent, mailbox, ids, makeAdmin, changes } = await withAgents();
  await makeAdmin();

  const asked = await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } });

  expect(asked.response.status).toBe(202);
  const approval = {
    id: expect.any(String),
    state: "pending",
    agent: agent.id,
    approver: ids.grace,
    operation: { operationId: "addAddress", body: { address: "sales@example.com", mailbox: mailbox.id } },
    preview: ["Gives Hermes's mailbox at hermes@example.com the address sales@example.com."],
    askedAt: expect.any(String),
  };
  expect(asked.data).toEqual(approval);
  expect((await grace.GET("/addresses")).data?.addresses.map(({ address }) => address)).toEqual(["hermes@example.com"]);
  expect((await grace.GET("/approvals")).data).toEqual({ approvals: [], setupApprovals: [approval] });
  expect((await changes()).at(-1)).toEqual({ position: expect.any(Number), at: expect.any(String), actor: agent.id, type: "setupAsked", approval: setupApprovalIn(asked).id, operation: approval.operation, preview: approval.preview });
});

test("the sponsor approves an agent admin's setup change, which is made as the agent, and both are recorded", async () => {
  const { duva, grace, hermes, agent, mailbox, ids, makeAdmin, changes } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));

  const { response, data } = await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...asked, state: "approved", decidedAt: expect.any(String), result: { status: 201, body: { address: "sales@example.com", mailbox: mailbox.id } } });
  expect((await grace.GET("/addresses")).data?.addresses.map(({ address }) => address)).toEqual(["hermes@example.com", "sales@example.com"]);
  expect((await duva.receive(message("sales@example.com"), { to: ["sales@example.com"] })).refused).toEqual([]);
  expect((await changes()).slice(-2)).toMatchObject([
    { actor: ids.grace, type: "setupApproved", approval: asked.id, agent: agent.id },
    { actor: agent.id, type: "addressAdded", address: "sales@example.com", mailbox: mailbox.id },
  ]);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
  expect((await hermes.GET("/setup-approvals/{approval}", { params: { path: { approval: asked.id } } })).data).toEqual(data);
});

test("with approval of its setup changes off, an agent admin's change is made at once, under the agent", async () => {
  const { grace, hermes, agent, mailbox, makeAdmin, changes } = await withAgents();
  await makeAdmin();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { approvalForSetup: false } });

  const { response, data } = await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } });

  expect(response.status).toBe(201);
  expect(data).toEqual({ address: "sales@example.com", mailbox: mailbox.id });
  expect((await changes()).at(-1)).toMatchObject({ actor: agent.id, type: "addressAdded", address: "sales@example.com" });
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
});

test("the sponsor rejects an agent admin's setup change with a note, and nothing changes", async () => {
  const { grace, hermes, agent, mailbox, ids, makeAdmin, changes } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));

  const { response, data } = await grace.POST("/setup-approvals/{approval}/reject", { params: { path: { approval: asked.id } }, body: { note: "Use support@ instead." } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...asked, state: "rejected", decidedAt: expect.any(String), note: "Use support@ instead." });
  expect((await hermes.GET("/setup-approvals/{approval}", { params: { path: { approval: asked.id } } })).data).toEqual(data);
  expect((await grace.GET("/addresses")).data?.addresses.map(({ address }) => address)).toEqual(["hermes@example.com"]);
  expect((await changes()).at(-1)).toMatchObject({ actor: ids.grace, type: "setupRejected", approval: asked.id, agent: agent.id, note: "Use support@ instead." });
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
  const again = await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });
  expect(again.response.status).toBe(409);
});

test("only the agent's sponsor decides its setup changes, not another admin or the agent", async () => {
  const { duva, grace, ada, hermes, mailbox, ids, makeAdmin } = await withAgents();
  await makeAdmin();
  await grace.PATCH("/humans/{human}", { params: { path: { human: ids.ada } }, body: { admin: true } });
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));
  const approval = { params: { path: { approval: asked.id } } };

  for (const actor of [ada, hermes]) {
    expect((await actor.POST("/setup-approvals/{approval}/approve", approval)).response.status).toBe(403);
    expect((await actor.POST("/setup-approvals/{approval}/reject", { ...approval, body: { note: "No." } })).response.status).toBe(403);
  }
  expect((await ada.GET("/setup-approvals/{approval}", approval)).response.status).toBe(403);
  expect((await ada.GET("/approvals")).data?.setupApprovals).toEqual([]);
  expect((await duva.receive(message("sales@example.com"), { to: ["sales@example.com"] })).refused).toEqual(["sales@example.com"]);
});

test("a setup approval that doesn't exist answers 404", async () => {
  const { grace } = await withAgents();

  const { response } = await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: "nothing" } } });

  expect(response.status).toBe(404);
});

test("a rejection needs a note", async () => {
  const { grace, hermes, mailbox, makeAdmin } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));

  const { response } = await grace.POST("/setup-approvals/{approval}/reject", { params: { path: { approval: asked.id } }, body: { note: " " } });

  expect(response.status).toBe(400);
});

test("a paused agent's setup changes wait, and can't be approved until it is unpaused", async () => {
  const { grace, hermes, agent, mailbox, makeAdmin } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));
  const agentParams = { params: { path: { agent: agent.id } } };
  await grace.POST("/agents/{agent}/pause", agentParams);
  const approve = () => grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });

  const { response, error } = await approve();
  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/paused/);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toMatchObject([{ id: asked.id, state: "pending" }]);

  await grace.POST("/agents/{agent}/unpause", agentParams);
  expect((await approve()).response.status).toBe(200);
});

test("an agent admin's setup changes still waiting are withdrawn when it stops being an admin", async () => {
  const { grace, hermes, agent, mailbox, ids, makeAdmin, changes } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));

  await makeAdmin(false);

  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
  expect((await hermes.GET("/setup-approvals/{approval}", { params: { path: { approval: asked.id } } })).data).toEqual({ ...asked, state: "withdrawn", decidedAt: expect.any(String) });
  expect((await changes()).slice(-2)).toMatchObject([
    { actor: ids.grace, type: "agentAdminChanged", agent: agent.id, admin: false },
    { actor: ids.grace, type: "setupWithdrawn", approval: asked.id, agent: agent.id },
  ]);
  expect((await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } })).response.status).toBe(409);
});

test("an agent admin's setup changes still waiting are withdrawn when it is removed", async () => {
  const { grace, hermes, agent, mailbox, makeAdmin } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));

  await grace.DELETE("/agents/{agent}", { params: { path: { agent: agent.id } } });

  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
  expect((await grace.GET("/setup-approvals/{approval}", { params: { path: { approval: asked.id } } })).data?.state).toBe("withdrawn");
});

test("if the setup changed what the change would do, approving it is refused until the sponsor reads the new preview", async () => {
  const { grace, hermes, mailbox, makeAdmin } = await withAgents();
  await makeAdmin();
  await grace.POST("/addresses", { body: { address: "support@example.com", mailbox: mailbox.id } });
  const asked = setupApprovalIn(await hermes.DELETE("/addresses/{address}", { params: { path: { address: "hermes@example.com" } } }));
  expect(asked.preview).toEqual([
    "Removes the address hermes@example.com from Hermes's mailbox at hermes@example.com. Mail to it is refused from then on.",
    "The mailbox's default address becomes support@example.com.",
  ]);
  await grace.DELETE("/addresses/{address}", { params: { path: { address: "support@example.com" } } });
  const approve = () => grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });

  const { response, error } = await approve();

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/preview/);
  const preview = ["Removes the address hermes@example.com from Hermes's mailbox at hermes@example.com. Mail to it is refused from then on.", "The mailbox is left with no address, so it receives and sends no new mail."];
  expect((await grace.GET("/approvals")).data?.setupApprovals).toMatchObject([{ id: asked.id, state: "pending", preview }]);
  expect((await approve()).data).toMatchObject({ state: "approved", preview, result: { status: 200 } });
  expect((await grace.GET("/addresses")).data?.addresses).toEqual([]);
});

test("a setup change that can't be made any more is refused when approved, and keeps waiting for the sponsor to reject it", async () => {
  const { grace, hermes, mailbox, makeAdmin } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } }));
  await grace.POST("/groups", { body: { address: "sales@example.com", members: [] } });

  const { response, error } = await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/sales@example\.com is taken/);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toMatchObject([{ id: asked.id, state: "pending" }]);
});

test("an agent admin's call that Duva would refuse is refused at once, without waiting for approval", async () => {
  const { grace, hermes, mailbox, makeAdmin } = await withAgents();
  await makeAdmin();

  const { response } = await hermes.POST("/addresses", { body: { address: "sales+news@example.com", mailbox: mailbox.id } });

  expect(response.status).toBe(400);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
});

test("an agent admin's change that would change nothing needs no approval", async () => {
  const { grace, hermes, makeAdmin } = await withAgents();
  await makeAdmin();

  const { response, data } = await hermes.PATCH("/organization/settings", { body: { retentionDays: 30 } });

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ retentionDays: 30 });
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
});

test("an agent admin reads the organization's setup without approval", async () => {
  const { hermes, makeAdmin } = await withAgents();
  await makeAdmin();

  for (const call of [hermes.GET("/humans"), hermes.GET("/domains"), hermes.GET("/addresses"), hermes.GET("/groups"), hermes.GET("/organization/changes")]) {
    expect((await call).response.status).toBe(200);
  }
});

test("an agent that isn't an admin can't change the setup, nor ask to", async () => {
  const { grace, hermes, mailbox } = await withAgents();

  const { response } = await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } });

  expect(response.status).toBe(403);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
});

test("an agent admin pauses another sponsor's agent once its own sponsor approves, and the pause names it", async () => {
  const { duva, grace, hermes, iris, irisKey, makeAdmin } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/agents/{agent}/pause", { params: { path: { agent: iris.id } } }));
  expect(asked.preview).toEqual(["Pauses the agent Iris, whose sponsor is ada@example.org. Its key is refused and its approved sends are held until a human unpauses it."]);
  expect((await duva.withKey(irisKey).GET("/whoami")).response.status).toBe(200);

  await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });

  const { response, error } = await duva.withKey(irisKey).GET("/whoami");
  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/^This agent is paused by Hermes\./);
});

test("an agent admin adds a human once its sponsor approves", async () => {
  const { grace, hermes, makeAdmin } = await withAgents();
  await makeAdmin();
  const asked = setupApprovalIn(await hermes.POST("/humans", { body: { email: "ken@example.org" } }));
  expect(asked.preview).toEqual(["Adds the human ken@example.org, who can then sign in."]);

  const { data } = await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });

  expect(data?.result).toMatchObject({ status: 201, body: { email: "ken@example.org", admin: false } });
  expect((await grace.GET("/humans")).data?.humans.map(({ email }) => email)).toContain("ken@example.org");
});

test("each setup change an agent admin asks for shows what it would do, and changes nothing until approved", async () => {
  const { grace, hermes, iris, mailbox, ids, makeAdmin } = await withAgents();
  await makeAdmin();
  await grace.POST("/domains", { body: { domain: "example.net" } });
  await grace.POST("/domains", { body: { domain: "example.nu", aliasOf: "example.net" } });
  await grace.POST("/addresses", { body: { address: "office@example.net", mailbox: mailbox.id } });
  await grace.POST("/groups", { body: { address: "team@example.com", members: ["hermes@example.com", "linus@example.org"] } });
  await grace.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } }, body: { group: "team@example.com" } });
  const before = async () => ({
    addresses: (await grace.GET("/addresses")).data,
    groups: (await grace.GET("/groups")).data,
    domains: (await grace.GET("/domains")).data,
    settings: (await grace.GET("/organization/settings")).data,
    humans: (await grace.GET("/humans")).data,
  });
  const setup = await before();
  const hermesMailbox = "Hermes's mailbox at hermes@example.com";

  const asked: [Promise<{ data?: unknown }>, string[]][] = [
    [hermes.POST("/mailboxes", { body: { owner: ids.ada, address: "ada@example.com" } }), ["Creates a mailbox at ada@example.com for ada@example.org, with its Screener on."]],
    [hermes.POST("/mailboxes", { body: { owner: iris.id, address: "iris@example.com" } }), ["Creates a mailbox at iris@example.com for the agent Iris, with its Screener off."]],
    [hermes.PATCH("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox.id } }, body: { defaultAddress: "office@example.net" } }), [`Makes office@example.net the default address of ${hermesMailbox}, which new mail goes out from.`]],
    [
      hermes.DELETE("/addresses/{address}", { params: { path: { address: "hermes@example.com" } } }),
      [
        `Removes the address hermes@example.com from ${hermesMailbox}. Mail to it goes to example.com's catch-all from then on.`,
        "The mailbox's default address becomes office@example.net.",
        "It stops being a member of the group team@example.com.",
      ],
    ],
    [
      hermes.POST("/groups", { body: { address: "sales@example.com", members: ["hermes@example.com"], sendPolicy: "members", replyTo: "group" } }),
      ["Creates the group sales@example.com, with the members hermes@example.com.", "Only its members may send to it.", "Its external members' replies go to the group."],
    ],
    [
      hermes.PATCH("/groups/{group}", { params: { path: { group: "team@example.com" } }, body: { members: ["linus@example.org", "office@example.net"], sendPolicy: "organization" } }),
      [
        "Adds office@example.net to the members of the group team@example.com.",
        "Takes hermes@example.com out of the members of the group team@example.com.",
        "Lets only the organization's addresses send to the group team@example.com, instead of anyone.",
      ],
    ],
    [
      hermes.DELETE("/groups/{group}", { params: { path: { group: "team@example.com" } } }),
      [
        "Deletes the group team@example.com, whose members are hermes@example.com and linus@example.org. Mail to it is refused from then on.",
        "It stops being the catch-all of example.com, which then refuses mail to unknown addresses.",
      ],
    ],
    [hermes.POST("/domains", { body: { domain: "example.se" } }), ["Adds the standalone domain example.se, whose addresses are its own.", "It gets an SES identity, and sends and receives mail once its DNS records are in place."]],
    [
      hermes.POST("/domains", { body: { domain: "example.org.uk", aliasOf: "example.com" } }),
      ["Adds example.org.uk as an alias domain of example.com, so every address on example.com, 2 now, also gets mail at example.org.uk.", "It gets an SES identity, and sends and receives mail once its DNS records are in place."],
    ],
    [
      hermes.POST("/domains/{domain}/remove", { params: { path: { domain: "example.net" } }, body: {} }),
      [
        "Removes the domain example.net, and its alias domain example.nu, so nothing sends from them and mail to them is refused. Mail already received stays.",
        "Removes the address office@example.net.",
      ],
    ],
    [
      hermes.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.net" } }, body: { mailbox: mailbox.id } }),
      [`Makes ${hermesMailbox} the catch-all of example.net, so mail to unknown addresses there, and on its alias domains, goes to it instead of being refused.`],
    ],
    [
      hermes.PUT("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } }, body: { mailbox: mailbox.id } }),
      [`Makes ${hermesMailbox} the catch-all of example.com, so mail to unknown addresses there, and on its alias domains, goes to it, instead of to the group team@example.com.`],
    ],
    [hermes.DELETE("/domains/{domain}/catch-all", { params: { path: { domain: "example.com" } } }), ["Clears example.com's catch-all, the group team@example.com, so mail to unknown addresses there is refused."]],
    [
      hermes.PATCH("/organization/settings", { body: { retentionDays: 14, erasureErasesApprovals: true, searchLanguages: ["Swedish", "English", "Danish"] } }),
      [
        "Keeps threads in Trash and Spam 14 days, instead of 30.",
        "Erasing a thread also erases the approval records of the agents' sends in it.",
        "Searches mail in English, Swedish and Danish, instead of English and Swedish, which rebuilds every mailbox's search index.",
      ],
    ],
  ];

  for (const [call, preview] of asked) {
    const answer = await call;
    expect(setupApprovalIn(answer)).toMatchObject({ state: "pending", preview });
  }
  expect(await before()).toEqual(setup);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toHaveLength(asked.length);
});

test("an agent admin can't remove an agent, not even with approval", async () => {
  const { ada, grace, hermes, agent, iris, makeAdmin } = await withAgents();
  await makeAdmin();

  for (const removed of [iris, agent]) {
    const { response, error } = await hermes.DELETE("/agents/{agent}", { params: { path: { agent: removed.id } } });
    expect(response.status).toBe(403);
    expect(error?.message).toMatch(/Agents can't remove agents/);
  }
  expect((await ada.GET("/agents")).data?.agents).toEqual([iris]);
  expect((await grace.GET("/agents")).data?.agents).toEqual([{ ...agent, admin: true }]);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
});

test("an agent admin can't pause itself", async () => {
  const { grace, hermes, agent, makeAdmin } = await withAgents();
  await makeAdmin();

  expect((await hermes.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } })).response.status).toBe(403);
  expect((await grace.GET("/approvals")).data?.setupApprovals).toEqual([]);
});

test("an agent admin goes with its sponsor's removal, and its setup changes still waiting are withdrawn", async () => {
  const { grace, ada, hermes, mailbox, ids, makeAdmin } = await withAgents();
  await makeAdmin();
  await grace.PATCH("/humans/{human}", { params: { path: { human: ids.ada } }, body: { admin: true } });
  await hermes.POST("/addresses", { body: { address: "sales@example.com", mailbox: mailbox.id } });

  await ada.POST("/humans/{human}/remove", { params: { path: { human: ids.grace } }, body: {} });

  expect((await hermes.GET("/whoami")).response.status).toBe(401);
  expect((await ada.GET("/organization/changes")).data!.changes.map(({ type }) => type)).toContain("setupWithdrawn");
});

test("an agent admin's lowering of an organization cap waits for approval, naming the agents it lowers, and then lowers them", async () => {
  const { grace, ada, hermes, agent, iris, makeAdmin } = await withAgents();
  await makeAdmin();
  await grace.POST("/mailboxes", { body: { owner: iris.id, address: "iris@example.com" } });
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sendsPerHour: 10 } });

  const asked = setupApprovalIn(await hermes.PATCH("/organization/settings", { body: { agentSendsPerHourCap: 20 } }));

  expect(asked.preview).toEqual(["Caps each agent's sends an hour at 20, instead of 100.", "It lowers the sends an hour of Iris to 20."]);
  expect((await grace.GET("/organization/settings")).data?.agentSendsPerHourCap).toBe(100);
  const { data } = await grace.POST("/setup-approvals/{approval}/approve", { params: { path: { approval: asked.id } } });
  expect(data?.result).toMatchObject({ status: 200, body: { agentSendsPerHourCap: 20 } });
  expect((await ada.GET("/agents/{agent}/settings", { params: { path: { agent: iris.id } } })).data?.sendsPerHour).toBe(20);
  expect((await grace.GET("/agents/{agent}/settings", { params: { path: { agent: agent.id } } })).data?.sendsPerHour).toBe(10);
});
