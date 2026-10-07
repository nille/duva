import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A deployment where Ada is the first admin, Grace another human, and Ada sponsors the agent Hermes. */
async function withOrganization() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], undoWindow: null });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(created!.key);
  const { data: me } = await ada.GET("/whoami");
  return { duva, ada, adaId: me!.id, grace, hermes };
}

test("erasure keeps approval records and Trash and Spam keep mail 30 days unless an admin chooses otherwise, and every actor can read that", async () => {
  const { ada, grace, hermes } = await withOrganization();

  for (const actor of [ada, grace, hermes]) {
    const { response, data } = await actor.GET("/organization/settings");
    expect(response.status).toBe(200);
    expect(data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  }
});

test("an admin turns on erasure of approval records, which is a setup change in the organization's change feed under them", async () => {
  const { ada, adaId, grace } = await withOrganization();

  const { response, data } = await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ erasureErasesApprovals: true, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  expect((await grace.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: true, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes!.changes.at(-1)).toEqual({ position: expect.any(Number), at: expect.any(String), actor: adaId, type: "settingsChanged", settings: { erasureErasesApprovals: true } });
});

test("an admin turns erasure of approval records off again", async () => {
  const { ada } = await withOrganization();
  await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });

  const { data } = await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: false } });

  expect(data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes!.changes.filter(({ type }) => type === "settingsChanged").map((change) => "settings" in change && change.settings)).toEqual([
    { erasureErasesApprovals: true },
    { erasureErasesApprovals: false },
  ]);
});

test("an admin adds Danish to the search languages, which is a setup change in the organization's change feed under them, and leaves the other setting as it was", async () => {
  const { ada, adaId } = await withOrganization();

  const { data } = await ada.PATCH("/organization/settings", { body: { searchLanguages: ["Danish", "English", "Swedish"] } });

  expect(data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish", "Danish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes!.changes.at(-1)).toEqual({ position: expect.any(Number), at: expect.any(String), actor: adaId, type: "settingsChanged", settings: { searchLanguages: ["English", "Swedish", "Danish"] } });
});

test("giving the search languages in another order records no change", async () => {
  const { ada } = await withOrganization();
  const { data: before } = await ada.GET("/organization/changes");

  const { data } = await ada.PATCH("/organization/settings", { body: { searchLanguages: ["Swedish", "English"] } });

  expect(data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  expect((await ada.GET("/organization/changes")).data).toEqual(before);
});

test("giving a setting the value it has records no change", async () => {
  const { ada } = await withOrganization();
  const { data: before } = await ada.GET("/organization/changes");

  const { response, data } = await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"] } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  expect((await ada.GET("/organization/changes")).data).toEqual(before);
});

test("a human who isn't an admin, and an agent, get 403 changing the settings, and they stay as they were", async () => {
  const { grace, hermes } = await withOrganization();

  for (const actor of [grace, hermes]) {
    const { response, error } = await actor.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });
    expect(response.status).toBe(403);
    expect(error).toEqual({ message: "Only admins can change the organization's settings. Ask an admin to change them." });
  }
  expect((await grace.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
});

test.each([
  ["no setting", {}],
  ["a setting that isn't on or off", { erasureErasesApprovals: "yes" }],
  ["a setting the organization doesn't have", { trashDays: 7 }],
  ["a retention period under 7 days", { retentionDays: 6 }],
  ["a retention period over 365 days", { retentionDays: 366 }],
  ["a retention period that isn't whole days", { retentionDays: 7.5 }],
  ["a retention period that isn't a number", { retentionDays: "30" }],
  ["search languages that aren't a list", { searchLanguages: "English" }],
  ["a search language Duva doesn't know", { searchLanguages: ["English", "Klingon"] }],
  ["a search language twice", { searchLanguages: ["English", "English"] }],
])("changing the settings with %s gets 400", async (_, body) => {
  const { ada } = await withOrganization();

  const { response } = await ada.PATCH("/organization/settings", { body: body as never });

  expect(response.status).toBe(400);
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
});

test("an admin sets how long Trash and Spam keep mail, from 7 to 365 days, which is a setup change in the organization's change feed under them", async () => {
  const { ada, adaId, grace } = await withOrganization();

  const shortest = await ada.PATCH("/organization/settings", { body: { retentionDays: 7 } });
  const longest = await ada.PATCH("/organization/settings", { body: { retentionDays: 365 } });

  expect(shortest.data).toEqual({ erasureErasesApprovals: false, retentionDays: 7, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  expect(longest.data).toEqual({ erasureErasesApprovals: false, retentionDays: 365, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  expect((await grace.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false, retentionDays: 365, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes!.changes.filter(({ type }) => type === "settingsChanged")).toEqual([
    { position: expect.any(Number), at: expect.any(String), actor: adaId, type: "settingsChanged", settings: { retentionDays: 7 } },
    { position: expect.any(Number), at: expect.any(String), actor: adaId, type: "settingsChanged", settings: { retentionDays: 365 } },
  ]);
});

test("changing the retention period with a value it doesn't take says which it takes", async () => {
  const { ada } = await withOrganization();

  const { response, error } = await ada.PATCH("/organization/settings", { body: { retentionDays: 400 } });

  expect(response.status).toBe(400);
  expect(error).toEqual({ message: "Give retentionDays as a whole number of days from 7 to 365." });
});

test("a human who isn't an admin, and an agent, get 403 changing the retention period", async () => {
  const { grace, hermes } = await withOrganization();

  for (const actor of [grace, hermes]) {
    const { response } = await actor.PATCH("/organization/settings", { body: { retentionDays: 7 } });
    expect(response.status).toBe(403);
  }
  expect((await grace.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 30 });
});
