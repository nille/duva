import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A deployment where Ada is the first admin, Grace another human, and Ada sponsors the agent Hermes. */
async function withOrganization() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(created!.key);
  return { duva, ada, grace, hermes };
}

test("a human's times and dates follow their browser's language until they choose otherwise", async () => {
  const { ada } = await withOrganization();

  const { response, data } = await ada.GET("/preferences");

  expect(response.status).toBe(200);
  expect(data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("a human chooses 24-hour time and ISO dates, and reads them back", async () => {
  const { ada } = await withOrganization();

  const { response, data } = await ada.PATCH("/preferences", { body: { hourCycle: "h23", dateFormat: "iso" } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ hourCycle: "h23", dateFormat: "iso", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
  expect((await ada.GET("/preferences")).data).toEqual({ hourCycle: "h23", dateFormat: "iso", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("changing one preference leaves the other as it was", async () => {
  const { ada } = await withOrganization();
  await ada.PATCH("/preferences", { body: { hourCycle: "h12", dateFormat: "dayMonth" } });

  const { data } = await ada.PATCH("/preferences", { body: { dateFormat: "monthDay" } });

  expect(data).toEqual({ hourCycle: "h12", dateFormat: "monthDay", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("a human's preferences are their own, so another human's stay as they were", async () => {
  const { ada, grace } = await withOrganization();

  await grace.PATCH("/preferences", { body: { hourCycle: "h23" } });

  expect((await grace.GET("/preferences")).data).toEqual({ hourCycle: "h23", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
  expect((await ada.GET("/preferences")).data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("a human's mail shows as HTML until they choose text, and then as text", async () => {
  const { ada } = await withOrganization();
  expect((await ada.GET("/preferences")).data?.mailView).toBe("html");

  const { data } = await ada.PATCH("/preferences", { body: { mailView: "text", keyboardShortcuts: "on" } });

  expect(data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "text", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
  expect((await ada.GET("/preferences")).data?.mailView).toBe("text");
});

test("a human's keyboard shortcuts are on until they turn them off, and then off in every browser", async () => {
  const { ada } = await withOrganization();
  expect((await ada.GET("/preferences")).data?.keyboardShortcuts).toBe("on");

  const { data } = await ada.PATCH("/preferences", { body: { keyboardShortcuts: "off", cooSpeaksUp: "on" } });

  expect(data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "off", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
  expect((await ada.GET("/preferences")).data?.keyboardShortcuts).toBe("off");
});

test("Coo speaks up until its human turns it off, and then stays quiet in every browser", async () => {
  const { ada } = await withOrganization();
  expect((await ada.GET("/preferences")).data?.cooSpeaksUp).toBe("on");

  const { data } = await ada.PATCH("/preferences", { body: { cooSpeaksUp: "off" } });

  expect(data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "off", cooLearnsFromMail: "on", opensOn: "all" });
  expect((await ada.GET("/preferences")).data?.cooSpeaksUp).toBe("off");
});

test("a human chooses their browser's language again", async () => {
  const { ada } = await withOrganization();
  await ada.PATCH("/preferences", { body: { hourCycle: "h23", dateFormat: "iso" } });

  const { data } = await ada.PATCH("/preferences", { body: { hourCycle: "locale", dateFormat: "locale" } });

  expect(data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("an agent has no preferences, so it gets 403 reading or changing them", async () => {
  const { hermes } = await withOrganization();

  const read = await hermes.GET("/preferences");
  const change = await hermes.PATCH("/preferences", { body: { hourCycle: "h23" } });

  for (const { response, error } of [read, change]) {
    expect(response.status).toBe(403);
    expect(error).toEqual({ message: "Only humans have preferences. An agent's settings are its sponsor's to change." });
  }
});

test.each([
  ["no preference", {}, "Give a preference to change: hourCycle, dateFormat, mailView, keyboardShortcuts, cooSpeaksUp, cooLearnsFromMail, timeZone, opensOn, newMailFrom, cooEverydayModel, cooHarderModel."],
  ["an hour cycle Duva doesn't have", { hourCycle: "h24" }, "Give hourCycle as locale, h12 or h23."],
  ["a date format Duva doesn't have", { dateFormat: "yearFirst" }, "Give dateFormat as locale, iso, dayMonth or monthDay."],
  ["a mail view Duva doesn't have", { mailView: "markdown" }, "Give mailView as html or text."],
  ["keyboard shortcuts as neither on nor off", { keyboardShortcuts: "true" }, "Give keyboardShortcuts as on or off."],
  ["Coo speaking up as neither on nor off", { cooSpeaksUp: "yes" }, "Give cooSpeaksUp as on or off."],
  ["a preference Duva doesn't have", { language: "sv" }, 'Duva has no preference "language". Its preferences are hourCycle, dateFormat, mailView, keyboardShortcuts, cooSpeaksUp, cooLearnsFromMail, timeZone, opensOn, newMailFrom, cooEverydayModel, cooHarderModel.'],
])("changing preferences with %s gets 400, and they stay as they were", async (_, body, message) => {
  const { ada } = await withOrganization();

  const { response, error } = await ada.PATCH("/preferences", { body: body as never });

  expect(response.status).toBe(400);
  expect(error).toEqual({ message });
  expect((await ada.GET("/preferences")).data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("a human has no time zone until they choose one, and then it is theirs", async () => {
  const { ada } = await withOrganization();
  expect((await ada.GET("/preferences")).data).not.toHaveProperty("timeZone");

  const { response, data } = await ada.PATCH("/preferences", { body: { timeZone: "Europe/Stockholm" } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", timeZone: "Europe/Stockholm", opensOn: "all" });
  expect((await ada.GET("/preferences")).data?.timeZone).toBe("Europe/Stockholm");
});

test("a human removes their time zone, and has none again, with other preferences changed in the same call", async () => {
  const { ada } = await withOrganization();
  await ada.PATCH("/preferences", { body: { timeZone: "Europe/Stockholm" } });

  const { response, data } = await ada.PATCH("/preferences", { body: { timeZone: null, hourCycle: "h23" } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ hourCycle: "h23", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
  expect((await ada.GET("/preferences")).data).toEqual({ hourCycle: "h23", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("removing a time zone a human never chose leaves them without one", async () => {
  const { ada } = await withOrganization();

  const { response, data } = await ada.PATCH("/preferences", { body: { timeZone: null } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ hourCycle: "locale", dateFormat: "locale", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on", cooLearnsFromMail: "on", opensOn: "all" });
});

test("a time zone that isn't one is refused", async () => {
  const { ada } = await withOrganization();

  const { response, error } = await ada.PATCH("/preferences", { body: { timeZone: "Europe/Atlantis" } });

  expect(response.status).toBe(400);
  expect(error?.message).toBe('"Europe/Atlantis" isn\'t a time zone. Give timeZone as an IANA name, such as Europe/Stockholm.');
});
