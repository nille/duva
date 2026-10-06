---
name: Duva
description: Proofs on a dove-grey desk. Mail in a book face on white paper, the interface in the system sans, one blue pencil for actions.
colors:
  desk: "#e3e6e9"
  paper: "#ffffff"
  paper-source: "#f5f6f7"
  ink: "#1b2129"
  ink-2: "#525b66"
  ink-deep: "#0b0e12"
  rule: "#d9dde1"
  rule-strong: "#8a929c"
  rule-desk: "#747c86"
  pencil: "#2b4fc0"
  pencil-deep: "#203c96"
  pencil-wash: "#e8edfb"
  sent: "#1e6a43"
  alert: "#b42318"
  alert-wash: "#fdecea"
typography:
  display:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1.625rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  wordmark:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.5
  subject:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  proof:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  small:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 650
    lineHeight: 1.5
  record:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sheet: "2px"
  field: "4px"
  control: "6px"
  pill: "999px"
spacing:
  space-1: "0.25rem"
  space-2: "0.5rem"
  space-3: "0.75rem"
  space-4: "1rem"
  space-5: "1.5rem"
  space-6: "2rem"
  space-7: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.pencil}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 1.5rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.pencil-deep}"
    textColor: "{colors.paper}"
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "2.5rem"
  button-hover:
    backgroundColor: "{colors.paper-source}"
    textColor: "{colors.ink}"
  button-reject:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "2.5rem"
  button-reject-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.paper}"
  button-quiet:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "2.5rem"
  button-small:
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2rem"
  text-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.5rem 0.75rem"
  mark-new:
    backgroundColor: "{colors.pencil}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
  galley:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
  galley-original:
    backgroundColor: "{colors.paper-source}"
    padding: "1.5rem"
  galley-proof:
    backgroundColor: "{colors.paper}"
    padding: "1.5rem"
  slip:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    padding: "1rem 1.5rem"
  slip-failed:
    backgroundColor: "{colors.alert-wash}"
    textColor: "{colors.alert}"
  notice-alert:
    backgroundColor: "{colors.alert-wash}"
    textColor: "{colors.alert}"
    rounded: "{rounded.field}"
    padding: "0.75rem 1rem"
---

# Design System: Duva

## Overview

**Creative North Star: "The Galley Proof"**

Duva's web app is an editor's desk. The desk is dove grey. Each piece of mail lies on it as a white sheet, set in a book face, and everything Duva itself says sits around the sheet in the system sans. There is one color with intent, the editor's blue pencil. It marks what can be done, where focus is, and what is new. The rest is ink on paper.

The first surface, Approvals, sets a galley proof: the agent's draft beside the message it answers, on shared rows, with the decision under it. A decided proof folds into a slip that says how the send went. Density is moderate and calm. Sheets have generous padding (1.5rem), and the text column stops at 68ch.

The system is built in code, with no comps and no rasters. Styling is plain CSS with custom properties in one stylesheet (`packages/web/src/styles.css`), with no component library. PRODUCT.md lists the styling approach as undecided, so this is what the first surface chose, not a settled decision. The app is light only for now (`color-scheme: light`). Every interface string lives in `packages/web/src/strings.ts`.

The tab's icon is Duva's mark: a paper-white envelope, in the icons' round stroke, on a Pencil square with soft corners (`packages/web/public/favicon.svg`). Browsers that ask for `/favicon.ico` get it rendered from that SVG, the one raster that ships, and `index.html` says how.

**Key Characteristics:**
- Dove-grey desk, white sheets, one blue pencil.
- Mail in Source Serif 4, the interface in the system sans.
- Paper lifts off the desk. Controls stay flat.
- Original and draft share rows, so the eye compares line by line.
- Light only. Code-led, no rasters ship.

## Colors

A cool, near-neutral paper palette with a single saturated blue and two status inks.

### Primary
- **Editor's Blue Pencil** (`pencil`): the primary button, links, the "New" mark, focus rings, the text caret, the active nav underline, the "changes made" line and the pending slip icon. Also the native `accent-color`.
- **Pressed Pencil** (`pencil-deep`): hover on the primary button. Nowhere else.
- **Pencil Wash** (`pencil-wash`): text selection background, and under the words a search found.

### Neutral
- **Dove Desk** (`desk`): the page background and scrollbar track. Everything else lies on it.
- **Proof Paper** (`paper`): galleys, slips, the draft column, buttons and fields.
- **Source Paper** (`paper-source`): the original message column and the note that stands in for it, a shade off white so the draft reads as the live sheet. Also the default button hover.
- **Ink** (`ink`): body text and headings. Also the reject button, which is the one dark control.
- **Second Ink** (`ink-2`): field names, meta, hints, subjects beside a title, and the rejected slip icon. Hints keep to 60ch.
- **Deep Ink** (`ink-deep`): hover on the reject button. Nowhere else.
- **Hairline** (`rule`): dividers inside a sheet, and skeleton lines.
- **Strong Rule** (`rule-strong`): button and field borders, and the scrollbar thumb.
- **Desk Rule** (`rule-desk`): the border of a field that lies straight on the desk, as the bar's search field does, which keeps 3:1 against the desk.

