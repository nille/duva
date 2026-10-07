import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

const minutes = (count: number) => count * 60 * 1000;
const hours = (count: number) => minutes(count * 60);

/**
 * A deployment on example.com where ada sponsors the agent Hermes, which owns a mailbox at
 * hermes@example.com and sends from it without approval, unless `approval` is on. Grace is the
 * first admin, and Ken another human. Sessions outlast the hours these tests let pass.
 */
async function withAgent({ approval = false, ...options }: DuvaOptions & { approval?: boolean } = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "grace@example.org", humans: ["ada@example.org", "ken@example.org"], accessTokenLifetime: 7 * 24 * 60 * 60, ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await grace.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const agent = created!.agent;
  const params = { path: { mailbox: mailbox!.id } };
  const settings = { params: { path: { agent: agent.id } } };
  if (!approval) await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { approvalForOwnMailbox: false } });
  const limit = (body: { sendsPerHour?: number; newRecipientsPerDay?: number }, by = ada) => by.PATCH("/agents/{agent}/settings", { ...settings, body });

  /** Drafts a message to the recipients and asks to send it, from the mailbox given, and returns the draft as asked. */
  const send = async (to: string[] | string, mailbox = params) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: mailbox, body: { to: [to].flat(), subject: "Hello", text: "Hej." } });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...mailbox.path, draft: draft!.id } } });
    return asked!;
  };
  /** Where the draft's send stands now. */
  const state = async (draft: string, mailbox = params) => (await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...mailbox.path, draft } } })).data?.send?.state;
  const sendNow = (draft: string, by = ada, mailbox = params) => by.POST("/mailboxes/{mailbox}/drafts/{draft}/send-now", { params: { path: { ...mailbox.path, draft } } });
  const start = Date.now();
  /** Moves the clock to the time after the test started. */
  const after = (time: number) => duva.clock(new Date(start + time));
  return { duva, ada, grace, ken: duva.signIn("ken@example.org"), hermes, agent, params, settings, limit, send, state, sendNow, after };
}

/** Who SES sent each message to, in the order it accepted them. */
const recipients = async (sent: string[]) => Promise.all(sent.map(async (raw) => (await PostalMime.parse(raw)).to?.map(({ address }) => address).join(", ")));

test("an agent starts with send limits of 100 an hour and 50 new recipients a day, and the organization with caps of the same", async () => {
  const { ada, grace, settings } = await withAgent();

  expect((await ada.GET("/agents/{agent}/settings", settings)).data).toMatchObject({ sendsPerHour: 100, newRecipientsPerDay: 50 });
  expect((await grace.GET("/organization/settings")).data).toMatchObject({ agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50 });
});

test("the sponsor sets the agent's limits up to the organization's caps, and above them is refused", async () => {
  const { ada, settings, limit } = await withAgent();

  expect((await limit({ sendsPerHour: 100, newRecipientsPerDay: 10 })).data).toMatchObject({ sendsPerHour: 100, newRecipientsPerDay: 10 });
  const over = await limit({ sendsPerHour: 101 });
  expect(over.response.status).toBe(400);
  expect(over.error?.message).toBe("sendsPerHour can be at most the organization's cap of 100. Ask an admin to raise agentSendsPerHourCap.");
  for (const value of [0, 1.5, "10"]) expect((await limit({ newRecipientsPerDay: value as number })).response.status).toBe(400);
  expect((await ada.GET("/agents/{agent}/settings", settings)).data).toMatchObject({ sendsPerHour: 100, newRecipientsPerDay: 10 });
});

test("only the agent's sponsor sets its limits", async () => {
  const { grace, hermes, limit } = await withAgent();

  expect((await limit({ sendsPerHour: 5 }, grace)).response.status).toBe(403);
  expect((await limit({ sendsPerHour: 5 }, hermes)).response.status).toBe(403);
});

test("an admin raises the caps, and the sponsor can then give the agent more", async () => {
  const { grace, limit } = await withAgent();

  const { data } = await grace.PATCH("/organization/settings", { body: { agentSendsPerHourCap: 500, agentNewRecipientsPerDayCap: 200 } });

  expect(data).toMatchObject({ agentSendsPerHourCap: 500, agentNewRecipientsPerDayCap: 200 });
  expect((await limit({ sendsPerHour: 500, newRecipientsPerDay: 200 })).data).toMatchObject({ sendsPerHour: 500, newRecipientsPerDay: 200 });
});

