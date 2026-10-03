// Every string the web app shows, in one place, so another language can be added later.
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
  sessionEnded: {
    title: "Your session has ended",
    lead: "Sign in again to see your approvals.",
  },

  nav: { label: "Duva", approvals: "Approvals" },
  connection: {
    upToDate: (time: string) => `Up to date at ${time}`,
    unreachable: "Duva couldn't check for new requests. It tries again by itself.",
  },

  approvals: {
    title: "Approvals",
    waiting: (count: number) => (count === 1 ? "1 waiting" : `${count} waiting`),
    noneWaiting: "Nothing is waiting for you",
    emptyLead: "When an agent you sponsor asks to send mail, its draft appears here. You send it as is, edit it first, or reject it with a note.",
    emptyPolling: "This page checks for new requests by itself, so there's no need to reload it.",
  },

  galley: {
    asks: (agent: string) => `${agent} asks to send`,
    askedAt: (time: string) => `Asked ${time}`,
    anAgent: "An agent",
    isNew: "New",
    original: "The message it answers",
    noOriginal: "This draft starts a new thread.",
    originalGone: "A reply. The message it answers is no longer in the mailbox.",
    draft: (agent: string) => `Draft by ${agent}`,
    yourVersion: "Your version",
    changed: (fields: string[]) => (fields.length === 0 ? "No changes yet. Sending now sends the draft as written." : `You changed ${list(fields)}.`),
    fieldNames: { to: "the recipients", subject: "the subject", text: "the text" },
    from: "From",
    to: "To",
    cc: "Cc",
    subject: "Subject",
    date: "Date",
    whenSent: "When you send it",
    noSubject: "(no subject)",
    attachments: (count: number) => (count === 1 ? "1 attachment, not shown" : `${count} attachments, not shown`),
    showAll: "Show the whole message",
    showLess: "Show less",
    disclosure: (agent: string, sponsor: string) => `Sent by ${agent} for ${sponsor}`,
    disclosureNote: "Duva adds this line, so recipients can tell an agent wrote it.",
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
    sending: "Sending…",
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

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
