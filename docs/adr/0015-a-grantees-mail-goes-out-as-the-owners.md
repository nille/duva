# A grantee's mail goes out as the owner's, and disclosure follows the actor who sends

With grants, an actor sends from a mailbox it doesn't own: a human's assistant, the human's own agent, or someone else's agent. Recipients write with the mailbox's owner, so that's who the mail is from: the mailbox's address under the owner's name, whoever sent it. Duva records which actor sent each message, so the owner and everyone who reads the mailbox can see it. A human grantee's mail carries no mark. An agent's mail always carries the Duva-Agent header, naming the agent and the mailbox's owner, whom it acts for. Its sponsor still answers for it inside Duva. The visible line is on by default, and the owner can turn it off per grant, since it's their correspondence. Disclosure follows the actor who asks to send, not whoever wrote the draft: a draft an agent wrote that the owner sends is the owner's mail and is unmarked. Nicklas decided this on 2026-10-05.

## Considered options

- Naming the agent's sponsor in the disclosure, as an agent's own mailbox does. Rejected: recipients don't know the sponsor, and the agent acts for the owner.
- A Sender header naming a human grantee ("on behalf of"). Rejected: it needs the grantee to have an address on the domain, and owners use assistants to write as themselves.
- Marking any draft an agent touched. Rejected: the human who sends takes responsibility for it, and tracking every writer of a draft adds rules for little gain.

## Consequences

- The disclosure's "for" is the owner of the mailbox an agent sends from. For an agent's own mailbox that's still its sponsor, who acts as its owner.
- The header is never optional, so a receiving system can always tell agent mail. Only the visible line can be turned off.
- An owner who turns the line off sends agent-written mail that recipients can't tell from theirs. The choice, and each send, is in Duva's records.
- Approvals for a grantee's sends go to the mailbox's owner, or the sponsor for an agent's mailbox, never to the grantee's sponsor.
