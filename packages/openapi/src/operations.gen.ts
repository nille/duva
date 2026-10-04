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
    "operationId": "getMailbox",
    "method": "get",
    "path": "/mailboxes/{mailbox}",
    "routeKey": "GET /mailboxes/{mailbox}",
    "summary": "Read a mailbox you can read, with how many threads in its Inbox are unread.",
    "description": "Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.",
    "signIn": true,
    "command": [
      "mailboxes",
      "get"
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
    "operationId": "listSentThreads",
    "method": "get",
    "path": "/mailboxes/{mailbox}/sent",
    "routeKey": "GET /mailboxes/{mailbox}/sent",
    "summary": "List the threads a mailbox has sent mail in, newest first.",
    "description": "Lists every thread with a message sent from the mailbox, except those in Spam and Trash, a page at a time, newest first by its newest message. To read the next page, call again with the answer's next as after, until an answer has no next.",
    "signIn": true,
    "command": [
      "threads",
      "sent"
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
    "operationId": "labelThreads",
    "method": "post",
    "path": "/mailboxes/{mailbox}/threads/labels",
    "routeKey": "POST /mailboxes/{mailbox}/threads/labels",
    "summary": "Add labels to threads in a mailbox, and remove them.",
    "description": "Adds and removes the labels on each thread. Archiving removes inbox, and adding inbox moves a thread back to the Inbox, out of Spam and Trash. Adding spam or trash takes a thread out of the Inbox. Removing spam (not spam) or trash (restore) puts it back in the Inbox, unless it still has the other or inbox is removed too. Each thread whose labels change gets a change in the mailbox's change feed, naming you. Only those who can read the mailbox can label its threads.",
    "signIn": true,
    "command": [
      "threads",
      "label"
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
      },
      {
        "name": "add",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The IDs of the labels to add, such as inbox, spam, trash or one of the mailbox's own."
      },
      {
        "name": "remove",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The IDs of the labels to remove."
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
    "operationId": "listAllMail",
    "method": "get",
    "path": "/mailboxes/{mailbox}/all-mail",
    "routeKey": "GET /mailboxes/{mailbox}/all-mail",
    "summary": "List every thread in a mailbox except those in Spam and Trash, newest first.",
    "description": "Lists archived threads too, a page at a time, newest first by their newest message. To read the next page, call again with the answer's next as after, until an answer has no next.",
    "signIn": true,
    "command": [
      "threads",
      "all-mail"
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
    "operationId": "listLabels",
    "method": "get",
    "path": "/mailboxes/{mailbox}/labels",
    "routeKey": "GET /mailboxes/{mailbox}/labels",
    "summary": "List a mailbox's labels, with how many unread threads each has.",
    "description": "Lists the built-in labels inbox, spam and trash first, then the mailbox's own labels by name. Only those who can read the mailbox can list its labels.",
    "signIn": true,
    "command": [
      "labels",
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
    "operationId": "createLabel",
    "method": "post",
    "path": "/mailboxes/{mailbox}/labels",
    "routeKey": "POST /mailboxes/{mailbox}/labels",
    "summary": "Create a label in a mailbox.",
    "description": "Creates a label of the mailbox's own, with a name no other label in it has, in any case. Then add it to threads by its ID. Only those who can read the mailbox can create its labels. The change is recorded in the mailbox's change feed.",
    "signIn": true,
    "command": [
      "labels",
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
        "name": "name",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The label's name."
      }
    ]
  },
  {
    "operationId": "deleteLabel",
    "method": "delete",
    "path": "/mailboxes/{mailbox}/labels/{label}",
    "routeKey": "DELETE /mailboxes/{mailbox}/labels/{label}",
    "summary": "Delete one of a mailbox's own labels.",
    "description": "Removes the label from each of its threads, each with a change in the mailbox's change feed, and then deletes it. The threads stay. The built-in labels can't be deleted. If deleting stops partway, delete the label again to finish.",
    "signIn": true,
    "command": [
      "labels",
      "delete"
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
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The label's ID."
      }
    ]
  },
  {
    "operationId": "renameLabel",
    "method": "patch",
    "path": "/mailboxes/{mailbox}/labels/{label}",
    "routeKey": "PATCH /mailboxes/{mailbox}/labels/{label}",
    "summary": "Rename one of a mailbox's own labels.",
    "description": "Gives the label a name no other label in the mailbox has, in any case. Its threads keep it. The built-in labels can't be renamed. The change is recorded in the mailbox's change feed.",
    "signIn": true,
    "command": [
      "labels",
      "rename"
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
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The label's ID."
      },
      {
        "name": "name",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The label's name."
      }
    ]
  },
  {
    "operationId": "emptyTrash",
    "method": "post",
    "path": "/mailboxes/{mailbox}/trash/empty",
    "routeKey": "POST /mailboxes/{mailbox}/trash/empty",
    "summary": "Empty a mailbox's Trash, erasing every thread in it for good.",
    "description": "Erases each thread that is in Trash when you call, with its messages and their raw copies, every stored version included. Erasing can't be undone. Each erased thread gets a threadErased change in the mailbox's change feed, naming you, with none of its content. Duva erases the threads right after answering, and finishes on its next daily run if that fails. Only the mailbox's owner can empty its Trash, and an agent's sponsor its agent's. Without emptying, Trash and Spam are erased 30 days after a thread got the label.",
    "signIn": true,
    "command": [
      "threads",
      "empty-trash"
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
    "operationId": "getAttachment",
    "method": "get",
    "path": "/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}",
    "routeKey": "GET /mailboxes/{mailbox}/messages/{message}/attachments/{attachment}",
    "summary": "Get a short-lived link that downloads one of a message's attachments.",
    "description": "Duva takes the attachment from the stored message when the link is followed, so nothing is stored twice. The link works for 5 minutes, for whoever follows it, so keep it to yourself. Only those who can read the mailbox get one: its owner and, for an agent's mailbox, its sponsor.",
    "signIn": true,
    "command": [
      "attachments",
      "link"
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
        "name": "message",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The message's ID."
      },
      {
        "name": "attachment",
        "in": "path",
        "type": "integer",
        "required": true,
        "description": "The attachment's place among the message's attachments, from 0."
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
    "summary": "Draft a reply to a message in a mailbox, a reply to all, a forward, or a new message.",
    "description": "A reply goes from the address the original was sent to, plus tag kept, to the original's Reply-To or, without one, its From, with the subject carrying a single \"Re: \" prefix. A reply to your own message goes to its recipients instead. A reply to all also goes to every other recipient of the original, except the mailbox's own addresses. A forward goes from the address the original was sent to, to whoever you give, with the subject carrying a single \"Fwd: \" prefix, the original's text quoted and its attachments. A new message goes from the mailbox's default address. A draft can be saved before it has recipients, a subject or text, but it needs a recipient in To to be sent. Only the mailbox's owner can draft in it. Writing a draft is recorded in the mailbox's change feed.",
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
        "description": "The ID of the message the draft replies to. Without it or forwards, the draft is a new message."
      },
      {
        "name": "forwards",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The ID of the message the draft forwards, with its text and attachments. Give answers or forwards, not both."
      },
      {
        "name": "replyAll",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "With answers, replies to all, so every other recipient of the original gets it too, except the mailbox's own addresses."
      },
      {
        "name": "to",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The recipients' addresses. A reply goes to the original's Reply-To or From unless you give them."
      },
      {
        "name": "cc",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The Cc recipients' addresses. A reply to all copies the original's Cc recipients unless you give them."
      },
      {
        "name": "bcc",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The Bcc recipients' addresses, which get the message but appear in no header."
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
        "required": false,
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
    "operationId": "deleteDraft",
    "method": "delete",
    "path": "/mailboxes/{mailbox}/drafts/{draft}",
    "routeKey": "DELETE /mailboxes/{mailbox}/drafts/{draft}",
    "summary": "Delete a draft.",
    "description": "Deleting a draft that waits for approval withdraws the request. A draft being sent can't be deleted until its send is done. Deleting a sent draft leaves the sent message in its thread. Only the mailbox's owner can delete its drafts. The deletion, and any withdrawal, is recorded in the mailbox's change feed.",
    "signIn": true,
    "command": [
      "drafts",
      "delete"
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
        "name": "cc",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The Cc recipients' addresses, in place of the draft's."
      },
      {
        "name": "bcc",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The Bcc recipients' addresses, in place of the draft's."
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
    "description": "A human's send from their own mailbox needs no approval, so Duva sends it at once, with no disclosure. An agent's send from its own mailbox needs its sponsor's approval, so the draft waits for them. Its send shows where it stands. Bcc recipients get the message, but no header names them. Only the mailbox's owner can ask, the draft needs a recipient in To, and a draft waits for one approval at a time. Asking is recorded in the mailbox's change feed.",
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
