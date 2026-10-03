# Disclosure

Duva marks every message an agent sends, so recipients and their software can tell. This is part of Duva's public behavior.

## The header

Every message an agent sends carries a `Duva-Agent` header, naming the agent and the human it acts for, its sponsor:

```
Duva-Agent: Hermes for n@nille.dev
```

The header is always there, also when the sponsor approved the message or edited it before sending. Software can tell a message came from an agent by the header alone. Its value is free text for people, written as RFC 2047 encoded words when it isn't ASCII.

## The visible line

The text of every message an agent sends ends with a line that says the same, after a blank line:

```
Sent by Hermes for n@nille.dev
```

Humans have no names in Duva yet, so the line names the sponsor by their email address.
