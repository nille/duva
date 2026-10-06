// SES's account-level suppression list, which SES adds an address to when mail to it hard-bounces
// or draws a complaint, and then never delivers to it again. SES receiving takes a few seconds to
// pick up a new address, so mail sent to one at once can bounce, and suppress one of the
// organization's own addresses (docs/aws.md). So Duva takes its addresses off the list.
import { DeleteSuppressedDestinationCommand, NotFoundException, paginateListSuppressedDestinations, type SESv2Client } from "@aws-sdk/client-sesv2";

/** Why SES put an address on the suppression list, as the account suppresses both. */
export type SuppressionReason = "BOUNCE" | "COMPLAINT";

/** SES's account-level suppression list, or a stand-in in tests. */
export interface SuppressionList {
  /** The addresses on the list, as SES has them. */
  list(): Promise<string[]>;
  /** Takes the address off the list, if it is on it. */
  remove(address: string): Promise<void>;
}

/** The account's suppression list in SES. */
export function sesSuppressionList(ses: SESv2Client): SuppressionList {
  return {
    async list() {
      const addresses: string[] = [];
      for await (const page of paginateListSuppressedDestinations({ client: ses }, {})) {
        for (const { EmailAddress } of page.SuppressedDestinationSummaries ?? []) if (EmailAddress !== undefined) addresses.push(EmailAddress);
      }
      return addresses;
    },
    async remove(address) {
      await ses.send(new DeleteSuppressedDestinationCommand({ EmailAddress: address })).catch((error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error;
      });
    },
  };
}
