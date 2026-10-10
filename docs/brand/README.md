# Coo

Coo is the mailbox agent's name and drawing (#130): a duva, Swedish for dove, as in brevduva, the carrier pigeon. The web app draws it in `packages/web/src/coo.tsx`; these files are the same drawings for use outside it.

- `coo.svg`: Coo in full, for 48 px and up: a pigeon's portrait in one .75 line with round ends on a 32 unit grid, open at the bottom. Its head and neck, the shoulder of its wing, a ring eye, the bill and its gape line, and a highlight on the crown, in `currentColor`.
- `coo-mark.svg`: the same portrait for 16 to 24 px, in a 1.6 line, without the gape line. The favicon: `packages/web/public/favicon.svg` is this drawing in ink, Reader Grey when the browser is dark, and `favicon.ico` its 16 and 32 px rasters, made from that file by the command in the comment in `packages/web/index.html`.
- `coo-logo.svg`: Coo's 16 to 24 px line in ink on the side column's grey, square, in SVG Tiny PS, as an organization's BIMI logo until it has one of its own. It is centred so a round crop keeps all of it. Set it as the domain's logo in Settings, or with `duva domains set-logo`.
