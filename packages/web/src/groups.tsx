// The Groups sheet in Settings, for admins: each group as a line with how many members it has and
// who can send to it, which opens into its members, each said to be a mailbox's, a group or an
// external address, and removed there, a field to add another, who can send to it and where external
// members' replies go (ADR-0003), and deleting it. Creating a group comes last. What a change did is
// said where it happened, in place of what it removed.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { ChevronIcon, Choice } from "./setting-parts.tsx";
import { attempt, byText, change, isAgents, type Mailboxes, ownerName } from "./setup.ts";
import { strings } from "./strings.ts";

type Group = components["schemas"]["Group"];
type Domain = components["schemas"]["Domain"];
type SendPolicy = components["schemas"]["SendPolicy"];
type ReplyTo = components["schemas"]["GroupReplyTo"];

/** The organization's groups, and what names their local members: its mailboxes, with their owners, and its domains. */
interface Organization extends Mailboxes {
  groups: Group[];
  domains: Domain[];
}

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; organization: Organization };

const copy = strings.groups;
const sendPolicies: SendPolicy[] = ["anyone", "organization", "members"];
const replyTos: ReplyTo[] = ["sender", "group"];

/** The addresses in a field, as the admin separated them, in lower case as Duva keeps them. */
const addressesIn = (field: string) => field.split(/[\s,;]+/).filter(Boolean).map((address) => address.toLowerCase());

/**
 * The sheet. `changes` counts the changes to the organization's setup made on any sheet, and the
 * sheet reads again on each. `onChange` says it made one.
 */
export function GroupsSheet({ client, changes, onChange, onSignedOut }: { client: DuvaClient; changes: number; onChange: () => void; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  // The group just created, opened so its settings show.
  const [created, setCreated] = useState<string>();
  // The groups deleted here, each said in place of its line.
  const [gone, setGone] = useState<string[]>([]);

  // Read again after a change, the sheet stays as it is while it does, so open lines stay open.
  const load = useCallback(
    async (again = false) => {
      if (!again) setRead({ status: "loading" });
      const answers = await Promise.all([attempt(client.GET("/groups")), attempt(client.GET("/organization/mailboxes")), attempt(client.GET("/domains"))]);
      if (answers.some(({ response }) => response?.status === 401)) return onSignedOut();
      const unread = answers.find(({ data }) => data === undefined);
      if (unread !== undefined) {
        if (!again) setRead({ status: "failed", message: unread.response === undefined ? copy.unreachable : copy.failed(unread.response.status) });
        return;
      }
      const [groups, mailboxes, domains] = answers as [Required<(typeof answers)[0]>, Required<(typeof answers)[1]>, Required<(typeof answers)[2]>];
      setRead({ status: "read", organization: { groups: groups.data.groups, ...mailboxes.data, domains: domains.data.domains } });
    },
    [client, onSignedOut],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (changes > 0) void load(true);
  }, [changes, load]);

  const lines: { address: string; group?: Group }[] =
    read.status !== "read"
      ? []
      : [
          ...read.organization.groups.map((group) => ({ address: group.address, group })),
          ...gone.filter((address) => !read.organization.groups.some((group) => group.address === address)).map((address) => ({ address })),
        ].sort((a, b) => byText(a.address, b.address));

  return (
    <section className="settings" aria-labelledby="group-settings" aria-busy={read.status === "loading"}>
      <div className="settings-head">
        <h2 id="group-settings">{copy.title}</h2>
        <p>{copy.lead}</p>
      </div>
      {read.status === "failed" ? (
        <div className="setting">
          <div className="notice notice-alert" role="alert">
            <p>{read.message}</p>
            <button type="button" className="button button-small" onClick={() => void load()}>
              {strings.inbox.retry}
            </button>
          </div>
        </div>
      ) : (
        read.status === "read" && (
          <>
            {lines.length === 0 && <p className="setting-done">{copy.none}</p>}
            {lines.map((line) =>
              line.group !== undefined ? (
                <GroupLine
                  key={line.address}
                  client={client}
                  group={line.group}
                  organization={read.organization}
                  created={created === line.address}
                  onChanged={onChange}
                  onDeleted={() => {
                    setGone((current) => [...current.filter((address) => address !== line.address), line.address]);
                    onChange();
                  }}
                  onSignedOut={onSignedOut}
                />
              ) : (
                <p key={line.address} className="setting-line setting-gone" role="status">
                  {copy.deleted(line.address)}
                </p>
              ),
            )}
            <CreateGroup
              client={client}
              domain={read.organization.domains.find(({ kind }) => kind === "standalone")?.domain}
              onCreated={(address) => {
                setCreated(address);
                setGone((current) => current.filter((each) => each !== address));
                onChange();
              }}
              onSignedOut={onSignedOut}
            />
          </>
        )
      )}
    </section>
  );
}

