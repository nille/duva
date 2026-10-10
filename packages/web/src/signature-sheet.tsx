// Each mailbox's signature sheet on the You page (#157), where its owner sets its signature and any
// of its addresses' own.
import { useRef } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { SaveRow, Sheet, useSheet } from "./settings.tsx";
import { maxSignature } from "./signatures.tsx";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];
type Signature = components["schemas"]["Signature"];

/** The sheet's values: the mailbox's signature and each address's own, empty for none. */
interface Chosen {
  text: string;
  addresses: Record<string, string>;
}

const chosenOf = (signature: Signature): Chosen => ({
  text: signature.text ?? "",
  addresses: Object.fromEntries(signature.addresses.map(({ address, text }) => [address, text ?? ""])),
});

/** The mailbox's signature sheet, titled with its address when the human has several mailboxes. */
export function SignatureSheet({ client, mailbox, several, onSignedOut }: { client: DuvaClient; mailbox: Mailbox; several: boolean; onSignedOut: () => void }) {
  const copy = strings.signature;
  const params = { path: { mailbox: mailbox.id } };
  // The signatures as Duva has them, so saving sends only those changed.
  const saved = useRef<Chosen>({ text: "", addresses: {} });
  const read = (data: Signature | undefined) => {
    if (data === undefined) return undefined;
    saved.current = chosenOf(data);
    return saved.current;
  };
  const sheet = useSheet<Chosen>({
    read: async () => {
      const { data, response } = await client.GET("/mailboxes/{mailbox}/signature", { params });
      return { data: read(data), response };
    },
    write: async (chosen) => {
      const body = (text: string) => (text.trim() === "" ? null : text);
      const calls = [
        ...(chosen.text !== saved.current.text ? [{ text: body(chosen.text) }] : []),
        ...Object.entries(chosen.addresses).flatMap(([address, text]) => (text !== (saved.current.addresses[address] ?? "") ? [{ address, text: body(text) }] : [])),
      ];
      let last: Signature | undefined;
      let response: Response | undefined;
      for (const change of calls) {
        const answer = await client.PATCH("/mailboxes/{mailbox}/signature", { params, body: change });
        if (answer.data === undefined) return { response: answer.response };
        ({ data: last, response } = answer);
      }
      return { data: last === undefined ? chosen : read(last), response: response ?? new Response() };
    },
    copy,
    onSignedOut,
  });
  const id = `signature-${mailbox.id}`;
  return (
    <Sheet id={id} name={several && mailbox.defaultAddress !== undefined ? copy.titleFor(mailbox.defaultAddress) : copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => {
        const tooLong = [chosen.text, ...Object.values(chosen.addresses)].some((text) => text.trim().length > maxSignature);
        const addresses = Object.keys(chosen.addresses);
        return (
          <>
            <fieldset>
              <legend>{copy.mailboxLegend}</legend>
              <label className="setting-field signature-text">
                <span className="visually-hidden">{copy.mailboxLegend}</span>
                <textarea rows={4} value={chosen.text} placeholder={copy.placeholder} onChange={(event) => sheet.choose({ text: event.target.value })} />
              </label>
            </fieldset>
            {addresses.length > 1 && (
              <fieldset>
                <legend>{copy.addressesLegend}</legend>
                <p className="setting-lead">{copy.addressesLead}</p>
                <ul className="signature-addresses">
                  {addresses.map((address) => (
                    <li key={address}>
                      <label className="setting-field signature-text">
                        {address}
                        <textarea
                          rows={2}
                          value={chosen.addresses[address]}
                          placeholder={copy.addressPlaceholder}
                          onChange={(event) => sheet.choose({ addresses: { ...chosen.addresses, [address]: event.target.value } })}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            {tooLong && <p className="setting-note">{copy.tooLong}</p>}
            <SaveRow sheet={sheet} saved={copy.saved} invalid={tooLong} />
          </>
        );
      }}
    </Sheet>
  );
}
