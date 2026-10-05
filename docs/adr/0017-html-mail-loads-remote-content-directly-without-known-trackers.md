# HTML mail loads remote content directly, without known trackers

Duva shows HTML mail as designed, in a sandboxed frame without scripts or forms. Remote images and fonts load straight from the sender's servers, so newsletters and receipts look as they do elsewhere. Known trackers are removed first, always: the rules of MailTrackerBlocker (BSD-3-Clause, credited), plus hidden and 1×1 images. A note says what was removed. Duva removes them when it serves a message, not in the stored copy, so the list's updates reach old mail too. Nicklas chose this on 2026-10-06, after research into HEY, Gmail, Apple Mail, Proton and Fastmail.

## Considered options

- Blocking remote content until the reader allows it, as Thunderbird does. Rejected: most mail would look broken.
- Fetching every image through a proxy of Duva's own when mail is opened, as HEY and Gmail do. That hides the reader's IP, location and device. Rejected for now as more than v1 needs. It fits the CloudFront and origin-access pattern of the download Lambda, so it can be added later.
- Fetching images when mail arrives, as Apple Mail and Proton do, which also hides when mail is opened. Rejected: it costs storage and slows arrival.

## Consequences

- A sender can still learn when, where and on what device mail was read, through any image whose URL is unique to the reader, and through trackers no list knows. Research shows many are on the sender's own domain (Englehardt et al., PoPETs 2018). The glossary's Tracking protection says only what Duva does.
- Writing HTML mail stays out of scope.
