// Every string the web app shows, in one place, so another language can be added later.
import type { components } from "@duva/openapi";

type ActivityChange = components["schemas"]["ActivityEntry"]["change"];

/** How long Trash and Spam keep a thread, while the organization's retention period is read, or isn't known. */
const keptFor = (days?: number) => (days === undefined ? "after the organization's retention period here" : `after ${days === 1 ? "1 day" : `${days} days`} here`);

export const strings = {
  loading: "Loading…",
  signIn: "Sign in",
  signOut: "Sign out",
  signedInAs: (email: string, admin: boolean) => (admin ? `${email}, admin` : email),
  failed: (message: string) => `Duva couldn't load: ${message}. Reload the page to try again.`,
  signedOut: {
    title: "Sign in to Duva",
    lead: "Your mail and your agents' approvals, on your organization's own domain.",
  },
  signedOutToAccess: {
    title: "Sign in to see the request",
    lead: "An agent asks for access to your mail. Sign in to see what it asks for, and approve or decline it.",
  },
  sessionEnded: {
    title: "Your session has ended",
    lead: "Sign in again to see your mail and approvals.",
  },
  /** A tab's title: the view, with how many in it want the human, if any do. */
  title: (view: string, count = 0) => (count > 0 ? `${view} (${count}) · Duva` : `${view} · Duva`),
  mailboxesFailed: "Duva couldn't list your mailboxes. Try again in a moment.",

  mailboxes: {
    label: "Mailboxes",
    yours: "Your mailbox",
    yourMailboxes: "Your mailboxes",
    /** A human's own mailbox that has no address, by its place among theirs, so two never look the same. */
    withoutAddress: (place: number) => `Mailbox ${place}, without an address`,
    agents: "Agents",
    unread: (count: number) => `${count} unread`,
    /** The selector at the side column's head, which opens the mailboxes. */
    choose: "Choose a mailbox",
    /** The agents' mailboxes, which a desk's side column lists apart from the selector. */
    agentsLabel: "Agents' mailboxes",
    /** The address a mailbox is shown with: its default address, if it has one. */
    address: (mailbox: { defaultAddress?: string }) => mailbox.defaultAddress ?? "No address",
  },

  nav: {
    label: "Duva",
    mail: "Mail",
    screener: "Screener",
    approvals: "Approvals",
    alerts: "Alerts",
    settings: "Settings",
    waiting: (count: number) => `, ${count} waiting`,
    unseen: (count: number) => `, ${count} unseen`,
    write: "Write",
    search: "Search",
    skip: "Skip to main content",
    /** The wordmark, which goes to the Inbox. */
    home: "Duva, go to your Inbox",
  },
  /** The status strip along the foot of a desk. */
  strip: {
    label: "Status",
    unreachable: "Duva couldn't check for changes. It tries again by itself.",
    running: (agent: string, left?: number) =>
      left === undefined ? `${agent} is running` : `${agent} is running, ${left === 0 ? "no sends" : left === 1 ? "1 send" : `${left} sends`} left this hour`,
    paused: (agent: string) => `${agent} is paused`,
    shortcuts: "Shortcuts",
  },

  /** The reading pane while nothing is open from the list beside it. */
  reader: {
    title: "Nothing open",
    lead: "What you open from the list shows here.",
  },

  connection: {
    upToDate: (time: string) => `Up to date at ${time}`,
    unreachable: "Duva couldn't check for new requests. It tries again by itself.",
    mailUnreachable: "Duva couldn't check for new mail. It tries again by itself.",
  },

  inbox: {
    title: "Inbox",
    agentTitle: (agent: string) => `${agent}'s Inbox`,
    threads: "Threads",
    unread: (count: number) => `${count} unread`,
    unreadMark: "Unread",
    agentSender: (agent: string) => `${agent}, an agent`,
    verifiedSender: (sender: string) => `${sender}, verified logo`,
    waitingForYou: "Waiting for you",
    waitsFor: (agent: string, forward: boolean) => `${agent}'s ${forward ? "forward" : "reply"} waits for you`,
    chips: { name: "Show", all: "All", unread: "Unread" },
    screener: {
      senders: (count: number) => (count === 1 ? "1 new sender" : `${count} new senders`),
      wait: (count: number) => (count === 1 ? "waits in the Screener" : "wait in the Screener"),
      go: "Screen them",
    },
    messages: (count: number) => `${count} messages`,
    labelled: (names: string[]) => `labelled ${list(names)}`,
    toGroups: (groups: string[]) => `to the ${groups.length === 1 ? "group" : "groups"} ${list(groups)}`,
    older: "Show older threads",
    loadingOlder: "Loading older threads…",
    arrived: (count: number) => (count === 1 ? "1 new thread" : `${count} new threads`),
    emptyTitle: "Your Inbox is empty",
    agentEmptyTitle: (agent: string) => `${agent}'s Inbox is empty`,
    emptyLead: (address: string | undefined) =>
      address === undefined
        ? "This mailbox has no address, so no new mail reaches it. An admin can give it one."
        : `Mail to ${address} appears here. This page checks for new mail by itself, so there's no need to reload it.`,
    noMailboxTitle: "You don't have a mailbox yet",
    noMailboxLead: "Ask an admin to give you one. Your mail appears here once you have it.",
    noMailboxSponsor: "You can still decide what your agents ask to send in Approvals.",
    unknownMailboxTitle: "This mailbox isn't yours to read",
    unknownMailboxLead: "You can read your own mailbox, and those of the agents you sponsor.",
    failed: (status: number) => `Duva couldn't list your threads (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so your threads aren't listed. Check your connection and try again.",
    retry: "Try again",
  },

  search: {
    box: (agent?: string) => (agent === undefined ? "Search your mail" : `Search ${agent}'s mail`),
    title: "Search results",
    words: (q: string) => `“${q}”`,
    results: "Results",
    sort: "Sort",
    relevance: "Best match",
    newest: "Newest",
    more: "Show more results",
    loadingMore: "Loading more results…",
    found: (count: number, more: boolean) => (more ? `At least ${count} threads found` : count === 1 ? "1 thread found" : `${count} threads found`),
    emptyTitle: "No threads match",
    emptyLead: (q: string) => `Nothing in this mailbox has everything in “${q}”. Try fewer words, or other filters.`,
    elsewhere: "Spam and Trash are searched only when you look in them.",
    inSpam: "Look in Spam",
    inTrash: "Look in Trash",
    failed: (status: number) => `Duva couldn't search (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so nothing was searched. Check your connection and try again.",
    filters: "Filters",
    from: "From",
    to: "To",
    label: "Label",
    anyLabel: "Any label",
    attachment: "Has an attachment",
    unread: "Unread",
    after: "On or after",
    before: "Before",
    nameOrAddress: "Part of a name or address",
    search: "Search",
    cancel: "Cancel",
  },

  sent: {
    title: "Sent",
    emptyTitle: "Nothing sent yet",
    emptyLead: "Threads you send mail in appear here, newest first. Write a message, or reply to one in your Inbox.",
    agentTitle: (agent: string) => `${agent}'s Sent`,
    agentEmptyTitle: (agent: string) => `${agent} hasn't sent anything yet`,
    agentEmptyLead: (agent: string) => `Threads ${agent} sends mail in appear here, newest first, once you approve its sends.`,
  },

  drafts: {
    title: "Drafts",
    list: "Drafts",
    emptyTitle: "No drafts",
    emptyLead: "Duva saves what you write as you type, so a message you haven't sent waits here until you finish it.",
    noRecipients: "No recipients yet",
    to: (recipients: string) => `To ${recipients}`,
    by: (agent: string) => `By ${agent}`,
    states: { failed: "Not sent", approved: "Sending", waitingForLimit: "Waiting for the send limit", sending: "Sending", unclear: "Unclear if sent" } as Partial<Record<string, string>>,
    failed: "Duva couldn't list your drafts. Try again in a moment.",
    unreachable: "Duva couldn't be reached, so your drafts aren't listed. Check your connection and try again.",
  },

  compose: {
    newMessage: "New message",
    reply: "Reply",
    forward: "Forward",
    draft: "Draft",
    backToThread: "Thread",
    backToDrafts: "Drafts",
    from: "From",
    asGroup: "As a group",
    asGroupHint: "Sent as the group. Its other members in the organization get a copy, so they see it was answered.",
    to: "To",
    cc: "Cc",
    bcc: "Bcc",
    addCopies: "Add Cc or Bcc",
    bccHint: "Bcc recipients get the message, but nobody sees that they did.",
    toHint: "Separate addresses with commas.",
    subject: "Subject",
    message: "Message",
    send: "Send",
    // The cap on Send, for the key that sends from anywhere in the draft: Command and Return on a Mac, Ctrl and Enter elsewhere.
    sendKey: (mac: boolean) => (mac ? "⌘↵" : "Ctrl ↵"),
    sendAgain: "Send again",
    delete: "Delete draft",
    deleting: "Deleting…",
    saving: "Saving…",
    saved: (time: string) => `Saved at ${time}`,
    savedBy: (agent: string) => `Last saved by ${agent}`,
    saveFailed: "Duva couldn't save the draft. It tries again as you type.",
    notAddress: (address: string) => `“${address}” isn't an email address. Fix it, and Duva saves the rest meanwhile.`,
    noRecipient: "Add a recipient in To, then send.",
    sendFailed: "Duva couldn't send the draft. Try again in a moment.",
    unreachable: "Duva couldn't be reached, so nothing was sent. Check your connection and try again.",
    deleteFailed: "Duva couldn't delete the draft. Try again.",
    startFailed: "Duva couldn't start the draft. Try again.",
    loadFailed: "Duva couldn't open this draft. Try again in a moment.",
    gone: "This draft no longer exists.",
    sending: "Sending…",
    canLeave: "This takes longer than usual. You can leave, and Duva finishes the send.",
    sent: "Sent.",
    sentTo: (recipients: string[]) => `Sent to ${list(recipients)}.`,
    waitingForLimit: (agent: string | undefined) => `Waiting for the send limit. It goes out by itself when ${agent === undefined ? "the agent's" : `${agent}'s`} send limit allows.`,
    openThread: "Open the thread",
    refused: "Not sent. The mail service refused it, for the reason below. Change the draft and send it again. If the reason isn't about the recipients or the message, ask your admin.",
    serviceSaid: (reason: string) => `The mail service said: ${reason}`,
    unclear: "Sending stopped before the mail service answered, so Duva can't tell whether it went out. Duva won't send it again. Ask the recipients whether it arrived.",
    readOnly: "A sent draft can't change. Write a new message instead.",
  },

  views: {
    label: "Mail",
    inbox: "Inbox",
    feed: "Feed",
    paperTrail: "Paper Trail",
    sent: "Sent",
    drafts: "Drafts",
    allMail: "All mail",
    reminders: "Remind me",
    spam: "Spam",
    trash: "Trash",
    yourLabels: "Your labels",
    newLabel: "New label",
    unknownLabel: "Label",
    unread: (count: number) => `, ${count} unread`,
    /** The phone's one switcher for the mailbox and its view, which names both. */
    switcher: "Mailboxes and views",
    elsewhere: "New mail in another mailbox",
    empty: {
      all: { title: "No mail yet", lead: "Every thread is listed here, archived ones too, except those in Spam and Trash." },
      reminders: { title: "Nothing set aside", lead: "Set a thread aside with Remind me, and it waits here until its time, then comes back to the top of your Inbox." },
      spam: {
        title: "No spam",
        lead: (days?: number) => `Mail judged to be spam when it arrived, and threads you mark as spam, are listed here, out of your Inbox. Each is erased for good ${keptFor(days)}.`,
      },
      trash: { title: "Trash is empty", lead: (days?: number) => `Threads you move to Trash are listed here until you restore them. Each is erased for good ${keptFor(days)}.` },
      label: { title: "No threads have this label", lead: "Pick threads in any view, then add the label to them with Labels." },
      feed: { title: "The Feed is empty", lead: "Newsletters lie here, read as a stream, out of your Inbox. Open a sender in a letter and choose the Feed for their mail." },
      paperTrail: { title: "The Paper Trail is empty", lead: "Receipts and notifications lie here, out of your Inbox. Open a sender in a letter and choose the Paper Trail for their mail." },
    },
  },

  /** Ask your agent: the human's conversation with their mailbox's mailbox agent, in the reading pane. */
  ask: {
    link: "Ask your agent",
    title: "Ask your agent",
    you: "You",
    agent: "Mailbox agent",
    where: (address: string) => `Works in ${address}, as itself`,
    can: {
      none: "It has no access to this mailbox now.",
      read: "It reads and searches your mail.",
      organize: "It reads, searches and organizes your mail.",
      draft: "It reads, searches and organizes your mail, and writes drafts.",
      send: (approval: boolean) => (approval ? "It reads, searches and organizes your mail, and writes drafts. Each send waits for you in Approvals." : "It reads, searches and organizes your mail, writes drafts and sends them without asking you."),
    } as const,
    settings: "Its settings",
    clear: "Start over",
    clearing: "Starting over…",
    emptyTitle: "Ask about your mail",
    emptyLead: "It reads what is in this mailbox and does what you ask, within what you let it do. What it does shows here as it goes, with links to what it touched.",
    suggestions: ["What came in today that needs me?", "Sum up the newest thread.", "Draft a reply to the last mail I got."],
    suggestion: "Ask this",
    field: "What do you want to ask?",
    placeholder: "Ask your agent…",
    send: "Ask",
    hint: "Enter asks, Shift+Enter starts a new line.",
    thinking: "Working…",
    working: "Your agent is working",
    answered: "Your agent answered",
    steps: "What it did",
    open: {
      thread: "the thread",
      threads: (count: number) => `${count} threads`,
      draft: "the draft",
      approvals: "Waits for you in Approvals",
    },
    actions: {
      getMailbox: "Looked at the mailbox",
      listThreads: "Listed threads",
      listSentThreads: "Listed Sent",
      listAllMail: "Listed All mail",
      getThread: "Read",
      searchMailbox: "Searched the mail",
      markThreadsRead: "Marked read",
      markThreadsUnread: "Marked unread",
      labelThreads: "Changed the labels of",
      remindThreads: "Set aside in Remind me",
      cancelReminders: "Brought back from Remind me",
      listReminders: "Listed Remind me",
      listLabels: "Listed the labels",
      createLabel: "Created a label",
      getScreener: "Looked in the Screener",
      listSenders: "Listed senders",
      getSender: "Looked up a sender",
      setSenderDelivery: "Decided where a sender's mail goes",
      listDrafts: "Listed Drafts",
      getDraft: "Read",
      createDraft: "Wrote",
      editDraft: "Changed",
      deleteDraft: "Deleted a draft",
      sendDraft: "Asked to send",
    } as Record<string, string>,
    refusedStep: (message: string) => `Duva refused: ${message}`,
    capReached: "It stopped here, since the mailbox agents reached the organization's spend cap for the month. An admin can raise it in Settings.",
    failed: "Something went wrong on its side, so it stopped. Ask again.",
    unreachable: "Duva couldn't be reached, so your agent didn't get that. Check your connection and ask again.",
    loadFailed: "Duva couldn't load what you asked your agent before. Try again in a moment.",
    retry: "Try again",
    notYours: "Only your own mailboxes have a mailbox agent you can ask.",
  },

  feed: {
    stream: "Newest first",
    more: "Show older",
    failed: (status: number) => `Duva couldn't read the Feed (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the Feed isn't shown. Check your connection and try again.",
    openThread: "Open the thread",
  },

  sender: {
    open: (who: string) => `Where mail from ${who} goes`,
    back: "Back",
    threads: (count: number) => (count === 0 ? "No threads from them here yet" : count === 1 ? "1 thread from them here" : `${count} threads from them here`),
    domainThreads: (count: number) => (count === 0 ? "No threads from anyone there yet" : count === 1 ? "1 thread from someone there" : `${count} threads from people there`),
    now: "Their mail goes to",
    nowByDomain: (domain: string) => `as decided for everyone at ${domain}`,
    goesTo: {
      screener: "The Screener, as a first-time sender's",
      inbox: "The Inbox",
      feed: "The Feed",
      paperTrail: "The Paper Trail",
      label: (name: string) => `The label ${name}`,
      nowhere: "Nowhere. Their mail is dropped as it arrives",
    },
    choose: "Send their mail to",
    choices: {
      inbox: { name: "Inbox", hint: "Mail that wants your attention." },
      feed: { name: "Feed", hint: "Newsletters, read as a stream. Arrives read." },
      paperTrail: { name: "Paper Trail", hint: "Receipts and notifications. Arrives read." },
      label: { name: "A label", hint: "Filed under one of your labels instead of the Inbox, unread." },
      nowhere: { name: "Nowhere", hint: "Dropped as it arrives and kept nowhere. Duva unsubscribes where their mail offers one-click." },
    },
    whichLabel: "Label",
    noLabels: "You have no labels yet. Create one in the side column first.",
    scope: "For",
    thisAddress: (address: string) => `Just ${address}`,
    everyoneAt: (domain: string) => `Everyone at ${domain}`,
    save: "Save",
    saving: "Saving…",
    moves: "Their threads where their mail goes now move with it, and keep the labels you gave them.",
    nowhereAsk: (count: number) =>
      count === 0
        ? "Their later mail is dropped as it arrives. This can't be undone: what is dropped can't come back."
        : `This erases ${count === 1 ? "their thread" : `their ${count} threads`} here for good, Spam and Trash included, and drops their later mail. This can't be undone.`,
    nowhereConfirm: "Erase and send nowhere",
    leaveNowhere: "Mail Duva dropped while it went nowhere can't come back.",
    cancel: "Cancel",
    failed: (status: number) => `Duva couldn't read the sender (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the sender isn't shown. Check your connection and try again.",
    saveFailed: (status: number) => `Duva couldn't save where their mail goes (error ${status}). Try again in a moment.`,
    saveUnreachable: "Duva couldn't be reached, so nothing changed. Check your connection and try again.",
    nowhereRefused: "Only the mailbox's owner can send a sender's mail nowhere, since that erases it.",
    saved: (who: string, to: string, moved: number) => (moved === 0 ? `${who}'s mail goes to ${to} now.` : `${who}'s mail goes to ${to} now. Moved ${threads(moved)}.`),
    savedNowhere: (who: string, erasing: number) => (erasing === 0 ? `${who}'s mail goes nowhere now.` : `${who}'s mail goes nowhere now. Erasing ${threads(erasing)}.`),
    places: { inbox: "the Inbox", feed: "the Feed", paperTrail: "the Paper Trail", label: (name: string) => name, nowhere: "nowhere" },
  },

  organize: {
    toolbar: "Selected threads",
    threadToolbar: "Thread actions",
    selectAll: "Select the threads shown",
    select: (subject: string) => `Select ${subject}`,
    selected: (count: number) => `${count} selected`,
    selectedShown: (count: number) => `${count} selected, only the threads shown`,
    archive: "Archive",
    moveToInbox: "Move to Inbox",
    spam: "Mark as spam",
    notSpam: "Not spam",
    trash: "Move to Trash",
    restore: "Restore",
    labels: "Labels",
    labelsFor: (count: number) => (count === 1 ? "Labels for this thread" : `Labels for ${count} threads`),
    noLabels: "You have no labels yet.",
    archived: (count: number) => `Archived ${threads(count)}.`,
    inboxed: (count: number) => `Moved ${threads(count)} to the Inbox.`,
    spammed: (count: number) => `Marked ${threads(count)} as spam.`,
    notSpammed: (count: number) => `Moved ${threads(count)} from Spam to the Inbox.`,
    trashed: (count: number) => `Moved ${threads(count)} to Trash.`,
    restored: (count: number) => `Restored ${threads(count)} from Trash.`,
    labelled: (name: string) => (count: number) => `Added ${name} to ${threads(count)}.`,
    unlabelled: (name: string) => (count: number) => `Removed ${name} from ${threads(count)}.`,
    markedRead: (count: number) => `Marked ${threads(count)} read.`,
    markedUnread: (count: number) => `Marked ${threads(count)} unread.`,
    undo: "Undo",
    undone: "Undone.",
    undoFailed: "Duva couldn't undo that. Change the threads back by hand.",
    failed: "Duva couldn't change the threads. Try again.",
  },

  remind: {
    button: "Remind me",
    for: (count: number) => (count === 1 ? "Remind me about this thread" : `Remind me about ${count} threads`),
    presets: { laterToday: "Later today", tomorrowMorning: "Tomorrow morning", nextWeek: "Next week" },
    own: "Another time",
    set: "Set",
    until: (when: string) => `Back ${when}.`,
    someUntil: (count: number, when: string) => `${count} set aside, the first back ${when}.`,
    cancel: "Cancel reminder",
    setAside: (count: number, when: string) => `Set ${threads(count)} aside until ${when}.`,
    cancelled: (count: number) => `Moved ${threads(count)} back to the Inbox.`,
    past: "Choose a time at least a minute from now.",
    failed: "Duva couldn't set the threads aside. Try again.",
    /** A thread's mark once it came back, and when it was set aside. */
    back: "Back",
    setAsideOn: (day: string) => `set aside ${day}`,
    backLabel: (day: string) => `back from Remind me, set aside ${day}`,
    /** In Remind me, when each thread comes back. */
    comesBack: (when: string) => `back ${when}`,
    threadUntil: (when: string) => `Set aside until ${when}`,
    threadBack: (day: string) => `Back, set aside ${day}`,
  },

  shortcuts: {
    title: "Keyboard shortcuts",
    lead: "They are Gmail's, wherever Duva has the action, and none works while you type in a field.",
    inList: "In a list",
    inThread: "In a thread",
    anywhere: "Anywhere",
    or: "or",
    then: "then",
    next: "Next thread",
    previous: "Previous thread",
    open: "Open the thread",
    select: "Select the thread",
    archive: "Archive",
    trash: "Move to Trash",
    spam: "Mark as spam",
    labels: "Labels",
    remind: "Remind me",
    markRead: "Mark read",
    markUnread: "Mark unread",
    reply: "Reply",
    replyAll: "Reply all",
    forward: "Forward",
    back: "Back to the list",
    send: "Send what you write",
    write: "Write",
    search: "Search",
    undo: "Undo what you just did",
    goInbox: "Go to the Inbox",
    goSent: "Go to Sent",
    goDrafts: "Go to Drafts",
    goAll: "Go to All mail",
    ask: "Ask your agent",
    goScreener: "Go to the Screener",
    help: "These shortcuts",
    offBefore: "To turn them off, as for speech input, choose Off on ",
    offLink: "Preferences in Settings",
    offAfter: ".",
    done: "Close",
  },

  trash: {
    empty: "Empty Trash",
    confirm: "Erase every thread in Trash for good? This can't be undone.",
    erase: "Erase for good",
    erasing: "Erasing…",
    cancel: "Cancel",
    emptied: "Emptied Trash. Its threads are erased for good.",
    failed: (status: number) => `Duva couldn't empty Trash (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so Trash wasn't emptied. Check your connection and try again.",
  },

  labelForm: {
    newLabel: "New label",
    create: "Create",
    createAndAdd: "Create and add",
    cancel: "Cancel",
    save: "Save",
    rename: "Rename",
    renameLabel: (name: string) => `Rename ${name}`,
    renamed: (name: string) => `Renamed the label to ${name}.`,
    deleteLabel: "Delete label",
    deleting: "Deleting…",
    confirmDelete: (name: string) => `Delete ${name}? Its threads stay, without the label.`,
    deleted: (name: string) => `Deleted the label ${name}. Its threads are still in your mail.`,
    missing: "Give the label a name.",
    taken: (name: string) => `You have a label named ${name} already, or it's a built-in name. Pick another.`,
    failed: (status: number) => `Duva couldn't save the label (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the label wasn't saved. Check your connection and try again.",
  },

  labelPrompt: {
    lead: "Your mailbox agent gets each message here, with this prompt:",
    add: "Add a prompt",
    edit: "Edit prompt",
    field: (label: string) => `Prompt for ${label}`,
    hint: "Each message that gets this label, by hand, by an agent or by a sender's delivery, goes to your mailbox agent as a task with this prompt. It works within the access you give it, and the message still goes where it goes.",
    placeholder: "Note the amount and the date, and draft a reply that thanks them.",
    save: "Save prompt",
    remove: "Remove prompt",
    cancel: "Cancel",
    missing: "Write what your mailbox agent is to do with each message.",
    saved: (label: string) => `Saved. Your mailbox agent gets each message labelled ${label} from now on.`,
    removed: (label: string) => `Removed the prompt. Messages labelled ${label} no longer go to your mailbox agent.`,
    failed: (status: number) => `Duva couldn't save the prompt (error ${status}). Try again in a moment.`,
    noAgent: "This mailbox has no mailbox agent yet. Ask an admin to run duva deploy, which gives every human's mailbox one.",
    unreachable: "Duva couldn't be reached, so the prompt wasn't saved. Check your connection and try again.",
  },
  tasks: {
    title: "Tasks",
    from: (label: string) => `from ${label}`,
    states: { waiting: "Waiting", working: "Working", done: "Done", failed: "Failed" },
    agent: "Mailbox agent",
  },

  logo: {
    of: (sender: string) => `${sender}'s logo`,
    verified: (sender: string) => `${sender}'s verified logo`,
  },
  thread: {
    reply: "Reply",
    replyAll: "Reply all",
    starting: "Starting…",
    bar: "Actions",
    trashShort: "Trash",
    more: "More",
    dated: (when: string) => `Dated ${when}`,
    labels: "Labels",
    markUnread: "Mark unread",
    markingUnread: "Marking unread…",
    markFailed: "Duva couldn't mark the thread unread. Try again.",
    markReadFailed: "Duva couldn't mark the thread read, so it still shows as unread. Open it again to retry.",
    messages: "Messages",
    count: (count: number) => (count === 1 ? "1 message" : `${count} messages`),
    nextPrevious: "next, previous",
    isNew: "New",
    from: "From",
    to: "To",
    cc: "Cc",
    bcc: "Bcc",
    subject: "Subject",
    date: "Date",
    noSubject: "(no subject)",
    plusTag: (recipient: string, tag: string) => `Sent to ${recipient}, with the plus tag ${tag}`,
    sentByYou: (as?: string) => (as === undefined ? "You sent this" : `You sent this as ${as}`),
    sentFromMailbox: "Sent from this mailbox",
    sentBy: (actor: string, as?: string) => (as === undefined ? `Sent by ${actor}` : `Sent by ${actor} as ${as}`),
    toGroup: (group: string) => `Sent to the group ${group}.`,
    approvedAsIs: "You approved it as written.",
    approvedEdited: (fields: string[]) => `You approved your version, changing ${list(fields)}.`,
    approvedBySponsor: "Its sponsor approved it.",
    attachments: "Attachments",
    unnamed: "Attachment without a name",
    download: (name: string) => `Download ${name}`,
    downloading: "Downloading…",
    downloadFailed: "Duva couldn't get the attachment. Try again.",
    forward: "Forward",
    attachment: (type: string, size: string) => `${type}, ${size}`,
    showAsText: "Show as plain text",
    showAsDesigned: "Show as designed",
    designed: (sender: string) => `The message from ${sender}, as designed`,
    removedTrackers,
    showQuoted: "Show quoted text",
    hideQuoted: "Hide quoted text",
    gone: "This thread is no longer in your mailbox.",
    failed: "Duva couldn't open this thread. Try again in a moment.",
    unreachable: "Duva couldn't be reached, so the thread isn't shown. Check your connection and try again.",
  },

  settings: {
    title: "Settings",
    index: {
      /** The index's two groups: what is the human's own, and what the organization shares. */
      group: { you: "You", organization: "Organization" },
      back: "Settings",
      paused: "Paused",
      waiting: (count: number) => `${count} waiting`,
      recordsMissing: (domain: string, records: number) => `${domain}, ${records === 1 ? "1 record" : `${records} records`} missing`,
      domainsMissing: (domains: number) => `${domains} domains have records missing`,
      /** What each page holds now, as its line in the index says it. */
      you: ({ hourCycle, dateFormat, mailView }: components["schemas"]["Preferences"]) =>
        [
          hourCycle === "h12" ? "12-hour clock" : hourCycle === "h23" ? "24-hour clock" : "Default clock",
          ...(dateFormat === "iso" ? ["dates year first"] : dateFormat === "dayMonth" ? ["dates day first"] : dateFormat === "monthDay" ? ["dates month first"] : []),
          mailView === "html" ? "mail as designed" : "mail as plain text",
        ].join(", "),
      screener: (on: number, of: number) => (of === 1 ? (on === 1 ? "On" : "Off") : on === of ? `On for all ${of} mailboxes` : on === 0 ? `Off for all ${of} mailboxes` : `On for ${on} of ${of} mailboxes`),
      agents: (count: number) => (count === 1 ? "1 agent" : `${count} agents`),
      running: "Running",
      organization: (days: number) => `Trash and Spam keep mail ${days === 1 ? "1 day" : `${days} days`}`,
      domains: (domains: string[]) => (domains.length === 0 ? "No domains yet" : domains.length === 1 ? domains[0]! : `${domains.length} domains`),
      mailboxes: (count: number) => (count === 0 ? "No mailboxes yet" : count === 1 ? "1 mailbox" : `${count} mailboxes`),
      humans: (count: number) => (count === 1 ? "1 human" : `${count} humans`),
      groups: (count: number) => (count === 0 ? "No groups yet" : count === 1 ? "1 group" : `${count} groups`),
    },
    organization: "Mail and agents",
    mail: "Mail",
    mailLead: "Admins choose these for everyone in the organization.",
    agents: "Agents",
    agentsLead: "Admins choose these for every agent in the organization.",
    organizationSummary: (days: number) => `Trash and Spam keep mail ${days === 1 ? "1 day" : `${days} days`}. Admins choose this for everyone.`,
    signedInAs: (email: string) => `Signed in as ${email}.`,
    mcp: {
      title: "AI apps",
      lead: "Apps that speak MCP, such as Claude, can work in your mail through your mailbox agent: ask it, hand it tasks, and read, search, organize and draft as it may. Its sends wait for your approval if you asked for that, and everything is attributed to it.",
      address: "Duva's MCP address",
      claudeCode: "Claude Code",
      claudeCodeSteps: "Run this in a terminal, then /mcp in Claude Code to sign in with your Duva account.",
      claudeDesktop: "Claude Desktop",
      claudeDesktopSteps: "In Settings, Connectors, choose Add custom connector. Name it Duva, give it the address above, and connect, signing in with your Duva account.",
    },
    erasure: {
      legend: "When a thread with an agent's sends is erased",
      lead: "Each send an agent asked for has an approval record: the draft its approver saw, and any change they made.",
      keep: "Keep them",
      keepHint: "They stay as the record of what an agent sent and who approved it. This is the default.",
      erase: "Erase them with the thread",
      eraseHint: "The change feed still shows each decision and who made it, without the text.",
    },
    searchLanguages: {
      legend: "Languages your mail is in",
      lead: "Each search also looks for its words translated into the other languages checked here, so \"kvitto\" finds an English receipt. Duva sends the words to Amazon's Nova Lite model, in the same AWS region as your mail, which adds a little time to each search. With one language checked, or none, searches aren't translated.",
      names: { English: "English", Swedish: "Swedish", Danish: "Danish" },
      rebuilds: "Saving rebuilds every mailbox's search index, which finds less until that is done.",
    },
    retention: {
      legend: "How long Trash and Spam keep mail",
      lead: "Each thread is erased for good this many days after it got the label. It applies to the mail already there too.",
      days: "days",
      hint: "From 7 to 365. It is 30 unless an admin changes it.",
      invalid: "Give a whole number of days from 7 to 365.",
      counting: "Counting the threads this erases…",
      erases: (threads: number, days: number) =>
        threads === 0
          ? `No thread in Trash or Spam is older than ${days} days now, so saving erases none at once.`
          : `Saving erases ${threads === 1 ? "1 thread" : `${threads} threads`} in Trash and Spam that ${threads === 1 ? "is" : "are"} older than ${days} days, at the eraser's next daily run. This can't be undone.`,
      countFailed: "Duva couldn't count the threads this erases. Saving erases every thread in Trash and Spam older than this, at the eraser's next daily run.",
    },
    save: "Save",
    saving: "Saving…",
    mailboxAgents: {
      title: "Mailbox agents",
      lead: "Every human's mailbox has a mailbox agent Duva runs, which its owner asks in Ask your agent. Admins choose the model it thinks with, where the mail it reads is processed, and what all of them may spend.",
      model: {
        legend: "Model",
        lead: "Claude on Amazon Bedrock, paid per word it reads and writes.",
        names: {
          "anthropic.claude-sonnet-5-5": "Claude Sonnet 5.5",
          "anthropic.claude-haiku-4-5-20251001-v1:0": "Claude Haiku 4.5",
          "anthropic.claude-opus-5-5": "Claude Opus 5.5",
        },
        hints: {
          "anthropic.claude-sonnet-5-5": "Capable and quick. The default.",
          "anthropic.claude-haiku-4-5-20251001-v1:0": "Quicker, at about half the price, for simple questions.",
          "anthropic.claude-opus-5-5": "The most capable, at about twice the price.",
        },
      },
      where: {
        legend: "Where mail is processed",
        lead: "What a mailbox agent reads of the mail goes to the model in these AWS regions. The mail itself stays where Duva keeps it.",
        names: { eu: "In the EU", us: "In the US", global: "In any region" },
        hints: {
          eu: "Bedrock keeps the mail in the EU's AWS regions.",
          us: "Bedrock keeps the mail in the US's AWS regions.",
          global: "Bedrock sends it to any region with room, for about 10% less.",
        },
        region: "Called from",
        regionHint: "The region Duva calls Bedrock in, which the choice above sends on from.",
        mismatch: (profile: string) => `Choose ${profile === "eu" ? "an EU" : "a US"} region for that, or In any region.`,
      },
      cap: {
        legend: "Spend cap",
        label: "US dollars a month",
        hint: "At the cap, mailbox agents stop and are refused until the month ends or you raise it. 0 turns them off.",
        invalid: "Give a whole number of dollars from 0 to 10000.",
        spent: (spent: string, month: string) => `Spent ${spent} in ${month}.`,
      },
    },
    undoWindow: {
      legend: "Undo window",
      lead: "How long an approved send waits before it goes out, so its sponsor can undo the approval. A human's own mail never waits.",
      label: "Seconds",
      hint: "From 0 to 120. With 0, an approved send goes out at once.",
      invalid: "Give a whole number of seconds from 0 to 120.",
    },
    caps: {
      legend: "Agents' send limits",
      lead: "The most a sponsor can let each agent send. Each sponsor sets their agents' limits up to these.",
      lowering: "Saving lowers any agent with a higher limit to this cap.",
    },
    saved: (changed: ("erasure" | "retention" | "languages" | "indexes" | "caps" | "undo")[]) =>
      [
        "Saved.",
        ...(changed.includes("undo") ? ["Sends approved from now on wait this long."] : []),
        ...(changed.includes("erasure") ? ["This applies to threads erased from now on."] : []),
        ...(changed.includes("retention") ? ["The eraser's next daily run follows it."] : []),
        ...(changed.includes("languages") ? ["Searches use these languages from now on."] : []),
        ...(changed.includes("caps") ? ["Agents above a lowered cap are lowered to it."] : []),
        ...(changed.includes("indexes") ? ["Each mailbox's search index is being rebuilt, and finds less until it is done."] : []),
      ].join(" "),
    failed: (status: number) => `Duva couldn't read the settings (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the settings aren't shown. Check your connection and try again.",
    saveFailed: (status: number) => `Duva couldn't save the setting (error ${status}). Try again in a moment.`,
    saveUnreachable: "Duva couldn't be reached, so the setting isn't saved. Check your connection and try again.",
    you: "Preferences",
    youLead: "You choose these for yourself, and they follow you to every browser you sign in from.",
    hourCycle: {
      legend: "How times show",
      lead: "Default follows your browser's language.",
      locale: "Default",
      h12: "12-hour",
      h23: "24-hour",
    },
    dateFormat: {
      legend: "How dates show",
      lead: "Default follows your browser's language, as month names always do.",
      locale: "Default",
      iso: "Year first",
      dayMonth: "Day first",
      monthDay: "Month first",
    },
    keyboardShortcuts: {
      legend: "Keyboard shortcuts",
      lead: "Single keys, such as j and k to move through a list and e to archive. Press ? in the mail to see them all.",
      on: "On",
      onHint: "They work anywhere but in a field. This is the default.",
      off: "Off",
      offHint: "For speech input, or if keys set things off by mistake.",
    },
    mailView: {
      legend: "How mail shows",
      lead: "Mail with no design of its own always shows as text. You can switch any message the other way.",
      html: "As designed",
      htmlHint: "With the sender's layout, images and fonts. Known trackers are always removed. This is the default.",
      text: "Plain text",
      textHint: "The text alone, with no images.",
    },
    screener: {
      title: "Screener",
      lead: "On, mail from first-time senders waits in the Screener until you let them in or block them, and every sender already in the mailbox is let in. Off, all mail goes to the Inbox, except mail from blocked senders, which goes to Trash.",
      yours: "Your mailbox",
      on: "On",
      off: "Off",
      releasing: (mailbox: string) => `Mail waiting in ${mailbox} Screener moves to the Inbox when you save.`,
      yourMailbox: "your mailbox's",
      agentMailbox: (agent: string) => `${agent}'s`,
      saved: "Saved.",
      failed: (status: number) => `Duva couldn't read the Screener settings (error ${status}). Try again in a moment.`,
      unreachable: "Duva couldn't be reached, so the Screener settings aren't shown. Check your connection and try again.",
      saveFailed: (status: number) => `Duva couldn't switch the Screener (error ${status}). Try again in a moment.`,
      saveUnreachable: "Duva couldn't be reached, so the Screener isn't switched. Check your connection and try again.",
    },
    preferencesSaved: "Saved. This applies from now on.",
    preferencesFailed: (status: number) => `Duva couldn't read your preferences (error ${status}). Try again in a moment.`,
    preferencesUnreachable: "Duva couldn't be reached, so your preferences aren't shown. Check your connection and try again.",
    preferencesSaveFailed: (status: number) => `Duva couldn't save your preferences (error ${status}). Try again in a moment.`,
    preferencesSaveUnreachable: "Duva couldn't be reached, so your preferences aren't saved. Check your connection and try again.",
  },

  domains: {
    title: "Domains",
    lead: "Admins add the domains the organization gets mail on, and choose where sign-in codes come from.",
    standalone: "Standalone domain",
    aliasOf: (domain: string) => `Alias of ${domain}`,
    verified: "Verified",
    verifiedForSending: "Verified for sending",
    waiting: "Waiting for DNS",
    missing: (count: number, receiving: boolean) => `${count === 1 ? "1 record" : `${count} records`} missing${receiving ? "" : ", so mail can't arrive yet"}`,
    signsIn: "Sign-in codes come from here",
    catchAllTo: (target: string) => `Catch-all to ${target}`,
    records: "DNS records",
    recordsLead: "Add these at the domain's DNS provider. SES checks them by itself, for up to 72 hours after the domain is added.",
    recordsVerifiedLead: "SES has verified the domain. Keep these records at its DNS provider.",
    name: "Name",
    value: "Value",
    copy: "Copy",
    copied: "Copied",
    copyWhat: (text: string) => `Copy ${text}`,
    copiedWhat: (text: string) => `Copied ${text}`,
    copyKeys: "The arrow keys, Home and End move between the Copy buttons.",
    /** A domain's line, from what it says of the domain. */
    summary: (parts: string[]) => `${parts.join(". ")}.`,
    namePlaceholder: "example.net",
    catchAllMailbox: (owner: string, address?: string) => (address === undefined ? owner : `${owner}, ${address}`),
    copyFailed: "The browser didn't allow copying. Select the text and copy it instead.",
    status: { missing: "Missing", found: "Found", verified: "Verified" },
    purpose: { receiving: "Receiving", DKIM: "DKIM", "MAIL FROM": "MAIL FROM", DMARC: "DMARC" },
    record: (purpose: string, type: string) => `${purpose}, ${type} record`,
    foundInstead: (values: string[]) => `DNS has ${values.join(", ")} instead.`,
    checkAgain: "Check again",
    checking: "Checking…",
    checked: "Checked. This is what DNS and SES answer now.",
    signIn: "Sign-in codes",
    signInHere: (domain: string) => `Sign-in codes come from no-reply@${domain}.`,
    signInElsewhere: (current: string) => `Sign-in codes come from no-reply@${current}.`,
    signInWaiting: (domain: string) => `Once SES has verified ${domain}, sign-in codes can come from it.`,
    sendSignIn: (domain: string) => `Send them from ${domain}`,
    signInChosen: (domain: string) => `Sign-in codes come from no-reply@${domain} from now on.`,
    catchAll: "Catch-all",
    catchAllLead: (domain: string, aliases: string[]) =>
      `Where mail goes to addresses on ${[domain, ...aliases].join(", ")} that the organization doesn't have, removed ones included.`,
    catchAllNone: "None. Such mail is refused",
    catchAllMailboxes: "Mailboxes",
    catchAllGroups: "Groups",
    catchAllAlias: (domain: string) => `It uses the catch-all of ${domain}, which it mirrors.`,
    catchAllSaved: "Saved. This applies to mail from now on.",
    remove: "Remove domain",
    removeAsk: (domains: string[]) =>
      domains.length === 1
        ? `Remove ${domains[0]}? Mail to its addresses is refused at once, and SES forgets the domain. The mail already in mailboxes stays.`
        : `Remove ${domains[0]} and its alias domains ${domains.slice(1).join(", ")}? Mail to their addresses is refused at once, and SES forgets the domains. The mail already in mailboxes stays.`,
    removeAddresses: "These addresses stop getting mail:",
    removeNoAddresses: "No address is on it.",
    removeLeftWithout: (mailboxes: string[]) =>
      `${mailboxes.join(", ")} ${mailboxes.length === 1 ? "is" : "are"} left without an address, and get${mailboxes.length === 1 ? "s" : ""} and send${mailboxes.length === 1 ? "s" : ""} no mail until given one.`,
    removeConfirm: "Remove",
    removed: (domains: string[]) => `Removed ${domains.join(", ")}.`,
    cancel: "Cancel",
    add: "Add a domain",
    addLead: "Duva asks SES for the domain, and shows the DNS records to add at its DNS provider.",
    domain: "Domain",
    kindStandalone: "Standalone",
    kindStandaloneHint: "Its addresses are its own.",
    kindAlias: "Alias",
    kindAliasHint: "It mirrors every address of a standalone domain, later ones too.",
    mirrors: "Mirrors",
    addButton: "Add domain",
    adding: "Adding…",
    added: (domain: string) => `Added ${domain}. Add its DNS records, below.`,
    failed: (status: number) => `Duva couldn't read the domains (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the domains aren't shown. Check your connection and try again.",
  },

  ownLogos: {
    title: "Logo",
    lead: (domain: string) =>
      `Receivers that honor BIMI show this logo beside mail from ${domain}. Duva converts it to SVG Tiny PS, square and with nothing in it that runs, and serves it at a public URL.`,
    none: "No logo yet.",
    upload: "Upload an SVG",
    replace: "Upload another SVG",
    uploading: "Uploading…",
    uploadHint: "An SVG file. A picture such as a PNG can't be a BIMI logo.",
    alt: (name: string) => `${name}'s logo`,
    set: "Logo set. Duva serves it now.",
    remove: "Remove logo",
    removing: "Removing…",
    removed: "Logo removed. Remove its BIMI record from DNS too.",
    record: "BIMI",
    recordLead: "Add this at the domain's DNS provider. It stays the same when the logo changes.",
    status: { missing: "Missing", found: "Found", matches: "Matches" },
    dmarc: (domain: string) =>
      `BIMI needs DMARC enforcement, and ${domain}'s DMARC policy doesn't enforce it, so receivers show no logo yet. Enforcing means p=quarantine or p=reject in its DMARC record. Receivers then put in spam, or refuse, every message from ${domain} that fails DMARC, from any mailbox and from any other service that sends as ${domain}, such as a newsletter tool. Check that each of those passes DMARC first.`,
    certificate: "Mark certificate",
    certificateLead: "Optional. Gmail and some others show a logo only with a VMC or CMC from a Mark Verifying Authority, which the record then gives.",
    certificateHosted: (url: string) => `Duva serves the certificate at ${url}, and checked that it vouches for this domain and this logo.`,
    certificateAt: (url: string) => `The record gives the certificate at ${url}.`,
    certificateUrl: "Certificate URL",
    attach: "Attach",
    attaching: "Attaching…",
    uploadPem: "Upload a PEM",
    attached: "Certificate attached. Update the record in DNS.",
    removeCertificate: "Remove certificate",
    certificateRemoved: "Certificate removed. Update the record in DNS.",
    selectors: "Mailboxes' own logos",
    selectorsLead: "Humans can set their own logo for their mailbox in Settings. Each needs its record on the domain too.",
    selectorRecord: (owner: string, selector: string) => `${owner}, selector ${selector}`,
    mine: "My logo",
    mineLead: "Your own logo, in place of the domain's on the mail you send. Only some receivers honor a mailbox's own logo, and others show the domain's.",
    mineOn: (address: string) => `On ${address}`,
    ask: (count: number) =>
      `Ask an admin to add ${count === 1 ? "this record" : "these records"} at the domain's DNS provider. Once DNS has the record for the domain you send from, Duva names your logo in your mail.`,
    domainRecord: (domain: string) => `BIMI on ${domain}`,
    failed: (status: number) => `Duva couldn't read the logo (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the logo isn't shown. Check your connection and try again.",
  },

  setup: {
    unreachable: "Duva couldn't be reached, so nothing changed. Check your connection and try again.",
    failed: (status: number) => `Duva couldn't make the change (error ${status}). Try again in a moment.`,
  },

  addresses: {
    title: "Addresses",
    lead: "Admins create the organization's mailboxes and give each its addresses, on any of the organization's standalone domains. They choose the one new mail goes from.",
    none: "No address. It gets and sends no mail until it has one.",
    /** A mailbox's title when it has no default address, with which of its owner's it is when they have several. */
    without: (at?: number) => (at === undefined ? "Without an address" : `Mailbox ${at}, without an address`),
    /** The line under a mailbox's title: its owner, which of theirs it is, and its other addresses, or that it has none. */
    line: ({ owner, agent, place, addresses }: { owner: string; agent: boolean; place?: { at: number; of: number }; addresses: number }) => {
      const parts = [agent ? `${owner}, an agent` : owner];
      if (place !== undefined) parts.push(`Mailbox ${place.at} of ${place.of}`);
      if (addresses === 0) parts.push("It gets and sends no mail until it has one");
      if (addresses > 1) parts.push(addresses === 2 ? "1 more address" : `${addresses - 1} more addresses`);
      return parts.length === 1 ? parts[0]! : `${parts.join(". ")}.`;
    },
    placeholder: (domain = "example.com") => `name@${domain}`,
    listName: (title: string) => `Addresses of ${title}`,
    default: "Default",
    defaultHint: "New mail goes from the default address. Replies go from the address the mail came to.",
    makeDefault: "Make default",
    makeDefaultOf: (address: string) => `Make ${address} the default`,
    defaultChosen: (address: string) => `New mail goes from ${address} from now on.`,
    remove: "Remove",
    removeWho: (address: string) => `Remove ${address}`,
    removeAsk: (address: string) => `Mail to ${address} is refused from now on, or goes to its domain's catch-all. The mail already here stays.`,
    removeAskDefault: (next: string) => `${next} becomes the default address.`,
    removeAskLast: "The mailbox is left without an address, and gets and sends no mail until it has one.",
    removeAskGroups: (groups: string[]) =>
      `It leaves the ${groups.length === 1 ? "group" : "groups"} ${list(groups)}.`,
    removed: (address: string) => `Removed ${address}.`,
    cancel: "Cancel",
    newAddress: "New address",
    newAddressHint: (domains: string[]) =>
      `On ${domains.length > 1 ? `${domains.slice(0, -1).join(", ")} or ${domains.at(-1)}` : domains.join("")}. Mail to the same name on alias domains reaches it too.`,
    add: "Add address",
    adding: "Adding…",
    added: (address: string) => `Added ${address}.`,
    addMailbox: "Add a mailbox",
    addMailboxLead: "For a human or an agent, with its first address, which becomes its default. Its line opens to add more.",
    owner: "For",
    chooseOwner: "Choose a human or an agent",
    humans: "Humans",
    agents: "Agents",
    agentWithSponsor: (name: string, sponsor?: string) => (sponsor === undefined ? name : `${name}, ${sponsor}'s agent`),
    address: "Address",
    addMailboxButton: "Add mailbox",
    addedMailbox: (owner: string, address: string) => `Added a mailbox for ${owner} at ${address}.`,
    failed: (status: number) => `Duva couldn't read the mailboxes (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the mailboxes aren't shown. Check your connection and try again.",
  },

  people: {
    title: "People",
    lead: "Admins add and remove the organization's humans, and choose who else is an admin. Removing a human removes the agents they sponsor.",
    you: "You",
    admin: "Admin",
    mailboxes: (count: number) => (count === 0 ? "No mailbox" : count === 1 ? "1 mailbox" : `${count} mailboxes`),
    agents: (count: number) => (count === 0 ? "No agents" : count === 1 ? "1 agent" : `${count} agents`),
    summary: (parts: string[]) => `${parts.join(". ")}.`,
    adminLead: "An admin changes the organization's setup: domains, addresses, groups, people and settings. Admins can't read anyone's mail.",
    lastAdmin: "The organization's only admin. Make another human an admin before taking it away or removing them.",
    makeAdmin: "Make admin",
    takeAdmin: "Take admin away",
    madeAdmin: (email: string) => `${email} is an admin now.`,
    tookAdmin: (email: string) => `${email} isn't an admin now.`,
    mailboxesTitle: "Mailboxes",
    mailboxesOf: (email: string) => `Mailboxes of ${email}`,
    noMailbox: "No mailbox yet.",
    giveMailbox: "Give them a mailbox",
    giveAgentMailbox: "Give it a mailbox",
    giveMailboxWho: (name: string) => `Give ${name} a mailbox`,
    mailboxWithout: (ordinal: number) => `Mailbox ${ordinal}, without an address`,
    moreAddresses: (count: number) => (count === 1 ? "and 1 more address" : `and ${count} more addresses`),
    agentsTitle: "Agents",
    agentsOf: (email: string) => `Agents ${email} sponsors`,
    noAgents: "They sponsor no agents.",
    agentNoMailbox: "No mailbox",
    paused: "Paused",
    remove: "Remove",
    removeAgentWho: (name: string) => `Remove ${name}`,
    removeAgentAsk: (name: string, addresses: string[]) =>
      addresses.length === 0
        ? `${name}'s key stops working. This can't be undone.`
        : `${name}'s key stops working, and its ${addresses.length === 1 ? "mailbox" : "mailboxes"} ${list(addresses)} ${addresses.length === 1 ? "is" : "are"} erased with ${addresses.length === 1 ? "its" : "their"} mail. This can't be undone.`,
    removeAgent: "Remove agent",
    removedAgent: (name: string) => `Removed ${name}.`,
    removeHuman: "Remove human",
    removeHumanWho: (email: string) => `Remove ${email}`,
    removeHumanAsk: (email: string) => `${email} can't sign in from now on.`,
    removeMailboxesLead: "Say what happens to each of their mailboxes. One handed over becomes another mailbox of the human you choose, with its addresses and mail.",
    handOver: "Hand over",
    handOverHint: "With its addresses and mail.",
    deleteMailbox: "Delete",
    deleteMailboxHint: "Erased with its mail.",
    handTo: "Hand over to",
    noOneToHandTo: "No other human can take a mailbox, so each is deleted.",
    erased: (names: string[]) => `${list(names)} ${names.length === 1 ? "is" : "are"} erased with ${names.length === 1 ? "its" : "their"} mail. This can't be undone.`,
    agentsGo: (agents: { name: string; addresses: string[] }[]) => {
      const named = list(agents.map(({ name }) => name));
      const addresses = agents.flatMap((agent) => agent.addresses);
      const removed = agents.length === 1 ? `${named}, the agent they sponsor, is removed too` : `${named}, the agents they sponsor, are removed too`;
      return addresses.length === 0
        ? `${removed}.`
        : `${removed}, and ${addresses.length === 1 ? "its mailbox" : "their mailboxes"} ${list(addresses)} erased with ${addresses.length === 1 ? "its" : "their"} mail.`;
    },
    removedHuman: (email: string, handTo: string | undefined, handedOver: string[]) =>
      handTo === undefined || handedOver.length === 0 ? `Removed ${email}.` : `Removed ${email}. ${handTo} has ${list(handedOver)} now.`,
    cancel: "Cancel",
    add: "Add a human",
    addLead: "They sign in with a code emailed to this address, and get no mailbox until an admin gives them one.",
    email: "Email address",
    emailPlaceholder: "name@example.com",
    addButton: "Add human",
    adding: "Adding…",
    added: (email: string) => `Added ${email}. They sign in with a code emailed there.`,
    failed: (status: number) => `Duva couldn't read the organization's people (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the organization's people aren't shown. Check your connection and try again.",
  },

  groups: {
    title: "Groups",
    lead: "Admins create groups, addresses whose mail every member gets a copy of. Members in the organization can send as the group.",
    none: "No groups yet.",
    summary: (members: number, policy: string) => `${members === 0 ? "No members" : members === 1 ? "1 member" : `${members} members`}. ${policy}`,
    policySummary: { anyone: "Anyone can send to it.", organization: "Only the organization can send to it.", members: "Only its members can send to it." },
    membersTitle: "Members",
    membersOf: (group: string) => `Members of ${group}`,
    noMembers: "No members. Mail to the group reaches no one until it has some.",
    memberOf: {
      human: (email: string) => `${email}'s mailbox`,
      agent: (name: string) => `${name}'s mailbox, an agent`,
      group: "A group",
      external: "External address",
    },
    removeMember: "Remove",
    removeMemberWho: (address: string) => `Remove ${address} from the group`,
    removedMember: (address: string) => `Removed ${address}. It gets no copies from now on.`,
    newMember: "New member",
    newMemberHint: "An address of the organization, of a mailbox or another group, or anyone's elsewhere.",
    addMember: "Add member",
    alreadyMember: (address: string) => `${address} is already a member.`,
    adding: "Adding…",
    addedMember: (address: string) => `Added ${address}. It gets a copy of the group's mail from now on.`,
    sendPolicy: {
      legend: "Who can send to it",
      lead: "Mail from anyone else is bounced. A member's mail counts from any address of their mailbox.",
      anyone: "Anyone",
      anyoneHint: "Everyone, inside the organization and out. This is the default.",
      organization: "The organization",
      organizationHint: "Only senders on the organization's domains.",
      members: "Its members",
      membersHint: "Only the group's members, and its nested groups' members.",
    },
    replyTo: {
      legend: "Where external members' replies go",
      lead: "External members get each message re-sent from the group.",
      sender: "To the sender",
      senderHint: "Replies reach whoever wrote to the group. This is the default.",
      group: "To the group",
      groupHint: "Replies come back to the group, so every member sees them.",
    },
    save: "Save",
    saving: "Saving…",
    saved: "Saved. This applies to mail that arrives from now on.",
    delete: "Delete group",
    deleteWho: (address: string) => `Delete ${address}`,
    deleteAsk: (address: string) => `Mail to ${address} is refused from now on, or goes to its domain's catch-all. The copies members got stay theirs.`,
    deleted: (address: string) => `Deleted ${address}.`,
    cancel: "Cancel",
    create: "Add a group",
    createLead: "Give it an address on a standalone domain, and its first members. Choose who can send to it once it exists.",
    address: "Address",
    addressPlaceholder: (domain = "example.com") => `team@${domain}`,
    members: "Members",
    membersHint: "Separate addresses with commas.",
    createButton: "Add group",
    creating: "Adding…",
    created: (address: string, anyone: boolean) => (anyone ? `Added ${address}. Anyone can send to it until you choose otherwise.` : `Added ${address}.`),
    failed: (status: number) => `Duva couldn't read the groups (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the groups aren't shown. Check your connection and try again.",
  },

  screener: {
    title: "Screener",
    agentTitle: (agent: string) => `${agent}'s Screener`,
    waiting: (count: number) => (count === 1 ? ", 1 sender waiting" : `, ${count} senders waiting`),
    lead: "Mail from senders you haven't decided on or written to waits here, out of the Inbox and the unread counts, until you choose where their mail goes.",
    off: "The Screener is off, so mail from first-time senders goes to the Inbox.",
    switchOn: "Switch it on in Settings",
    senders: "Waiting senders",
    mailFrom: (sender: string) => `Mail from ${sender}`,
    screened: "Screened senders",
    screenedCounts: (decided: number) => (decided === 1 ? "1 decided" : `${decided} decided`),
    sendTo: (sender: string) => `Send mail from ${sender} to`,
    more: "More…",
    moreFor: (sender: string) => `More choices for ${sender}`,
    nowhereAsk: (count: number) => `This erases ${count === 1 ? "their waiting thread" : `their ${count} waiting threads`} for good and drops their later mail. This can't be undone.`,
    cancel: "Cancel",
    emptyTitle: "No one is waiting",
    emptyLead: "Mail from first-time senders waits here. This page checks for new mail by itself, so there's no need to reload it.",
    failed: (status: number) => `Duva couldn't read the Screener (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the Screener isn't shown. Check your connection and try again.",
    decideFailed: (status: number) => `Duva couldn't save the decision (error ${status}). Try again in a moment.`,
    decideUnreachable: "Duva couldn't be reached, so the decision isn't saved. Check your connection and try again.",
    /** Who a decision is on: an address, or everyone at a domain. */
    who: (sender: { address?: string; domain?: string }) => sender.address ?? `everyone at ${sender.domain}`,
    unsubscribe: {
      unsubscribed: "Unsubscribed from their mail.",
      noMail: "There's no mail from them to unsubscribe from.",
      spam: "Their mail was judged to be spam, so Duva sent no unsubscribe.",
      noOneClick: "Their mail offers no one-click unsubscribe, so Duva sent none.",
      notSigned: "Their unsubscribe isn't signed by a DKIM signature that passed, so Duva sent none.",
      failed: (why: string) => `Duva couldn't unsubscribe: ${why}`,
      notAllowed: "their link isn't http or https on a usual port.",
      notPublic: "their link isn't on the public internet.",
      unreachable: "their server couldn't be reached.",
      timedOut: "their server didn't answer in time.",
      refused: (status?: number) => (status === undefined ? "their server refused." : `their server refused (error ${status}).`),
      tooManyRedirects: "their server redirected too many times.",
    },
  },

  screened: {
    title: "Screened senders",
    agentTitle: (agent: string) => `${agent}'s screened senders`,
    back: "Screener",
    lead: "The addresses and domains you decided on, by where their mail goes. A decision on an address beats one on its domain. Open one to change it.",
    find: "Find a sender",
    groups: { inbox: "Inbox", feed: "Feed", paperTrail: "Paper Trail", label: "Labels", nowhere: "Nowhere" },
    none: "None.",
    noneFound: "No screened sender matches.",
    everyoneAt: (domain: string) => `Everyone at ${domain}`,
    decided: "Decided",
    by: (who: string) => `by ${who}`,
    you: "you",
    remove: "Remove",
    removed: (who: string, moved: number) => (moved === 0 ? `Removed ${who}. They're first-time senders again.` : `Removed ${who}. They're first-time senders again. Moved ${threads(moved)} to the Inbox.`),
    failed: (status: number) => `Duva couldn't list the screened senders (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the screened senders aren't listed. Check your connection and try again.",
  },

  access: {
    loading: "Reading the access request…",
    title: (agent: string) => `${agent} asks for access`,
    lead: "An agent asks to work in your mail. Approve it only if you started it, and the code below is the one it shows you. You become its sponsor, and you can pause it, change what it may do or remove it at any time.",
    code: "Code",
    from: "Asked from",
    fromHost: (address: string, host: string) => `${address}, on a computer it calls ${host}`,
    expires: "Works until",
    nameLegend: "Its name",
    mailboxes: "Your mailboxes",
    mailboxesLead: "The mailboxes it may work in. It can't reach any other.",
    noMailboxes: "You have no mailbox, so it gets no access until an admin creates one for you.",
    asked: "It asked for this one.",
    notAsked: "It didn't ask for this one.",
    accessLegend: "What it may do",
    accessLead: (wants: string) => `It asked to ${{ read: "read", organize: "organize", draft: "draft", send: "send" }[wants] ?? wants}. Each choice can do all the one above it does. Only you empty your Trash.`,
    accesses: { read: "Read", organize: "Organize", draft: "Draft", onBehalf: "Send on your behalf", asYou: "Send as you" } satisfies Record<string, string>,
    hints: {
      read: "It reads everything there: threads, labels, drafts and attachments. It changes nothing.",
      organize: "It also labels and archives threads, screens senders, sets threads aside and moves them to Trash and back.",
      draft: "It also writes and changes drafts there, which you send.",
      onBehalf: (agent: string, sponsor: string) => `It also sends from your mailbox, and its mail ends with "Sent by ${agent} for ${sponsor}".`,
      asYou: "It also sends from your mailbox, as if you wrote it, with no visible line. A header still names it, for software.",
    },
    sendsLegend: "When it sends",
    cantSend: "With this access it can't send. These apply if you let it send later.",
    approval: "Your approval before it sends",
    approvalHint: "Its sends wait for you in Approvals. Off, they go out at once.",
    line: (agent: string, sponsor: string) => `Its mail ends with the line "Sent by ${agent} for ${sponsor}", and a header says so too, for software.`,
    noLine: "Its mail carries no visible line. A header still says an agent sent it, for software.",
    approve: "Approve",
    approving: "Approving…",
    decline: "Decline",
    declining: "Declining…",
    approved: (agent: string) => `${agent} has access`,
    approvedLead: "It collects its key by itself in a few seconds. It's in Your agents, where you pause it, change what it may do, rotate its key or remove it.",
    toAgent: (agent: string) => `${agent} in Your agents`,
    declined: (agent: string) => `${agent} gets no access`,
    declinedLead: "The agent is told you declined. Nothing else changed.",
    unusable: "This access request can't be used",
    gone: "No access request waits with this code. A code works for 10 minutes and once, so ask the agent to ask again.",
    tooMany: "You gave too many codes that no access request waits with. Wait 10 minutes and open the link again.",
    notYours: "Only humans approve access requests.",
    failed: (status: number) => `Duva couldn't read the access request (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the access request isn't shown. Check your connection and try again.",
  },

  agentSettings: {
    hosted: {
      in: (address: string) => `Your mailbox agent in ${address}, which Duva runs for you.`,
      ask: "Ask it",
    },
    title: "Your agents",
    lead: "You choose these for each agent you sponsor.",
    access: {
      legend: "Access to your mailbox",
      lead: "What the agent may do in your personal mailbox. Each choice can do all the one above it does.",
      none: "None",
      read: "Read",
      organize: "Organize",
      draft: "Draft",
      send: "Send",
      hints: {
        none: "It can't see your mailbox. This is the default.",
        read: "It reads everything there: threads, labels, drafts and attachments. It changes nothing.",
        organize: "It also labels and archives threads, screens senders, sets threads aside and moves them to Trash and back.",
        draft: "It also writes and changes drafts there, which you send.",
        send: "It also sends as you, from your mailbox. Only you empty Trash.",
      },
      lowering: "Saving withdraws its sends as you that wait for your approval. Its drafts stay in your mailbox.",
      mailboxes: "Which of your mailboxes",
      mailboxesLead: "Its access covers the mailboxes chosen here, and no other.",
    },
    key: {
      title: "Key",
      lead: "The agent calls Duva with its key. Rotating it gives a new one and stops the old one at once.",
      rotate: "Rotate key",
      rotating: "Rotating…",
      newKey: "Its new key",
      shownOnce: "Duva shows it only now. Give it to the agent, which uses it in place of the old one.",
      failed: (status: number) => `Duva couldn't rotate its key (error ${status}). Try again in a moment.`,
      unreachable: "Duva couldn't be reached, so its key is as it was. Check your connection and try again.",
    },
    remove: {
      title: "Remove",
      lead: "Removing it stops its key at once. Its drafts and sends in your mailbox stay.",
      remove: "Remove",
      who: (name: string) => `Remove ${name}`,
      ask: (name: string) => `${name}'s key stops working, and any mailbox of its own is erased with its mail. This can't be undone.`,
      confirm: "Remove agent",
      removing: "Removing…",
      cancel: "Cancel",
      failed: (status: number) => `Duva couldn't remove it (error ${status}). Try again in a moment.`,
      unreachable: "Duva couldn't be reached, so nothing changed. Check your connection and try again.",
    },
    asSponsor: {
      legend: "When it sends as you",
      approval: "Your approval before it sends as you",
      approvalHint: "Its sends from your mailbox wait for you in Approvals. Off, they go out at once.",
    },
    ownMailbox: {
      legend: "When it sends from its own mailbox",
      approval: "Your approval before it sends from its own mailbox",
      approvalHint: "Its sends wait for you in Approvals. Off, they go out at once.",
    },
    setup: {
      legend: "When it changes the setup",
      approval: "Your approval before it changes the setup",
      approvalHint: "Its changes to domains, addresses, groups and settings wait for you in Approvals. Off, Duva makes them at once.",
    },
    summary: {
      access: {
        none: "No access to your mailbox.",
        read: "Reads your mailbox.",
        organize: "Organizes your mailbox.",
        draft: "Drafts in your mailbox.",
        send: "Sends from your mailbox.",
      },
      allWait: "Its sends wait for your approval.",
      noneWait: "Its sends go out without your approval.",
      ownWait: "Its sends from its own mailbox wait for your approval.",
      asSponsorWait: "Its sends as you wait for your approval.",
      allAndSetupWait: "Its sends and setup changes wait for your approval.",
      setupWaits: "Its setup changes wait for your approval.",
      setupGoes: "Its setup changes go through without your approval.",
    },
    line: "Add a line saying an agent sent it",
    lineHint: (agent: string, sponsor: string) => `The text ends with "Sent by ${agent} for ${sponsor}". A header always says so too, for software.`,
    saved: "Saved. This applies at once.",
    savedLowered: "Saved. Its sends waiting as you are withdrawn, and its drafts stay.",
    noMailbox: "Duva can save this once you or the agent has a mailbox. Ask an admin to create one.",
    limits: {
      legend: "Send limits",
      lead: "How much it may send. A send over a limit waits, and goes out by itself as the limit allows.",
      perHour: "Sends an hour",
      newPerDay: "New recipients a day",
      newPerDayHint: "Addresses it hasn't sent to before.",
      upTo: (cap: number) => `Up to ${cap}, the organization's cap.`,
      invalid: (cap: number) => `Give a whole number from 1 to ${cap}.`,
    },
    admin: {
      title: "Admin",
      mark: "Admin",
      isNot: "An agent admin may change the organization's setup: domains, addresses, groups and settings. It never removes humans or agents, or changes who is an admin.",
      is: "It may change the organization's setup. Taking this away withdraws its setup changes that wait for you.",
      onlyAdmins: "Only an admin can make an agent an admin. An agent admin may change the organization's setup.",
      make: "Make it an admin",
      making: "Making it an admin…",
      takeAway: "Take admin away",
      takingAway: "Taking admin away…",
      failed: (status: number) => `Duva couldn't change whether it is an admin (error ${status}). Try again in a moment.`,
      unreachable: "Duva couldn't be reached, so nothing changed. Check your connection and try again.",
    },
    pause: {
      title: "Running or paused",
      mark: "Paused",
      pause: "Pause",
      unpause: "Unpause",
      pausing: "Pausing…",
      unpausing: "Unpausing…",
      running: "Pausing refuses its key at once and holds its approved sends until you unpause it. Mail to it keeps arriving.",
      held: "Its key is refused, and its approved sends are held. Unpausing sends them, oldest first, so look at them first.",
      by: (who: string, when: string) => `Paused by ${who} since ${when}.`,
      /** An agent's line while it runs, with how many more its send limits let it send this hour, when Duva says. */
      runningLine: (left?: number) => (left === undefined ? "Running." : `Running, ${left === 1 ? "1 send" : `${left} sends`} left this hour.`),
      you: "you",
      duva: "Duva",
      anAdmin: "an admin",
      failed: (status: number) => `Duva couldn't change the pause (error ${status}). Try again in a moment.`,
      unreachable: "Duva couldn't be reached, so nothing changed. Check your connection and try again.",
    },
    waiting: {
      title: "Waiting for the send limit",
      lead: "These go out by themselves, oldest first, as its limits allow. Send now sends one past them, and it still counts.",
      held: (agent: string) => `Held until you unpause ${agent}.`,
      count: (count: number) => (count === 1 ? "1 send waits for the send limit." : `${count} sends wait for the send limit.`),
      to: (recipients: string) => `To ${recipients}`,
      noSubject: "(no subject)",
    },
    failed: (status: number) => `Duva couldn't read your agents' settings (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so your agents' settings aren't shown. Check your connection and try again.",
    saveUnreachable: "Duva couldn't be reached, so the settings aren't saved. Check your connection and try again.",
  },

  activity: {
    link: "Activity",
    title: (agent: string) => `${agent}'s activity`,
    lead: (timeZone: string) => `What it did each day, the last 30 days, newest first. Days run midnight to midnight in ${timeZone} time.`,
    days: "Days",
    counted: (counts: string[]) => (counts.length === 0 ? "nothing counted" : counts.join(", ")),
    /** How a summary says a kind's count, its number first. */
    counts: {
      sent: (count: number) => `${count} sent`,
      approved: (count: number) => `${count} approved`,
      rejected: (count: number) => `${count} rejected`,
      received: (count: number) => `${count} received`,
      organized: (count: number) => `${count} organized`,
      screened: (count: number) => `${count} screened`,
      alerts: (count: number) => (count === 1 ? "1 alert" : `${count} alerts`),
    },
    nothing: "Nothing counted",
    dayLabel: (day: string, counted: string) => `${day}: ${counted}`,
    timeline: "Timeline",
    dayLead: (agent: string, timeZone: string) => `Everything ${agent} did and what happened in its mailboxes, newest first, in ${timeZone} time.`,
    empty: "Nothing happened that day.",
    more: "Show more",
    loadingMore: "Loading more…",
    noSubject: "(no subject)",
    threadGone: "The thread is no longer there.",
    openThread: "Open the thread",
    failed: (status: number) => `Duva couldn't read the activity (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so the activity isn't shown. Check your connection and try again.",
    you: "You",
    duva: "Duva",
    someone: "Someone else",
    /** What a change in the timeline says, `who` being who made it and `agent` the agent's name. */
    entry: (change: ActivityChange, who: string, agent: string, message?: EntryMessage) => entrySaid(change, who, agent, message),
    /** A thread's link names the entry it is for, since one thread can be the subject of many. */
    threadLabel: (subject: string, time: string, said: string) => `${subject}. ${time}: ${said}`,
    /** Days with nothing counted, folded into one line, from the oldest to the newest. */
    quietDays: (from: string, to: string) => `${from} to ${to}`,
    quietLabel: (from: string, to: string) => `${from} to ${to}, nothing counted`,
    /** What the reading pane beside the days says while no day is open. */
    pickTitle: "No day open",
    pickLead: (agent: string) => `Open a day to see its timeline: everything ${agent} did, and what happened in its mailboxes.`,
  },

  sendNow: {
    send: "Send now",
    sending: "Sending…",
    sent: "Sent.",
    gone: "It isn't waiting any more. It may have gone out by itself.",
    failed: (status: number) => `Duva couldn't send it now (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so nothing was sent. Check your connection and try again.",
  },

  alerts: {
    title: "Alerts",
    unseen: (count: number) => `${count} unseen`,
    kinds: {
      sendFailed: "Send failed",
      bounced: "Bounced",
      complained: "Complaint",
      limitReached: "Send limit reached",
      pausedBy: "Paused",
      limitsChangedBy: "Limits changed",
      removedBy: "Removed",
      keyUsedWhilePaused: "Key used while paused",
      autoPaused: "Paused by Duva",
      spendCapReached: "Spend cap reached",
      taskFailed: "Task failed",
    },
    urgent: "Urgent",
    unseenMark: "Unseen",
    openMessage: "Open the message",
    openDraft: "Open the draft",
    openAgent: (agent: string) => `Open ${agent}`,
    openAtPause: (agent: string) => `Open ${agent} at Pause`,
    heldSends: "See the held sends",
    markSeen: "Mark as seen",
    markAllSeen: "Mark all as seen",
    more: "More alerts",
    emptyTitle: "No alerts",
    emptyLead: "When an agent you sponsor needs you, it shows here: a send that failed, bounced or drew a complaint, its send limit reached, or a pause by someone else. Urgent ones are also mailed to you.",
    failed: (status: number) => `Duva couldn't list your alerts (error ${status}). Try again in a moment.`,
    unreachable: "Duva couldn't be reached, so your alerts aren't listed. Check your connection and try again.",
    seeFailed: "Duva couldn't mark it seen. Try again in a moment.",
    back: "All alerts",
  },

  approvals: {
    title: "Approvals",
    waiting: (count: number) => (count === 1 ? "1 waiting" : `${count} waiting`),
    noneWaiting: "Nothing is waiting for you",
    emptyLead: "When an agent you sponsor asks to send mail, or an agent admin asks to change the setup, it appears here. You approve it, edit a draft first, or reject it with a note.",
    emptyPolling: "This page checks for new requests by itself, so there's no need to reload it.",
    noneToDecide: "Nothing waits for your decision",
    limitTitle: "Waiting for the send limit",
    limitLead: "Approved. Each goes out by itself, oldest first, when its agent's send limit allows, or now if you send it.",
    heldTitle: (agent: string) => `Held while ${agent} is paused`,
    heldLead: (agent: string) => `Approved. Unpausing ${agent} sends these, oldest first, so look at them before you do.`,
    to: (addresses: string) => `To ${addresses}`,
    show: "Show",
    chips: { all: "All", send: "Sends", setup: "Setup changes", held: "Held" },
    kinds: { send: "Send", setup: "Setup", held: "Held" },
    back: "All approvals",
    lists: "Which list",
    waitingList: "Waiting",
    logList: "Log",
  },

  log: {
    title: "Approval log",
    lead: "Every decision on your agents' sends, newest first, with what became of it.",
    empty: "No decisions yet",
    emptyLead: "When you send or reject what an agent asks to send, the decision is logged here, with how it went.",
    more: "Show older decisions",
    loading: "Reading older decisions…",
    readFailed: "Duva couldn't read the log. It tries again with the next update.",
    back: "The whole log",
    pick: "Choose a decision to read it here.",
    outcomes: { approved: "Approved", sent: "Sent", failed: "Failed", unclear: "Unclear", rejected: "Rejected" },
    headline: (outcome: "approved" | "sent" | "failed" | "unclear" | "rejected", by: string) => (outcome === "rejected" ? `${by} rejected` : `${by} approved`),
    you: "You",
    someone: "Someone",
    decidedAt: (time: string) => `Decided ${time}`,
    to: (addresses: string) => `To ${addresses}`,
    cc: "Cc",
    approved: (agent: string) => `On its way. It goes out once the undo window is over, or when ${agent}'s send limits allow, and is held while ${agent} is paused.`,
    undoable: "It waits for the undo window before it goes out. Undo puts it back among the requests that wait for you.",
    sent: "Sent. Mail that went out stays sent. If something in it was wrong, write a correction to its recipients.",
    failed: (agent: string) => `Not sent. ${agent} can revise the draft and ask again.`,
    unclear: "Sending stopped before Amazon SES answered, so Duva can't tell whether it went out. Check with the recipients.",
    rejected: (agent: string) => `Nothing was sent. ${agent} sees your note.`,
    note: (note: string) => `Your note: “${note}”`,
    reason: (reason: string) => `Amazon SES said: ${reason}`,
    afterAll: (agent: string) => `The draft is still as ${agent} asked it, so you can send it after all.`,
    movedOn: (agent: string) => `${agent} has changed the draft or asked again since, so any new request waits for you.`,
    sendAfterAll: "Send after all",
    sendingAfterAll: "Sending…",
    correction: "Write a correction",
    correcting: "Starting the draft…",
    noMailbox: "A correction goes from your own mailbox, and you have none. Ask an admin for one.",
    openThread: "Open the thread",
    decideFailed: (status: number) => `Duva answered ${status}. Try again.`,
    unreachable: "Duva couldn't be reached. Check your connection and try again.",
    changedMeanwhile: "This changed meanwhile, so the log shows it as it is now.",
  },

  undo: {
    undo: "Undo",
    undoing: "Undoing…",
    left: (seconds: number) => (seconds === 1 ? "1 second left" : `${seconds} seconds left`),
    undone: "Undone. It waits for you again.",
    tooLate: "Too late to undo: the undo window is over. A send held after it stays approved.",
  },

  setupGalley: {
    asks: (agent: string) => `${agent} asks to change the setup`,
    call: "The call it made",
    command: "Command",
    yourMailbox: (address: string) => `Your mailbox, ${address}`,
    mailboxOf: (owner: string, address: string) => `${owner}'s mailbox, ${address}`,
    noAddress: "without an address",
    preview: "What it would do",
    previewHint: (agent: string) => `Duva works this out from the setup as it is now. Approving makes the change as ${agent}.`,
    previewChanged: (agent: string) => `The setup changed since ${agent} asked, so the change would now do what is shown. Read it again, then approve.`,
    approve: "Approve",
    approving: "Approving…",
    approved: "You approved it",
    slipSubject: (agent: string) => `${agent}'s setup change`,
    made: (agent: string) => `Made as ${agent} asked.`,
    notMade: (reason: string) => `Duva couldn't make it: ${reason}`,
    unchanged: (agent: string) => `Nothing changed. ${agent} sees your note.`,
    withdrawn: (agent: string) => `${agent} stopped being an admin, so its change was withdrawn.`,
  },

  galley: {
    asks: (agent: string) => `${agent} asks to send`,
    askedAt: (time: string) => `Asked ${time}`,
    anAgent: "An agent",
    isNew: "New",
    original: "The message it answers",
    noOriginal: "This draft starts a new thread.",
    forward: "A forward. The draft quotes the message it forwards, and carries its attachments.",
    originalGone: "A reply. The message it answers is no longer in the mailbox.",
    draft: (agent: string) => `Draft by ${agent}`,
    yourVersion: "Your version",
    changed: (fields: string[]) => (fields.length === 0 ? "No changes yet. Sending now sends the draft as written." : `You changed ${list(fields)}.`),
    fieldNames: { to: "the recipients", subject: "the subject", text: "the text" },
    from: "From",
    to: "To",
    cc: "Cc",
    bcc: "Bcc",
    subject: "Subject",
    date: "Date",
    whenSent: "When you send it",
    noSubject: "(no subject)",
    attachments: (count: number) => (count === 1 ? "1 attachment, not shown" : `${count} attachments, not shown`),
    showAll: "Show the whole message",
    showLess: "Show less",
    disclosure: (agent: string, sponsor: string) => `Sent by ${agent} for ${sponsor}`,
    disclosureNote: "Duva adds this line, so recipients can tell an agent wrote it.",
    noDisclosureLine: (agent: string) => `Duva adds no line to it, as you chose for ${agent}. A header still tells recipients' software that an agent wrote it.`,
    asYou: (address: string) => `As you, from ${address}`,
    fromOwnMailbox: (address: string) => `From its own mailbox, ${address}`,
  },

  decide: {
    send: "Send",
    edit: "Edit",
    reject: "Reject",
    cancel: "Cancel",
    sendEdited: "Send your version",
    toHint: "Separate addresses with commas.",
    rejectWith: "Reject with note",
    note: (agent: string) => `Note for ${agent}`,
    noteHint: (agent: string) => `Say what ${agent} should change. ${agent} sees this note and can ask again.`,
    noteMissing: (agent: string) => `Write a note, so ${agent} knows what to change.`,
    sending: "Sending…",
    rejecting: "Rejecting…",
    unreachable: "Duva couldn't be reached, so nothing was decided. Try again.",
    gone: "This approval no longer exists. Reload the page to see what is waiting.",
    notYours: "Only the agent's sponsor can decide this approval.",
    failed: (status: number) => `Duva couldn't take the decision (error ${status}), so nothing was decided. Try again in a moment.`,
  },

  outcome: {
    sentAsIs: "You approved it as written",
    sentEdited: "You approved your version",
    rejected: "You rejected it",
    elsewhere: "You already decided this elsewhere",
    withdrawnHead: "Withdrawn",
    noLongerWaiting: "No longer waiting",
    note: (note: string) => `Your note: “${note}”`,
    noteFrom: (note: string) => `The note: “${note}”`,
    checking: "Checking how the send went…",
    approved: "Approved. Duva sends it in a moment.",
    undoWindow: "Approved. It goes out once the undo window is over, unless you undo it.",
    sending: "Sending…",
    waitingForLimit: (agent: string) => `Approved. It waits for ${agent}'s send limit, and goes out by itself when the limit allows.`,
    sent: "Sent.",
    failed: (agent: string) => `Not sent. Amazon SES refused it, for the reason below. ${agent} can revise the draft and ask again. If the reason is about the recipients or the deployment, ask your admin.`,
    sesSaid: (reason: string) => `Amazon SES said: ${reason}`,
    unclear: "Sending stopped before Amazon SES answered, so Duva can't tell whether it went out. Duva won't send it again. Check with the recipients.",
    withdrawn: (agent: string) => `${agent} changed the draft, so this request was withdrawn. If ${agent} asks again, the new draft appears here.`,
    rejectedElsewhere: (agent: string) => `Rejected. ${agent} can revise the draft and ask again.`,
    askedAgain: (agent: string) => `${agent} has since asked again with a revised draft.`,
    unknown: "Duva couldn't read how it went. It checks again with the next update.",
  },
};

