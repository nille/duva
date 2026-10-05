---
name: Duva
description: Proofs on a dove-grey desk. Mail in a book face on white paper, the interface in the system sans, one blue pencil for actions.
colors:
  desk: "#e3e6e9"
  paper: "#ffffff"
  paper-source: "#f5f6f7"
  ink: "#1b2129"
  ink-2: "#525b66"
  rule: "#d9dde1"
  rule-strong: "#8a929c"
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
- **Pencil Wash** (`pencil-wash`): text selection background.

### Neutral
- **Dove Desk** (`desk`): the page background and scrollbar track. Everything else lies on it.
- **Proof Paper** (`paper`): galleys, slips, the draft column, buttons and fields.
- **Source Paper** (`paper-source`): the original message column and the note that stands in for it, a shade off white so the draft reads as the live sheet. Also the default button hover.
- **Ink** (`ink`): body text and headings. Also the reject button, which is the one dark control.
- **Second Ink** (`ink-2`): field names, meta, hints, subjects beside a title, and the rejected slip icon.
- **Hairline** (`rule`): dividers inside a sheet, and skeleton lines.
- **Strong Rule** (`rule-strong`): button and field borders, and the scrollbar thumb.

### Status
- **Sent Green** (`sent`): the sent slip icon only.
- **Alert Red** (`alert`) on **Alert Wash** (`alert-wash`): failed slips, error notices, and the "can't be reached" connection line.

### Named Rules
**The One Pencil Rule.** Blue means "you can act here" or "this is new". It is never decoration, never a background area, never a heading color.

**The Status Ink Rule.** Green and red speak only about how a send went or whether Duva can be reached. They never style a control.

## Typography

**Mail Font:** Source Serif 4 Variable (with Georgia, serif), self-hosted from `@fontsource-variable/source-serif-4` with its optical size axis (OFL-1.1, noted in THIRD_PARTY_NOTICES.md).
**Interface Font:** the system sans stack (`system-ui`, then platform faces, then Arial).

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

At 48rem and below, the columns stack with the original first and the draft under it, padding drops to 1rem, the signed-in address hides, buttons grow to 2.75rem, and the primary action takes a full row. An original folds at 8 lines.

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
- **Quiet:** no border or fill until hover, which lays a 6% ink tint. Used for Cancel, Reject (the first step) and Sign out.
- **Small:** 2rem tall, for the bar.
- **States:** colors ease over 150ms; pressing nudges the button down 1px; disabled drops to 60% opacity. Focus is the global 2px pencil outline at 2px offset.

### Text Fields
- **Style:** white, 1px Strong Rule border, 4px corners, 0.5rem by 0.75rem padding, inheriting the surrounding font. The edit body switches to the proof serif and resizes vertically.
- **Focus:** the border and a 2px outline both turn pencil, with no offset.
- **Hints:** Label size in Second Ink, under the field.

### Navigation
The bar holds the wordmark, the nav, Write and who is signed in. The nav names only the app's places: Mail, Approvals for sponsors, and Settings for admins and sponsors. The mail's own views are in the side column, so there is one navigation for them. Nav links are ink, sans 600 at Small size, with no underline. The current page carries a 2px pencil underline.

### Side column
The mail's side column lies flat on the desk, 14rem wide, left of the mail, with no sheet. It stays in place as the page scrolls. A sponsor finds their mailboxes at its top, then every human finds the open mailbox's views.

### Mailboxes
A sponsor's mailboxes, at the top of the side column. Their own comes first as "Your mailbox", then the agents they sponsor under an "Agents" label, by name. Each line holds the name at 600, its unread count at the right (in Ink at 650 when there is unread mail), and the address under it in Second Ink at Label size. Hover lays the 6% ink tint, as a quiet button does. The current mailbox lies on Proof Paper with its name underlined 2px in pencil, as the bar's nav marks the current page. A human who sponsors no agents never sees the list. On phones it becomes a wrapping row of mailboxes above the Inbox, without addresses, and steps aside while a thread is read, where the back link names the view it came from.

### Views
The open mailbox's views, in the side column under any mailboxes: Inbox, Sent, Drafts (in the human's own mailbox only, since only its owner writes there), All mail, Spam and Trash, then "Your labels" with the mailbox's own, and a quiet "New label" button that opens a field in place. Each view is a link in ink, sans 600 at Small size, with its unread count in pencil at the right. Only the Inbox and the mailbox's own labels count, so Sent, Drafts, Spam, Trash and All mail never call for attention. The open view lies on Proof Paper, its name underlined 2px in pencil as the bar marks its page. On phones the views become one row above the sheet, scrolled sideways, with a Strong Rule hairline before "Your labels".

### Galley (signature)
One approval as a proof. A slug row on top (who asks, the subject in serif, the time, a "New" pill if it arrived while the page was open), then the sheet with original and draft side by side, then the decision row. Editing marks up the draft column in place. A new galley arrives by sliding down 0.75rem from 40% opacity over 600ms.

