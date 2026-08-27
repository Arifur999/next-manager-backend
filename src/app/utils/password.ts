import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

const hashPassword = async (plain: string): Promise<string> => {
    return bcrypt.hash(plain, SALT_ROUNDS);
};

const comparePassword = async (plain: string, hashed: string): Promise<boolean> => {
    return bcrypt.compare(plain, hashed);
};

export const passwordUtils = { hashPassword, comparePassword };
