import { useKnownEntries } from '../hooks/useKnownEntries.js';

/**
 * Marks an entry known or unknown in the logged-in user's collections.
 * Renders nothing when logged out; disabled until the saved collections
 * have loaded, so a partial table can never be saved over them.
 */
export function KnownCheckbox({
  entryId,
  label,
  className,
}: {
  entryId: string;
  /** The entry's surface form, for the accessible name. */
  label: string;
  className?: string;
}) {
  const known = useKnownEntries();
  if (known.status === 'inactive') return null;
  return (
    <input
      type="checkbox"
      aria-label={`Known: ${label}`}
      checked={known.isKnown(entryId)}
      disabled={known.status !== 'ready'}
      onChange={() => known.toggle(entryId)}
      className={`h-4 w-4 shrink-0 accent-blue-600${className ? ` ${className}` : ''}`}
    />
  );
}