### Status
- **Sent Green** (`sent`): the sent slip icon only. A setup change made has its check in Ink.
- **Alert Red** (`alert`) on **Alert Wash** (`alert-wash`): failed slips, error notices, the "can't be reached" connection line, a verified domain's line while mail can't arrive at it, and urgent alerts: their "Urgent" mark, and the Alert Wash an unseen one lies on.

### Named Rules
**The One Pencil Rule.** Blue means "you can act here" or "this is new". It is never decoration, never a background area, never a heading color.

**The Status Ink Rule.** Green and red speak only about how a send went, red also about an approved setup change Duva couldn't make, an alert that wants the sponsor now, a verified domain mail can't arrive at, or whether Duva can be reached. They never style a control.

## Typography

**Mail Font:** Source Serif 4 Variable (with Georgia, serif), self-hosted from `@fontsource-variable/source-serif-4` with its optical size axis (OFL-1.1, noted in THIRD_PARTY_NOTICES.md).
**Interface Font:** the system sans stack (`system-ui`, then platform faces, then Arial).
**Record Font:** the system monospace stack (`ui-monospace`, then platform faces), only for what must be read exactly: DNS record names and values, which an admin copies or types at a DNS provider, and the call an agent admin made, in a setup change's proof.

**Character:** the serif is the written word, so mail reads like a printed proof. The sans is Duva's own voice, plain and close to the platform. Numbers are tabular across the app.

### Hierarchy
- **Display** (serif 500, 1.625rem, 1.25, -0.01em): the title of an empty desk. The sign-in door sets the same face larger (2rem, 1.2).
- **Wordmark** (serif 600, 1.25rem, 1, -0.01em): "Duva" in the bar and at the door.
- **Headline** (sans 650, 1.625rem, 1.2, -0.015em): the page heading, such as "Approvals".
- **Title** (sans 650, 1rem): who asks, at the head of a galley or slip.
- **Subject** (serif 400, 1rem, 1.4, in Second Ink): the mail subject set beside the title.
- **Proof** (serif 400, 1.0625rem, 1.6, max 68ch): message bodies, the disclosure line, and the edit body.
- **Body** (sans 400, 1rem, 1.5): default interface text.
- **Small** (sans 400, 0.875rem): header fields, meta, buttons, notices, changes.
- **Label** (sans 650, 0.8125rem): column labels and the "New" mark. Sentence case, no tracking.

### Named Rules
**The Two Hands Rule.** Text that is or becomes mail is set in the serif: bodies, subjects, the disclosure line, the editable text. What Duva says about the mail is set in the sans. The wordmark and the door and empty titles are the only serif outside the mail.

**The Sentence Case Rule.** Labels stay in sentence case at normal tracking. No uppercase, no letterspaced captions.

## Layout

The desk is centered at an 80rem maximum, padded 1rem top and 1.5rem at the sides, with 3rem at the foot. The bar above it shares the same width. Galleys stack in a single column with 1.5rem between them.

A galley is a two-column grid of equal halves. Each column is a subgrid over six shared rows (label, four header fields, body), so From sits level with From and both texts start on the same line. When there is no original, a narrow note column (at least 12rem) takes one part and the draft three. Header fields use a 4.5rem name column. A long original folds at 12 lines behind a soft fade, with a link to show the whole message.

Spacing is a seven-step scale from 0.25rem to 3rem, used directly. Sheet padding is 1.5rem; the slug and decision rows are 1rem by 1.5rem.

At 48rem and below, the columns stack with the original first and the draft under it, padding drops to 1rem, buttons grow to 2.75rem, and the primary action takes a full row. An original folds at 8 lines. The bar is one row and the places lie in a tab bar along the screen's foot, whose height is `--tab-bar-height` on `:root` (0 on a desk), so anything kept at the screen's foot sits above it.

### Named Rules
**The Shared Rows Rule.** When two versions of a message are compared, they share grid rows. Never let one column's header push the other's text out of line.

## Elevation & Depth

Depth is paper on a desk. Sheets lift; nothing else does. A galley carries the full sheet shadow, a slip a lighter one, since a decided item has been set down. Inside a sheet, depth is tonal: the original sits on Source Paper, the draft on white. Controls, fields and notices are flat.

### Shadow Vocabulary
- **Sheet** (`box-shadow: 0 1px 2px rgb(27 33 41 / 0.08), 0 8px 24px -12px rgb(27 33 41 / 0.22)`): galleys, the live proofs.
- **Slip** (`box-shadow: 0 1px 2px rgb(27 33 41 / 0.08)`): decided approvals.

