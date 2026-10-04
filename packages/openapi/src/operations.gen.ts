// Generated from packages/openapi/openapi.yaml by scripts/generate.ts. Do not edit. Run npm run generate.

export const operations = [
  {
    "operationId": "getStatus",
    "method": "get",
    "path": "/status",
    "routeKey": "GET /status",
    "summary": "Show Duva's version and the deployment's region.",
    "description": "Answers without sign-in, so any client can check that it reaches the deployment.",
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
    "description": "",
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
    "description": "Lists up to 100 changes, oldest first. To catch up, call again with the position the answer ends at until it lists no more. Only admins can read the organization's change feed.",
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
    "operationId": "listHumans",
    "method": "get",
    "path": "/humans",
    "routeKey": "GET /humans",
    "summary": "List the organization's humans.",
    "description": "Only admins can list the organization's humans.",
    "signIn": true,
    "command": [
      "humans",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "addHuman",
    "method": "post",
    "path": "/humans",
    "routeKey": "POST /humans",
    "summary": "Add a human to the organization by their email address, so they can sign in.",
    "description": "Only admins can add humans. The human signs in with a code emailed to the address, and has no mailbox until an admin creates one for them. Adding a human is a change to the organization's setup, recorded in its change feed.",
    "signIn": true,
    "command": [
      "humans",
      "add"
    ],
    "options": [
      {
        "name": "email",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The address the human signs in with."
      }
    ]
  },
  {
    "operationId": "listAgents",
    "method": "get",
    "path": "/agents",
    "routeKey": "GET /agents",
    "summary": "List the agents you sponsor.",
    "description": "",
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
    "description": "Only humans can create agents. The answer is the only time Duva shows the agent's key: it keeps only a hash. Creating an agent is a change to the organization's setup, recorded in its change feed.",
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
    "description": "Only the agent's sponsor can rotate its key. Rotating is a change to the organization's setup, recorded in its change feed.",
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
    "description": "",
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
    "summary": "Create a personal mailbox for a human or an agent, with an address on the organization's domain.",
    "description": "Only admins can create mailboxes. The address becomes the mailbox's default address, and mail to it is accepted from then on. An admin can't read a personal mailbox they don't own, even one they created, unless they sponsor the agent that owns it. Creating the mailbox and its address are changes to the organization's setup, recorded in its change feed.",
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
        "description": "The ID of the human or agent that owns the mailbox."
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
    "description": "Lists up to 100 changes, oldest first, leaving out the arrivals of mail judged to be spam unless asked for them. To catch up, call again with the position the answer ends at until it lists no more. Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.",
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
      },
      {
        "name": "spam",
        "in": "query",
        "type": "boolean",
        "required": false,
        "description": "Lists the arrivals of mail judged to be spam too."
      }
    ]
  },
  {
    "operationId": "listThreads",
    "method": "get",
    "path": "/mailboxes/{mailbox}/threads",
    "routeKey": "GET /mailboxes/{mailbox}/threads",
    "summary": "List the threads in a mailbox with a label, newest first.",
    "description": "Lists the threads a page at a time, newest first by their newest message. To read the next page, call again with the answer's next as after, until an answer has no next.",
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
      },
      {
        "name": "limit",
        "in": "query",
        "type": "integer",
        "required": false,
        "description": "How many threads a page lists at most."
      },
      {
        "name": "after",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "Where the page starts, the next of the page before it. Leave it out for the first page."
      }
    ]
  },
  {
    "operationId": "markThreadsRead",
    "method": "post",
    "path": "/mailboxes/{mailbox}/threads/read",
    "routeKey": "POST /mailboxes/{mailbox}/threads/read",
    "summary": "Mark threads in a mailbox read.",
    "description": "Marks each thread read. Read state belongs to the mailbox, so it is the same for each actor who reads it. Each thread that was unread gets a change in the mailbox's change feed, naming you. Only those who can read the mailbox can mark its threads.",
    "signIn": true,
    "command": [
      "threads",
      "mark-read"
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
        "name": "threads",
        "in": "body",
        "type": "strings",
        "required": true,
        "description": "The IDs of the threads."
      }
    ]
  },
  {
    "operationId": "markThreadsUnread",
    "method": "post",
    "path": "/mailboxes/{mailbox}/threads/unread",
    "routeKey": "POST /mailboxes/{mailbox}/threads/unread",
    "summary": "Mark threads in a mailbox unread.",
    "description": "Marks each thread unread, so it stands out until it is read again. Each thread that was read gets a change in the mailbox's change feed, naming you. Only those who can read the mailbox can mark its threads.",
    "signIn": true,
    "command": [
      "threads",
      "mark-unread"
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
        "name": "threads",
        "in": "body",
        "type": "strings",
        "required": true,
        "description": "The IDs of the threads."
      }
    ]
  },
  {
    "operationId": "getThread",
    "method": "get",
    "path": "/mailboxes/{mailbox}/threads/{thread}",
    "routeKey": "GET /mailboxes/{mailbox}/threads/{thread}",
    "summary": "Read a thread, with each of its messages, oldest first.",
    "description": "",
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
  },
  {
    "operationId": "listDrafts",
    "method": "get",
    "path": "/mailboxes/{mailbox}/drafts",
    "routeKey": "GET /mailboxes/{mailbox}/drafts",
    "summary": "List the drafts in a mailbox, newest first, with where each send stands.",
    "description": "Only the mailbox's owner and, for an agent's mailbox, its sponsor can list them.",
    "signIn": true,
    "command": [
      "drafts",
      "list"
    ],
    "options": [
      {
        "name": "mailbox",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The mailbox's ID."
      }
    ]
  },
  {
    "operationId": "createDraft",
    "method": "post",
    "path": "/mailboxes/{mailbox}/drafts",
    "routeKey": "POST /mailboxes/{mailbox}/drafts",
    "summary": "Draft a reply to a message in a mailbox, or a new message.",
    "description": "A reply goes from the address the original was sent to, plus tag kept, to the original's Reply-To or, without one, its From, with the subject carrying a single \"Re: \" prefix. A new message goes from the mailbox's default address, and needs to and subject. Only the mailbox's owner can draft in it. Writing a draft is recorded in the mailbox's change feed.",
    "signIn": true,
    "command": [
      "drafts",
      "create"
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
        "name": "answers",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The ID of the message the draft replies to. Without it, the draft is a new message."
      },
      {
        "name": "to",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The recipients' addresses. A reply goes to the original's Reply-To or From unless you give them."
      },
      {
        "name": "subject",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The subject. A reply's is the original's with \"Re: \" unless you give one."
      },
      {
        "name": "text",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The plain-text body."
      }
    ]
  },
  {
    "operationId": "getDraft",
    "method": "get",
    "path": "/mailboxes/{mailbox}/drafts/{draft}",
    "routeKey": "GET /mailboxes/{mailbox}/drafts/{draft}",
    "summary": "Read a draft, with where its send stands.",
    "description": "Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.",
    "signIn": true,
    "command": [
      "drafts",
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
        "name": "draft",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The draft's ID."
      }
    ]
  },
  {
    "operationId": "editDraft",
    "method": "patch",
    "path": "/mailboxes/{mailbox}/drafts/{draft}",
    "routeKey": "PATCH /mailboxes/{mailbox}/drafts/{draft}",
    "summary": "Change a draft's recipients, subject or text.",
    "description": "Changing a draft that waits for approval withdraws the request, so an approver never approves text they didn't see. Ask to send it again once it is ready. Only the mailbox's owner can edit its drafts. The change, and any withdrawal, is recorded in the mailbox's change feed.",
    "signIn": true,
    "command": [
      "drafts",
      "edit"
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
        "name": "draft",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The draft's ID."
      },
      {
        "name": "to",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The recipients' addresses, in place of the draft's."
      },
      {
        "name": "subject",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The subject, in place of the draft's."
      },
      {
        "name": "text",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The plain-text body."
      }
    ]
  },
  {
    "operationId": "sendDraft",
    "method": "post",
    "path": "/mailboxes/{mailbox}/drafts/{draft}/send",
    "routeKey": "POST /mailboxes/{mailbox}/drafts/{draft}/send",
    "summary": "Ask for a draft to be sent.",
    "description": "An agent's send from its own mailbox needs its sponsor's approval, so the draft waits for them. Its send shows where it stands. Only the mailbox's owner can ask, and a draft waits for one approval at a time. Asking is recorded in the mailbox's change feed.",
    "signIn": true,
    "command": [
      "drafts",
      "send"
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
        "name": "draft",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The draft's ID."
      }
    ]
  },
  {
    "operationId": "listApprovals",
    "method": "get",
    "path": "/approvals",
    "routeKey": "GET /approvals",
    "summary": "List the approvals waiting for you, newest first, each with its draft and the message it answers.",
    "description": "An agent's sends from its own mailbox wait for its sponsor, so a sponsor sees those of every agent they sponsor.",
    "signIn": true,
    "command": [
      "approvals",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "sendApproval",
    "method": "post",
    "path": "/approvals/{approval}/send",
    "routeKey": "POST /approvals/{approval}/send",
    "summary": "Send a draft waiting for your approval, as is or with your changes.",
    "description": "Give recipients, a subject or text to send your version instead of the agent's. Duva then sends it through SES from the draft's address, as a reply in the thread if it is one. Every message an agent sends carries the Duva-Agent header, naming the agent and the human it acts for, and a line that says so after the text, also when you changed it. The draft's send shows sending, then sent or failed with SES's reason. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision, with any edits, is recorded in the mailbox's change feed under you, and the send under the agent.",
    "signIn": true,
    "command": [
      "approvals",
      "send"
    ],
    "options": [
      {
        "name": "approval",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The approval's ID."
      },
      {
        "name": "to",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The recipients' addresses, in place of the draft's."
      },
      {
        "name": "subject",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The subject, in place of the draft's."
      },
      {
        "name": "text",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The plain-text body, in place of the draft's."
      }
    ]
  },
  {
    "operationId": "rejectApproval",
    "method": "post",
    "path": "/approvals/{approval}/reject",
    "routeKey": "POST /approvals/{approval}/reject",
    "summary": "Reject a draft waiting for your approval, with a note the agent sees.",
    "description": "The draft goes back to the agent with the note, and the agent can revise it and ask again. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision is recorded in the mailbox's change feed.",
    "signIn": true,
    "command": [
      "approvals",
      "reject"
    ],
    "options": [
      {
        "name": "approval",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The approval's ID."
      },
      {
        "name": "note",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "What the agent should change."
      }
    ]
  }
] as const;
