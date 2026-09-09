import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Link,
  MemoryRouter,
  NavigationType,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router';
import { reconcileTrail, TrailProvider, useTrail } from './useTrail.js';
import { Trail } from '../components/Trail.js';

describe('reconcileTrail', () => {
  it('appends on PUSH even when the entry id repeats (a legitimate cycle)', () => {
    const afterA = reconcileTrail([], NavigationType.Push, { key: 'k0', entryId: 'a', index: 0 });
    const afterB = reconcileTrail(afterA, NavigationType.Push, { key: 'k1', entryId: 'b', index: 1 });
    const afterA2 = reconcileTrail(afterB, NavigationType.Push, { key: 'k2', entryId: 'a', index: 2 });

    expect(afterA2).toEqual([
      { key: 'k0', entryId: 'a', index: 0 },
      { key: 'k1', entryId: 'b', index: 1 },
      { key: 'k2', entryId: 'a', index: 2 },
    ]);
  });

  it('truncates back to the matching location key on POP', () => {
    const trail = [
      { key: 'k0', entryId: 'a', index: 0 },
      { key: 'k1', entryId: 'b', index: 1 },
      { key: 'k2', entryId: 'a', index: 2 },
    ];
    const result = reconcileTrail(trail, NavigationType.Pop, { key: 'k1', entryId: 'b', index: 1 });
    expect(result).toEqual([
      { key: 'k0', entryId: 'a', index: 0 },
      { key: 'k1', entryId: 'b', index: 1 },
    ]);
  });

  it('appends on POP to an unrecorded key at a later point in history', () => {
    const trail = [{ key: 'k0', entryId: 'a', index: 0 }];
    const result = reconcileTrail(trail, NavigationType.Pop, { key: 'k9', entryId: 'z', index: 5 });
    expect(result).toEqual([
      { key: 'k0', entryId: 'a', index: 0 },
      { key: 'k9', entryId: 'z', index: 5 },
    ]);
  });

  it('resets to a single step on POP to an unrecorded key at an earlier point in history', () => {
    // This is the reload-then-back case: the trail only knows about "b"
    // (index 5, e.g. recorded fresh after a reload), and the browser pops
    // back to some earlier location the trail never recorded. Appending
    // here would produce a reversed-looking trail; the fix starts over.
    const trail = [{ key: 'k5', entryId: 'b', index: 5 }];
    const result = reconcileTrail(trail, NavigationType.Pop, { key: 'k4', entryId: 'a', index: 4 });
    expect(result).toEqual([{ key: 'k4', entryId: 'a', index: 4 }]);
  });

  it('appends on POP to an unrecorded key when the history index cannot be determined', () => {
    const trail = [{ key: 'k0', entryId: 'a', index: null }];
    const result = reconcileTrail(trail, NavigationType.Pop, { key: 'k9', entryId: 'z', index: null });
    expect(result).toEqual([
      { key: 'k0', entryId: 'a', index: null },
      { key: 'k9', entryId: 'z', index: null },
    ]);
  });

  it('replaces the last step on REPLACE', () => {
    const trail = [{ key: 'k0', entryId: 'a', index: 0 }];
    const result = reconcileTrail(trail, NavigationType.Replace, { key: 'k0b', entryId: 'a2', index: 0 });
    expect(result).toEqual([{ key: 'k0b', entryId: 'a2', index: 0 }]);
  });
});

function TrailReadout() {
  const trail = useTrail();
  return <div data-testid="trail">{trail.map((step) => step.entryId).join(',')}</div>;
}

function Screen() {
  const { entryId } = useParams<{ entryId: string }>();
  const navigate = useNavigate();
  return (
    <TrailProvider entryId={entryId ?? ''}>
      <Trail />
      <TrailReadout />
      <Link to="/e/a">Go to a</Link>
      <Link to="/e/b">Go to b</Link>
      <Link to="/e/c">Go to c</Link>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </TrailProvider>
  );
}

