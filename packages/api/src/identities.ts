// The SES identities of the domains admins add at run time (ADR-0018). Each is made as the stack
// makes the first domain's: Easy DKIM, sending through Duva's configuration set, and mail.<domain>
// as its MAIL FROM domain.
import {
  AlreadyExistsException,
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException,
  PutEmailIdentityMailFromAttributesCommand,
  type SESv2Client,
} from "@aws-sdk/client-sesv2";
import { mailFromDomain } from "./dns-records.ts";

/** What SES has verified of a domain's identity, with its statuses as SES names them, like PENDING or SUCCESS. */
export interface DomainIdentity {
  /** Whether SES has verified the domain, which sending from it needs. */
  verified: boolean;
  dkimStatus: string;
  /** The tokens of the DKIM CNAME records SES wants. */
  dkimTokens: string[];
  mailFromStatus: string;
}

/** The domains' identities in SES in the deployment's account and region, or a stand-in in tests. */
export interface EmailIdentities {
  /** Gives the domain an identity, or finishes one an earlier call left partway. */
  create(domain: string): Promise<void>;
  /** The domain's identity, or undefined if SES has none. */
  get(domain: string): Promise<DomainIdentity | undefined>;
  /** Deletes the domain's identity, if it has one. */
  delete(domain: string): Promise<void>;
}

export function sesIdentities(ses: SESv2Client, configurationSet: string): EmailIdentities {
  return {
    async create(domain) {
      await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: domain, ConfigurationSetName: configurationSet })).catch((error: unknown) => {
        if (!(error instanceof AlreadyExistsException)) throw error;
      });
      // Bounces go to mail.<domain> unless its MX record is missing, and then to SES's own domain.
      await ses.send(new PutEmailIdentityMailFromAttributesCommand({ EmailIdentity: domain, MailFromDomain: mailFromDomain(domain), BehaviorOnMxFailure: "USE_DEFAULT_VALUE" }));
    },
    async get(domain) {
      try {
        const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
        return {
          verified: identity.VerifiedForSendingStatus === true,
          dkimStatus: identity.DkimAttributes?.Status ?? "NOT_STARTED",
          dkimTokens: identity.DkimAttributes?.Tokens ?? [],
          mailFromStatus: identity.MailFromAttributes?.MailFromDomainStatus ?? "NOT_STARTED",
        };
      } catch (error) {
        if (error instanceof NotFoundException) return undefined;
        throw error;
      }
    },
    async delete(domain) {
      await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain })).catch((error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error;
      });
    },
  };
}
