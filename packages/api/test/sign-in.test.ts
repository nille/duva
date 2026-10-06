import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

test("a call without credentials is refused", async () => {
  const duva = await startDuva();

  const { response } = await duva.client.GET("/whoami");

  expect(response.status).toBe(401);
});

test("a call with a token from an issuer the deployment doesn't trust is refused", async () => {
  const duva = await startDuva({ admin: "ada@example.com" });
  const elsewhere = await startDuva({ admin: "ada@example.com" });

  const { response } = await duva.client.GET("/whoami", {
    headers: { authorization: `Bearer ${elsewhere.accessToken("ada@example.com")}` },
  });

  expect(response.status).toBe(401);
});

test("whoami names the signed-in admin", async () => {
  const duva = await startDuva({ admin: "ada@example.com" });

  const { data } = await duva.signIn("ada@example.com").GET("/whoami");

  expect(data).toEqual({ id: expect.any(String), kind: "human", email: "ada@example.com", admin: true });
});


test("when Duva moves to a new user pool, setup moves every human, who signs in again as the same actor with the same mailboxes", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const { data: grace } = await duva.signIn("grace@example.org").GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  const { data: adaBefore } = await ada.GET("/whoami");

  duva.replaceUserPool();
  const refused = await ada.GET("/whoami");
  await duva.setUp({ admin: "ada@example.org" });

  expect(refused.response.status).toBe(401);
  expect((await duva.signIn("ada@example.org").GET("/whoami")).data).toEqual(adaBefore);
  expect((await duva.signIn("grace@example.org").GET("/whoami")).data).toEqual(grace);
  expect((await duva.signIn("grace@example.org").GET("/mailboxes")).data).toEqual({ mailboxes: [{ ...mailbox, groups: [] }] });
});

test("setup is safe to re-run after it moved the humans", async () => {
  const duva = await startDuva({ admin: "ada@example.org", humans: ["grace@example.org"] });
  const { data: before } = await duva.signIn("grace@example.org").GET("/whoami");
  duva.replaceUserPool();

  await duva.setUp({ admin: "ada@example.org" });
  await duva.setUp({ admin: "ada@example.org" });

  expect((await duva.signIn("grace@example.org").GET("/whoami")).data).toEqual(before);
});

test("a human an admin adds after the move signs in to the new user pool", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  duva.replaceUserPool();
  await duva.setUp({ admin: "ada@example.org" });

  const { data: grace } = await duva.signIn("ada@example.org").POST("/humans", { body: { email: "grace@example.org" } });

  expect((await duva.signIn("grace@example.org").GET("/whoami")).data).toEqual(grace);
});
