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
    "/humans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the organization's humans.
         * @description Only admins can list the organization's humans.
         */
        get: operations["listHumans"];
        put?: never;
        /**
         * Add a human to the organization by their email address, so they can sign in.
         * @description Only admins can add humans. The human signs in with a code emailed to the address, and has no mailbox until an admin creates one for them. Adding a human is a change to the organization's setup, recorded in its change feed.
         */
        post: operations["addHuman"];
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
    "/mailboxes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the mailboxes you can read, your own and those of the agents you sponsor. */
        get: operations["listMailboxes"];
        put?: never;
        /**
         * Create a personal mailbox for a human or an agent, with an address on the organization's domain.
         * @description Only admins can create mailboxes. The address becomes the mailbox's default address, and mail to it is accepted from then on. An admin can't read a personal mailbox they don't own, even one they created, unless they sponsor the agent that owns it. Creating the mailbox and its address are changes to the organization's setup, recorded in its change feed.
         */
        post: operations["createMailbox"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a mailbox you can read, with how many threads in its Inbox are unread.
         * @description Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.
         */
        get: operations["getMailbox"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the changes in a mailbox after a position in its change feed.
         * @description Lists up to 100 changes, oldest first, leaving out the arrivals of mail judged to be spam unless asked for them. To catch up, call again with the position the answer ends at until it lists no more. Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.
         */
        get: operations["listMailboxChanges"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/threads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the threads in a mailbox with a label, newest first.
         * @description Lists the threads a page at a time, newest first by their newest message. To read the next page, call again with the answer's next as after, until an answer has no next.
         */
        get: operations["listThreads"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/threads/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark threads in a mailbox read.
         * @description Marks each thread read. Read state belongs to the mailbox, so it is the same for each actor who reads it. Each thread that was unread gets a change in the mailbox's change feed, naming you. Only those who can read the mailbox can mark its threads.
         */
        post: operations["markThreadsRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/threads/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark threads in a mailbox unread.
         * @description Marks each thread unread, so it stands out until it is read again. Each thread that was read gets a change in the mailbox's change feed, naming you. Only those who can read the mailbox can mark its threads.
         */
        post: operations["markThreadsUnread"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/threads/{thread}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a thread, with each of its messages, oldest first. */
        get: operations["getThread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the drafts in a mailbox, newest first, with where each send stands.
         * @description Only the mailbox's owner and, for an agent's mailbox, its sponsor can list them.
         */
        get: operations["listDrafts"];
        put?: never;
        /**
         * Draft a reply to a message in a mailbox, or a new message.
         * @description A reply goes from the address the original was sent to, plus tag kept, to the original's Reply-To or, without one, its From, with the subject carrying a single "Re: " prefix. A new message goes from the mailbox's default address, and needs to and subject. Only the mailbox's owner can draft in it. Writing a draft is recorded in the mailbox's change feed.
         */
        post: operations["createDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/drafts/{draft}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a draft, with where its send stands.
         * @description Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.
         */
        get: operations["getDraft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change a draft's recipients, subject or text.
         * @description Changing a draft that waits for approval withdraws the request, so an approver never approves text they didn't see. Ask to send it again once it is ready. Only the mailbox's owner can edit its drafts. The change, and any withdrawal, is recorded in the mailbox's change feed.
         */
        patch: operations["editDraft"];
        trace?: never;
    };
    "/mailboxes/{mailbox}/drafts/{draft}/send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask for a draft to be sent.
         * @description An agent's send from its own mailbox needs its sponsor's approval, so the draft waits for them. Its send shows where it stands. Only the mailbox's owner can ask, and a draft waits for one approval at a time. Asking is recorded in the mailbox's change feed.
         */
        post: operations["sendDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the approvals waiting for you, newest first, each with its draft and the message it answers.
         * @description An agent's sends from its own mailbox wait for its sponsor, so a sponsor sees those of every agent they sponsor.
         */
        get: operations["listApprovals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/{approval}/send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a draft waiting for your approval, as is or with your changes.
         * @description Give recipients, a subject or text to send your version instead of the agent's. Duva then sends it through SES from the draft's address, as a reply in the thread if it is one. Every message an agent sends carries the Duva-Agent header, naming the agent and the human it acts for, and a line that says so after the text, also when you changed it. The draft's send shows sending, then sent or failed with SES's reason. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision, with any edits, is recorded in the mailbox's change feed under you, and the send under the agent.
         */
        post: operations["sendApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/{approval}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reject a draft waiting for your approval, with a note the agent sees.
         * @description The draft goes back to the agent with the note, and the agent can revise it and ask again. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision is recorded in the mailbox's change feed.
         */
        post: operations["rejectApproval"];
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
        NewHuman: {
            /**
             * @description The address the human signs in with.
             * @example grace@example.com
             */
            email: string;
        };
        HumanList: {
            humans: components["schemas"]["Human"][];
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
        NewMailbox: {
            /** @description The ID of the human or agent that owns the mailbox. */
            owner: string;
            /**
             * @description The mailbox's address, on the organization's domain, without a plus tag.
             * @example hermes@example.com
             */
            address: string;
        };
        /** @description A store of received and sent mail, reached through its addresses. */
        Mailbox: {
            /** @description The mailbox's ID, which never changes. */
            id: string;
            /**
             * @description Personal mailboxes are owned by one actor.
             * @constant
             */
            kind: "personal";
            /** @description The ID of the actor that owns the mailbox. */
            owner: string;
            /**
             * @description The address the mailbox sends new messages from.
             * @example hermes@example.com
             */
            defaultAddress: string;
        };
        /** @description A mailbox, with how many of its threads want attention. */
        MailboxWithCounts: {
            /** @description The mailbox's ID, which never changes. */
            id: string;
            /**
             * @description Personal mailboxes are owned by one actor.
             * @constant
             */
            kind: "personal";
            /** @description The ID of the actor that owns the mailbox. */
            owner: string;
            /**
             * @description The address the mailbox sends new messages from.
             * @example hermes@example.com
             */
            defaultAddress: string;
            /**
             * @description How many threads in the Inbox are unread.
             * @example 3
             */
            unread: number;
        };
        MailboxList: {
            mailboxes: components["schemas"]["Mailbox"][];
        };
        MailboxChangePage: {
            changes: components["schemas"]["MailboxChange"][];
            /** @description The position of the last change read, listed or left out, or the one asked for if there were none. Pass it as after to continue. */
            position: number;
        };
        /** @description A change in a mailbox. */
        MailboxChange: components["schemas"]["MessageReceived"] | components["schemas"]["DraftWritten"] | components["schemas"]["DraftChanged"] | components["schemas"]["ApprovalAsked"] | components["schemas"]["ApprovalWithdrawn"] | components["schemas"]["ApprovalDecided"] | components["schemas"]["MessageSent"] | components["schemas"]["SendFailed"] | components["schemas"]["SendUnclear"] | components["schemas"]["ThreadRead"] | components["schemas"]["ThreadUnread"];
        /** @description Mail arrived. No actor made this change, so it names none. */
        MessageReceived: {
            /** @description The change's position in the mailbox's feed, counting from 1. */
            position: number;
            /**
             * Format: date-time
             * @description When the mail arrived.
             */
            at: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "messageReceived";
            /** @description The ID of the thread the message is in. */
            thread: string;
            /** @description The message's ID. */
            message: string;
            /**
             * @description Present when the mail was judged to be spam, so its thread has the Spam label instead of Inbox.
             * @constant
             */
            spam?: true;
        };
        DraftWritten: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "draftWritten";
            /** @description The draft's ID. */
            draft: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "draftWritten";
        };
        DraftChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "draftChanged";
            /** @description The draft's ID. */
            draft: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "draftChanged";
        };
        ApprovalAsked: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "approvalAsked";
            /** @description The ID of the draft to send. */
            draft: string;
            /** @description The ID of the approval it waits for. */
            approval: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "approvalAsked";
        };
        ApprovalWithdrawn: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "approvalWithdrawn";
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the approval withdrawn. */
            approval: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "approvalWithdrawn";
        };
        ApprovalDecided: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "approvalDecided";
            /** @description The draft's ID. */
            draft: string;
            /** @description The approval's ID. */
            approval: string;
            /** @enum {string} */
            decision: "approved" | "rejected";
            edits?: components["schemas"]["Edits"];
            /** @description The approver's note, with a rejection. */
            note?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "approvalDecided";
        };
        MessageSent: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "messageSent";
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the thread the sent message is in. */
            thread: string;
            /** @description The sent message's ID. */
            message: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "messageSent";
        };
        SendFailed: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "sendFailed";
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the approval that let it go. */
            approval: string;
            /** @description SES's reason. */
            reason: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "sendFailed";
        };
        SendUnclear: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "sendUnclear";
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the approval that let it go. */
            approval: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "sendUnclear";
        };
        ThreadRead: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "threadRead";
            /** @description The ID of the thread marked read. */
            thread: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "threadRead";
        };
        ThreadUnread: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "threadUnread";
            /** @description The ID of the thread marked unread. */
            thread: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "threadUnread";
        };
        NewDraft: {
            /** @description The ID of the message the draft replies to. Without it, the draft is a new message. */
            answers?: string;
            /**
             * @description The recipients' addresses. A reply goes to the original's Reply-To or From unless you give them.
             * @example [
             *       "grace@example.org"
             *     ]
             */
            to?: string[];
            /** @description The subject. A reply's is the original's with "Re: " unless you give one. */
            subject?: string;
            /** @description The plain-text body. */
            text: string;
        };
        DraftChanges: {
            /** @description The recipients' addresses, in place of the draft's. */
            to?: string[];
            /** @description The subject, in place of the draft's. */
            subject?: string;
            /** @description The plain-text body. */
            text?: string;
        };
        ApproverEdits: {
            /**
             * @description The recipients' addresses, in place of the draft's.
             * @example [
             *       "grace@example.org"
             *     ]
             */
            to?: string[];
            /** @description The subject, in place of the draft's. */
            subject?: string;
            /** @description The plain-text body, in place of the draft's. */
            text?: string;
        };
        /** @description What the approver changed before sending. */
        Edits: {
            to?: components["schemas"]["EmailAddress"][];
            subject?: string;
            text?: string;
        };
        /** @description A message a mailbox's owner is writing. */
        Draft: {
            /** @description The draft's ID. */
            id: string;
            /** @description The ID of the message the draft replies to, if it is a reply. */
            answers?: string;
            /** @description The ID of the thread of the message it replies to, if it is a reply. */
            thread?: string;
            /**
             * @description The address it goes from.
             * @example hermes+news@example.com
             */
            from: string;
            to: components["schemas"]["EmailAddress"][];
            subject: string;
            /** @description The plain-text body. */
            text: string;
            /**
             * Format: date-time
             * @description When the draft was written or last changed.
             */
            updatedAt: string;
            send?: components["schemas"]["SendStatus"];
        };
        /** @description Where the draft's latest request to send stands. A draft never asked to send has none. */
        SendStatus: {
            /** @description The ID of the approval the request needs. */
            approval: string;
            /**
             * @description waiting for approval; withdrawn because the draft changed while it waited; rejected, with the approver's note; approved, and about to be sent; sending; sent, as the message in its thread; failed, with SES's reason; or unclear, when sending stopped before SES answered, so a human checks whether it went out, by its recipients and subject, since only SES's answer gives its Message-ID. Duva never sends an unclear draft again. An approved draft can't change, but a rejected or failed one can be revised and asked again.
             * @enum {string}
             */
            state: "waiting" | "withdrawn" | "rejected" | "approved" | "sending" | "sent" | "failed" | "unclear";
            /** @description The approver's note, if they rejected it. */
            note?: string;
            /**
             * @description SES's reason, if it refused the message.
             * @example Email address is not verified.
             */
            reason?: string;
            /** @description The ID of the thread the sent message is in, once sent. */
            thread?: string;
            /** @description The sent message's ID in Duva, once sending starts. */
            message?: string;
            /**
             * @description The Message-ID header the recipients see, which SES gave the message, once sent.
             * @example <011001a10373c801-a8e8167e-887a-40a0-a0f7-62c78ecf7270-000000@eu-north-1.amazonses.com>
             */
            messageId?: string;
        };
        DraftList: {
            drafts: components["schemas"]["Draft"][];
        };
        /** @description A request to send a draft, waiting for or decided by its approver. */
        Approval: {
            /** @description The approval's ID. */
            id: string;
            /** @enum {string} */
            state: "pending" | "withdrawn" | "rejected" | "approved";
            /** @description The ID of the mailbox the draft is in. */
            mailbox: string;
            /** @description The ID of the agent that asked. */
            agent: string;
            /** @description The ID of the human who decides, the agent's sponsor. */
            approver: string;
            draft: components["schemas"]["ApprovalDraft"];
            /** @description The message the draft replies to, if it is a reply. */
            original?: components["schemas"]["Message"];
            /** Format: date-time */
            askedAt: string;
            /** Format: date-time */
            decidedAt?: string;
            edits?: components["schemas"]["Edits"];
            /** @description The approver's note, if they rejected it. */
            note?: string;
        };
        /** @description The draft as it was when the agent asked, which is what the approver decides on. */
        ApprovalDraft: {
            /** @description The draft's ID. */
            id: string;
            /** @description The ID of the message the draft replies to, if it is a reply. */
            answers?: string;
            /** @description The ID of that message's thread. */
            thread?: string;
            from: string;
            to: components["schemas"]["EmailAddress"][];
            subject: string;
            text: string;
        };
        ApprovalList: {
            approvals: components["schemas"]["Approval"][];
        };
        Rejection: {
            /**
             * @description What the agent should change.
             * @example Say we can meet on Tuesday, not Monday.
             */
            note: string;
        };
        ThreadList: {
            threads: components["schemas"]["ThreadSummary"][];
            /** @description Present when more threads follow. Pass it as after to list the next page. */
            next?: string;
        };
        ThreadIds: {
            /** @description The IDs of the threads. */
            threads: string[];
        };
        ThreadSummary: {
            /** @description The thread's ID. */
            id: string;
            /** @description The subject of the thread's first message. */
            subject: string;
            /** @description Who sent the thread's first message. */
            from: components["schemas"]["EmailAddress"];
            /**
             * @description The start of the newest message's text, on one line, without quoted lines.
             * @example Here are my notes on the compiler.
             */
            snippet: string;
            /**
             * @description The thread's labels.
             * @example [
             *       "inbox"
             *     ]
             */
            labels: string[];
            /** @description Whether any message in the thread is unread. */
            unread: boolean;
            /**
             * Format: date-time
             * @description When the thread's newest message arrived.
             */
            latestAt: string;
            /** @description How many messages the thread has. */
            messages: number;
        };
        Thread: {
            /** @description The thread's ID. */
            id: string;
            /** @description The subject of the thread's first message. */
            subject: string;
            /**
             * @description The thread's labels.
             * @example [
             *       "inbox"
             *     ]
             */
            labels: string[];
            /** @description Whether any message in the thread is unread. Reading the thread doesn't change it. Mark the thread read for that. */
            unread: boolean;
            messages: components["schemas"]["Message"][];
        };
        Message: {
            /** @description The message's ID in Duva. */
            id: string;
            /**
             * @description The Message-ID header the sender gave it, if any.
             * @example <CAF1234@mail.example.org>
             */
            messageId?: string;
            from: components["schemas"]["EmailAddress"];
            to: components["schemas"]["EmailAddress"][];
            cc: components["schemas"]["EmailAddress"][];
            /**
             * @description The mailbox's address the message was delivered to, or sent from, with its plus tag.
             * @example hermes+news@example.com
             */
            recipient: string;
            /**
             * @description The plus tag of the address the message was delivered to, if it had one.
             * @example news
             */
            plusTag?: string;
            subject: string;
            /**
             * Format: date-time
             * @description When the sender says it was sent, or when it arrived if the sender doesn't say.
             */
            date: string;
            /**
             * Format: date-time
             * @description When the message arrived, or when SES accepted it for sending.
             */
            receivedAt: string;
            /** @description The ID of the actor who sent the message from the mailbox, if it did. */
            sentBy?: string;
            /** @description Who approved the message before it was sent, if an agent sent it. */
            approval?: components["schemas"]["SentApproval"];
            /** @description The plain-text body. Mail with only HTML is turned into text. */
            text: string;
            attachments: components["schemas"]["Attachment"][];
        };
        /** @description The approval a sent message went out with. */
        SentApproval: {
            /** @description The approval's ID. */
            id: string;
            /** @description The ID of the human who approved it. */
            approver: string;
            /** Format: date-time */
            approvedAt: string;
            edits?: components["schemas"]["Edits"];
        };
        EmailAddress: {
            /**
             * @description The display name, if the message gives one.
             * @example Grace Hopper
             */
            name?: string;
            /** @example grace@example.org */
            address: string;
        };
        Attachment: {
            /**
             * @description The attachment's file name, if the message gives one.
             * @example report.pdf
             */
            name?: string;
            /**
             * @description The attachment's media type.
             * @example application/pdf
             */
            type: string;
            /** @description The attachment's size in bytes, decoded. */
            size: number;
        };
        ChangePage: {
            changes: components["schemas"]["OrganizationChange"][];
            /** @description The position of the last change listed, or the one asked for if none were. Pass it as after to continue. */
            position: number;
        };
        /** @description A change to the organization's setup. */
        OrganizationChange: components["schemas"]["OrganizationAdded"] | components["schemas"]["DomainAdded"] | components["schemas"]["ActorAdded"] | components["schemas"]["AgentKeyRotated"] | components["schemas"]["MailboxAdded"] | components["schemas"]["AddressAdded"];
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
        MailboxAdded: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "mailboxAdded";
            mailbox: components["schemas"]["Mailbox"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "mailboxAdded";
        };
        AddressAdded: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "addressAdded";
            /**
             * @description The address.
             * @example hermes@example.com
             */
            address: string;
            /** @description The ID of the mailbox it delivers to. */
            mailbox: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "addressAdded";
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
    parameters: {
        /** @description The mailbox's ID. */
        Mailbox: string;
        /** @description The draft's ID. */
        Draft: string;
        /** @description The approval's ID. */
        Approval: string;
    };
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
    listHumans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization's humans. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HumanList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    addHuman: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewHuman"];
            };
        };
        responses: {
            /** @description The human. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Human"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
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
    listMailboxes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The mailboxes the signed-in actor can read. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxList"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createMailbox: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewMailbox"];
            };
        };
        responses: {
            /** @description The mailbox. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    getMailbox: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The mailbox, with its unread count. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxWithCounts"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listMailboxChanges: {
        parameters: {
            query?: {
                /** @description The position to list changes after. 0, the default, lists from the start. */
                after?: number;
                /** @description Lists the arrivals of mail judged to be spam too. */
                spam?: boolean;
            };
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
            };
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
                    "application/json": components["schemas"]["MailboxChangePage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listThreads: {
        parameters: {
            query?: {
                /** @description The label the threads carry. inbox, the default, lists the Inbox. */
                label?: string;
                /** @description How many threads a page lists at most. */
                limit?: number;
                /** @description Where the page starts, the next of the page before it. Leave it out for the first page. */
                after?: string;
            };
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the threads with the label. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    markThreadsRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThreadIds"];
            };
        };
        responses: {
            /** @description The threads, as they are now. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    markThreadsUnread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThreadIds"];
            };
        };
        responses: {
            /** @description The threads, as they are now. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getThread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The thread's ID. */
                thread: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread and its messages. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listDrafts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The mailbox's drafts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DraftList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewDraft"];
            };
        };
        responses: {
            /** @description The draft. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Draft"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The draft's ID. */
                draft: components["parameters"]["Draft"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The draft. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Draft"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    editDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The draft's ID. */
                draft: components["parameters"]["Draft"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DraftChanges"];
            };
        };
        responses: {
            /** @description The changed draft. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Draft"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    sendDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The draft's ID. */
                draft: components["parameters"]["Draft"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The draft, waiting for approval. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Draft"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listApprovals: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The approvals waiting for the signed-in actor. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalList"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    sendApproval: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The approval's ID. */
                approval: components["parameters"]["Approval"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ApproverEdits"];
            };
        };
        responses: {
            /** @description The approval, approved. Duva sends the draft next. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Approval"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    rejectApproval: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The approval's ID. */
                approval: components["parameters"]["Approval"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Rejection"];
            };
        };
        responses: {
            /** @description The approval, rejected. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Approval"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
}
