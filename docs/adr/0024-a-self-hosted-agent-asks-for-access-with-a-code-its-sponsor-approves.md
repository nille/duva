# A self-hosted agent asks for access with a code, and the human who approves it becomes its sponsor

An agent that runs outside Duva used to need its sponsor to create it and copy its key to where it runs. Now it asks for access itself, as OAuth's device authorization grant (RFC 8628) does: `duva login --agent` asks Duva without sign-in for a short code, shows it with a link to the web app, and waits. The human who opens the link signs in (ADR-0010), sees the agent's name, where it asked from, the mailboxes and access it asks for, adjusts them, and approves or declines. Approving creates the agent as an actor (ADR-0001) with that human as its sponsor and that sponsor access (ADR-0015), and the agent then collects its key once, a key as ADR-0013 describes, which the CLI keeps as it keeps a human's session. Nicklas chose device authorization as the way in for self-hosted agents on 2026-10-07 (#120, #125).

Sponsor access grows from None, Read and Full to None, Read, Organize, Draft and Send, each all the one before it gives and more, and it covers the sponsor's mailboxes the sponsor chooses, all of them unless they choose. Full is Send. The approval and disclosure-line switches for its sends as the sponsor stay as they were, so a send level is on the sponsor's behalf with the line, or as them without it. That is what an agent asks for and what its sponsor approves, so asking can be specific, and #122's mailbox agents build on the same levels.

## Considered options

- Keep agents created by their sponsor, with the key copied by hand. Kept for agents created that way, but a key pasted into a chat or a file is the easiest to leak, and the human never sees where it runs.
- Cognito's own device flow, or an agent as an app client. Rejected, as ADR-0013 rejected Cognito for agents: tokens that expire, and agents in the human sign-in.
- A typed code instead of a link. The link carries the code, and the page shows it again so the human checks it against the one the agent shows. Typing it adds a step and no safety.

## Consequences

- Asking and collecting need no sign-in, so codes are guarded instead: a code works 10 minutes and once, an address asks for at most 10 in 10 minutes, and a human who gives 10 codes no request waits with in 10 minutes is refused every code until those 10 minutes are over. A code is 8 letters from 20, about 2.6 × 10^10, and collecting also needs the device code's 256 random bits, which only the agent has.
- The usual attack on device codes is phishing: someone sends a human a link to approve an agent they didn't start. The page says where the request came from, its IP address and the computer name the agent gave, and asks the human to approve only an agent they started.
- An approved agent has no key until it collects one, so Duva never stores a key it hasn't shown. It collects it once, up to an hour after its code expired. Its sponsor can rotate or remove it meanwhile, and then the request gives no key.
- The CLI keeps one actor signed in, so on a computer where a human was signed in, `duva login --agent` signs them out, and says so.
- Stored sponsor access of Full reads as Send, and an agent whose sponsor never chose mailboxes keeps access to all of theirs.

Since ADR-0030 (2026-10-07) agents own no mailboxes, so an agent's sends are always as its sponsor, and only the switches for those remain.