### Named Rules
**The Paper on Desk Rule.** Only sheets cast a shadow, and the shadow is soft and ink-tinted. A control that needs emphasis gets the pencil, not a shadow.

## Shapes

Corners grow softer as things get smaller and more touchable. Sheets are almost square (2px), fields and notices slightly rounded (4px), buttons a little more (6px). Only the "New" mark is a full pill. Dividers inside a sheet are 1px hairlines. The disclosure line sits under a 1px dashed rule, like a note pencilled under the proof. Icons are inline SVG on a 16 unit grid with a 1.6 round stroke in `currentColor`. Slip icons sit in a 1.4 stroke ring.

## Components

### Buttons
Plain, confident and flat, with the label in the sans at 600.
- **Shape:** gently rounded (6px), 2.5rem tall, 2.75rem on phones.
- **Primary:** pencil fill, white text, wider padding (0 1.5rem). One per decision row: Send, or Send your version.
- **Default:** white with a Strong Rule border, ink text. Hover shifts to Source Paper with a Second Ink border.
- **Reject:** ink fill, white text. Used only to confirm a rejection.
- **Quiet:** no border or fill until hover, which lays a 6% ink tint (`--ink-wash`). Used for Cancel, Reject (the first step) and Sign out.
- **Small:** 2rem tall, for the bar.
- **States:** colors ease over 150ms; pressing nudges the button down 1px; disabled drops to 60% opacity. Focus is the global 2px pencil outline at 2px offset.

### Focus on arriving
Opening a view puts focus on its title, so a screen reader starts there. Only someone who got there by the keyboard sees it, as a 3px pencil bar with round ends just before the title, since a ring would box the page's name; after the mouse or a touch it shows nothing. The web app keeps which input came last on `<html>` as `data-input`. The first Tab reaches "Skip to main content", Proof Paper with the pencil's text, which lies over the bar's start while focused and takes focus to the view's title.

### Text Fields
- **Style:** white, 1px Strong Rule border, 4px corners, 0.5rem by 0.75rem padding, inheriting the surrounding font. The edit body switches to the proof serif and resizes vertically.
- **Focus:** the border and a 2px outline both turn pencil, with no offset.
- **Hints:** Label size in Second Ink, under the field.

### Navigation
The bar holds the wordmark, the nav, the search box, Write and who is signed in. The nav names only the app's places: Mail, Approvals and Alerts for sponsors, and Settings. Approvals counts what waits and Alerts what is unseen, each in pencil after its name. The mail's own views are in the side column, so there is one navigation for them. Nav links are ink, sans 600 at Small size, with no underline. The current page carries a 2px pencil underline. Write writes in the own mailbox open, or the human's first anywhere else.

On phones the bar is one row: the wordmark, then a quiet search icon button and Write, both 2.75rem tall. The same nav becomes a tab bar fixed along the screen's foot, 3.5rem tall plus the safe area, on Proof Paper under a Hairline: each place an equal column with its icon (1.25rem, the round stroke) over its name at Label size, and its count in pencil at the icon's shoulder. The current place carries the 2px pencil line at the tab bar's top edge, as the bar's underline. Who is signed in and Sign out leave the bar; Sign out is in Settings.

### Search
The bar's search box searches the open mailbox, or the human's own outside the mail, and says which: "Search your mail", or an agent's by name. It is a text field 2rem tall with the search icon inside at the left, up to 32rem wide, and `/` puts the cursor in it from anywhere but a field. Beside it, a quiet Filters button opens a slip over the desk, as Labels does, right-aligned under the box: From and To fields with a hint, a Label select, On or after and Before as dates side by side, Has an attachment and Unread as checkboxes, then under a hairline Search, the one primary button, and a quiet Cancel. The slip reads the filters already typed, and writes its own into the box, so typing them works too. Results lie on one Index sheet, a line per thread: the pencil's dot when unread, the sender, then the subject in the serif with its labels, and under it the snippet of the message that matched, two lines at most, with each word found marked in Ink at 600 on Pencil Wash. The head names the words in Second Ink and the sort switch, Best match or Newest, links marked as the bar's nav marks its page. More results come from a default button in the sheet's foot. A search that finds nothing says so as an empty desk does, and words Duva refused, such as an unknown filter, show as an alert notice. Opening a result opens the thread at the message that matched, focused and ringed in pencil for two seconds. On phones the box opens from the bar's search icon onto a row of its own under the bar, 2.75rem tall, with the cursor in it, and stays open while a search's results show. The slip lies along the screen's foot.

### Side column
The mail's side column lies flat on the desk, 14rem wide, left of the mail, with no sheet. It stays in place as the page scrolls. A human with more than one mailbox, or who sponsors an agent, finds the mailboxes at its top, then every human finds the open mailbox's views.

