# Self-hosted, one organization per deployment

Each deployment runs in its organization's own AWS account and serves exactly one organization; nothing is hardcoded to the first one. SES sandbox status, sending limits, reputation and suppression are per AWS account and region, so this matches how SES works and keeps one organization's deliverability problems away from another's. We rejected hosted multi-tenant SaaS for now: SES tenant management could separate reputations, but running it means handling other people's abuse, support and billing. The code is MIT-licensed (ADR-0012).
