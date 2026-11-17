/*
 * Claryo's money maths, ported line for line from the Flutter app so the site's calculators
 * compute exactly what the app computes. Pure functions: no DOM, no currency, no formatting.
 *
 * Every function names its Dart source in a `// lib/…:line` comment. A change to that Dart
 * changes this file and its fixtures in `_tests/calc_math.test.mjs` (tech-website, parity).
 * Every rate is a PERCENT, as in the Dart: 6 means 6%.
 *
 * UMD: `window.ClaryoCalc` in a browser, `module.exports` in Node. ES2017 syntax only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClaryoCalc = factory();
})(this, function () {
  'use strict';

  // ── Dart number semantics ──────────────────────────────────────────────────

  // Dart's double.round(): half away from zero (JS Math.round goes half up).
  function roundHalfAway(x) {
    var a = Math.abs(x);
    var f = Math.floor(a);
    var r = a - f >= 0.5 ? f + 1 : f;
    return x < 0 ? -r : r;
  }

  // Dart's double.compareTo: -0.0 sorts before 0.0, NaN after everything.
  function compareTo(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    if (a === b) {
      if (a !== 0) return 0;
      var an = 1 / a < 0;
      var bn = 1 / b < 0;
      return an === bn ? 0 : an ? -1 : 1;
    }
    var aNaN = a !== a;
    var bNaN = b !== b;
    return aNaN ? (bNaN ? 0 : 1) : -1;
  }

  function isNum(v) {
    return v !== null && v !== undefined;
  }

  function clamp(x, lo, hi) {
    return Math.min(Math.max(x, lo), hi);
  }

  // ── Life cover ─────────────────────────────────────────────────────────────

  // lib/core/life_coverage.dart:37 — float noise, never a tolerance on a typed figure.
  var FUNDED_TOLERANCE = 0.005;

  // lib/core/life_coverage.dart:51 — growingAnnuityDue: the draw is taken at the START of each year.
  function growingAnnuityDue(o) {
    var annualDraw = o.annualDraw;
    var years = o.years;
    if (years <= 0 || annualDraw <= 0) return 0;
    // Compared as PERCENTS (:61): r == g is exact, so 2% return with 2% inflation is A × N, never NaN.
    if (o.investmentRatePct === o.incomeGrowthPct) return annualDraw * years;
    var r = o.investmentRatePct / 100;
    var g = o.incomeGrowthPct / 100;
    var k = (1 + g) / (1 + r);
    return annualDraw * (1 - Math.pow(k, years)) * (1 + r) / (r - g);
  }

  // lib/core/life_coverage.dart:76 — yearsFundedBy: null means the money NEVER runs out.
  function yearsFundedBy(o) {
    var capital = o.capital;
    var annualDraw = o.annualDraw;
    // The capital guard wins, and the order is load-bearing (:82-87).
    if (capital <= 0) return 0;
    if (annualDraw <= 0) return null;
    if (o.investmentRatePct === o.incomeGrowthPct) return capital / annualDraw;
    var r = o.investmentRatePct / 100;
    var g = o.incomeGrowthPct / 100;
    var consumed = capital * (r - g) / (annualDraw * (1 + r));
    if (consumed >= 1) return null;
    var k = (1 + g) / (1 + r);
    if (k <= 0 || k === 1) return null;
    return Math.log(1 - consumed) / Math.log(k);
  }

  // lib/core/life_coverage.dart:141 — drawdownYears: years + 1 rows, the last one the closing balance.
  function drawdownYears(o) {
    var r = o.investmentRatePct / 100;
    var g = o.incomeGrowthPct / 100;
    var out = [];
    var balance = o.capital;
    for (var t = 0; t <= o.years; t++) {
      if (t === o.years) {
        out.push({ year: t, draw: 0, required: 0, growth: 0, balance: Math.max(0, balance), funded: true });
        break;
      }
      var required = o.annualDraw * Math.pow(1 + g, t);
      var open = Math.max(0, balance);
      var paid = Math.min(open, required);
      var after = open - paid;
      var growth = after * r;
      out.push({
        year: t,
        draw: paid,
        required: required,
        growth: growth,
        balance: open,
        funded: paid >= required - FUNDED_TOLERANCE,
      });
      balance = after + growth;
    }
    return out;
  }

  // lib/core/life_coverage.dart:201 — drawdownSeries: the balance at the START of each year, floored at 0.
  function drawdownSeries(o) {
    var r = o.investmentRatePct / 100;
    var g = o.incomeGrowthPct / 100;
    var out = [];
    var balance = o.capital;
    for (var t = 0; t <= o.years; t++) {
      out.push(Math.max(0, balance));
      if (t === o.years) break;
      var draw = o.annualDraw * Math.pow(1 + g, t);
      balance = (balance - draw) * (1 + r);
    }
    return out;
  }

  // lib/core/life_coverage.dart:411 — computeLifeCoverage. The need and the settlement are two
  // facts, never summed; the settlement is a share of the HELD cover, plus every debt.
  function lifeNeed(i) {
    var assetCommitPct = isNum(i.assetCommitPct) ? i.assetCommitPct : 100; // coverage_tiers.dart:530
    var debtPayoff = i.debtPayoff || 0;
    var liquidAssets = i.liquidAssets || 0;
    var held = i.heldCoverage || 0;
    var annualDraw = i.annualBasis * i.replacementPct / 100;
    var incomeNeeded = growingAnnuityDue({
      annualDraw: annualDraw,
      investmentRatePct: i.investmentRatePct,
      incomeGrowthPct: i.incomeGrowthPct,
      years: i.years,
    });
    var settlementCosts = debtPayoff + held * i.settlementPct / 100;
    var assetsUsed = liquidAssets * assetCommitPct / 100;
    var fundsFamily = Math.max(0, held + assetsUsed - settlementCosts);
    return {
      annualBasis: i.annualBasis,
      replacementPct: i.replacementPct,
      years: i.years,
      investmentRatePct: i.investmentRatePct,
      incomeGrowthPct: i.incomeGrowthPct,
      debtPayoff: debtPayoff,
      settlementPct: i.settlementPct,
      liquidAssets: liquidAssets,
      assetCommitPct: assetCommitPct,
      annualDraw: annualDraw,
      incomeNeeded: incomeNeeded,
      settlementCosts: settlementCosts,
      held: held,
      assetsUsed: assetsUsed,
      fundsFamily: fundsFamily,
      incomeShare: incomeNeeded > 0 ? fundsFamily / incomeNeeded : null,
      incomeShortfall: Math.max(0, incomeNeeded - fundsFamily),
      yearsCovered: yearsFundedBy({
        capital: fundsFamily,
        annualDraw: annualDraw,
        investmentRatePct: i.investmentRatePct,
        incomeGrowthPct: i.incomeGrowthPct,
      }),
      settlementCovered: held + assetsUsed >= settlementCosts,
      covered: fundsFamily >= incomeNeeded,
      // lib/core/life_coverage.dart:388 — exactly one of this and fundsFamily is ever non-zero.
      settlementShortfall: Math.max(0, settlementCosts - held - assetsUsed),
      // lib/core/life_coverage.dart:393 — the estate share alone, without the debts.
      settlementShare: settlementCosts - debtPayoff,
    };
  }

  // lib/core/life_coverage.dart:516 — lifeDrawdown: the ask and what the family holds, year by year;
  // firstDry is the first year short (keyed on `funded`, never the balance), −1 when none is.
  function lifeDrawdown(life) {
    function series(capital) {
      return drawdownYears({
        capital: capital,
        annualDraw: life.annualDraw,
        investmentRatePct: life.investmentRatePct,
        incomeGrowthPct: life.incomeGrowthPct,
        years: life.years,
      });
    }
    var held = series(life.fundsFamily);
    var firstDry = -1;
    for (var t = 0; t < held.length; t++) {
      if (!held[t].funded) { firstDry = t; break; }
    }
    return { needed: series(life.incomeNeeded), held: held, firstDry: firstDry };
  }

  // lib/core/life_coverage.dart:493 — lifeNeedAt: the same annuity over the years still to run.
  function lifeNeedAt(basis, yearsFromNow) {
    var remaining = basis.years - yearsFromNow;
    if (remaining <= 0) return 0;
    return growingAnnuityDue({
      annualDraw: basis.annualBasis * basis.replacementPct / 100,
      investmentRatePct: basis.investmentRatePct,
      incomeGrowthPct: basis.incomeGrowthPct,
      years: remaining,
    });
  }

  // lib/providers/home/insurance.dart:956 — the rule of thumb is 10 × income, raw. What it funds is
  // yearsFundedBy on the same draw and rates; its dry year is coverage_method_beats.dart:125's.
  function ruleOfThumb(annualIncome, o) {
    var cover = annualIncome * LIFE_BENCHMARK_MULTIPLE;
    var series = drawdownSeries({
      capital: cover,
      annualDraw: o.annualDraw,
      investmentRatePct: o.investmentRatePct,
      incomeGrowthPct: o.incomeGrowthPct,
      years: o.years,
    });
    var dryYear = -1;
    for (var t = 0; t < series.length; t++) {
      if (series[t] <= 0) { dryYear = t; break; }
    }
    return {
      cover: cover,
      yearsFunded: yearsFundedBy({
        capital: cover,
        annualDraw: o.annualDraw,
        investmentRatePct: o.investmentRatePct,
        incomeGrowthPct: o.incomeGrowthPct,
      }),
      series: series,
      dryYear: dryYear,
      // lib/pages/onboarding/concepts/coverage_method_beats.dart:130 — the red band's width in years.
      unfundedYears: dryYear < 0 ? 0 : o.years - dryYear + 1,
    };
  }

  // lib/domain/coverage_tiers.dart:669 — coverageHorizonTiersFor: what each span would cost.
  function coverageHorizonTiers(basis) {
    var annualDraw = basis.annualBasis * basis.replacementPct / 100;
    return LIFE_YEARS.map(function (t) {
      return {
        value: t.value,
        label: t.label,
        need: growingAnnuityDue({
          annualDraw: annualDraw,
          investmentRatePct: basis.investmentRatePct,
          incomeGrowthPct: basis.incomeGrowthPct,
          years: t.value,
        }),
        line: 'of cover \u00B7 ' + HORIZON_BLURB[t.value],
      };
    });
  }

  // ── Critical illness ───────────────────────────────────────────────────────

  // lib/core/health_coverage.dart:145-146
  var HEALTH_MIN_SPAN_MONTHS = 2;
  var HEALTH_MAX_SPAN_MONTHS = 60;

  // lib/core/health_coverage.dart:140 — healthSpanMonths: a ceiling for the chart, never a target.
  function healthSpanMonths(monthsOffWork) {
    if (!isNum(monthsOffWork)) return HEALTH_MAX_SPAN_MONTHS;
    return clamp(Math.ceil(monthsOffWork), HEALTH_MIN_SPAN_MONTHS, HEALTH_MAX_SPAN_MONTHS);
  }

  // lib/core/health_coverage.dart:153 — healthCoverFor. Both rates are a literal 0 (:178-179), so the
  // span is capital ÷ monthly draw through yearsFundedBy's r == g branch.
  function healthRecovery(i) {
    var catastrophicBill = i.catastrophicBill;
    var annualLimit = i.annualLimit || 0;
    var lumpSum = i.lumpSum || 0;
    var emergencyFund = i.emergencyFund || 0;
    var efConsumePct = isNum(i.efConsumePct) ? i.efConsumePct : 100;
    var recoveryPct = isNum(i.recoveryPct) ? i.recoveryPct : 100;
    var billAfterLimit = Math.max(0, catastrophicBill - annualLimit);
    var efUsed = emergencyFund * efConsumePct / 100;
    var limitPaid = Math.min(annualLimit, catastrophicBill);
    var capital = Math.max(0, lumpSum + efUsed - billAfterLimit);
    var billShortfall = Math.max(0, billAfterLimit - (lumpSum + efUsed));
    var recoveryPerMonth = i.monthlyIncome * recoveryPct / 100;
    var monthsOffWork = yearsFundedBy({
      capital: capital,
      annualDraw: recoveryPerMonth,
      investmentRatePct: 0,
      incomeGrowthPct: 0,
    });
    return {
      catastrophicBill: catastrophicBill,
      annualLimit: annualLimit,
      limitPaid: limitPaid,
      billAfterLimit: billAfterLimit,
      lumpSum: lumpSum,
      efUsed: efUsed,
      capital: capital,
      billShortfall: billShortfall,
      recoveryPerMonth: recoveryPerMonth,
      monthsOffWork: monthsOffWork,
      spanMonths: healthSpanMonths(monthsOffWork),
    };
  }

  // lib/core/health_coverage.dart:201 — healthDrawdown: one call, read by the chart and the table.
  function healthDrawdown(cover) {
    return drawdownYears({
      capital: cover.capital,
      annualDraw: cover.recoveryPerMonth,
      investmentRatePct: 0,
      incomeGrowthPct: 0,
      years: cover.spanMonths,
    });
  }

  // lib/core/health_coverage.dart:48 — healthAnchorToHome, with the site's ÷ factor standing in for the
  // exchange rate: rounded to two significant figures, left alone below 100.
  function healthAnchorToHome(anchorPhp, factor) {
    var raw = anchorPhp / (factor || 1);
    if (Math.abs(raw) < 100) return raw;
    var magnitude = Math.pow(10, Math.floor(Math.log(Math.abs(raw)) / Math.LN10) - 1);
    return roundHalfAway(raw / magnitude) * magnitude;
  }

  // lib/domain/coverage_tiers.dart:489 — the bill tiers in the visitor's currency.
  function healthBillTiers(factor) {
    return HEALTH_BILLS.map(function (t) {
      return {
        anchorPhp: t.anchorPhp,
        value: healthAnchorToHome(t.anchorPhp, factor),
        line: t.line,
        isDefault: t.anchorPhp === HEALTH_DEFAULT_BILL,
      };
    });
  }

  // ── Emergency fund ─────────────────────────────────────────────────────────

  // lib/widgets/reserve_scale_track.dart:102 — the milestone names.
  function milestoneName(m) {
    switch (m) {
      case 3: return '3-month minimum';
      case 6: return '6-month target';
      case 9: return '9-month buffer';
      case 12: return '12-month buffer';
      default: return m + '-month milestone';
    }
  }

  // lib/providers/home/cash_reserves.dart:246-278 (targets and status: money compared, never the
  // rounded months), :155 (monthsCovered), reserve_scale_track.dart:112-114 (the gap line).
  function reserve(totalEf, avgMonthly) {
    var targetLow = avgMonthly * 3;
    var targetHigh = avgMonthly * 6;
    var status;
    if (targetLow <= 0) status = 'notSetUp';
    else if (totalEf >= targetLow) status = 'healthy';
    else status = 'attention';
    var monthsCovered;
    if (totalEf === 0) monthsCovered = 0;
    else monthsCovered = targetLow > 0 ? totalEf / avgMonthly : null;
    // The gap line asserts a ruler (reserve_scale_track.dart:97), so no basis means no milestones.
    var milestones = avgMonthly > 0
      ? RESERVE_MILESTONES.map(function (months) {
        var required = months * avgMonthly;
        var diff = totalEf - required;
        var reached = diff >= 0;
        var name = milestoneName(months);
        return {
          months: months,
          name: name,
          required: required,
          diff: diff,
          reached: reached,
          phrase: (reached ? 'above the ' : 'remaining for the ') + name,
        };
      })
      : [];
    return {
      targetLow: targetLow,
      targetHigh: targetHigh,
      monthsCovered: monthsCovered,
      status: status,
      milestones: milestones,
    };
  }

  // ── Investment rate ────────────────────────────────────────────────────────

  // lib/providers/home/portfolio_value.dart:877 — investmentRateFromPoints: a zero numerator is 0%,
  // only a missing income is null.
  function investmentRate(invested, income) {
    if (!(income > 0)) return null;
    return invested / income * 100;
  }

  // lib/providers/home/investment_trajectory.dart:217-224
  function investmentStatus(rate, target) {
    if (!isNum(rate)) return 'notSetUp';
    if (rate >= target) return 'healthy';
    if (rate >= target * 0.5) return 'attention';
    return 'atRisk';
  }

  // ── Projection ─────────────────────────────────────────────────────────────

  // lib/core/projection_math.dart:8 — inflationAdjusted.
  function todaysMoney(nominal, inflationPct, years) {
    if (years <= 0) return nominal;
    return nominal / Math.pow(1 + inflationPct / 100, years);
  }

  // lib/core/projection_math.dart:23 — projectFutureValue: monthly compounding, contributions at month end.
  function projectFutureValue(principal, monthlyContribution, annualReturnPct, months) {
    var r = annualReturnPct / 100 / 12;
    if (r < 0.0001) return principal + monthlyContribution * months;
    return principal * Math.pow(1 + r, months) + monthlyContribution * ((Math.pow(1 + r, months) - 1) / r);
  }

  // lib/core/projection_math.dart:39 — projectedNestEgg: contribute, then coast.
  function projectedNestEgg(o) {
    var horizonMonths = o.contributionYears * 12;
    var targetMonths = o.atYear * 12;
    if (targetMonths <= horizonMonths) {
      return projectFutureValue(o.nestEgg, o.monthlyContribution, o.annualReturnPct, targetMonths);
    }
    var atHorizon = projectFutureValue(o.nestEgg, o.monthlyContribution, o.annualReturnPct, horizonMonths);
    return projectFutureValue(atHorizon, 0, o.annualReturnPct, targetMonths - horizonMonths);
  }

  // lib/core/projection_math.dart:83 — monthlyWithdrawalIncome. Fed today's money, never the nominal
  // total (trajectory_projection_page.dart:185-197).
  function monthlyIncome(balance, withdrawalPct) {
    return balance * withdrawalPct / 100 / 12;
  }

  // lib/core/projection_math.dart:98 — monthlyContributionAt: no income, no contribution.
  function monthlyContributionAt(income, ratePct) {
    return income > 0 ? income * ratePct / 100 : 0;
  }

  // lib/core/projection_math.dart:167 — milestoneFor, with MilestoneData's total and multiple (:145-164).
  function milestone(nestEgg, monthly, year, o) {
    var horizonMonths = o.contributionYears * 12;
    var projected = projectedNestEgg({
      nestEgg: nestEgg,
      monthlyContribution: monthly,
      annualReturnPct: o.returnRate,
      contributionYears: o.contributionYears,
      atYear: year,
    });
    var rawContrib = monthly * Math.min(year * 12, horizonMonths);
    var contributions = Math.min(rawContrib, Math.max(0, projected - nestEgg));
    var gains = Math.max(0, projected - nestEgg - contributions);
    var total = nestEgg + contributions + gains;
    var principal = nestEgg + contributions;
    return {
      year: year,
      nestEgg: nestEgg,
      contributions: contributions,
      gains: gains,
      total: total,
      multiple: principal <= 0 ? null : total / principal,
    };
  }

  // lib/pages/home/trajectory_projection_page.dart:160-165 — every year from 0 to the span (40).
  function yearSeries(nestEgg, monthly, o) {
    var span = isNum(o.spanYears) ? o.spanYears : PROJECTION_SPAN_YEARS;
    var out = [];
    for (var y = 0; y <= span; y++) out.push(milestone(nestEgg, monthly, y, o));
    return out;
  }

  // ── Debt ───────────────────────────────────────────────────────────────────

  // lib/core/debt_payoff_simulation.dart:286 — a card paid to 1e-9 is paid.
  var DEBT_ZERO = 1e-6;

  // lib/core/debt_payoff_simulation.dart:127 — simulateDebtPayoff, with the Dart field names:
  // inputs [{ debtId, shape: 'revolving'|'installment', balanceHome, floorHome, aprPct|null }].
  function simulateDebtPayoff(debts, o) {
    var order = (o && o.order) || [];
    var capMonths = o && isNum(o.capMonths) ? o.capMonths : 600;
    var excluded = debts.filter(function (d) { return d.floorHome <= 0 && d.balanceHome > 0; })
      .map(function (d) { return d.debtId; });
    var live = debts.filter(function (d) { return d.floorHome > 0 && d.balanceHome > 0; });
    if (live.length === 0) {
      return {
        outcome: 'noPaymentData', months: null, totalInterestHome: null, perDebt: {},
        excludedDebtIds: excluded, seriesDebtIds: [], series: [],
      };
    }

    var rank = new Map();
    order.forEach(function (id, i) { rank.set(id, i); });
    function rankOf(id) { return rank.has(id) ? rank.get(id) : order.length; }
    var revolving = live.filter(function (d) { return d.shape === 'revolving'; })
      .sort(function (a, b) { return compareTo(rankOf(a.debtId), rankOf(b.debtId)); });

    var balance = new Map();
    var interest = new Map();
    live.forEach(function (d) { balance.set(d.debtId, d.balanceHome); interest.set(d.debtId, 0); });
    var clearedIn = new Map();

    var byMonth = [live.map(function (d) { return d.balanceHome; })];

    for (var month = 1; month <= capMonths; month++) {
      // 1. Accrue. Unrated and 0% both accrue nothing.
      live.forEach(function (d) {
        if (clearedIn.has(d.debtId)) return;
        var r = (isNum(d.aprPct) ? d.aprPct : 0) / 100 / 12;
        var accrued = balance.get(d.debtId) * r;
        balance.set(d.debtId, balance.get(d.debtId) + accrued);
        interest.set(d.debtId, interest.get(d.debtId) + accrued);
      });

      // 2. Every live debt takes its own floor; what it cannot use, and every cleared floor, is surplus.
      var surplus = 0;
      live.forEach(function (d) {
        if (clearedIn.has(d.debtId)) { surplus += d.floorHome; return; }
        var pay = clamp(d.floorHome, 0, balance.get(d.debtId));
        balance.set(d.debtId, balance.get(d.debtId) - pay);
        surplus += d.floorHome - pay;
      });

      // 3. Surplus to the lead REVOLVING debt, then the next. Never a loan.
      for (var i = 0; i < revolving.length; i++) {
        var d = revolving[i];
        if (surplus <= 0) break;
        if (clearedIn.has(d.debtId)) continue;
        var owed = balance.get(d.debtId);
        if (owed <= 0) continue;
        var pay = clamp(surplus, 0, owed);
        balance.set(d.debtId, owed - pay);
        surplus -= pay;
      }

      // 4. Who cleared this month.
      live.forEach(function (d) {
        if (clearedIn.has(d.debtId)) return;
        if (balance.get(d.debtId) <= DEBT_ZERO) clearedIn.set(d.debtId, month);
      });
      byMonth.push(live.map(function (d) { return clearedIn.has(d.debtId) ? 0 : balance.get(d.debtId); }));
      if (clearedIn.size === live.length) break;
    }

    // Stacking order: the last to clear at the floor; ties on the caller's order, the lead on top.
    var stacked = live.slice().sort(function (a, b) {
      var ca = clearedIn.has(a.debtId) ? clearedIn.get(a.debtId) : capMonths + 1;
      var cb = clearedIn.has(b.debtId) ? clearedIn.get(b.debtId) : capMonths + 1;
      if (ca !== cb) return compareTo(cb, ca);
      return compareTo(rankOf(b.debtId), rankOf(a.debtId));
    });
    var column = new Map();
    live.forEach(function (d, i) { column.set(d.debtId, i); });
    var seriesDebtIds = stacked.map(function (d) { return d.debtId; });
    var series = byMonth.map(function (row) {
      return stacked.map(function (d) { return row[column.get(d.debtId)]; });
    });

    var perDebt = {};
    live.forEach(function (d) {
      perDebt[d.debtId] = {
        clearedInMonth: clearedIn.has(d.debtId) ? clearedIn.get(d.debtId) : null,
        interestHome: isNum(d.aprPct) ? interest.get(d.debtId) : null,
      };
    });

    if (clearedIn.size < live.length) {
      return {
        outcome: 'neverAmortizes', months: null, totalInterestHome: null, perDebt: perDebt,
        excludedDebtIds: excluded, seriesDebtIds: seriesDebtIds, series: series,
      };
    }

    var anyUnrated = live.some(function (d) { return !isNum(d.aprPct); });
    var months = 0;
    clearedIn.forEach(function (m) { if (m > months) months = m; });
    return {
      outcome: 'amortizes',
      months: months,
      totalInterestHome: anyUnrated
        ? null
        : live.reduce(function (s, d) { return s + interest.get(d.debtId); }, 0),
      perDebt: perDebt,
      excludedDebtIds: excluded,
      seriesDebtIds: seriesDebtIds,
      series: series,
    };
  }

  // lib/core/debt_interest.dart:184 — sortDebtsByStrategy, the comparator ported literally. Dart's
  // switch has no fall-through: an avalanche tie leaves the switch for the balance-descending tiebreak.
  function sortDebtsByStrategy(views, strategy) {
    return views.slice().sort(function (a, b) {
      switch (strategy) {
        case 'avalanche': {
          var ar = isNum(a.aprPct) ? a.aprPct : null;
          var br = isNum(b.aprPct) ? b.aprPct : null;
          if (ar === null && br !== null) return 1;
          if (br === null && ar !== null) return -1;
          if (ar !== null && br !== null) {
            var c = compareTo(br, ar);
            if (c !== 0) return c;
          }
          break;
        }
        case 'snowball': {
          var c2 = compareTo(a.balanceHome, b.balanceHome);
          if (c2 !== 0) return c2;
          break;
        }
      }
      return compareTo(b.balanceHome, a.balanceHome);
    });
  }

  // The site's debt row → the simulation's view. A card is the one revolving shape
  // (lib/domain/enums.dart:414); the typed monthly payment is the floor.
  function viewOf(d) {
    return {
      debtId: String(d.id),
      shape: d.kind === 'card' ? 'revolving' : 'installment',
      balanceHome: Number(d.balance) || 0,
      floorHome: Number(d.payment) || 0,
      aprPct: isNum(d.apr) && d.apr !== '' ? Number(d.apr) : null,
    };
  }

  // lib/providers/home/debts.dart:488-493 — avalanche when any debt carries a rate, else snowball.
  function debtStrategy(debts) {
    return debts.some(function (d) { return isNum(d.apr) && d.apr !== ''; }) ? 'avalanche' : 'snowball';
  }

  // The site's debts [{ id, kind: 'card'|'loan', balance, apr|null, payment }] in the order in force.
  function debtOrder(debts) {
    var byId = new Map();
    debts.forEach(function (d) { byId.set(String(d.id), d); });
    return sortDebtsByStrategy(debts.map(viewOf), debtStrategy(debts))
      .map(function (v) { return byId.get(v.debtId); });
  }

  // lib/core/debt_zones.dart:59,68 — fixed boundaries, in home-currency units. Never scaled.
  var DEBT_RATE_SPLIT_PCT = 20;
  var DEBT_BALANCE_SPLIT_HOME = 31622.776601683792;

  // lib/core/debt_zones.dart:82 — debtZoneOf: `>=` goes to the costly / large side; no rate, no zone.
  function debtZone(debt) {
    var apr = debt.apr;
    if (!isNum(apr) || apr === '') return null;
    var costly = Number(apr) >= DEBT_RATE_SPLIT_PCT;
    var large = Number(debt.balance) >= DEBT_BALANCE_SPLIT_HOME;
    var key = large ? (costly ? 'largeCostly' : 'largeCheap') : (costly ? 'smallCostly' : 'smallCheap');
    var z = DEBT_ZONES.filter(function (x) { return x.key === key; })[0];
    return {
      key: z.key,
      rank: z.rank,
      label: z.label,
      rankedLabel: z.rank + ' \u00B7 ' + z.label,
      gloss: z.gloss,
      isCostly: costly,
      isLarge: large,
    };
  }

  // lib/providers/home/debts.dart:513-641 — debtPayoffPlan: one run under the order in force, and each
  // debt's outcome read off it (excluded → noPaymentData; cleared → amortizes; else neverAmortizes).
  function debtPayoff(debts) {
    var strategy = debtStrategy(debts);
    var views = debts.map(viewOf);
    var sorted = sortDebtsByStrategy(views, strategy);
    var run = simulateDebtPayoff(views, { order: sorted.map(function (v) { return v.debtId; }) });
    var byId = new Map();
    debts.forEach(function (d) { byId.set(String(d.id), d); });
    var rows = sorted.map(function (v) {
      var per = run.perDebt[v.debtId];
      var excluded = run.excludedDebtIds.indexOf(v.debtId) >= 0;
      var cleared = per && isNum(per.clearedInMonth) ? per.clearedInMonth : null;
      var outcome = excluded ? 'noPaymentData'
        : cleared !== null ? 'amortizes'
          : v.balanceHome <= 0 ? 'amortizes'
            : 'neverAmortizes';
      var d = byId.get(v.debtId);
      return {
        id: d.id,
        kind: d.kind,
        name: d.name,
        balance: v.balanceHome,
        apr: v.aprPct,
        payment: v.floorHome,
        clearMonth: cleared,
        interest: per ? per.interestHome : null,
        outcome: outcome,
        zone: debtZone({ apr: v.aprPct, balance: v.balanceHome }),
      };
    });
    return {
      strategy: strategy,
      outcome: run.outcome,
      months: run.months,
      totalInterest: run.totalInterestHome,
      excludedIds: run.excludedDebtIds,
      debts: rows,
      seriesIds: run.seriesDebtIds,
      series: run.series,
    };
  }

  // lib/core/debt_interest.dart:134 — '26% APR', '21.5% APR'.
  function debtRateLabel(apr) {
    var oneDp = apr.toFixed(1);
    var trimmed = oneDp.slice(-2) === '.0' ? oneDp.slice(0, -2) : oneDp;
    return trimmed + '% APR';
  }

  // ── The app's option lists and words ──────────────────────────────────────

  function tier(value, label, line) {
    return { value: value, label: label, line: line };
  }

  // lib/domain/coverage_tiers.dart:75
  var LIFE_YEARS = [
    tier(5, '5 years', 'A short span to cover'),
    tier(10, '10 years', 'A decade of support'),
    tier(15, '15 years', 'Most of a childhood'),
    tier(20, '20 years', 'A long span to cover'),
    tier(25, '25 years', 'Into a spouse\'s later years'),
  ];

  // lib/domain/coverage_tiers.dart:701 — _horizonBlurb (25 is its default arm).
  var HORIZON_BLURB = {
    5: 'Time to settle and find footing',
    10: 'Long enough to retrain and rebuild',
    15: 'Through the school years',
    20: 'Until the children are independent',
    25: 'Into a spouse\'s retirement',
  };

  // lib/providers/home/insurance.dart:956
  var LIFE_BENCHMARK_MULTIPLE = 10;

  // lib/domain/coverage_tiers.dart:489-499
  var HEALTH_BILLS = [
    { anchorPhp: 1000000, line: 'A public hospital, a major episode' },
    { anchorPhp: 2000000, line: 'A private hospital, surgery and recovery' },
    { anchorPhp: 3000000, line: 'A long course of treatment, privately' },
    { anchorPhp: 5000000, line: 'A years-long illness, or treatment abroad' },
  ];
  var HEALTH_DEFAULT_BILL = 2000000;

  // lib/widgets/reserve_scale_track.dart:53
  var RESERVE_MILESTONES = [3, 6, 9, 12];

  // lib/core/projection_math.dart:132
  var PROJECTION_SPAN_YEARS = 40;

  // lib/pages/home/debt_quadrant.dart:61 (labels), debt_zones.dart:26 (rank = declaration order),
  // lib/pages/onboarding/concepts/debt_payoff_beats.dart:97 (glosses).
  var DEBT_ZONES = [
    { key: 'smallCostly', rank: 1, label: 'Small & costly', gloss: 'Costs most while it lasts. Start here.' },
    { key: 'smallCheap', rank: 2, label: 'Small & cheap', gloss: 'Frees a payment, so size beats rate.' },
    { key: 'largeCostly', rank: 3, label: 'Big & costly', gloss: 'Expensive, but too big for momentum.' },
    { key: 'largeCheap', rank: 4, label: 'Big & cheap', gloss: 'Costs little, so it can wait until last.' },
  ];

  var tiers = {
    // .claude/agents/abby.md:202-205 — the canonical status labels.
    status: {
      healthy: 'On track',
      attention: 'Needs attention',
      atRisk: 'At risk',
      notSetUp: 'Not set up',
    },
    life: {
      // lib/domain/coverage_tiers.dart:378, :396; coverage_assumption_sheets.dart:244-245
      replacement: {
        title: 'How much to replace',
        subtitle: 'The share of household income the cover has to produce.',
        default: 75,
        options: [
          tier(100, '100%', 'Replaces all of it'),
          tier(75, '75%', 'Most of it, with real cuts'),
          tier(50, '50%', 'Half, assuming the household adapts'),
          tier(30, '30%', 'Essentials only'),
        ],
      },
      // lib/domain/coverage_tiers.dart:75, :115; coverage_assumption_sheets.dart:88-89
      years: {
        title: 'For how long',
        subtitle: 'The span the cover has to last. The last year empties it.',
        default: 20,
        options: LIFE_YEARS,
        blurb: HORIZON_BLURB,
      },
      // lib/domain/coverage_tiers.dart:202, :221; coverage_assumption_sheets.dart:488-490
      investmentRate: {
        title: 'Return on the payout',
        subtitle: 'What the proceeds earns each year while the family draws on it. A higher return means less cover to buy.',
        default: 7,
        options: [
          tier(2, '2%', 'Held in cash'),
          tier(5, '5%', 'Mostly in bonds'),
          tier(7, '7%', 'A mixture of bonds and equities'),
        ],
      },
      // lib/domain/coverage_tiers.dart:245, :273; coverage_assumption_sheets.dart:514-516
      inflation: {
        title: 'Inflation',
        subtitle: 'How much prices rise each year. The family draws a little more every year to keep up.',
        default: 3,
        options: [
          tier(2, '2%', 'Low \u2014 prices creep up slowly; your money holds its value well'),
          tier(3, '3%', 'Typical \u2014 close to what most years look like'),
          tier(4, '4%', 'Elevated \u2014 prices climb faster than usual'),
          tier(6, '6%', 'High \u2014 prices rise fast and buying power erodes quickly'),
        ],
      },
      // lib/domain/coverage_tiers.dart:306, :329; coverage_assumption_sheets.dart:541-544
      settlement: {
        title: 'Settling the estate',
        subtitle: 'A funeral, the paperwork and any estate tax come out of the payout before the family can invest the rest.',
        default: 5,
        options: [
          tier(0, '0%', 'No allowance'),
          tier(3, '3%', 'A simple funeral'),
          tier(5, '5%', 'A funeral and the paperwork'),
          tier(10, '10%', 'Estate tax plus the cost of settling'),
          tier(15, '15%', 'A longer, costlier settlement'),
        ],
      },
      // lib/domain/coverage_tiers.dart:528, :530; coverage_assumption_sheets.dart:433-434
      assetCommit: {
        title: 'From your savings',
        subtitle: 'How much of it the family would draw on.',
        default: 100,
        options: [0, 25, 50, 75, 100],
      },
      benchmarkMultiple: LIFE_BENCHMARK_MULTIPLE,
    },
    health: {
      // lib/domain/coverage_tiers.dart:489, :499 (peso anchors; healthBillTiers converts them)
      bill: {
        title: 'The hospital bill',
        subtitle: 'What one serious illness would cost you.',
        default: HEALTH_DEFAULT_BILL,
        options: HEALTH_BILLS,
      },
      // lib/domain/coverage_tiers.dart:508, :510
      efShare: {
        title: 'From your emergency fund',
        subtitle: 'How much of it you would spend getting through this.',
        default: 100,
        options: [0, 25, 50, 75, 100],
      },
      // lib/domain/coverage_tiers.dart:405, :432
      recovery: {
        title: 'While you recover',
        subtitle: 'How much of your income you would need each month.',
        default: 100,
        options: [
          tier(50, '50%', 'Treatment, with the household intact'),
          tier(75, '75%', 'Treatment and most of a lost income'),
          tier(100, '100%', 'A full income replaced while you recover'),
          tier(125, '125%', 'Care costs on top of the income'),
        ],
      },
      minSpanMonths: HEALTH_MIN_SPAN_MONTHS,
      maxSpanMonths: HEALTH_MAX_SPAN_MONTHS,
    },
    // lib/widgets/reserve_scale_track.dart:27-53, :102-108
    reserve: {
      scaleMax: 12,
      bandLow: 3,
      bandHigh: 6,
      milestones: RESERVE_MILESTONES.map(function (m) { return { months: m, name: milestoneName(m) }; }),
    },
    investment: {
      // lib/domain/investment_tiers.dart:93-114, :15
      target: {
        default: 15,
        options: [
          tier(10, '10%', 'A starting point: builds the habit, won\'t move your timeline'),
          tier(15, '15%', 'The standard floor for long-term retirement security'),
          tier(25, '25%', 'Meaningfully shortens the timeline to financial independence'),
          tier(40, '40%+', 'Aggressive \u2014 requires household sacrifice, accelerates exit from earned income'),
        ],
      },
      // lib/domain/investment_tiers.dart:70, :86
      workedExampleTarget: 10,
      assumedRate: 10,
    },
    projection: {
      // lib/domain/projection_tiers.dart:28; projection_providers.dart:62; trajectory_sheets.dart:364-365
      returnRate: {
        title: 'Annual Return',
        subtitle: 'How much your investments grow each year, on average.',
        default: 7,
        options: [
          tier(5, '5%', 'Conservative \u2014 bond-heavy or low-risk portfolio'),
          tier(7, '7%', 'Balanced \u2014 diversified index fund assumption'),
          tier(10, '10%', 'Equity-heavy \u2014 historical S&P 500 average'),
          tier(12, '12%', 'Optimistic \u2014 aggressive growth estimate'),
        ],
      },
      // lib/domain/projection_tiers.dart:53; projection_providers.dart:80; trajectory_sheets.dart:396-397
      inflation: {
        title: 'Inflation',
        subtitle: 'How much prices rise each year. The higher it is, the faster your future balance loses buying power.',
        default: 3,
        options: [
          tier(2, '2%', 'Low \u2014 prices creep up slowly; your money holds its value well'),
          tier(3, '3%', 'Typical \u2014 close to what most years look like'),
          tier(4, '4%', 'Elevated \u2014 prices climb faster than usual'),
          tier(6, '6%', 'High \u2014 prices rise fast and buying power erodes quickly'),
        ],
      },
      // lib/domain/projection_tiers.dart:100; projection_providers.dart:98; trajectory_sheets.dart:428-429
      withdrawal: {
        title: 'Withdrawal Rate',
        subtitle: 'The share of your nest egg you would draw each year. The lower it is, the longer the money lasts.',
        default: 4,
        options: [
          tier(2.5, '2.5%', 'Cautious \u2014 built to outlast long retirements and bad decades'),
          tier(3, '3%', 'Conservative \u2014 a common rate for a retirement with no end date'),
          tier(4, '4%', 'The classic rule \u2014 the 30-year rate from the Trinity study'),
          tier(5, '5%', 'Aggressive \u2014 assumes a shorter horizon or room to cut back'),
        ],
      },
      // lib/domain/projection_tiers.dart:135; projection_providers.dart:155; trajectory_sheets.dart:468-531
      // The app's row reads "Until <this year + N>" over "N years from now".
      contributionYears: {
        title: 'Contribution Horizon',
        subtitle: 'How many years will you keep investing?',
        default: 30,
        options: [10, 20, 25, 30, 40].map(function (n) { return tier(n, n + ' years', n + ' years from now'); }),
      },
      // lib/providers/projection_providers.dart:255; projection_math.dart:132-135
      viewYear: { default: 30, max: PROJECTION_SPAN_YEARS, dialSteps: [10, 20, 30, 40] },
    },
    debt: {
      // lib/core/debt_zones.dart:59, :68 — home-currency units, never scaled by the currency factor.
      rateSplitPct: DEBT_RATE_SPLIT_PCT,
      balanceSplit: DEBT_BALANCE_SPLIT_HOME,
      // lib/core/debt_payoff_simulation.dart:130
      capMonths: 600,
      zones: DEBT_ZONES,
    },
  };

  // ── The concept walks' sample households ──────────────────────────────────

  // lib/core/ghost_debt_samples.dart:28 — per currency, one debt per zone, never scaled.
  var debtSamples = {
    USD: { card: 6000, cardRate: 24, family: 2000, personal: 40000, personalRate: 22, car: 45000, carRate: 7 },
    EUR: { card: 4000, cardRate: 21, family: 1500, personal: 38000, personalRate: 22, car: 40000, carRate: 6 },
    GBP: { card: 3500, cardRate: 24, family: 1500, personal: 35000, personalRate: 21, car: 38000, carRate: 8 },
    CAD: { card: 7000, cardRate: 21, family: 2000, personal: 40000, personalRate: 22, car: 50000, carRate: 7 },
    AUD: { card: 7000, cardRate: 21, family: 2000, personal: 40000, personalRate: 22, car: 55000, carRate: 7 },
    AED: { card: 20000, cardRate: 36, family: 8000, personal: 150000, personalRate: 24, car: 120000, carRate: 4 },
    SGD: { card: 8000, cardRate: 26, family: 3000, personal: 60000, personalRate: 21, car: 90000, carRate: 3 },
    PHP: { card: 18000, cardRate: 36, family: 12000, personal: 240000, personalRate: 24, car: 820000, carRate: 7 },
  };

  // lib/core/ghost_debt_samples.dart:149 — ghostDebtViewsFor: the four debts in the order they are
  // attacked, each with its zone. An unknown currency gets the USD row (:106).
  function debtSampleViews(code) {
    var s = debtSamples[code] || debtSamples.USD;
    return [
      { id: 'card', name: 'Store card', kind: 'card', balance: s.card, apr: s.cardRate },
      { id: 'family', name: 'Family loan', kind: 'loan', balance: s.family, apr: 0 },
      { id: 'personal', name: 'Personal loan', kind: 'loan', balance: s.personal, apr: s.personalRate },
      { id: 'car', name: 'Car loan', kind: 'loan', balance: s.car, apr: s.carRate },
    ].map(function (d) {
      d.zone = debtZone(d);
      return d;
    });
  }

  // lib/pages/onboarding/concepts/coverage_method_beats.dart:63-130
  function lifeSample() {
    var need = 900000;
    var income = 1200000;
    var rates = { investmentRatePct: 6, incomeGrowthPct: 3 };
    function coverFor(years) {
      return growingAnnuityDue({ annualDraw: need, investmentRatePct: 6, incomeGrowthPct: 3, years: years });
    }
    var rule = ruleOfThumb(income, { annualDraw: need, investmentRatePct: 6, incomeGrowthPct: 3, years: 20 });
    return {
      annualNeed: need,
      annualIncome: income,
      ruleOfThumbCover: income * LIFE_BENCHMARK_MULTIPLE,
      returnPct: rates.investmentRatePct,
      inflationPct: rates.incomeGrowthPct,
      spans: [10, 20, 30],
      spanDefault: 20,
      coverFor: { 10: coverFor(10), 20: coverFor(20), 30: coverFor(30) },
      // sampleDrawdownFor(20): the need drawn to zero, the chart's solid area.
      drawdown: drawdownSeries({ capital: coverFor(20), annualDraw: need, investmentRatePct: 6, incomeGrowthPct: 3, years: 20 }),
      // sampleRuleDrawdown(): the 10× cover's dashed line.
      ruleDrawdown: rule.series,
      ruleDryYear: rule.dryYear,
      ruleYearsFunded: rule.yearsFunded,
      unfundedYears: rule.unfundedYears,
    };
  }

  // lib/pages/onboarding/concepts/health_recovery_beats.dart:41-63 — the Life sample's income, by the month.
  function healthSample() {
    var inputs = {
      catastrophicBill: 1000000,
      annualLimit: 400000,
      lumpSum: 1000000,
      emergencyFund: 100000,
      efConsumePct: 100,
      monthlyIncome: 1200000 / 12,
      recoveryPct: 100,
    };
    var cover = healthRecovery(inputs);
    return { inputs: inputs, cover: cover, drawdown: healthDrawdown(cover) };
  }

  // lib/pages/onboarding/concepts/cash_purpose_beats.dart:64-89 (figures), :115-122 (glosses);
  // lib/core/cash_zones.dart:96-100 (labels). The shares close on 100.
  var cashSample = {
    purposes: [
      { key: 'emergencyFund', label: 'Emergency Fund', amount: 180000, sharePct: 36, accountCount: 1,
        gloss: 'Kept for emergencies. It is the only savings here.' },
      { key: 'plannedExpenses', label: 'Recurring Expenses', amount: 120000, sharePct: 24, accountCount: 2,
        gloss: 'Bills you know are coming. That money is already spent.' },
      { key: 'savingsGoals', label: 'One-time Expenses', amount: 150000, sharePct: 30, accountCount: 2,
        gloss: 'A purchase you have decided on. That money is spent too.' },
      { key: 'unassigned', label: 'Unassigned', amount: 50000, sharePct: 10, accountCount: 1,
        gloss: 'It is not a buffer. Give it a purpose.' },
    ],
    total: 500000,
  };

  var debtSampleByCurrency = {};
  Object.keys(debtSamples).forEach(function (code) { debtSampleByCurrency[code] = debtSampleViews(code); });

  var samples = {
    life: lifeSample(),
    health: healthSample(),
    cash: cashSample,
    debt: debtSampleByCurrency,
  };

  return {
    // life
    growingAnnuityDue: growingAnnuityDue,
    yearsFundedBy: yearsFundedBy,
    drawdownYears: drawdownYears,
    drawdownSeries: drawdownSeries,
    lifeNeed: lifeNeed,
    lifeDrawdown: lifeDrawdown,
    lifeNeedAt: lifeNeedAt,
    ruleOfThumb: ruleOfThumb,
    coverageHorizonTiers: coverageHorizonTiers,
    // critical illness
    healthRecovery: healthRecovery,
    healthDrawdown: healthDrawdown,
    healthSpanMonths: healthSpanMonths,
    healthAnchorToHome: healthAnchorToHome,
    healthBillTiers: healthBillTiers,
    // emergency fund
    reserve: reserve,
    // investment rate and projection
    investmentRate: investmentRate,
    investmentStatus: investmentStatus,
    projectFutureValue: projectFutureValue,
    projectedNestEgg: projectedNestEgg,
    milestone: milestone,
    yearSeries: yearSeries,
    todaysMoney: todaysMoney,
    monthlyIncome: monthlyIncome,
    monthlyContributionAt: monthlyContributionAt,
    // debt
    simulateDebtPayoff: simulateDebtPayoff,
    sortDebtsByStrategy: sortDebtsByStrategy,
    debtStrategy: debtStrategy,
    debtOrder: debtOrder,
    debtPayoff: debtPayoff,
    debtZone: debtZone,
    debtRateLabel: debtRateLabel,
    debtSamples: debtSamples,
    debtSampleViews: debtSampleViews,
    // words and households
    tiers: tiers,
    samples: samples,
    // Dart semantics, shared with money.js's tests
    roundHalfAway: roundHalfAway,
  };
});
