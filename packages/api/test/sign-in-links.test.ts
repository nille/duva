import { createHash } from "node:crypto";
import PostalMime from "postal-mime";
import { expect, onTestFinished, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A sign-in link as its recipient reads it: whom it came from and went to, and the token at its end. */
async function mailed(raw: string) {
  const { from, to, subject, text } = await PostalMime.parse(raw);
  return { from, to: to?.map(({ address }) => address), subject, text, token: text?.match(/#\/sign-in\/([\w-]+)/)?.[1] };
}

const minutes = 60_000;

/** Whether the time is 30 minutes after one between the two, as a link mailed during a call expires. */
const halfAnHourAfter = (from: number, to: number) => (expiresAt: string) => Date.parse(expiresAt) >= from + 30 * minutes && Date.parse(expiresAt) <= to + 30 * minutes;

test("adding a human mails their first sign-in link to their recovery address, from no-reply@ the sign-in domain", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });

  const before = Date.now();
  const { response, data } = await duva.signIn("ada@example.org").POST("/humans", { body: { email: "grace@example.com", recoveryAddress: "grace@elsewhere.org" } });

  expect(response.status).toBe(201);
  expect(data).toEqual({
    id: expect.any(String),
    kind: "human",
    email: "grace@example.com",
    admin: false,
    recoveryAddress: "grace@elsewhere.org",
    signInLink: { to: "grace@elsewhere.org", expiresAt: expect.any(String) },
  });
  expect(data!.signInLink!.expiresAt).toSatisfy(halfAnHourAfter(before, Date.now()));
  expect(duva.sentTo()).toEqual([["grace@elsewhere.org"]]);
  const link = await mailed(duva.sent()[0]!);
  expect(link).toMatchObject({ from: { name: "Duva", address: "no-reply@example.com" }, to: ["grace@elsewhere.org"], subject: "Sign in to Duva", token: expect.any(String) });
  expect(link.text).toMatch(/grace@example\.com/);
});

test("a human isn't added without a recovery address, or with one on the organization's domains", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");

  const without = await ada.POST("/humans", { body: { email: "grace@example.com" } as never });
  const inside = await ada.POST("/humans", { body: { email: "grace@example.com", recoveryAddress: "Grace@Example.com" } });

  expect(without.response.status).toBe(400);
  expect(without.error?.message).toMatch(/recoveryAddress/);
  expect(inside.response.status).toBe(400);
  expect(inside.error?.message).toMatch(/grace@example\.com is on the organization's domain example\.com/);
  expect((await ada.GET("/humans")).data?.humans.map(({ email }) => email)).toEqual(["ada@example.org"]);
  expect(duva.sent()).toEqual([]);
});

/** A deployment where ada, the first admin, added grace with her recovery address, and the link it mailed her. */
async function withGrace() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: grace } = await ada.POST("/humans", { body: { email: "grace@example.com", recoveryAddress: "grace@elsewhere.org" } });
  const { signInLink: _, ...human } = grace!;
  return { duva, ada, grace: human, token: (await mailed(duva.sent().at(-1)!)).token! };
}

test("following a sign-in link signs its human in, once", async () => {
  const { duva, grace, token } = await withGrace();

  const first = await duva.client.POST("/sign-in-links/follow", { body: { token } });
  const again = await duva.client.POST("/sign-in-links/follow", { body: { token } });

  expect(first.data).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String), expiresIn: 3600 });
  const { data: whoami } = await duva.client.GET("/whoami", { headers: { authorization: `Bearer ${first.data!.accessToken}` } });
  expect(whoami).toEqual(grace);
  expect(again.response.status).toBe(404);
  expect(again.error?.message).toMatch(/expired or was used/);
});

test("a sign-in link works for 30 minutes after Duva mailed it", async () => {
  const start = new Date("2026-10-13T10:00:00Z");
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  await duva.clock(start);
  const ada = duva.signIn("ada@example.org");
  const { data: grace } = await ada.POST("/humans", { body: { email: "grace@example.com", recoveryAddress: "grace@elsewhere.org" } });
  const first = (await mailed(duva.sent().at(-1)!)).token!;

  await duva.clock(new Date(start.getTime() + 31 * minutes));
  const late = await duva.client.POST("/sign-in-links/follow", { body: { token: first } });
  await duva.signIn("ada@example.org").POST("/humans/{human}/sign-in-link", { params: { path: { human: grace!.id } } });
  const second = (await mailed(duva.sent().at(-1)!)).token!;
  await duva.clock(new Date(start.getTime() + 60 * minutes));
  const inTime = await duva.client.POST("/sign-in-links/follow", { body: { token: second } });

  expect(late.response.status).toBe(404);
  expect(inTime.response.status).toBe(200);
});

