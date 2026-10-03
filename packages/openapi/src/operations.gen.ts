// Generated from packages/openapi/openapi.yaml by scripts/generate.ts. Do not edit. Run npm run generate.

export const operations = [
  {
    "operationId": "getStatus",
    "method": "get",
    "path": "/status",
    "routeKey": "GET /status",
    "summary": "Show Duva's version and the deployment's region.",
    "signIn": false,
    "command": [
      "status"
    ],
    "options": []
  },
  {
    "operationId": "whoami",
    "method": "get",
    "path": "/whoami",
    "routeKey": "GET /whoami",
    "summary": "Show the signed-in actor.",
    "signIn": true,
    "command": [
      "whoami"
    ],
    "options": []
  },
  {
    "operationId": "listOrganizationChanges",
    "method": "get",
    "path": "/organization/changes",
    "routeKey": "GET /organization/changes",
    "summary": "List the changes to the organization's setup after a position in its change feed.",
    "signIn": true,
    "command": [
      "organization",
      "changes"
    ],
    "options": [
      {
        "name": "after",
        "in": "query",
        "type": "integer",
        "required": false,
        "description": "The position to list changes after. 0, the default, lists from the start."
      }
    ]
  },
  {
    "operationId": "listAgents",
    "method": "get",
    "path": "/agents",
    "routeKey": "GET /agents",
    "summary": "List the agents you sponsor.",
    "signIn": true,
    "command": [
      "agents",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "createAgent",
    "method": "post",
    "path": "/agents",
    "routeKey": "POST /agents",
    "summary": "Create an agent, with you as its sponsor, and show its key once.",
    "signIn": true,
    "command": [
      "agents",
      "create"
    ],
    "options": [
      {
        "name": "name",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The agent's name."
      }
    ]
  },
  {
    "operationId": "rotateAgentKey",
    "method": "post",
    "path": "/agents/{agent}/key",
    "routeKey": "POST /agents/{agent}/key",
    "summary": "Give an agent you sponsor a new key, show it once, and refuse the old one from now on.",
    "signIn": true,
    "command": [
      "agents",
      "rotate-key"
    ],
    "options": [
      {
        "name": "agent",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The agent's ID."
      }
    ]
  },
  {
    "operationId": "listMailboxes",
    "method": "get",
    "path": "/mailboxes",
    "routeKey": "GET /mailboxes",
    "summary": "List the mailboxes you can read, your own and those of the agents you sponsor.",
    "signIn": true,
    "command": [
      "mailboxes",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "createMailbox",
    "method": "post",
    "path": "/mailboxes",
    "routeKey": "POST /mailboxes",
    "summary": "Create a personal mailbox for an agent, with an address on the organization's domain.",
    "signIn": true,
    "command": [
      "mailboxes",
      "create"
    ],
    "options": [
      {
        "name": "owner",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The ID of the agent that owns the mailbox."
      },
      {
        "name": "address",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The mailbox's address, on the organization's domain, without a plus tag."
      }
    ]
  },
  {
    "operationId": "listMailboxChanges",
    "method": "get",
    "path": "/mailboxes/{mailbox}/changes",
    "routeKey": "GET /mailboxes/{mailbox}/changes",
    "summary": "List the changes in a mailbox after a position in its change feed.",
    "signIn": true,
    "command": [
      "mailboxes",
      "changes"
    ],
    "options": [
      {
        "name": "mailbox",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The mailbox's ID."
      },
      {
        "name": "after",
        "in": "query",
        "type": "integer",
        "required": false,
        "description": "The position to list changes after. 0, the default, lists from the start."
      }
    ]
  },
  {
    "operationId": "listThreads",
    "method": "get",
    "path": "/mailboxes/{mailbox}/threads",
    "routeKey": "GET /mailboxes/{mailbox}/threads",
    "summary": "List the threads in a mailbox with a label, newest first.",
    "signIn": true,
    "command": [
      "threads",
      "list"
    ],
    "options": [
      {
        "name": "mailbox",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The mailbox's ID."
      },
      {
        "name": "label",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "The label the threads carry. inbox, the default, lists the Inbox."
      }
    ]
  },
  {
    "operationId": "getThread",
    "method": "get",
    "path": "/mailboxes/{mailbox}/threads/{thread}",
    "routeKey": "GET /mailboxes/{mailbox}/threads/{thread}",
    "summary": "Read a thread, with each of its messages, oldest first.",
    "signIn": true,
    "command": [
      "threads",
      "get"
    ],
    "options": [
      {
        "name": "mailbox",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The mailbox's ID."
      },
      {
        "name": "thread",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The thread's ID."
      }
    ]
  }
] as const;