test("lowering a cap lowers the agents above it, recorded in the sponsor's mailbox's change feed under the admin, and leaves those below it", async () => {
  const { ada, grace, settings, limit } = await withAgent();
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: admin } = await grace.GET("/whoami");
  const { data: own } = await grace.POST("/mailboxes", { body: { owner: sponsor!.id, address: "ada@example.com" } });
  await limit({ newRecipientsPerDay: 5 });
  const { data: other } = await ada.POST("/agents", { body: { name: "Iris" } });
  const { data: before } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: own!.id } } });

  await grace.PATCH("/organization/settings", { body: { agentSendsPerHourCap: 20, agentNewRecipientsPerDayCap: 10 } });

  expect((await ada.GET("/agents/{agent}/settings", settings)).data).toMatchObject({ sendsPerHour: 20, newRecipientsPerDay: 5 });
  expect((await ada.GET("/agents/{agent}/settings", { params: { path: { agent: other!.agent.id } } })).data).toMatchObject({ sendsPerHour: 20, newRecipientsPerDay: 10 });
  const { data: feed } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: own!.id }, query: { after: before!.position } } });
  expect(feed?.changes).toEqual(
    expect.arrayContaining([
      { position: expect.any(Number), at: expect.any(String), actor: admin!.id, type: "agentSettingsChanged", agent: settings.params.path.agent, before: { sendsPerHour: 100 }, after: { sendsPerHour: 20 } },
      { position: expect.any(Number), at: expect.any(String), actor: admin!.id, type: "agentSettingsChanged", agent: other!.agent.id, before: { sendsPerHour: 100, newRecipientsPerDay: 50 }, after: { sendsPerHour: 20, newRecipientsPerDay: 10 } },
    ]),
  );
  expect(feed?.changes).toHaveLength(2);
});

test("a send over the hourly limit waits, and goes out by itself once an hour has passed since the first", async () => {
  const { duva, limit, send, state, after } = await withAgent();
  await limit({ sendsPerHour: 1 });
  await send("first@example.net");

  const second = await send("second@example.net");

  expect(await recipients(duva.sent())).toEqual(["first@example.net"]);
  expect(await state(second.id)).toBe("waitingForLimit");
  await after(minutes(59));
  expect(duva.sent()).toHaveLength(1);
  await after(hours(1) + minutes(1));
  expect(await recipients(duva.sent())).toEqual(["first@example.net", "second@example.net"]);
  expect(await state(second.id)).toBe("sent");
});

test("the agents a sponsor lists say how many sends each has left in the rolling hour", async () => {
  const { ada, grace, limit, send, after } = await withAgent();
  const left = async () => (await ada.GET("/agents")).data?.agents.map(({ name, sendsLeftThisHour }) => [name, sendsLeftThisHour]);
  await limit({ sendsPerHour: 3 });
  expect(await left()).toEqual([["Hermes", 3]]);

  await send("one@example.net");
  await after(minutes(30));
  await send("two@example.net");
  expect(await left()).toEqual([["Hermes", 1]]);
  await send("three@example.net");
  await send("four@example.net");
  // The fourth waits, so none are left.
  expect(await left()).toEqual([["Hermes", 0]]);

  await after(hours(1) + minutes(1));
  // The first left the hour, and the one that waited went out in its place.
  expect(await left()).toEqual([["Hermes", 0]]);
  await after(hours(1) + minutes(31));
  // The second and third left it too, so only the fourth counts.
  expect(await left()).toEqual([["Hermes", 2]]);
  // An admin's list of the organization's agents doesn't say.
  expect((await grace.GET("/organization/agents")).data?.agents.map(({ sendsLeftThisHour }) => sendsLeftThisHour)).toEqual([undefined]);
});

test("sends that wait go out oldest first, as many as the rolling hour allows", async () => {
  const { duva, limit, send, after } = await withAgent();
  await limit({ sendsPerHour: 2 });
  await send("one@example.net");
  await after(minutes(30));
  await send("two@example.net");
  for (const to of ["three@example.net", "four@example.net", "five@example.net"]) await send(to);

  await after(hours(1) + minutes(1));
  expect(await recipients(duva.sent())).toEqual(["one@example.net", "two@example.net", "three@example.net"]);
  await after(hours(1) + minutes(31));
  expect((await recipients(duva.sent())).slice(3)).toEqual(["four@example.net"]);
  await after(hours(2) + minutes(2));
  expect((await recipients(duva.sent())).slice(4)).toEqual(["five@example.net"]);
});

