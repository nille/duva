// The search module's interface (spec #2). Search works per mailbox, and any
// engine sits behind these types: LanceDB now, the fallback if the spike fails.
// Leaving out Spam and Trash is a mailbox rule, so callers express it as a
// label filter and the module knows no labels by name.

export interface SearchEngine {
  mailbox(mailboxId: string): Promise<MailboxSearch>;
}

export interface MailboxSearch {
  add(messages: Message[]): Promise<void>;
  remove(messageIds: string[]): Promise<void>;
  changeLabels(messageId: string, labels: string[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchHit[]>;
}

export interface Message {
  id: string;
  thread: string;
  sender: string;
  recipients: string[];
  subject: string;
  date: Date;
  // Labels sit on threads. Each message carries a copy of its thread's, so
  // filters need no join, and Duva changes each message's copy.
  labels: string[];
  hasAttachment: boolean;
  text: string;
}

// A query has words, a phrase or a meaning, in any mix, narrowed by filters.
export interface SearchQuery {
  // Every word must appear in the subject or the text.
  words?: string;
  // These words, in this order, in the subject or the text.
  phrase?: string;
  // Plain text the module embeds itself, so callers never handle vectors.
  meaning?: string;
  // Also searches the meaning's words, and that meaning, translated into
  // each of these languages, as Duva does with its search languages (#67).
  translateInto?: ("English" | "Swedish" | "Danish")[];
  filters?: SearchFilters;
  limit: number;
}

export interface SearchFilters {
  labels?: {
    // The message carries every one of these.
    include?: string[];
    // The message carries none of these.
    exclude?: string[];
  };
  sender?: string;
  // From is inclusive, to is exclusive.
  date?: { from?: Date; to?: Date };
  hasAttachment?: boolean;
}

// Hits come in rank order, best first. A higher score ranks higher, and
// scores are comparable only within one search.
export interface SearchHit {
  messageId: string;
  score: number;
}
