import { KpiMetric } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { type Range } from "./kpi.range.js";
import {
    annualise,
    attainment,
    availableHours,
    effectiveHourlyRate,
    grossMargin,
    realization,
    revenuePerPerson,
    unmeasurable,
    utilization,
} from "./kpi.formulas.js";
import { loadTargets, targetOf, loadHours, loadCapacity, loadMoney } from "./kpi.loaders.js";

/**
 * The agency's own numbers: is the company healthy.
 *
 * Utilization and realization lead, because they move first - revenue confirms
 * what they already said six weeks earlier.
 */
export const agencyScope = async (user: IRequestUser, range: Range) => {
    const targets = await loadTargets(user.organizationId, range, null);

    const [hours, capacity, money] = await Promise.all([
        loadHours(user.organizationId, range),
        loadCapacity(user.organizationId),
        loadMoney(user.organizationId, range),
    ]);

    const available = availableHours(capacity.weeklyHours, range.days);
    const utilizationMetric = utilization(hours.billable, available);
    const realizationMetric = realization(
        money.revenueUsd,
        hours.approvedBillable,
        capacity.blendedRate
    );

    const revenuePerHead = revenuePerPerson(money.revenueUsd, capacity.headcount);
    const annualisedPerHead =
        revenuePerHead.value === null
            ? unmeasurable(revenuePerHead.reason)
            : annualise(revenuePerHead.value, range.days);

    return {
        leading: {
            utilization_pct: attainment(utilizationMetric, targetOf(targets, KpiMetric.utilization_pct)),
            realization_pct: attainment(realizationMetric, targetOf(targets, KpiMetric.realization_pct)),
            effective_hourly_rate_usd: effectiveHourlyRate(money.revenueUsd, hours.billable),
        },
        lagging: {
            revenue_usd: attainment(
                { value: money.revenueUsd },
                targetOf(targets, KpiMetric.revenue_usd)
            ),
            // BDT, because costs only exist in BDT - this is the one currency
            // in which both sides of the subtraction are real.
            gross_margin_pct: attainment(
                grossMargin(money.revenueBdt, money.costBdt),
                targetOf(targets, KpiMetric.gross_margin_pct)
            ),
            net_profit_bdt: money.revenueBdt - money.costBdt,
            revenue_per_person_usd: revenuePerHead,
            annualised_revenue_per_person_usd: annualisedPerHead,
        },
        context: {
            headcount: capacity.headcount,
            available_hours: available,
            logged_hours: hours.total,
            billable_hours: hours.billable,
            approved_billable_hours: hours.approvedBillable,
            blended_rate_usd: capacity.blendedRate,
            people_on_default_capacity: capacity.defaultedPeople,
            people_with_a_bill_rate: capacity.ratedPeople,
            revenue_bdt_reporting: money.revenueBdt,
            cost_bdt: money.costBdt,
        },
    };
};
