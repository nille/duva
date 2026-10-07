# Disclosure

Duva marks every message an agent sends, so recipients and their software can tell. This is part of Duva's public behavior.

## The header

Every message an agent sends carries a `Duva-Agent` header, naming the agent and the human it acts for, its sponsor:

```
Duva-Agent: Hermes for n@nille.dev
```

The header is always there, also when the sponsor approved the message or edited it before sending, and also when the sponsor switched the visible line off. Software can tell a message came from an agent by the header alone. Its value is free text for people, written as RFC 2047 encoded words when it isn't ASCII.

Duva reads the header too, on mail it receives from the organization's own domains with a DMARC pass, which only Duva sends: such a message, as an agent's mail to a colleague, says `fromAgent` in the recipient's mailbox. From anywhere else the header is anyone's to write, so it counts for nothing.

## The visible line

By default, the text of every message an agent sends ends with a line that says the same, after a blank line:

```
Sent by Hermes for n@nille.dev
```

Humans have no names in Duva yet, so the line names the sponsor by their email address.

The sponsor can switch the line off for each agent (`disclosureLineAsSponsor`). It is on by default.

## Sends as the sponsor

Agents own no mailboxes (ADR-0030), so an agent with send sponsor access sends as its sponsor, from the sponsor's personal mailbox. That mail goes out as the sponsor's: from the sponsor's address, the one the original was sent to for a reply, else the mailbox's default address, and under the sponsor's name, which is no name until humans have names. It carries the header, and the line unless `disclosureLineAsSponsor` is off.

Disclosure follows the actor who asks to send. A draft an agent wrote that its sponsor sends is the sponsor's own mail, and carries neither the header nor the line.
