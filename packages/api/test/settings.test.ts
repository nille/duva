import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A deployment where Ada is the first admin, Grace another human, and Ada sponsors the agent Hermes. */
async function withOrganization() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(created!.key);
  const { data: me } = await ada.GET("/whoami");
  return { duva, ada, adaId: me!.id, grace, hermes };
}

test("erasure keeps approval records unless an admin chooses otherwise, and every actor can read that", async () => {
  const { ada, grace, hermes } = await withOrganization();

  for (const actor of [ada, grace, hermes]) {
    const { response, data } = await actor.GET("/organization/settings");
    expect(response.status).toBe(200);
    expect(data).toEqual({ erasureErasesApprovals: false });
  }
});

test("an admin turns on erasure of approval records, which is a setup change in the organization's change feed under them", async () => {
  const { ada, adaId, grace } = await withOrganization();

  const { response, data } = await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ erasureErasesApprovals: true });
  expect((await grace.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: true });
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes!.changes.at(-1)).toEqual({ position: expect.any(Number), at: expect.any(String), actor: adaId, type: "settingsChanged", settings: { erasureErasesApprovals: true } });
});

test("an admin turns erasure of approval records off again", async () => {
  const { ada } = await withOrganization();
  await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });

  const { data } = await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: false } });

  expect(data).toEqual({ erasureErasesApprovals: false });
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes!.changes.filter(({ type }) => type === "settingsChanged").map((change) => "settings" in change && change.settings)).toEqual([
    { erasureErasesApprovals: true },
    { erasureErasesApprovals: false },
  ]);
});

test("giving a setting the value it has records no change", async () => {
  const { ada } = await withOrganization();
  const { data: before } = await ada.GET("/organization/changes");

  const { response, data } = await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: false } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ erasureErasesApprovals: false });
  expect((await ada.GET("/organization/changes")).data).toEqual(before);
});

test("a human who isn't an admin, and an agent, get 403 changing the settings, and they stay as they were", async () => {
  const { grace, hermes } = await withOrganization();

  for (const actor of [grace, hermes]) {
    const { response, error } = await actor.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });
    expect(response.status).toBe(403);
    expect(error).toEqual({ message: "Only admins can change the organization's settings. Ask an admin to change them." });
  }
  expect((await grace.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false });
});

test.each([
  ["no setting", {}],
  ["a setting that isn't on or off", { erasureErasesApprovals: "yes" }],
  ["a setting the organization doesn't have", { retentionDays: 7 }],
])("changing the settings with %s gets 400", async (_, body) => {
  const { ada } = await withOrganization();

  const { response } = await ada.PATCH("/organization/settings", { body: body as never });

  expect(response.status).toBe(400);
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false });
});
