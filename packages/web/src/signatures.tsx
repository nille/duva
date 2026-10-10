// Signatures (#157) in the composer: what it needs to show a draft's where it will go, under the
// text and above a forward's quoted original, for the From chosen. Each mailbox's sheet on the You
// page is signature-sheet.tsx's, so the composer loads none of Settings.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];
type Signature = components["schemas"]["Signature"];

/** The longest signature Duva takes, as the contract gives it. */
export const maxSignature = 1000;

/**
 * The signature mail from an address carries, for each address of the mailboxes: the address's
 * own, without a plus tag, or else its mailbox's, which `fallback`'s mailbox gives an address of
 * none, as a group's. Empty for none, and undefined until Duva answered.
 */
export function useSignatures(client: DuvaClient, mailboxes: Mailbox[]): ((from: string, fallback: string | undefined) => string) | undefined {
  const ids = mailboxes.map(({ id }) => id).join();
  const [read, setRead] = useState<Map<string, Signature>>();
  useEffect(() => {
    let current = true;
    void Promise.all(
      ids.split(",").filter(Boolean).map(async (mailbox) => {
        const { data } = await client.GET("/mailboxes/{mailbox}/signature", { params: { path: { mailbox } } }).catch(() => ({ data: undefined }));
        return [mailbox, data] as const;
      }),
    ).then((answers) => current && setRead(new Map(answers.flatMap(([mailbox, data]) => (data === undefined ? [] : [[mailbox, data] as const])))));
    return () => {
      current = false;
    };
  }, [client, ids]);
  const signatureOf = useCallback(
    (from: string, fallback: string | undefined) => {
      const address = from.toLowerCase().replace(/\+[^@]*@/, "@");
      for (const signature of read?.values() ?? []) {
        const own = signature.addresses.find((each) => each.address === address);
        if (own !== undefined) return own.text ?? signature.text ?? "";
      }
      return (fallback === undefined ? undefined : read?.get(fallback)?.text) ?? "";
    },
    [read],
  );
  return read === undefined ? undefined : signatureOf;
}

/** Where a forward's quoted original starts in its text, which the signature goes above, or -1 for a text without one. */
const quoteAt = (text: string) => text.lastIndexOf("\n\nForwarded message\n");

/** The text a draft's writer writes in, and the forward's quoted original after it, which is empty for any other draft. */
export function splitText(text: string, forward: boolean): { written: string; quoted: string } {
  const at = forward ? quoteAt(text) : -1;
  return at === -1 ? { written: text, quoted: "" } : { written: text.slice(0, at), quoted: text.slice(at + 2) };
}

/** The draft's text again from what the writer wrote and the forward's quoted original. */
export const joinText = (written: string, quoted: string) => (quoted === "" ? written : `${written}\n\n${quoted}`);

/**
 * A draft's signature, under its text after the line of "-- " it goes out after, which the writer
 * changes for this one message. Remove drops it, and Add brings back the one its From has.
 */
export function SignatureField({
  id,
  value,
  fromHas,
  locked,
  onChange,
  onChosen,
  onBlur,
}: {
  id: string;
  value: string;
  /** The signature the draft's From has, which Add brings back. */
  fromHas: string;
  locked: boolean;
  onChange: (signature: string) => void;
  /** A change made by a button, which saves at once. */
  onChosen: (signature: string) => void;
  onBlur: () => void;
}) {
  const copy = strings.signature;
  // A signature the writer empties stays a field until they leave it, so it never vanishes under the cursor.
  const [editing, setEditing] = useState(false);
  if (value === "" && !editing) {
    if (locked || fromHas === "") return null;
    return (
      <div className="compose-signature compose-signature-none">
        <button type="button" className="link" onClick={() => onChosen(fromHas)}>
          {copy.add}
        </button>
      </div>
    );
  }
  return (
    <div className="compose-signature">
      <div className="compose-signature-head">
        <span className="compose-signature-dashes" aria-hidden="true">
          --
        </span>
        {!locked && (
          <button type="button" className="link" onClick={() => onChosen("")}>
            {copy.remove}
          </button>
        )}
      </div>
      <label htmlFor={id} className="visually-hidden">
        {copy.field}
      </label>
      <textarea
        id={id}
        className="compose-signature-text"
        rows={1}
        value={value}
        readOnly={locked}
        maxLength={maxSignature}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          onBlur();
        }}
        lang=""
      />
    </div>
  );
}
