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

