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
    "/organization/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the organization's settings.
         * @description Every actor can read them. Only admins change them.
         */
        get: operations["getOrganizationSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change the organization's settings.
         * @description Give only the settings to change. A setting applies from when it changes, so turning on erasureErasesApprovals leaves the approval records of threads erased before then. Only admins can change the settings. Each change is recorded in the organization's change feed under you.
         */
        patch: operations["changeOrganizationSettings"];
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
    "/agents/{agent}/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an agent's settings, its sponsor access and its approval and disclosure-line switches.
         * @description Only the agent's sponsor and the agent itself can read them. An agent starts with no sponsor access and every switch on.
         */
        get: operations["getAgentSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change an agent's sponsor access or its approval and disclosure-line switches.
         * @description Give only the settings to change. A change works at once. Only the agent's sponsor can change them, so not even an admin can. Each change is recorded under you, with the old and new values, in your personal mailbox's change feed, or if you have none, in the agent's. If neither of you has a mailbox, the change is refused. Read and full sponsor access let the agent read your mailbox. What else full lets it do, and the switches, take effect in later releases.
         */
        patch: operations["changeAgentSettings"];
        trace?: never;
    };
    "/mailboxes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the mailboxes you can read, your own and those of the agents you sponsor.
         * @description An agent your sponsor gives read or full sponsor access also finds your sponsor's personal mailbox here, listed with that access.
         */
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
         * @description Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access can read it.
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
         * @description Lists up to 100 changes, oldest first, leaving out the arrivals of mail judged to be spam unless asked for them. To catch up, call again with the position the answer ends at until it lists no more. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access can read it.
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
    "/mailboxes/{mailbox}/sent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the threads a mailbox has sent mail in, newest first.
         * @description Lists every thread with a message sent from the mailbox, except those in Spam and Trash, a page at a time, newest first by its newest message. To read the next page, call again with the answer's next as after, until an answer has no next.
         */
        get: operations["listSentThreads"];
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
         * @description Marks each thread read. Read state belongs to the mailbox, so it is the same for each actor who reads it. Each thread that was unread gets a change in the mailbox's change feed, naming you. Only the mailbox's owner and, for an agent's mailbox, its sponsor can mark its threads.
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
         * @description Marks each thread unread, so it stands out until it is read again. Each thread that was read gets a change in the mailbox's change feed, naming you. Only the mailbox's owner and, for an agent's mailbox, its sponsor can mark its threads.
         */
        post: operations["markThreadsUnread"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/threads/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add labels to threads in a mailbox, and remove them.
         * @description Adds and removes the labels on each thread. Archiving removes inbox, and adding inbox moves a thread back to the Inbox, out of Spam and Trash. Adding spam or trash takes a thread out of the Inbox. Removing spam (not spam) or trash (restore) puts it back in the Inbox, unless it still has the other or inbox is removed too. Each thread whose labels change gets a change in the mailbox's change feed, naming you. Only the mailbox's owner and, for an agent's mailbox, its sponsor can label its threads.
         */
        post: operations["labelThreads"];
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
    "/mailboxes/{mailbox}/all-mail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List every thread in a mailbox except those in Spam and Trash, newest first.
         * @description Lists archived threads too, a page at a time, newest first by their newest message. To read the next page, call again with the answer's next as after, until an answer has no next.
         */
        get: operations["listAllMail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a mailbox's labels, with how many unread threads each has.
         * @description Lists the built-in labels inbox, spam and trash first, then the mailbox's own labels by name. Only those who can read the mailbox can list its labels.
         */
        get: operations["listLabels"];
        put?: never;
        /**
         * Create a label in a mailbox.
         * @description Creates a label of the mailbox's own, with a name no other label in it has, in any case. Then add it to threads by its ID. Only those who can read the mailbox can create its labels. The change is recorded in the mailbox's change feed.
         */
        post: operations["createLabel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/labels/{label}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete one of a mailbox's own labels.
         * @description Removes the label from each of its threads, each with a change in the mailbox's change feed, and then deletes it. The threads stay. The built-in labels can't be deleted. If deleting stops partway, delete the label again to finish.
         */
        delete: operations["deleteLabel"];
        options?: never;
        head?: never;
        /**
         * Rename one of a mailbox's own labels.
         * @description Gives the label a name no other label in the mailbox has, in any case. Its threads keep it. The built-in labels can't be renamed. The change is recorded in the mailbox's change feed.
         */
        patch: operations["renameLabel"];
        trace?: never;
    };
    "/mailboxes/{mailbox}/trash/empty": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Empty a mailbox's Trash, erasing every thread in it for good.
         * @description Erases each thread that is in Trash when you call, with its messages and their raw copies, every stored version included. Erasing can't be undone. Each erased thread gets a threadErased change in the mailbox's change feed, naming you, with none of its content. Duva erases the threads right after answering, and finishes on its next daily run if that fails. Only the mailbox's owner can empty its Trash, and an agent's sponsor its agent's. Without emptying, Trash and Spam are erased 30 days after a thread got the label.
         */
        post: operations["emptyTrash"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a short-lived link that downloads one of a message's attachments.
         * @description Duva takes the attachment from the stored message when the link is followed, so nothing is stored twice. The link works for 5 minutes, for whoever follows it, so keep it to yourself. Only those who can read the mailbox get one: its owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access.
         */
        get: operations["getAttachment"];
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
         * @description Only those who can read the mailbox can list them.
         */
        get: operations["listDrafts"];
        put?: never;
        /**
         * Draft a reply to a message in a mailbox, a reply to all, a forward, or a new message.
         * @description A reply goes from the address the original was sent to, plus tag kept, to the original's Reply-To or, without one, its From, with the subject carrying a single "Re: " prefix. A reply to your own message goes to its recipients instead. A reply to all also goes to every other recipient of the original, except the mailbox's own addresses. A forward goes from the address the original was sent to, to whoever you give, with the subject carrying a single "Fwd: " prefix, the original's text quoted and its attachments. A new message goes from the mailbox's default address. A draft can be saved before it has recipients, a subject or text, but it needs a recipient in To to be sent. Only the mailbox's owner can draft in it. Writing a draft is recorded in the mailbox's change feed.
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
         * @description Only those who can read the mailbox can read it.
         */
        get: operations["getDraft"];
        put?: never;
        post?: never;
        /**
         * Delete a draft.
         * @description Deleting a draft that waits for approval withdraws the request. A draft being sent can't be deleted until its send is done. Deleting a sent draft leaves the sent message in its thread. Only the mailbox's owner can delete its drafts. The deletion, and any withdrawal, is recorded in the mailbox's change feed.
         */
        delete: operations["deleteDraft"];
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
         * @description A human's send from their own mailbox needs no approval, so Duva sends it at once, with no disclosure. An agent's send from its own mailbox needs its sponsor's approval, so the draft waits for them. Its send shows where it stands. Bcc recipients get the message, but no header names them. Only the mailbox's owner can ask, the draft needs a recipient in To, and a draft waits for one approval at a time. Asking is recorded in the mailbox's change feed.
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
        /** @description What an agent may do in its sponsor's personal mailbox, and which of its sends wait for approval or carry the disclosure's visible line. */
        AgentSettings: {
            sponsorAccess: components["schemas"]["SponsorAccess"];
            approvalForOwnMailbox: components["schemas"]["ApprovalForOwnMailbox"];
            approvalAsSponsor: components["schemas"]["ApprovalAsSponsor"];
            disclosureLineForOwnMailbox: components["schemas"]["DisclosureLineForOwnMailbox"];
            disclosureLineAsSponsor: components["schemas"]["DisclosureLineAsSponsor"];
        };
        /** @description The agent's settings changed, each with its new value. */
        AgentSettingsChanges: {
            sponsorAccess?: components["schemas"]["SponsorAccess"];
            approvalForOwnMailbox?: components["schemas"]["ApprovalForOwnMailbox"];
            approvalAsSponsor?: components["schemas"]["ApprovalAsSponsor"];
            disclosureLineForOwnMailbox?: components["schemas"]["DisclosureLineForOwnMailbox"];
            disclosureLineAsSponsor?: components["schemas"]["DisclosureLineAsSponsor"];
        };
        /**
         * @description The agent's access to its sponsor's personal mailbox. None, the default, gives it none. Read lets it read everything there: threads, labels, drafts, the change feed and attachments. Full also lets it organize, move threads to Trash and back, draft, and send as its sponsor, once those take effect. Only the sponsor empties their Trash.
         * @enum {string}
         */
        SponsorAccess: "none" | "read" | "full";
        /** @description Whether the agent's sends from its own mailbox wait for its sponsor's approval. On by default. */
        ApprovalForOwnMailbox: boolean;
        /** @description Whether the agent's sends as its sponsor, from the sponsor's mailbox, wait for the sponsor's approval. On by default. */
        ApprovalAsSponsor: boolean;
        /** @description Whether mail the agent sends from its own mailbox carries the disclosure's visible line. It always carries the Duva-Agent header. On by default. */
        DisclosureLineForOwnMailbox: boolean;
        /** @description Whether mail the agent sends as its sponsor carries the disclosure's visible line. It always carries the Duva-Agent header. On by default. */
        DisclosureLineAsSponsor: boolean;
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
        /** @description A mailbox you can read, with your sponsor access if it is your sponsor's. */
        ListedMailbox: {
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
             * @description For an agent, its sponsor access, present when the mailbox is its sponsor's.
             * @enum {string}
             */
            sponsorAccess?: "read" | "full";
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
            mailboxes: components["schemas"]["ListedMailbox"][];
        };
        MailboxChangePage: {
            changes: components["schemas"]["MailboxChange"][];
            /** @description The position of the last change read, listed or left out, or the one asked for if there were none. Pass it as after to continue. */
            position: number;
        };
        /** @description A change in a mailbox. */
        MailboxChange: components["schemas"]["MessageReceived"] | components["schemas"]["DraftWritten"] | components["schemas"]["DraftChanged"] | components["schemas"]["DraftDeleted"] | components["schemas"]["SendAsked"] | components["schemas"]["ApprovalAsked"] | components["schemas"]["ApprovalWithdrawn"] | components["schemas"]["ApprovalDecided"] | components["schemas"]["MessageSent"] | components["schemas"]["SendFailed"] | components["schemas"]["SendUnclear"] | components["schemas"]["ThreadRead"] | components["schemas"]["ThreadUnread"] | components["schemas"]["ThreadLabelsChanged"] | components["schemas"]["LabelCreated"] | components["schemas"]["LabelRenamed"] | components["schemas"]["LabelDeleted"] | components["schemas"]["ThreadErased"] | components["schemas"]["AgentSettingsChanged"];
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
        DraftDeleted: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "draftDeleted";
            /** @description The draft's ID. */
            draft: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "draftDeleted";
        };
        SendAsked: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "sendAsked";
            /** @description The draft's ID. */
            draft: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "sendAsked";
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
            /** @description The ID of the approval that let it go, if it needed one. */
            approval?: string;
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
            /** @description The ID of the approval that let it go, if it needed one. */
            approval?: string;
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
        ThreadLabelsChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "threadLabelsChanged";
            /** @description The ID of the thread. */
            thread: string;
            /**
             * @description The IDs of the labels the thread got.
             * @example [
             *       "trash"
             *     ]
             */
            added: string[];
            /**
             * @description The IDs of the labels the thread lost.
             * @example [
             *       "inbox"
             *     ]
             */
            removed: string[];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "threadLabelsChanged";
        };
        LabelCreated: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "labelCreated";
            /** @description The label's ID. */
            label: string;
            /** @description The label's name. */
            name: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "labelCreated";
        };
        LabelRenamed: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "labelRenamed";
            /** @description The label's ID. */
            label: string;
            /** @description The label's new name. */
            name: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "labelRenamed";
        };
        LabelDeleted: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "labelDeleted";
            /** @description The ID of the label deleted. */
            label: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "labelDeleted";
        };
        /** @description A thread was erased for good, with its messages. The change keeps none of their content. Emptying Trash names the actor who emptied it. Erasing Trash and Spam after the retention period names none. */
        ThreadErased: {
            /** @description The change's position in the mailbox's feed, counting from 1. */
            position: number;
            /**
             * Format: date-time
             * @description When the thread was erased.
             */
            at: string;
            /** @description The ID of the actor who emptied Trash, if one did. */
            actor?: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "threadErased";
            /** @description The ID of the thread erased. */
            thread: string;
        };
        AgentSettingsChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "agentSettingsChanged";
            /** @description The ID of the agent whose settings changed. */
            agent: string;
            /** @description The settings that changed, each with its old value. */
            before: components["schemas"]["AgentSettingsChanges"];
            /** @description The settings that changed, each with its new value. */
            after: components["schemas"]["AgentSettingsChanges"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agentSettingsChanged";
        };
        TrashEmptying: {
            /**
             * Format: date-time
             * @description When Trash was emptied. Every thread in Trash then is being erased.
             */
            emptiedAt: string;
        };
        NewDraft: {
            /** @description The ID of the message the draft replies to. Without it or forwards, the draft is a new message. */
            answers?: string;
            /** @description The ID of the message the draft forwards, with its text and attachments. Give answers or forwards, not both. */
            forwards?: string;
            /** @description With answers, replies to all, so every other recipient of the original gets it too, except the mailbox's own addresses. */
            replyAll?: boolean;
            /**
             * @description The recipients' addresses. A reply goes to the original's Reply-To or From unless you give them.
             * @example [
             *       "grace@example.org"
             *     ]
             */
            to?: string[];
            /** @description The Cc recipients' addresses. A reply to all copies the original's Cc recipients unless you give them. */
            cc?: string[];
            /** @description The Bcc recipients' addresses, which get the message but appear in no header. */
            bcc?: string[];
            /** @description The subject. A reply's is the original's with "Re: " unless you give one. */
            subject?: string;
            /** @description The plain-text body. */
            text?: string;
        };
        DraftChanges: {
            /** @description The recipients' addresses, in place of the draft's. */
            to?: string[];
            /** @description The Cc recipients' addresses, in place of the draft's. */
            cc?: string[];
            /** @description The Bcc recipients' addresses, in place of the draft's. */
            bcc?: string[];
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
            /** @description The ID of the message the draft forwards, if it is a forward. */
            forwards?: string;
            /** @description The ID of the thread of the message it replies to or forwards, which the sent message joins. */
            thread?: string;
            /**
             * @description The address it goes from.
             * @example hermes+news@example.com
             */
            from: string;
            to: components["schemas"]["EmailAddress"][];
            cc: components["schemas"]["EmailAddress"][];
            /** @description Recipients who get the message, but appear in no header. */
            bcc: components["schemas"]["EmailAddress"][];
            subject: string;
            /** @description The plain-text body. */
            text: string;
            /** @description The attachments it carries, those of the message it forwards, if it is a forward. */
            attachments?: components["schemas"]["Attachment"][];
            /**
             * Format: date-time
             * @description When the draft was written or last changed.
             */
            updatedAt: string;
            send?: components["schemas"]["SendStatus"];
        };
        /** @description Where the draft's latest request to send stands. A draft never asked to send has none. */
        SendStatus: {
            /** @description The ID of the approval the request needs, if it needs one. A human's send from their own mailbox needs none. */
            approval?: string;
            /**
             * @description waiting for approval; withdrawn because the draft changed while it waited; rejected, with the approver's note; approved, and about to be sent, which a human's send is at once; sending; sent, as the message in its thread; failed, with SES's reason; or unclear, when sending stopped before SES answered, so a human checks whether it went out, by its recipients and subject, since only SES's answer gives its Message-ID. Duva never sends an unclear draft again. An approved draft can't change, but a rejected or failed one can be revised and sent again.
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
            /** @description The ID of the message the draft forwards, if it is a forward. */
            forwards?: string;
            /** @description The ID of that message's thread. */
            thread?: string;
            from: string;
            to: components["schemas"]["EmailAddress"][];
            cc: components["schemas"]["EmailAddress"][];
            /** @description Recipients who get the message, but appear in no header. */
            bcc: components["schemas"]["EmailAddress"][];
            subject: string;
            text: string;
            /** @description The attachments it carries, those of the message it forwards, if it is a forward. */
            attachments?: components["schemas"]["Attachment"][];
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
        ThreadLabels: {
            /** @description The IDs of the threads. */
            threads: string[];
            /**
             * @description The IDs of the labels to add, such as inbox, spam, trash or one of the mailbox's own.
             * @example [
             *       "trash"
             *     ]
             */
            add?: string[];
            /**
             * @description The IDs of the labels to remove.
             * @example [
             *       "inbox"
             *     ]
             */
            remove?: string[];
        };
        Label: {
            /**
             * @description The label's ID, which threads list among their labels. The built-in labels' are inbox, spam and trash.
             * @example inbox
             */
            id: string;
            /**
             * @description The label's name.
             * @example Inbox
             */
            name: string;
            /** @description Whether the label is built in, so it can't be renamed or deleted. */
            builtIn: boolean;
            /** @description How many of the label's threads are unread, leaving out those in Spam and Trash unless the label is one of those. */
            unread: number;
        };
        LabelList: {
            labels: components["schemas"]["Label"][];
        };
        NewLabel: {
            /**
             * @description The label's name.
             * @example Receipts
             */
            name: string;
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
             * @description The IDs of the thread's labels.
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
            /** @description The Bcc recipients of a message sent from the mailbox, if it had any. No header names them. */
            bcc?: components["schemas"]["EmailAddress"][];
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
        AttachmentLink: {
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
            /** @description The link that downloads the attachment, for whoever follows it until it expires. */
            url: string;
            /**
             * Format: date-time
             * @description When the link stops working.
             */
            expiresAt: string;
        };
        ChangePage: {
            changes: components["schemas"]["OrganizationChange"][];
            /** @description The position of the last change listed, or the one asked for if none were. Pass it as after to continue. */
            position: number;
        };
        /** @description A change to the organization's setup. */
        OrganizationChange: components["schemas"]["OrganizationAdded"] | components["schemas"]["DomainAdded"] | components["schemas"]["ActorAdded"] | components["schemas"]["AgentKeyRotated"] | components["schemas"]["MailboxAdded"] | components["schemas"]["AddressAdded"] | components["schemas"]["SettingsChanged"];
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
        SettingsChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "settingsChanged";
            settings: components["schemas"]["SettingsChanges"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "settingsChanged";
        };
        OrganizationSettings: {
            erasureErasesApprovals: components["schemas"]["ErasureErasesApprovals"];
        };
        /** @description The settings changed, each with its new value. */
        SettingsChanges: {
            erasureErasesApprovals?: components["schemas"]["ErasureErasesApprovals"];
        };
        /** @description Whether erasing a thread also erases the approval records of the agents' sends in it: the draft its approver saw and any edit they made. Off by default, so the records stay as the account of what an agent sent and who approved it. Either way the mailbox's change feed keeps each decision and who made it. */
        ErasureErasesApprovals: boolean;
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
        /** @description The label's ID. */
        Label: string;
        /** @description The approval's ID. */
        Approval: string;
        /** @description The agent's ID. */
        Agent: string;
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
    getOrganizationSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization's settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationSettings"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    changeOrganizationSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsChanges"];
            };
        };
        responses: {
            /** @description The organization's settings, changed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationSettings"];
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
                agent: components["parameters"]["Agent"];
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
    getAgentSettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The agent's ID. */
                agent: components["parameters"]["Agent"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The agent's settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentSettings"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    changeAgentSettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The agent's ID. */
                agent: components["parameters"]["Agent"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentSettingsChanges"];
            };
        };
        responses: {
            /** @description The agent's settings, changed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentSettings"];
                };
            };
            400: components["responses"]["BadRequest"];
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
    listSentThreads: {
        parameters: {
            query?: {
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
            /** @description A page of the threads the mailbox has sent in. */
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
    labelThreads: {
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
                "application/json": components["schemas"]["ThreadLabels"];
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
    listAllMail: {
        parameters: {
            query?: {
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
            /** @description A page of the threads. */
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
    listLabels: {
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
            /** @description The labels. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createLabel: {
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
                "application/json": components["schemas"]["NewLabel"];
            };
        };
        responses: {
            /** @description The label. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    deleteLabel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The label's ID. */
                label: components["parameters"]["Label"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The label, as it was before it was deleted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    renameLabel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The label's ID. */
                label: components["parameters"]["Label"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewLabel"];
            };
        };
        responses: {
            /** @description The label, renamed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    emptyTrash: {
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
            /** @description Duva is erasing the threads. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrashEmptying"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getAttachment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The message's ID. */
                message: string;
                /** @description The attachment's place among the message's attachments, from 0. */
                attachment: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The attachment, with the link that downloads it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentLink"];
                };
            };
            400: components["responses"]["BadRequest"];
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
    deleteDraft: {
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
            /** @description The draft, as it was when it was deleted. */
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
            409: components["responses"]["Conflict"];
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
            /** @description The draft, waiting for approval, or for a human's send, approved and about to be sent. */
            202: {
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
