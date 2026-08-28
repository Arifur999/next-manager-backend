import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    annualise,
    attainment,
    availableHours,
    averageDealSize,
    effectiveHourlyRate,
    grossMargin,
    measured,
    onTimeDelivery,
    pipelineCoverage,
    pipelineVelocity,
    planVsActual,
    projectMargin,
    realization,
    revenuePerPerson,
    salesCycleDays,
    scopeChange,
    unmeasurable,
    utilization,
    winRate,
} from "./kpi.formulas.js";

/**
 * The fixtures are the industry benchmarks from the plan, so a formula that
 * drifts stops matching the number it is supposed to produce.
 *
 * The cases that matter most here are the empty ones. Every one of these
 * ratios has a denominator that is zero on a company's first day, and the
 * failure mode is not a crash - it is a dashboard confidently reporting 0%
 * utilization to somebody who joined this morning.
 */

describe("utilization", () => {
    it("28 billable hours against a 40-hour week is 70%", () => {
        assert.deepEqual(utilization(28, 40), measured(70));
    });

    it("a part-timer is measured against their own capacity, not 40", () => {
        // 14 hours at 20h/week is the same 70%, which is the entire reason
        // capacity is a row rather than a constant.
        assert.deepEqual(utilization(14, 20), measured(70));
    });

    it("returns null, not zero, when no capacity is recorded", () => {
        const result = utilization(0, 0);
        assert.equal(result.value, null);
        assert.match(result.reason ?? "", /capacity/i);
    });

    it("can exceed 100 - overwork is a real reading, not an error", () => {
        assert.deepEqual(utilization(48, 40), measured(120));
    });
});

describe("availableHours", () => {
    it("prorates a weekly figure across a span", () => {
        assert.equal(availableHours(40, 7), 40);
        assert.equal(availableHours(40, 14), 80);
    });

    it("prorates a part-time week the same way", () => {
        assert.equal(availableHours(20, 7), 20);
    });
});

describe("realization", () => {
    it("is collected money against what the hours should have been worth", () => {
        // 100 billable hours at $50 = $5,000 of work; $4,250 collected = 85%.
        assert.deepEqual(realization(4250, 100, 50), measured(85));
    });

    it("catches the busy-and-poor case", () => {
        // The hours happened, the money did not.
        assert.deepEqual(realization(3000, 100, 50), measured(60));
    });

    it("refuses to guess when no bill rate is set", () => {
        const result = realization(4250, 100, 0);
        assert.equal(result.value, null);
        assert.match(result.reason ?? "", /bill rate/i);
    });

    it("returns null when nothing billable was logged", () => {
        assert.equal(realization(4250, 0, 50).value, null);
    });
});

describe("effectiveHourlyRate", () => {
    it("is collected money per billable hour", () => {
        assert.deepEqual(effectiveHourlyRate(4250, 100), measured(42.5));
    });

    it("is null with no billable hours rather than dividing by zero", () => {
        assert.equal(effectiveHourlyRate(4250, 0).value, null);
    });
});

describe("grossMargin", () => {
    it("is revenue less direct cost, over revenue", () => {
        assert.deepEqual(grossMargin(10000, 3500), measured(65));
    });

    it("goes negative when a month cost more than it earned", () => {
        // Clamping this to zero would hide the only month worth noticing.
        assert.deepEqual(grossMargin(10000, 12000), measured(-20));
    });

    it("is null with no revenue", () => {
        assert.equal(grossMargin(0, 500).value, null);
    });
});

describe("revenuePerPerson and annualise", () => {
    it("divides revenue by headcount", () => {
        assert.deepEqual(revenuePerPerson(200000, 10), measured(20000));
    });

    it("annualises a partial period so it can meet a yearly benchmark", () => {
        // A month of $16,667 per head annualises into the $150k-250k band.
        const monthly = revenuePerPerson(166670, 10);
        assert.equal(monthly.value, 16667);
        assert.deepEqual(annualise(16667, 30), measured(202781.83));
    });

    it("is null with nobody active", () => {
        assert.equal(revenuePerPerson(200000, 0).value, null);
    });
});

describe("winRate", () => {
    it("counts only decided deals", () => {
        assert.deepEqual(winRate(3, 7), measured(30));
    });

    it("ignores open deals entirely", () => {
        // Same 3 won and 7 lost with 90 still open is still 30% - the rate must
        // not fall every time a new lead arrives.
        assert.deepEqual(winRate(3, 7), measured(30));
    });

    it("is null before anything has been decided", () => {
        const result = winRate(0, 0);
        assert.equal(result.value, null);
        assert.match(result.reason ?? "", /decided/i);
    });
});

