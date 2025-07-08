'use client'

import { getCurrentUser, login, logout } from "../lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

// Define a basic user type
interface AuthUser {
    id?: string;
    email?: string;
    name?: string | null;
}

export function useAuth() {
    const queryClient = useQueryClient();
    const router = useRouter();
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
        onSuccess: async (data) => {
            if (data) {
                // Set the user data directly in the cache
                queryClient.setQueryData(["currentUser"], data);
                // Also invalidate to ensure fresh data
                await queryClient.invalidateQueries({ queryKey: ["currentUser"] });
                // Clear any permission caches that might exist
                queryClient.invalidateQueries({ queryKey: ["my_permissions"] });
                // Redirect to home page
                router.push("/");
            }
        },
    });

    // Mutation for logout
    const logoutMutation = useMutation({
        mutationFn: logout,
        onSuccess: () => {
            queryClient.setQueryData(["currentUser"], null);
            router.push("/");
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