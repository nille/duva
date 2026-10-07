---
name: Duva
description: Field Desk. The mail on one plane, like a precise instrument, in three aluminium greys, mono text with ligatures, grotesk headings, and color only as a function code.
colors:
  side: "#e6e6e2"
  list: "#efefec"
  read: "#f8f8f6"
  raise: "#ffffff"
  ink: "#161616"
  ink-2: "#56564f"
  ink-3: "#66665f"
  ink-deep: "#000000"
  seam: "#dededa"
  field: "#e2e2dd"
  field-deep: "#d4d4ce"
  edge: "#84847c"
  call: "#ff5a1f"
  call-deep: "#e5470d"
  call-ink: "#b93a0b"
  call-wash: "#fff0e9"
  agent: "#2e62ff"
  agent-ink: "#1f4fe0"
  agent-wash: "#ecf1ff"
  sent: "#12a150"
  sent-ink: "#0c7438"
  sent-wash: "#e8f6ee"
  alert: "#e5243b"
  alert-ink: "#c41a2f"
  alert-wash: "#fdecee"
typography:
  display:
    fontFamily: "Familjen Grotesk Variable, system-ui, sans-serif"
    fontSize: "2.375rem"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Familjen Grotesk Variable, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  wordmark:
    fontFamily: "Familjen Grotesk Variable, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  body:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.84375rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "calt, liga, tnum"
  proof:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.78125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1
  key:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.65625rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  key: "4px"
  row: "6px"
  field: "7px"
  sheet: "10px"
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
  button:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.25rem"
  button-hover:
    backgroundColor: "{colors.field-deep}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.raise}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.raise}"
  button-call:
    backgroundColor: "{colors.call}"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.25rem"
  button-call-hover:
    backgroundColor: "{colors.call-deep}"
    textColor: "{colors.ink}"
  button-quiet:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.25rem"
  button-small:
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 0.75rem"
    height: "1.875rem"
  text-field:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.5rem 0.75rem"
  chip:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 0.75rem"
    height: "1.75rem"
  chip-chosen:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.raise}"
  key-cap:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink-2}"
    typography: "{typography.key}"
    rounded: "{rounded.key}"
    padding: "0.18rem 0.32rem"
  nav-count:
    backgroundColor: "{colors.call}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.12rem 0.4rem"
  place-current:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "0.36rem 0.5rem"
  list-row:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    padding: "0.72rem 1.4rem 0.78rem 0.7rem"
  list-row-open:
    backgroundColor: "{colors.read}"
    textColor: "{colors.ink}"
  checkbox:
    backgroundColor: "{colors.raise}"
    rounded: "{rounded.key}"
    size: "0.875rem"
  checkbox-checked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.raise}"
  shortcut-sheet:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "1.5rem 2rem"
  status-strip:
    backgroundColor: "{colors.side}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    height: "2.125rem"
---

# Design System: Duva

## Overview

**Creative North Star: "The Field Desk"**

Duva's web app is one precise instrument, laid flat. The side column, the list and the open thread lie side by side on a single plane, in three tones of aluminium grey that step lighter toward what is being read. Nothing is boxed: columns and rows part by tone, by a seam one shade off the grey, and by space. The direction was chosen in impeccable's direction round, seed 6c0f3a48, the North Window Desk re-rolled to Field Desk on Nicklas's steer, and `packages/web/index.html` carries its contract as the body's first comment, which the build keeps.

The voice is Teenage Engineering's: exact, a little playful, and sparing with color. Color never decorates. It is a function code, and each of the four hues says one thing: orange needs you, blue marks an agent, green is sent or healthy, red is an alert. All text, mail included, is set in JetBrains Mono with its ligatures on; the headings are Familjen Grotesk, tight and printed-looking. Shortcuts show as key caps, and who did something shows as a shape before their name.

The system is code-led: plain CSS with custom properties in one stylesheet (`packages/web/src/styles.css`), no component library, light only (`color-scheme: light`). Every string lives in `packages/web/src/strings.ts`. This file records the foundation, the tokens, the type, the shell and the shared controls. The areas (the thread and composer, the lists and the Screener, Approvals and Alerts, Settings and the admin sheets) are restyled in their own tickets, and until then they reach the new tokens through the old names, aliased in `:root`.