On phones the column folds into one switcher at the desk's head, a quiet full-width button 2.75rem tall: the view open at 650, the mailbox it is in in Second Ink at Small size, the pencil's dot when another mailbox has unread mail, and a chevron at the end that turns when open. It opens the mailboxes and views on a slip of Proof Paper with the slip's shadow, in the same lines as on a desk, each 2.75rem tall, the open ones on Source Paper; nothing scrolls sideways. Choosing one closes it, and so does Escape, which returns focus to the switcher. While a thread or a draft is read the switcher steps aside, and the back link names the view it came from.

### Mailboxes
The mailboxes a human reads, at the top of the side column. Their own come first: one is "Your mailbox" with its address under it, and several lie under a "Your mailboxes" label, each by its default address, or as "Mailbox 2, without an address". The one at the address they sign in with comes first, then by address, and the first one's Inbox is the web app's start. The agents they sponsor follow under an "Agents" label, by name. Each line holds the name at 600, its unread count at the right (in Ink at 650 when there is unread mail), and the address under it in Second Ink at Label size. Hover lays the 6% ink tint, as a quiet button does. The current mailbox lies on Proof Paper with its name underlined 2px in pencil, as the bar's nav marks the current page. A human with one mailbox who sponsors no agents never sees the list. Each own mailbox has its own unread counts, Screener, labels, Drafts and Write, and a thread, a draft or Drafts reached by a link that names no mailbox opens in the own mailbox the human was last in.

### Views
The open mailbox's views, in the side column under any mailboxes: Inbox, the Screener while it is on or something waits there, Sent, Drafts (in the human's own mailboxes only, since only their owner writes there), All mail, Spam and Trash, then "Your labels" with the mailbox's own, and a quiet "New label" button that opens a field in place. Each view is a link in ink, sans 600 at Small size, with its unread count in pencil at the right. Only the Inbox and the mailbox's own labels count, so Sent, Drafts, Spam, Trash and All mail never call for attention. The Screener counts the senders who wait, in Second Ink, since they ask for nothing, and the tab's title never counts them. An agent's mailbox lists Activity after Trash, which opens the agent's activity. The open view lies on Proof Paper, its name underlined 2px in pencil as the bar marks its page. On phones the views are in the switcher's slip.

### Galley (signature)
One approval as a proof. A slug row on top (who asks, the subject in serif, the time, a "New" pill if it arrived while the page was open), then the sheet with original and draft side by side, then the decision row. Editing marks up the draft column in place. A new galley arrives by sliding down 0.75rem from 40% opacity over 600ms.

### Slip (signature)
A decided approval folded small: an outcome icon, the title, the agent by name in the sans and the subject in the serif, the result, and any detail or note. Pending is pencil, sent is green, a setup change made is the check in Ink, rejected is Second Ink, failed turns the whole slip Alert Wash, as when Duva couldn't make an approved setup change. The galley folds into its slip through a 260ms view transition.

### Setup proof
A setup change an agent admin asks for waits in Approvals under the sends, which come first since mail is what waits on a human, newest first, as a galley of its own: the slug says "asks to change the setup" and then the preview's first sentence in the sans, where a send has its subject, with the time and any "New" mark, then two columns, 2 parts to 3. On Source Paper, "The call it made": its Command, the `duva` command that makes the change, such as `duva addresses add`, and each field on a 6.5rem name column, sorted by name, the values in the record font at Label size, since they are exact. An ID Duva knows shows as what it names, a person's address, an agent's name or a mailbox as "Hermes's mailbox, hermes@example.com", in the sans with the ID under it in the record font in Second Ink as a hint. A list shows one value per line. On white, "What it would do": Duva's preview, one sentence per bullet in the sans, as Duva says it, with a hint that approving makes the change as the agent. The decision row holds Approve, the one primary button, and a quiet Reject that opens the note, as a send's does. When the setup changed since the agent asked, approving shows the new preview with an alert notice saying to read it again. On phones the columns stack, the call first.

### Held sends
Under the proofs, Approvals keeps what was approved but hasn't gone, read from Duva, so it stays after a reload until the send goes out. "Waiting for the send limit" lists every agent's sends that wait for a limit, oldest first, and "Held while Hermes is paused" each paused agent's approved sends, with "Open Hermes at Pause", a link to the agent's line in Settings opened at Pause. Each is a part with its name as a Title, a lead in Second Ink, and its sends on one Proof Paper box lying on the desk as a slip does, divided by hairlines: the agent at 600 where several can wait, the subject in the serif, "To" its recipients in Second Ink, and for the limit a small Send now. A send whose slip is on the page shows there instead. Every repeated control is named for what it acts on, "Send now" and the subject, so a screen reader tells them apart.

