import { useId } from 'react';
import type { VisibleApp } from './types';

/** A labelled select of the applications the person may see. */
export function AppPicker({
  apps,
  value,
  onChange,
  allLabel,
  label = 'Application',
}: {
  apps: VisibleApp[];
  value: string;
  onChange: (appId: string) => void;
  /** An option for every application at once, when the page offers one. */
  allLabel?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {apps.map((app) => (
          <option key={app.appId} value={app.appId}>
            {app.system ? `${app.name} (its own log)` : `${app.name} (${app.environment})`}
          </option>
        ))}
      </select>
    </div>
  );
}
