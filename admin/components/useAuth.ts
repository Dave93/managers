'use client'

import { getCurrentUser, login, logout } from "../lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Define a basic user type
interface AuthUser {
    id?: string;
    email?: string;
    name?: string | null;
}

export function useAuth() {
    const queryClient = useQueryClient();
    // Query to fetch current user
    const { data: user, isLoading: loading } = useQuery({
        queryKey: ["currentUser"],
        queryFn: async () => {
            const data = await getCurrentUser();
            return data;
        },
        retry: false, // Don't retry on failure
    });

    // Mutation for login
    const loginMutation = useMutation({
        mutationFn: ({ username, password }: { username: string; password: string }) =>
            login(username, password),
        onSuccess: (data) => {
            if (data) {
                // Full document load (not client-side router.push) so the home
                // page goes through the stable server-render path. A client-side
                // redirect right after login races the freshly-set session
                // cookie: the rapid currentUser/my_permissions fetches flap
                // 200/401, the layout never settles, and the header stays hidden
                // until a manual refresh. A hard navigation makes login behave
                // exactly like that refresh.
                window.location.href = "/";
            }
        },
    });

    // Mutation for logout
    const logoutMutation = useMutation({
        mutationFn: logout,
        onSuccess: () => {
            // Wipe all cached server state, then do a full document load to the
            // login page. The hard navigation (not router.push) guarantees the
            // authenticated layout/header is gone and avoids the same post-auth
            // client-side race that affected login.
            queryClient.clear();
            window.location.href = "/login";
        },
    });

    const signIn = (username: string, password: string) =>
        loginMutation.mutateAsync({ username, password });

    const signOut = () => logoutMutation.mutate();

    return {
        user,
        loading,
        signIn,
        signOut,
        loginError: loginMutation.error?.message,
        isLoggingIn: loginMutation.isPending,
    };
} 