test("asking for a sign-in link mails one to the human's recovery address, and answers the same for any address", async () => {
  const { duva } = await withGrace();
  const sentBefore = duva.sent().length;

  const known = await duva.client.POST("/sign-in-links", { body: { email: "Grace@example.com" } });
  const unknown = await duva.client.POST("/sign-in-links", { body: { email: "nobody@example.com" } });
  // ada was the first admin before recovery addresses, so she has none.
  const withoutRecovery = await duva.client.POST("/sign-in-links", { body: { email: "ada@example.org" } });

  expect([known, unknown, withoutRecovery].map(({ response, data }) => [response.status, data])).toEqual([
    [202, { message: expect.stringMatching(/If the address signs in to Duva, Duva mailed a sign-in link to its recovery address/) }],
    [202, known.data],
    [202, known.data],
  ]);
  expect(duva.sentTo().slice(sentBefore)).toEqual([["grace@elsewhere.org"]]);
  expect((await mailed(duva.sent().at(-1)!)).to).toEqual(["grace@elsewhere.org"]);
});

test("a human gets at most 3 sign-in links in 10 minutes by asking, with the same answer after", async () => {
  const { duva } = await withGrace();
  const sentBefore = duva.sent().length;

  const answers = [];
  for (let ask = 0; ask < 4; ask++) answers.push(await duva.client.POST("/sign-in-links", { body: { email: "grace@example.com" } }));

  expect(answers.map(({ response }) => response.status)).toEqual([202, 202, 202, 202]);
  expect(duva.sent().length - sentBefore).toBe(3);
});

test("an admin sends a human a sign-in link at their recovery address", async () => {
  const { duva, ada, grace } = await withGrace();

  const before = Date.now();
  const { data } = await ada.POST("/humans/{human}/sign-in-link", { params: { path: { human: grace.id } } });

  expect(data).toEqual({ to: "grace@elsewhere.org", expiresAt: expect.any(String) });
  expect(data!.expiresAt).toSatisfy(halfAnHourAfter(before, Date.now()));
  const link = await mailed(duva.sent().at(-1)!);
  expect(link.to).toEqual(["grace@elsewhere.org"]);
  expect((await duva.client.POST("/sign-in-links/follow", { body: { token: link.token! } })).response.status).toBe(200);
});

test("only admins send sign-in links, and only to humans with a recovery address", async () => {
  const { ada, grace, duva } = await withGrace();
  const { data: adaHerself } = await ada.GET("/whoami");

  const byGrace = await duva.signIn("grace@example.com").POST("/humans/{human}/sign-in-link", { params: { path: { human: adaHerself!.id } } });
  const toAda = await ada.POST("/humans/{human}/sign-in-link", { params: { path: { human: adaHerself!.id } } });

  expect(byGrace.response.status).toBe(403);
  expect(toAda.response.status).toBe(409);
  expect(toAda.error?.message).toMatch(/ada@example\.org has no recovery address.*Settings/);
  expect((await ada.GET("/humans")).data?.humans.find(({ id }) => id === grace.id)?.recoveryAddress).toBe("grace@elsewhere.org");
});

