import { setSubscription, getMySubscription } from "./platformSubscription.service.js";
import { getPlans, createPlan, updatePlan } from "./platformPlan.service.js";
import { getActivity, getAdmins, setPermissions } from "./platformAdmin.service.js";
import { getCompanies, createCompany, getOverview } from "./platformCompany.service.js";

// The one object the platform controller calls. Each concern lives in its own
// file: plans, subscriptions, companies, and the platform team.
export const PlatformService = {
    getPlans,
    createPlan,
    updatePlan,
    getCompanies,
    setSubscription,
    getMySubscription,
    createCompany,
    getOverview,
    getActivity,
    getAdmins,
    setPermissions,
};
