import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { EntryResponse, LinksResponse } from '@japanesesite/shared';
import type * as ApiClientModule from '../api/client.js';
import type * as ReactRouterModule from 'react-router';
import { TrailProvider } from '../hooks/useTrail.js';
import { EntryPage } from './EntryPage.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    getEntry: vi.fn(),
    getLinks: vi.fn(),
  };
});

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));

// Only useNavigate is swapped for a spy; everything else (Link, Routes,
// MemoryRouter, ...) keeps its real implementation, so <Link> clicks still
// navigate for real while EntryPage's own `navigate(-1)` call is observable.
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

import { getEntry, getLinks } from '../api/client.js';

const mockedGetEntry = vi.mocked(getEntry);
const mockedGetLinks = vi.mocked(getLinks);

const kanjiEntry: EntryResponse = {
  kind: 'kanji',
  entryId: 'k:日',
  kanji: {
    literal: '日',
    onReadings: ['ニチ'],
    kunReadings: ['ひ'],
    meanings: ['day', 'sun'],
    strokeCount: 4,
    radical: '日',
    components: [],
    etymology: null,
    jlptLevel: 'N5',
    frequency: 1,
  },
  sentences: [],
  linkCounts: { semantic: 1, phonetic: 0, structural: 1 },
};

const linksResponse: LinksResponse = {
  entryId: 'k:日',
  axes: [
    {
      axis: 'semantic',
      total: 1,
      relations: [
        {
          relation: 'synonym',
          entries: [
            {
              relation: 'synonym',
              weight: 1,
              entry: {
                entryId: 'w:1',
                kind: 'word',
                surface: '太陽',
                reading: 'たいよう',
                meanings: ['sun'],
                jlptLevel: 'N3',
              },
              via: [],
            },
          ],
        },
      ],
      nextCursor: null,
    },
    { axis: 'phonetic', total: 0, relations: [], nextCursor: null },
    {
      axis: 'structural',
      total: 1,
      relations: [
        {
          relation: 'shared_radical',
          entries: [
            {
              relation: 'shared_radical',
              weight: null,
              entry: {
                entryId: 'k:明',
                kind: 'kanji',
                surface: '明',
                reading: '',
                meanings: ['bright'],
                jlptLevel: 'N4',
              },
              via: ['日'],
            },
          ],
        },
      ],
      nextCursor: null,
    },
  ],
};

function renderEntryPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/e/k:日']}>
        <TrailProvider entryId="k:日">
          <EntryPage entryId="k:日" />
        </TrailProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntryPage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders a mocked kanji entry and its links grouped by axis', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockResolvedValue(linksResponse);

    renderEntryPage();

    expect(await screen.findByText('day')).toBeInTheDocument();
    expect(screen.getAllByText('日').length).toBeGreaterThan(0);

    // Axis panels, each with heading + count from linkCounts.
    expect(screen.getByRole('heading', { name: /Semantic/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Phonetic/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Structural/ })).toBeInTheDocument();

    // Links resolve and group under their relation.
    await waitFor(() => {
      expect(screen.getByText('太陽')).toBeInTheDocument();
    });
    expect(screen.getByText('明')).toBeInTheDocument();
    expect(screen.getByText('synonym')).toBeInTheDocument();

    // Empty axis gets its own message.
    expect(screen.getByText(/No phonetic links for this entry/)).toBeInTheDocument();
  });

  it('shows each linked entry with its first gloss, and phonetic links with the shared reading', async () => {
    mockedGetEntry.mockResolvedValue({
      ...kanjiEntry,
      linkCounts: { semantic: 1, phonetic: 1, structural: 1 },
    });
    mockedGetLinks.mockResolvedValue({
      ...linksResponse,
      axes: linksResponse.axes.map((group) =>
        group.axis === 'phonetic'
          ? {
              ...group,
              total: 1,
              relations: [
                {
                  relation: 'shared_kun_reading',
                  entries: [
                    {
                      relation: 'shared_kun_reading',
                      weight: 0.5,
                      entry: {
                        entryId: 'k:火',
                        kind: 'kanji',
                        surface: '火',
                        reading: 'カ',
                        meanings: ['fire'],
                        jlptLevel: 'N5',
                      },
                      via: ['ひ'],
                    },
                  ],
                },
              ],
            }
          : group,
      ),
    });

    renderEntryPage();

    expect(await screen.findByText('太陽')).toBeInTheDocument();
    expect(screen.getByText('太陽').closest('a')).toHaveTextContent('sun');
    expect(screen.getByText('明').closest('a')).toHaveTextContent('bright');

    const fireLink = (await screen.findByText('火')).closest('a');
    expect(fireLink).toHaveTextContent('fire');
    expect(fireLink).toHaveTextContent('カ');
    expect(fireLink).toHaveTextContent('shared ひ');

    // The shared radical label is not shown as a reading off the phonetic axis.
    expect(screen.getByText('明').closest('a')).not.toHaveTextContent('shared');
  });

  it('sends the JLPT filter to the API and shows its filtered totals and a distinct no-match message', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    // Stands in for the API's filtering: 太陽 is N3, 明 is N4, so with N4
    // off the structural axis comes back empty with a total of 0.
    mockedGetLinks.mockImplementation((_entryId, params) => {
      const hidesN4 = params.jlpt !== undefined && !params.jlpt.includes('N4');
      return Promise.resolve({
        ...linksResponse,
        axes: linksResponse.axes.map((group) =>
          group.axis === 'structural' && hidesN4 ? { ...group, total: 0, relations: [] } : group,
        ),
      });
    });

    window.localStorage.setItem(
      'japanesesite:jlptFilter',
      JSON.stringify({ N5: true, N4: false, N3: true, N2: true, N1: true, none: true }),
    );

    renderEntryPage();

    expect(await screen.findByText('太陽')).toBeInTheDocument();
    expect(mockedGetLinks).toHaveBeenCalledWith('k:日', {
      axis: ['structural'],
      jlpt: ['N5', 'N3', 'N2', 'N1', 'none'],
    });

    // Filtered total from the links response, against the entry's unfiltered count.
    expect(screen.getByRole('heading', { name: /Semantic/ })).toHaveTextContent('(1 of 1)');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Structural/ })).toHaveTextContent('(0 of 1)');
    });
    expect(screen.queryByText('明')).not.toBeInTheDocument();

    // Distinct from the "no links at all" empty state.
    expect(screen.getByText(/No structural links match the JLPT filter/)).toBeInTheDocument();
    expect(screen.getByText(/No phonetic links for this entry/)).toBeInTheDocument();
  });

  it('fetches no links and says so when every JLPT level is off', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockClear();
    mockedGetLinks.mockResolvedValue(linksResponse);
    window.localStorage.setItem(
      'japanesesite:jlptFilter',
      JSON.stringify({ N5: false, N4: false, N3: false, N2: false, N1: false, none: false }),
    );

    renderEntryPage();

    expect(await screen.findByRole('heading', { name: /Semantic/ })).toHaveTextContent('(0 of 1)');
    expect(screen.getAllByText('No JLPT levels selected.')).toHaveLength(2);
    expect(screen.getByText(/No phonetic links for this entry/)).toBeInTheDocument();
    expect(mockedGetLinks).not.toHaveBeenCalled();
  });

  it('shows the plain count, not "x of y", when the filter is inactive', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockResolvedValue(linksResponse);

    renderEntryPage();

    expect(await screen.findByText('太陽')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Semantic/ })).toHaveTextContent('(1)');
    expect(screen.getByRole('heading', { name: /Semantic/ })).not.toHaveTextContent('of');
  });

  it('does not navigate on Backspace when the trail only has one entry', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockResolvedValue(linksResponse);
    navigateSpy.mockClear();

    renderEntryPage();
    await screen.findByText('day');

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('navigates back on Backspace once the trail has more than one entry', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockResolvedValue(linksResponse);
    navigateSpy.mockClear();

    const user = userEvent.setup();
    renderEntryPage();
    await screen.findByText('day');

    // Follow a real link (Link's own click handling is untouched by the
    // useNavigate mock) so the trail grows to two entries.
    await user.click(await screen.findByText('太陽'));

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });
});