test("after the sponsor lowers the limit, a send waits until enough of those already out have left the hour", async () => {
  const { duva, limit, send, after } = await withAgent();
  await limit({ sendsPerHour: 3 });
  await send("one@example.net");
  await after(minutes(10));
  await send("two@example.net");
  await after(minutes(20));
  await send("three@example.net");
  await limit({ sendsPerHour: 1 });

  await send("four@example.net");

  await after(hours(1) + minutes(11));
  expect(duva.sent()).toHaveLength(3);
  await after(hours(1) + minutes(21));
  expect((await recipients(duva.sent())).slice(3)).toEqual(["four@example.net"]);
});

test("a send approved by the sponsor over the limit waits too", async () => {
  const { duva, ada, limit, send, state, after } = await withAgent({ approval: true });
  await limit({ sendsPerHour: 1 });
  const approve = async (draft: { send?: { approval?: string } }) => ada.POST("/approvals/{approval}/send", { params: { path: { approval: draft.send!.approval! } } });
  await approve(await send("first@example.net"));

  const second = await send("second@example.net");
  await approve(second);

  expect(await state(second.id)).toBe("waitingForLimit");
  await after(hours(1) + minutes(1));
  expect(await recipients(duva.sent())).toEqual(["first@example.net", "second@example.net"]);
});

test("a send to more new recipients than the day has left waits, and one to recipients the agent has sent to before goes out", async () => {
  const { duva, limit, send, state, after } = await withAgent();
  await limit({ newRecipientsPerDay: 2 });
  await send(["one@example.net", "two@example.net"]);
  await send(["One@example.net"]);

  const third = await send(["three@example.net"]);

  expect(await recipients(duva.sent())).toEqual(["one@example.net, two@example.net", "One@example.net"]);
  expect(await state(third.id)).toBe("waitingForLimit");
  await after(hours(23));
  expect(duva.sent()).toHaveLength(2);
  await after(hours(24) + minutes(1));
  expect((await recipients(duva.sent())).slice(2)).toEqual(["three@example.net"]);
});

test("a recipient the agent sent to from its sponsor's mailbox isn't new from its own", async () => {
  const { duva, ada, grace, settings, limit, send, state } = await withAgent();
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: sponsors } = await grace.POST("/mailboxes", { body: { owner: sponsor!.id, address: "ada@example.com" } });
  await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { sponsorAccess: "send", approvalAsSponsor: false } });
  await limit({ newRecipientsPerDay: 1 });
  await send("ken@example.net", { path: { mailbox: sponsors!.id } });

  const again = await send("ken@example.net");
  const another = await send("linus@example.net");

  expect(await state(again.id)).toBe("sent");
  expect(await state(another.id)).toBe("waitingForLimit");
  expect(duva.sent()).toHaveLength(2);
});

test("a send behind others that wait waits too, so they go out in the order they were sent", async () => {
  const { duva, limit, send, state, after } = await withAgent();
  await limit({ newRecipientsPerDay: 1 });
  await send("one@example.net");
  await send("two@example.net");

  const known = await send("one@example.net");

  expect(await state(known.id)).toBe("waitingForLimit");
  await after(hours(24) + minutes(1));
  expect((await recipients(duva.sent())).slice(1)).toEqual(["two@example.net", "one@example.net"]);
});

test("a message to more new recipients than the whole daily limit waits for its sponsor, and doesn't hold up the others", async () => {
  const { duva, limit, send, state, sendNow, after } = await withAgent();
  await limit({ newRecipientsPerDay: 2 });
  const many = await send(["one@example.net", "two@example.net", "three@example.net"]);
  const few = await send(["four@example.net"]);

  expect(await state(few.id)).toBe("sent");
  await after(hours(48));
  expect(await state(many.id)).toBe("waitingForLimit");
  await sendNow(many.id);
  expect(await state(many.id)).toBe("sent");
  expect(duva.sent()).toHaveLength(2);
});

