# Classic SES receiving instead of Mail Manager

Inbound mail uses SES receipt rules: the raw message goes to S3, then a Lambda runs per message. Receipt rules refuse unknown addresses before scanning, let user@ match user+tag@, treat a bare domain as the catch-all, and include spam, virus, SPF, DKIM and DMARC verdicts, all for about $0.10 per 1,000 messages. Mail Manager is the newer product, but it costs $50 a month per ingress endpoint before any mail arrives, has no built-in spam or virus verdicts, and handles plus tags only through wildcards.

## Consequences

- The deployment region must support SES receiving (22 regions, eu-north-1 included).
- One active rule set holds at most 200 rules, which caps explicit addresses at roughly 20,000 per organization. Revisit Mail Manager if an organization outgrows that, or needs archiving or relay.
