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
    "operationId": "listOrganizationMailboxes",
    "method": "get",
    "path": "/organization/mailboxes",
    "routeKey": "GET /organization/mailboxes",
    "summary": "List every mailbox in the organization, with its addresses and the actor that owns it.",
    "description": "For giving mailboxes addresses and choosing their default address. It lists what reaches each mailbox and who owns it, and reads none of their mail, which admins can't read. Only admins can list the organization's mailboxes.",
    "signIn": true,
    "command": [
      "organization",
      "mailboxes"
    ],
    "options": []
  },
  {
    "operationId": "listOrganizationAgents",
    "method": "get",
    "path": "/organization/agents",
    "routeKey": "GET /organization/agents",
    "summary": "List every agent in the organization, with its sponsor.",
    "description": "For seeing who sponsors which agent, and removing agents. Only admins can list the organization's agents. A human lists the agents they sponsor with agents list.",
    "signIn": true,
    "command": [
      "organization",
      "agents"
    ],
    "options": []
  },
  {
    "operationId": "getOrganizationSettings",
    "method": "get",
    "path": "/organization/settings",
    "routeKey": "GET /organization/settings",
    "summary": "Read the organization's settings.",
    "description": "Every actor can read them. Only admins change them.",
    "signIn": true,
    "command": [
      "organization",
      "settings"
    ],
    "options": []
  },
  {
    "operationId": "changeOrganizationSettings",
    "method": "patch",
    "path": "/organization/settings",
    "routeKey": "PATCH /organization/settings",
    "summary": "Change the organization's settings.",
    "description": "Give only the settings to change. A setting applies from when it changes, so turning on erasureErasesApprovals leaves the approval records of threads erased before then. A shorter retentionDays reaches back: the eraser's next daily run erases every thread that has had Trash or Spam longer than it. Preview the period first to see how many. Lowering an agent cap lowers each agent above it, each recorded as a change to its settings under you. Only admins can change the settings. Each change is recorded in the organization's change feed under you.",
    "signIn": true,
    "command": [
      "organization",
      "change-settings"
    ],
    "options": [
      {
        "name": "erasureErasesApprovals",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether erasing a thread also erases the approval records of the agents' sends in it: the draft its approver saw and any edit they made. Off by default, so the records stay as the account of what an agent sent and who approved it. Either way the mailbox's change feed keeps each decision and who made it."
      },
      {
        "name": "retentionDays",
        "in": "body",
        "type": "integer",
        "required": false,
        "description": "How many days Trash and Spam keep a thread, counted from when it got the label, before the eraser erases it for good. 30 by default, and a whole number from 7 to 365. It applies to all Trash and Spam, threads already there included."
      },
      {
        "name": "searchLanguages",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The languages the organization's mail is in, English and Swedish by default. Each search is also translated into every other one on the list, so \"kvitto\" finds an English receipt: its words go to Amazon's Nova Lite model, in the same AWS region as the mail, which adds a little time to each search. With fewer than two, searches aren't translated. Quoted phrases and subject: never are. English and Swedish mail is always indexed in its own language. Adding another, or removing it, rebuilds every mailbox's search index, embedding its mail again, and search finds less until that is done."
      },
      {
        "name": "agentSendsPerHourCap",
        "in": "body",
        "type": "integer",
        "required": false,
        "description": "The most sendsPerHour a sponsor can give an agent. 100 by default. Lowering it lowers each agent above it to it, recorded as a change to the agent's settings under you. Raising it raises no agent."
      },
      {
        "name": "agentNewRecipientsPerDayCap",
        "in": "body",
        "type": "integer",
        "required": false,
        "description": "The most newRecipientsPerDay a sponsor can give an agent. 50 by default. Lowering it lowers each agent above it to it, recorded as a change to the agent's settings under you. Raising it raises no agent."
      },
      {
        "name": "undoWindowSeconds",
        "in": "body",
        "type": "integer",
        "required": false,
        "description": "How many seconds an approved send waits before the sender takes it, so its approver can undo the approval meanwhile. 30 by default, and a whole number from 0 to 120, where 0 sends at once. A change applies to approvals from then on. A human's own sends never wait."
      }
    ]
  },
  {
    "operationId": "previewRetention",
    "method": "get",
    "path": "/organization/settings/retention-preview",
    "routeKey": "GET /organization/settings/retention-preview",
    "summary": "Count the threads the eraser's next run would erase under a retention period.",
    "description": "Counts the threads in every mailbox's Trash and Spam that are older than retentionDays now, counted from when each got the label. With that retention period, the eraser's next daily run erases them, and any that pass it before the run. It counts threads, and reads none of them. Only admins can preview the retention period.",
    "signIn": true,
    "command": [
      "organization",
      "preview-retention"
    ],
    "options": [
      {
        "name": "retentionDays",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "The retention period to preview, in days, a whole number from 7 to 365."
      }
    ]
  },
  {
    "operationId": "getPreferences",
    "method": "get",
    "path": "/preferences",
    "routeKey": "GET /preferences",
    "summary": "Read your own preferences, such as how the web app shows times, dates and mail.",
    "description": "Only humans have preferences, and each reads only their own.",
    "signIn": true,
    "command": [
      "preferences",
      "get"
    ],
    "options": []
  },
  {
    "operationId": "changePreferences",
    "method": "patch",
    "path": "/preferences",
    "routeKey": "PATCH /preferences",
    "summary": "Change your own preferences.",
    "description": "Give only the preferences to change. They follow you to every browser you sign in from. Only humans have preferences, and each changes only their own. The CLI prints timestamps as ISO 8601 whatever they are.",
    "signIn": true,
    "command": [
      "preferences",
      "change"
    ],
    "options": [
      {
        "name": "hourCycle",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "How the web app shows times. Locale, the default, follows the browser's language. h12 shows 12-hour time, as 2:30 PM, and h23 24-hour time, as 14:30."
      },
      {
        "name": "dateFormat",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "How the web app shows dates. Locale, the default, follows the browser's language. iso shows 2026-10-05, dayMonth 5 Oct 2026 and monthDay Oct 5, 2026, with month names in the browser's language. Without the year, they show 10-05, 5 Oct and Oct 5."
      },
      {
        "name": "mailView",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "How the web app shows a message that has HTML. html, the default, shows it as its sender designed it, with known trackers removed. text shows its plain text. Either way, the human can switch each message the other way."
      },
      {
        "name": "keyboardShortcuts",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "Whether single keys work as shortcuts in the web app, such as j and k to move through a list and e to archive. on, the default, has them work anywhere but in a field. off turns them all off, for speech input or keys pressed by mistake."
      },
      {
        "name": "timeZone",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The time zone, as an IANA name, or null to remove it, as if the human never chose one. The CLI removes it with --no-timeZone.",
        "nullable": true
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
    "operationId": "changeHuman",
    "method": "patch",
    "path": "/humans/{human}",
    "routeKey": "PATCH /humans/{human}",
    "summary": "Make a human an admin, or take it away.",
    "description": "Only admins can change who is an admin, and only humans can be admins. The organization always keeps one, so taking it from the last admin is refused. The change is recorded in the organization's change feed under you.",
    "signIn": true,
    "command": [
      "humans",
      "change"
    ],
    "options": [
      {
        "name": "human",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The human's ID."
      },
      {
        "name": "admin",
        "in": "body",
        "type": "boolean",
        "required": true,
        "description": "Whether the human may change the organization's setup."
      }
    ]
  },
  {
    "operationId": "removeHuman",
    "method": "post",
    "path": "/humans/{human}/remove",
    "routeKey": "POST /humans/{human}/remove",
    "summary": "Remove a human, handing over or deleting each of their mailboxes, and remove the agents they sponsor.",
    "description": "Only admins can remove humans. Run it first with dryRun to see the human's mailboxes, their agents and the agents' mailboxes. Then say what happens to each of the human's mailboxes: handOver gives it to the human handTo, as another personal mailbox of theirs with its addresses and mail, and delete erases it. The agents are removed, so their keys stop working, and their mailboxes are erased. Erasing a mailbox erases its mail everywhere Duva keeps it, as emptying Trash does, and its approval records only if the organization's settings say so. Its addresses are freed at once. The human's Cognito user is deleted and their sessions stop working. The organization always keeps one admin, so the last admin can't be removed. Each change is recorded in the organization's change feed under you, and older entries keep naming the human and their agents by ID.",
    "signIn": true,
    "command": [
      "humans",
      "remove"
    ],
    "options": [
      {
        "name": "human",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The human's ID."
      },
      {
        "name": "dryRun",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Lists what the removal takes and removes nothing."
      },
      {
        "name": "handTo",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The ID of the human the mailboxes in handOver go to."
      },
      {
        "name": "handOver",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The IDs of the mailboxes to hand to the human handTo, with their addresses and mail."
      },
      {
        "name": "delete",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The IDs of the mailboxes to erase, with their mail."
      }
    ]
  },
  {
    "operationId": "listAgents",
    "method": "get",
    "path": "/agents",
    "routeKey": "GET /agents",
    "summary": "List the agents you sponsor, each with how many sends it has left this hour.",
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
    "operationId": "removeAgent",
    "method": "delete",
    "path": "/agents/{agent}",
    "routeKey": "DELETE /agents/{agent}",
    "summary": "Remove an agent, which stops its key working and erases its mailboxes.",
    "description": "Only the agent's sponsor and human admins can remove it, never an agent, not even an agent admin. Its sends and setup changes waiting for approval are withdrawn. Its mailboxes are erased everywhere Duva keeps their mail, as emptying Trash does, and their approval records only if the organization's settings say so. Their addresses are freed at once. The removal is recorded in the organization's change feed under you.",
    "signIn": true,
    "command": [
      "agents",
      "remove"
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
    "operationId": "changeAgent",
    "method": "patch",
    "path": "/agents/{agent}",
    "routeKey": "PATCH /agents/{agent}",
    "summary": "Make an agent you sponsor an admin, or take it away.",
    "description": "Only the agent's sponsor can, and only while they are an admin themselves to make it one. No agent can change who is an admin. An agent admin's changes to the setup wait for your approval unless you switch approvalForSetup off in its settings, and it never removes humans or agents, or changes who is an admin. It stops being an admin when you do, and its setup changes still waiting are withdrawn. The change is recorded in the organization's change feed under you.",
    "signIn": true,
    "command": [
      "agents",
      "change"
    ],
    "options": [
      {
        "name": "agent",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The agent's ID."
      },
      {
        "name": "admin",
        "in": "body",
        "type": "boolean",
        "required": true,
        "description": "Whether the agent may change the organization's setup, with its sponsor's approval unless switched off."
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
    "operationId": "pauseAgent",
    "method": "post",
    "path": "/agents/{agent}/pause",
    "routeKey": "POST /agents/{agent}/pause",
    "summary": "Pause an agent, which refuses its key and holds its approved sends until it is unpaused.",
    "description": "Only the agent's sponsor and admins can pause it. While it is paused, every call with its key is refused with 403, its approvals wait but can't be sent, and its sends already approved are held. Mail to its mailboxes keeps arriving. Pausing is recorded under you in the change feed of each of the agent's mailboxes and in the organization's. Pausing a paused agent changes nothing.",
    "signIn": true,
    "command": [
      "agents",
      "pause"
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
    "operationId": "unpauseAgent",
    "method": "post",
    "path": "/agents/{agent}/unpause",
    "routeKey": "POST /agents/{agent}/unpause",
    "summary": "Unpause an agent, which lets its key work again and sends what it held.",
    "description": "Only the agent's sponsor and human admins can unpause it, never an agent. Its sends held while it was paused go out, those from each mailbox oldest first, so look at them first. Unpausing is recorded under you in the change feed of each of the agent's mailboxes and in the organization's. Unpausing an agent that isn't paused changes nothing.",
    "signIn": true,
    "command": [
      "agents",
      "unpause"
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
    "operationId": "getAgentSettings",
    "method": "get",
    "path": "/agents/{agent}/settings",
    "routeKey": "GET /agents/{agent}/settings",
    "summary": "Read an agent's settings, its sponsor access, its approval and disclosure-line switches and its send limits.",
    "description": "Only the agent's sponsor and the agent itself can read them. An agent starts with no sponsor access, every switch on, and send limits of 100 an hour and 50 new recipients a day.",
    "signIn": true,
    "command": [
      "agents",
      "settings"
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
    "operationId": "changeAgentSettings",
    "method": "patch",
    "path": "/agents/{agent}/settings",
    "routeKey": "PATCH /agents/{agent}/settings",
    "summary": "Change an agent's sponsor access, its approval and disclosure-line switches, or its send limits.",
    "description": "Give only the settings to change. A change works at once. Only the agent's sponsor can change them, so not even an admin can. Each change is recorded under you, with the old and new values, in your personal mailbox's change feed, or if you have none, in the agent's. If neither of you has a mailbox, the change is refused. Sponsor access covers the mailboxes of yours that sponsorMailboxes names, or all of them while it is null. Read lets the agent read them, organize also lets it organize them and move threads to Trash and back, draft also lets it draft there, and send also lets it send as you. Lowering access from send, or taking a mailbox out of sponsorMailboxes, withdraws the agent's sends waiting for your approval there, recorded in its change feed under you, and fails those approved but not yet gone out. Its drafts and sent messages stay. Send limits go up to the organization's caps, and raising one lets its sends that wait go out as far as the new limit allows.",
    "signIn": true,
    "command": [
      "agents",
      "change-settings"
    ],
    "options": [
      {
        "name": "agent",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The agent's ID."
      },
      {
        "name": "sponsorAccess",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The agent's access to its sponsor's personal mailboxes, those sponsorMailboxes names. None, the default, gives it none. Read lets it read everything there: threads, labels, drafts, the change feed and attachments. Organize also lets it organize, decide in the Screener, set threads aside and move them to Trash and back. Draft also lets it write and change any draft there. Send also lets it send as its sponsor. Only the sponsor empties their Trash."
      },
      {
        "name": "sponsorMailboxes",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The IDs of your mailboxes that the agent's sponsor access covers. Null, the default, covers every mailbox you own. The CLI sets it back to null with --no-sponsorMailboxes.",
        "nullable": true
      },
      {
        "name": "approvalForOwnMailbox",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether the agent's sends from its own mailbox wait for its sponsor's approval. On by default."
      },
      {
        "name": "approvalAsSponsor",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether the agent's sends as its sponsor, from the sponsor's mailbox, wait for the sponsor's approval. On by default."
      },
      {
        "name": "disclosureLineForOwnMailbox",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether mail the agent sends from its own mailbox carries the disclosure's visible line. It always carries the Duva-Agent header. On by default."
      },
      {
        "name": "disclosureLineAsSponsor",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether mail the agent sends as its sponsor carries the disclosure's visible line. It always carries the Duva-Agent header. On by default."
      },
      {
        "name": "sendsPerHour",
        "in": "body",
        "type": "integer",
        "required": false,
        "description": "How many messages the agent sends in any hour, from all its mailboxes and as its sponsor. 100 by default, and up to the organization's agentSendsPerHourCap. A send counts when it goes out, and one over the limit waits."
      },
      {
        "name": "newRecipientsPerDay",
        "in": "body",
        "type": "integer",
        "required": false,
        "description": "How many new recipients the agent sends to in any 24 hours: addresses it hasn't sent to before, from any mailbox. 50 by default, and up to the organization's agentNewRecipientsPerDayCap. A send counts when it goes out, and one over the limit waits. A message with more new recipients than the whole limit waits until its sponsor sends it now."
      },
      {
        "name": "approvalForSetup",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether the agent's changes to the organization's setup, as an admin, wait for its sponsor's approval. On by default."
      }
    ]
  },
  {
    "operationId": "getAgentActivity",
    "method": "get",
    "path": "/agents/{agent}/activity",
    "routeKey": "GET /agents/{agent}/activity",
    "summary": "Read an agent's daily summaries, how much it sent, had approved or rejected, received, organized and screened each day.",
    "description": "Gives every day from from to to, newest first, each day in your time zone, days without activity included. Leave both out for the last 30 days. Activity reaches back to the agent's start: what happened in its mailboxes, what it did in its sponsor's mailbox, and the organization's changes to it. Only the agent's sponsor and admins can read it.",
    "signIn": true,
    "command": [
      "agents",
      "activity"
    ],
    "options": [
      {
        "name": "agent",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The agent's ID."
      },
      {
        "name": "from",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "The first day, as YYYY-MM-DD. Defaults to 29 days before to."
      },
      {
        "name": "to",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "The last day, as YYYY-MM-DD, at most 366 days after from. Defaults to today in your time zone."
      },
      {
        "name": "timeZone",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "The time zone days are in, an IANA name such as Europe/Stockholm. Defaults to your timeZone preference, or UTC if you have none."
      }
    ]
  },
  {
    "operationId": "getAgentActivityDay",
    "method": "get",
    "path": "/agents/{agent}/activity/{day}",
    "routeKey": "GET /agents/{agent}/activity/{day}",
    "summary": "Read an agent's timeline for one day, everything it did and what happened in its mailboxes, newest first.",
    "description": "Lists the day's entries a page at a time, newest first. Each is a change as the change feed recorded it, with the mailbox it was in and its thread, where it has them. To read the next page, call again with the answer's next as after, until an answer has no next. Only the agent's sponsor and admins can read it. An admin who isn't the sponsor reads no part of what the mail says, so the changes leave out approvers' edits and notes, label names, and senders' and recipients' addresses.",
    "signIn": true,
    "command": [
      "agents",
      "timeline"
    ],
    "options": [
      {
        "name": "agent",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The agent's ID."
      },
      {
        "name": "day",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The day, as YYYY-MM-DD, in your time zone."
      },
      {
        "name": "timeZone",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "The time zone days are in, an IANA name such as Europe/Stockholm. Defaults to your timeZone preference, or UTC if you have none."
      },
      {
        "name": "limit",
        "in": "query",
        "type": "integer",
        "required": false,
        "description": "How many entries a page lists at most."
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
    "operationId": "askForAccess",
    "method": "post",
    "path": "/access-requests",
    "routeKey": "POST /access-requests",
    "summary": "Ask a human for access as a new agent, and get the code they approve it by.",
    "description": "Answers without sign-in, since the agent has no key yet. Show the code and a link to the web app's #/access/<code> to the human who will be the agent's sponsor, then collect the key with the device code every interval seconds until they approve or decline. The code works for 10 minutes and once. duva login --agent does all of this. An address asks for at most 10 codes in 10 minutes.",
    "signIn": false,
    "command": [
      "access-requests",
      "ask"
    ],
    "options": [
      {
        "name": "name",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The agent's name. Without one, it is named for its host."
      },
      {
        "name": "host",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The name of the computer the agent runs on, which the human sees."
      },
      {
        "name": "mailboxes",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The addresses of the mailboxes it asks for. Without them, it asks for every mailbox of the human who approves."
      },
      {
        "name": "wants",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The sponsor access the agent asks for, read unless it says."
      }
    ]
  },
  {
    "operationId": "collectAccess",
    "method": "post",
    "path": "/access-requests/collect",
    "routeKey": "POST /access-requests/collect",
    "summary": "Collect the agent's key once a human approved its access request.",
    "description": "Answers without sign-in. Gives the agent and its key once, after the human approved, with 200. While the request waits it answers 202, so ask again after the interval. Once the human declined it answers 403, and once the request expired or its key was collected, 404.",
    "signIn": false,
    "command": [
      "access-requests",
      "collect"
    ],
    "options": [
      {
        "name": "deviceCode",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The device code asking for access gave."
      }
    ]
  },
  {
    "operationId": "getAccessRequest",
    "method": "get",
    "path": "/access-requests/{code}",
    "routeKey": "GET /access-requests/{code}",
    "summary": "Read an agent's access request by the code it shows, to approve or decline it.",
    "description": "Only humans read access requests. It lists each of your mailboxes, with whether the agent asked for it. A human who gives 10 codes in 10 minutes that no request waits with gets 429 until the 10 minutes are over, so codes can't be guessed.",
    "signIn": true,
    "command": [
      "access-requests",
      "show"
    ],
    "options": [
      {
        "name": "code",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The code the agent shows, as BCDF-GHJK. Case and the dash don't matter."
      }
    ]
  },
  {
    "operationId": "approveAccessRequest",
    "method": "post",
    "path": "/access-requests/{code}/approve",
    "routeKey": "POST /access-requests/{code}/approve",
    "summary": "Approve an agent's access request, which makes you its sponsor and gives it the access you choose.",
    "description": "Only humans approve. Give only what you change from what the agent asked: its name, its sponsor access, the mailboxes of yours it covers, and the approval and disclosure-line switches for its sends as you, both on unless you switch them off. Approving creates the agent, with you as its sponsor, recorded in the organization's change feed, and its settings, recorded in your mailboxes' change feeds. The agent then collects its key once. A request is approved or declined once, within 10 minutes.",
    "signIn": true,
    "command": [
      "access-requests",
      "approve"
    ],
    "options": [
      {
        "name": "code",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The code the agent shows, as BCDF-GHJK. Case and the dash don't matter."
      },
      {
        "name": "name",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The agent's name, the one it asked for unless you give another."
      },
      {
        "name": "sponsorAccess",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The agent's access to its sponsor's personal mailboxes, those sponsorMailboxes names. None, the default, gives it none. Read lets it read everything there: threads, labels, drafts, the change feed and attachments. Organize also lets it organize, decide in the Screener, set threads aside and move them to Trash and back. Draft also lets it write and change any draft there. Send also lets it send as its sponsor. Only the sponsor empties their Trash."
      },
      {
        "name": "sponsorMailboxes",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The IDs of the sponsor's mailboxes that the agent's sponsor access covers, each one the sponsor owns."
      },
      {
        "name": "approvalAsSponsor",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether the agent's sends as its sponsor, from the sponsor's mailbox, wait for the sponsor's approval. On by default."
      },
      {
        "name": "disclosureLineAsSponsor",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Whether mail the agent sends as its sponsor carries the disclosure's visible line. It always carries the Duva-Agent header. On by default."
      }
    ]
  },
  {
    "operationId": "declineAccessRequest",
    "method": "post",
    "path": "/access-requests/{code}/decline",
    "routeKey": "POST /access-requests/{code}/decline",
    "summary": "Decline an agent's access request, so it gets no key.",
    "description": "Only humans decline. A request is approved or declined once, within 10 minutes.",
    "signIn": true,
    "command": [
      "access-requests",
      "decline"
    ],
    "options": [
      {
        "name": "code",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The code the agent shows, as BCDF-GHJK. Case and the dash don't matter."
      }
    ]
  },
  {
    "operationId": "listAddresses",
    "method": "get",
    "path": "/addresses",
    "routeKey": "GET /addresses",
    "summary": "List the organization's addresses, each with the mailbox it delivers to.",
    "description": "Only admins can list the organization's addresses.",
    "signIn": true,
    "command": [
      "addresses",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "addAddress",
    "method": "post",
    "path": "/addresses",
    "routeKey": "POST /addresses",
    "summary": "Give a mailbox another address on one of the organization's standalone domains.",
    "description": "Mail to the address, and to its plus-tagged addresses, reaches the mailbox from then on, as does mail to the same address on each of the domain's alias domains. A mailbox that had no address takes it as its default address. Only admins can add addresses, and an address in use is refused. Adding an address is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "addresses",
      "add"
    ],
    "options": [
      {
        "name": "address",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The address, on one of the organization's standalone domains, without a plus tag. Its alias domains mirror it."
      },
      {
        "name": "mailbox",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The ID of the mailbox it delivers to."
      }
    ]
  },
  {
    "operationId": "removeAddress",
    "method": "delete",
    "path": "/addresses/{address}",
    "routeKey": "DELETE /addresses/{address}",
    "summary": "Remove an address, so that its mail is refused from now on.",
    "description": "SES refuses mail to the address, and its plus-tagged addresses, at once, and the address can be given to any mailbox at once. The mail its mailbox already has stays there. If it was the mailbox's default address, the mailbox's earliest other address becomes its default. A mailbox left with no address keeps its mail, but receives and sends no new mail until it is given one. Only admins can remove addresses. Removing an address, and any change of default address it makes, are changes to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "addresses",
      "remove"
    ],
    "options": [
      {
        "name": "address",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The address, without a plus tag. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "listGroups",
    "method": "get",
    "path": "/groups",
    "routeKey": "GET /groups",
    "summary": "List the organization's groups, with their members.",
    "description": "Only admins can list the organization's groups.",
    "signIn": true,
    "command": [
      "groups",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "createGroup",
    "method": "post",
    "path": "/groups",
    "routeKey": "POST /groups",
    "summary": "Create a group, an address that delivers a copy of each message to every member.",
    "description": "Members are addresses: the organization's own, of mailboxes or other groups, and external addresses. Each local member's mailbox gets its own copy, marked with the group, which skips its Screener. A member that is a group gives its members a copy too, and each mailbox gets one copy however many ways it is a member. External members get the copy re-sent from the group's address, as \"Alice via team\", with Reply-To as the group's replyTo says. Mail from a sender the group's sendPolicy doesn't allow is bounced. Only admins can create groups. Creating one is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "groups",
      "create"
    ],
    "options": [
      {
        "name": "address",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The group's address, on one of the organization's standalone domains, without a plus tag. Its alias domains mirror it."
      },
      {
        "name": "members",
        "in": "body",
        "type": "strings",
        "required": true,
        "description": "The members' addresses, in lower case: the organization's addresses, of mailboxes or other groups, and external addresses. A member on the organization's domains must be one of its addresses, without a plus tag."
      },
      {
        "name": "sendPolicy",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "Who may send to the group, by the From of their mail. Anyone, the default, lets everyone. Organization lets only senders on the organization's domains. Members lets only the group's members, its nested groups' included, from any address of a member's mailbox. A From on the organization's domains counts only if the mail passed DMARC, and any other only if it didn't fail it. Mail from anyone else is bounced."
      },
      {
        "name": "replyTo",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "Where external members' replies to the copies re-sent to them go. Sender, the default, sends them to the original sender, and group to the group."
      }
    ]
  },
  {
    "operationId": "getGroup",
    "method": "get",
    "path": "/groups/{group}",
    "routeKey": "GET /groups/{group}",
    "summary": "Read a group, with its members.",
    "description": "Only admins can read the organization's groups.",
    "signIn": true,
    "command": [
      "groups",
      "get"
    ],
    "options": [
      {
        "name": "group",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The group's address. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "deleteGroup",
    "method": "delete",
    "path": "/groups/{group}",
    "routeKey": "DELETE /groups/{group}",
    "summary": "Delete a group, so that mail to its address is refused from now on.",
    "description": "SES refuses mail to the group's address at once, and the address can be given to a mailbox or another group at once. The copies its members got stay theirs. Only admins can delete groups. Deleting one is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "groups",
      "delete"
    ],
    "options": [
      {
        "name": "group",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The group's address. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "changeGroup",
    "method": "patch",
    "path": "/groups/{group}",
    "routeKey": "PATCH /groups/{group}",
    "summary": "Change a group's members, who may send to it, or where external members' replies go.",
    "description": "Give only what to change. Members you give replace the group's members. A change works for mail that arrives from then on. Only admins can change groups, and each change is recorded in the organization's change feed under you.",
    "signIn": true,
    "command": [
      "groups",
      "change"
    ],
    "options": [
      {
        "name": "group",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The group's address. Case doesn't matter."
      },
      {
        "name": "members",
        "in": "body",
        "type": "strings",
        "required": false,
        "description": "The members' addresses, in lower case: the organization's addresses, of mailboxes or other groups, and external addresses. A member on the organization's domains must be one of its addresses, without a plus tag."
      },
      {
        "name": "sendPolicy",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "Who may send to the group, by the From of their mail. Anyone, the default, lets everyone. Organization lets only senders on the organization's domains. Members lets only the group's members, its nested groups' included, from any address of a member's mailbox. A From on the organization's domains counts only if the mail passed DMARC, and any other only if it didn't fail it. Mail from anyone else is bounced."
      },
      {
        "name": "replyTo",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "Where external members' replies to the copies re-sent to them go. Sender, the default, sends them to the original sender, and group to the group."
      }
    ]
  },
  {
    "operationId": "listDomains",
    "method": "get",
    "path": "/domains",
    "routeKey": "GET /domains",
    "summary": "List the organization's domains, each with its DNS records and SES's verification.",
    "description": "Each record's status is looked up when you ask: missing until DNS answers with its value, found once it does, and verified once SES has verified what the record is for, unless DNS answers with another value. Only admins can list the organization's domains.",
    "signIn": true,
    "command": [
      "domains",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "addDomain",
    "method": "post",
    "path": "/domains",
    "routeKey": "POST /domains",
    "summary": "Add a domain to the organization, standalone or an alias of one of its standalone domains.",
    "description": "Duva creates the domain's SES identity, with DKIM and its MAIL FROM domain, mail.<domain>, and answers with the DNS records to add at the domain's DNS provider. Duva doesn't change anyone's DNS. SES verifies the domain once its records are live, and the domain shows each record's status and SES's verification as they come. A standalone domain's addresses are its own. An alias domain mirrors every address of the standalone domain given as aliasOf, those added later too: mail to name@alias reaches the mailbox of name@standalone, and replies to it go out from name@alias. Only admins can add domains, and a domain the organization has, or one with an SES identity Duva didn't create, is refused. Adding a domain is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "domains",
      "add"
    ],
    "options": [
      {
        "name": "domain",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The domain. International domains can be given as they are written."
      },
      {
        "name": "aliasOf",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The standalone domain it mirrors, to make it an alias domain. Without it the domain is a standalone domain."
      }
    ]
  },
  {
    "operationId": "getDomain",
    "method": "get",
    "path": "/domains/{domain}",
    "routeKey": "GET /domains/{domain}",
    "summary": "Show one of the organization's domains, with its DNS records and SES's verification.",
    "description": "Each record's status is looked up when you ask, so call it again to see SES verify the domain once its records are live. Only admins can read the organization's domains.",
    "signIn": true,
    "command": [
      "domains",
      "get"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "changeDomain",
    "method": "patch",
    "path": "/domains/{domain}",
    "routeKey": "PATCH /domains/{domain}",
    "summary": "Send sign-in codes from one of the organization's domains.",
    "description": "Sign-in codes come from no-reply@<domain>. The domain must be one SES has verified. Choosing it changes Cognito's sender at once, and duva deploy keeps it. The domain sign-in codes come from can't be removed, so choose another one before removing it. Only admins can choose, and the choice is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "domains",
      "change"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      },
      {
        "name": "signIn",
        "in": "body",
        "type": "boolean",
        "required": true,
        "description": "Sends sign-in codes from the domain from now on. To stop, choose another domain."
      }
    ]
  },
  {
    "operationId": "removeDomain",
    "method": "post",
    "path": "/domains/{domain}/remove",
    "routeKey": "POST /domains/{domain}/remove",
    "summary": "Remove a domain with its addresses, and its alias domains if it is a standalone domain.",
    "description": "Run it first with dryRun to see the domains it removes, the addresses that stop receiving mail and the mailboxes left without an address. Removing a standalone domain removes its addresses, deleting the groups among them, and its alias domains with the addresses they mirror, since an alias domain mirrors nothing without it. The addresses that stop working leave every group they are members of. Removing an alias domain removes only what it mirrors. SES refuses mail to those addresses at once, and the domains' SES identities are deleted. The mail the mailboxes have stays. A mailbox left with no address keeps its mail, but receives and sends no new mail until it is given one. The domain sign-in codes come from can't be removed, so choose another one first. Only admins can remove domains. Each removal, and each address removed, is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "domains",
      "remove"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      },
      {
        "name": "dryRun",
        "in": "body",
        "type": "boolean",
        "required": false,
        "description": "Lists what the removal takes and removes nothing."
      }
    ]
  },
  {
    "operationId": "setCatchAll",
    "method": "put",
    "path": "/domains/{domain}/catch-all",
    "routeKey": "PUT /domains/{domain}/catch-all",
    "summary": "Set a standalone domain's catch-all, a mailbox or a group, for mail to addresses the organization doesn't have.",
    "description": "Give the mailbox's ID or the group's address. Mail to an address on the domain, or on its alias domains, that isn't one of the organization's, removed ones included, goes to the catch-all instead of being refused. A mailbox's Screener applies to it, and a group delivers it to its members, skipping their Screeners, as group mail does. Deleting the mailbox or the group clears the catch-all. Only admins can set it, and each change is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "domains",
      "set-catch-all"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      },
      {
        "name": "mailbox",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The ID of the mailbox that gets the mail, its Screener applying."
      },
      {
        "name": "group",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The address of the group whose members get the mail, skipping their Screeners."
      }
    ]
  },
  {
    "operationId": "clearCatchAll",
    "method": "delete",
    "path": "/domains/{domain}/catch-all",
    "routeKey": "DELETE /domains/{domain}/catch-all",
    "summary": "Clear a domain's catch-all, so that mail to addresses the organization doesn't have is refused again.",
    "description": "SES refuses such mail on the domain and its alias domains at once. Mail the catch-all already got stays. Only admins can clear it, and clearing it is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "domains",
      "clear-catch-all"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "getDomainLogo",
    "method": "get",
    "path": "/domains/{domain}/logo",
    "routeKey": "GET /domains/{domain}/logo",
    "summary": "Show a domain's BIMI logo, its default._bimi record with its status, and every mailbox's logo on the domain.",
    "description": "Receivers that honor BIMI show the domain's logo beside its mail once DNS has the record and the domain's DMARC policy is quarantine or reject. Each record's status is looked up when you ask. Each mailbox that has a logo of its own is listed with its selector, its owner and the record it needs on the domain. Only admins can read it.",
    "signIn": true,
    "command": [
      "domains",
      "get-logo"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "setDomainLogo",
    "method": "put",
    "path": "/domains/{domain}/logo",
    "routeKey": "PUT /domains/{domain}/logo",
    "summary": "Set a domain's BIMI logo, which Duva converts to SVG Tiny PS and serves at a public URL.",
    "description": "The logo's URL stays the same when you set another logo, so its record does too. Setting another logo removes its mark certificate, since that vouches for the logo it carries. Only admins can set it, and it is a change to the organization's setup.",
    "signIn": true,
    "command": [
      "domains",
      "set-logo"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      },
      {
        "name": "svg",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The logo, as the text of an SVG file. Duva converts it to SVG Tiny PS, the profile BIMI asks for: square, titled, and with nothing that runs or fetches, of at most 32 KB. A logo that is SVG Tiny PS already is served byte for byte, so a mark certificate issued for it matches. A picture such as a PNG can't be converted. From the CLI, give a file's text, as --svg \"$(cat logo.svg)\"."
      }
    ]
  },
  {
    "operationId": "removeDomainLogo",
    "method": "delete",
    "path": "/domains/{domain}/logo",
    "routeKey": "DELETE /domains/{domain}/logo",
    "summary": "Remove a domain's BIMI logo, and its mark certificate, so Duva no longer serves them.",
    "description": "Remove the domain's default._bimi record from DNS too, since receivers find nothing at its URL from then on. Only admins can remove it, and it is a change to the organization's setup.",
    "signIn": true,
    "command": [
      "domains",
      "remove-logo"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "setLogoCertificate",
    "method": "put",
    "path": "/domains/{domain}/logo/certificate",
    "routeKey": "PUT /domains/{domain}/logo/certificate",
    "summary": "Attach a VMC or CMC to a domain's logo, by its URL or as a PEM file Duva serves.",
    "description": "Receivers such as Gmail show a logo only with a mark certificate, a VMC or CMC from a Mark Verifying Authority, which the record's a= tag gives. Give its https URL, or its PEM, the certificate and the ones that issued it. Duva serves a PEM only if it vouches for the domain and for the very logo Duva serves, and takes a URL as given. Only admins can attach one, and it is a change to the organization's setup.",
    "signIn": true,
    "command": [
      "domains",
      "set-logo-certificate"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      },
      {
        "name": "url",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "Where the VMC or CMC is served, over https."
      },
      {
        "name": "pem",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The VMC or CMC in PEM, followed by the certificates that issued it. From the CLI, give a file's text, as --pem \"$(cat vmc.pem)\"."
      }
    ]
  },
  {
    "operationId": "removeLogoCertificate",
    "method": "delete",
    "path": "/domains/{domain}/logo/certificate",
    "routeKey": "DELETE /domains/{domain}/logo/certificate",
    "summary": "Remove the VMC or CMC from a domain's logo.",
    "description": "The logo stays. Only admins can remove the certificate, and it is a change to the organization's setup.",
    "signIn": true,
    "command": [
      "domains",
      "remove-logo-certificate"
    ],
    "options": [
      {
        "name": "domain",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The domain. Case doesn't matter."
      }
    ]
  },
  {
    "operationId": "getMailboxLogo",
    "method": "get",
    "path": "/mailboxes/{mailbox}/logo",
    "routeKey": "GET /mailboxes/{mailbox}/logo",
    "summary": "Show your mailbox's own BIMI logo, its selector, and the record each of its domains needs.",
    "description": "Only some receivers honor a mailbox's own logo. Others show the domain's. Once DNS has the record on the domain a message comes from, Duva adds BIMI-Selector to the mail the mailbox sends from its own addresses. Only the human who owns the mailbox can read it.",
    "signIn": true,
    "command": [
      "mailboxes",
      "get-logo"
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
    "operationId": "setMailboxLogo",
    "method": "put",
    "path": "/mailboxes/{mailbox}/logo",
    "routeKey": "PUT /mailboxes/{mailbox}/logo",
    "summary": "Set your mailbox's own BIMI logo, in place of the domain's, which Duva converts to SVG Tiny PS and serves at a public URL.",
    "description": "Duva gives the mailbox a selector the first time. Ask an admin to add the records the answer lists, one for each domain the mailbox sends from. The logo's URL stays the same when you set another logo. Only the human who owns the mailbox can set it.",
    "signIn": true,
    "command": [
      "mailboxes",
      "set-logo"
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
        "name": "svg",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The logo, as the text of an SVG file. Duva converts it to SVG Tiny PS, the profile BIMI asks for: square, titled, and with nothing that runs or fetches, of at most 32 KB. A logo that is SVG Tiny PS already is served byte for byte, so a mark certificate issued for it matches. A picture such as a PNG can't be converted. From the CLI, give a file's text, as --svg \"$(cat logo.svg)\"."
      }
    ]
  },
  {
    "operationId": "removeMailboxLogo",
    "method": "delete",
    "path": "/mailboxes/{mailbox}/logo",
    "routeKey": "DELETE /mailboxes/{mailbox}/logo",
    "summary": "Remove your mailbox's own logo, so its mail shows the domain's again.",
    "description": "Duva stops adding BIMI-Selector to its mail and serving the logo. The records for its selector can go from DNS. Only the human who owns the mailbox can remove it.",
    "signIn": true,
    "command": [
      "mailboxes",
      "remove-logo"
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
    "operationId": "listMailboxes",
    "method": "get",
    "path": "/mailboxes",
    "routeKey": "GET /mailboxes",
    "summary": "List the mailboxes you can read, your own and those of the agents you sponsor.",
    "description": "An agent your sponsor gives sponsor access also finds your sponsor's personal mailbox here, listed with that access.",
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
    "summary": "Create a personal mailbox for a human or an agent, with an address on one of the organization's standalone domains.",
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
        "description": "The mailbox's first address, its default address, on one of the organization's standalone domains, without a plus tag."
      }
    ]
  },
  {
    "operationId": "getMailbox",
    "method": "get",
    "path": "/mailboxes/{mailbox}",
    "routeKey": "GET /mailboxes/{mailbox}",
    "summary": "Read a mailbox you can read, with how many threads in its Inbox are unread.",
    "description": "Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access can read it.",
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
    "operationId": "changeMailbox",
    "method": "patch",
    "path": "/mailboxes/{mailbox}",
    "routeKey": "PATCH /mailboxes/{mailbox}",
    "summary": "Choose a mailbox's default address among its addresses.",
    "description": "New mail goes from the default address. Replies still go from the address the original was sent to. Only admins can choose it, and the choice is a change to the organization's setup, recorded in its change feed under you.",
    "signIn": true,
    "command": [
      "mailboxes",
      "change"
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
        "name": "defaultAddress",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "The mailbox's new default address, one of its addresses."
      }
    ]
  },
  {
    "operationId": "listMailboxChanges",
    "method": "get",
    "path": "/mailboxes/{mailbox}/changes",
    "routeKey": "GET /mailboxes/{mailbox}/changes",
    "summary": "List the changes in a mailbox after a position in its change feed.",
    "description": "Lists up to 100 changes, oldest first, leaving out the arrivals of mail judged to be spam unless asked for them. To catch up, call again with the position the answer ends at until it lists no more. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access can read it.",
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
    "description": "Marks each thread read. Read state belongs to the mailbox, so it is the same for each actor who reads it. Each thread that was unread gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can mark its threads.",
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
    "description": "Marks each thread unread, so it stands out until it is read again. Each thread that was read gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can mark its threads.",
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
    "description": "Adds and removes the labels on each thread. Archiving removes inbox, and adding inbox moves a thread back to the Inbox, out of Spam, Trash and the Screener. Adding spam or trash takes a thread out of the Inbox. Removing spam (not spam) or trash (restore) puts it back in the Inbox, unless it still has the other, waits in the Screener, or inbox is removed too. Each thread whose labels change gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can label its threads.",
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
    "operationId": "remindThreads",
    "method": "post",
    "path": "/mailboxes/{mailbox}/threads/remind",
    "routeKey": "POST /mailboxes/{mailbox}/threads/remind",
    "summary": "Set threads in a mailbox aside until a time, when they come back to the Inbox.",
    "description": "Remind me: each thread leaves the Inbox, if it is there, and waits in Remind me until the time, given as at or as a preset. Then it comes back to the top of the Inbox, unread, with a Back mark naming when it was set aside. New mail in the thread brings it back early. A thread already set aside gets the new time. A thread in Spam or Trash, or waiting in the Screener, can't be set aside. Each thread gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can set its threads aside.",
    "signIn": true,
    "command": [
      "threads",
      "remind"
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
        "name": "at",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "When the threads come back, to the second, at least a minute from now."
      },
      {
        "name": "preset",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "A time counted from now, in the time zone: laterToday is three hours from now, on the hour after, tomorrowMorning is 8:00 tomorrow, and nextWeek is 8:00 next Monday."
      },
      {
        "name": "timeZone",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The time zone a preset is counted in, as an IANA name. Left out, it is your time zone preference, for an agent its sponsor's, or UTC if they chose none."
      }
    ]
  },
  {
    "operationId": "cancelReminders",
    "method": "post",
    "path": "/mailboxes/{mailbox}/threads/remind/cancel",
    "routeKey": "POST /mailboxes/{mailbox}/threads/remind/cancel",
    "summary": "Cancel the reminders of threads in a mailbox, which puts them back in the Inbox.",
    "description": "Each thread set aside in Remind me goes back to the Inbox now, at its own place and without a Back mark. Threads not set aside are left as they are. Each thread whose reminder is cancelled gets a change in the mailbox's change feed, naming you. Only those who can set the mailbox's threads aside can cancel their reminders.",
    "signIn": true,
    "command": [
      "threads",
      "cancel-reminder"
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
    "operationId": "listReminders",
    "method": "get",
    "path": "/mailboxes/{mailbox}/reminders",
    "routeKey": "GET /mailboxes/{mailbox}/reminders",
    "summary": "List the threads set aside in a mailbox's Remind me, the soonest back first.",
    "description": "Lists the threads waiting in Remind me a page at a time, the one that comes back soonest first, each with its reminder. To read the next page, call again with the answer's next as after, until an answer has no next.",
    "signIn": true,
    "command": [
      "threads",
      "reminders"
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
    "operationId": "searchMailbox",
    "method": "get",
    "path": "/mailboxes/{mailbox}/search",
    "routeKey": "GET /mailboxes/{mailbox}/search",
    "summary": "Search a mailbox's threads by words, meaning and filters.",
    "description": "Finds the threads whose messages have every word in q, or mean what its words say, best first. Each comes with the message that matched best and a snippet of its text where the words stand. A \"quoted phrase\" or subject: matches by its words alone, and every filter holds. Subjects, senders and recipients by name and address, message text and attachment names are searched, Sent included. A word also finds its other forms in English and Swedish, as invoice finds invoices and faktura finds fakturan. Threads in Spam and Trash, and those waiting in the Screener, are left out unless q has label:spam or label:trash. New mail is found within a minute, and label and read changes count at once. Only those who can read the mailbox can search it. To read the next page, call again with the answer's next as after.",
    "signIn": true,
    "command": [
      "search"
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
        "name": "q",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "What to search for: words, \"quoted phrases\", and the filters from: and to: (part of a name or address), subject: (a word or quoted phrase in the subject), label: (a label's name, quoted if it has spaces), has:attachment, is:unread, after: (received on or after the day) and before: (received before the day), with days as YYYY-MM-DD in UTC. Every phrase and filter must hold.\n"
      },
      {
        "name": "sort",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "Best first, or newest first. Without words or phrases, both are newest first."
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
    "description": "Lists the built-in labels inbox, feed, paperTrail, spam and trash first, then the mailbox's own labels by name. Only those who can read the mailbox can list its labels.",
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
    "description": "Creates a label of the mailbox's own, with a name no other label in it has, in any case. Then add it to threads by its ID. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can create its labels. The change is recorded in the mailbox's change feed, naming you.",
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
    "description": "Removes the label from each of its threads, each with a change in the mailbox's change feed, and then deletes it. The threads stay. Senders whose mail was filed under it go to the Inbox from then on. The built-in labels can't be deleted. If deleting stops partway, delete the label again to finish. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can delete its labels.",
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
    "description": "Gives the label a name no other label in the mailbox has, in any case. Its threads keep it. The built-in labels can't be renamed. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can rename its labels. The change is recorded in the mailbox's change feed, naming you.",
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
    "description": "Erases each thread that is in Trash when you call, with its messages and their raw copies, every stored version included. Erasing can't be undone. Each erased thread gets a threadErased change in the mailbox's change feed, naming you, with none of its content. Duva erases the threads right after answering, and finishes on its next daily run if that fails. Only the mailbox's owner can empty its Trash, and an agent's sponsor its agent's. An agent never empties its sponsor's Trash, whatever its sponsor access. Without emptying, Trash and Spam are erased after the organization's retention period, counted from when a thread got the label.",
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
    "operationId": "getScreener",
    "method": "get",
    "path": "/mailboxes/{mailbox}/screener",
    "routeKey": "GET /mailboxes/{mailbox}/screener",
    "summary": "Read a mailbox's Screener, with the first-time senders whose mail waits there.",
    "description": "Lists each sender whose mail waits, newest first, with their waiting threads, newest first. Mail waiting in the Screener is in no other listing and no unread count. Says whether the Screener is on, and how many senders the mailbox has decided where mail goes for. Deciding where a waiting sender's mail goes takes their threads out of it. Only those who can read the mailbox can read its Screener.",
    "signIn": true,
    "command": [
      "screener",
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
    "operationId": "switchScreener",
    "method": "patch",
    "path": "/mailboxes/{mailbox}/screener",
    "routeKey": "PATCH /mailboxes/{mailbox}/screener",
    "summary": "Switch a mailbox's Screener on or off.",
    "description": "Turning it off moves every waiting thread to the Inbox. Turning it on decides the Inbox for every address mail in the mailbox is from, except mail in Spam and addresses at a domain decided on, so no sender the mailbox already has waits. A human's mailbox starts with it on, an agent's with it off. Switching is recorded in the mailbox's change feed under you. Only the mailbox's owner, and an agent's sponsor for its agent's mailbox, can switch it.",
    "signIn": true,
    "command": [
      "screener",
      "switch"
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
        "name": "on",
        "in": "body",
        "type": "boolean",
        "required": true,
        "description": "True to switch the Screener on, false to switch it off."
      }
    ]
  },
  {
    "operationId": "listSenders",
    "method": "get",
    "path": "/mailboxes/{mailbox}/senders",
    "routeKey": "GET /mailboxes/{mailbox}/senders",
    "summary": "List the senders a mailbox has decided where mail goes for.",
    "description": "Each address and domain, with its delivery, when it was set and by whom, newest first. Only those who can read the mailbox can list them.",
    "signIn": true,
    "command": [
      "senders",
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
    "operationId": "getSender",
    "method": "get",
    "path": "/mailboxes/{mailbox}/senders/{sender}",
    "routeKey": "GET /mailboxes/{mailbox}/senders/{sender}",
    "summary": "Read a sender's sheet in a mailbox, with where their mail goes now.",
    "description": "Says how many threads the mailbox has from them, Spam and Trash included, their name as their newest thread gives it, where their new mail goes now, and the decision that sends it there: the mailbox's on their address, or else on their domain. Only those who can read the mailbox can read it.",
    "signIn": true,
    "command": [
      "senders",
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
        "name": "sender",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The sender's address, like grace@example.org, or a domain, like example.org, for everyone at exactly that domain. Case doesn't matter.\n"
      }
    ]
  },
  {
    "operationId": "setSenderDelivery",
    "method": "put",
    "path": "/mailboxes/{mailbox}/senders/{sender}",
    "routeKey": "PUT /mailboxes/{mailbox}/senders/{sender}",
    "summary": "Decide where a sender's mail goes in a mailbox, for their mail there and their later mail.",
    "description": "inbox puts their mail in the Inbox. feed and paperTrail file it in the Feed or the Paper Trail instead, read. label files it under the mailbox's own label you give, unread, instead of the Inbox. nowhere drops their later mail on arrival, keeping none of it, and erases their threads in the mailbox, Spam and Trash included, for good. Removing nowhere later brings none of it back. Their threads where their mail went before, or waiting in the Screener, move to where it goes now, and keep the labels given by hand. Their later mail skips the Screener, even while it is off. A domain covers exactly that domain, not its subdomains, and can't be a public mail provider's, like gmail.com. An address's decision beats its domain's. Setting nowhere also unsubscribes the mailbox from the sender's mail by one-click (RFC 8058), when their newest mail that SES didn't judge to be spam offers it and a DKIM signature that passed covers its unsubscribe headers, and each message dropped later tries the same. Duva never unsubscribes by mailto or by a link in the body. The decision, each thread it moves or erases and the unsubscribe's outcome are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can decide, and only the owner or the sponsor can choose nowhere.",
    "signIn": true,
    "command": [
      "senders",
      "set"
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
        "name": "sender",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The sender's address, like grace@example.org, or a domain, like example.org, for everyone at exactly that domain. Case doesn't matter.\n"
      },
      {
        "name": "delivery",
        "in": "body",
        "type": "string",
        "required": true,
        "description": "Where a sender's mail goes. inbox: the Inbox. feed: the Feed, for newsletters, read. paperTrail: the Paper Trail, for receipts and notifications, read. label: a label of the mailbox's own, unread, instead of the Inbox. nowhere: dropped on arrival, keeping none of it.\n"
      },
      {
        "name": "label",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "For label, the ID of the mailbox's own label to file their mail under."
      }
    ]
  },
  {
    "operationId": "removeSenderDelivery",
    "method": "delete",
    "path": "/mailboxes/{mailbox}/senders/{sender}",
    "routeKey": "DELETE /mailboxes/{mailbox}/senders/{sender}",
    "summary": "Remove a mailbox's decision on a sender, so they are first-time again.",
    "description": "Their later mail waits in the Screener again, unless the mailbox has written to them, or a decision on their domain covers them. Their threads where their mail went move to where it goes now, the Inbox unless their domain's decision says otherwise. Mail nowhere dropped doesn't come back. The removal and each thread it moves are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can remove decisions.",
    "signIn": true,
    "command": [
      "senders",
      "remove"
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
        "name": "sender",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The sender's address, like grace@example.org, or a domain, like example.org, for everyone at exactly that domain. Case doesn't matter.\n"
      }
    ]
  },
  {
    "operationId": "getAttachment",
    "method": "get",
    "path": "/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}",
    "routeKey": "GET /mailboxes/{mailbox}/messages/{message}/attachments/{attachment}",
    "summary": "Get a short-lived link that downloads one of a message's attachments.",
    "description": "Duva takes the attachment from the stored message when the link is followed, so nothing is stored twice. The link works for 5 minutes, for whoever follows it, so keep it to yourself. Only those who can read the mailbox get one: its owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access.",
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
    "description": "Only those who can read the mailbox can list them.",
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
    "description": "A reply goes from the address the original was sent to, plus tag kept, or from the default address if the mailbox no longer has it, to the original's Reply-To or, without one, its From, with the subject carrying a single \"Re: \" prefix. A reply to your own message goes to its recipients instead. A reply to all also goes to every other recipient of the original, except the mailbox's own addresses. A forward goes from the address the original was sent to, to whoever you give, with the subject carrying a single \"Fwd: \" prefix, the original's text quoted and its attachments, from the same address a reply would. A new message goes from the mailbox's default address. Give from to choose another of the mailbox's addresses, or a group the mailbox's owner is a local member of, to send as the group. Only its members can, so any other group gets 403. A reply to group mail goes from the member's own address unless you give the group. A mailbox with no address can't draft. A draft can be saved before it has recipients, a subject or text, but it needs a recipient in To to be sent. Only the mailbox's owner can draft in it, and for a human's mailbox the agents they give draft sponsor access or more, whose drafts go from the same addresses as the human's own. Writing a draft is recorded in the mailbox's change feed, naming you.",
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
        "name": "from",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The address to send from: one of the mailbox's addresses, or a group its owner is a local member of, to send as the group. A reply or a forward goes from the address the original was sent to unless you give one, and a new message from the default address."
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
    "description": "Only those who can read the mailbox can read it.",
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
    "description": "Deleting a draft that waits for approval withdraws the request. A draft being sent can't be deleted until its send is done. Deleting a sent draft leaves the sent message in its thread. Only the mailbox's owner can delete its drafts, and for a human's mailbox the agents they give draft sponsor access or more, whoever wrote the draft. The deletion, and any withdrawal, is recorded in the mailbox's change feed, naming you.",
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
    "summary": "Change a draft's From, recipients, subject or text.",
    "description": "Changing a draft that waits for approval withdraws the request, so an approver never approves text they didn't see. Ask to send it again once it is ready. From can be one of the mailbox's addresses, or a group the mailbox's owner is a local member of, and any other group gets 403. Only the mailbox's owner can edit its drafts, and for a human's mailbox the agents they give draft sponsor access or more, whoever wrote the draft. The change, and any withdrawal, is recorded in the mailbox's change feed, naming you.",
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
        "name": "from",
        "in": "body",
        "type": "string",
        "required": false,
        "description": "The address to send from, in place of the draft's: one of the mailbox's addresses, or a group its owner is a local member of."
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
    "description": "A human's send from their own mailbox needs no approval, so Duva sends it at once, with no disclosure, also when their agent wrote the draft. An agent's send waits for its sponsor's approval unless the sponsor switched that off, separately for its own mailbox and for its sponsor's. With send sponsor access, an agent sends as its sponsor from the sponsor's mailbox: from the draft's address, under the sponsor's name. Every message an agent sends carries the Duva-Agent header, and a visible line unless its sponsor switched that off for where it sends from. Its send shows where it stands. Bcc recipients get the message, but no header names them. Only the mailbox's owner, and an agent with send sponsor access to it, can ask. The draft needs a recipient in To, and a draft waits for one approval at a time. It goes only from an address the mailbox still has, so a draft from an address since removed fails. A draft from a group goes out from the group's address, as any send does, and only while the mailbox's owner is still a local member: otherwise asking gets 403, and a send asked before fails. Each other local member's mailbox then gets a copy, in the thread of the message it answers, marked with who sent it as the group. External members get none. A send that needs no approval withdraws the request the draft waits for, if it waits. Asking is recorded in the mailbox's change feed. An agent's approved send over its send limits waits, as waitingForLimit, and goes out by itself, oldest first, as the limits allow, or when its sponsor sends it now. Humans have no send limits.",
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
    "operationId": "sendDraftNow",
    "method": "post",
    "path": "/mailboxes/{mailbox}/drafts/{draft}/send-now",
    "routeKey": "POST /mailboxes/{mailbox}/drafts/{draft}/send-now",
    "summary": "Send a draft waiting for an agent's send limits now, past the limits.",
    "description": "Only the agent's sponsor can, for one draft at a time, and the agent's limits stay as they are. The send still counts toward them. A paused agent's send is held until it is unpaused. Sending now is recorded in the mailbox's change feed under you, and the draft's send shows sending, then sent or failed. A draft that isn't waitingForLimit is 409.",
    "signIn": true,
    "command": [
      "drafts",
      "send-now"
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
    "operationId": "listAlerts",
    "method": "get",
    "path": "/alerts",
    "routeKey": "GET /alerts",
    "summary": "List your agents' alerts, newest first, with how many you haven't seen.",
    "description": "An alert tells a sponsor that one of their agents needs them: a send that failed, bounced or drew a complaint, its send limit reached, its key used while paused, a pause, limit change or removal by an admin, or a pause by Duva. A human lists the alerts about the agents they sponsor, and an agent those about itself, as its sponsor sees them. Urgent alerts are also mailed to the sponsor's own mailbox, if they have one. Removing an agent keeps its alerts. To read the next page, call again with the answer's next as after, until an answer has no next.",
    "signIn": true,
    "command": [
      "alerts",
      "list"
    ],
    "options": [
      {
        "name": "agent",
        "in": "query",
        "type": "string",
        "required": false,
        "description": "List only the alerts about this agent."
      },
      {
        "name": "limit",
        "in": "query",
        "type": "integer",
        "required": false,
        "description": "How many alerts a page lists at most."
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
    "operationId": "markAlertsSeen",
    "method": "post",
    "path": "/alerts/seen",
    "routeKey": "POST /alerts/seen",
    "summary": "Mark alerts seen, so they no longer count as unseen.",
    "description": "Only the sponsor marks their alerts seen. IDs of alerts that aren't yours, or no longer exist, are left alone.",
    "signIn": true,
    "command": [
      "alerts",
      "mark-seen"
    ],
    "options": [
      {
        "name": "alerts",
        "in": "body",
        "type": "strings",
        "required": true,
        "description": "The IDs of the alerts."
      }
    ]
  },
  {
    "operationId": "listApprovals",
    "method": "get",
    "path": "/approvals",
    "routeKey": "GET /approvals",
    "summary": "List the approvals waiting for you, newest first, sends with their drafts and setup changes with their previews.",
    "description": "An agent's sends wait for its sponsor, from its own mailbox and as its sponsor from theirs, so a sponsor sees those of every agent they sponsor. Each approval's mailbox tells which. The setup changes of agents they made admins wait for them too, each with a preview of what it does.",
    "signIn": true,
    "command": [
      "approvals",
      "list"
    ],
    "options": []
  },
  {
    "operationId": "listApprovalLog",
    "method": "get",
    "path": "/approvals/log",
    "routeKey": "GET /approvals/log",
    "summary": "List the decisions on your agents' sends, newest first, each with what became of it.",
    "description": "The approval log: every decision on a send one of your agents asked you for, newest first, with who decided it and when, and how it went: approved and on its way, sent, failed, unclear, or rejected with its note. Each entry links to its thread, and says how the decision can be taken back, if it can. It reaches as far back as approval records are kept (ADR-0014). An undone approval waits again, so it leaves the log until it is decided again. To read the next page, call again with the answer's next as after, until an answer has no next.",
    "signIn": true,
    "command": [
      "approvals",
      "log"
    ],
    "options": [
      {
        "name": "limit",
        "in": "query",
        "type": "integer",
        "required": false,
        "description": "How many entries a page lists at most."
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
    "operationId": "sendApproval",
    "method": "post",
    "path": "/approvals/{approval}/send",
    "routeKey": "POST /approvals/{approval}/send",
    "summary": "Send a draft waiting for your approval, as is or with your changes.",
    "description": "Give recipients, a subject or text to send your version instead of the agent's. Duva then sends it through SES from the draft's address, as a reply in the thread if it is one. Every message an agent sends carries the Duva-Agent header, naming the agent and the human it acts for, also when you changed it, and a line that says so after the text unless you switched that off for the agent. The draft's send shows sending, then sent or failed with the reason. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. A rejected approval can still be sent after all, while its draft is as the agent asked it: once the agent changed it, deleted it or asked again, that is 409. The decision, with any edits, is recorded in the mailbox's change feed under you, and the send under the agent. While the agent is paused, its approvals wait and can't be sent, which is 409. The draft then waits the organization's undo window, undoWindowSeconds, before the sender takes it, and you can undo the approval until then. Held after that while the agent is paused, or by its send limits, it stays approved.",
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
  },
  {
    "operationId": "undoApproval",
    "method": "post",
    "path": "/approvals/{approval}/undo",
    "routeKey": "POST /approvals/{approval}/undo",
    "summary": "Undo an approved send during the undo window, so it waits for your approval again.",
    "description": "An approved send waits the organization's undo window, undoWindowSeconds, before the sender takes it, as the draft's undoUntil says. Until then its approver can undo the approval: the draft waits for approval again as the agent asked it, without your edits, and nothing is sent. Once the window is over, or the sender took it, that is 409, and mail that went out can't be called back. Only the approver can undo. Undoing is recorded in the mailbox's change feed under you.",
    "signIn": true,
    "command": [
      "approvals",
      "undo"
    ],
    "options": [
      {
        "name": "approval",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The approval's ID."
      }
    ]
  },
  {
    "operationId": "getSetupApproval",
    "method": "get",
    "path": "/setup-approvals/{approval}",
    "routeKey": "GET /setup-approvals/{approval}",
    "summary": "Read a setup change an agent admin asked for, and what became of it.",
    "description": "Only the agent that asked and its sponsor, who decides, can read it.",
    "signIn": true,
    "command": [
      "setup-approvals",
      "get"
    ],
    "options": [
      {
        "name": "approval",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The approval's ID."
      }
    ]
  },
  {
    "operationId": "approveSetup",
    "method": "post",
    "path": "/setup-approvals/{approval}/approve",
    "routeKey": "POST /setup-approvals/{approval}/approve",
    "summary": "Approve a setup change your agent admin asked for, which makes it as the agent.",
    "description": "Duva works out the change's effect again first. If it would now do something other than its preview says, the approval waits with the new preview, and approving is refused with 409, so read it and approve again. A change that can't be made now, as when its address was taken meanwhile, is refused with 409 and keeps waiting, for you to reject. Only the agent's sponsor decides, never an agent, and only once. While the agent is paused, it can't be approved. The decision is recorded in the organization's change feed under you, and the change under the agent.",
    "signIn": true,
    "command": [
      "setup-approvals",
      "approve"
    ],
    "options": [
      {
        "name": "approval",
        "in": "path",
        "type": "string",
        "required": true,
        "description": "The approval's ID."
      }
    ]
  },
  {
    "operationId": "rejectSetup",
    "method": "post",
    "path": "/setup-approvals/{approval}/reject",
    "routeKey": "POST /setup-approvals/{approval}/reject",
    "summary": "Reject a setup change your agent admin asked for, with a note the agent sees.",
    "description": "Nothing changes. Only the agent's sponsor decides, never an agent, and only once. The decision is recorded in the organization's change feed under you.",
    "signIn": true,
    "command": [
      "setup-approvals",
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
