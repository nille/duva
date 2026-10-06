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
         * @description Give only the settings to change. A setting applies from when it changes, so turning on erasureErasesApprovals leaves the approval records of threads erased before then. A shorter retentionDays reaches back: the eraser's next daily run erases every thread that has had Trash or Spam longer than it. Preview the period first to see how many. Only admins can change the settings. Each change is recorded in the organization's change feed under you.
         */
        patch: operations["changeOrganizationSettings"];
        trace?: never;
    };
    "/organization/settings/retention-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Count the threads the eraser's next run would erase under a retention period.
         * @description Counts the threads in every mailbox's Trash and Spam that are older than retentionDays now, counted from when each got the label. With that retention period, the eraser's next daily run erases them, and any that pass it before the run. It counts threads, and reads none of them. Only admins can preview the retention period.
         */
        get: operations["previewRetention"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your own preferences, such as how the web app shows times, dates and mail.
         * @description Only humans have preferences, and each reads only their own.
         */
        get: operations["getPreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change your own preferences.
         * @description Give only the preferences to change. They follow you to every browser you sign in from. Only humans have preferences, and each changes only their own. The CLI prints timestamps as ISO 8601 whatever they are.
         */
        patch: operations["changePreferences"];
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
    "/humans/{human}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Make a human an admin, or take it away.
         * @description Only admins can change who is an admin, and only humans can be admins. The organization always keeps one, so taking it from the last admin is refused. The change is recorded in the organization's change feed under you.
         */
        patch: operations["changeHuman"];
        trace?: never;
    };
    "/humans/{human}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove a human, handing over or deleting each of their mailboxes, and remove the agents they sponsor.
         * @description Only admins can remove humans. Run it first with dryRun to see the human's mailboxes, their agents and the agents' mailboxes. Then say what happens to each of the human's mailboxes: handOver gives it to the human handTo, as another personal mailbox of theirs with its addresses and mail, and delete erases it. The agents are removed, so their keys stop working, and their mailboxes are erased. Erasing a mailbox erases its mail everywhere Duva keeps it, as emptying Trash does, and its approval records only if the organization's settings say so. Its addresses are freed at once. The human's Cognito user is deleted and their sessions stop working. The organization always keeps one admin, so the last admin can't be removed. Each change is recorded in the organization's change feed under you, and older entries keep naming the human and their agents by ID.
         */
        post: operations["removeHuman"];
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
    "/agents/{agent}": {
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
         * Remove an agent, which stops its key working and erases its mailboxes.
         * @description Only the agent's sponsor and admins can remove it. Its sends waiting for approval are withdrawn. Its mailboxes are erased everywhere Duva keeps their mail, as emptying Trash does, and their approval records only if the organization's settings say so. Their addresses are freed at once. The removal is recorded in the organization's change feed under you.
         */
        delete: operations["removeAgent"];
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
         * @description Give only the settings to change. A change works at once. Only the agent's sponsor can change them, so not even an admin can. Each change is recorded under you, with the old and new values, in your personal mailbox's change feed, or if you have none, in the agent's. If neither of you has a mailbox, the change is refused. Read lets the agent read your mailbox. Full also lets it organize it, move threads to Trash and back, draft there, and send as you. Lowering access from full, or removing it, withdraws the agent's sends waiting for your approval in your mailbox, recorded in its change feed under you, and fails those approved but not yet gone out. Its drafts and sent messages stay.
         */
        patch: operations["changeAgentSettings"];
        trace?: never;
    };
    "/addresses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the organization's addresses, each with the mailbox it delivers to.
         * @description Only admins can list the organization's addresses.
         */
        get: operations["listAddresses"];
        put?: never;
        /**
         * Give a mailbox another address on one of the organization's standalone domains.
         * @description Mail to the address, and to its plus-tagged addresses, reaches the mailbox from then on, as does mail to the same address on each of the domain's alias domains. A mailbox that had no address takes it as its default address. Only admins can add addresses, and an address in use is refused. Adding an address is a change to the organization's setup, recorded in its change feed under you.
         */
        post: operations["addAddress"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/addresses/{address}": {
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
         * Remove an address, so that its mail is refused from now on.
         * @description SES refuses mail to the address, and its plus-tagged addresses, at once, and the address can be given to any mailbox at once. The mail its mailbox already has stays there. If it was the mailbox's default address, the mailbox's earliest other address becomes its default. A mailbox left with no address keeps its mail, but receives and sends no new mail until it is given one. Only admins can remove addresses. Removing an address, and any change of default address it makes, are changes to the organization's setup, recorded in its change feed under you.
         */
        delete: operations["removeAddress"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the organization's groups, with their members.
         * @description Only admins can list the organization's groups.
         */
        get: operations["listGroups"];
        put?: never;
        /**
         * Create a group, an address that delivers a copy of each message to every member.
         * @description Members are addresses: the organization's own, of mailboxes or other groups, and external addresses. Each local member's mailbox gets its own copy, marked with the group, which skips its Screener. A member that is a group gives its members a copy too, and each mailbox gets one copy however many ways it is a member. External members get the copy re-sent from the group's address, as "Alice via team", with Reply-To as the group's replyTo says. Mail from a sender the group's sendPolicy doesn't allow is bounced. Only admins can create groups. Creating one is a change to the organization's setup, recorded in its change feed under you.
         */
        post: operations["createGroup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/groups/{group}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a group, with its members.
         * @description Only admins can read the organization's groups.
         */
        get: operations["getGroup"];
        put?: never;
        post?: never;
        /**
         * Delete a group, so that mail to its address is refused from now on.
         * @description SES refuses mail to the group's address at once, and the address can be given to a mailbox or another group at once. The copies its members got stay theirs. Only admins can delete groups. Deleting one is a change to the organization's setup, recorded in its change feed under you.
         */
        delete: operations["deleteGroup"];
        options?: never;
        head?: never;
        /**
         * Change a group's members, who may send to it, or where external members' replies go.
         * @description Give only what to change. Members you give replace the group's members. A change works for mail that arrives from then on. Only admins can change groups, and each change is recorded in the organization's change feed under you.
         */
        patch: operations["changeGroup"];
        trace?: never;
    };
    "/domains": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the organization's domains, each with its DNS records and SES's verification.
         * @description Each record's status is looked up when you ask: missing until DNS answers with its value, found once it does, and verified once SES has verified what the record is for. Only admins can list the organization's domains.
         */
        get: operations["listDomains"];
        put?: never;
        /**
         * Add a domain to the organization, standalone or an alias of one of its standalone domains.
         * @description Duva creates the domain's SES identity, with DKIM and its MAIL FROM domain, mail.<domain>, and answers with the DNS records to add at the domain's DNS provider. Duva doesn't change anyone's DNS. SES verifies the domain once its records are live, and the domain shows each record's status and SES's verification as they come. A standalone domain's addresses are its own. An alias domain mirrors every address of the standalone domain given as aliasOf, those added later too: mail to name@alias reaches the mailbox of name@standalone, and replies to it go out from name@alias. Only admins can add domains, and a domain the organization has, or one with an SES identity Duva didn't create, is refused. Adding a domain is a change to the organization's setup, recorded in its change feed under you.
         */
        post: operations["addDomain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domain}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Show one of the organization's domains, with its DNS records and SES's verification.
         * @description Each record's status is looked up when you ask, so call it again to see SES verify the domain once its records are live. Only admins can read the organization's domains.
         */
        get: operations["getDomain"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Send sign-in codes from one of the organization's domains.
         * @description Sign-in codes come from no-reply@<domain>. The domain must be one SES has verified. Choosing it changes Cognito's sender at once, and duva deploy keeps it. The domain sign-in codes come from can't be removed, so choose another one before removing it. Only admins can choose, and the choice is a change to the organization's setup, recorded in its change feed under you.
         */
        patch: operations["changeDomain"];
        trace?: never;
    };
    "/domains/{domain}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove a domain with its addresses, and its alias domains if it is a standalone domain.
         * @description Run it first with dryRun to see the domains it removes, the addresses that stop receiving mail and the mailboxes left without an address. Removing a standalone domain removes its addresses, deleting the groups among them, and its alias domains with the addresses they mirror, since an alias domain mirrors nothing without it. The addresses that stop working leave every group they are members of. Removing an alias domain removes only what it mirrors. SES refuses mail to those addresses at once, and the domains' SES identities are deleted. The mail the mailboxes have stays. A mailbox left with no address keeps its mail, but receives and sends no new mail until it is given one. The domain sign-in codes come from can't be removed, so choose another one first. Only admins can remove domains. Each removal, and each address removed, is a change to the organization's setup, recorded in its change feed under you.
         */
        post: operations["removeDomain"];
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
        /**
         * List the mailboxes you can read, your own and those of the agents you sponsor.
         * @description An agent your sponsor gives read or full sponsor access also finds your sponsor's personal mailbox here, listed with that access.
         */
        get: operations["listMailboxes"];
        put?: never;
        /**
         * Create a personal mailbox for a human or an agent, with an address on one of the organization's standalone domains.
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
        /**
         * Choose a mailbox's default address among its addresses.
         * @description New mail goes from the default address. Replies still go from the address the original was sent to. Only admins can choose it, and the choice is a change to the organization's setup, recorded in its change feed under you.
         */
        patch: operations["changeMailbox"];
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
         * @description Marks each thread read. Read state belongs to the mailbox, so it is the same for each actor who reads it. Each thread that was unread gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can mark its threads.
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
         * @description Marks each thread unread, so it stands out until it is read again. Each thread that was read gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can mark its threads.
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
         * @description Adds and removes the labels on each thread. Archiving removes inbox, and adding inbox moves a thread back to the Inbox, out of Spam, Trash and the Screener. Adding spam or trash takes a thread out of the Inbox. Removing spam (not spam) or trash (restore) puts it back in the Inbox, unless it still has the other, waits in the Screener, or inbox is removed too. Each thread whose labels change gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can label its threads.
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
    "/mailboxes/{mailbox}/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search a mailbox's threads by words, meaning and filters.
         * @description Finds the threads whose messages have every word in q, or mean what its words say, best first. Each comes with the message that matched best and a snippet of its text where the words stand. A "quoted phrase" or subject: matches by its words alone, and every filter holds. Subjects, senders and recipients by name and address, message text and attachment names are searched, Sent included. A word also finds its other forms in English and Swedish, as invoice finds invoices and faktura finds fakturan. Threads in Spam and Trash, and those waiting in the Screener, are left out unless q has label:spam or label:trash. New mail is found within a minute, and label and read changes count at once. Only those who can read the mailbox can search it. To read the next page, call again with the answer's next as after.
         */
        get: operations["searchMailbox"];
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
         * @description Creates a label of the mailbox's own, with a name no other label in it has, in any case. Then add it to threads by its ID. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can create its labels. The change is recorded in the mailbox's change feed, naming you.
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
         * @description Removes the label from each of its threads, each with a change in the mailbox's change feed, and then deletes it. The threads stay. The built-in labels can't be deleted. If deleting stops partway, delete the label again to finish. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can delete its labels.
         */
        delete: operations["deleteLabel"];
        options?: never;
        head?: never;
        /**
         * Rename one of a mailbox's own labels.
         * @description Gives the label a name no other label in the mailbox has, in any case. Its threads keep it. The built-in labels can't be renamed. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can rename its labels. The change is recorded in the mailbox's change feed, naming you.
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
         * @description Erases each thread that is in Trash when you call, with its messages and their raw copies, every stored version included. Erasing can't be undone. Each erased thread gets a threadErased change in the mailbox's change feed, naming you, with none of its content. Duva erases the threads right after answering, and finishes on its next daily run if that fails. Only the mailbox's owner can empty its Trash, and an agent's sponsor its agent's. An agent never empties its sponsor's Trash, whatever its sponsor access. Without emptying, Trash and Spam are erased after the organization's retention period, counted from when a thread got the label.
         */
        post: operations["emptyTrash"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/screener": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a mailbox's Screener, with the first-time senders whose mail waits there.
         * @description Lists each sender whose mail waits, newest first, with their waiting threads, newest first. Mail waiting in the Screener is in no other listing and no unread count. Says whether the Screener is on, and how many senders the mailbox has let in and blocked. Only those who can read the mailbox can read its Screener.
         */
        get: operations["getScreener"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Switch a mailbox's Screener on or off.
         * @description Turning it off moves every waiting thread to the Inbox. Turning it on lets in every address mail in the mailbox is from, except mail in Spam, so no sender the mailbox already has waits. A human's mailbox starts with it on, an agent's with it off. Switching is recorded in the mailbox's change feed under you. Only the mailbox's owner, and an agent's sponsor for its agent's mailbox, can switch it.
         */
        patch: operations["switchScreener"];
        trace?: never;
    };
    "/mailboxes/{mailbox}/screener/let-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Let a sender into a mailbox, moving their waiting threads to the Inbox.
         * @description Give an address, or a domain to let in everyone there. A domain covers exactly that domain, not its subdomains, and can't be a public mail provider's, like gmail.com. An address's decision beats its domain's. Their later mail skips the Screener, even while it is off. Letting in a sender the mailbox blocked replaces the block and moves their threads still in Trash to the Inbox. The decision and each thread it moves are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can decide.
         */
        post: operations["letInSender"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/screener/block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Block a sender in a mailbox, moving their waiting threads to Trash.
         * @description Give an address, or a domain to block everyone there. A domain covers exactly that domain, not its subdomains, and can't be a public mail provider's, like gmail.com. An address's decision beats its domain's. Their later mail that starts a thread goes straight to Trash, even while the Screener is off. Trash is erased after the organization's retention period, counted from when a thread got it. Blocking a sender the mailbox let in replaces that. Blocking also unsubscribes the mailbox from the sender's mail by one-click (RFC 8058), when their newest mail that SES didn't judge to be spam offers it and a DKIM signature that passed covers its unsubscribe headers. For a domain, that is the newest mail from an address there that the mailbox hasn't let in. Duva never unsubscribes by mailto or by a link in the body. The decision, each thread it moves and the unsubscribe's outcome are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can decide.
         */
        post: operations["blockSender"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/screener/senders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the senders a mailbox has let in or blocked.
         * @description Each address and domain, with its decision, when it was made and by whom, newest first. Only those who can read the mailbox can list them.
         */
        get: operations["listScreenedSenders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/screener/senders/{sender}": {
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
         * Remove a mailbox's decision on a sender, so they are first-time again.
         * @description Their later mail waits in the Screener again, unless the mailbox has written to them, or a decision on their domain covers them. Removing a block moves their threads still in Trash to the Inbox. To flip a decision instead, let them in or block them. The removal and each thread it moves are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can remove decisions.
         */
        delete: operations["removeScreenedSender"];
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
         * @description A reply goes from the address the original was sent to, plus tag kept, or from the default address if the mailbox no longer has it, to the original's Reply-To or, without one, its From, with the subject carrying a single "Re: " prefix. A reply to your own message goes to its recipients instead. A reply to all also goes to every other recipient of the original, except the mailbox's own addresses. A forward goes from the address the original was sent to, to whoever you give, with the subject carrying a single "Fwd: " prefix, the original's text quoted and its attachments, from the same address a reply would. A new message goes from the mailbox's default address. A mailbox with no address can't draft. A draft can be saved before it has recipients, a subject or text, but it needs a recipient in To to be sent. Only the mailbox's owner can draft in it, and for a human's mailbox the agents they give full sponsor access, whose drafts go from the same addresses as the human's own. Writing a draft is recorded in the mailbox's change feed, naming you.
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
         * @description Deleting a draft that waits for approval withdraws the request. A draft being sent can't be deleted until its send is done. Deleting a sent draft leaves the sent message in its thread. Only the mailbox's owner can delete its drafts, and for a human's mailbox the agents they give full sponsor access, whoever wrote the draft. The deletion, and any withdrawal, is recorded in the mailbox's change feed, naming you.
         */
        delete: operations["deleteDraft"];
        options?: never;
        head?: never;
        /**
         * Change a draft's recipients, subject or text.
         * @description Changing a draft that waits for approval withdraws the request, so an approver never approves text they didn't see. Ask to send it again once it is ready. Only the mailbox's owner can edit its drafts, and for a human's mailbox the agents they give full sponsor access, whoever wrote the draft. The change, and any withdrawal, is recorded in the mailbox's change feed, naming you.
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
         * @description A human's send from their own mailbox needs no approval, so Duva sends it at once, with no disclosure, also when their agent wrote the draft. An agent's send waits for its sponsor's approval unless the sponsor switched that off, separately for its own mailbox and for its sponsor's. With full sponsor access, an agent sends as its sponsor from the sponsor's mailbox: from the draft's address, under the sponsor's name. Every message an agent sends carries the Duva-Agent header, and a visible line unless its sponsor switched that off for where it sends from. Its send shows where it stands. Bcc recipients get the message, but no header names them. Only the mailbox's owner, and an agent with full sponsor access to it, can ask. The draft needs a recipient in To, and a draft waits for one approval at a time. It goes only from an address the mailbox still has, so a draft from an address since removed fails. A send that needs no approval withdraws the request the draft waits for, if it waits. Asking is recorded in the mailbox's change feed.
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
         * @description An agent's sends wait for its sponsor, from its own mailbox and as its sponsor from theirs, so a sponsor sees those of every agent they sponsor. Each approval's mailbox tells which.
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
         * @description Give recipients, a subject or text to send your version instead of the agent's. Duva then sends it through SES from the draft's address, as a reply in the thread if it is one. Every message an agent sends carries the Duva-Agent header, naming the agent and the human it acts for, also when you changed it, and a line that says so after the text unless you switched that off for the agent. The draft's send shows sending, then sent or failed with the reason. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision, with any edits, is recorded in the mailbox's change feed under you, and the send under the agent.
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
        HumanChanges: {
            /** @description Whether the human may change the organization's setup. */
            admin: boolean;
        };
        /** @description What happens to each of the human's mailboxes. Each is given once, in handOver or in delete. */
        HumanRemovalChoices: {
            /** @description Lists what the removal takes and removes nothing. */
            dryRun?: boolean;
            /** @description The ID of the human the mailboxes in handOver go to. */
            handTo?: string;
            /** @description The IDs of the mailboxes to hand to the human handTo, with their addresses and mail. */
            handOver?: string[];
            /** @description The IDs of the mailboxes to erase, with their mail. */
            delete?: string[];
        };
        /** @description A human's removal, and what goes with them. */
        HumanRemoval: {
            human: components["schemas"]["Human"];
            /** @description The human's personal mailboxes, each handed over or erased. */
            mailboxes: components["schemas"]["Mailbox"][];
            /** @description The agents the human sponsors, removed with them. */
            agents: components["schemas"]["Agent"][];
            /** @description The agents' mailboxes, erased with them. */
            agentMailboxes: components["schemas"]["Mailbox"][];
            /** @description Whether the human was removed, which a dry run leaves undone. */
            removed: boolean;
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
        AgentRemoval: {
            agent: components["schemas"]["Agent"];
            /** @description The agent's mailboxes, erased with it. */
            mailboxes: components["schemas"]["Mailbox"][];
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
         * @description The agent's access to its sponsor's personal mailbox. None, the default, gives it none. Read lets it read everything there: threads, labels, drafts, the change feed and attachments. Full also lets it organize, move threads to Trash and back, draft and change any draft there, and send as its sponsor. Only the sponsor empties their Trash.
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
        NewAddress: {
            /**
             * @description The address, on one of the organization's standalone domains, without a plus tag. Its alias domains mirror it.
             * @example support@example.com
             */
            address: string;
            /** @description The ID of the mailbox it delivers to. */
            mailbox: string;
        };
        /** @description An address on one of the organization's domains, and the mailbox it delivers to, or that it is a group. */
        Address: {
            /** @example support@example.com */
            address: string;
            /** @description The ID of the mailbox it delivers to. */
            mailbox?: string;
            /**
             * @description Present when the address is a group's.
             * @constant
             */
            group?: true;
        };
        AddressList: {
            addresses: components["schemas"]["Address"][];
        };
        NewGroup: {
            /**
             * @description The group's address, on one of the organization's standalone domains, without a plus tag. Its alias domains mirror it.
             * @example support@example.com
             */
            address: string;
            members: components["schemas"]["GroupMembers"];
            sendPolicy?: components["schemas"]["SendPolicy"];
            replyTo?: components["schemas"]["GroupReplyTo"];
        };
        GroupChanges: {
            members?: components["schemas"]["GroupMembers"];
            sendPolicy?: components["schemas"]["SendPolicy"];
            replyTo?: components["schemas"]["GroupReplyTo"];
        };
        /** @description An address that delivers a copy of each message to every member. */
        Group: {
            /** @example support@example.com */
            address: string;
            members: components["schemas"]["GroupMembers"];
            sendPolicy: components["schemas"]["SendPolicy"];
            replyTo: components["schemas"]["GroupReplyTo"];
        };
        GroupList: {
            groups: components["schemas"]["Group"][];
        };
        /**
         * @description The members' addresses, in lower case: the organization's addresses, of mailboxes or other groups, and external addresses. A member on the organization's domains must be one of its addresses, without a plus tag.
         * @example [
         *       "grace@example.com",
         *       "hermes@example.com",
         *       "linus@example.net"
         *     ]
         */
        GroupMembers: string[];
        /**
         * @description Who may send to the group, by the From of their mail. Anyone, the default, lets everyone. Organization lets only senders on the organization's domains. Members lets only the group's members, its nested groups' included, from any address of a member's mailbox. A From on the organization's domains counts only if the mail passed DMARC, and any other only if it didn't fail it. Mail from anyone else is bounced.
         * @enum {string}
         */
        SendPolicy: "anyone" | "organization" | "members";
        /**
         * @description Where external members' replies to the copies re-sent to them go. Sender, the default, sends them to the original sender, and group to the group.
         * @enum {string}
         */
        GroupReplyTo: "sender" | "group";
        NewDomain: {
            /**
             * @description The domain. International domains can be given as they are written.
             * @example example.net
             */
            domain: string;
            /**
             * @description The standalone domain it mirrors, to make it an alias domain. Without it the domain is a standalone domain.
             * @example example.com
             */
            aliasOf?: string;
        };
        DomainChanges: {
            /**
             * @description Sends sign-in codes from the domain from now on. To stop, choose another domain.
             * @constant
             */
            signIn: true;
        };
        /** @description One of the organization's domains, with the DNS records it needs and SES's verification of it. */
        Domain: {
            /**
             * @description The domain, in lower-case ASCII, international labels in Punycode.
             * @example example.com
             */
            domain: string;
            /**
             * @description A standalone domain's addresses are its own. An alias domain mirrors every address of its standalone domain.
             * @enum {string}
             */
            kind: "standalone" | "alias";
            /** @description The standalone domain an alias domain mirrors. */
            aliasOf?: string;
            /** @description Whether sign-in codes come from the domain, once SES has verified it. */
            signIn: boolean;
            ses: components["schemas"]["DomainVerification"];
            /** @description The DNS records the domain needs, to add at its DNS provider. A DMARC record is left out when a parent domain's covers it. */
            records: components["schemas"]["DnsRecord"][];
        };
        /** @description What SES has verified of the domain. SES checks the DNS records on its own, for up to 72 hours after the domain is added. */
        DomainVerification: {
            /** @description Whether SES has verified the domain, which mail from it needs. */
            verified: boolean;
            /**
             * @description SES's DKIM status, in words, like pending or verified.
             * @example pending
             */
            dkim: string;
            /**
             * @description SES's status of the MAIL FROM domain, in words, like pending or verified.
             * @example pending
             */
            mailFrom: string;
        };
        /** @description A DNS record the domain needs. */
        DnsRecord: {
            /** @enum {string} */
            purpose: "receiving" | "DKIM" | "MAIL FROM" | "DMARC";
            /** @enum {string} */
            type: "MX" | "TXT" | "CNAME";
            /** @example example.com */
            name: string;
            /** @example 10 inbound-smtp.eu-north-1.amazonaws.com */
            value: string;
            /**
             * @description missing until DNS answers with the value, found once it does, and verified once SES has verified what the record is for. SES never verifies receiving or DMARC records.
             * @enum {string}
             */
            status: "missing" | "found" | "verified";
            /** @description What DNS answered instead, if it has other values at the name. */
            found?: string[];
        };
        DomainList: {
            domains: components["schemas"]["Domain"][];
        };
        DomainRemovalChoices: {
            /** @description Lists what the removal takes and removes nothing. */
            dryRun?: boolean;
        };
        /** @description A domain's removal, and what goes with it. */
        DomainRemoval: {
            /** @description The domains removed, the one asked for first, then its alias domains. */
            domains: string[];
            /** @description The addresses that stop receiving mail, those its alias domains mirror included, each with its mailbox. */
            addresses: components["schemas"]["Address"][];
            /** @description The IDs of the mailboxes left with no address, which keep their mail but receive and send none until they are given one. */
            mailboxesLeftWithoutAddress: string[];
            /** @description Whether the domains were removed, which a dry run leaves undone. */
            removed: boolean;
        };
        MailboxChanges: {
            /**
             * @description The mailbox's new default address, one of its addresses.
             * @example support@example.com
             */
            defaultAddress: string;
        };
        NewMailbox: {
            /** @description The ID of the human or agent that owns the mailbox. */
            owner: string;
            /**
             * @description The mailbox's first address, its default address, on one of the organization's standalone domains, without a plus tag.
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
             * @description The address the mailbox sends new messages from, one of its addresses. Absent while it has none.
             * @example hermes@example.com
             */
            defaultAddress?: string;
            /**
             * @description The mailbox's addresses, the earliest first. Mail to each, and to its plus-tagged addresses, reaches it. A mailbox with none keeps its mail but receives and sends no new mail.
             * @example [
             *       "hermes@example.com",
             *       "support@example.com"
             *     ]
             */
            addresses: string[];
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
             * @description The address the mailbox sends new messages from, one of its addresses. Absent while it has none.
             * @example hermes@example.com
             */
            defaultAddress?: string;
            /**
             * @description The mailbox's addresses, the earliest first. Mail to each, and to its plus-tagged addresses, reaches it. A mailbox with none keeps its mail but receives and sends no new mail.
             * @example [
             *       "hermes@example.com",
             *       "support@example.com"
             *     ]
             */
            addresses: string[];
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
             * @description The address the mailbox sends new messages from, one of its addresses. Absent while it has none.
             * @example hermes@example.com
             */
            defaultAddress?: string;
            /**
             * @description The mailbox's addresses, the earliest first. Mail to each, and to its plus-tagged addresses, reaches it. A mailbox with none keeps its mail but receives and sends no new mail.
             * @example [
             *       "hermes@example.com",
             *       "support@example.com"
             *     ]
             */
            addresses: string[];
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
        MailboxChange: components["schemas"]["MessageReceived"] | components["schemas"]["DraftWritten"] | components["schemas"]["DraftChanged"] | components["schemas"]["DraftDeleted"] | components["schemas"]["SendAsked"] | components["schemas"]["ApprovalAsked"] | components["schemas"]["ApprovalWithdrawn"] | components["schemas"]["ApprovalDecided"] | components["schemas"]["MessageSent"] | components["schemas"]["SendFailed"] | components["schemas"]["SendUnclear"] | components["schemas"]["ThreadRead"] | components["schemas"]["ThreadUnread"] | components["schemas"]["ThreadLabelsChanged"] | components["schemas"]["LabelCreated"] | components["schemas"]["LabelRenamed"] | components["schemas"]["LabelDeleted"] | components["schemas"]["ThreadErased"] | components["schemas"]["AgentSettingsChanged"] | components["schemas"]["SenderScreened"] | components["schemas"]["ScreenerSwitched"] | components["schemas"]["ScreenedSenderRemoved"] | components["schemas"]["UnsubscribeAttempted"];
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
            /**
             * @description Present when the mail started a thread that skipped the Inbox: waiting when its sender is first-time, so it waits in the Screener, and blocked when the mailbox blocked its sender, so it went to Trash.
             * @enum {string}
             */
            screened?: "waiting" | "blocked";
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
        /** @description Where mail from a mailbox's first-time senders waits until an actor lets the sender in or blocks them. */
        Screener: {
            /** @description Whether mail from first-time senders waits here. Mail that is already waiting stays until it is decided. */
            on: boolean;
            /** @description The senders whose mail waits, newest first. */
            senders: components["schemas"]["WaitingSender"][];
            /**
             * @description How many addresses and domains the mailbox has let in.
             * @example 42
             */
            letIn: number;
            /**
             * @description How many addresses and domains the mailbox has blocked.
             * @example 3
             */
            blocked: number;
        };
        /** @description A first-time sender, with their mail that waits in the Screener. */
        WaitingSender: {
            /**
             * @description The sender's address, as their newest waiting thread gives it.
             * @example grace@example.org
             */
            address: string;
            /**
             * @description The sender's name, as their newest waiting thread gives it, if it gives one.
             * @example Grace Hopper
             */
            name?: string;
            /**
             * Format: date-time
             * @description When their newest waiting mail arrived.
             */
            latestAt: string;
            /** @description Their waiting threads, newest first. */
            threads: components["schemas"]["ThreadSummary"][];
        };
        ScreenerSwitch: {
            /** @description True to switch the Screener on, false to switch it off. */
            on: boolean;
        };
        /** @description An address or a domain. Give one of them. */
        SenderToScreen: {
            /**
             * @description The sender's email address. Case doesn't matter.
             * @example grace@example.org
             */
            address?: string;
            /**
             * @description The domain, for everyone at exactly that domain, not its subdomains. Case doesn't matter. Public mail providers' domains, like gmail.com, are refused.
             * @example example.org
             */
            domain?: string;
        };
        /** @description An address or a domain a mailbox has let in or blocked. It has one of address and domain. */
        ScreenedSender: {
            /**
             * @description The address, in lower case.
             * @example grace@example.org
             */
            address?: string;
            /**
             * @description The domain, in lower case. It covers exactly that domain, and an address's own decision beats it.
             * @example example.org
             */
            domain?: string;
            decision: components["schemas"]["ScreeningDecisionKind"];
            /**
             * Format: date-time
             * @description When it was decided.
             */
            decidedAt: string;
            /** @description The ID of the actor who decided, if one did. Switching the Screener on lets in the mailbox's senders under whoever switched it, and setup's under no one. */
            actor?: string;
        };
        /**
         * @description letIn lets the sender's mail into the Inbox. block sends it to Trash.
         * @enum {string}
         */
        ScreeningDecisionKind: "letIn" | "block";
        ScreeningDecision: {
            sender: components["schemas"]["ScreenedSender"];
            /** @description The threads it moved, as they are now, newest first. */
            threads: components["schemas"]["ThreadSummary"][];
            /** @description For a block, how unsubscribing from the sender's mail went. */
            unsubscribe?: components["schemas"]["Unsubscribe"];
        };
        ScreenedSenderList: {
            /** @description The addresses and domains the mailbox let in or blocked, newest decision first. */
            senders: components["schemas"]["ScreenedSender"][];
        };
        Unsubscribe: {
            outcome: components["schemas"]["UnsubscribeOutcome"];
            reason?: components["schemas"]["UnsubscribeReason"];
            /** @description The HTTP status the sender's server answered with, when it refused. */
            status?: number;
        };
        /**
         * @description unsubscribed: the sender's server took the one-click POST. notOffered: Duva sent nothing, and reason says why. failed: the POST didn't go through, and reason says why.
         * @enum {string}
         */
        UnsubscribeOutcome: "unsubscribed" | "notOffered" | "failed";
        /**
         * @description Why it wasn't unsubscribed. Not offered: noMail, the mailbox has no mail from the sender; spam, SES judged all of it to be spam; noOneClick, the newest has no https List-Unsubscribe with List-Unsubscribe-Post One-Click; notSigned, no DKIM signature that passed covers both headers. Failed: notAllowed, the URL or a redirect isn't http or https on port 80 or 443; notPublic, its host isn't at a public address; unreachable, its server couldn't be reached; timedOut, it didn't answer in time; refused, it answered with neither a success nor a 307 or 308 redirect, and status gives its code; tooManyRedirects, it redirected more than 3 times.
         * @enum {string}
         */
        UnsubscribeReason: "noMail" | "spam" | "noOneClick" | "notSigned" | "notAllowed" | "notPublic" | "unreachable" | "timedOut" | "refused" | "tooManyRedirects";
        UnsubscribeAttempted: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "unsubscribeAttempted";
            /** @description The sender's address, in lower case, if the block is on an address. */
            address?: string;
            /** @description The domain, in lower case, if the block is on a domain. */
            domain?: string;
            outcome: components["schemas"]["UnsubscribeOutcome"];
            reason?: components["schemas"]["UnsubscribeReason"];
            /** @description The HTTP status the sender's server answered with, when it refused. */
            status?: number;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "unsubscribeAttempted";
        };
        SenderScreened: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "senderScreened";
            /** @description The sender's address, in lower case, if the decision is on an address. */
            address?: string;
            /** @description The domain, in lower case, if the decision is on a domain. */
            domain?: string;
            decision: components["schemas"]["ScreeningDecisionKind"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "senderScreened";
        };
        ScreenedSenderRemoved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "screenedSenderRemoved";
            /** @description The sender's address, in lower case, if the decision was on an address. */
            address?: string;
            /** @description The domain, in lower case, if the decision was on a domain. */
            domain?: string;
            /** @description The decision it was. */
            decision: components["schemas"]["ScreeningDecisionKind"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "screenedSenderRemoved";
        };
        /** @description The Screener was switched on or off. Switching it off moves each waiting thread to the Inbox, each with its own threadLabelsChanged. Setup switching it on for a mailbox that had it before the Screener existed names no actor. */
        ScreenerSwitched: {
            /** @description The change's position in the mailbox's feed, counting from 1. */
            position: number;
            /**
             * Format: date-time
             * @description When it was switched.
             */
            at: string;
            /** @description The ID of the actor who switched it, if one did. */
            actor?: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "screenerSwitched";
            /** @description Whether it is on now. */
            on: boolean;
            /** @description When switched on, how many of the mailbox's senders that weren't let in yet it let in. */
            letIn?: number;
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
            /** @description The ID of the actor who wrote the draft or changed it last, the approver if they edited it. Drafts written before Duva kept this have none. */
            updatedBy?: string;
            send?: components["schemas"]["SendStatus"];
        };
        /** @description Where the draft's latest request to send stands. A draft never asked to send has none. */
        SendStatus: {
            /** @description The ID of the approval the request needs, if it needs one. A human's send from their own mailbox needs none, nor does an agent's whose sponsor switched approval off. */
            approval?: string;
            /**
             * @description waiting for approval; withdrawn because the draft changed while it waited, was sent without approval, or the agent's sponsor access was lowered; rejected, with the approver's note; approved, and about to be sent, which a send without approval is at once; sending; sent, as the message in its thread; failed, with the reason; or unclear, when sending stopped before SES answered, so a human checks whether it went out, by its recipients and subject, since only SES's answer gives its Message-ID. Duva never sends an unclear draft again. An approved draft can't change, but a rejected or failed one can be revised and sent again.
             * @enum {string}
             */
            state: "waiting" | "withdrawn" | "rejected" | "approved" | "sending" | "sent" | "failed" | "unclear";
            /** @description The approver's note, if they rejected it. */
            note?: string;
            /**
             * @description Why it failed, SES's reason if SES refused the message.
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
            /** @description How many of the label's threads are unread, leaving out those in Spam and Trash unless the label is one of those, and those waiting in the Screener. */
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
        SearchResults: {
            results: components["schemas"]["SearchResult"][];
            /** @description Present when more threads follow. Pass it as after to read the next page. */
            next?: string;
        };
        SearchResult: {
            thread: components["schemas"]["ThreadSummary"];
            /** @description The ID of the thread's message that matched best, or the newest that matched when sorted by newest. */
            message: string;
            /** @description The part of that message's text where the words stand, on one line, without quoted lines. */
            snippet: string;
            /** @description Where in the snippet the words and phrases match, in order. */
            highlights: components["schemas"]["Highlight"][];
        };
        Highlight: {
            /** @description Where the match starts in the snippet, counted in UTF-16 code units, as JavaScript counts a string's length. */
            start: number;
            /** @description Where the match ends, after its last code unit. */
            end: number;
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
             * @description The IDs of the thread's labels. A thread waiting in the Screener has screener among them, which only a decision on its sender removes, or adding inbox.
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
            /**
             * @description The address of the group the message came through, if it came to the mailbox as a member's copy, which skipped the Screener. Recipient is then the group's address.
             * @example support@example.com
             */
            group?: string;
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
            /** @description The HTML body, if the message has one, made safe to show: no scripts, event handlers, forms, frames, objects or `javascript:` links, and known trackers removed. Its references to the message's own parts (`cid:`) lead to download links, which work for a few minutes. */
            html?: string;
            /**
             * @description The trackers removed from the HTML body, if it has one, each by the name of its service where it is known, or else as "a hidden image". Empty when none was found.
             * @example [
             *       "SendGrid",
             *       "a hidden image"
             *     ]
             */
            removedTrackers?: string[];
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
        OrganizationChange: components["schemas"]["OrganizationAdded"] | components["schemas"]["DomainAdded"] | components["schemas"]["DomainRemoved"] | components["schemas"]["SignInDomainChanged"] | components["schemas"]["ActorAdded"] | components["schemas"]["AgentKeyRotated"] | components["schemas"]["MailboxAdded"] | components["schemas"]["AddressAdded"] | components["schemas"]["AddressRemoved"] | components["schemas"]["DefaultAddressChanged"] | components["schemas"]["GroupAdded"] | components["schemas"]["GroupChanged"] | components["schemas"]["GroupRemoved"] | components["schemas"]["SettingsChanged"] | components["schemas"]["ActorRemoved"] | components["schemas"]["AdminChanged"] | components["schemas"]["MailboxHandedOver"] | components["schemas"]["MailboxDeleted"];
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
             * @description The domain.
             * @example example.com
             */
            domain: string;
            /** @description The standalone domain it mirrors, if it is an alias domain. */
            aliasOf?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "domainAdded";
        };
        DomainRemoved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "domainRemoved";
            /**
             * @description The domain.
             * @example example.net
             */
            domain: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "domainRemoved";
        };
        SignInDomainChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "signInDomainChanged";
            /**
             * @description The domain sign-in codes come from from now on.
             * @example example.net
             */
            domain: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "signInDomainChanged";
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
        ActorRemoved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "actorRemoved";
            removed: components["schemas"]["Actor"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "actorRemoved";
        };
        AdminChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "adminChanged";
            /** @description The ID of the human made an admin, or no longer one. */
            human: string;
            /** @description Whether the human is an admin now. */
            admin: boolean;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "adminChanged";
        };
        MailboxHandedOver: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "mailboxHandedOver";
            /** @description The ID of the mailbox, with its addresses and mail. */
            mailbox: string;
            /** @description The ID of the actor that owned it. */
            from: string;
            /** @description The ID of the human who owns it now. */
            to: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "mailboxHandedOver";
        };
        MailboxDeleted: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "mailboxDeleted";
            /** @description The ID of the mailbox. */
            mailbox: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "mailboxDeleted";
        };
        AddressRemoved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "addressRemoved";
            /**
             * @description The address.
             * @example support@example.com
             */
            address: string;
            /** @description The ID of the mailbox it delivered to. */
            mailbox?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "addressRemoved";
        };
        DefaultAddressChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "defaultAddressChanged";
            /** @description The ID of the mailbox. */
            mailbox: string;
            /**
             * @description Its new default address, absent if it has no address left.
             * @example support@example.com
             */
            defaultAddress?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "defaultAddressChanged";
        };
        GroupAdded: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "groupAdded";
            group: components["schemas"]["Group"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "groupAdded";
        };
        GroupChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "groupChanged";
            /** @description The group as it is after the change. */
            group: components["schemas"]["Group"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "groupChanged";
        };
        GroupRemoved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "groupRemoved";
            /**
             * @description The group's address.
             * @example support@example.com
             */
            address: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "groupRemoved";
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
            retentionDays: components["schemas"]["RetentionDays"];
        };
        /** @description The settings changed, each with its new value. */
        SettingsChanges: {
            erasureErasesApprovals?: components["schemas"]["ErasureErasesApprovals"];
            retentionDays?: components["schemas"]["RetentionDays"];
        };
        /** @description How many days Trash and Spam keep a thread, counted from when it got the label, before the eraser erases it for good. 30 by default, and a whole number from 7 to 365. It applies to all Trash and Spam, threads already there included. */
        RetentionDays: number;
        RetentionPreview: {
            retentionDays: components["schemas"]["RetentionDays"];
            /** @description How many threads in Trash and Spam are older than retentionDays now. */
            threads: number;
        };
        /** @description Whether erasing a thread also erases the approval records of the agents' sends in it: the draft its approver saw and any edit they made. Off by default, so the records stay as the account of what an agent sent and who approved it. Either way the mailbox's change feed keeps each decision and who made it. */
        ErasureErasesApprovals: boolean;
        /** @description A human's own preferences. */
        Preferences: {
            hourCycle: components["schemas"]["HourCycle"];
            dateFormat: components["schemas"]["DateFormat"];
            mailView: components["schemas"]["MailView"];
        };
        /** @description The preferences changed, each with its new value. */
        PreferencesChanges: {
            hourCycle?: components["schemas"]["HourCycle"];
            dateFormat?: components["schemas"]["DateFormat"];
            mailView?: components["schemas"]["MailView"];
        };
        /**
         * @description How the web app shows times. Locale, the default, follows the browser's language. h12 shows 12-hour time, as 2:30 PM, and h23 24-hour time, as 14:30.
         * @enum {string}
         */
        HourCycle: "locale" | "h12" | "h23";
        /**
         * @description How the web app shows dates. Locale, the default, follows the browser's language. iso shows 2026-10-05, dayMonth 5 Oct 2026 and monthDay Oct 5, 2026, with month names in the browser's language. Without the year, they show 10-05, 5 Oct and Oct 5.
         * @enum {string}
         */
        DateFormat: "locale" | "iso" | "dayMonth" | "monthDay";
        /**
         * @description How the web app shows a message that has HTML. html, the default, shows it as its sender designed it, with known trackers removed. text shows its plain text. Either way, the human can switch each message the other way.
         * @enum {string}
         */
        MailView: "html" | "text";
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
        /** @description The human's ID. */
        Human: string;
        /** @description The group's address. Case doesn't matter. */
        Group: string;
        /** @description The domain. Case doesn't matter. */
        Domain: string;
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
    previewRetention: {
        parameters: {
            query: {
                /** @description The retention period to preview, in days, a whole number from 7 to 365. */
                retentionDays: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description How many threads the period would erase now. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RetentionPreview"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Your preferences. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preferences"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    changePreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesChanges"];
            };
        };
        responses: {
            /** @description Your preferences, changed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preferences"];
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
    changeHuman: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The human's ID. */
                human: components["parameters"]["Human"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HumanChanges"];
            };
        };
        responses: {
            /** @description The human, changed. */
            200: {
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
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    removeHuman: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The human's ID. */
                human: components["parameters"]["Human"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HumanRemovalChoices"];
            };
        };
        responses: {
            /** @description What the removal takes, removed unless it was a dry run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HumanRemoval"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
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
    removeAgent: {
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
            /** @description The agent, removed, and the mailboxes erased with it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentRemoval"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
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
    listAddresses: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization's addresses, in alphabetical order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AddressList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    addAddress: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewAddress"];
            };
        };
        responses: {
            /** @description The address, with the mailbox it delivers to. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Address"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    removeAddress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The address, without a plus tag. Case doesn't matter. */
                address: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The address removed, with the mailbox it delivered to. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Address"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listGroups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization's groups, in alphabetical order of their addresses. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GroupList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    createGroup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewGroup"];
            };
        };
        responses: {
            /** @description The group. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    getGroup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The group's address. Case doesn't matter. */
                group: components["parameters"]["Group"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The group. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    deleteGroup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The group's address. Case doesn't matter. */
                group: components["parameters"]["Group"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The group deleted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    changeGroup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The group's address. Case doesn't matter. */
                group: components["parameters"]["Group"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GroupChanges"];
            };
        };
        responses: {
            /** @description The group, changed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Group"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listDomains: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization's domains, in alphabetical order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    addDomain: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewDomain"];
            };
        };
        responses: {
            /** @description The domain, with the DNS records it needs. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    getDomain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The domain. Case doesn't matter. */
                domain: components["parameters"]["Domain"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The domain. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    changeDomain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The domain. Case doesn't matter. */
                domain: components["parameters"]["Domain"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DomainChanges"];
            };
        };
        responses: {
            /** @description The domain, changed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    removeDomain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The domain. Case doesn't matter. */
                domain: components["parameters"]["Domain"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DomainRemovalChoices"];
            };
        };
        responses: {
            /** @description What the removal takes, removed unless it was a dry run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainRemoval"];
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
    changeMailbox: {
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
                "application/json": components["schemas"]["MailboxChanges"];
            };
        };
        responses: {
            /** @description The mailbox, changed. */
            200: {
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
    searchMailbox: {
        parameters: {
            query: {
                /** @description What to search for: words, "quoted phrases", and the filters from: and to: (part of a name or address), subject: (a word or quoted phrase in the subject), label: (a label's name, quoted if it has spaces), has:attachment, is:unread, after: (received on or after the day) and before: (received before the day), with days as YYYY-MM-DD in UTC. Every phrase and filter must hold. */
                q: string;
                /** @description Best first, or newest first. Without words or phrases, both are newest first. */
                sort?: "relevance" | "newest";
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
            /** @description A page of the threads found. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResults"];
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
    getScreener: {
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
            /** @description The Screener. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Screener"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    switchScreener: {
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
                "application/json": components["schemas"]["ScreenerSwitch"];
            };
        };
        responses: {
            /** @description The Screener, switched. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Screener"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    letInSender: {
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
                "application/json": components["schemas"]["SenderToScreen"];
            };
        };
        responses: {
            /** @description The decision, with the threads it moved. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScreeningDecision"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    blockSender: {
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
                "application/json": components["schemas"]["SenderToScreen"];
            };
        };
        responses: {
            /** @description The decision, with the threads it moved. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScreeningDecision"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listScreenedSenders: {
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
            /** @description The screened senders. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScreenedSenderList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    removeScreenedSender: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The address or the domain, as the mailbox decided on it. Case doesn't matter. */
                sender: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The decision removed, with the threads it moved. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScreeningDecision"];
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
            409: components["responses"]["Conflict"];
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