function renderApp(initialEntries: string[]) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/e/:entryId" element={<Screen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('useTrail (integration)', () => {
  it('pushes onto the trail when navigating to a new entry', async () => {
    const user = userEvent.setup();
    renderApp(['/e/a']);

    expect(screen.getByTestId('trail').textContent).toBe('a');

    await user.click(screen.getByText('Go to b'));
    expect(screen.getByTestId('trail').textContent).toBe('a,b');
  });

  it('keeps a cycle as three steps instead of collapsing it', async () => {
    const user = userEvent.setup();
    renderApp(['/e/a']);

    await user.click(screen.getByText('Go to b'));
    await user.click(screen.getByText('Go to a'));

    expect(screen.getByTestId('trail').textContent).toBe('a,b,a');
  });

  it('shortens the trail by exactly one step when going back', async () => {
    const user = userEvent.setup();
    renderApp(['/e/a']);

    await user.click(screen.getByText('Go to b'));
    await user.click(screen.getByText('Go to c'));
    expect(screen.getByTestId('trail').textContent).toBe('a,b,c');

    await user.click(screen.getByText('Back'));
    expect(screen.getByTestId('trail').textContent).toBe('a,b');
  });

  it('truncates the trail to the clicked breadcrumb step', async () => {
    const user = userEvent.setup();
    renderApp(['/e/a']);

    await user.click(screen.getByText('Go to b'));
    await user.click(screen.getByText('Go to c'));
    expect(screen.getByTestId('trail').textContent).toBe('a,b,c');

    // The breadcrumb strip renders every non-current step as a button.
    const nav = screen.getByRole('navigation', { name: 'Trail' });
    await user.click(screen.getAllByRole('button', { name: 'a' })[0] as HTMLElement);

    expect(screen.getByTestId('trail').textContent).toBe('a');
    expect(nav).toBeDefined();
  });

  it('starts fresh with only the current entry on mount', () => {
    renderApp(['/e/b']);
    expect(screen.getByTestId('trail').textContent).toBe('b');
  });
});

describe('useTrail (reload then back)', () => {
  it('resets to a single step instead of reversing, and Backspace then does nothing', async () => {
    const user = userEvent.setup();
    const attemptNavigate = vi.fn();

    function BackspaceButton() {
      const trail = useTrail();
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => {
            // Mirrors EntryPage's own guard: only step back when the
            // trail has recorded more than the current entry.
            if (trail.length > 1) {
              attemptNavigate();
              navigate(-1);
            }
          }}
        >
          Backspace
        </button>
      );
    }

    function InnerScreen() {
      const { entryId } = useParams<{ entryId: string }>();
      const navigate = useNavigate();
      return (
        <TrailProvider entryId={entryId ?? ''}>
          <TrailReadout />
          <Link to="/e/b">Go to b</Link>
          <button type="button" onClick={() => navigate(-1)}>
            Browser back
          </button>
          <BackspaceButton />
        </TrailProvider>
      );
    }

    function Harness() {
      // Remounting just this subtree (via the changing key below)
      // simulates a page reload: the browser's real history stack and
      // its current index survive, but our in-memory trail forgets
      // everything and starts over with just the current entry.
      const [reloadCount, setReloadCount] = useState(0);
      return (
        <Routes>
          <Route
            path="/e/:entryId"
            element={
              <div>
                <button type="button" onClick={() => setReloadCount((c) => c + 1)}>
                  simulate reload
                </button>
                <InnerScreen key={reloadCount} />
              </div>
            }
          />
        </Routes>
      );
    }

    const queryClient = new QueryClient();
    window.history.replaceState({ idx: 0 }, '');
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/e/a']}>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('trail').textContent).toBe('a');

    // Follow a link (PUSH): the real browser's history index would move
    // to 1.
    window.history.pushState({ idx: 1 }, '');
    await user.click(screen.getByText('Go to b'));
    expect(screen.getByTestId('trail').textContent).toBe('a,b');

    // Simulate a reload while still on b: the trail forgets "a" even
    // though the browser's own history (and its index, still 1) does not.
    await user.click(screen.getByText('simulate reload'));
    expect(screen.getByTestId('trail').textContent).toBe('b');

    // The visitor presses the browser's own Back button. The real
    // browser would already have decremented its stored index by the
    // time our code observes the resulting POP.
    window.history.replaceState({ idx: 0 }, '');
    await user.click(screen.getByText('Browser back'));

    // Bug (before the fix): this produced "b,a" — a reversed trail.
    // Fixed: the earlier, unrecorded history index resets the trail
    // instead of appending onto it.
    expect(screen.getByTestId('trail').textContent).toBe('a');

    await user.click(screen.getByText('Backspace'));
    expect(attemptNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('trail').textContent).toBe('a');
  });
});
