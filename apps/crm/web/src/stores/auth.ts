import { create } from 'zustand';

export type CrmRole = 'manager' | 'member' | '';

interface User {
  id: string;
  email: string;
  name?: string;
  role: CrmRole;
  isSuperadmin?: boolean;
}

export interface AuthStore {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    set({ user: null, isLoading: false });
    const loginUrl = import.meta.env.VITE_IDENTITY_LOGIN_URL || 'https://skarion-identity-login.pages.dev';
    window.location.href = `${loginUrl}/logout`;
  },
}));
