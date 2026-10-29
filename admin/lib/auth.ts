import { apiClient } from "../utils/eden";
import { loginErrorMessage } from "./auth-errors";


// A failed login is an expected outcome, not a crash: the reason is thrown as
// a readable message for the form and NOT console.error'ed, because in dev
// every console.error pops the Next.js error overlay over the login page.
export async function login(username: string, password: string) {
    let response;
    try {
        response = await apiClient.api.users.login.post({
            login: username,
            password
        });
    } catch {
        throw new Error(loginErrorMessage(undefined, undefined));
    }

    const { data, error, status } = response;
    if (status === 200 && data && 'user' in data) {
        return data.user;
    }
    throw new Error(loginErrorMessage(status, error?.value));
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