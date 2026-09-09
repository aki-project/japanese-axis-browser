import { useNavigate } from 'react-router';
import { AXES, isEntryId, type Axis } from '@japanesesite/shared';
import { ApiClientError } from '../api/client.js';
import { useEntry } from '../hooks/useEntry.js';
import { useAxisLinks, type AxisLinksResult } from '../hooks/useLinks.js';
import { useAxisVisibility } from '../hooks/useAxisVisibility.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';
import { useTrail } from '../hooks/useTrail.js';
import { AxisPanel } from '../components/AxisPanel.js';
import { AxisToggleBar } from '../components/AxisToggleBar.js';
import { EntryDetails } from '../components/EntryDetails.js';
import { EntrySkeleton } from '../components/EntrySkeleton.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { NotFoundScreen } from '../components/NotFoundScreen.js';
import { Trail } from '../components/Trail.js';

export function EntryPage({ entryId }: { entryId: string }) {
  const navigate = useNavigate();
  const trail = useTrail();
  const { visibility, toggle } = useAxisVisibility();

  const validId = isEntryId(entryId);
  const entryQuery = useEntry(entryId);

  // One infinite query per axis (fixed, not looped) so a cursor always
  // names exactly one axis and pending/pagination state is per-axis.
  const semanticLinks = useAxisLinks(entryId, 'semantic', visibility.semantic);
  const phoneticLinks = useAxisLinks(entryId, 'phonetic', visibility.phonetic);
  const structuralLinks = useAxisLinks(entryId, 'structural', visibility.structural);
  const linksByAxis: Record<Axis, AxisLinksResult> = {
    semantic: semanticLinks,
    phonetic: phoneticLinks,
    structural: structuralLinks,
  };

  useKeyboardNav({
    onBack: () => {
      // Never navigate past the first entry the trail has recorded.
      if (trail.length > 1) navigate(-1);
    },
    onToggleAxis: toggle,
  });

  if (!validId) {
    return <NotFoundScreen message={`"${entryId}" is not a valid entry id.`} />;
  }

  if (entryQuery.isPending) {
    return <EntrySkeleton />;
  }

  if (entryQuery.isError) {
    const error = entryQuery.error;
    if (error instanceof ApiClientError && error.status === 404) {
      return <NotFoundScreen message={`No entry found for "${entryId}".`} />;
    }
    return (
      <ErrorScreen
        message={error instanceof Error ? error.message : 'Could not load this entry.'}
        onRetry={() => void entryQuery.refetch()}
      />
    );
  }

  const entry = entryQuery.data;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <Trail />
      <EntryDetails entry={entry} />
      <AxisToggleBar visibility={visibility} onToggle={toggle} />
      <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        {AXES.map((axis) => {
          const links = linksByAxis[axis];
          return (
            <AxisPanel
              key={axis}
              axis={axis}
              count={entry.linkCounts[axis]}
              isVisible={visibility[axis]}
              group={links.group}
              isLoading={links.isLoading}
              isError={links.isError}
              hasNextPage={links.hasNextPage}
              isFetchingNextPage={links.isFetchingNextPage}
              onLoadMore={links.fetchNextPage}
            />
          );
        })}
      </div>
    </div>
  );
}