test("a human changes their recovery address once they follow the link mailed to the new one", async () => {
  const { duva } = await withGrace();
  const grace = duva.signIn("grace@example.com");

  const { response, data } = await grace.PUT("/recovery-address", { body: { address: "grace@another.org" } });
  const before = (await grace.GET("/whoami")).data;
  const sent = await PostalMime.parse(duva.sent().at(-1)!);
  const token = sent.text?.match(/#\/recovery\/([\w-]+)/)?.[1];
  const confirmed = await duva.client.POST("/recovery-address/confirm", { body: { token: token! } });
  const again = await duva.client.POST("/recovery-address/confirm", { body: { token: token! } });

  expect(response.status).toBe(202);
  expect(data).toMatchObject({ to: "grace@another.org" });
  expect(sent.to?.map(({ address }) => address)).toEqual(["grace@another.org"]);
  expect(before).toMatchObject({ recoveryAddress: "grace@elsewhere.org" });
  expect(confirmed.data).toEqual({ address: "grace@another.org" });
  expect(again.response.status).toBe(404);
  expect((await grace.GET("/whoami")).data).toMatchObject({ recoveryAddress: "grace@another.org" });
  await duva.client.POST("/sign-in-links", { body: { email: "grace@example.com" } });
  expect(duva.sentTo().at(-1)).toEqual(["grace@another.org"]);
});

test("a recovery address can't be on the organization's domains, and agents have none", async () => {
  const { duva } = await withGrace();
  const grace = duva.signIn("grace@example.com");
  const { data: agent } = await grace.POST("/agents", { body: { name: "Hermes" } });

  const inside = await grace.PUT("/recovery-address", { body: { address: "grace@example.com" } });
  const byAgent = await duva.withKey(agent!.key).PUT("/recovery-address", { body: { address: "hermes@elsewhere.org" } });

  expect(inside.response.status).toBe(400);
  expect(byAgent.response.status).toBe(403);
  expect((await grace.GET("/whoami")).data).toMatchObject({ recoveryAddress: "grace@elsewhere.org" });
});

test("setup gives the first admin the recovery address deploy names, and mails their first sign-in link there, once", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.com", recovery: "ada@elsewhere.org" });
  await duva.setUp({ admin: "ada@example.com", recovery: "ada@elsewhere.org" });

  expect(duva.sentTo()).toEqual([["ada@elsewhere.org"]]);
  const { token } = await mailed(duva.sent()[0]!);
  const { data: session } = await duva.client.POST("/sign-in-links/follow", { body: { token: token! } });
  const { data: ada } = await duva.client.GET("/whoami", { headers: { authorization: `Bearer ${session!.accessToken}` } });
  expect(ada).toMatchObject({ email: "ada@example.com", admin: true, recoveryAddress: "ada@elsewhere.org" });
});