/** The message a timeline's entry is about, once its thread is read: who wrote it, to whom, and the mailbox's address it reached or left from. */
export type EntryMessage = { from: string; to: string[]; recipient: string };

/**
 * What a change in an agent's timeline says, as who did it and the rest of the sentence, which
 * follows them directly. Each names its actor: the agent, a human, Duva, Amazon SES, or the sender
 * of mail that arrived, "Someone" until its thread is read. For an admin who isn't the sponsor,
 * Duva leaves out what the mail says, as names, notes and addresses, so the sentence does too.
 */
function entrySaid(change: ActivityChange, who: string, agent: string, message?: EntryMessage): [by: string, rest: string] {
  const sender = (screened: { address?: string; domain?: string }) => screened.address ?? (screened.domain === undefined ? "a sender" : `everyone at ${screened.domain}`);
  // "Hermes's message", "your message".
  const whose = who === strings.activity.you ? "your" : `${who}'s`;
  switch (change.type) {
    case "messageReceived": {
      // Until the thread is read, or once it is gone, the sender is "Someone".
      const from = message?.from ?? "Someone";
      const wrote = ` wrote to ${message?.recipient ?? agent}`;
      if (change.spam) return [from, `${wrote}, and it went to Spam.`];
      if (change.screened === "waiting") return [from, `${wrote}, and it waits in the Screener.`];
      if (change.screened === "blocked") return [from, `, a blocked sender,${wrote}, so it went to Trash.`];
      if (change.delivered === "feed") return [from, `${wrote}, and it went to the Feed.`];
      if (change.delivered === "paperTrail") return [from, `${wrote}, and it went to the Paper Trail.`];
      if (change.delivered === "label") return [from, `${wrote}, and it was filed under a label.`];
      return [from, `${wrote}.`];
    }
    case "messageDropped":
      return ["Duva", ` dropped a message from ${change.address ?? "a sender whose mail goes nowhere"}.`];
    case "draftWritten":
      return [who, ` started a draft.`];
    case "draftChanged":
      return [who, ` changed a draft.`];
    case "draftDeleted":
      return [who, ` deleted a draft.`];
    case "sendAsked":
      return [who, ` sent a draft.`];
    case "approvalAsked":
      return [who, ` asked for approval to send.`];
    case "approvalWithdrawn":
      return ["Duva", ` withdrew ${agent}'s request for approval.`];
    case "approvalUndone":
      return [who, ` undid the approval of ${agent}'s send, so it waits again.`];
    case "approvalDecided": {
      if (change.decision === "rejected") return change.note === undefined ? [who, ` rejected ${agent}'s send.`] : [who, ` rejected ${agent}'s send: “${change.note}”`];
      const edited = change.edits === undefined ? [] : Object.keys(change.edits).map((field) => ({ to: "the recipients", subject: "the subject", text: "the text" })[field] ?? field);
      return edited.length === 0 ? [who, ` approved ${agent}'s send.`] : [who, ` approved ${agent}'s send, changing ${list(edited)}.`];
    }
    case "messageSent":
      return ["Duva", ` sent ${whose} message${message === undefined || message.to.length === 0 ? "" : ` to ${list(message.to)}`}.`];
    case "sendWaitingForLimit":
      return ["Duva", ` holds a message until ${agent}'s send limits allow it.`];
    case "sentNow":
      return [who, ` sent a waiting message now, past the limits.`];
    case "sendFailed":
      return ["Amazon SES", change.reason === undefined ? ` refused to send ${whose} message.` : ` refused to send ${whose} message: ${change.reason}`];
    case "sendUnclear":
      return ["Duva", ` stopped sending ${whose} message before Amazon SES answered.`];
    case "feedbackReceived": {
      const recipients = change.feedback.recipients === undefined || change.feedback.recipients.length === 0 ? undefined : list(change.feedback.recipients);
      const to = recipients === undefined ? "" : ` for ${recipients}`;
      const said = { hardBounce: ` reported that a message bounced${to}.`, softBounce: ` reported that a message bounced for now${to}.`, complaint: ` reported that ${recipients ?? "a recipient"} marked a message as spam.`, reject: " didn't send a message after all." }[change.feedback.kind];
      return ["Amazon SES", said];
    }
    case "threadRead":
      return [who, ` marked a thread read.`];
    case "threadUnread":
      return [who, ` marked a thread unread.`];
    case "threadLabelsChanged":
      if (change.added.includes("trash")) return [who, ` moved a thread to Trash.`];
      if (change.added.includes("spam")) return [who, ` marked a thread as spam.`];
      if (change.removed.includes("trash")) return [who, ` restored a thread from Trash.`];
      if (change.removed.includes("spam")) return [who, ` marked a thread as not spam.`];
      if (change.added.includes("inbox")) return [who, ` moved a thread to the Inbox.`];
      if (change.removed.includes("inbox") && change.added.length === 0) return [who, ` archived a thread.`];
      return [who, ` changed a thread's labels.`];
    case "labelCreated":
      return change.name === undefined ? [who, ` created a label.`] : [who, ` created the label ${change.name}.`];
    case "labelRenamed":
      return change.name === undefined ? [who, ` renamed a label.`] : [who, ` renamed a label to ${change.name}.`];
    case "labelDeleted":
      return [who, ` deleted a label.`];
    case "labelPromptSet":
      return [who, ` gave a label a prompt for ${agent}.`];
    case "labelPromptRemoved":
      return [who, ` removed a label's prompt.`];
    case "taskGiven":
      return [who, who === "Duva" ? `, filing a sender's mail under a label with a prompt, gave ${agent} a task.` : ` added a label with a prompt, which gave ${agent} a task.`];
    case "taskStarted":
      return [who, ` started a task.`];
    case "taskEnded":
      if (change.outcome === "done") return change.note === undefined ? [who, ` finished a task.`] : [who, ` finished a task: “${change.note}”`];
      return change.note === undefined ? [who, ` couldn't finish a task.`] : [who, ` couldn't finish a task: “${change.note}”`];
    case "threadErased":
      return "actor" in change && change.actor !== undefined ? [who, " erased a thread for good, emptying Trash."] : ["Duva", " erased a thread for good, after the retention period."];
    case "agentSettingsChanged":
      return [who, ` changed ${agent}'s settings.`];
    case "agentPaused":
      return [who, ` paused ${agent}.`];
    case "agentUnpaused":
      return [who, ` unpaused ${agent}.`];
    case "senderScreened":
      return change.decision === "letIn" ? [who, ` let in ${sender(change)}.`] : [who, ` blocked ${sender(change)}.`];
    case "screenedSenderRemoved":
      return [who, ` removed the decision on ${sender(change)}.`];
    case "senderDeliveryRemoved":
      return [who, ` removed where mail from ${sender(change)} goes, so they're first-time again.`];
    case "senderDeliverySet": {
      const to = { inbox: "the Inbox", feed: "the Feed", paperTrail: "the Paper Trail", label: "a label", nowhere: "nowhere" }[change.delivery];
      return [who, ` sent mail from ${sender(change)} to ${to}.`];
    }
    case "screenerSwitched":
      return change.on ? [who, ` switched the Screener on.`] : [who, ` switched the Screener off.`];
    case "unsubscribeAttempted":
      return change.outcome === "unsubscribed" ? ["Duva", ` unsubscribed from ${sender(change)}.`] : ["Duva", ` couldn't unsubscribe from ${sender(change)}.`];
    case "agentKeyRotated":
      return [who, ` rotated ${agent}'s key.`];
    case "agentAdminChanged":
      return change.admin ? [who, ` made ${agent} an admin.`] : [who, ` took ${agent}'s admin away.`];
    case "setupAsked":
      return [who, ` asked to change the setup: ${change.preview.join(" ")}`];
    case "setupApproved":
      return [who, ` approved a setup change ${agent} asked for.`];
    case "setupRejected":
      return [who, ` rejected a setup change ${agent} asked for: “${change.note}”`];
    case "setupWithdrawn":
      return ["Duva", ` withdrew a setup change ${agent} asked for, since ${agent} is no longer an admin.`];
    case "mailboxAdded":
      return change.mailbox.defaultAddress === undefined ? [who, ` added a mailbox.`] : [who, ` added a mailbox at ${change.mailbox.defaultAddress}.`];
    case "addressAdded":
      return [who, ` added the address ${change.address}.`];
    case "addressRemoved":
      return [who, ` removed the address ${change.address}.`];
    case "actorAdded":
      return [who, ` added ${change.added.kind === "agent" ? `the agent ${change.added.name}` : change.added.email}.`];
    case "actorRemoved":
      return [who, ` removed ${change.removed.kind === "agent" ? `the agent ${change.removed.name}` : change.removed.email}.`];
    default:
      return [who, ` changed the organization's setup.`];
  }
}

/** A size in bytes as people read it: 11 bytes, 12 KB, 1.4 MB. */
export function size(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "1 thread", "2 threads". */
function threads(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

/**
 * What the note under a message says of the trackers Duva removed from its HTML, each named by its
 * service or as "a hidden image", grouped so a service that tracked twice is said once.
 */
function removedTrackers(removed: string[]): string {
  const hidden = "a hidden image";
  const counts = new Map<string, number>();
  for (const name of removed) counts.set(name, (counts.get(name) ?? 0) + 1);
  const groups = [...counts].sort(([a], [b]) => Number(a === hidden) - Number(b === hidden));
  if (removed.length === 1) return removed[0] === hidden ? "Removed a hidden tracking image." : `Removed a tracker from ${removed[0]}.`;
  if (groups.length === 1) return groups[0]![0] === hidden ? `Removed ${removed.length} hidden tracking images.` : `Removed ${removed.length} trackers from ${groups[0]![0]}.`;
  const parts = groups.map(([name, count]) => (name === hidden ? `${count} hidden ${count === 1 ? "image" : "images"}` : `${count} from ${name}`));
  return `Removed ${removed.length} trackers: ${list(parts)}.`;
}

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