### Index (signature)
The Inbox as one sheet: its threads in rows divided by hairlines, newest first. A row reads as a line of a bundle's index: the pencil's dot when unread, the sender in the sans (with the message count in Second Ink), the subject in the serif followed by the snippet in the serif in Second Ink, and the date. Unread rows set the sender at 650, the subject at 600 and the date in Ink, so the dot is never the only cue. Mail that came through a group carries the group's address after the subject, in the labels' outline with two people drawn before it. Rows lay a Source Paper tint on hover. Older threads come a page at a time from a default button in the sheet's foot. A thread that arrives while the page is open slides in as a galley does. On phones a row stacks: sender and date, then the subject, then two lines of snippet.

### Organizing
Each row of the index starts with a checkbox, outside the row's link. A toolbar row heads the sheet, under a hairline: a checkbox that picks every thread shown, and once any is picked, how many and the actions, as small default buttons. Picked rows lie on Pencil Wash. The actions follow the view: Archive or Move to Inbox, Mark as spam, Move to Trash and Labels, but Not spam and Move to Trash in Spam, and Restore in Trash. A thread's own view sets the same actions beside Mark unread. Labels opens a slip of paper over the sheet, with the sheet's shadow, listing the human's labels as checkboxes, mixed when only some picked threads have one, and a field to create one and add it. On phones the slip lies along the screen's foot. What was done is said in the desk's voice, at Small size above the sheet, with an Undo link. A thread's own labels show by name: Label size in Second Ink, in a 1px Strong Rule outline with 4px corners, after the subject in a row and under the title in a thread. A label's own view puts Rename and Delete label as quiet buttons beside its name. Renaming swaps the name for a field, and deleting asks once in place, with the one dark button. Trash puts Empty Trash as a quiet button beside its name while it lists threads. It asks once in place, saying the erasure can't be undone, with Erase for good as the one dark button, and has no Undo.

### Screener
The open mailbox's first-time senders, on one sheet as the Index is, newest first, each divided by a hairline: the sender's name as a Title and their address in Second Ink, then their mail as lines of the index, the subject in the serif followed by the snippet in Second Ink and the date, each opening the thread. Under them sit Let in and Block, small default buttons. Either asks once in place, saying what it will do, with "This address" and, unless the domain is a public mail provider's, "Everyone at" the domain, beside a quiet Cancel. What was decided is said in the desk's voice above the sheet, with how the unsubscribe went after a block. A line under the title says what the Screener is, and whether it is off with a link to Settings, then links to Screened senders with how many are let in and blocked. Screened senders is one sheet at most 44rem wide: a field to find a sender, then Blocked and Let in, each decision a row with the address, or "Everyone at" the domain, at 600, when and by whom in Second Ink, and Let in or Block to flip it with a quiet Remove. Removing a block asks once in place, saying the threads still in Trash come back. On phones a waiting thread's snippet takes a line of its own.

### Letter (signature)
A thread read: its subject as the page title in the serif, the size of Display, and each message a sheet of its own, oldest first, in one column at the proof's measure. A letter's head holds the sender as a Title, their address in Second Ink and the date; header fields follow on the galley's name column, then a hairline and the body in the proof face. A run of more than three quoted lines folds behind a "Show quoted text" link; opened, it sits behind a 1px Strong Rule in Second Ink. HTML mail shows as designed (ADR-0017), in a borderless frame on white paper that keeps the mail's own colors and fonts, as tall as the mail, so only the page scrolls. Mail laid out wider than the sheet, as newsletters are on a phone, shrinks to fit it. Mail without styles of its own is set in Georgia. A quote cited at the mail's end folds behind the same link, under the frame. Under the body, a quiet line in Second Ink at Small size says which trackers were removed, such as "Removed a tracker from SendGrid.", beside a link to show the message as plain text, or as designed again. The human's preference chooses which shows first. Attachments list under a hairline, each with the clip icon, its name at 600 and its type and size, the name and its type wrapping together beside the clip. In a thread each name is a link-styled button that downloads it, and its type gives way to "Downloading…" while Duva gets the link. A message that arrives while the thread is open carries the "New" mark. A message an agent sent says "Sent by" the agent in the head, and a note under the header fields says who approved it and what they changed. A message sent as a group says so in the head, "You sent this as" the group, and another member's copy names who sent it, "Sent by" them "as" the group. Mail that came through a group says so in a note under the header fields.