**Key Characteristics:**
- One plane in three aluminium greys, no boxed sections.
- Mono text with ligatures, grotesk headings.
- Four function colors, each with one meaning, and never more.
- Key caps for shortcuts, shapes for actors.
- The full width on a desk, one column on a phone.

## Colors

Three near-neutral greys with a faint warm cast, one ink, and four saturated signals that each own one meaning.

### Primary
- **Call Orange** (`call`): what needs the human. The Approvals count's badge and its row's wash, the orange edge on the open line of a list, the unread dot, the `call` button for a decision, the caret, and the keyboard's bar before a focused title. As text, in its deeper hand (`call-ink`), it is the unread counts in the side column. The wash (`call-wash`) lies under the Approvals place while something waits, and under selected text.

### Secondary
- **Agent Blue** (`agent`): an agent. Its diamond, and later its draft and its kind of request. As text, `agent-ink`; under what it marks, `agent-wash`.

### Tertiary
- **Sent Green** (`sent`): sent or healthy. The status strip's light while Duva is up to date. As text, `sent-ink`, as a send's slip says it went.
- **Alert Red** (`alert`): an alert. The strip's light and line when Duva can't be reached, the unseen alerts' count (`alert-ink`), error notices on `alert-wash`, and failed sends.

### Neutral
- **Side Grey** (`side`): the side column, the status strip and the phone's tab bar, the device's edge.
- **List Grey** (`list`): the list column.
- **Reader Grey** (`read`): the reading pane, views that take the whole plane, and a phone's page.
- **Raised White** (`raise`): what lies raised on the plane: the view or place open in the side column, fields, key caps, and sheets laid over the page.
- **Ink** (`ink`): text, the primary button, the chosen chip, focus rings. **Deep Ink** (`ink-deep`) is the primary button's hover.
- **Second Ink** (`ink-2`) and **Third Ink** (`ink-3`): what is said about the mail, meta, hints, group names and quiet counts. Both keep 4.5:1 on every grey.
- **Seam** (`seam`): hairlines between rows and along the strip, and a key cap's edge.
- **Field Grey** (`field`, hover `field-deep`): a default button, a chosen radio, a picked line.
- **Edge** (`edge`): a field's border, at 3:1 on every grey, and the scrollbar.

### Named Rules
**The Function Code Rule.** Orange, blue, green and red each mean one thing and only that. None is a heading color, a background area or an ornament.

**The Two Hands Rule.** Each function color fills at its own value and speaks text in its deeper hand (`-ink`), which keeps 4.5:1. A filled orange control carries ink, never white.

## Typography

**Text Font:** JetBrains Mono Variable (with ui-monospace), self-hosted from `@fontsource-variable/jetbrains-mono`, its ligatures on.
**Heading Font:** Familjen Grotesk Variable (with system-ui), self-hosted from `@fontsource-variable/familjen-grotesk`.

Both are OFL-1.1, noted in THIRD_PARTY_NOTICES.md, and their latin faces are preloaded with the page.

**Character:** the mono is the instrument's own lettering, even and exact, so mail, lists and controls read as one surface. The grotesk names things, tight and confident, as printed on a device's panel.

### Hierarchy
- **Display** (grotesk 600, 2.375rem, 1.06, -0.03em): the door's title, a thread's subject and a draft's title (Headline's 1.625rem on a phone).
- **Headline** (grotesk 700, 1.625rem, 1.05, -0.03em): a view's title, such as "Inbox".
- **Wordmark** (grotesk 700, 1.375rem, 1, -0.03em): "Duva" at the side column's head and the door.
- **Body** (mono 400, 0.84375rem, 1.6): default text, with ligatures and tabular figures.
- **Proof** (mono 400, 0.875rem, 1.78 in a letter and 1.75 in the composer, under 68ch): message bodies and the text a human writes.
- **Small** (mono 400 or 600, 0.78125rem): buttons, meta.
- **Label** (mono 500, 0.6875rem): the side column's group names, the status strip, counts. Sentence case, normal tracking.
- **Key** (mono 600, 0.65625rem): key caps.

### Named Rules
**The One Typewriter Rule.** All text is the mono; only headings and the wordmark are the grotesk. No third face.

