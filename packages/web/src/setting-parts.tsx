// The parts Settings' sheets share: a choice, a measured model's flag and what it measured, a
// whole number typed, and the chevron of a line that opens.
import type { ReactNode } from "react";
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

/** A choice in a setting: a box holding its radio, its name and what it means. */
export function Choice({ name, checked, onChoose, label, hint }: { name: string; checked: boolean; onChoose: () => void; label: ReactNode; hint: ReactNode }) {
  return (
    <label className="choice">
      <input type="radio" name={name} checked={checked} onChange={onChoose} />
      <span className="choice-text">
        <span className="choice-name">{label}</span>
        <span className="hint">{hint}</span>
      </span>
    </label>
  );
}

/** The number typed, if it is a whole number from 1 to `most`, as Duva takes a send limit or a cap. */
export function wholeNumber(text: string, most: number): number | undefined {
  const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
  return value !== undefined && value >= 1 && value <= most ? value : undefined;
}

/** The chevron at the end of a line that opens, turned while it is open. */
export const ChevronIcon = () => (
  <svg className="icon agent-chevron" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.5 6 3.5 3.5L11.5 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type MeasuredModel = components["schemas"]["MeasuredModel"];

/** Whether Bedrock processes what the model reads outside the continent Duva is deployed on. */
export const outsideContinent = ({ processedIn }: MeasuredModel) => processedIn === "us" || processedIn === "anywhere";

/** The small flag beside a model that says where Bedrock processes what it reads of the mail (ADR-0035). */
export function ModelPlace({ model }: { model: MeasuredModel }) {
  return (
    <span className="model-place" data-outside={outsideContinent(model) || undefined}>
      <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 14s4.5-4.2 4.5-7.7a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="8" cy="6.3" r="1.5" fill="currentColor" />
      </svg>
      <span aria-hidden="true">{strings.settings.modelPlace(model.processedIn, model.profileId, model.region)}</span>
      <span className="visually-hidden">, processed {strings.settings.modelPlaceSaid(model.processedIn, model.profileId, model.region)}</span>
    </span>
  );
}

/** A measured model's name with its flag beside it, as a choice names it. */
export const ModelName = ({ model }: { model: MeasuredModel }) => (
  <span className="model-name">
    {model.name}
    <ModelPlace model={model} />
  </span>
);
