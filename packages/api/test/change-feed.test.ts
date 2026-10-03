import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

test("the change feed lists the setup deploy did, each change attributed to the first admin", async () => {
  const duva = await startDuva({ domain: "duva.example.com", admin: "ada@example.com" });
  const ada = duva.signIn("ada@example.com");
  const { data: admin } = await ada.GET("/whoami");

  const { data } = await ada.GET("/organization/changes");

  expect(data).toEqual({
    changes: [
      { position: 1, at: expect.any(String), actor: admin?.id, type: "organizationAdded" },
      { position: 2, at: expect.any(String), actor: admin?.id, type: "domainAdded", domain: "duva.example.com" },
      { position: 3, at: expect.any(String), actor: admin?.id, type: "actorAdded", added: admin },
    ],
    position: 3,
  });
});

test("the change feed lists the changes after a position", async () => {
  const duva = await startDuva();
  const ada = duva.signIn("ada@example.com");

  const { data: rest } = await ada.GET("/organization/changes", { params: { query: { after: 1 } } });
  const { data: none } = await ada.GET("/organization/changes", { params: { query: { after: 3 } } });

  expect(rest?.changes.map(({ position }) => position)).toEqual([2, 3]);
  expect(none).toEqual({ changes: [], position: 3 });
});

test("the change feed refuses a position that isn't one", async () => {
  const duva = await startDuva();

  const { response, error } = await duva.signIn("ada@example.com").GET("/organization/changes", {
    params: { query: { after: "first" as unknown as number } },
  });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/isn't a position/);
});

test("setting up again with the same admin changes nothing", async () => {
  const duva = await startDuva({ admin: "ada@example.com" });
  const ada = duva.signIn("ada@example.com");
  const { data: before } = await ada.GET("/organization/changes");

  await duva.setUp({ admin: "ada@example.com" });

  const { data: after } = await ada.GET("/organization/changes");
  expect(after).toEqual(before);
});
