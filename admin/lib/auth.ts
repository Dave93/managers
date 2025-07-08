import { apiClient } from "../utils/eden";


export async function login(username: string, password: string) {
    try {
        const { data, status } = await apiClient.api.users.login.post({
            login: username,
            password
        });

        if (status === 200 && data && 'user' in data) {
            return data.user;
        } else {
            throw new Error("Invalid credentials");
        }
    } catch (error) {
        console.error("Login error:", error);
        throw new Error("Login failed");
    }
}

export async function getCurrentUser() {
    try {
        const { data, status } = await apiClient.api.users.me.get();
        console.log("getCurrentUser - status:", status, "data:", data);
        if (status !== 200) {
            console.log("getCurrentUser - non-200 status:", status);
            return null;
        }
        return data;
    } catch (error) {
        console.error("getCurrentUser error:", error);
        return null;
    }
}

export async function logout() {
    const res = await apiClient.api.users.logout.post();
    return res.data;
}