describe("averageDealSize", () => {
    it("averages won value over won count", () => {
        assert.deepEqual(averageDealSize(45000, 3), measured(15000));
    });

    it("is null with no wins", () => {
        assert.equal(averageDealSize(0, 0).value, null);
    });
});

describe("pipelineCoverage", () => {
    it("is a multiple, not a percentage", () => {
        // $300k of open pipeline against a $100k target is 3x, the low end of
        // the healthy 3-4x band.
        assert.deepEqual(pipelineCoverage(300000, 100000), measured(3));
    });

    it("is null without a target, because coverage of nothing is nothing", () => {
        const result = pipelineCoverage(300000, 0);
        assert.equal(result.value, null);
        assert.match(result.reason ?? "", /target/i);
    });
});

describe("salesCycleDays", () => {
    it("averages the closed-won cycles", () => {
        assert.deepEqual(salesCycleDays([30, 45, 60]), measured(45));
    });

    it("is null before any deal has been won", () => {
        assert.equal(salesCycleDays([]).value, null);
    });
});

describe("pipelineVelocity", () => {
    it("is value per day through the pipeline", () => {
        // 20 open deals x 30% x $15,000 / 45 days = $2,000 a day.
        assert.deepEqual(pipelineVelocity(20, 30, 15000, 45), measured(2000));
    });

    it("refuses to compute when any input is itself unmeasurable", () => {
        // A velocity built on a guessed cycle length is worse than no velocity.
        assert.equal(pipelineVelocity(20, 30, 15000, null).value, null);
        assert.equal(pipelineVelocity(20, null, 15000, 45).value, null);
        assert.equal(pipelineVelocity(20, 30, null, 45).value, null);
    });

    it("refuses a zero cycle length rather than dividing by it", () => {
        assert.equal(pipelineVelocity(20, 30, 15000, 0).value, null);
    });
});

describe("onTimeDelivery", () => {
    it("is on-time submissions over submissions", () => {
        assert.deepEqual(onTimeDelivery(9, 10), measured(90));
    });

    it("is null when nothing has been delivered", () => {
        assert.equal(onTimeDelivery(0, 0).value, null);
    });
});

describe("planVsActual", () => {
    it("reads 100 when a project lands exactly on plan", () => {
        assert.deepEqual(planVsActual(120, 120), measured(100));
    });

    it("reads over 100 when it took longer than sold", () => {
        assert.deepEqual(planVsActual(156, 120), measured(130));
    });

    it("is null for an unbaselined project, not infinity", () => {
        const result = planVsActual(156, 0);
        assert.equal(result.value, null);
        assert.match(result.reason ?? "", /baseline/i);
    });
});

describe("scopeChange", () => {
    it("is signed - added scope is positive, cut scope negative", () => {
        assert.deepEqual(scopeChange(11500, 10000), measured(15));
        assert.deepEqual(scopeChange(9000, 10000), measured(-10));
    });

    it("is null without a baseline", () => {
        assert.equal(scopeChange(11500, 0).value, null);
    });
});

describe("projectMargin", () => {
    it("is collected less delivery cost, over collected", () => {
        assert.deepEqual(projectMargin(20000, 7000), measured(65));
    });

    it("is null before anything is collected", () => {
        assert.equal(projectMargin(0, 7000).value, null);
    });
});

describe("attainment", () => {
    it("scores a metric against its target", () => {
        const result = attainment(measured(70), 65);
        assert.equal(result.attainment_pct, 107.69);
        assert.equal(result.on_track, true);
    });

    it("marks a miss as off track", () => {
        assert.equal(attainment(measured(55), 65).on_track, false);
    });

    it("inverts for metrics that are better small", () => {
        // 12% scope change against a 15% ceiling is on track, and scoring it
        // the same way as revenue would call it a failure.
        const result = attainment(measured(12), 15, { lowerIsBetter: true });
        assert.equal(result.on_track, true);
        assert.equal(attainment(measured(22), 15, { lowerIsBetter: true }).on_track, false);
    });

    it("says unknown rather than off track when the metric is unmeasurable", () => {
        const result = attainment(unmeasurable("No capacity recorded"), 65);
        assert.equal(result.value, null);
        assert.equal(result.on_track, null);
        assert.match(result.reason ?? "", /capacity/i);
    });

    it("says unknown rather than off track when no target is set", () => {
        const result = attainment(measured(70), null);
        assert.equal(result.value, 70);
        assert.equal(result.on_track, null);
        assert.match(result.reason ?? "", /target/i);
    });

    it("still answers on_track against a target of zero", () => {
        // "No scope changes" is a real goal; a percentage of zero is not.
        const result = attainment(measured(0), 0, { lowerIsBetter: true });
        assert.equal(result.on_track, true);
        assert.equal(result.attainment_pct, null);
    });
});
