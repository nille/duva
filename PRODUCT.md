# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

A React single-page app built with Vite, in TypeScript, inside Duva's one monorepo (ADR-0005). It is served from S3 through CloudFront and talks only to Duva's API, through the client generated from the OpenAPI document (ADR-0009). Nicklas chose this in the design session on 2026-10-02. The styling approach and any component library are not decided yet.

## Users

The humans of one organization, such as a family or a small company. Each deployment serves exactly one organization (ADR-0002).

- **Everyday members** use the web app daily for their own mail. They must never need to know about AWS, DNS, CLIs or how agents work.
- **Admins** are technical. One deploys Duva into the organization's AWS account with `duva deploy`, and admins change the setup: domains, addresses, groups and actors.
- **Sponsors** are humans who created an agent and answer for it. They approve its sends and its setup changes, see what it did, and can pause it or rotate its key.

Agents are actors too, equal to humans (ADR-0001), but they work through the CLI and the API, never the web app. The first real deployment is Nicklas's own, where he is admin and sponsor of his agents.

## Product Purpose

Duva is a self-hosted mailbox platform on Amazon SES where humans and agents both receive, read and send mail. The web app is the humans' daily mail client. Supervising agents, through approvals and a record of what they did, lives inside it, never in a separate console.

Success means an organization can let agents own mailboxes and answer mail on its own domains, with a human signing off before anything goes out, all inside its own AWS account, at close to zero cost while idle. The first milestone is an agent's reply waiting for its sponsor's approval (issue #1).

## Positioning

- Agents are actors with their own mailboxes and grants, and every action is attributed to exactly one actor. The usual model treats an agent as an API client acting as a human.
- Human sign-off is part of the model. An agent's sends wait for approval, and every message an agent sends carries the disclosure, so recipients can tell.
- Each organization runs Duva in its own AWS account. An idle deployment costs close to nothing (ADR-0006), and the code is open source under MIT (ADR-0012).
- Mail is reached only through Duva's own clients. There is no IMAP, SMTP or JMAP access (ADR-0008).

## Operating Context

- Desktop first. Until the mobile apps exist, the web app must also work well on phones, so a sponsor can approve an agent's reply or screen a sender on the go.
- Humans sign in with a code emailed from the organization's domain. Passkeys come later (ADR-0010).
- Agents with a shell use the CLI and the skill it installs. Cloud agents call the API. Web, CLI and the later mobile apps share one OpenAPI contract, so the web app can do nothing the API can't.
- Clients learn about changes from the change feed: by polling in the first slice, through a stream later.
- Mail arrives in any language. Swedish and English mail side by side is expected.

## Capabilities and Constraints

- Interface copy uses the terms in GLOSSARY.md and never the ones it lists to avoid: thread, never conversation; label, never folder; human, never user; sponsor, never owner, for an agent.
- Mail is organized with labels. Inbox, Spam and Trash are built in, and Trash and Spam are erased after the organization's retention period, 30 days by default.
- The Screener holds mail from first-time senders. It is on by default for humans' personal mailboxes and off for agents' and shared ones.
- Tracking protection is on by default and each actor can turn it off. In the first slice, messages show as plain text, so no remote content loads at all.
- Admins can't read a personal mailbox without its owner's grant. A sponsor has full access to their agent's personal mailboxes.
- Every message an agent sends carries a disclosure header, also after a human approved or edited it, and by default a visible line such as "Sent by Hermes for Nicklas".
- There is no end-to-end encryption (ADR-0011).
- The interface is in English for now. All strings live in one place, so Swedish or Danish can be added later without a rewrite.
- Out of v1: mobile apps, importing old mail, contacts and calendar.
- Not decided: a custom domain for sign-in and the web app (the first slice uses CloudFront's default domain), and the styling approach.

## Brand Commitments

- The name is Duva, Swedish for dove, as in brevduva, the carrier pigeon. The meaning may be used. No logo or visual identity exists yet.
- Interface copy is plain, direct and short. It prefers a period or a comma over a dash, never uses an em dash or a spaced hyphen in its place, skips filler like "Great question", and avoids the "not X but Y" restatement.

## Evidence on Hand

- None yet. There are no customers, testimonials, logos, screenshots or usage numbers, and none may be invented.
- Real material: GLOSSARY.md, the decisions in docs/adr/, and the specs on GitHub (#1 for the first slice, #2 for the search spike).

## Product Principles

1. **One actor per action.** The interface always shows who did what: a human, an agent, or nobody, for mail that simply arrived.
2. **A human signs off before an agent speaks.** Approvals are first-class and quick to act on, and agent-sent mail never hides that an agent wrote it.
3. **Calm by default.** First-time senders wait in the Screener, tracking is blocked, and spam stays out of sight but can still be found.
4. **Plain enough for everyone in the organization.** Nobody needs to understand AWS, DNS, CLIs or agents to read and send mail.
5. **The same powers everywhere.** The web app does only what the API does, so whatever a human can do there, an actor with the same rights can do from the CLI or the API.

## Accessibility & Inclusion

- WCAG 2.2 AA.
- Built for everyday, non-technical members as much as for admins.
- Mail in any language, Swedish and Danish characters included, must read correctly.
