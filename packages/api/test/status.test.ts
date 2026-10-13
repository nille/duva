import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

test("status reports the deployment's version, its region and the web app's URL", async () => {
  const duva = await startDuva({ version: "2.3.4", region: "eu-west-1" });

  const { data } = await duva.client.GET("/status");

  expect(data).toEqual({ version: "2.3.4", region: "eu-west-1", webSearchRegion: "eu-west-1", webUrl: expect.stringMatching(/^https?:\/\//) });
});

test("once the web app moves to its host, status gives it there", async () => {
  const duva = await startDuva();

  duva.moveWebApp("duva.example.com");
  const { data } = await duva.client.GET("/status");

  expect(data?.webUrl).toBe("https://duva.example.com");
});