### Composer (signature)
A draft as a live Letter. Its heading ("New message", "Reply" or "Draft") is Duva speaking, so it is a sans Headline, with "Saved at" in Label size and Second Ink beside it. The sheet holds the header fields on a 4.5rem name column (3.5rem on phones): From as text, or as a select when there is a choice, the mailbox's addresses and then under "As a group" the groups its owner is a member of, with a hint under it while a group is chosen saying the other members get a copy; then To, Cc, Bcc and Subject as text fields, with Cc and Bcc behind an "Add Cc or Bcc" link until they're wanted. The subject field and the text are set in the proof serif, since they become mail. A hairline divides the fields from the text, which grows with what's written. Under the text sit notices, then how the send went, then the decision row: Send, the one primary button, and Delete draft, quiet. A sent message shows the check in Sent Green with a link to its thread, and its fields turn read-only on Source Paper, From's select too, with a Hairline border and no arrow. A refused send is an alert notice with SES's reason, and Send becomes Send again. A forward's heading is "Forward", and the attachments it carries list under the text as a Letter's do, without downloading. Each Letter in a thread ends in Reply, Reply all with more than one recipient, and Forward, small default buttons under a hairline. Write is the bar's one primary button. Drafts list on an Index sheet, with a refused or unclear send named in Alert Red before the subject.

### Settings
Settings is a page per sheet, with an index of them in a side column 14rem wide, flat on the desk as the mail's views are, under "Settings" as the Headline. The index reads You, Screener while the human has a mailbox, Your agents for a sponsor, with each agent as a sub-entry set in under it, and Organization for admins, then under a "For admins" label at Label size in Second Ink, Domains, Addresses, People and Groups. Each entry is a link in Ink, sans 600 at Small size, with its state under it in Second Ink at Label size where it helps: an agent's "Paused" and how many of its sends wait, "2 waiting", and on Domains the domain with records missing, "example.com, 2 records missing". Hover lays the 6% ink tint; the open page lies on Proof Paper with its name underlined 2px in pencil. Each page has its own address under `#/settings/`, and an agent's sub-entry opens the Your agents page with its line open, as an alert's "Open" does. Opening a page from the index takes the focus to its sheet's title. Settings opens on You, so a member never lands on a sheet they can't change, and a page a human can't open, such as Organization for a member, opens You too. On phones the index is the page Settings opens on, with rows 2.75rem tall and none marked open, and each sheet's page has a back link to it over the sheet, as a thread's has.

Each sheet is at most 44rem wide: its name as a Title and who chooses it in Second Ink, at most 60ch, then a hairline and its settings. A setting is a fieldset: its question as a Title, a line in Second Ink on what it decides, then each choice as a 1px Rule box, 4px corners, holding the radio, the choice's name at 600 and what it means as a hint, at most 60ch. The chosen box lies on Pencil Wash with a pencil border; a chosen box that can't be changed lies on Source Paper with a Strong Rule border, so it never looks live. Choices whose names and examples are short, such as how times and dates show, sit side by side in a row that wraps, each with an example built from today as its hint, and the boxes in a row start level whatever their height. Choices that need a sentence, such as how mail shows, stack. Save, the one primary button, stays disabled until a choice differs from what is saved, and "Saved" is said beside it, with when it applies. Each sheet has its own Save. The You page holds the human's own preferences, then on the desk under the sheet, in the desk's voice at Small size in Second Ink, who is signed in with a quiet Sign out, and for a member the one organization setting that touches their mail, as a sentence: "Trash and Spam keep mail 30 days. Admins choose this for everyone." Members see nothing else of the organization's settings, so no languages, caps or AWS. The Screener sheet's lead says once what On and Off mean, then each mailbox, the human's own first and then each of their agents', is one line divided by hairlines: the owner at 600 and the address under it in Second Ink at Label size, and at the right On and Off as one small switch, two segments in a 1px Strong Rule outline, the chosen one on Pencil Wash in Pressed Pencil, 2.75rem tall on phones. Switching a mailbox off says in Ink in its row that waiting mail moves to the Inbox on saving. The Your agents page holds a sponsor's Agents sheet, titled "Your agents", with each agent as one line, divided by hairlines: its name at 650, and under it in Second Ink at Small size its access and whether its sends wait for your approval, and for an agent admin whether its setup changes do, with a chevron at the end. The sheet speaks to the sponsor: "Access to your mailbox", "When it sends as you", "Your approval before it sends as you". Clicking the line opens the agent's settings under it, under a link to the agent's activity at Small size and 600, and closes any other agent's, and the chevron turns. A line hovered lies on Source Paper. The settings are its sponsor access as radios, then its sends as the sponsor and from its own mailbox, each with a box for approval and one for the disclosure line, as checkboxes in the same boxes, and for an agent admin, When it changes the setup, with a box for your approval before it does, and a Save of its own. On an agent's line a checked box keeps its paper and border, since Pencil Wash marks the one choice of a set of radios, and a ticked box on wash would read as chosen over the others. A choice that withdraws something on saving says so in Ink under the choices. A paused agent's line carries a "Paused" mark after its name, in the labels' outline in Ink with the pause drawn before it, and an agent admin's an "Admin" mark in the same outline with a key drawn before it, and a line in Ink under the name saying who paused it and since when, and why if Duva did. A line also counts its sends that wait for its send limits. Opened, parts with their names as Titles come before its settings, as a domain's do, each named for what it holds and never for its button: Running or paused, saying what pausing does or what being paused means beside a small default Pause or Unpause button; Admin, saying what an agent admin may do, or what taking it away withdraws, beside a small default Make it an admin or Take admin away, or for a sponsor who isn't an admin, in place of the button, that only an admin makes an agent one; and, while any wait, Waiting for the send limit, its sends in one 1px Rule box divided by hairlines, oldest first, each with its subject in the serif, its recipients in Second Ink and a small Send now, which says "Sent." in Sent Green once Duva takes it. While the agent is paused, the part's lead says "Held until you unpause" the agent, and each Send now is disabled, described by that lead, since a pause holds what Send now would send. Pausing, unpausing, Send now and a saved send limit read the waiting sends again, and the index's sub-entry with them, without a reload. Opening an agent's line from the index or an alert takes the focus to its line, and the page alone to the sheet's title. A hairline divides the parts from the settings. Its send limits close the settings: Sends an hour and New recipients a day, side by side, each a short right-aligned field of a whole number with its name at 600 over it and the organization's cap as a hint under it. A send waiting for the limit says so in the composer and on the decided slip in Approvals too, with Send now under it. A human who sponsors no agents has no Agents sheet.

