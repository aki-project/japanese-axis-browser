import { useId, useState, type FormEvent } from 'react';
import { ApiClientError } from '../api/client.js';
import { useKnownEntries, type SaveState } from '../hooks/useKnownEntries.js';
import { useLogin, useLogout, useRegister, useSession } from '../hooks/useSession.js';

type FormMode = 'login' | 'register';

const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Save failed',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function AccountForm({ mode, onDone }: { mode: FormMode; onDone: () => void }) {
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const mutation = mode === 'login' ? loginMutation : registerMutation;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [eraDate, setEraDate] = useState('');
  const id = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const onSuccess = () => onDone();
    if (mode === 'login') loginMutation.mutate({ username, password }, { onSuccess });
    else registerMutation.mutate({ username, password, eraDate }, { onSuccess });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={mode === 'login' ? 'Log in' : 'Register'}
      className="absolute right-0 z-20 mt-1 flex w-72 flex-col gap-2 rounded border border-slate-200 bg-white p-3 text-sm shadow-lg"
    >
      <label htmlFor={`${id}-user`} className="text-xs font-medium text-slate-600">
        Username
      </label>
      <input
        id={`${id}-user`}
        autoComplete="username"
        required
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1"
      />
      <label htmlFor={`${id}-pass`} className="text-xs font-medium text-slate-600">
        Password{mode === 'register' ? ' (at least 8 characters)' : ''}
      </label>
      <input
        id={`${id}-pass`}
        type="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
        minLength={mode === 'register' ? 8 : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1"
      />
      {mode === 'register' ? (
        <>
          <label htmlFor={`${id}-era`} className="text-xs font-medium text-slate-600">
            Today&apos;s date, with the Japanese era
          </label>
          <p id={`${id}-era-hint`} className="text-xs text-slate-500">
            Written like <span lang="ja">令和元年5月1日</span>
          </p>
          <input
            id={`${id}-era`}
            lang="ja"
            required
            aria-describedby={`${id}-era-hint`}
            value={eraDate}
            onChange={(e) => setEraDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </>
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="text-xs text-red-600">
          {mutation.error instanceof ApiClientError && mutation.error.code === 'VALIDATION_ERROR'
            ? 'Check the fields and try again.'
            : errorMessage(mutation.error)}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded border border-slate-600 bg-slate-700 px-2 py-1 font-medium text-white disabled:opacity-50"
      >
        {mode === 'login' ? 'Log in' : 'Create account'}
      </button>
    </form>
  );
}

/** Header controls: log in or register when logged out; user, save state, and log out when in. */
export function AccountBar() {
  const session = useSession();
  const logout = useLogout();
  const known = useKnownEntries();
  const [mode, setMode] = useState<FormMode | null>(null);

  if (session.isPending) return null;
  const user = session.data?.user ?? null;
  const buttonClass =
    'rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50';

  if (user) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span className="font-medium">{user.username}</span>
        {known.status === 'loading' ? <span>Loading known entries…</span> : null}
        {known.status === 'error' ? (
          <button type="button" onClick={() => void known.load()} className={buttonClass}>
            Could not load known entries. Retry
          </button>
        ) : null}
        {known.status === 'ready' ? (
          <span role="status" className={known.saveState === 'failed' ? 'text-red-600' : ''}>
            {SAVE_STATE_LABEL[known.saveState]}
          </span>
        ) : null}
        {known.status === 'ready' ? (
          <button
            type="button"
            onClick={() => void known.save()}
            disabled={known.saveState === 'saved' || known.saveState === 'saving'}
            className={`${buttonClass} disabled:opacity-50`}
          >
            {known.saveState === 'failed' ? 'Retry save' : 'Save'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            // Saving is explicit, so never save on the way out; ask instead.
            if (
              known.saveState === 'saved' ||
              window.confirm('You have unsaved known-entry changes. Log out and discard them?')
            ) {
              logout.mutate(undefined);
            }
          }}
          disabled={logout.isPending}
          className={buttonClass}
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        aria-expanded={mode === 'login'}
        onClick={() => setMode(mode === 'login' ? null : 'login')}
        className={buttonClass}
      >
        Log in
      </button>
      <button
        type="button"
        aria-expanded={mode === 'register'}
        onClick={() => setMode(mode === 'register' ? null : 'register')}
        className={buttonClass}
      >
        Register
      </button>
      {mode ? <AccountForm key={mode} mode={mode} onDone={() => setMode(null)} /> : null}
    </div>
  );
}
