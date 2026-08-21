import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * A dropdown that toggles values on click.
 *
 * Replaces `<select multiple>`, which shows an always-open scrolling box, needs
 * ctrl-click nobody discovers, and loses the whole selection on a stray click.
 *
 * Options carry live counts and are supplied already filtered by the other
 * active filters, so nothing offered here can produce an empty table. An option
 * with no matches is simply absent — except one that is currently selected,
 * which stays visible at zero so it can be turned off again.
 */

export interface Option {
  value: string;
  label: string;
  count: number;
}

export function MultiSelect({
  label, options, selected, onChange, placeholder = 'Any',
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocument = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocument);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocument);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const chosen = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => !q || o.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    onChange(chosen.has(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]);
  };

  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]!
      : `${selected.length} selected`;

  return (
    <div className="ms" ref={wrap}>
      <span className="ms-label">{label}</span>

      <button
        type="button"
        className={`ms-trigger${selected.length > 0 ? ' is-set' : ''}`}
        // Named for the dimension, not its current value: without this the
        // button announces itself as "Any", which is neither findable nor
        // meaningful to a screen reader.
        aria-label={`${label}: ${summary}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ms-summary">{summary}</span>
        <span className="ms-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="ms-panel" role="dialog" aria-label={label}>
          {options.length > 8 && (
            <input
              className="ms-search"
              type="text"
              placeholder="Filter…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          )}

          <div className="ms-options" id={listId} role="listbox" aria-multiselectable="true">
            {visible.map((o) => {
              const on = chosen.has(o.value);
              return (
                <button
                  type="button"
                  key={o.value}
                  role="option"
                  aria-selected={on}
                  className={`ms-option${on ? ' is-on' : ''}`}
                  onClick={() => toggle(o.value)}
                >
                  <span className={`ms-box${on ? ' is-on' : ''}`} aria-hidden="true" />
                  <span className="ms-text">{o.label}</span>
                  <span className="ms-count">{o.count}</span>
                </button>
              );
            })}

            {visible.length === 0 && (
              <p className="ms-empty">
                {options.length === 0
                  ? 'Nothing here matches the other filters.'
                  : 'No option matches that.'}
              </p>
            )}
          </div>

          {selected.length > 0 && (
            <button type="button" className="ms-clear" onClick={() => onChange([])}>
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