Admins get the pages under "For admins", which no one else sees. Domains lists each domain as an Agents sheet line does: the domain at 650, and under it in Second Ink its kind, "Verified", "Verified for sending" or "Waiting for DNS", how many of its records DNS lacks, and whether sign-in codes come from it or it has a catch-all. While its receiving record is missing, the line says mail can't arrive yet. Waiting for DNS is where every domain starts, so that line stays in Second Ink, but once SES has verified the domain, which never verifies receiving, it turns Alert Red at 500. Opened, it holds parts, each with its name as a Title: DNS records, Sign-in codes and Catch-all, then Remove domain as a quiet button under a hairline. The records lie in one 1px Rule box, divided by hairlines, each with its purpose at 650 and type in Second Ink, its status at the right in Label size (Missing in Second Ink, Found and Verified in Ink, Verified with the check), then Name and Value on a 4.5rem name column, each set in the record font on Source Paper with a small Copy button that says "Copied" for two seconds. The Copy buttons are one stop in the Tab order, the last one focused, and the arrow keys, Home and End move between them, with a hint under the box saying so while one has the keyboard's focus. A record DNS answers otherwise says what it has, as a hint. Check again, a small default button, looks them up again. The catch-all is a select with Save, the one primary button. Removing asks once in place, listing the domains, the addresses that stop and the mailboxes left without one, with Remove as the one dark button. Add a domain closes the sheet under a hairline: a Domain field, Standalone and Alias as short choices, a Mirrors select for an alias, and Add domain. Addresses lists each mailbox as a line, humans' by address then agents' by name: its default address at 650, or "Mailbox 2, without an address", so two of one owner never look the same, and under it in Second Ink its owner, which of theirs it is when they have several, and how many more addresses it has, or that it gets no mail until it has one. Opened, a lead says what the default address does, then each address is a row divided by hairlines, at 600, with a Default mark in the labels' outline or a small Make default button, and a quiet Remove that asks once in place, naming the groups the address leaves. A New address field with Add address follows. Add a mailbox closes the sheet as Add a domain does: For, a select of every human by address and then every agent by name with its sponsor, an Address field with the domains as its hint, and Add mailbox. The new mailbox's line opens, saying what was done. People and Groups follow, as lines too. A human's line holds their address at 650, and under it whether it is you and an admin, and how many mailboxes and agents they have. Opened, it holds Admin, with Make admin or Take admin away as a small default button, or for the only admin a line in Ink saying why it stays; Mailboxes, each by its default address, or as "Mailbox 2, without an address", so two of one owner never look the same, or "No mailbox yet." beside Give them a mailbox, a small default button; Agents, each a row with its name at 600, its addresses in Second Ink, Give it a mailbox while it has none, and a quiet Remove that asks once in place; then Remove human as a quiet button under a hairline. Giving a mailbox brings Add a mailbox into view with the owner chosen and the cursor in Address. A quiet button that closes a line, as Remove human, Remove domain and Delete group do, sets its text level with the parts above it. It asks once in place, from a dry run: each mailbox by its name with Hand over and Delete as short choices, Hand over to as a select while any is handed over, what is erased and which agents go with them in Ink, and the one dark button naming the human. Add a human closes the sheet as Add a domain does. A group's line holds its address at 650, and under it how many members it has and who can send to it. Opened, its members are rows as an agent's are, each with what it is in Second Ink (a mailbox's by its owner, a group, or an external address) and a quiet Remove that acts at once, since adding the member back undoes it, then a New member field with Add member, Who can send to it and Where external members' replies go as stacked choices with a Save of their own, and Delete group, a quiet button that asks once in place. Add a group closes the sheet with Address and Members fields. Every form that adds something is named "Add a" what it adds, and hints on the admin sheets keep to 60ch, as leads do. On every admin sheet, what a change did is said at Small size in the row it was about, or in place of the row or line it removed, never far from it. The Organization page, for admins only, holds two sheets, each with its own Save. Mail holds the retention, a short field of days, right-aligned, with "days" after it, where a shorter period than the saved one says in Ink under it how many threads saving erases, then the languages search knows as short checkboxes, with a note in Ink under them that saving rebuilds the indexes while a language that rebuilds them differs from what is saved. Agents holds whether erasing a thread erases its approval records, then the agents' send limits, as the caps on the fields an agent's line has, where a lower cap than the saved one says in Ink that saving lowers the agents above it. On phones the record's Name and Value stack over it, an address or a name takes its own line with its buttons together under it, and buttons grow to 2.75rem.

