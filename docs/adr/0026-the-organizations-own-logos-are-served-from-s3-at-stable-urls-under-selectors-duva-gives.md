# The organization's own logos are served from S3 at stable URLs, under selectors Duva gives

Admins set each domain's default BIMI logo, and a human may set their own logo for a mailbox they own. Duva converts each upload to SVG Tiny PS: square, by centring the drawing in a square viewBox, with the profile's root attributes and a title, and without what says nothing to whoever sees it, such as metadata, an editor's own elements and attributes, comments and event handlers. It refuses a logo with anything else the profile doesn't allow, such as a picture, CSS in a style element or a reference outside itself, and one over 32 KB as SVG Tiny PS, saying why. A logo that is square SVG Tiny PS already is kept byte for byte, so a mark certificate issued for it, which carries the logo, still matches. The converted logo passes the same check received logos pass (ADR-0023). Nicklas chose this on 2026-10-07 (#117, #119).

The API puts each logo in a bucket of its own, which only the web app's CloudFront distribution reads, through origin access control, and which CloudFront serves under `/bimi/` on the web app's domain: `domains/<domain>.svg` and `selectors/<selector>.svg`, and a mark certificate uploaded as a PEM at `domains/<domain>.pem`. No Lambda serves them, so none needs a permission anyone may use. Each URL stays the same when the logo changes, so its record in DNS does too, and each object asks to be kept 5 minutes, so another logo shows within minutes. CloudFront adds a Content-Security-Policy with `sandbox` and `nosniff`, so an SVG opened on the web app's domain runs nothing.

A mailbox gets a selector with its first logo: the local part of its default address as a DNS label, with `-2`, `-3` and on after it if another mailbox has it, and never `default`. It keeps it when its logo is removed or set again. The sender adds `BIMI-Selector: v=BIMI1; s=<selector>;` to mail the mailbox sends from one of its own addresses, a group's excluded, once DNS has a BIMI record at `<selector>._bimi.<domain>` for the domain it sends from. Agents' mailboxes get no logo of their own, since agents stop owning mailboxes (#126).

## Considered options

- Serving logos from the download Lambda, as received logos are. Rejected: Nicklas's rule that no Lambda be world-invocable leaves S3 behind CloudFront as the simpler origin, and the logos are static.
- A new URL for each logo, as received logos have. Rejected: the admin would change DNS for every new logo.
- Converting pictures such as PNG by tracing them. Rejected: the result would rarely be the brand's mark, and SVG Tiny PS can't hold a picture.

## Consequences

- A mark certificate given by URL is taken as given, since only the logo fetcher reaches others' servers. One uploaded as a PEM is served only if it vouches for the domain, or the domain whose DMARC record covers it, and for the very logo Duva serves. Setting another logo removes the certificate.
- Removing a domain, or deleting a mailbox, stops serving its logo and frees its selector.
- Duva checks the records when asked and never changes DNS. Only some receivers honor a mailbox's own logo; the others show the domain's.
