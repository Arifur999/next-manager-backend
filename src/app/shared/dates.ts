// A date-only value ("2026-10-01") is a calendar day, stored in @db.Date
// columns as UTC midnight. These two helpers are the only place that turns
// such a string into an instant, so every module agrees on the boundaries.

/** The first instant of the day, UTC. */
export const toDateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/** The last instant of the day, UTC, for inclusive "up to and including" ranges. */
export const endOfDay = (value: string): Date => new Date(`${value}T23:59:59.999Z`);