/** What a member is: a mailbox's address, by its owner, a group, or an external address. */
function memberWho(address: string, organization: Organization): string {
  const [local, domainName] = [address.slice(0, address.lastIndexOf("@")), address.slice(address.lastIndexOf("@") + 1)];
  const domain = organization.domains.find((each) => each.domain === domainName);
  if (domain === undefined) return copy.memberOf.external;
  // An alias domain's address is its standalone domain's.
  const own = domain.aliasOf === undefined ? address : `${local}@${domain.aliasOf}`;
  if (organization.groups.some((group) => group.address === own)) return copy.memberOf.group;
  const mailbox = organization.mailboxes.find(({ addresses }) => addresses.includes(own));
  if (mailbox === undefined) return "";
  const owner = ownerName(mailbox, organization);
  return isAgents(mailbox, organization) ? copy.memberOf.agent(owner) : copy.memberOf.human(owner);
}

function GroupLine({
  client,
  group,
  organization,
  created,
  onChanged,
  onDeleted,
  onSignedOut,
}: {
  client: DuvaClient;
  group: Group;
  organization: Organization;
  /** Whether the group was just created here, so it opens and says so. */
  created: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  onSignedOut: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (created && details.current !== null) details.current.open = true;
  }, [created]);
  const heading = `group-${group.address}`;
  // The member just added, said in its row, and those removed, each said in place of its row.
  const [added, setAdded] = useState<string>();
  const [gone, setGone] = useState<{ address: string; at: number }[]>([]);
  const rows: ({ address: string; gone?: false } | { address: string; gone: true })[] = group.members.map((address) => ({ address }));
  for (const each of gone) if (!group.members.includes(each.address)) rows.splice(Math.min(each.at, rows.length), 0, { address: each.address, gone: true });

  const setMembers = (members: string[]) => change(client.PATCH("/groups/{group}", { params: { path: { group: group.address } }, body: { members } }), onSignedOut);

  return (
    <details className="setting-line" name="groups" ref={details}>
      <summary>
        <div className="line-summary">
          <h3 id={heading}>{group.address}</h3>
          <p className="line-summary-text">{copy.summary(group.members.length, copy.policySummary[group.sendPolicy])}</p>
        </div>
        <ChevronIcon />
      </summary>
      <div className="setting" role="group" aria-labelledby={heading}>
        {created && (
          <p className="setting-note" role="status">
            {copy.created(group.address, group.sendPolicy === "anyone")}
          </p>
        )}
        <div className="setting-part">
          <h4>{copy.membersTitle}</h4>
          {rows.length === 0 ? (
            <p className="setting-lead">{copy.noMembers}</p>
          ) : (
            <ul className="person-list" aria-label={copy.membersOf(group.address)}>
              {rows.map((row) =>
                row.gone ? (
                  <li key={`gone-${row.address}`} className="person-row person-gone">
                    <p role="status">{copy.removedMember(row.address)}</p>
                  </li>
                ) : (
                  <MemberRow
                    key={row.address}
                    address={row.address}
                    who={memberWho(row.address, organization)}
                    said={added === row.address ? copy.addedMember(row.address) : undefined}
                    onRemove={async () => {
                      const answer = await setMembers(group.members.filter((member) => member !== row.address));
                      if (answer !== undefined && !("failed" in answer)) {
                        setGone((current) => [...current.filter(({ address }) => address !== row.address), { address: row.address, at: group.members.indexOf(row.address) }]);
                        if (added === row.address) setAdded(undefined);
                        onChanged();
                      }
                      return answer;
                    }}
                  />
                ),
              )}
            </ul>
          )}
          <AddMember
            group={group}
            onAdd={async (address) => {
              const answer = await setMembers([...group.members, address]);
              if (answer !== undefined && !("failed" in answer)) {
                setAdded(address);
                setGone((current) => current.filter((each) => each.address !== address));
                onChanged();
              }
              return answer;
            }}
          />
        </div>
        <Policies client={client} group={group} onChanged={onChanged} onSignedOut={onSignedOut} />
        <DeleteGroup client={client} group={group} onDeleted={onDeleted} onSignedOut={onSignedOut} />
      </div>
    </details>
  );
}

