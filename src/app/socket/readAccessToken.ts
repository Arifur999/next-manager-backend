/** The access token from a raw Cookie header, or undefined when absent or malformed. */
export const readAccessToken = (cookieHeader?: string): string | undefined => {
    if (!cookieHeader) return undefined;

    const raw = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("accessToken="))
        ?.slice("accessToken=".length);

    if (!raw) return undefined;

    try {
        return decodeURIComponent(raw);
    } catch {
        return undefined;
    }
};