test("once the web app moves to a host, sign-in links lead there, from setup and when asked for", async () => {
  // ada was the first admin before recovery addresses, so setup mails her first link once deploy names one.
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.com" });
  duva.moveWebApp("duva.example.com");

  await duva.setUp({ admin: "ada@example.com", recovery: "ada@elsewhere.org" });
  await duva.client.POST("/sign-in-links", { body: { email: "ada@example.com" } });

  const links = await Promise.all(duva.sent().map(async (raw) => (await mailed(raw)).text?.match(/https?:\/\/\S+/)?.[0]));
  expect(links).toEqual([expect.stringMatching(/^https:\/\/duva\.example\.com\/#\/sign-in\/[\w-]+$/), expect.stringMatching(/^https:\/\/duva\.example\.com\/#\/sign-in\/[\w-]+$/)]);
});

test("while SES refuses the first admin's first sign-in link, as in the sandbox, setup keeps their recovery address and mails nothing", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.com", recovery: "ada@elsewhere.org", sandbox: true });

  expect(duva.sent()).toEqual([]);
  expect((await duva.signIn("ada@example.com").GET("/whoami")).data).toMatchObject({ recoveryAddress: "ada@elsewhere.org" });
});

test("a session from a sign-in link lists its human's passkeys, none yet, and agents have none", async () => {
  const { duva, token } = await withGrace();
  const { data: session } = await duva.client.POST("/sign-in-links/follow", { body: { token } });
  const { data: agent } = await duva.signIn("grace@example.com").POST("/agents", { body: { name: "Hermes" } });

  const listed = await duva.client.GET("/passkeys", { headers: { authorization: `Bearer ${session!.accessToken}` } });
  const byAgent = await duva.withKey(agent!.key).GET("/passkeys");

  expect(listed.data).toEqual({ passkeys: [] });
  expect(byAgent.response.status).toBe(403);
});

test("a caller asks for at most 10 sign-in links in 10 minutes, whatever the addresses", { timeout: 40_000 }, async () => {
  const { duva } = await withGrace();
  for (let asked = 0; asked < 10; asked++) await duva.client.POST("/sign-in-links", { body: { email: `someone-${asked}@example.org` } });

  const { response, error } = await duva.client.POST("/sign-in-links", { body: { email: "grace@example.com" } });

  expect(response.status).toBe(429);
  expect(error).toEqual({ message: "Your address asked for 10 sign-in links in the last 10 minutes. Wait 10 minutes and ask again." });
});

test("setup refuses the first admin a recovery address on the organization's domain", async () => {
  await expect(startDuva({ domain: "example.com", admin: "ada@example.org", recovery: "ada@example.com" })).rejects.toThrow(/ada@example\.com is on the organization's domain example\.com/);
});

/**
 * Signs the human in to managed login with the code it emails, as their browser does, then registers
 * a passkey there with the ID the browser's WebAuthn gave it. Returns how managed login came back.
 */
async function registerPasskey(signInUrl: string, clientId: string, email: string, passkey: string) {
  const authorize = new URL("/oauth2/authorize", signInUrl);
  authorize.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: `${signInUrl}/`, code_challenge: "challenge", code_challenge_method: "S256" }).toString();
  const signedIn = await fetch(authorize, { method: "POST", body: new URLSearchParams({ email, otp: "1" }), redirect: "manual" });
  const cookie = signedIn.headers.get("set-cookie")?.split(";")[0] ?? "";
  const add = new URL("/passkeys/add", signInUrl);
  add.search = new URLSearchParams({ client_id: clientId, redirect_uri: `${signInUrl}/` }).toString();
  const added = await fetch(add, { method: "POST", headers: { cookie }, body: new URLSearchParams({ credential: passkey }), redirect: "manual" });
  return new URL(added.headers.get("location") ?? "/", signInUrl).searchParams.get("result");
}

test("a human removes one of their passkeys and keeps the others, and removing one they don't have answers 404", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  const ada = duva.signIn("ada@example.org");
  expect(await registerPasskey(server.url, server.signIn.clientId, "ada@example.org", "laptop")).toBe("success");
  expect(await registerPasskey(server.url, server.signIn.clientId, "ada@example.org", "phone")).toBe("success");

  const { data: listed } = await ada.GET("/passkeys");
  const { data: left } = await ada.DELETE("/passkeys/{passkey}", { params: { path: { passkey: "laptop" } } });
  const again = await ada.DELETE("/passkeys/{passkey}", { params: { path: { passkey: "laptop" } } });

  expect(listed?.passkeys.map(({ id }) => id)).toEqual(["phone", "laptop"]);
  expect(left).toEqual({ passkeys: [{ id: "phone", name: expect.any(String), createdAt: expect.any(String) }] });
  expect(again.response.status).toBe(404);
});

test("managed login registers a passkey only for a human signed in there, as after a sign-in link they aren't", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  const add = new URL("/passkeys/add", server.url);
  add.search = new URLSearchParams({ client_id: server.signIn.clientId, redirect_uri: `${server.url}/` }).toString();

  const answer = await fetch(add, { method: "POST", body: new URLSearchParams({ credential: "laptop" }), redirect: "manual" });

  expect(new URL(answer.headers.get("location") ?? "/", server.url).searchParams.get("result")).toBe("invalid_session");
  expect((await duva.signIn("ada@example.org").GET("/passkeys")).data).toEqual({ passkeys: [] });
});

test("a session from before passkeys can't list them, and says to sign in again", async () => {
  const duva = await startDuva({ admin: "ada@example.org" });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  // Signed in for only openid and email, as the web app and the CLI asked before passkeys.
  const verifier = "a-verifier-long-enough-for-pkce-0123456789";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL("/oauth2/authorize", server.url);
  authorize.search = new URLSearchParams({ response_type: "code", client_id: server.signIn.clientId, redirect_uri: `${server.url}/`, scope: "openid email", code_challenge: challenge, code_challenge_method: "S256" }).toString();
  const signedIn = await fetch(authorize, { method: "POST", body: new URLSearchParams({ email: "ada@example.org" }), redirect: "manual" });
  const code = new URL(signedIn.headers.get("location")!).searchParams.get("code")!;
  const tokens = (await (
    await fetch(new URL("/oauth2/token", server.url), {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: server.signIn.clientId, code, redirect_uri: `${server.url}/`, code_verifier: verifier }),
    })
  ).json()) as { access_token: string };

  const { response, error } = await duva.client.GET("/passkeys", { headers: { authorization: `Bearer ${tokens.access_token}` } });

  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/Sign out and sign in again/);
});
