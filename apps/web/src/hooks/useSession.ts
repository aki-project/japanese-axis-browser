import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest, RegisterRequest, SessionResponse } from '@japanesesite/shared';
import { getSession, login, logout, register } from '../api/client.js';

export const SESSION_QUERY_KEY = ['session'] as const;

/**
 * The logged-in user, or null. Updated by the mutations below, and
 * refetched when the window regains focus after 30 s, so a login or
 * logout in another tab is picked up.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: getSession,
    staleTime: 30_000,
  });
}

function useSessionMutation<T>(fn: (input: T) => Promise<SessionResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
    },
  });
}

export function useLogin() {
  return useSessionMutation((input: LoginRequest) => login(input));
}

export function useRegister() {
  return useSessionMutation((input: RegisterRequest) => register(input));
}

export function useLogout() {
  return useSessionMutation(() => logout());
}