type Changed = { data: unknown } | { failed: string } | undefined;

/** A member: its address at 600, what it is, and removing it, with what was done said under it. */
function MemberRow({ address, who, said, onRemove }: { address: string; who: string; said?: string; onRemove: () => Promise<Changed> }) {
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const remove = async () => {
    setState({ status: "busy" });
    const answer = await onRemove();
    if (answer !== undefined && "failed" in answer) setState({ status: "failed", message: answer.failed });
  };
  return (
    <li className="person-row">
      <div className="person-line">
        <span className="person-name">{address}</span>
        {who !== "" && <span className="hint person-hint">{who}</span>}
        <button type="button" className="button button-small button-quiet" aria-label={copy.removeMemberWho(address)} disabled={state.status === "busy"} onClick={() => void remove()}>
          {copy.removeMember}
        </button>
      </div>
      {said !== undefined && (
        <p className="person-said" role="status">
          {said}
        </p>
      )}
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </li>
  );
}

/** A field for another member, the organization's address or anyone's. */
function AddMember({ group, onAdd }: { group: Group; onAdd: (address: string) => Promise<Changed> }) {
  const [address, setAddress] = useState("");
  const [state, setState] = useState<{ status: "idle" | "adding" } | { status: "failed"; message: string }>({ status: "idle" });
  const id = useId();
  const add = async () => {
    const given = address.trim().toLowerCase();
    if (group.members.includes(given)) return setState({ status: "failed", message: copy.alreadyMember(given) });
    setState({ status: "adding" });
    const answer = await onAdd(given);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    setAddress("");
  };
  return (
    <form
      className="address-add"
      aria-label={copy.newMember}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <label htmlFor={id}>{copy.newMember}</label>
      <div className="address-add-row">
        <input
          id={id}
          type="text"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          aria-invalid={state.status === "failed"}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            if (state.status === "failed") setState({ status: "idle" });
          }}
        />
        <button type="submit" className="button button-primary" disabled={address.trim() === "" || state.status === "adding"}>
          {state.status === "adding" ? copy.adding : copy.addMember}
        </button>
      </div>
      {state.status === "failed" ? (
        <p id={`${id}-hint`} className="field-error" role="alert">
          {state.message}
        </p>
      ) : (
        <p id={`${id}-hint`} className="hint">
          {copy.newMemberHint}
        </p>
      )}
    </form>
  );
}