**The Sentence Case Rule.** Labels stay in sentence case at normal tracking. No uppercase, no letterspaced captions.

## Layout

On a desk (from 64rem) the page is one grid the full width and height of the window. The side column (15rem) holds the bar at its head, the wordmark and Write, the search box, and Duva's places (Mail, Approvals, Alerts, Settings), then the mailboxes, the open mailbox's views and its labels. Beside it lies the list (`clamp(20rem, 28vw, 31rem)`), then what is open from it filling the rest, and the status strip (2.125rem) runs along the foot under all three. Each column scrolls by itself, so the list keeps its place while a thread or a draft is read beside it. Views that aren't a list, such as Approvals, Settings and an agent's activity, take the list's and the reader's width together.

From 48rem to 64rem the side column stays, and what is open takes the one column beside it, as the list does while nothing is open. Under 48rem the phone has one top row (the wordmark, the search icon and Write), one column, a switcher at the view's head that opens the mailboxes and views, and the tab bar of places along the foot. There is no status strip on a phone, and Sign out is in Settings.

A list's row has one form at every width: who and when on the first line, the subject and snippet on the second. Only what fits changes (a container query on the list column gives a row's labels less room under 40rem).

Spacing follows one scale (0.25, 0.5, 0.75, 1, 1.5, 2 and 3rem). A list's content sits 1.4rem in from its column's edge; the reading pane's, 3rem.

## Elevation & Depth

Flat by default: depth is tone. The three greys step lighter toward the reader, and white is raised. The open place or view in the side column lies raised as a key pressed in, white with a 1px shade under it (`0 1px 0 rgb(22 22 22 / 0.04)`). The composer, and sheets that lie over the page, as the phone's switcher does, carry the soft lift (`0 1px 0 rgb(22 22 22 / 0.03), 0 12px 32px -18px rgb(22 22 22 / 0.22)`). A modal sheet lies over the scrim (`rgb(22 22 22 / 0.24)`).

### Named Rules
**The No Box Rule.** Columns, sections and rows are never boxed. They part by tone, a seam or space. A border is for a field, at 3:1, and a seam is one shade off its ground.

## Shapes

Small, exact radii, and pills for what is pressed. Key caps 4px, with a heavier 2px lower edge; rows and places 6px; fields 7px; sheets laid over the page 10px; buttons, chips and counts are pills.

Actors are marked by shape, so they read without color: a human is a filled dot in Second Ink, an agent a diamond outlined in Agent Blue, Duva itself a ring in Third Ink, each 0.55rem.

## Components

### Buttons
- **Shape:** pills (999px), 2.25rem tall, 0 1rem, mono 600 at 0.78125rem. Small: 1.875rem, 0 0.75rem, at 0.6875rem.
- **Default:** Field Grey with ink, Field Deep on hover.
- **Primary:** ink with white, Deep Ink on hover. Write, and the one action each view leads with.
- **Call:** orange with ink, Call Deep on hover. Only for a decision someone waits on, such as Send in an approval.
- **Quiet:** no fill, Second Ink, the ink wash on hover.
- **Press:** every button moves down 1px while pressed. Disabled at 55% opacity.
- **Key caps in a filled button** lie on it a shade lighter, with no edge.

### Chips
- **Style:** pills 1.75rem tall, a seam outline, Second Ink, mono 500 at 0.6875rem.
- **State:** the chosen chip (`aria-pressed` or `aria-current`) is filled ink with white.

### Inputs / Fields
- **Style:** white, a 1px Edge border at 3:1, 7px radius, 0.5rem 0.75rem, the text's mono. Placeholders in Third Ink.
- **Focus:** the border turns ink, with a 2px ink ring.

### Key caps
- Printed keys for shortcuts: white, a seam edge with a 2px lower edge, 4px radius, mono 600 at 0.65625rem in Second Ink. Write carries `c`, the strip `?`. A cap is never the only name of an action; it is hidden from screen readers, and the control says its key with `aria-keyshortcuts`.

