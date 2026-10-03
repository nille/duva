// Generated from packages/openapi/openapi.yaml by scripts/generate.ts. Do not edit. Run npm run generate.

export interface paths {
    "/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Show Duva's version and the deployment's region.
         * @description Answers without sign-in, so any client can check that it reaches the deployment.
         */
        get: operations["getStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/whoami": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Show the signed-in actor. */
        get: operations["whoami"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/organization/changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the changes to the organization's setup after a position in its change feed.
         * @description Lists up to 100 changes, oldest first. To catch up, call again with the position the answer ends at until it lists no more. Only admins can read the organization's change feed.
         */
        get: operations["listOrganizationChanges"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the agents you sponsor. */
        get: operations["listAgents"];
        put?: never;
        /**
         * Create an agent, with you as its sponsor, and show its key once.
         * @description Only humans can create agents. The answer is the only time Duva shows the agent's key: it keeps only a hash. Creating an agent is a change to the organization's setup, recorded in its change feed.
         */
        post: operations["createAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{agent}/key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Give an agent you sponsor a new key, show it once, and refuse the old one from now on.
         * @description Only the agent's sponsor can rotate its key. Rotating is a change to the organization's setup, recorded in its change feed.
         */
        post: operations["rotateAgentKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            /** @description What went wrong. */
            message: string;
        };
        /** @description A human or an agent that acts on mail. */
        Actor: components["schemas"]["Human"] | components["schemas"]["Agent"];
        /** @description An actor that is a person. */
        Human: {
            /** @description The actor's ID, which never changes. */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "human";
            /**
             * @description The address the human signs in with.
             * @example ada@example.com
             */
            email: string;
            /** @description Whether the human may change the organization's setup. */
            admin: boolean;
        };
        /** @description An actor that is software, which calls Duva with its key. */
        Agent: {
            /** @description The actor's ID, which never changes. */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "agent";
            /**
             * @description The agent's name.
             * @example Hermes
             */
            name: string;
            /** @description The ID of the human who answers for the agent. */
            sponsor: string;
            /** @description Whether the agent may change the organization's setup. */
            admin: boolean;
        };
        NewAgent: {
            /**
             * @description The agent's name.
             * @example Hermes
             */
            name: string;
        };
        AgentWithKey: {
            agent: components["schemas"]["Agent"];
            /**
             * @description The agent's key. Duva shows it only here, so keep it now. The agent sends it as a bearer token, or the CLI reads it from DUVA_AGENT_KEY.
             * @example duva_agent_3q2-7wF0nJvZb1yKcY9mXo8aT5rL4sUeHgQdPiWjNkM
             */
            key: string;
        };
        AgentList: {
            agents: components["schemas"]["Agent"][];
        };
        ChangePage: {
            changes: components["schemas"]["OrganizationChange"][];
            /** @description The position of the last change listed, or the one asked for if none were. Pass it as after to continue. */
            position: number;
        };
        /** @description A change to the organization's setup. */
        OrganizationChange: components["schemas"]["OrganizationAdded"] | components["schemas"]["DomainAdded"] | components["schemas"]["ActorAdded"] | components["schemas"]["AgentKeyRotated"];
        ChangeBase: {
            /** @description The change's position in the feed, counting from 1. */
            position: number;
            /**
             * Format: date-time
             * @description When the change was made.
             */
            at: string;
            /** @description The ID of the actor who made the change. */
            actor: string;
        };
        OrganizationAdded: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "organizationAdded";
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "organizationAdded";
        };
        DomainAdded: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "domainAdded";
            /**
             * @description The domain, a standalone domain.
             * @example example.com
             */
            domain: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "domainAdded";
        };
        ActorAdded: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "actorAdded";
            added: components["schemas"]["Actor"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "actorAdded";
        };
        AgentKeyRotated: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "agentKeyRotated";
            /** @description The ID of the agent whose key was rotated. */
            agent: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agentKeyRotated";
        };
        Status: {
            /**
             * @description The version of Duva the deployment runs.
             * @example 0.1.0
             */
            version: string;
            /**
             * @description The AWS region the deployment runs in.
             * @example eu-north-1
             */
            region: string;
        };
    };
    responses: {
        /** @description The request is malformed. */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description The call has no valid credentials. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description The signed-in actor may not do this. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Another call changed the same thing at the same time. Try again. */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Nothing has the ID the call names. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The deployment's status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
        };
    };
    whoami: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The actor the call is attributed to. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Actor"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listOrganizationChanges: {
        parameters: {
            query?: {
                /** @description The position to list changes after. 0, the default, lists from the start. */
                after?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The changes after the position. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangePage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    listAgents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The agents the signed-in actor sponsors. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentList"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createAgent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewAgent"];
            };
        };
        responses: {
            /** @description The agent and its key. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentWithKey"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    rotateAgentKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The agent's ID. */
                agent: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The agent and its new key. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentWithKey"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
}
