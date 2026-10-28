import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, UserDTO } from '../../shared/api';
import type { LoginInput, RegisterInput } from '../../shared/schemas';
import { api } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/auth/me'),
    staleTime: 60_000,
  });
}

export function useUser(): UserDTO | null {
  return useMe().data?.user ?? null;
}

export const isStaffUser = (user: UserDTO | null) => user?.role === 'admin' || user?.role === 'creator';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<{ user: UserDTO }>('/api/auth/login', input),
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<{ user: UserDTO }>('/api/auth/register', input),
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => {
      qc.clear();
    },
  });
}
