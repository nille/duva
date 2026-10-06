// The search module (ADR-0007): one index per mailbox, behind these types, so the engine can be
// swapped. LanceDB is behind them now. The engine knows no labels by name and no mailbox rules:
// leaving out Spam and Trash is a label filter its callers give.
import type { components } from "@duva/openapi";

export interface SearchEngine {
  /** The mailbox's index, to write to. A mailbox that has none gets an empty one. */
  writer(mailbox: string): Promise<IndexWriter>;
  /** Deletes the mailbox's index, if it has one. */
  drop(mailbox: string): Promise<void>;
  /** The mailbox's messages that match the search, in its order, at most its limit. A mailbox without an index has none. */
  search(mailbox: string, search: Search): Promise<SearchHit[]>;
  /** The text of each of the mailbox's messages with the IDs that its index has, by ID. */
  texts(mailbox: string, messages: string[]): Promise<Map<string, string>>;
}

/** The one writer of a mailbox's index. Each call is a commit of its own. */
export interface IndexWriter {
  /** Adds the messages, replacing those with the same IDs. */
  put(messages: IndexedMessage[]): Promise<void>;
  /** Gives every message in each thread the thread's labels and read state. */
  relabel(threads: IndexedThread[]): Promise<void>;
  /** Removes every message in the threads. */
  removeThreads(threads: string[]): Promise<void>;
  /** Adds what was written since the last time to the index's own indexes, and deletes old versions. */
  maintain(): Promise<void>;
  /**
   * Rewrites the index, so no file holds a removed message's text or vector, and deletes every old version.
   * A search reading an old version meanwhile fails, and is retried on the new one.
   */
  compact(): Promise<void>;
}

/** What a thread's messages carry of it, since labels and read state sit on threads. */
export interface IndexedThread {
  id: string;
  labels: string[];
  unread: boolean;
}

/** A message as the index has it, with a copy of its thread's labels and read state. */
export interface IndexedMessage {
  id: string;
  thread: string;
  from: components["schemas"]["EmailAddress"];
  /** To, Cc and Bcc. */
  recipients: components["schemas"]["EmailAddress"][];
  subject: string;
  receivedAt: Date;
  labels: string[];
  unread: boolean;
  /** The names of its attachments. */
  attachments: string[];
  hasAttachment: boolean;
  text: string;
}

/**
 * Something a message must have: a word, or words in that order as a phrase, anywhere it is
 * searched (subject, sender and recipients, text and attachment names) or in its subject.
 */
export interface SearchTerm {
  text: string;
  phrase: boolean;
  in: "anywhere" | "subject";
}

/** What to find in a mailbox's index. */
export interface Search {
  /** Every one must match. Without any, every message the filters keep matches. */
  terms: SearchTerm[];
  filters: SearchFilters;
  /** Best first, or newest first. Without terms, both are newest first. */
  sort: "relevance" | "newest";
  limit: number;
}

export interface SearchFilters {
  /** Each is part of the sender's name or address, in any case. */
  from?: string[];
  /** Each is part of a recipient's name or address, in any case. */
  to?: string[];
  labels?: {
    /** The message carries every one of these. */
    include?: string[];
    /** The message carries none of these. */
    exclude?: string[];
  };
  unread?: boolean;
  hasAttachment?: boolean;
  /** When it was received. From is inclusive, to is exclusive. */
  received?: { from?: Date; to?: Date };
  threads?: {
    /** The message is in one of these. */
    include?: string[];
    /** The message is in none of these. */
    exclude?: string[];
    /** A message in one of these is kept whatever its labels and read state, as long as the other filters hold. */
    exempt?: string[];
  };
}

/** A higher score ranks higher, and scores are comparable only within one search. */
export interface SearchHit {
  message: string;
  thread: string;
  score: number;
  receivedAt: Date;
}
