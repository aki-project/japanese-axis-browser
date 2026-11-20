import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseEntryId, type KnownCollections } from '@japanesesite/shared';
import { ApiClientError, getCollections, saveCollections } from '../api/client.js';
import { SESSION_QUERY_KEY, useSession } from './useSession.js';

/**
 * The in-memory table of known entries: one set of known kanji and one
 * of known vocabulary, keyed by entry ID. It is loaded from the
 * logged-in user's saved blob, edited here, and saved back whole only
 * when the learner presses Save: the blob can be large, so edits are
 * never sent automatically.
 */
export interface KnownTable {
  kanji: ReadonlySet<string>;
  vocab: ReadonlySet<string>;
}

/**
 * - `inactive`: logged out (or no provider); nothing is shown.
 * - `loading` / `error`: the saved blob is being loaded or failed to load;
 *   editing is off so a partial table can never overwrite the saved one.
 * - `ready`: loaded and editable.
 */
export type KnownStatus = 'inactive' | 'loading' | 'error' | 'ready';

/** Whether the table matches what was last saved. */
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';

export interface KnownEntriesValue {
  status: KnownStatus;
  saveState: SaveState;
  isKnown: (entryId: string) => boolean;
  toggle: (entryId: string) => void;
  /** Saves unsaved edits (the Save button). Resolves true once the server has them all. */
  save: () => Promise<boolean>;
  /** Replaces the table with the user's saved blob, discarding unsaved changes. */
  load: () => Promise<void>;
}

const EMPTY_TABLE: KnownTable = { kanji: new Set(), vocab: new Set() };

const INACTIVE: KnownEntriesValue = {
  status: 'inactive',
  saveState: 'saved',
  isKnown: () => false,
  toggle: () => {},
  save: () => Promise.resolve(true),
  load: () => Promise.resolve(),
};

const KnownEntriesContext = createContext<KnownEntriesValue>(INACTIVE);

/** How many times a save that hits a version conflict reloads and retries. */
const MAX_CONFLICT_RETRIES = 3;

export function tableFromCollections(c: KnownCollections): KnownTable {
  return { kanji: new Set(c.kanji), vocab: new Set(c.vocab) };
}

export function collectionsFromTable(t: KnownTable): KnownCollections {
  return { kanji: [...t.kanji].sort(), vocab: [...t.vocab].sort() };
}

function collectionKey(entryId: string): 'kanji' | 'vocab' | null {
  const parsed = parseEntryId(entryId);
  if (!parsed) return null;
  return parsed.kind === 'kanji' ? 'kanji' : 'vocab';
}

/** The table with `entryId` marked known or unknown. */
export function setInTable(table: KnownTable, entryId: string, known: boolean): KnownTable {
  const key = collectionKey(entryId);
  if (!key || table[key].has(entryId) === known) return table;
  const next = new Set(table[key]);
  if (known) next.add(entryId);
  else next.delete(entryId);
  return { ...table, [key]: next };
}

/** The table with `entryId` added if absent, removed if present. */
export function toggleInTable(table: KnownTable, entryId: string): KnownTable {
  const key = collectionKey(entryId);
  if (!key) return table;
  return setInTable(table, entryId, !table[key].has(entryId));
}

/** `table` with every pending edit (entry ID -> known) applied on top. */
export function applyEdits(table: KnownTable, edits: ReadonlyMap<string, boolean>): KnownTable {
  let next = table;
  for (const [entryId, known] of edits) next = setInTable(next, entryId, known);
  return next;
}

function isStatus(error: unknown, status: number): error is ApiClientError {
  return error instanceof ApiClientError && error.status === status;
}

