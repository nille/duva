# The mailbox agent unsubscribes harder for nowhere, and bounces as a last resort

Supersedes ADR-0016. Many senders offer no one-click unsubscribe but do have an opt-out page, a `mailto:` in List-Unsubscribe, or a link in the body. So when a sender's mail goes nowhere (ADR-0025) and one-click doesn't unsubscribe, the mailbox's mailbox agent (ADR-0027) goes on by itself. Choosing nowhere is the owner's consent, so nothing waits for an approval: it only ever unsubscribes. Nicklas chose this on 2026-10-08 (#131), with the research in `docs/research/unsubscribe-browser-and-bounce.md`.

The order is:

1. **One-click**, as ADR-0016 had it: RFC 8058's POST from the unsubscriber Lambda, at once, under the actor who chose nowhere, or no actor for a message dropped later.
2. **The opt-out page**, the List-Unsubscribe `https:` URI. The agent opens it in AgentCore Browser: a fresh browser in a microVM of its own, with no cookies, nothing of Duva's and no other mail. It follows a few steps at most. Its only tools are filling in the mailbox's address, choosing opt-out options, clicking, and finishing with whether the page said it is unsubscribed. It can type nothing but the address. It never creates an account, signs in, pays or solves a CAPTCHA: a page that needs any of those is a failure. It has none of Duva's operations, and its run's token stays in the runtime, out of the model's and the page's reach, so a page that tells it to do something else reaches nothing. The address goes only in a field for an email address.
3. **The unsubscribe address**, the List-Unsubscribe `mailto:`. The agent mails it from the mailbox's address the message was sent to, with the subject and body the URI gives. The mail is the agent's: it carries the Duva-Agent header, and the visible line unless that's switched off, and counts toward its send limits, but it needs no approval.
4. **A link in the body**, which says it unsubscribes, by its text or its URL. It counts only on the domain of a DKIM signature that passed over the whole body and is aligned with the From's domain, or on a mailing service's known unsubscribe host: Mailchimp's `list-manage.com`, Campaign Monitor's `createsend.com`, `constantcontact.com`, `klaviyo.com`, `substack.com`, `beehiiv.com`, `mailerlite.com` and `convertkit.com`. Two links at most, each as the page is.
5. **A bounce**, the last resort. SES's SendBounce answers the message's envelope sender with a 5.1.1, "user unknown", for the address it was sent to, so the list sees the address as gone. Once the agent bounces, it bounces each later message from the sender and tries nothing else.

Only the methods the message offers are tried. The first that works stops the agent, and the sender's later mail is then only dropped. A page that said "unsubscribed" and a sent request both count as working, since Duva can't tell more. A bounce keeps going.

The safety line: nothing for mail SES judged to be spam, since an answer confirms a live address. The page and the address need mail that passed DMARC, with List-Unsubscribe under a DKIM signature SES found passing. One-click keeps ADR-0016's signature over both headers. A link needs DMARC too. A bounce needs DMARC and an envelope sender, so it never reaches someone a forger named, and never goes to the organization's own domains, which the sheet then says.

One run at a time goes through the methods for a sender, under a lease on the sender's decision, so two messages dropped close together never mail the unsubscribe address twice; a message dropped while a run goes is only dropped. Each message is bounced once, as a group's refusal is. Every attempt but one-click, which stays under whoever chose nowhere or no one, as ADR-0025 has it, is recorded under the agent, in the mailbox's change feed and so in its activity, and on the sender's decision, which their sheet shows: `unsubscribe: {method, outcome, at, detail}`. Each attempt holds only while the decision is still the nowhere it was handed, so a sender set back to the Inbox stops the agent. A paused agent, or one its owner gave no access, does nothing. The browser's model calls count toward the mailbox agents' spend cap like any run, and at the cap the page fails and the agent goes on with the methods that need no model.

## Considered options

- Keeping one-click only (ADR-0016). Rejected: many senders don't offer it, and their mail keeps coming, dropped or not.
- Asking the owner to approve each attempt. Rejected: choosing nowhere is the consent, and every attempt only unsubscribes.
- A headless browser Duva runs itself, in a Lambda. Rejected for now: AgentCore Browser is in the deployment's region and the model's, costs nothing idle, and isolates each session in a microVM of its own.
- The agent's own run, with Duva's operations beside the browser. Rejected: a hostile page could steer it into the mailbox. The browser run has the page's tools only.
- Any link in the body. Rejected: an arbitrary link can do anything, and a forged one confirms the address to whoever forged it.

## Consequences

- What a message offers is read from its raw copy as it is dropped, or as nowhere is chosen, and handed on with the agent's work, since Duva keeps no copy of mail that goes nowhere (ADR-0025).
- The task runner Lambda also runs the agent's unsubscribing, which the API and the inbound Lambda hand it, through IAM. It may SendBounce from the organization's identities.
- The stack has an AgentCore Browser of its own, on the public network, recording nothing, which only the mailbox agents' runtime may use. In the five regions without AgentCore, there is no browser, the page and links fail, and the address and the bounce still go.
- SES bounces a message only within 24 hours of receiving it. A sender's newest mail older than that waits for their next message to be bounced.
- The unsubscribe mail is in the mailbox's sent mail, from the agent, as its other sends are.