test("the sponsor sends a waiting message now, past the limit, recorded in the mailbox's change feed, and it counts toward the limit", async () => {
  const { duva, ada, limit, send, state, sendNow, params, after } = await withAgent();
  const { data: sponsor } = await ada.GET("/whoami");
  await limit({ sendsPerHour: 1 });
  await send("first@example.net");
  const second = await send("second@example.net");
  const third = await send("third@example.net");
  const { data: before } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  await after(minutes(30));

  const { response, data } = await sendNow(second.id);

  expect(response.status).toBe(202);
  expect(data?.send?.state).toBe("approved");
  expect(await recipients(duva.sent())).toEqual(["first@example.net", "second@example.net"]);
  expect(await state(third.id)).toBe("waitingForLimit");
  const { data: feed } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: before!.position } } });
  expect(feed?.changes).toContainEqual({ position: expect.any(Number), at: expect.any(String), actor: sponsor!.id, type: "sentNow", draft: second.id });
  // The second went out half an hour after the first, so the third waits until an hour after the second.
  await after(hours(1) + minutes(1));
  expect(duva.sent()).toHaveLength(2);
  await after(hours(1) + minutes(31));
  expect((await recipients(duva.sent())).slice(2)).toEqual(["third@example.net"]);
});

test("only the agent's sponsor sends a waiting message now, and only one that waits", async () => {
  const { ken, hermes, grace, limit, send, sendNow } = await withAgent();
  await limit({ sendsPerHour: 1 });
  const first = await send("first@example.net");
  const second = await send("second@example.net");

  for (const by of [hermes, grace, ken]) expect((await sendNow(second.id, by)).response.status).toBe(403);
  const { response, error } = await sendNow(first.id);
  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/isn't waiting for/);
});

test("a send that waits for the limit can't be changed or deleted", async () => {
  const { hermes, params, limit, send } = await withAgent();
  await limit({ sendsPerHour: 1 });
  await send("first@example.net");
  const second = await send("second@example.net");
  const path = { path: { ...params.path, draft: second.id } };

  expect((await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: path, body: { subject: "Changed" } })).response.status).toBe(409);
  expect((await hermes.DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: path })).response.status).toBe(409);
});

test("raising the limit lets the sends that wait go out at once, as far as the new limit allows", async () => {
  const { duva, limit, send } = await withAgent();
  await limit({ sendsPerHour: 1 });
  for (const to of ["one@example.net", "two@example.net", "three@example.net"]) await send(to);

  await limit({ sendsPerHour: 2 });

  expect(await recipients(duva.sent())).toEqual(["one@example.net", "two@example.net"]);
});

test("a paused agent's sends that wait stay waiting until it is unpaused, then go out as the limits allow", async () => {
  const { duva, ada, settings, limit, send, after } = await withAgent();
  await limit({ sendsPerHour: 1 });
  await send("first@example.net");
  await send("second@example.net");
  await ada.POST("/agents/{agent}/pause", settings);

  await after(hours(2));
  expect(duva.sent()).toHaveLength(1);

  await ada.POST("/agents/{agent}/unpause", settings);
  expect(await recipients(duva.sent())).toEqual(["first@example.net", "second@example.net"]);
});

test("humans have no send limits", async () => {
  const { duva, ada, grace } = await withAgent();
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: own } = await grace.POST("/mailboxes", { body: { owner: sponsor!.id, address: "ada@example.com" } });
  await grace.PATCH("/organization/settings", { body: { agentSendsPerHourCap: 1, agentNewRecipientsPerDayCap: 1 } });
  const params = { path: { mailbox: own!.id } };

  for (const to of ["one@example.net", "two@example.net", "three@example.net"]) {
    const { data: draft } = await ada.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: [to], subject: "Hello", text: "Hej." } });
    await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  }

  expect(duva.sent()).toHaveLength(3);
});

test("a send that waits is recorded in the mailbox's change feed under the agent", async () => {
  const { ada, agent, params, limit, send } = await withAgent();
  await limit({ sendsPerHour: 1 });
  await send("first@example.net");
  const { data: before } = await ada.GET("/mailboxes/{mailbox}/changes", { params });

  const second = await send("second@example.net");

  const { data: feed } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: before!.position } } });
  expect(feed?.changes).toContainEqual({ position: expect.any(Number), at: expect.any(String), actor: agent.id, type: "sendWaitingForLimit", draft: second.id });
});
