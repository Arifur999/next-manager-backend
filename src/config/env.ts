import dotenv from "dotenv";

dotenv.config();

interface ENVConfig {
    NODE_ENV: string;
    PORT: string | number;
    DATABASE_URL: string;
    ACCESS_TOKEN_SECRET: string;
    REFRESH_TOKEN_SECRET: string;
    ACCESS_TOKEN_EXPIRES_IN: string;
    REFRESH_TOKEN_EXPIRES_IN: string;
    FRONTEND_URL: string;
    SUPER_ADMIN_EMAIL: string;
    SUPER_ADMIN_PASSWORD: string;
    CLOUDINARY: {
        CLOUD_NAME: string;
        API_KEY: string;
        API_SECRET: string;
    };
}

// Missing here means the process should not start at all: every one of these is
// something the app silently misbehaves without (an unset token secret would
// sign every token with "undefined").
const requiredEnvVars = [
    "DATABASE_URL",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
    "SUPER_ADMIN_EMAIL",
    "SUPER_ADMIN_PASSWORD",
];

requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
        throw new Error(`Environment variable ${varName} is not set`);
    }
});

export const env: ENVConfig = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: process.env.PORT || 5000,
    DATABASE_URL: process.env.DATABASE_URL as string,
    ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET as string,
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET as string,
    ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN || "1d",
    REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
    FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
    SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL as string,
    SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD as string,
    CLOUDINARY: {
        CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
        API_KEY: process.env.CLOUDINARY_API_KEY || "",
        API_SECRET: process.env.CLOUDINARY_API_SECRET || "",
    },
};
