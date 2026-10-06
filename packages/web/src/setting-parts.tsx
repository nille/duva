// The parts Settings' sheets share: a choice, a whole number typed, and the chevron of a line that opens.

/** A choice in a setting: a box holding its radio, its name and what it means. */
export function Choice({ name, checked, onChoose, label, hint }: { name: string; checked: boolean; onChoose: () => void; label: string; hint: string }) {
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