### Alerts
What a sponsor's agents need them for, on one Index sheet, newest first, each alert a row divided by hairlines: the pencil's dot while unseen, the agent's name in the sans, at 650 while unseen and 600 once seen, then what happened in Second Ink at Small size, and for an urgent one an "Urgent" mark in the labels' shape, Alert Red on a 1px Alert Red outline. Under it the alert's sentence at Small size, in Ink while unseen and Second Ink once seen, at most 68ch, then a link to what it is about, "Open the message", "Open the draft" or "Open" the agent, whose line in Settings comes open, and Mark as seen, a quiet small button. An alert that an agent was paused links to "See the held sends" in Approvals while it is paused, and to "Open Hermes at Pause". Each link and Mark as seen is named with the agent, what happened and the alert's sentence, so the screen reader tells one row's from another's. The date sits at the right, in Ink at 600 while unseen. An unseen urgent alert lies on Alert Wash, so it stands out until it is seen. Opening an alert's link marks it seen. The head counts the unseen in Second Ink beside the title, with Mark all as seen as a quiet small button at its right. More alerts come a page at a time from a default button in the sheet's foot. No alerts says so as an empty desk does. On phones the date takes a line of its own under the head.

### Activity
An agent's activity, for its sponsor, lies in the mail beside its mailbox's views, or alone when it has no mailbox. Its heading names it, "Hermes's activity", over a line in Second Ink at Small size saying the days run in which time zone. The days lie on one Index sheet, newest first, the last 30, each a line of the index, divided by hairlines, that links to its timeline and reads as a sentence, never as columns: its weekday and date at 600, then what was counted in Second Ink at Small size, "2 sent, 3 received, 1 alert", each number in Ink at 650. A day with nothing counted says "Nothing counted" and sets its date in Second Ink at 400. Two or more such days in a row fold into one line, "Sep 7 to Oct 5" with "Nothing counted" and a chevron, a button that opens their days under it, indented under a hairline, and turns its chevron. A day's timeline puts the activity's name as a back link over the day as the heading, then one sheet of entries, newest first, divided by hairlines: the time in Second Ink, tabular, in the activity's time zone, then one line, at most 88ch, that begins with who did it at 650, the agent by name, a sender, "You", "Duva" or "Amazon SES", says what happened in Duva's voice, and ends with the thread it is about, its subject in the serif as a link set straight after the sentence, cut short with an ellipsis. Each subject link's label names its entry, "Möte. 08:00 AM: Grace Hopper wrote to hermes@example.com.", so a thread linked twice is never two links of one name. Older entries come from a default button in the sheet's foot. On phones a day's counts take a line under its date, and an entry's thread takes a line of its own under what happened.

### Notices
Alert notices are Alert Wash with Alert Red text at weight 500, 4px corners, Small size. The connection line in the desk head is Label size in Second Ink, turning Alert Red and bold when Duva can't be reached.

### Loading
A skeleton galley of Hairline bars with 2px corners that breathe to 45% opacity over 1.6s.

## Do's and Don'ts

### Do:
- **Do** take every color, size and space from the custom properties in `styles.css`.
- **Do** set mail text in Source Serif 4 at the proof size (1.0625rem, 1.6) and keep it under 68ch.
- **Do** keep the pencil for actions, focus, links and new marks, and keep one primary button per decision.
- **Do** put new interface strings in `strings.ts`, in plain, short sentences with no em dash.
- **Do** honor reduced motion: every animation and transition is turned off under `prefers-reduced-motion`.
- **Do** draw icons as inline SVG strokes in `currentColor`.

### Don't:
- **Don't** add a second accent color or use the pencil as a fill for areas, headings or decoration.
- **Don't** give controls, fields or notices a shadow; only sheets lift off the desk.
- **Don't** set Duva's own interface text in the serif, or mail in the sans.
- **Don't** use uppercase or letterspaced labels.
- **Don't** add a dark scheme piecemeal. The app is light only until a dark palette is designed as a whole.
- **Don't** ship comps or rasters for interface elements; the build is code-led.
