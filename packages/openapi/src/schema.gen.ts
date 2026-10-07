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
    "/organization/mailboxes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List every mailbox in the organization, with its addresses and the actor that owns it.
         * @description For giving mailboxes addresses and choosing their default address. It lists what reaches each mailbox and who owns it, and reads none of their mail, which admins can't read. Only admins can list the organization's mailboxes.
         */
        get: operations["listOrganizationMailboxes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/organization/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List every agent in the organization, with its sponsor.
         * @description For seeing who sponsors which agent, and removing agents. Only admins can list the organization's agents. A human lists the agents they sponsor with agents list.
         */
        get: operations["listOrganizationAgents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/organization/mailbox-agent-spend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Show what the mailbox agents spent on their model this month, against the organization's spend cap.
         * @description Counts the model's price for each run's tokens, from the first of the month in UTC. Once it reaches mailboxAgentSpendCap, runs stop and every new one is refused until the month ends or an admin raises the cap. Only admins can read it.
         */
        get: operations["getMailboxAgentSpend"];
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
         * @description Give only the settings to change. A setting applies from when it changes, so turning on erasureErasesApprovals leaves the approval records of threads erased before then. A shorter retentionDays reaches back: the eraser's next daily run erases every thread that has had Trash or Spam longer than it. Preview the period first to see how many. Lowering an agent cap lowers each agent above it, each recorded as a change to its settings under you. Only admins can change the settings. Each change is recorded in the organization's change feed under you.
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
        /** List the agents you sponsor, each with how many sends it has left this hour. */
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
         * @description Only the agent's sponsor and human admins can remove it, never an agent, not even an agent admin. Its sends and setup changes waiting for approval are withdrawn. Its mailboxes are erased everywhere Duva keeps their mail, as emptying Trash does, and their approval records only if the organization's settings say so. Their addresses are freed at once. The removal is recorded in the organization's change feed under you.
         */
        delete: operations["removeAgent"];
        options?: never;
        head?: never;
        /**
         * Make an agent you sponsor an admin, or take it away.
         * @description Only the agent's sponsor can, and only while they are an admin themselves to make it one. No agent can change who is an admin. An agent admin's changes to the setup wait for your approval unless you switch approvalForSetup off in its settings, and it never removes humans or agents, or changes who is an admin. It stops being an admin when you do, and its setup changes still waiting are withdrawn. The change is recorded in the organization's change feed under you.
         */
        patch: operations["changeAgent"];
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
    "/agents/{agent}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause an agent, which refuses its key and holds its approved sends until it is unpaused.
         * @description Only the agent's sponsor and admins can pause it. While it is paused, every call with its key is refused with 403, its approvals wait but can't be sent, and its sends already approved are held. Mail to its mailboxes keeps arriving. Pausing is recorded under you in the change feed of each of the agent's mailboxes and in the organization's. Pausing a paused agent changes nothing.
         */
        post: operations["pauseAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{agent}/unpause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Unpause an agent, which lets its key work again and sends what it held.
         * @description Only the agent's sponsor and human admins can unpause it, never an agent. Its sends held while it was paused go out, those from each mailbox oldest first, so look at them first. Unpausing is recorded under you in the change feed of each of the agent's mailboxes and in the organization's. Unpausing an agent that isn't paused changes nothing.
         */
        post: operations["unpauseAgent"];
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
         * Read an agent's settings, its sponsor access, its approval and disclosure-line switches and its send limits.
         * @description Only the agent's sponsor and the agent itself can read them. An agent starts with no sponsor access, every switch on, and send limits of 100 an hour and 50 new recipients a day.
         */
        get: operations["getAgentSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change an agent's sponsor access, its approval and disclosure-line switches, or its send limits.
         * @description Give only the settings to change. A change works at once. Only the agent's sponsor can change them, so not even an admin can. Each change is recorded under you, with the old and new values, in your personal mailbox's change feed, or if you have none, in the agent's. If neither of you has a mailbox, the change is refused. Sponsor access covers the mailboxes of yours that sponsorMailboxes names, or all of them while it is null. Read lets the agent read them, organize also lets it organize them and move threads to Trash and back, draft also lets it draft there, and send also lets it send as you. Lowering access from send, or taking a mailbox out of sponsorMailboxes, withdraws the agent's sends waiting for your approval there, recorded in its change feed under you, and fails those approved but not yet gone out. Its drafts and sent messages stay. Send limits go up to the organization's caps, and raising one lets its sends that wait go out as far as the new limit allows.
         */
        patch: operations["changeAgentSettings"];
        trace?: never;
    };
    "/agents/{agent}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an agent's daily summaries, how much it sent, had approved or rejected, received, organized and screened each day.
         * @description Gives every day from from to to, newest first, each day in your time zone, days without activity included. Leave both out for the last 30 days. Activity reaches back to the agent's start: what happened in its mailboxes, what it did in its sponsor's mailbox, and the organization's changes to it. Only the agent's sponsor and admins can read it.
         */
        get: operations["getAgentActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{agent}/activity/{day}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an agent's timeline for one day, everything it did and what happened in its mailboxes, newest first.
         * @description Lists the day's entries a page at a time, newest first. Each is a change as the change feed recorded it, with the mailbox it was in and its thread, where it has them. To read the next page, call again with the answer's next as after, until an answer has no next. Only the agent's sponsor and admins can read it. An admin who isn't the sponsor reads no part of what the mail says, so the changes leave out approvers' edits and notes, label names, and senders' and recipients' addresses.
         */
        get: operations["getAgentActivityDay"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask a human for access as a new agent, and get the code they approve it by.
         * @description Answers without sign-in, since the agent has no key yet. Show the code and a link to the web app's #/access/<code> to the human who will be the agent's sponsor, then collect the key with the device code every interval seconds until they approve or decline. The code works for 10 minutes and once. duva login --agent does all of this. An address asks for at most 10 codes in 10 minutes.
         */
        post: operations["askForAccess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests/collect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Collect the agent's key once a human approved its access request.
         * @description Answers without sign-in. Gives the agent and its key once, after the human approved, with 200. While the request waits it answers 202, so ask again after the interval. Once the human declined it answers 403, and once the request expired or its key was collected, 404.
         */
        post: operations["collectAccess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an agent's access request by the code it shows, to approve or decline it.
         * @description Only humans read access requests. It lists each of your mailboxes, with whether the agent asked for it. A human who gives 10 codes in 10 minutes that no request waits with gets 429 until the 10 minutes are over, so codes can't be guessed.
         */
        get: operations["getAccessRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests/{code}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve an agent's access request, which makes you its sponsor and gives it the access you choose.
         * @description Only humans approve. Give only what you change from what the agent asked: its name, its sponsor access, the mailboxes of yours it covers, and the approval and disclosure-line switches for its sends as you, both on unless you switch them off. Approving creates the agent, with you as its sponsor, recorded in the organization's change feed, and its settings, recorded in your mailboxes' change feeds. The agent then collects its key once. A request is approved or declined once, within 10 minutes.
         */
        post: operations["approveAccessRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests/{code}/decline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Decline an agent's access request, so it gets no key.
         * @description Only humans decline. A request is approved or declined once, within 10 minutes.
         */
        post: operations["declineAccessRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
         * @description Each record's status is looked up when you ask: missing until DNS answers with its value, found once it does, and verified once SES has verified what the record is for, unless DNS answers with another value. Only admins can list the organization's domains.
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
    "/domains/{domain}/catch-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set a standalone domain's catch-all, a mailbox or a group, for mail to addresses the organization doesn't have.
         * @description Give the mailbox's ID or the group's address. Mail to an address on the domain, or on its alias domains, that isn't one of the organization's, removed ones included, goes to the catch-all instead of being refused. A mailbox's Screener applies to it, and a group delivers it to its members, skipping their Screeners, as group mail does. Deleting the mailbox or the group clears the catch-all. Only admins can set it, and each change is a change to the organization's setup, recorded in its change feed under you.
         */
        put: operations["setCatchAll"];
        post?: never;
        /**
         * Clear a domain's catch-all, so that mail to addresses the organization doesn't have is refused again.
         * @description SES refuses such mail on the domain and its alias domains at once. Mail the catch-all already got stays. Only admins can clear it, and clearing it is a change to the organization's setup, recorded in its change feed under you.
         */
        delete: operations["clearCatchAll"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domain}/logo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Show a domain's BIMI logo, its default._bimi record with its status, and every mailbox's logo on the domain.
         * @description Receivers that honor BIMI show the domain's logo beside its mail once DNS has the record and the domain's DMARC policy is quarantine or reject. Each record's status is looked up when you ask. Each mailbox that has a logo of its own is listed with its selector, its owner and the record it needs on the domain. Only admins can read it.
         */
        get: operations["getDomainLogo"];
        /**
         * Set a domain's BIMI logo, which Duva converts to SVG Tiny PS and serves at a public URL.
         * @description The logo's URL stays the same when you set another logo, so its record does too. Setting another logo removes its mark certificate, since that vouches for the logo it carries. Only admins can set it, and it is a change to the organization's setup.
         */
        put: operations["setDomainLogo"];
        post?: never;
        /**
         * Remove a domain's BIMI logo, and its mark certificate, so Duva no longer serves them.
         * @description Remove the domain's default._bimi record from DNS too, since receivers find nothing at its URL from then on. Only admins can remove it, and it is a change to the organization's setup.
         */
        delete: operations["removeDomainLogo"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domain}/logo/certificate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Attach a VMC or CMC to a domain's logo, by its URL or as a PEM file Duva serves.
         * @description Receivers such as Gmail show a logo only with a mark certificate, a VMC or CMC from a Mark Verifying Authority, which the record's a= tag gives. Give its https URL, or its PEM, the certificate and the ones that issued it. Duva serves a PEM only if it vouches for the domain and for the very logo Duva serves, and takes a URL as given. Only admins can attach one, and it is a change to the organization's setup.
         */
        put: operations["setLogoCertificate"];
        post?: never;
        /**
         * Remove the VMC or CMC from a domain's logo.
         * @description The logo stays. Only admins can remove the certificate, and it is a change to the organization's setup.
         */
        delete: operations["removeLogoCertificate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/logo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Show your mailbox's own BIMI logo, its selector, and the record each of its domains needs.
         * @description Only some receivers honor a mailbox's own logo. Others show the domain's. Once DNS has the record on the domain a message comes from, Duva adds BIMI-Selector to the mail the mailbox sends from its own addresses. Only the human who owns the mailbox can read it.
         */
        get: operations["getMailboxLogo"];
        /**
         * Set your mailbox's own BIMI logo, in place of the domain's, which Duva converts to SVG Tiny PS and serves at a public URL.
         * @description Duva gives the mailbox a selector the first time. Ask an admin to add the records the answer lists, one for each domain the mailbox sends from. The logo's URL stays the same when you set another logo. Only the human who owns the mailbox can set it.
         */
        put: operations["setMailboxLogo"];
        post?: never;
        /**
         * Remove your mailbox's own logo, so its mail shows the domain's again.
         * @description Duva stops adding BIMI-Selector to its mail and serving the logo. The records for its selector can go from DNS. Only the human who owns the mailbox can remove it.
         */
        delete: operations["removeMailboxLogo"];
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
         * @description An agent your sponsor gives sponsor access also finds your sponsor's personal mailbox here, listed with that access.
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
         * @description Marks each thread read. Read state belongs to the mailbox, so it is the same for each actor who reads it. Each thread that was unread gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can mark its threads.
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
         * @description Marks each thread unread, so it stands out until it is read again. Each thread that was read gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can mark its threads.
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
         * @description Adds and removes the labels on each thread. Archiving removes inbox, and adding inbox moves a thread back to the Inbox, out of Spam, Trash and the Screener. Adding spam or trash takes a thread out of the Inbox. Removing spam (not spam) or trash (restore) puts it back in the Inbox, unless it still has the other, waits in the Screener, or inbox is removed too. Each thread whose labels change gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can label its threads.
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
    "/mailboxes/{mailbox}/threads/remind": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set threads in a mailbox aside until a time, when they come back to the Inbox.
         * @description Remind me: each thread leaves the Inbox, if it is there, and waits in Remind me until the time, given as at or as a preset. Then it comes back to the top of the Inbox, unread, with a Back mark naming when it was set aside. New mail in the thread brings it back early. A thread already set aside gets the new time. A thread in Spam or Trash, or waiting in the Screener, can't be set aside. Each thread gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can set its threads aside.
         */
        post: operations["remindThreads"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/threads/remind/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel the reminders of threads in a mailbox, which puts them back in the Inbox.
         * @description Each thread set aside in Remind me goes back to the Inbox now, at its own place and without a Back mark. Threads not set aside are left as they are. Each thread whose reminder is cancelled gets a change in the mailbox's change feed, naming you. Only those who can set the mailbox's threads aside can cancel their reminders.
         */
        post: operations["cancelReminders"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/reminders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the threads set aside in a mailbox's Remind me, the soonest back first.
         * @description Lists the threads waiting in Remind me a page at a time, the one that comes back soonest first, each with its reminder. To read the next page, call again with the answer's next as after, until an answer has no next.
         */
        get: operations["listReminders"];
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
         * @description Lists the built-in labels inbox, feed, paperTrail, spam and trash first, then the mailbox's own labels by name. Only those who can read the mailbox can list its labels.
         */
        get: operations["listLabels"];
        put?: never;
        /**
         * Create a label in a mailbox.
         * @description Creates a label of the mailbox's own, with a name no other label in it has, in any case. Then add it to threads by its ID. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can create its labels. The change is recorded in the mailbox's change feed, naming you.
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
         * @description Removes the label from each of its threads, each with a change in the mailbox's change feed, and then deletes it. The threads stay. Senders whose mail was filed under it go to the Inbox from then on. The built-in labels can't be deleted. If deleting stops partway, delete the label again to finish. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can delete its labels.
         */
        delete: operations["deleteLabel"];
        options?: never;
        head?: never;
        /**
         * Rename one of a mailbox's own labels.
         * @description Gives the label a name no other label in the mailbox has, in any case. Its threads keep it. The built-in labels can't be renamed. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can rename its labels. The change is recorded in the mailbox's change feed, naming you.
         */
        patch: operations["renameLabel"];
        trace?: never;
    };
    "/mailboxes/{mailbox}/labels/{label}/prompt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Give a label a prompt, which hands each message that gets the label to the mailbox agent as a task.
         * @description Sets the label's prompt, or replaces it. From then on, whenever the label is added to a message, by hand, by an agent or by a sender's delivery, Duva gives the mailbox's mailbox agent a task: the prompt, with that message and its thread, once per message per label. The message stays where it goes. A thread given the label by hand or by an agent hands over its newest message. The agent works within the sponsor access the mailbox's owner gives it. The Feed, the Paper Trail and the mailbox's own labels can carry a prompt. Only the mailbox's owner can set its labels' prompts, and only in a mailbox that has a mailbox agent. The change is recorded in the mailbox's change feed, naming you.
         */
        put: operations["setLabelPrompt"];
        post?: never;
        /**
         * Remove a label's prompt, so the mailbox agent gets no more tasks from it.
         * @description Removes the label's prompt. Tasks it gave already go on. Only the mailbox's owner can remove its labels' prompts. The change is recorded in the mailbox's change feed, naming you.
         */
        delete: operations["removeLabelPrompt"];
        options?: never;
        head?: never;
        patch?: never;
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
    "/mailboxes/{mailbox}/agent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a mailbox's mailbox agent and your conversation with it.
         * @description Every human's personal mailbox has a mailbox agent, which Duva hosts and which you sponsor. It works only in that mailbox, with the sponsor access you give it in its settings, and its actions are attributed to it. The web app asks it in "Ask your agent", which streams its answer from the web app's own address, under /agent/. Lists the conversation's turns, oldest first, at most the last 100. Only the mailbox's owner can read it.
         */
        get: operations["getMailboxAgent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/agent/conversation": {
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
         * Start a new conversation with a mailbox's mailbox agent.
         * @description Deletes every turn of your conversation with it, so it starts again knowing none of it. What it did stays done, in the mailbox's change feed. Only the mailbox's owner can clear it.
         */
        delete: operations["clearConversation"];
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
         * @description Lists each sender whose mail waits, newest first, with their waiting threads, newest first. Mail waiting in the Screener is in no other listing and no unread count. Says whether the Screener is on, and how many senders the mailbox has decided where mail goes for. Deciding where a waiting sender's mail goes takes their threads out of it. Only those who can read the mailbox can read its Screener.
         */
        get: operations["getScreener"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Switch a mailbox's Screener on or off.
         * @description Turning it off moves every waiting thread to the Inbox. Turning it on decides the Inbox for every address mail in the mailbox is from, except mail in Spam and addresses at a domain decided on, so no sender the mailbox already has waits. A human's mailbox starts with it on, an agent's with it off. Switching is recorded in the mailbox's change feed under you. Only the mailbox's owner, and an agent's sponsor for its agent's mailbox, can switch it.
         */
        patch: operations["switchScreener"];
        trace?: never;
    };
    "/mailboxes/{mailbox}/senders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the senders a mailbox has decided where mail goes for.
         * @description Each address and domain, with its delivery, when it was set and by whom, newest first. Only those who can read the mailbox can list them.
         */
        get: operations["listSenders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/senders/{sender}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a sender's sheet in a mailbox, with where their mail goes now.
         * @description Says how many threads the mailbox has from them, Spam and Trash included, their name as their newest thread gives it, where their new mail goes now, and the decision that sends it there: the mailbox's on their address, or else on their domain. Only those who can read the mailbox can read it.
         */
        get: operations["getSender"];
        /**
         * Decide where a sender's mail goes in a mailbox, for their mail there and their later mail.
         * @description inbox puts their mail in the Inbox. feed and paperTrail file it in the Feed or the Paper Trail instead, read. label files it under the mailbox's own label you give, unread, instead of the Inbox. nowhere drops their later mail on arrival, keeping none of it, and erases their threads in the mailbox, Spam and Trash included, for good. Removing nowhere later brings none of it back. Their threads where their mail went before, or waiting in the Screener, move to where it goes now, and keep the labels given by hand. Their later mail skips the Screener, even while it is off. A domain covers exactly that domain, not its subdomains, and can't be a public mail provider's, like gmail.com. An address's decision beats its domain's. Setting nowhere also unsubscribes the mailbox from the sender's mail by one-click (RFC 8058), when their newest mail that SES didn't judge to be spam offers it and a DKIM signature that passed covers its unsubscribe headers, and each message dropped later tries the same. Duva never unsubscribes by mailto or by a link in the body. The decision, each thread it moves or erases and the unsubscribe's outcome are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can decide, and only the owner or the sponsor can choose nowhere.
         */
        put: operations["setSenderDelivery"];
        post?: never;
        /**
         * Remove a mailbox's decision on a sender, so they are first-time again.
         * @description Their later mail waits in the Screener again, unless the mailbox has written to them, or a decision on their domain covers them. Their threads where their mail went move to where it goes now, the Inbox unless their domain's decision says otherwise. Mail nowhere dropped doesn't come back. The removal and each thread it moves are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give organize sponsor access or more can remove decisions.
         */
        delete: operations["removeSenderDelivery"];
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
         * @description A reply goes from the address the original was sent to, plus tag kept, or from the default address if the mailbox no longer has it, to the original's Reply-To or, without one, its From, with the subject carrying a single "Re: " prefix. A reply to your own message goes to its recipients instead. A reply to all also goes to every other recipient of the original, except the mailbox's own addresses. A forward goes from the address the original was sent to, to whoever you give, with the subject carrying a single "Fwd: " prefix, the original's text quoted and its attachments, from the same address a reply would. A new message goes from the mailbox's default address. Give from to choose another of the mailbox's addresses, or a group the mailbox's owner is a local member of, to send as the group. Only its members can, so any other group gets 403. A reply to group mail goes from the member's own address unless you give the group. A mailbox with no address can't draft. A draft can be saved before it has recipients, a subject or text, but it needs a recipient in To to be sent. Only the mailbox's owner can draft in it, and for a human's mailbox the agents they give draft sponsor access or more, whose drafts go from the same addresses as the human's own. Writing a draft is recorded in the mailbox's change feed, naming you.
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
         * @description Deleting a draft that waits for approval withdraws the request. A draft being sent can't be deleted until its send is done. Deleting a sent draft leaves the sent message in its thread. Only the mailbox's owner can delete its drafts, and for a human's mailbox the agents they give draft sponsor access or more, whoever wrote the draft. The deletion, and any withdrawal, is recorded in the mailbox's change feed, naming you.
         */
        delete: operations["deleteDraft"];
        options?: never;
        head?: never;
        /**
         * Change a draft's From, recipients, subject or text.
         * @description Changing a draft that waits for approval withdraws the request, so an approver never approves text they didn't see. Ask to send it again once it is ready. From can be one of the mailbox's addresses, or a group the mailbox's owner is a local member of, and any other group gets 403. Only the mailbox's owner can edit its drafts, and for a human's mailbox the agents they give draft sponsor access or more, whoever wrote the draft. The change, and any withdrawal, is recorded in the mailbox's change feed, naming you.
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
         * @description A human's send from their own mailbox needs no approval, so Duva sends it at once, with no disclosure, also when their agent wrote the draft. An agent's send waits for its sponsor's approval unless the sponsor switched that off, separately for its own mailbox and for its sponsor's. With send sponsor access, an agent sends as its sponsor from the sponsor's mailbox: from the draft's address, under the sponsor's name. Every message an agent sends carries the Duva-Agent header, and a visible line unless its sponsor switched that off for where it sends from. Its send shows where it stands. Bcc recipients get the message, but no header names them. Only the mailbox's owner, and an agent with send sponsor access to it, can ask. The draft needs a recipient in To, and a draft waits for one approval at a time. It goes only from an address the mailbox still has, so a draft from an address since removed fails. A draft from a group goes out from the group's address, as any send does, and only while the mailbox's owner is still a local member: otherwise asking gets 403, and a send asked before fails. Each other local member's mailbox then gets a copy, in the thread of the message it answers, marked with who sent it as the group. External members get none. A send that needs no approval withdraws the request the draft waits for, if it waits. Asking is recorded in the mailbox's change feed. An agent's approved send over its send limits waits, as waitingForLimit, and goes out by itself, oldest first, as the limits allow, or when its sponsor sends it now. Humans have no send limits.
         */
        post: operations["sendDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailbox}/drafts/{draft}/send-now": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a draft waiting for an agent's send limits now, past the limits.
         * @description Only the agent's sponsor can, for one draft at a time, and the agent's limits stay as they are. The send still counts toward them. A paused agent's send is held until it is unpaused. Sending now is recorded in the mailbox's change feed under you, and the draft's send shows sending, then sent or failed. A draft that isn't waitingForLimit is 409.
         */
        post: operations["sendDraftNow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List your agents' alerts, newest first, with how many you haven't seen.
         * @description An alert tells a sponsor that one of their agents needs them: a send that failed, bounced or drew a complaint, its send limit reached, its key used while paused, a pause, limit change or removal by an admin, or a pause by Duva. A human lists the alerts about the agents they sponsor, and an agent those about itself, as its sponsor sees them. Urgent alerts are also mailed to the sponsor's own mailbox, if they have one. Removing an agent keeps its alerts. To read the next page, call again with the answer's next as after, until an answer has no next.
         */
        get: operations["listAlerts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/seen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark alerts seen, so they no longer count as unseen.
         * @description Only the sponsor marks their alerts seen. IDs of alerts that aren't yours, or no longer exist, are left alone.
         */
        post: operations["markAlertsSeen"];
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
         * List the approvals waiting for you, newest first, sends with their drafts and setup changes with their previews.
         * @description An agent's sends wait for its sponsor, from its own mailbox and as its sponsor from theirs, so a sponsor sees those of every agent they sponsor. Each approval's mailbox tells which. The setup changes of agents they made admins wait for them too, each with a preview of what it does.
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
    "/approvals/log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the decisions on your agents' sends, newest first, each with what became of it.
         * @description The approval log: every decision on a send one of your agents asked you for, newest first, with who decided it and when, and how it went: approved and on its way, sent, failed, unclear, or rejected with its note. Each entry links to its thread, and says how the decision can be taken back, if it can. It reaches as far back as approval records are kept (ADR-0014). An undone approval waits again, so it leaves the log until it is decided again. To read the next page, call again with the answer's next as after, until an answer has no next.
         */
        get: operations["listApprovalLog"];
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
         * @description Give recipients, a subject or text to send your version instead of the agent's. Duva then sends it through SES from the draft's address, as a reply in the thread if it is one. Every message an agent sends carries the Duva-Agent header, naming the agent and the human it acts for, also when you changed it, and a line that says so after the text unless you switched that off for the agent. The draft's send shows sending, then sent or failed with the reason. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. A rejected approval can still be sent after all, while its draft is as the agent asked it: once the agent changed it, deleted it or asked again, that is 409. The decision, with any edits, is recorded in the mailbox's change feed under you, and the send under the agent. While the agent is paused, its approvals wait and can't be sent, which is 409. The draft then waits the organization's undo window, undoWindowSeconds, before the sender takes it, and you can undo the approval until then. Held after that while the agent is paused, or by its send limits, it stays approved.
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
    "/approvals/{approval}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Undo an approved send during the undo window, so it waits for your approval again.
         * @description An approved send waits the organization's undo window, undoWindowSeconds, before the sender takes it, as the draft's undoUntil says. Until then its approver can undo the approval: the draft waits for approval again as the agent asked it, without your edits, and nothing is sent. Once the window is over, or the sender took it, that is 409, and mail that went out can't be called back. Only the approver can undo. Undoing is recorded in the mailbox's change feed under you.
         */
        post: operations["undoApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/setup-approvals/{approval}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a setup change an agent admin asked for, and what became of it.
         * @description Only the agent that asked and its sponsor, who decides, can read it.
         */
        get: operations["getSetupApproval"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/setup-approvals/{approval}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a setup change your agent admin asked for, which makes it as the agent.
         * @description Duva works out the change's effect again first. If it would now do something other than its preview says, the approval waits with the new preview, and approving is refused with 409, so read it and approve again. A change that can't be made now, as when its address was taken meanwhile, is refused with 409 and keeps waiting, for you to reject. Only the agent's sponsor decides, never an agent, and only once. While the agent is paused, it can't be approved. The decision is recorded in the organization's change feed under you, and the change under the agent.
         */
        post: operations["approveSetup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/setup-approvals/{approval}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reject a setup change your agent admin asked for, with a note the agent sees.
         * @description Nothing changes. Only the agent's sponsor decides, never an agent, and only once. The decision is recorded in the organization's change feed under you.
         */
        post: operations["rejectSetup"];
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
            /** @description Whether the agent may change the organization's setup, which only an agent whose sponsor is an admin can. Its changes wait for its sponsor's approval unless approvalForSetup is off, and it never removes humans or agents, or changes who is an admin. */
            admin: boolean;
            paused?: components["schemas"]["Pause"];
            /** @description For a mailbox agent, the ID of the human's mailbox it is the mailbox agent of, the only one it works in. Duva hosts it, so it has no key, and it goes with the mailbox. */
            mailbox?: string;
            /** @description How many more messages the agent's send limits let it send now, counting its sends of the last hour. Its sends that wait for the limits leave none. There only when you list the agents you sponsor. */
            sendsLeftThisHour?: number;
        };
        /** @description Who paused the agent and when, there only while it is paused. Its key is refused, and its approved sends are held, until it is unpaused. */
        Pause: {
            /** @description The ID of the actor who paused it, its sponsor or an admin, or duva if Duva paused it by itself. */
            by: string;
            /**
             * Format: date-time
             * @description When it was paused.
             */
            at: string;
            /**
             * @description Why Duva paused it, there only if Duva paused it by itself (ADR-0021).
             * @example A recipient complained about its mail.
             */
            reason?: string;
        };
        NewAgent: {
            /**
             * @description The agent's name.
             * @example Hermes
             */
            name: string;
        };
        AgentChanges: {
            /** @description Whether the agent may change the organization's setup, with its sponsor's approval unless switched off. */
            admin: boolean;
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
        /** @description What an agent may do in its sponsor's personal mailbox, which of its sends and setup changes wait for approval, which sends carry the disclosure's visible line, and its send limits. */
        AgentSettings: {
            sponsorAccess: components["schemas"]["SponsorAccess"];
            /** @description The IDs of your mailboxes that the agent's sponsor access covers. Null, the default, covers every mailbox you own. The CLI sets it back to null with --no-sponsorMailboxes. */
            sponsorMailboxes: components["schemas"]["SponsorMailboxes"] | null;
            approvalForOwnMailbox: components["schemas"]["ApprovalForOwnMailbox"];
            approvalAsSponsor: components["schemas"]["ApprovalAsSponsor"];
            disclosureLineForOwnMailbox: components["schemas"]["DisclosureLineForOwnMailbox"];
            disclosureLineAsSponsor: components["schemas"]["DisclosureLineAsSponsor"];
            sendsPerHour: components["schemas"]["SendsPerHour"];
            newRecipientsPerDay: components["schemas"]["NewRecipientsPerDay"];
            approvalForSetup: components["schemas"]["ApprovalForSetup"];
        };
        /** @description The agent's settings changed, each with its new value. */
        AgentSettingsChanges: {
            sponsorAccess?: components["schemas"]["SponsorAccess"];
            /** @description The IDs of your mailboxes that the agent's sponsor access covers. Null, the default, covers every mailbox you own. The CLI sets it back to null with --no-sponsorMailboxes. */
            sponsorMailboxes?: components["schemas"]["SponsorMailboxes"] | null;
            approvalForOwnMailbox?: components["schemas"]["ApprovalForOwnMailbox"];
            approvalAsSponsor?: components["schemas"]["ApprovalAsSponsor"];
            disclosureLineForOwnMailbox?: components["schemas"]["DisclosureLineForOwnMailbox"];
            disclosureLineAsSponsor?: components["schemas"]["DisclosureLineAsSponsor"];
            sendsPerHour?: components["schemas"]["SendsPerHour"];
            newRecipientsPerDay?: components["schemas"]["NewRecipientsPerDay"];
            approvalForSetup?: components["schemas"]["ApprovalForSetup"];
        };
        /**
         * @description The agent's access to its sponsor's personal mailboxes, those sponsorMailboxes names. None, the default, gives it none. Read lets it read everything there: threads, labels, drafts, the change feed and attachments. Organize also lets it organize, decide in the Screener, set threads aside and move them to Trash and back. Draft also lets it write and change any draft there. Send also lets it send as its sponsor. Only the sponsor empties their Trash.
         * @enum {string}
         */
        SponsorAccess: "none" | "read" | "organize" | "draft" | "send";
        /** @description The IDs of the sponsor's mailboxes that the agent's sponsor access covers, each one the sponsor owns. */
        SponsorMailboxes: string[];
        /** @description What a new agent asks a human for. */
        AccessAsked: {
            /**
             * @description The agent's name. Without one, it is named for its host.
             * @example Hermes
             */
            name?: string;
            /**
             * @description The name of the computer the agent runs on, which the human sees.
             * @example build-box
             */
            host?: string;
            /**
             * @description The addresses of the mailboxes it asks for. Without them, it asks for every mailbox of the human who approves.
             * @example [
             *       "ada@example.com"
             *     ]
             */
            mailboxes?: string[];
            wants?: components["schemas"]["AccessWanted"];
        };
        /**
         * @description The sponsor access the agent asks for, read unless it says.
         * @enum {string}
         */
        AccessWanted: "read" | "organize" | "draft" | "send";
        AccessRequestStarted: {
            /**
             * @description The code to show the human, who approves the request by it.
             * @example BCDF-GHJK
             */
            code: string;
            /** @description The secret the agent collects its key with. Keep it to yourself. */
            deviceCode: string;
            /**
             * Format: date-time
             * @description When the code stops working, 10 minutes from now.
             */
            expiresAt: string;
            /** @description How many seconds to wait between tries to collect the key. */
            interval: number;
        };
        AccessCollected: {
            /** @description The device code asking for access gave. */
            deviceCode: string;
        };
        /** @description An agent's request for access, as the human who may approve it sees it. */
        AccessRequest: {
            /** @example BCDF-GHJK */
            code: string;
            /** @description The name the agent asked for. */
            name: string;
            /** @description Where the agent asked from. */
            from: {
                /**
                 * @description The IP address its request came from.
                 * @example 203.0.113.7
                 */
                address: string;
                /** @description The name it gave for the computer it runs on, which it may have made up. */
                host?: string;
            };
            wants: components["schemas"]["AccessWanted"];
            /** @description Each of your mailboxes, with whether the agent asked for it. */
            mailboxes: {
                mailbox: components["schemas"]["Mailbox"];
                asked: boolean;
            }[];
            /**
             * Format: date-time
             * @description When the code stops working.
             */
            expiresAt: string;
        };
        /** @description What you give the agent, where it differs from what it asked. */
        AccessApproval: {
            /** @description The agent's name, the one it asked for unless you give another. */
            name?: string;
            sponsorAccess?: components["schemas"]["SponsorAccess"];
            sponsorMailboxes?: components["schemas"]["SponsorMailboxes"];
            approvalAsSponsor?: components["schemas"]["ApprovalAsSponsor"];
            disclosureLineAsSponsor?: components["schemas"]["DisclosureLineAsSponsor"];
        };
        AccessDeclined: {
            code: string;
        };
        /** @description Whether the agent's sends from its own mailbox wait for its sponsor's approval. On by default. */
        ApprovalForOwnMailbox: boolean;
        /** @description Whether the agent's changes to the organization's setup, as an admin, wait for its sponsor's approval. On by default. */
        ApprovalForSetup: boolean;
        /** @description Whether the agent's sends as its sponsor, from the sponsor's mailbox, wait for the sponsor's approval. On by default. */
        ApprovalAsSponsor: boolean;
        /** @description Whether mail the agent sends from its own mailbox carries the disclosure's visible line. It always carries the Duva-Agent header. On by default. */
        DisclosureLineForOwnMailbox: boolean;
        /** @description Whether mail the agent sends as its sponsor carries the disclosure's visible line. It always carries the Duva-Agent header. On by default. */
        DisclosureLineAsSponsor: boolean;
        /** @description How many messages the agent sends in any hour, from all its mailboxes and as its sponsor. 100 by default, and up to the organization's agentSendsPerHourCap. A send counts when it goes out, and one over the limit waits. */
        SendsPerHour: number;
        /** @description How many new recipients the agent sends to in any 24 hours: addresses it hasn't sent to before, from any mailbox. 50 by default, and up to the organization's agentNewRecipientsPerDayCap. A send counts when it goes out, and one over the limit waits. A message with more new recipients than the whole limit waits until its sponsor sends it now. */
        NewRecipientsPerDay: number;
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
        /** @description A domain's catch-all, for mail to addresses the organization doesn't have. Exactly one of mailbox and group. */
        CatchAll: {
            /** @description The ID of the mailbox that gets the mail, its Screener applying. */
            mailbox?: string;
            /**
             * @description The address of the group whose members get the mail, skipping their Screeners.
             * @example support@example.com
             */
            group?: string;
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
            /** @description The standalone domain's catch-all, if an admin set one. Its alias domains use it too. Without one, mail to addresses the organization doesn't have is refused. */
            catchAll?: components["schemas"]["CatchAll"];
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
             * @description missing until DNS answers with the value, found once it does, and verified once SES has verified what the record is for. A record DNS doesn't answer for still shows verified then, since a resolver can answer from a cache made before it was added, but one DNS answers with another value for shows missing. SES never verifies receiving or DMARC records.
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
        LogoUpload: {
            /** @description The logo, as the text of an SVG file. Duva converts it to SVG Tiny PS, the profile BIMI asks for: square, titled, and with nothing that runs or fetches, of at most 32 KB. A logo that is SVG Tiny PS already is served byte for byte, so a mark certificate issued for it matches. A picture such as a PNG can't be converted. From the CLI, give a file's text, as --svg "$(cat logo.svg)". */
            svg: string;
        };
        /** @description Either the certificate's https URL, or its PEM. */
        LogoCertificateUpload: {
            /**
             * @description Where the VMC or CMC is served, over https.
             * @example https://example.com/bimi/vmc.pem
             */
            url?: string;
            /** @description The VMC or CMC in PEM, followed by the certificates that issued it. From the CLI, give a file's text, as --pem "$(cat vmc.pem)". */
            pem?: string;
        };
        /** @description A logo Duva serves for the organization, as SVG Tiny PS. */
        HostedLogo: {
            /**
             * Format: uri
             * @description Where Duva serves it, to anyone, as image/svg+xml. It stays the same when the logo changes.
             * @example https://d111111abcdef8.cloudfront.net/bimi/domains/example.com.svg
             */
            url: string;
            /** @description The SVG Duva serves. */
            svg: string;
        };
        /** @description The VMC or CMC the logo's record gives. */
        LogoCertificate: {
            /** Format: uri */
            url: string;
            /** @description Whether Duva serves it, from a PEM it checked vouches for the domain and its logo. */
            hosted: boolean;
        };
        /** @description A TXT record a BIMI logo needs in DNS. */
        BimiRecord: {
            /** @example default._bimi.example.com */
            name: string;
            /** @example v=BIMI1; l=https://d111111abcdef8.cloudfront.net/bimi/domains/example.com.svg; */
            value: string;
            /**
             * @description missing while DNS has no BIMI record at the name, found when it has one that differs from the value, and matches when it has the value.
             * @enum {string}
             */
            status: "missing" | "found" | "matches";
            /** @description The BIMI records DNS has at the name, when they differ from the value. */
            found?: string[];
        };
        /** @description A mailbox's own logo, under its selector, with the record it needs on the domain. */
        SelectorLogo: {
            /** @example grace */
            selector: string;
            /** @description The mailbox's ID. */
            mailbox: string;
            owner: components["schemas"]["Actor"];
            logo: components["schemas"]["HostedLogo"];
            record: components["schemas"]["BimiRecord"];
        };
        DomainLogo: {
            domain: string;
            logo?: components["schemas"]["HostedLogo"];
            certificate?: components["schemas"]["LogoCertificate"];
            /** @description The default._bimi record, once the domain has a logo. */
            record?: components["schemas"]["BimiRecord"];
            /** @description Whether the domain's DMARC policy, its own or a parent domain's, is quarantine or reject for all its mail, which BIMI needs. Receivers show no logo until it is. */
            dmarcEnforced: boolean;
            /** @description Each mailbox on the domain with a logo of its own, by selector. */
            selectors: components["schemas"]["SelectorLogo"][];
        };
        MailboxLogo: {
            /** @description The mailbox's ID. */
            mailbox: string;
            /** @description The mailbox's selector, which Duva gives it with its first logo, and which its mail names in BIMI-Selector. */
            selector?: string;
            logo?: components["schemas"]["HostedLogo"];
            /** @description The record each domain the mailbox's addresses are on needs, for an admin to add. */
            records: components["schemas"]["BimiRecord"][];
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
             * @description The groups the mailbox's owner is a local member of, nested ones included, each by its address. Its drafts can go from any of them as well as from its own addresses.
             * @example [
             *       "support@example.com"
             *     ]
             */
            groups: string[];
            /**
             * @description For an agent, its sponsor access, present when the mailbox is its sponsor's.
             * @enum {string}
             */
            sponsorAccess?: "read" | "organize" | "draft" | "send";
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
             * @description The groups the mailbox's owner is a local member of, nested ones included, each by its address. Its drafts can go from any of them as well as from its own addresses.
             * @example [
             *       "support@example.com"
             *     ]
             */
            groups: string[];
            /**
             * @description How many threads in the Inbox are unread.
             * @example 3
             */
            unread: number;
        };
        MailboxList: {
            mailboxes: components["schemas"]["ListedMailbox"][];
        };
        OrganizationMailboxList: {
            /** @description Every mailbox, those without an address included. */
            mailboxes: components["schemas"]["Mailbox"][];
            /** @description The actors that own the mailboxes, each once. */
            owners: components["schemas"]["Actor"][];
        };
        MailboxChangePage: {
            changes: components["schemas"]["MailboxChange"][];
            /** @description The position of the last change read, listed or left out, or the one asked for if there were none. Pass it as after to continue. */
            position: number;
        };
        /** @description A change in a mailbox. */
        MailboxChange: components["schemas"]["MessageReceived"] | components["schemas"]["DraftWritten"] | components["schemas"]["DraftChanged"] | components["schemas"]["DraftDeleted"] | components["schemas"]["SendAsked"] | components["schemas"]["ApprovalAsked"] | components["schemas"]["ApprovalWithdrawn"] | components["schemas"]["ApprovalDecided"] | components["schemas"]["ApprovalUndone"] | components["schemas"]["MessageSent"] | components["schemas"]["SendWaitingForLimit"] | components["schemas"]["SentNow"] | components["schemas"]["SendFailed"] | components["schemas"]["SendUnclear"] | components["schemas"]["FeedbackReceived"] | components["schemas"]["ThreadRead"] | components["schemas"]["ThreadUnread"] | components["schemas"]["ThreadLabelsChanged"] | components["schemas"]["ReminderSet"] | components["schemas"]["ReminderCancelled"] | components["schemas"]["ThreadBack"] | components["schemas"]["LabelCreated"] | components["schemas"]["LabelRenamed"] | components["schemas"]["LabelDeleted"] | components["schemas"]["ThreadErased"] | components["schemas"]["AgentSettingsChanged"] | components["schemas"]["AgentPaused"] | components["schemas"]["AgentUnpaused"] | components["schemas"]["SenderScreened"] | components["schemas"]["ScreenerSwitched"] | components["schemas"]["ScreenedSenderRemoved"] | components["schemas"]["UnsubscribeAttempted"] | components["schemas"]["SenderDeliverySet"] | components["schemas"]["SenderDeliveryRemoved"] | components["schemas"]["MessageDropped"] | components["schemas"]["LabelPromptSet"] | components["schemas"]["LabelPromptRemoved"] | components["schemas"]["TaskGiven"] | components["schemas"]["TaskStarted"] | components["schemas"]["TaskEnded"];
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
             * @description Present when the mail started a thread that skipped the Inbox: waiting when its sender is first-time, so it waits in the Screener, and blocked when the mailbox had blocked its sender, before deliveries existed, so it went to Trash.
             * @enum {string}
             */
            screened?: "waiting" | "blocked";
            /** @description Present when its sender's delivery filed it outside the Inbox, in the Feed, the Paper Trail or a label. */
            delivered?: components["schemas"]["Delivery"];
            /** @description With delivered, the ID of the label the delivery filed it under, feed, paperTrail or one of the mailbox's own. */
            deliveredTo?: string;
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
        ApprovalUndone: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "approvalUndone";
            /** @description The draft's ID. */
            draft: string;
            /** @description The approval's ID. */
            approval: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "approvalUndone";
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
        SendWaitingForLimit: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "sendWaitingForLimit";
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the approval that let it go, if it needed one. */
            approval?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "sendWaitingForLimit";
        };
        SentNow: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "sentNow";
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the approval that let it go, if it needed one. */
            approval?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "sentNow";
        };
        SendFailed: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "sendFailed";
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the approval that let it go, if it needed one. */
            approval?: string;
            /** @description SES's reason. Always there, except in the activity an admin who isn't the agent's sponsor reads. */
            reason?: string;
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
        /** @description SES reported a bounce, a complaint or a reject for a message sent from the mailbox. No actor made this change, so it names none. */
        FeedbackReceived: {
            /** @description The change's position in the mailbox's feed, counting from 1. */
            position: number;
            /**
             * Format: date-time
             * @description When Duva recorded it.
             */
            at: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "feedbackReceived";
            /** @description The ID of the draft the message was sent from. */
            draft: string;
            /** @description The ID of the thread the message is in. */
            thread: string;
            /** @description The sent message's ID. */
            message: string;
            feedback: components["schemas"]["SendFeedback"];
        };
        /** @description What SES reported about a sent message after accepting it. A hard bounce means the address doesn't take mail, and a soft bounce that it didn't for now. One complaint about an agent's mail, or 5 hard bounces of its mail within an hour, each recipient that isn't one of the organization's addresses counting, pause the agent (ADR-0021). */
        SendFeedback: {
            /**
             * @description hardBounce or softBounce from a recipient's mail server; complaint, when a recipient marked it as spam; or reject, when SES didn't send it after all, as for a virus.
             * @enum {string}
             */
            kind: "hardBounce" | "softBounce" | "complaint" | "reject";
            /**
             * Format: date-time
             * @description When SES says it happened.
             */
            at: string;
            /** @description The recipients it concerns. A reject concerns them all. Always there, except in the activity an admin who isn't the agent's sponsor reads. */
            recipients?: string[];
            /**
             * @description SES's reason, if it gives one, as the bounce's subtype, the complaint's type or the reject's reason.
             * @example NoEmail
             * @example abuse
             * @example Bad content
             */
            reason?: string;
            /** @description The recipients of a hard bounce that are the organization's own addresses, if any. SES takes a few seconds to start receiving mail for a new address, and refuses it until then, so Duva took them off SES's suppression list again, and their bounce never counts toward pausing the agent. */
            localRecipients?: string[];
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
        ReminderSet: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "reminderSet";
            /** @description The ID of the thread. */
            thread: string;
            /**
             * Format: date-time
             * @description When the thread comes back.
             */
            until: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "reminderSet";
        };
        ReminderCancelled: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "reminderCancelled";
            /** @description The ID of the thread. */
            thread: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "reminderCancelled";
        };
        /** @description A thread set aside in Remind me came back to the top of the Inbox, unread, with its Back mark, at its time or early with new mail. No actor made this change, so it names none. */
        ThreadBack: {
            /** @description The change's position in the mailbox's feed, counting from 1. */
            position: number;
            /**
             * Format: date-time
             * @description When the thread came back.
             */
            at: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "threadBack";
            /** @description The ID of the thread. */
            thread: string;
            /**
             * Format: date-time
             * @description When the thread was set aside.
             */
            setAsideAt: string;
            /**
             * @description Present when new mail in the thread brought it back before its time, in the messageReceived change just before.
             * @constant
             */
            early?: true;
        };
        LabelCreated: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "labelCreated";
            /** @description The label's ID. */
            label: string;
            /** @description The label's name. Always there, except in the activity an admin who isn't the agent's sponsor reads. */
            name?: string;
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
            /** @description The label's new name. Always there, except in the activity an admin who isn't the agent's sponsor reads. */
            name?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "labelRenamed";
        };
        LabelPromptSet: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "labelPromptSet";
            /** @description The label's ID. */
            label: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "labelPromptSet";
        };
        LabelPromptRemoved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "labelPromptRemoved";
            /** @description The label's ID. */
            label: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "labelPromptRemoved";
        };
        TaskGiven: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "taskGiven";
            /** @description The task's ID. */
            task: string;
            /** @description The ID of the thread the message is in. */
            thread: string;
            /** @description The ID of the message. */
            message: string;
            /** @description The ID of the label. */
            label: string;
            /** @description The ID of the mailbox agent. */
            agent: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "taskGiven";
        };
        TaskStarted: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "taskStarted";
            /** @description The task's ID. */
            task: string;
            /** @description The ID of the thread the task is about. */
            thread: string;
            /** @description The ID of the mailbox agent. */
            agent: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "taskStarted";
        };
        TaskEnded: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "taskEnded";
            /** @description The task's ID. */
            task: string;
            /** @description The ID of the thread the task is about. */
            thread: string;
            /** @description The ID of the mailbox agent. */
            agent: string;
            /**
             * @description How it ended.
             * @enum {string}
             */
            outcome: "done" | "failed";
            /** @description In the activity the agent's sponsor reads, what the agent said it did, or why it failed, while its thread is kept. The feed itself keeps no note, so an erased thread leaves none. */
            note?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "taskEnded";
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
        /** @description Where mail from a mailbox's first-time senders waits until an actor decides where their mail goes. */
        Screener: {
            /** @description Whether mail from first-time senders waits here. Mail that is already waiting stays until it is decided. */
            on: boolean;
            /** @description The senders whose mail waits, newest first. */
            senders: components["schemas"]["WaitingSender"][];
            /**
             * @description How many addresses and domains the mailbox has decided where mail goes for.
             * @example 42
             */
            decided: number;
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
        SenderDelivery: {
            delivery: components["schemas"]["Delivery"];
            /** @description For label, the ID of the mailbox's own label to file their mail under. */
            label?: string;
        };
        /** @description An address or a domain a mailbox has decided where mail goes for. It has one of address and domain. */
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
            delivery: components["schemas"]["Delivery"];
            /** @description For label, the ID of the label their mail is filed under. */
            label?: string;
            /**
             * Format: date-time
             * @description When it was decided.
             */
            decidedAt: string;
            /** @description The ID of the actor who decided, if one did. Switching the Screener on sends the mailbox's senders' mail to the Inbox under whoever switched it, and setup's under no one. */
            actor?: string;
        };
        /**
         * @description Where a sender's mail goes. inbox: the Inbox. feed: the Feed, for newsletters, read. paperTrail: the Paper Trail, for receipts and notifications, read. label: a label of the mailbox's own, unread, instead of the Inbox. nowhere: dropped on arrival, keeping none of it.
         * @enum {string}
         */
        Delivery: "inbox" | "feed" | "paperTrail" | "label" | "nowhere";
        ScreeningDecision: {
            sender: components["schemas"]["ScreenedSender"];
            /** @description The threads it moved, as they are now, newest first. */
            threads: components["schemas"]["ThreadSummary"][];
            /** @description For nowhere, how many of the sender's threads are being erased for good. */
            erasing?: number;
            /** @description For nowhere, how unsubscribing from the sender's mail went. */
            unsubscribe?: components["schemas"]["Unsubscribe"];
        };
        /** @description A sender in a mailbox, an address or a domain. It has one of address and domain. */
        SenderSheet: {
            /**
             * @description The sender's address, in lower case.
             * @example grace@example.org
             */
            address?: string;
            /**
             * @description The domain, in lower case.
             * @example example.org
             */
            domain?: string;
            /**
             * @description For an address, the sender's name as their newest thread gives it, if it gives one.
             * @example Grace Hopper
             */
            name?: string;
            /**
             * @description How many threads in the mailbox they started, Spam and Trash included. For a domain, everyone's there.
             * @example 12
             */
            threads: number;
            /**
             * @description Where their new mail goes now, as a delivery says, or screener when it waits in the Screener for a first-time sender.
             * @enum {string}
             */
            goesTo: "screener" | "inbox" | "feed" | "paperTrail" | "label" | "nowhere";
            /** @description When goesTo is label, the ID of the label. */
            label?: string;
            /** @description The decision that sends their mail where it goes, the mailbox's on their address or else on their domain, if it has one. */
            decided?: components["schemas"]["ScreenedSender"];
        };
        ScreenedSenderList: {
            /** @description The addresses and domains the mailbox decided on, newest decision first. */
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
            /** @description The sender's address, in lower case, if the decision is on an address or a message was dropped. */
            address?: string;
            /** @description The domain, in lower case, if the decision is on a domain. */
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
            /**
             * @description letIn let the sender's mail into the Inbox, and block sent it to Trash.
             * @enum {string}
             */
            decision: "letIn" | "block";
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
            /**
             * @description The decision it was.
             * @enum {string}
             */
            decision: "letIn" | "block";
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "screenedSenderRemoved";
        };
        SenderDeliverySet: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "senderDeliverySet";
            /** @description The sender's address, in lower case, if the decision is on an address. */
            address?: string;
            /** @description The domain, in lower case, if the decision is on a domain. */
            domain?: string;
            delivery: components["schemas"]["Delivery"];
            /** @description For label, the ID of the label. */
            label?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "senderDeliverySet";
        };
        SenderDeliveryRemoved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "senderDeliveryRemoved";
            /** @description The sender's address, in lower case, if the decision was on an address. */
            address?: string;
            /** @description The domain, in lower case, if the decision was on a domain. */
            domain?: string;
            /** @description The delivery it was. */
            delivery: components["schemas"]["Delivery"];
            /** @description For label, the ID of the label it was. */
            label?: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "senderDeliveryRemoved";
        };
        MessageDropped: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "messageDropped";
            /** @description The sender's address, in lower case. */
            address: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "messageDropped";
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
            /** @description When switched on, how many of the mailbox's senders without a decision yet it sent to the Inbox. */
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
            /**
             * @description The address to send from: one of the mailbox's addresses, or a group its owner is a local member of, to send as the group. A reply or a forward goes from the address the original was sent to unless you give one, and a new message from the default address.
             * @example support@example.com
             */
            from?: string;
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
            /** @description The address to send from, in place of the draft's: one of the mailbox's addresses, or a group its owner is a local member of. */
            from?: string;
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
             * @description The address it goes from, one of the mailbox's or a group's.
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
             * @description waiting for approval; withdrawn because the draft changed while it waited, was sent without approval, or the agent's sponsor access was lowered; rejected, with the approver's note; approved, and about to be sent, which a send without approval is at once; waitingForLimit, approved but over the agent's send limits, or behind its other sends that wait, until it goes out by itself, oldest first, as the limits allow, or its sponsor sends it now; sending; sent, as the message in its thread; failed, with the reason; or unclear, when sending stopped before SES answered, so a human checks whether it went out, by its recipients and subject, since only SES's answer gives its Message-ID. Duva never sends an unclear draft again. An approved draft can't change, but a rejected or failed one can be revised and sent again.
             * @enum {string}
             */
            state: "waiting" | "withdrawn" | "rejected" | "approved" | "waitingForLimit" | "sending" | "sent" | "failed" | "unclear";
            /**
             * Format: date-time
             * @description Until when its approver can undo the approval, for an approved send, which the sender takes only after then: the decision's time and the organization's undo window. A send approved with a window of 0 has none.
             */
            undoUntil?: string;
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
            /** @description What SES reported about the sent message since, oldest first, if it reported anything. */
            feedback?: components["schemas"]["SendFeedback"][];
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
            /**
             * Format: date-time
             * @description Until when its approver can undo it, once approved, as its draft's send says.
             */
            undoUntil?: string;
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
        /** @description A notice to a sponsor that one of their agents needs them. */
        Alert: {
            /** @description The alert's ID. */
            id: string;
            /**
             * @description What happened: sendFailed, the agent's send failed, SES rejected it, or it's unclear whether it went out; bounced, it hard-bounced; complained, a recipient complained about it; limitReached, its sends wait for its send limits, once per window; pausedBy, limitsChangedBy and removedBy, an admin paused it, lowered its limits with a cap, or removed it; keyUsedWhilePaused, its key was used while it is paused, once per pause; autoPaused, Duva paused it because its mail hurts the domain (ADR-0021); spendCapReached, a run of its mailbox agent stopped at the organization's spend cap, once a month; taskFailed, a task a label's prompt gave its mailbox agent failed.
             * @enum {string}
             */
            kind: "sendFailed" | "bounced" | "complained" | "limitReached" | "pausedBy" | "limitsChangedBy" | "removedBy" | "keyUsedWhilePaused" | "autoPaused" | "spendCapReached" | "taskFailed";
            /** @description The ID of the agent the alert is about. */
            agent: string;
            /** @description The agent's name when the alert was raised, kept after it is removed. */
            agentName: string;
            /**
             * Format: date-time
             * @description When the alert was raised.
             */
            at: string;
            /** @description What happened, in a sentence or two. */
            what: string;
            /** @description Whether it is urgent, so also mailed to the sponsor's own mailbox: a complaint, a hard bounce that makes 3 or more within an hour, a pause or removal by someone else, and a pause by Duva. Urgent bounces are mailed once an hour at most, and not while the agent is paused. */
            urgent: boolean;
            /** @description Whether the sponsor marked it seen. */
            seen: boolean;
            /** @description The ID of the actor who paused, changed or removed the agent, for pausedBy, limitsChangedBy and removedBy. */
            by?: string;
            /** @description The ID of the mailbox the message or draft is in, where there is one. */
            mailbox?: string;
            /** @description The ID of the thread the message is in, where there is one. */
            thread?: string;
            /** @description The ID of the message, where there is one. */
            message?: string;
            /** @description The ID of the draft, where there is one. */
            draft?: string;
        };
        AlertList: {
            alerts: components["schemas"]["Alert"][];
            /** @description How many of the alerts listed, on every page, the sponsor hasn't seen. */
            unseen: number;
            /** @description Where the next page starts, if there is one. Give it as after. */
            next?: string;
        };
        AlertIds: {
            /** @description The IDs of the alerts. */
            alerts: string[];
        };
        UnseenAlerts: {
            /** @description How many of your alerts you haven't seen. */
            unseen: number;
        };
        ApprovalList: {
            approvals: components["schemas"]["Approval"][];
            /** @description The setup changes your agent admins asked for that wait for you, newest first. */
            setupApprovals: components["schemas"]["SetupApproval"][];
        };
        /** @description A change to the organization's setup an agent admin asked for, waiting for or decided by its sponsor. */
        SetupApproval: {
            /** @description The setup approval's ID. */
            id: string;
            /**
             * @description Withdrawn when the agent stopped being an admin, or was removed, before it was decided.
             * @enum {string}
             */
            state: "pending" | "withdrawn" | "rejected" | "approved";
            /** @description The ID of the agent that asked. */
            agent: string;
            /** @description The ID of the human who decides, the agent's sponsor. */
            approver: string;
            operation: components["schemas"]["SetupOperation"];
            /**
             * @description What the change does, as Duva works it out from the setup as it is now.
             * @example [
             *       "Gives the mailbox of ada@example.com the address sales@example.com."
             *     ]
             */
            preview: string[];
            /** Format: date-time */
            askedAt: string;
            /** Format: date-time */
            decidedAt?: string;
            /** @description The sponsor's note, if they rejected it. */
            note?: string;
            result?: components["schemas"]["SetupResult"];
        };
        ApprovalLog: {
            entries: components["schemas"]["ApprovalLogEntry"][];
            /** @description Where the next page starts, if there is one. Give it as after. */
            next?: string;
        };
        /** @description A decision on a send one of your agents asked for, and what became of it. */
        ApprovalLogEntry: {
            /** @description The approval's ID. */
            approval: string;
            /** @description The ID of the agent that asked. */
            agent: string;
            /** @description The agent's name when it was decided, kept after it is removed. */
            agentName: string;
            /** @description The ID of the human who decided. */
            decidedBy: string;
            /** Format: date-time */
            decidedAt: string;
            /**
             * @description How it went: approved, on its way, in the undo window, held while the agent is paused, waiting for its send limits or being sent; sent; failed, with the reason; unclear, when sending stopped before SES answered; or rejected, with the note.
             * @enum {string}
             */
            outcome: "approved" | "sent" | "failed" | "unclear" | "rejected";
            /**
             * Format: date-time
             * @description Until when the approval can be undone, while it can.
             */
            undoUntil?: string;
            /**
             * @description How the decision can be taken back, if it can: undo, during the undo window; sendAfterAll, a rejected send whose draft is as the agent asked it, which sending the approval does; correction, a send that went out, which can't be called back, so a correction is written to its recipients.
             * @enum {string}
             */
            reversal?: "undo" | "sendAfterAll" | "correction";
            /** @description The ID of the mailbox the draft is in. */
            mailbox: string;
            /** @description The draft's ID. */
            draft: string;
            /** @description The ID of the thread it went out in, or the one it replies in. */
            thread?: string;
            /** @description The ID of the message it went out as, once sent. */
            message?: string;
            /** @description Its subject, as sent if it was edited. */
            subject: string;
            /** @description Its recipients in To, as sent if the approver changed them. */
            to: components["schemas"]["EmailAddress"][];
            /** @description Its recipients in Cc. Those in Bcc are left out, as every header leaves them out. */
            cc: components["schemas"]["EmailAddress"][];
            /** @description The note, with a rejection. */
            note?: string;
            /** @description Why it failed. */
            reason?: string;
        };
        /** @description The call the agent made, which approving makes again as the agent. */
        SetupOperation: {
            /**
             * @description The operation's ID in this document.
             * @example addAddress
             */
            operationId: string;
            /** @description Its path parameters. */
            path?: {
                [key: string]: string;
            };
            /** @description Its JSON body. */
            body?: {
                [key: string]: unknown;
            };
        };
        /** @description What the change answered once approved, as it would have answered the agent. */
        SetupResult: {
            /** @description The HTTP status code. */
            status: number;
            /** @description The JSON body. */
            body: unknown;
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
        /** @description The threads to set aside, and when they come back. Give exactly one of at and preset. */
        ThreadsReminder: {
            /** @description The IDs of the threads. */
            threads: string[];
            /**
             * Format: date-time
             * @description When the threads come back, to the second, at least a minute from now.
             * @example 2026-10-08T08:00:00+02:00
             */
            at?: string;
            preset?: components["schemas"]["ReminderPreset"];
            /**
             * @description The time zone a preset is counted in, as an IANA name. Left out, it is your time zone preference, for an agent its sponsor's, or UTC if they chose none.
             * @example Europe/Stockholm
             */
            timeZone?: string;
        };
        /**
         * @description A time counted from now, in the time zone: laterToday is three hours from now, on the hour after, tomorrowMorning is 8:00 tomorrow, and nextWeek is 8:00 next Monday.
         * @enum {string}
         */
        ReminderPreset: "laterToday" | "tomorrowMorning" | "nextWeek";
        /** @description When a thread set aside in Remind me comes back. */
        Reminder: {
            /**
             * Format: date-time
             * @description When the thread comes back to the Inbox.
             */
            at: string;
            /**
             * Format: date-time
             * @description When the thread was first set aside. Changing the time keeps it.
             */
            setAt: string;
        };
        /** @description The Back mark of a thread that came back from Remind me, which it keeps until it leaves the Inbox. */
        Back: {
            /**
             * Format: date-time
             * @description When the thread came back. It lists at this time, unless newer mail lists it later.
             */
            at: string;
            /**
             * Format: date-time
             * @description When the thread was set aside.
             */
            setAsideAt: string;
        };
        Label: {
            /**
             * @description The label's ID, which threads list among their labels. The built-in labels' are inbox, feed, paperTrail, spam and trash.
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
            /** @description The label's prompt, if it has one, which hands each message that gets the label to the mailbox agent as a task. */
            prompt?: string;
        };
        LabelList: {
            labels: components["schemas"]["Label"][];
        };
        LabelPrompt: {
            /**
             * @description What the mailbox agent is to do with each message that gets the label.
             * @example File the receipt's amount and date in a draft to my accountant, and leave it unsent.
             */
            prompt: string;
        };
        /** @description Work a label's prompt gave the mailbox agent: the prompt, with a message that got the label and its thread. */
        Task: {
            /** @description The task's ID. */
            id: string;
            /** @description The ID of the label whose prompt gave it. */
            label: string;
            /** @description The label's name when it gave the task. */
            labelName: string;
            /** @description The label's prompt when it gave the task. */
            prompt: string;
            /** @description The ID of the message that got the label. */
            message: string;
            /** @description The ID of the mailbox agent the task is for. */
            agent: string;
            /**
             * @description waiting, for its turn, or while the agent is paused; working, the agent is on it; done, the agent finished it, with its note; failed, the agent couldn't, and why is in its note.
             * @enum {string}
             */
            state: "waiting" | "working" | "done" | "failed";
            /**
             * Format: date-time
             * @description When the label gave it.
             */
            givenAt: string;
            /** @description The ID of the actor who added the label, or duva when a sender's delivery did. */
            givenBy: string;
            /**
             * Format: date-time
             * @description When the agent started it.
             */
            startedAt?: string;
            /**
             * Format: date-time
             * @description When it was done or failed.
             */
            endedAt?: string;
            /** @description What the agent said it did, or why it failed. */
            note?: string;
            /** @description What the agent did in it, in order. */
            actions?: components["schemas"]["AgentAction"][];
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
            /** @description True when Duva knows an agent sent the thread's first message, as its message's fromAgent says. Absent otherwise. */
            fromAgent?: boolean;
            /** @description The logo of whoever sent the thread's first message, as its message's logo says. */
            logo?: components["schemas"]["SenderLogo"];
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
            /**
             * @description The addresses of the groups the thread's mail came through as members' copies, in the order it first came through each. Absent when none did, and for threads whose group mail arrived before Duva kept this.
             * @example [
             *       "support@example.com"
             *     ]
             */
            groups?: string[];
            /** @description Present while the thread is set aside in Remind me. */
            reminder?: components["schemas"]["Reminder"];
            /** @description Present when the thread came back from Remind me and is still in the Inbox. */
            back?: components["schemas"]["Back"];
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
            /** @description Present while the thread is set aside in Remind me. */
            reminder?: components["schemas"]["Reminder"];
            /** @description Present when the thread came back from Remind me and is still in the Inbox. */
            back?: components["schemas"]["Back"];
            messages: components["schemas"]["Message"][];
            /** @description The tasks labels' prompts gave the mailbox agent for the thread's messages, oldest first. Present when there are any. */
            tasks?: components["schemas"]["Task"][];
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
            sentAs?: components["schemas"]["SentAsGroup"];
            /** @description True when Duva knows an agent sent the message: an agent sent it from this Duva, or it came with the Duva-Agent header from one of the organization's domains with a DMARC pass, as a message an agent sent from another of its mailboxes does. Absent otherwise, and on mail Duva received before it kept this. */
            fromAgent?: boolean;
            /** @description The sender's logo, which their domain publishes through BIMI, on received mail that passed DMARC from a domain that enforces it. Absent otherwise, on mail from an agent, and on mail Duva received before it kept this. */
            logo?: components["schemas"]["SenderLogo"];
            /** @description Who approved the message before it was sent, if an agent sent it. */
            approval?: components["schemas"]["SentApproval"];
            /** @description What SES reported about a message sent from the mailbox, oldest first, if it reported anything. */
            feedback?: components["schemas"]["SendFeedback"][];
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
        /** @description A sender's logo, which their domain publishes through BIMI. Duva fetched it when the mail arrived, checked that it is SVG Tiny PS and wrote it out again without anything that could run or fetch, so showing it never reaches the sender (ADR-0023). */
        SenderLogo: {
            /**
             * Format: uri
             * @description Where Duva serves the logo, an SVG, to anyone with the URL.
             * @example https://d111111abcdef8.cloudfront.net/download/logos/6f1c2a9e-0d3b-4c5e-9a8f-1b2c3d4e5f60
             */
            url: string;
            /** @description Whether a mark certificate (a VMC or CMC) from a Mark Verifying Authority vouches for the logo and the domain, so the logo is the brand's own. */
            verified: boolean;
        };
        /** @description On a copy of a message another local member sent as a group, who sent it and as which group. Each other local member's mailbox gets one, in the thread of the message it answers, so nobody answers twice. */
        SentAsGroup: {
            /**
             * @description The group's address, which the message went out from.
             * @example support@example.com
             */
            group: string;
            /** @description The ID of the actor who sent it. */
            by: string;
            /**
             * @description Who sent it, as the address a human signs in with, or an agent's name.
             * @example grace@example.com
             */
            name: string;
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
        OrganizationChange: components["schemas"]["OrganizationAdded"] | components["schemas"]["DomainAdded"] | components["schemas"]["DomainRemoved"] | components["schemas"]["SignInDomainChanged"] | components["schemas"]["CatchAllChanged"] | components["schemas"]["ActorAdded"] | components["schemas"]["AgentKeyRotated"] | components["schemas"]["AgentPaused"] | components["schemas"]["AgentUnpaused"] | components["schemas"]["MailboxAdded"] | components["schemas"]["AddressAdded"] | components["schemas"]["AddressRemoved"] | components["schemas"]["DefaultAddressChanged"] | components["schemas"]["GroupAdded"] | components["schemas"]["GroupChanged"] | components["schemas"]["GroupRemoved"] | components["schemas"]["SettingsChanged"] | components["schemas"]["ActorRemoved"] | components["schemas"]["AdminChanged"] | components["schemas"]["MailboxHandedOver"] | components["schemas"]["MailboxDeleted"] | components["schemas"]["AgentAdminChanged"] | components["schemas"]["SetupAsked"] | components["schemas"]["SetupApproved"] | components["schemas"]["SetupRejected"] | components["schemas"]["SetupWithdrawn"];
        ChangeBase: {
            /** @description The change's position in the feed, counting from 1. */
            position: number;
            /**
             * Format: date-time
             * @description When the change was made.
             */
            at: string;
            /** @description The ID of the actor who made the change, or duva for one Duva made by itself, as when it pauses an agent. */
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
        CatchAllChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "catchAllChanged";
            /**
             * @description The standalone domain.
             * @example example.com
             */
            domain: string;
            /** @description The domain's catch-all from now on, left out when it was cleared. */
            catchAll?: components["schemas"]["CatchAll"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "catchAllChanged";
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
        AgentPaused: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "agentPaused";
            /** @description The ID of the agent paused. */
            agent: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agentPaused";
        };
        AgentUnpaused: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "agentUnpaused";
            /** @description The ID of the agent unpaused. */
            agent: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agentUnpaused";
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
        AgentAdminChanged: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "agentAdminChanged";
            /** @description The ID of the agent. */
            agent: string;
            /** @description Whether the agent is an admin now. */
            admin: boolean;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agentAdminChanged";
        };
        SetupAsked: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "setupAsked";
            /** @description The ID of the setup approval. */
            approval: string;
            operation: components["schemas"]["SetupOperation"];
            /** @description What the change would do, as Duva worked it out then. */
            preview: string[];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "setupAsked";
        };
        SetupApproved: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "setupApproved";
            /** @description The ID of the setup approval. */
            approval: string;
            /** @description The ID of the agent that asked. */
            agent: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "setupApproved";
        };
        SetupRejected: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "setupRejected";
            /** @description The ID of the setup approval. */
            approval: string;
            /** @description The ID of the agent that asked. */
            agent: string;
            /** @description The sponsor's note. */
            note: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "setupRejected";
        };
        SetupWithdrawn: components["schemas"]["ChangeBase"] & {
            /** @constant */
            type: "setupWithdrawn";
            /** @description The ID of the setup approval. */
            approval: string;
            /** @description The ID of the agent that asked. */
            agent: string;
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "setupWithdrawn";
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
            searchLanguages: components["schemas"]["SearchLanguages"];
            agentSendsPerHourCap: components["schemas"]["AgentSendsPerHourCap"];
            agentNewRecipientsPerDayCap: components["schemas"]["AgentNewRecipientsPerDayCap"];
            undoWindowSeconds: components["schemas"]["UndoWindowSeconds"];
            mailboxAgentModel: components["schemas"]["MailboxAgentModel"];
            mailboxAgentProfile: components["schemas"]["MailboxAgentProfile"];
            mailboxAgentRegion: components["schemas"]["MailboxAgentRegion"];
            mailboxAgentSpendCap: components["schemas"]["MailboxAgentSpendCap"];
        };
        /** @description The settings changed, each with its new value. */
        SettingsChanges: {
            erasureErasesApprovals?: components["schemas"]["ErasureErasesApprovals"];
            retentionDays?: components["schemas"]["RetentionDays"];
            searchLanguages?: components["schemas"]["SearchLanguages"];
            agentSendsPerHourCap?: components["schemas"]["AgentSendsPerHourCap"];
            agentNewRecipientsPerDayCap?: components["schemas"]["AgentNewRecipientsPerDayCap"];
            undoWindowSeconds?: components["schemas"]["UndoWindowSeconds"];
            mailboxAgentModel?: components["schemas"]["MailboxAgentModel"];
            mailboxAgentProfile?: components["schemas"]["MailboxAgentProfile"];
            mailboxAgentRegion?: components["schemas"]["MailboxAgentRegion"];
            mailboxAgentSpendCap?: components["schemas"]["MailboxAgentSpendCap"];
        };
        /** @description How many days Trash and Spam keep a thread, counted from when it got the label, before the eraser erases it for good. 30 by default, and a whole number from 7 to 365. It applies to all Trash and Spam, threads already there included. */
        RetentionDays: number;
        /** @description The most sendsPerHour a sponsor can give an agent. 100 by default. Lowering it lowers each agent above it to it, recorded as a change to the agent's settings under you. Raising it raises no agent. */
        AgentSendsPerHourCap: number;
        /** @description The most newRecipientsPerDay a sponsor can give an agent. 50 by default. Lowering it lowers each agent above it to it, recorded as a change to the agent's settings under you. Raising it raises no agent. */
        AgentNewRecipientsPerDayCap: number;
        /** @description How many seconds an approved send waits before the sender takes it, so its approver can undo the approval meanwhile. 30 by default, and a whole number from 0 to 120, where 0 sends at once. A change applies to approvals from then on. A human's own sends never wait. */
        UndoWindowSeconds: number;
        MailboxAgentConversation: {
            agent: components["schemas"]["Agent"];
            turns: components["schemas"]["ConversationTurn"][];
        };
        /** @description What you asked your mailbox agent, or what it answered and did. */
        ConversationTurn: {
            /** @description The turn's ID. */
            id: string;
            /**
             * Format: date-time
             * @description When the turn began.
             */
            at: string;
            /**
             * @description Who took the turn, you or the agent.
             * @enum {string}
             */
            from: "human" | "agent";
            /** @description What was said. */
            text: string;
            /** @description What the agent did in the turn, in order. None for yours. */
            actions: components["schemas"]["AgentAction"][];
            /**
             * @description How the agent's turn ended: answered; capReached, it stopped as the mailbox agents reached the organization's spend cap; failed, the model or the runtime failed, so asking again may work.
             * @enum {string}
             */
            outcome?: "answered" | "capReached" | "failed";
        };
        /** @description One call the mailbox agent made to Duva's API, as its tool. */
        AgentAction: {
            /** @description The operation's ID in this document, such as getThread. */
            operation: string;
            /** @description What the operation does, its summary. */
            what: string;
            /** @description Whether Duva did it. A refusal says why in message. */
            ok: boolean;
            /** @description Duva's refusal, when it refused. */
            message?: string;
            /** @description The IDs of the threads it read or changed, if any. */
            threads?: string[];
            /** @description The ID of the draft it wrote, changed or asked to send, if any. */
            draft?: string;
        };
        MailboxAgentSpend: {
            /**
             * @description The month counted, as YYYY-MM in UTC.
             * @example 2026-10
             */
            month: string;
            /** @description What the mailbox agents' model calls cost this month, in US dollars. */
            spent: number;
            cap: components["schemas"]["MailboxAgentSpendCap"];
        };
        /**
         * @description The Claude model on Amazon Bedrock the mailbox agents think with: Claude Sonnet 5.5, the default, Claude Haiku 4.5, which costs about a half as much, or Claude Opus 5.5, which costs about twice as much.
         * @enum {string}
         */
        MailboxAgentModel: "anthropic.claude-sonnet-5-5" | "anthropic.claude-haiku-4-5-20251001-v1:0" | "anthropic.claude-opus-5-5";
        /**
         * @description The inference profile Bedrock runs the model through, which decides where the mail the agents read is processed: eu keeps it in the EU's AWS regions, us in the US's, and global sends it to any region with capacity, for about 10% less. eu by default for a deployment in the EU, us for one in the US, and global elsewhere. eu needs an EU mailboxAgentRegion, us a US one.
         * @enum {string}
         */
        MailboxAgentProfile: "eu" | "us" | "global";
        /**
         * @description The AWS region the mailbox agents call Bedrock in, which the profile sends on from. eu-central-1 by default for a deployment in the EU, us-west-2 for one in the US.
         * @enum {string}
         */
        MailboxAgentRegion: "eu-central-1" | "eu-west-1" | "eu-west-3" | "eu-north-1" | "us-east-1" | "us-east-2" | "us-west-2";
        /** @description The most the mailbox agents may spend on their model a month, in whole US dollars, 20 by default. At the cap a run stops, its agent's sponsor gets an alert, and runs are refused until the month ends or an admin raises it. 0 turns the mailbox agents off. */
        MailboxAgentSpendCap: number;
        RetentionPreview: {
            retentionDays: components["schemas"]["RetentionDays"];
            /** @description How many threads in Trash and Spam are older than retentionDays now. */
            threads: number;
        };
        /** @description Whether erasing a thread also erases the approval records of the agents' sends in it: the draft its approver saw and any edit they made. Off by default, so the records stay as the account of what an agent sent and who approved it. Either way the mailbox's change feed keeps each decision and who made it. */
        ErasureErasesApprovals: boolean;
        /**
         * @description The languages the organization's mail is in, English and Swedish by default. Each search is also translated into every other one on the list, so "kvitto" finds an English receipt: its words go to Amazon's Nova Lite model, in the same AWS region as the mail, which adds a little time to each search. With fewer than two, searches aren't translated. Quoted phrases and subject: never are. English and Swedish mail is always indexed in its own language. Adding another, or removing it, rebuilds every mailbox's search index, embedding its mail again, and search finds less until that is done.
         * @example [
         *       "English",
         *       "Swedish"
         *     ]
         */
        SearchLanguages: components["schemas"]["SearchLanguage"][];
        /**
         * @description A language search knows.
         * @enum {string}
         */
        SearchLanguage: "English" | "Swedish" | "Danish";
        ActivitySummaries: {
            /**
             * @description The time zone the days are in.
             * @example Europe/Stockholm
             */
            timeZone: string;
            /** @description Every day asked for, newest first. */
            days: components["schemas"]["ActivitySummary"][];
        };
        /** @description How much an agent did in one day. */
        ActivitySummary: {
            /**
             * Format: date
             * @example 2026-10-06
             */
            day: string;
            /** @description The messages it sent that SES accepted. */
            sent: number;
            /** @description Its sends its sponsor approved. */
            approved: number;
            /** @description Its sends its sponsor rejected. */
            rejected: number;
            /** @description The messages that arrived in its mailboxes, spam included. */
            received: number;
            /** @description The times it marked threads read or unread, changed their labels, or created, renamed or deleted a label. */
            organized: number;
            /** @description The times it let a sender in, blocked one, removed a decision on one, or switched a Screener. */
            screened: number;
            /** @description The alerts about it its sponsor got that day. */
            alerts: number;
        };
        ActivityTimeline: {
            /**
             * Format: date
             * @example 2026-10-06
             */
            day: string;
            /**
             * @description The time zone the day is in.
             * @example Europe/Stockholm
             */
            timeZone: string;
            /** @description The page's entries, newest first. */
            entries: components["schemas"]["ActivityEntry"][];
            /** @description Present when more entries follow. Pass it as after to list the next page. */
            next?: string;
        };
        /** @description One change in an agent's activity: in one of its mailboxes, by it in its sponsor's mailbox or about its sends there, or in the organization's setup about it or by it. */
        ActivityEntry: {
            /** @description The ID of the mailbox whose change feed recorded it, unless the organization's did. */
            mailbox?: string;
            /** @description The ID of the thread it is about, if it is about one. A draft's is the thread it replies in or was sent in. */
            thread?: string;
            /** @description The change as its feed recorded it. Its position is in that feed. For an admin who isn't the agent's sponsor, a change in a mailbox leaves out what its mail says: edits, note, name, address, domain, the feedback's recipients, and SES's reason for refusing a send. */
            change: components["schemas"]["MailboxChange"] | components["schemas"]["OrganizationChange"];
        };
        /** @description A human's own preferences. */
        Preferences: {
            hourCycle: components["schemas"]["HourCycle"];
            dateFormat: components["schemas"]["DateFormat"];
            mailView: components["schemas"]["MailView"];
            keyboardShortcuts: components["schemas"]["KeyboardShortcuts"];
            timeZone?: components["schemas"]["TimeZone"];
        };
        /** @description The preferences changed, each with its new value. */
        PreferencesChanges: {
            hourCycle?: components["schemas"]["HourCycle"];
            dateFormat?: components["schemas"]["DateFormat"];
            mailView?: components["schemas"]["MailView"];
            keyboardShortcuts?: components["schemas"]["KeyboardShortcuts"];
            /** @description The time zone, as an IANA name, or null to remove it, as if the human never chose one. The CLI removes it with --no-timeZone. */
            timeZone?: components["schemas"]["TimeZone"] | null;
        };
        /**
         * @description The time zone an agent's activity is in, as an IANA name. Left out until the human chooses one, when the API counts days in UTC and the web app in the browser's time zone.
         * @example Europe/Stockholm
         */
        TimeZone: string;
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
        /**
         * @description Whether single keys work as shortcuts in the web app, such as j and k to move through a list and e to archive. on, the default, has them work anywhere but in a field. off turns them all off, for speech input or keys pressed by mistake.
         * @enum {string}
         */
        KeyboardShortcuts: "on" | "off";
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
        /** @description You are an agent admin, so the change waits for your sponsor's approval, which runs it as you. Read the setup approval to see what became of it. */
        SetupAsked: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["SetupApproval"];
            };
        };
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
        /** @description Too many calls like this one in the last 10 minutes. Wait, then try again. */
        TooManyRequests: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        /** @description The sender's address, like grace@example.org, or a domain, like example.org, for everyone at exactly that domain. Case doesn't matter. */
        Sender: string;
        /** @description The mailbox's ID. */
        Mailbox: string;
        /** @description The draft's ID. */
        Draft: string;
        /** @description The label's ID. */
        Label: string;
        /** @description The approval's ID. */
        Approval: string;
        /** @description The time zone days are in, an IANA name such as Europe/Stockholm. Defaults to your timeZone preference, or UTC if you have none. */
        TimeZone: string;
        /** @description The code the agent shows, as BCDF-GHJK. Case and the dash don't matter. */
        AccessCode: string;
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
    listOrganizationMailboxes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization's mailboxes, and the actors that own them. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationMailboxList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    listOrganizationAgents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization's agents. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getMailboxAgentSpend: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The month's spend. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxAgentSpend"];
                };
            };
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
    changeAgent: {
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
                "application/json": components["schemas"]["AgentChanges"];
            };
        };
        responses: {
            /** @description The agent, changed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Agent"];
                };
            };
            400: components["responses"]["BadRequest"];
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
    pauseAgent: {
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
            /** @description The agent, paused. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Agent"];
                };
            };
            202: components["responses"]["SetupAsked"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    unpauseAgent: {
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
            /** @description The agent, unpaused. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Agent"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
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
    getAgentActivity: {
        parameters: {
            query?: {
                /** @description The first day, as YYYY-MM-DD. Defaults to 29 days before to. */
                from?: string;
                /** @description The last day, as YYYY-MM-DD, at most 366 days after from. Defaults to today in your time zone. */
                to?: string;
                /** @description The time zone days are in, an IANA name such as Europe/Stockholm. Defaults to your timeZone preference, or UTC if you have none. */
                timeZone?: components["parameters"]["TimeZone"];
            };
            header?: never;
            path: {
                /** @description The agent's ID. */
                agent: components["parameters"]["Agent"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The agent's daily summaries. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivitySummaries"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getAgentActivityDay: {
        parameters: {
            query?: {
                /** @description The time zone days are in, an IANA name such as Europe/Stockholm. Defaults to your timeZone preference, or UTC if you have none. */
                timeZone?: components["parameters"]["TimeZone"];
                /** @description How many entries a page lists at most. */
                limit?: number;
                /** @description Where the page starts, the next of the page before it. Leave it out for the first page. */
                after?: string;
            };
            header?: never;
            path: {
                /** @description The agent's ID. */
                agent: components["parameters"]["Agent"];
                /** @description The day, as YYYY-MM-DD, in your time zone. */
                day: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the day's timeline. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityTimeline"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    askForAccess: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccessAsked"];
            };
        };
        responses: {
            /** @description The request, waiting for a human. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessRequestStarted"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    collectAccess: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccessCollected"];
            };
        };
        responses: {
            /** @description The agent the human approved, and its key. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentWithKey"];
                };
            };
            /** @description The request still waits for a human. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            400: components["responses"]["BadRequest"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The code the agent shows, as BCDF-GHJK. Case and the dash don't matter. */
                code: components["parameters"]["AccessCode"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The request. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessRequest"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    approveAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The code the agent shows, as BCDF-GHJK. Case and the dash don't matter. */
                code: components["parameters"]["AccessCode"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AccessApproval"];
            };
        };
        responses: {
            /** @description The agent, created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Agent"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    declineAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The code the agent shows, as BCDF-GHJK. Case and the dash don't matter. */
                code: components["parameters"]["AccessCode"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The request, declined. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessDeclined"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    setCatchAll: {
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
                "application/json": components["schemas"]["CatchAll"];
            };
        };
        responses: {
            /** @description The domain, with its catch-all. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            202: components["responses"]["SetupAsked"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    clearCatchAll: {
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
            /** @description The domain, without a catch-all. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            202: components["responses"]["SetupAsked"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getDomainLogo: {
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
            /** @description The domain's logo. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainLogo"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    setDomainLogo: {
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
                "application/json": components["schemas"]["LogoUpload"];
            };
        };
        responses: {
            /** @description The domain's logo, set. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainLogo"];
                };
            };
            202: components["responses"]["SetupAsked"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    removeDomainLogo: {
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
            /** @description The domain, without a logo. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainLogo"];
                };
            };
            202: components["responses"]["SetupAsked"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    setLogoCertificate: {
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
                "application/json": components["schemas"]["LogoCertificateUpload"];
            };
        };
        responses: {
            /** @description The domain's logo, with its certificate. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainLogo"];
                };
            };
            202: components["responses"]["SetupAsked"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    removeLogoCertificate: {
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
            /** @description The domain's logo, without a certificate. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainLogo"];
                };
            };
            202: components["responses"]["SetupAsked"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getMailboxLogo: {
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
            /** @description The mailbox's logo. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxLogo"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    setMailboxLogo: {
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
                "application/json": components["schemas"]["LogoUpload"];
            };
        };
        responses: {
            /** @description The mailbox's logo, set. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxLogo"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    removeMailboxLogo: {
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
            /** @description The mailbox, without a logo. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxLogo"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
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
            202: components["responses"]["SetupAsked"];
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
            202: components["responses"]["SetupAsked"];
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
    remindThreads: {
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
                "application/json": components["schemas"]["ThreadsReminder"];
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
            409: components["responses"]["Conflict"];
        };
    };
    cancelReminders: {
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
    listReminders: {
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
            /** @description A page of the threads set aside. */
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
    setLabelPrompt: {
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
                "application/json": components["schemas"]["LabelPrompt"];
            };
        };
        responses: {
            /** @description The label, with its prompt. */
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
    removeLabelPrompt: {
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
            /** @description The label, without a prompt. */
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
    getMailboxAgent: {
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
            /** @description The mailbox agent and the conversation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxAgentConversation"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    clearConversation: {
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
            /** @description The mailbox agent and the conversation, now empty. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxAgentConversation"];
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
    listSenders: {
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
    getSender: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The sender's address, like grace@example.org, or a domain, like example.org, for everyone at exactly that domain. Case doesn't matter. */
                sender: components["parameters"]["Sender"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The sender's sheet. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SenderSheet"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    setSenderDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The sender's address, like grace@example.org, or a domain, like example.org, for everyone at exactly that domain. Case doesn't matter. */
                sender: components["parameters"]["Sender"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SenderDelivery"];
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
    removeSenderDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox's ID. */
                mailbox: components["parameters"]["Mailbox"];
                /** @description The sender's address, like grace@example.org, or a domain, like example.org, for everyone at exactly that domain. Case doesn't matter. */
                sender: components["parameters"]["Sender"];
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
    sendDraftNow: {
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
            /** @description The draft, approved and about to be sent. */
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
    listAlerts: {
        parameters: {
            query?: {
                /** @description List only the alerts about this agent. */
                agent?: string;
                /** @description How many alerts a page lists at most. */
                limit?: number;
                /** @description Where the page starts, the next of the page before it. Leave it out for the first page. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the alerts, newest first. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlertList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    markAlertsSeen: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AlertIds"];
            };
        };
        responses: {
            /** @description How many of your alerts you haven't seen now. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnseenAlerts"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
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
    listApprovalLog: {
        parameters: {
            query?: {
                /** @description How many entries a page lists at most. */
                limit?: number;
                /** @description Where the page starts, the next of the page before it. Leave it out for the first page. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the log, newest first. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalLog"];
                };
            };
            400: components["responses"]["BadRequest"];
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
    undoApproval: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The approval's ID. */
                approval: components["parameters"]["Approval"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The approval, waiting for you again. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Approval"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getSetupApproval: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The approval's ID. */
                approval: components["parameters"]["Approval"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The setup approval. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupApproval"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    approveSetup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The approval's ID. */
                approval: components["parameters"]["Approval"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The setup approval, approved, with what the change answered. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupApproval"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    rejectSetup: {
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
            /** @description The setup approval, rejected. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupApproval"];
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
