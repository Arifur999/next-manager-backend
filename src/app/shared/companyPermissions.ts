/**
 * What a colleague may do WITHIN the role they already have.
 *
 * This layer narrows; it can never widen. A salesperson given
 * `projects.manage` still cannot touch a project, because the role gate in
 * `checkAuth` runs first and refuses them — so nothing here can hand somebody
 * access their role does not already carry.
 *
 * That is also why the list is short. Only routes reachable by a NON-admin role
 * are worth naming, because `requirePermission` lets an admin past every check
 * by design: locking an admin out of their own company with a checkbox is never
 * the intent, and there would be no way back in.
 *
 * The other hatch matters just as much: a member with an EMPTY list passes
 * everything their role allows. So turning this on changes nothing for anybody
 * until an admin actually ticks a box — and the moment they tick one, that
 * person is narrowed to what is ticked. The screen has to say so, because the
 * opposite reading ("I granted them one more thing") is the obvious one.
 */

export const COMPANY_PERMISSIONS = [
    "clients.manage",
    "leads.manage",
    "invoices.manage",
    "projects.manage",
    "tasks.manage",
    "time.approve",
    "vault.reveal",
] as const;

export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number];

export const isCompanyPermission = (value: string): value is CompanyPermission =>
    (COMPANY_PERMISSIONS as readonly string[]).includes(value);

/** For the permissions screen: a label and a sentence per capability. */
export const COMPANY_PERMISSION_INFO: Record<
    CompanyPermission,
    { area: string; label: string; description: string }
> = {
    "clients.manage": {
        area: "Clients",
        label: "Add and edit clients",
        description: "Create a client and change its details. Deleting one stays with admin.",
    },
    "leads.manage": {
        area: "Sales",
        label: "Work the pipeline",
        description: "Add leads, move them between stages, and convert a won one into a client.",
    },
    "invoices.manage": {
        area: "Sales",
        label: "Raise invoices",
        description: "Create and edit invoices. This is what a client is asked to pay.",
    },
    "projects.manage": {
        area: "Delivery",
        label: "Run projects",
        description: "Create projects, change their details, and set who is on them.",
    },
    "tasks.manage": {
        area: "Delivery",
        label: "Create and assign tasks",
        description:
            "Hand work to somebody. Moving your own task along does not need this — everybody can do that.",
    },
    "time.approve": {
        area: "Delivery",
        label: "Approve hours",
        description:
            "Sign off other people's timesheets. Approved hours are what utilisation and realisation are computed from.",
    },
    "vault.reveal": {
        area: "Vault",
        label: "Reveal stored passwords",
        description:
            "See a client credential in the clear. Every reveal is recorded against the person who did it.",
    },
};