### Navigation
- **Desk:** the places and views are rows in the side column, mono at body size, 6px rows with the ink wash on hover. The view open, and a place outside the mail, lie raised white; Mail and the mailbox open are set heavier instead, since the view says where the human is. Approvals lies on the orange wash while something waits, with its count as an orange pill; unseen alerts are counted in Alert Red text. Unread counts are in Call Orange text, the Screener's in Third Ink.
- **Phone:** the places lie in a tab bar on Side Grey along the foot, icon over name, the current one in ink with an ink line at the bar's edge, a waiting count at the icon's shoulder.

### The three panes
- The list beside an open thread or draft stays the same element, so it keeps its place. It becomes a region named by its title, one heading level down, and the open view is the page's main content.
- The open line is marked by the orange edge (an inset 3px Call Orange line) on Reader Grey.
- While nothing is open, the reading pane says so quietly, in Third Ink.

### Lists
- **Rows on the plane:** the Inbox, a label's, Sent, All mail, Spam, Trash, Drafts, a search's results, the Screener and Screened senders lie in the list column edge to edge, parted by seams, never on a sheet. A row keeps the list's 1.4rem inset inside it.
- **A row:** the checkbox, then on the first line the actor mark and who sent it (Second Ink, 500), a thread's message count, its groups and labels, quietly (Third Ink, label size), and the time at the end; on the second, the subject (Second Ink, 500) and the snippet (Third Ink) on one line that ends with an ellipsis. A search's result gives the snippet two lines of its own, the words found on Field Deep, heavier.
- **Unread:** the orange dot (5px) in the gutter left of the checkbox, and who, the subject and the time in Ink, heavier.
- **Waiting for you:** a thread an agent's send waits in for its sponsor opens its second line with "Waiting for you" in `call-ink` and the agent's name in `agent-ink`, both 700, before the subject.
- **Actor marks:** an agent the human sponsors, known by its mailbox's addresses, takes the diamond; Duva's own mail, from its system address, the ring; everyone else the dot.
- **Open and picked:** the open row lies on Reader Grey with the orange edge across the whole row; a picked row on Field Grey, and a row under the pointer on the ink wash.
- **Checkboxes:** small square keys, 0.875rem (1.25rem on a phone), edged at 3:1 in Edge, filled ink with a white tick when picked and a dash while some are.
- **The toolbar** heads the rows and stays at the column's top as they scroll: the box that picks them all, level with the rows' boxes, then once any is picked how many, and the small actions, each with its key cap.
- **Chips** under the head of the Inbox, a label and All mail: All, Unread and each of the human's own labels. Each but All is the search that narrows the list to them, newest first, so Duva filters it; on those results the chips stay, the one chosen in ink.
- **The Screener's row:** while new senders wait, one raised white slip at the Inbox's top says how many, with "Screen them".
- **What was just done** is said in Ink above the rows, with Undo and its `z` cap.
- **The Screener:** each waiting sender is a row: their dot, name (mono 700) and address, their mail as lines set in under the name, then Let in and Block. Screened senders names its groups as labels (mono 500, Third Ink) and each decision is a row with its actions.

### Keyboard
- The shortcuts are Gmail's wherever Duva has the action: `c` write; `j` and `k` next and previous; `o` or Enter open; `x` select; `e` archive; `#` Trash; `!` spam; `l` labels; Shift+`I` and Shift+`U` read and unread; `r`, `a` and `f` reply, reply all and forward; `u` or Esc back to the list; `z` undo; `/` search; `?` the sheet; `g` then `i`, `t`, `d` or `a` the Inbox, Sent, Drafts or All mail; Ctrl or ⌘ with Enter sends. A key that finishes a chord acts only as the chord, so `g` `a` goes to All mail and never replies to all.
- None acts in a field, over a modal sheet, or once the human turns them off on You, and then no cap shows.
- Every control with a key shows its cap and names it in `aria-keyshortcuts`: Write's `c`, the search field's `/` printed where its icon is while it is empty, the toolbar's `e`, `#`, `!` and `l`, Undo's `z`.
- **The ? sheet** is a legend printed on the instrument: white, the soft lift over the scrim, 10px, a grotesk title, its three groups (in a list, in a thread, anywhere) side by side under label-size names, each key a cap beside what it does, keys pressed together joined by "+" and chords by "then". On a phone it lies along the foot, the groups one under another.

