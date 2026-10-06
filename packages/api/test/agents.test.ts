import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

test("a human creates an agent, becomes its sponsor, and gets its key once", async () => {
  const duva = await startDuva({ admin: "ada@example.com" });
  const ada = duva.signIn("ada@example.com");
  const { data: sponsor } = await ada.GET("/whoami");

  const { response, data } = await ada.POST("/agents", { body: { name: "Hermes" } });

  expect(response.status).toBe(201);
  expect(data).toEqual({
    agent: { id: expect.any(String), kind: "agent", name: "Hermes", sponsor: sponsor?.id, admin: false },
    key: expect.stringMatching(/^duva_agent_[A-Za-z0-9_-]{43}$/),
  });
  const { data: listed } = await ada.GET("/agents");
  expect(JSON.stringify(listed)).not.toContain(data?.key);
});

test("every agent gets its own key", async () => {
  const duva = await startDuva();
  const ada = duva.signIn("ada@example.com");

  const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });

  expect(hermes?.key).not.toBe(iris?.key);
});

test("whoami with an agent's key names the agent and its sponsor", async () => {
  const duva = await startDuva({ admin: "ada@example.com" });
  const ada = duva.signIn("ada@example.com");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });

  const { data } = await duva.withKey(created!.key).GET("/whoami");

  expect(data).toEqual(created?.agent);
});

test("a key Duva didn't give out is refused", async () => {
  const duva = await startDuva();
  await duva.signIn("ada@example.com").POST("/agents", { body: { name: "Hermes" } });

  const { response } = await duva.withKey("duva_agent_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").GET("/whoami");

  expect(response.status).toBe(401);
});

test("an agent's key works only in the deployment that gave it out", async () => {
  const duva = await startDuva();
  const elsewhere = await startDuva();
  const { data: created } = await elsewhere.signIn("ada@example.com").POST("/agents", { body: { name: "Hermes" } });

  const { response } = await duva.withKey(created!.key).GET("/whoami");

  expect(response.status).toBe(401);
});

test("the sponsor rotates an agent's key, and the old key is refused at once", async () => {
  const duva = await startDuva();
  const ada = duva.signIn("ada@example.com");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });

  const { response, data: rotated } = await ada.POST("/agents/{agent}/key", { params: { path: { agent: created!.agent.id } } });

  expect(response.status).toBe(200);
  expect(rotated).toEqual({ agent: created?.agent, key: expect.stringMatching(/^duva_agent_/) });
  expect(rotated?.key).not.toBe(created?.key);
  expect((await duva.withKey(created!.key).GET("/whoami")).response.status).toBe(401);
  expect((await duva.withKey(rotated!.key).GET("/whoami")).data).toEqual(created?.agent);
});

test("of two rotations at the same time, one gives out a key and the other is refused", async () => {
  const duva = await startDuva();
  const ada = duva.signIn("ada@example.com");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const rotate = () => ada.POST("/agents/{agent}/key", { params: { path: { agent: created!.agent.id } } });

  const answers = await Promise.all([rotate(), rotate(), rotate()]);

  const statuses = answers.map(({ response }) => response.status);
  expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
  const working = await Promise.all(
    answers.filter(({ data }) => data !== undefined).map(async ({ data }) => (await duva.withKey(data!.key).GET("/whoami")).response.status),
  );
  expect(working.filter((status) => status === 200)).toHaveLength(1);
});

test("an agent can't rotate its own key", async () => {
  const duva = await startDuva();
  const { data: created } = await duva.signIn("ada@example.com").POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(created!.key);

  const { response, error } = await hermes.POST("/agents/{agent}/key", { params: { path: { agent: created!.agent.id } } });

  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/sponsor/);
  expect((await hermes.GET("/whoami")).response.status).toBe(200);
});