### Slip (signature)
A decided approval folded small: an outcome icon, the title and subject, the result, and any detail or note. Pending is pencil, sent is green, rejected is Second Ink, failed turns the whole slip Alert Wash. The galley folds into its slip through a 260ms view transition.

### Index (signature)
The Inbox as one sheet: its threads in rows divided by hairlines, newest first. A row reads as a line of a bundle's index: the pencil's dot when unread, the sender in the sans (with the message count in Second Ink), the subject in the serif followed by the snippet in the serif in Second Ink, and the date. Unread rows set the sender at 650, the subject at 600 and the date in Ink, so the dot is never the only cue. Rows lay a Source Paper tint on hover. Older threads come a page at a time from a default button in the sheet's foot. A thread that arrives while the page is open slides in as a galley does. On phones a row stacks: sender and date, then the subject, then two lines of snippet.

### Organizing
Each row of the index starts with a checkbox, outside the row's link. A toolbar row heads the sheet, under a hairline: a checkbox that picks every thread shown, and once any is picked, how many and the actions, as small default buttons. Picked rows lie on Pencil Wash. The actions follow the view: Archive or Move to Inbox, Mark as spam, Move to Trash and Labels, but Not spam and Move to Trash in Spam, and Restore in Trash. A thread's own view sets the same actions beside Mark unread. Labels opens a slip of paper over the sheet, with the sheet's shadow, listing the human's labels as checkboxes, mixed when only some picked threads have one, and a field to create one and add it. On phones the slip lies along the screen's foot. What was done is said in the desk's voice, at Small size above the sheet, with an Undo link. A thread's own labels show by name: Label size in Second Ink, in a 1px Strong Rule outline with 4px corners, after the subject in a row and under the title in a thread. A label's own view puts Rename and Delete label as quiet buttons beside its name. Renaming swaps the name for a field, and deleting asks once in place, with the one dark button. Trash puts Empty Trash as a quiet button beside its name while it lists threads. It asks once in place, saying the erasure can't be undone, with Erase for good as the one dark button, and has no Undo.

### Letter (signature)
A thread read: its subject as the page title in the serif, the size of Display, and each message a sheet of its own, oldest first, in one column at the proof's measure. A letter's head holds the sender as a Title, their address in Second Ink and the date; header fields follow on the galley's name column, then a hairline and the body in the proof face. A run of more than three quoted lines folds behind a "Show quoted text" link; opened, it sits behind a 1px Strong Rule in Second Ink. Attachments list under a hairline, each with the clip icon, its name at 600 and its type and size, the name and its type wrapping together beside the clip. In a thread each name is a link-styled button that downloads it, and its type gives way to "Downloading…" while Duva gets the link. A message that arrives while the thread is open carries the "New" mark. A message an agent sent says "Sent by" the agent in the head, and a note under the header fields says who approved it and what they changed.

### Composer (signature)
A draft as a live Letter. Its heading ("New message", "Reply" or "Draft") is Duva speaking, so it is a sans Headline, with "Saved at" in Label size and Second Ink beside it. The sheet holds the header fields on a 4.5rem name column (3.5rem on phones): From as text, then To, Cc, Bcc and Subject as text fields, with Cc and Bcc behind an "Add Cc or Bcc" link until they're wanted. The subject field and the text are set in the proof serif, since they become mail. A hairline divides the fields from the text, which grows with what's written. Under the text sit notices, then how the send went, then the decision row: Send, the one primary button, and Delete draft, quiet. A sent message shows the check in Sent Green with a link to its thread, and its fields turn read-only on Source Paper. A refused send is an alert notice with SES's reason, and Send becomes Send again. A forward's heading is "Forward", and the attachments it carries list under the text as a Letter's do, without downloading. Each Letter in a thread ends in Reply, Reply all with more than one recipient, and Forward, small default buttons under a hairline. Write is the bar's one primary button. Drafts list on an Index sheet, with a refused or unclear send named in Alert Red before the subject.

### Settings
Each group of settings is a sheet of its own, at most 44rem wide: its name as a Title and who chooses it in Second Ink, then a hairline and its settings. A setting is a fieldset: its question as a Title, a line in Second Ink on what it decides, then each choice as a 1px Rule box, 4px corners, holding the radio, the choice's name at 600 and what it means as a hint. The chosen box lies on Pencil Wash with a pencil border. Save, the one primary button, stays disabled until the choice differs from what is saved, and "Saved" is said beside it, with when it applies. The organization's settings come first. A sponsor's Agents sheet follows, titled "Your agents", with each agent as a setting of its own under its name at Large size, divided by hairlines: its sponsor access as radios, then its sends as the sponsor and from its own mailbox, each with a box for approval and one for the disclosure line, as checkboxes in the same boxes, and a Save of its own. A choice that withdraws something on saving says so in Ink under the choices. A human who sponsors no agents has no Agents sheet. A human's own preferences join as a sheet of their own.

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
