import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

test("status reports the deployment's version and region", async () => {
  const duva = await startDuva({ version: "2.3.4", region: "eu-west-1" });

  const { data } = await duva.client.GET("/status");

  expect(data).toEqual({ version: "2.3.4", region: "eu-west-1" });
});
