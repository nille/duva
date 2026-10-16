import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Eraser } from "./erasure.ts";
import type { Downloads } from "./attachments.ts";
import type { Dns } from "./dns-records.ts";
import type { EmailIdentities } from "./identities.ts";
import type { IndexQueue } from "./indexing.ts";
import type { Humans, SignInSender } from "./user-pool.ts";
import type { MailBucket } from "./mail-bucket.ts";
import type { Receiving } from "./receiving.ts";
import type { Searcher } from "./searching.ts";
import type { Unsubscriber } from "./unsubscriber.ts";
import type { WaitingSends } from "./limits.ts";
import type { Reminders } from "./reminders.ts";
import type { AwayEnds } from "./away-messages.ts";
import type { PaymentLapses } from "./payments.ts";
import type { HostedLogos } from "./own-logos.ts";
import type { TaskRunner } from "./tasks.ts";
import type { Embedder } from "./titan.ts";
import type { UploadsBucket } from "./uploads-bucket.ts";
import type { BrowserProfiles } from "./browser-profiles.ts";
import type { Suggester } from "./suggestions.ts";
import type { SecretKeys } from "./secrets.ts";
import type { Outbound } from "./outbound.ts";

/** Duva's one DynamoDB table. */
export interface Table {
  client: DynamoDBClient;
  name: string;
}

/** What the API knows about the deployment it runs in. */
export interface Deployment {
  /** The version of Duva the deployment runs. */
  version: string;
  /** The AWS region the deployment runs in. */
  region: string;
  table: Table;
  /** Where humans sign in. */
  humans: Humans;
  /** Where their sign-in codes come from. */
  signInSender: SignInSender;
  /**
   * The web app's URL, which sign-in links lead to: at its host on the organization's domains once
   * deploy moved it there, such as https://duva.example.com, on CloudFront's own domain until then (ADR-0042).
   */
  webUrl: string;
  /** SES's sending, which mails sign-in links to recovery addresses (ADR-0041). */
  outbound: Outbound;
  /** The SES identities of the organization's domains. */
  identities: EmailIdentities;
  /** DNS, where admins add the records the domains need. */
  dns: Dns;
  mailBucket: MailBucket;
  /** Where the files uploaded to drafts are. */
  uploads: UploadsBucket;
  receiving: Receiving;
  eraser: Eraser;
  downloads: Downloads;
  /** Sends the one-click POST when an actor blocks a sender. */
  unsubscriber: Unsubscriber;
  /** Runs searches in the mailboxes' indexes. */
  searcher: Searcher;
  /** The indexer's queue, which rebuilds every mailbox's index when the languages mail is indexed in change. */
  indexQueue: IndexQueue;
  /** Hands the sender an agent whose sends wait for its limits, once something lets them go. */
  waitingSends: WaitingSends;
  /** Has the sender bring back each thread set aside in Remind me when its time comes. */
  reminders: Reminders;
  /** Has the sender switch each away message off when its last day ends. */
  awayEnds: AwayEnds;
  /** Has the sender let each approved payment lapse 24 hours on, if nothing paid it (#183). */
  paymentLapses: PaymentLapses;
  /** Serves the organization's own logos, and the mark certificates attached to them. */
  hostedLogos: HostedLogos;
  /** Runs the tasks labels' prompts give mailbox agents, as unpausing one hands them over again. */
  tasks: TaskRunner;
  /** The humans' browser profiles, which Coo's browsing keeps their logins in (ADR-0038). */
  browserProfiles: BrowserProfiles;
  /** Embeds Coo's memories and what they are searched for, with Titan in the deployment's region (ADR-0036). */
  embedder: Embedder;
  /** Suggests the rest of a sentence a human is writing, with the organization's suggestion model on Bedrock (#156). */
  suggester: Suggester;
  /** Seals and opens the humans' secrets, with the stack's own KMS key (ADR-0039). */
  secretKeys: SecretKeys;
}
