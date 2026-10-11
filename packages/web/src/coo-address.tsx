// Coo's address, a sheet on the You page of Settings (ADR-0040): the address the human's allowed
// senders mail to ask their Coo, with a copy button, their own addresses, which may always mail
// it, and the others they list, added and removed here and saved together.
import { useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { isEmailAddress } from "./compose.tsx";
import { CopyButton } from "./dns-parts.tsx";
import { SaveRow, Sheet, useSheet } from "./settings.tsx";
import { strings } from "./strings.ts";

type CooAddress = components["schemas"]["CooAddress"];

const copy = strings.settings.cooAddress;


export function CooAddressSheet({ client, onSignedOut }: { client: DuvaClient; onSignedOut: () => void }) {
  const sheet = useSheet<CooAddress>({
    read: () => client.GET("/mailbox-agent/address"),
    write: ({ allowedSenders }) => client.PATCH("/mailbox-agent/address", { body: { allowedSenders } }),
    copy,
    onSignedOut,
  });
  return (
    <Sheet id="coo-address" name={copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => (
        <>
          <div className="setting-part">
            <h3 className="setting-title">{copy.address}</h3>
            {chosen.address === undefined ? (
              <p className="setting-lead">{copy.none}</p>
            ) : (
              <p className="mcp-line">
                <code>{chosen.address}</code>
                <CopyButton text={chosen.address} tabStop keysHint="coo-address-lead" onFocus={() => undefined} />
              </p>
            )}
          </div>
          <div className="setting-part">
            <h3 className="setting-title">{copy.own}</h3>
            <p className="setting-lead" id="coo-address-lead">
              {copy.ownLead}
            </p>
            <ul className="person-list" aria-label={copy.own}>
              {chosen.ownAddresses.map((address) => (
                <li key={address} className="person-row">
                  <div className="person-line">
                    <span className="person-name">{address}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="setting-part">
            <h3 className="setting-title">{copy.listed}</h3>
            <p className="setting-lead">{copy.listedLead}</p>
            {chosen.allowedSenders.length === 0 ? (
              <p className="setting-lead">{copy.noneListed}</p>
            ) : (
              <ul className="person-list" aria-label={copy.listed}>
                {chosen.allowedSenders.map((address) => (
                  <li key={address} className="person-row">
                    <div className="person-line">
                      <span className="person-name">{address}</span>
                      <button
                        type="button"
                        className="button button-small button-quiet"
                        aria-label={copy.removeWho(address)}
                        onClick={() => sheet.choose({ allowedSenders: chosen.allowedSenders.filter((each) => each !== address) })}
                      >
                        {copy.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <AddSender allowed={[...chosen.ownAddresses, ...chosen.allowedSenders]} onAdd={(address) => sheet.choose({ allowedSenders: [...chosen.allowedSenders, address].sort() })} />
          </div>
          <SaveRow sheet={sheet} saved={copy.saved} />
        </>
      )}
    </Sheet>
  );
}

/** A field for another sender. It sits in the sheet's form, so Enter adds rather than saves. */
function AddSender({ allowed, onAdd }: { allowed: string[]; onAdd: (address: string) => void }) {
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string>();
  const id = useId();
  const add = () => {
    const given = address.trim().toLowerCase();
    if (!isEmailAddress(given)) return setProblem(copy.notAnAddress(address.trim()));
    if (allowed.includes(given)) return setProblem(copy.already(given));
    onAdd(given);
    setAddress("");
  };
  return (
    <div className="address-add">
      <label htmlFor={id}>{copy.newSender}</label>
      <div className="address-add-row">
        <input
          id={id}
          type="text"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          aria-invalid={problem !== undefined}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setProblem(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <button type="button" className="button" disabled={address.trim() === ""} onClick={add}>
          {copy.add}
        </button>
      </div>
      {problem !== undefined ? (
        <p id={`${id}-hint`} className="field-error" role="alert">
          {problem}
        </p>
      ) : (
        <p id={`${id}-hint`} className="hint">
          {copy.newSenderHint}
        </p>
      )}
    </div>
  );
}
