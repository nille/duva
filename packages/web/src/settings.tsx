// Settings: the organization's, which admins choose for everyone, on a sheet of their own. A human's
// own preferences join them here as a section of their own.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type OrganizationSettings = components["schemas"]["OrganizationSettings"];

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; settings: OrganizationSettings };
type Saving = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "failed"; message: string };

/** The settings view. Every human can read the organization's settings, but only an admin changes them. */
export function Settings({ client, admin, onSignedOut }: { client: DuvaClient; admin: boolean; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  const [chosen, setChosen] = useState<boolean>();
  const [saving, setSaving] = useState<Saving>({ status: "idle" });

  const load = useCallback(async () => {
    setRead({ status: "loading" });
    const { data, response } = await client.GET("/organization/settings").catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setRead({ status: "failed", message: response === undefined ? strings.settings.unreachable : strings.settings.failed(response.status) });
    setRead({ status: "read", settings: data });
    setChosen(data.erasureErasesApprovals);
  }, [client, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title = strings.title(strings.settings.title);
  }, []);

  const save = async () => {
    if (chosen === undefined) return;
    setSaving({ status: "saving" });
    const { data, response } = await client
      .PATCH("/organization/settings", { body: { erasureErasesApprovals: chosen } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setSaving({ status: "failed", message: response === undefined ? strings.settings.saveUnreachable : strings.settings.saveFailed(response.status) });
    setRead({ status: "read", settings: data });
    setSaving({ status: "saved" });
  };

  const choose = (value: boolean) => {
    setChosen(value);
    setSaving({ status: "idle" });
  };

  const copy = strings.settings.erasure;
  return (
    <main className="desk" aria-busy={read.status === "loading"}>
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {strings.settings.title}
        </h1>
      </div>
      {read.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{read.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : (
        <section className="settings" aria-labelledby="organization-settings">
          <div className="settings-head">
            <h2 id="organization-settings">{strings.settings.organization}</h2>
            <p>{strings.settings.organizationLead}</p>
          </div>
          {read.status === "read" && (
            <form
              className="setting"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={!admin}>
                <legend>{copy.legend}</legend>
                <p className="setting-lead">{copy.lead}</p>
                {([false, true] as const).map((value) => (
                  <label className="choice" key={String(value)}>
                    <input type="radio" name="erasureErasesApprovals" checked={chosen === value} onChange={() => choose(value)} />
                    <span className="choice-text">
                      <span className="choice-name">{value ? copy.erase : copy.keep}</span>
                      <span className="hint">{value ? copy.eraseHint : copy.keepHint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {admin ? (
                <div className="setting-foot">
                  <button type="submit" className="button button-primary" disabled={chosen === read.settings.erasureErasesApprovals || saving.status === "saving"}>
                    {saving.status === "saving" ? strings.settings.saving : strings.settings.save}
                  </button>
                  <p role="status" className="setting-saved">
                    {saving.status === "saved" ? strings.settings.saved : ""}
                  </p>
                </div>
              ) : (
                <p className="setting-foot">{strings.settings.onlyAdmins}</p>
              )}
              {saving.status === "failed" && (
                <p className="notice notice-alert" role="alert">
                  {saving.message}
                </p>
              )}
            </form>
          )}
        </section>
      )}
    </main>
  );
}