### Status strip
- Side Grey along a desk's foot, mono 500 at 0.6875rem in Second Ink, one line: a green light and "Up to date at …" (red, heavier, when Duva can't be reached), each sponsored agent's diamond with whether it is running and how many sends it has left this hour, or that it is paused, then at the end the `?` key for the shortcuts, who is signed in with their dot, and Sign out.

### Letter
- **The thread's tools** run along the reading pane's top as quiet keys, each its key cap then its name in Second Ink, the ink wash on hover: back to the list (`u`), then, past a seam, Archive (`e`), Mark as spam (`!`), Move to Trash (`#`), Labels (`l`) and Mark unread (`⇧U`). Where the pane has room (56rem), `j` and `k` say at the right that they move through the list. In a pane narrower than one line of them (46rem), back shows as its arrow and cap, its name kept for screen readers, and the keys sit closer.
- **The subject** is Display, balanced, at most 30ch, with what the thread holds under it in Third Ink: how many messages, then its labels.
- **Letters** lie on the plane at a 72ch measure, never on a sheet: each is parted from the one before by a seam along its top. A letter's head is the sender's actor mark, their name in mono 700, their address in Third Ink, and at the right who sent it from the mailbox and when, in Third Ink. What an agent sent says so in Agent Ink. To, Cc and a differing subject follow small, on the name column (4.5rem). The body is Proof at 1.78, under 68ch; quoted runs fold behind a link and open under a 1px Edge line.
- **Slugs:** a read or older letter folds to one line, the mark, the name in ink 500, the start of what it says in Third Ink, cut short, and the date. Hover lifts the snippet to Second Ink.
- **States:** a message that arrived while the thread is open carries "New" as an orange pill, since it needs the human. The letter a search found is ringed in ink for a moment; a focused letter is ringed only from the keyboard.
- **Replies** sit under the newest letter: Reply as the primary button, then Reply all and Forward as default buttons, each with its cap at its end (`r`, `a`, `f`).
- **HTML mail** keeps its own design in its frame, laid on Reader Grey; mail without styles of its own is set in the page's mono, from the faces the page loaded.
- **Phone:** no caps. Reply, Archive and Trash lie in a bar on Reader Grey along the foot, above the tab bar, with a seam over it; Reply is primary. More raises the rest on a sheet with the soft lift.

### Composer
- **The one raised surface in the reading pane:** white, 10px, with the soft lift, at the 72ch measure. A reply rises into place under the newest letter (320ms, from 0.5rem below), and a draft opened by itself takes the pane under its Display title, with "Saved at" beside it.
- **Header fields** are lines on it, each parted by a seam: the label in Third Ink on the name column, the field itself with no border of its own. The line being typed in carries the orange bar (2px, inset) at the composer's edge, red while it holds what isn't an address, with its label in Alert Ink. The text runs under them in Proof at 1.75, with the same bar while it has the cursor.
- **The foot:** Send in ink with its cap (`Ctrl ↵`, or `⌘↵` on a Mac, which sends from anywhere in the composer), Delete draft quiet, and "Saved at" in Third Ink at the right. A read-only field turns Second Ink.
- **How the send went** sits above the foot: on its way in Second Ink, breathing; sent in Sent Ink with its check; refused or unclear as an alert notice. A new message that went out folds to a slip on the plane under a seam, its check in Sent Ink, who it went to, its subject and its thread.
- **In the Drafts list,** a draft's state is said small before its subject, the agent that saved it last in Agent Ink, and only a refused or unclear send in Alert Ink.

## Do's and Don'ts

### Do:
- **Do** separate columns and rows by tone, a seam or space.
- **Do** use each function color for its one meaning, filled at its own value and as text in its `-ink` hand.
- **Do** set every text in the mono with ligatures on, and every heading in the grotesk.
- **Do** mark actors by shape with the one actor mark: dot, diamond, ring.
- **Do** show a shortcut as a key cap beside the action it runs, hidden from screen readers.
- **Do** keep text at 4.5:1 and field borders at 3:1 on every grey.

### Don't:
- **Don't** box a section, a column or a list in a card.
- **Don't** put white text on orange; it falls under 4.5:1. Ink goes on orange.
- **Don't** use blue for anything but an agent, or orange for anything that doesn't need the human.
- **Don't** add a third typeface, uppercase labels or letterspaced captions.
- **Don't** use a dark theme; Field Desk is light only.
