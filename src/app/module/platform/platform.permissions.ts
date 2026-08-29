/**
 * What a platform operator may do.
 *
 * A closed list, not free text. `User.permissions` has accepted any string
 * since the first week and been read by nobody; a typo stored there would be a
 * permission that silently grants nothing, which is the worst kind of security
 * control - one that looks configured and is not.
 *
 * Grouped by screen rather than by verb, because that is how somebody hands
 * out access: "you look after billing" rather than "you may PATCH".
 */
export const PLATFORM_PERMISSIONS = [
    "platform.companies.view",
    "platform.companies.manage",
    "platform.plans.manage",
    "platform.finance.view",
    "platform.expenses.manage",
    "platform.admins.manage",
    "platform.campaigns.send",
    "platform.settings.manage",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/** For the permissions screen: a label and a sentence per capability. */
export const PLATFORM_PERMISSION_INFO: Record<
    PlatformPermission,
    { area: string; label: string; description: string }
> = {
    "platform.companies.view": {
        area: "Companies",
        label: "See customers",
        description: "Read the customer list, their plan and how much of it they use.",
    },
    "platform.companies.manage": {
        area: "Companies",
        label: "Create and change customers",
        description:
            "Provision a company, move it between plans, suspend or restore it. This is the one that can cut a paying customer off.",
    },
    "platform.plans.manage": {
        area: "Plans",
        label: "Edit plans",
        description:
            "Change prices and limits. A plan edit moves every company on that tier at once.",
    },
    "platform.finance.view": {
        area: "Finance",
        label: "See the numbers",
        description: "Revenue, churn and net profit for the platform itself.",
    },
    "platform.expenses.manage": {
        area: "Finance",
        label: "Record expenses",
        description: "Add and edit what the platform spends.",
    },
    "platform.admins.manage": {
        area: "Team",
        label: "Manage the platform team",
        description:
            "Invite operators and set what they may do — including granting this permission, so hand it out carefully.",
    },
    "platform.campaigns.send": {
        area: "Customers",
        label: "Send announcements",
        description: "Publish notices to customers, and email them.",
    },
    "platform.settings.manage": {
        area: "Platform",
        label: "Change how the platform is set up",
        description:
            "The product name and support address on every email it sends, and what a company that signs up itself is put on. One edit here changes what every future customer gets.",
    },
};

export const isPlatformPermission = (value: string): value is PlatformPermission =>
    (PLATFORM_PERMISSIONS as readonly string[]).includes(value);
