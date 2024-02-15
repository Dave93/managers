"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransportToken = void 0;
const getTransportToken = async () => {
    let response = await fetch(`https://api-ru.iiko.services/api/1/access_token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            "apiLogin": process.env.LESIIKO_LOGIN
        }),
    });
    let body = await response.json();
    const lesToken = body.token;
    response = await fetch(`https://api-ru.iiko.services/api/1/access_token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            "apiLogin": process.env.CHOPARIIKO_LOGIN
        }),
    });
    body = await response.json();
    const choparToken = body.token;
    return {
        lesToken,
        choparToken
    };
};
exports.getTransportToken = getTransportToken;