/** Who can send to the group and where external members' replies go, with a Save of their own. */
function Policies({ client, group, onChanged, onSignedOut }: { client: DuvaClient; group: Group; onChanged: () => void; onSignedOut: () => void }) {
  const [chosen, setChosen] = useState({ sendPolicy: group.sendPolicy, replyTo: group.replyTo });
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" } | { status: "failed"; message: string }>({ status: "idle" });
  const unchanged = chosen.sendPolicy === group.sendPolicy && chosen.replyTo === group.replyTo;
  const choose = (changes: Partial<typeof chosen>) => {
    setChosen((current) => ({ ...current, ...changes }));
    setState({ status: "idle" });
  };
  const save = async () => {
    setState({ status: "saving" });
    const answer = await change(client.PATCH("/groups/{group}", { params: { path: { group: group.address } }, body: chosen }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "saved" });
    onChanged();
  };
  const sendCopy = copy.sendPolicy;
  const replyCopy = copy.replyTo;
  return (
    <form
      className="group-policies"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset>
        <legend>{sendCopy.legend}</legend>
        <p className="setting-lead">{sendCopy.lead}</p>
        {sendPolicies.map((sendPolicy) => (
          <Choice
            key={sendPolicy}
            name={`send-policy-${group.address}`}
            checked={chosen.sendPolicy === sendPolicy}
            onChoose={() => choose({ sendPolicy })}
            label={sendCopy[sendPolicy]}
            hint={sendCopy[`${sendPolicy}Hint`]}
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>{replyCopy.legend}</legend>
        <p className="setting-lead">{replyCopy.lead}</p>
        {replyTos.map((replyTo) => (
          <Choice
            key={replyTo}
            name={`reply-to-${group.address}`}
            checked={chosen.replyTo === replyTo}
            onChoose={() => choose({ replyTo })}
            label={replyCopy[replyTo]}
            hint={replyCopy[`${replyTo}Hint`]}
          />
        ))}
      </fieldset>
      <div className="setting-foot">
        <button type="submit" className="button button-primary" disabled={unchanged || state.status === "saving"}>
          {state.status === "saving" ? copy.saving : copy.save}
        </button>
        <p role="status" className="setting-saved">
          {state.status === "saved" ? copy.saved : ""}
        </p>
      </div>
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** Deleting the group, which asks once in place. */
function DeleteGroup({ client, group, onDeleted, onSignedOut }: { client: DuvaClient; group: Group; onDeleted: () => void; onSignedOut: () => void }) {
  const [state, setState] = useState<{ status: "idle" | "confirming" | "deleting" } | { status: "failed"; message: string }>({ status: "idle" });
  const remove = async () => {
    setState({ status: "deleting" });
    const answer = await change(client.DELETE("/groups/{group}", { params: { path: { group: group.address } } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    onDeleted();
  };
  if (state.status === "confirming" || state.status === "deleting") {
    return (
      <div className="confirm person-remove" role="group" aria-label={copy.deleteWho(group.address)}>
        <p>{copy.deleteAsk(group.address)}</p>
        <div className="confirm-choices">
          <button type="button" className="button button-small button-reject" disabled={state.status === "deleting"} onClick={() => void remove()}>
            {copy.delete}
          </button>
          {/* The asking button is gone, so the question takes the focus, on its safe answer. */}
          <button type="button" className="button button-small button-quiet" autoFocus onClick={() => setState({ status: "idle" })}>
            {copy.cancel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="person-remove">
      <div>
        <button type="button" className="button button-small button-quiet" onClick={() => setState({ status: "confirming" })}>
          {copy.delete}
        </button>
      </div>
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

/** Creating a group with its address and first members. */
function CreateGroup({ client, domain, onCreated, onSignedOut }: { client: DuvaClient; domain?: string; onCreated: (address: string) => void; onSignedOut: () => void }) {
  const [address, setAddress] = useState("");
  const [members, setMembers] = useState("");
  const [state, setState] = useState<{ status: "idle" | "creating" } | { status: "failed"; message: string }>({ status: "idle" });
  const create = async () => {
    setState({ status: "creating" });
    const answer = await change(client.POST("/groups", { body: { address: address.trim(), members: addressesIn(members) } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    setAddress("");
    setMembers("");
    onCreated(answer.data.address);
  };
  return (
    <form
      className="setting setting-add"
      aria-labelledby="create-group"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="setting-part">
        <h3 id="create-group">{copy.create}</h3>
        <p className="setting-lead">{copy.createLead}</p>
      </div>
      <label className="setting-field">
        <span>{copy.address}</span>
        <input type="text" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder={copy.addressPlaceholder(domain)} value={address} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <label className="setting-field">
        <span>{copy.members}</span>
        <input type="text" inputMode="email" autoCapitalize="none" spellCheck={false} aria-describedby="create-group-hint" value={members} onChange={(event) => setMembers(event.target.value)} />
      </label>
      <p id="create-group-hint" className="hint">
        {copy.membersHint}
      </p>
      <div className="setting-foot">
        <button type="submit" className="button button-primary" disabled={address.trim() === "" || state.status === "creating"}>
          {state.status === "creating" ? copy.creating : copy.createButton}
        </button>
      </div>
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
