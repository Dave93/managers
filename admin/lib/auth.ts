import { apiClient } from "../utils/eden";


export async function login(username: string, password: string) {
    const { data, status } = await apiClient.api.users.login.post({
        login: username,
        password
    });

    if (data && 'user' in data) {
        return data.user;
    } else {
        return null;
    }
}

export async function getCurrentUser() {
    const { data, status } = await apiClient.api.users.me.get();
    console.log("data", data);
    if (status !== 200) {
        return null;
    }
    return data;
}

export async function logout() {
    const res = await apiClient.api.users.logout.post();
    return res.data;
}