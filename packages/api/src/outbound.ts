// SES's sending, which the sender, groups' copies and away messages all send through. It sits
// below them, so none of them imports another for it (#160).
import { SendEmailCommand, SESv2ServiceException, type SESv2Client } from "@aws-sdk/client-sesv2";

/** Who SES delivers a message to. Bcc recipients are here only, since no header names them. */
export interface Destination {
  to: string[];
  cc: string[];
  bcc: string[];
}

/** SES's sending, or a stand-in in tests. */
export interface Outbound {
  /**
   * Hands SES the raw message for the destination's recipients and returns the ID SES gave it.
   * Throws Refused with SES's reason if SES refused it. Any other error leaves it unclear whether
   * SES accepted it.
   */
  send(raw: Uint8Array, destination: Destination): Promise<string>;
}

/** SES refused the message, so it wasn't sent. */
export class Refused extends Error {}

/**
 * SES's v2 SendEmail with raw MIME, under Duva's configuration set, which tracks no opens or
 * clicks. The client must make one attempt per call, since the SDK would retry a call whose answer
 * was lost after SES accepted it. Only throttling, where SES refused the call, is tried again here.
 */
export function sesOutbound(ses: SESv2Client, configurationSet: string): Outbound {
  return {
    async send(raw, { to, cc, bcc }) {
      for (let attempt = 1; ; attempt++) {
        try {
          const { MessageId } = await ses.send(
            new SendEmailCommand({
              Content: { Raw: { Data: raw } },
              // SES delivers to the destination's recipients, so Bcc recipients need no header.
              Destination: { ToAddresses: to, ...(cc.length > 0 && { CcAddresses: cc }), ...(bcc.length > 0 && { BccAddresses: bcc }) },
              ConfigurationSetName: configurationSet,
            }),
          );
          if (MessageId === undefined) throw new Error("SES accepted the message without giving it an ID.");
          return MessageId;
        } catch (error) {
          if (!(error instanceof SESv2ServiceException) || error.$fault !== "client") throw error;
          if (error.name !== "TooManyRequestsException" || attempt === 3) throw new Refused(error.message);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    },
  };
}
