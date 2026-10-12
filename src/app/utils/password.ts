import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

const hashPassword = async (plain: string): Promise<string> => {
    return bcrypt.hash(plain, SALT_ROUNDS);
};

const comparePassword = async (plain: string, hashed: string): Promise<boolean> => {
    return bcrypt.compare(plain, hashed);
};

// Compared against when no account matches, so an unknown address costs the same
// bcrypt round as a wrong password and response time does not reveal which it was.
const dummyHash = bcrypt.hashSync("no account has this password", SALT_ROUNDS);

const compareAgainstDummy = async (plain: string): Promise<false> => {
    await bcrypt.compare(plain, dummyHash);
    return false;
};

export const passwordUtils = { hashPassword, comparePassword, compareAgainstDummy };