export function KnownEntriesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useSession();
  const username = session.data?.user?.username ?? null;

  const [table, setTable] = useState<KnownTable>(EMPTY_TABLE);
  const [status, setStatus] = useState<KnownStatus>('inactive');
  const [saveState, setSaveState] = useState<SaveState>('saved');

  // Refs hold what async saves need to read at the moment they run.
  const tableRef = useRef(table);
  const usernameRef = useRef(username);
  usernameRef.current = username;
  /** Version of the server blob the table was loaded from or last saved as. */
  const versionRef = useRef(0);
  /** Edits not yet confirmed by the server: entry ID -> known. */
  const pendingRef = useRef(new Map<string, boolean>());
  /** The save in progress, so only one runs at a time. */
  const inFlight = useRef<Promise<boolean> | null>(null);
  /** Set when Save is pressed again during a save, or after a conflict reload, so it saves again. */
  const saveAgain = useRef(false);
  // Bumped on every load or logout, so a stale load or save cannot land.
  const generation = useRef(0);

  const replaceTable = useCallback((next: KnownTable) => {
    tableRef.current = next;
    setTable(next);
  }, []);

  /** The session ended or changed under us: refetch it, which reloads or clears the table. */
  const sessionLost = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [queryClient]);

  const runSave = useCallback(async (): Promise<boolean> => {
    const gen = generation.current;
    const user = usernameRef.current;
    if (!user) return false;
    let conflicts = 0;
    let failed = false;
    setSaveState('saving');
    do {
      saveAgain.current = false;
      const sent = new Map(pendingRef.current);
      try {
        const saved = await saveCollections({
          username: user,
          version: versionRef.current,
          collections: collectionsFromTable(tableRef.current),
        });
        if (gen !== generation.current) return false;
        versionRef.current = saved.version;
        // Confirmed, unless the entry was toggled again since.
        for (const [id, known] of sent) {
          if (pendingRef.current.get(id) === known) pendingRef.current.delete(id);
        }
      } catch (error) {
        if (gen !== generation.current) return false;
        if (isStatus(error, 409) && error.code === 'COLLECTIONS_CONFLICT') {
          if (++conflicts > MAX_CONFLICT_RETRIES) {
            failed = true;
            break;
          }
          // Saved elsewhere (another tab): take the server's blob and
          // replay this page's unsaved edits on top of it.
          try {
            const latest = await getCollections();
            if (gen !== generation.current) return false;
            versionRef.current = latest.version;
            replaceTable(applyEdits(tableFromCollections(latest.collections), pendingRef.current));
            saveAgain.current = true;
            continue;
          } catch {
            failed = true;
            break;
          }
        }
        if (isStatus(error, 401) || (isStatus(error, 409) && error.code === 'SESSION_CHANGED')) {
          sessionLost();
        }
        failed = true;
        break;
      }
    } while (saveAgain.current);

    if (gen !== generation.current) return false;
    const done = pendingRef.current.size === 0;
    setSaveState(done ? 'saved' : failed ? 'failed' : 'unsaved');
    return done;
  }, [replaceTable, sessionLost]);

  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) {
      saveAgain.current = true;
      return inFlight.current;
    }
    if (pendingRef.current.size === 0) return Promise.resolve(true);
    const run = runSave().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [runSave]);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    pendingRef.current = new Map();
    setStatus('loading');
    try {
      const response = await getCollections();
      if (gen !== generation.current) return;
      versionRef.current = response.version;
      replaceTable(tableFromCollections(response.collections));
      setSaveState('saved');
      setStatus('ready');
    } catch (error) {
      if (gen !== generation.current) return;
      if (isStatus(error, 401)) sessionLost();
      setStatus('error');
    }
  }, [replaceTable, sessionLost]);

  // Load on login (or a change of user); drop the table on logout.
  useEffect(() => {
    if (username) {
      void load();
      return;
    }
    generation.current += 1;
    pendingRef.current = new Map();
    versionRef.current = 0;
    replaceTable(EMPTY_TABLE);
    setSaveState('saved');
    setStatus('inactive');
  }, [username, load, replaceTable]);

  // Warn before leaving the page while the server is behind it.
  useEffect(() => {
    if (saveState === 'saved') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  const toggle = useCallback(
    (entryId: string) => {
      if (status !== 'ready' || !collectionKey(entryId)) return;
      const next = toggleInTable(tableRef.current, entryId);
      pendingRef.current.set(entryId, next.kanji.has(entryId) || next.vocab.has(entryId));
      replaceTable(next);
      // During a save the state stays 'saving'; edits made meanwhile are
      // still pending afterwards and leave it 'unsaved'.
      setSaveState((s) => (s === 'saving' ? s : 'unsaved'));
    },
    [status, replaceTable],
  );

  const value = useMemo<KnownEntriesValue>(
    () =>
      status === 'inactive'
        ? INACTIVE
        : {
            status,
            saveState,
            isKnown: (entryId) => table.kanji.has(entryId) || table.vocab.has(entryId),
            toggle,
            save,
            load,
          },
    [status, saveState, table, toggle, save, load],
  );

  return <KnownEntriesContext.Provider value={value}>{children}</KnownEntriesContext.Provider>;
}

export function useKnownEntries(): KnownEntriesValue {
  return useContext(KnownEntriesContext);
}
