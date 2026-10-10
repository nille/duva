# Coo browses and acts on pages on its own, in an isolated run

Coo uses AgentCore Browser for its work beyond unsubscribing (ADR-0031). It opens any link from mail or from web search (ADR-0037), reads the page, and acts on it on its own, unattended: it clicks, fills and submits forms, and logs in as its human. Nicklas chose this on 2026-10-10, after hearing that acting with an approval for each submit, or only reading, were the safer choices.

The limits that always hold:
- **Payments:** it never pays or enters card details. It stops at a payment step and tells its human.
- **Files:** it never downloads or uploads one. Browser policy turns downloads off.
- **Logins:** only by a code or link mailed to its human's address, which the browsing run fetches. Duva keeps no passwords.

Coo stays logged in between runs, in an AgentCore Browser profile of its human's own, so a site it logged in to once stays open to it. The human can sign Coo out of every site, which clears the profile. The profile is erased with the human.

What keeps a hostile page from reaching the mailbox:
- **A run of its own:** browsing happens in a run with only the page's tools, plus one narrow tool that fetches a login code mailed in the last few minutes from that site's domain.
- **Coo's side:** Coo hands that run a goal and the values it may type, and gets back what it did.
- **The worst case:** a page that tries to steer the browsing run can at most misuse that one site, never read, send or organize mail.

This is ADR-0031's isolation, widened from unsubscribing to all browsing.

Coo says in a sentence what each browsing run did. It keeps no step log, screenshots or recording. Browsing is on by default. Admins can turn it off for the organization, and each human for their own Coo. Its cost, AgentCore Browser at $0.0895 per vCPU-hour and $0.00945 per GB-hour in eu-north-1, counts toward the mailbox agents' spend cap.

## Considered options

- Reading only, or acting with an approval for each submit, as sends wait for theirs. Rejected by Nicklas, who wants Coo to get things done unattended.
- One run with every tool. Rejected: a hostile page could steer a run that reads, drafts and organizes the mailbox.
- Saved passwords. Rejected: Duva would hold a store of secrets to guard. Codes and links mailed to the human, plus a kept session, cover most sites.
- A log of every step, with screenshots, or AgentCore's session recording. Rejected by Nicklas for a sentence of summary, which leaves less to store and erase.
- Keeping Coo from links that tell senders the mail was read. Rejected by Nicklas: Coo opens any link its work needs.

## Consequences

- **ADR-0017's tracking protection still guards the human's own reading.** Coo's browsing may tell a sender their mail was read.
- **Coo may log in and act as its human with no record beyond a sentence.** A human who doesn't want that turns browsing off, and the setting says so plainly.
- **A profile per human:** AgentCore Browser profiles, created on a human's first browsing run, in the deployment's region.
- **Approval is skipped:** a site Coo acts on receives what Coo submits with no approval, unlike mail Coo sends, which still waits for one. The disclosure covers mail only.