test("a human who isn't the sponsor can't rotate an agent's key, even an admin", async () => {
  const duva = await startDuva({ admin: "ada@example.com", humans: ["grace@example.com"] });
  const { data: created } = await duva.signIn("grace@example.com").POST("/agents", { body: { name: "Hermes" } });

  const { response } = await duva.signIn("ada@example.com").POST("/agents/{agent}/key", { params: { path: { agent: created!.agent.id } } });

  expect(response.status).toBe(403);
  expect((await duva.withKey(created!.key).GET("/whoami")).response.status).toBe(200);
});

test("rotating the key of an agent that doesn't exist answers 404", async () => {
  const duva = await startDuva();

  const { response } = await duva.signIn("ada@example.com").POST("/agents/{agent}/key", { params: { path: { agent: "nobody" } } });

  expect(response.status).toBe(404);
});

test("an agent can't create agents", async () => {
  const duva = await startDuva();
  const ada = duva.signIn("ada@example.com");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });

  const { response, error } = await duva.withKey(created!.key).POST("/agents", { body: { name: "Hermes Jr" } });

  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/Only humans/);
  const { data } = await ada.GET("/agents");
  expect(data?.agents.map(({ name }) => name)).toEqual(["Hermes"]);
});

test("an agent needs a name", async () => {
  const duva = await startDuva();

  const { response, error } = await duva.signIn("ada@example.com").POST("/agents", { body: { name: "  " } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/name/);
});

test("a human lists the agents they sponsor, and only those", async () => {
  const duva = await startDuva({ admin: "ada@example.com", humans: ["grace@example.com"] });
  const ada = duva.signIn("ada@example.com");
  const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });
  await duva.signIn("grace@example.com").POST("/agents", { body: { name: "Babbage" } });

  const { data } = await ada.GET("/agents");

  expect(data?.agents).toHaveLength(2);
  expect(data?.agents).toEqual(expect.arrayContaining([hermes?.agent, iris?.agent]));
});

test("creating an agent and rotating its key are in the change feed, attributed to the sponsor", async () => {
  const duva = await startDuva({ admin: "ada@example.com" });
  const ada = duva.signIn("ada@example.com");
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/agents/{agent}/key", { params: { path: { agent: created!.agent.id } } });

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: 3 } } });

  expect(data).toEqual({
    changes: [
      { position: 4, at: expect.any(String), actor: sponsor?.id, type: "actorAdded", added: created?.agent },
      { position: 5, at: expect.any(String), actor: sponsor?.id, type: "agentKeyRotated", agent: created?.agent.id },
    ],
    position: 5,
  });
  expect(JSON.stringify(data)).not.toContain(created?.key);
});

test("agents created at the same time each get their own place in the change feed", async () => {
  const duva = await startDuva();
  const ada = duva.signIn("ada@example.com");

  await Promise.all(["Hermes", "Iris", "Babbage", "Lovelace"].map((name) => ada.POST("/agents", { body: { name } })));

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: 3 } } });
  expect(data?.changes.map(({ position }) => position)).toEqual([4, 5, 6, 7]);
});

test("an admin lists every agent in the organization, whoever sponsors it", async () => {
  const duva = await startDuva({ admin: "ada@example.com", humans: ["grace@example.com"] });
  const ada = duva.signIn("ada@example.com");
  const grace = duva.signIn("grace@example.com");
  const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });

  const { response, data } = await ada.GET("/organization/agents");

  expect(response.status).toBe(200);
  expect(data?.agents).toHaveLength(2);
  expect(data?.agents).toEqual(expect.arrayContaining([hermes!.agent, iris!.agent]));
});

test("only an admin lists the organization's agents", async () => {
  const duva = await startDuva({ admin: "ada@example.com", humans: ["grace@example.com"] });
  const { data: hermes } = await duva.signIn("ada@example.com").POST("/agents", { body: { name: "Hermes" } });

  const byHuman = await duva.signIn("grace@example.com").GET("/organization/agents");
  const byAgent = await duva.withKey(hermes!.key).GET("/organization/agents");

  expect(byHuman.response.status).toBe(403);
  expect(byHuman.error?.message).toMatch(/admin/);
  expect(byAgent.response.status).toBe(403);
});
