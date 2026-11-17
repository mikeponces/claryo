// The site's calculators must compute exactly what the Flutter app computes. These are the app's own
// Dart fixtures, ported: each group names the test file it came from. Not published (Jekyll skips
// "_" folders). Run: node --test _tests/calc_math.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import calc from '../assets/js/calc-math.js';

const close = (actual, expected, tolerance, msg) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) <= tolerance,
    `${msg ? msg + ': ' : ''}${actual} is not within ${tolerance} of ${expected}`,
  );

// money.js runs in its own realm, so its objects are compared by value.
const plain = (o) => JSON.parse(JSON.stringify(o));

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── A minimal DOM, enough for money.js's rewrite ──────────────────────────────

class FakeText {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  get parentElement() { return this.parentNode; }
  get nextSibling() { return siblingAfter(this); }
}

class FakeEl {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = Object.assign({}, attrs);
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.classList = { contains: (c) => (this.attrs.class || '').split(/\s+/).includes(c) };
    children.forEach((c) => this.append(c));
  }
  append(c) {
    const node = typeof c === 'string' ? new FakeText(c) : c;
    node.parentNode = this;
    this.childNodes.push(node);
  }
  get parentElement() { return this.parentNode; }
  get nextSibling() { return siblingAfter(this); }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
  set textContent(v) { this.childNodes = []; this.append(String(v)); }
  matches(sel) { return sel.split(',').some((s) => matchOne(this, s.trim())); }
  closest(sel) {
    for (let e = this; e; e = e.parentNode) if (e.matches(sel)) return e;
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (e) => e.childNodes.forEach((c) => {
      if (c.nodeType !== 1) return;
      if (c.matches(sel)) out.push(c);
      walk(c);
    });
    walk(this);
    return out;
  }
}

function siblingAfter(node) {
  if (!node.parentNode) return null;
  const k = node.parentNode.childNodes;
  return k[k.indexOf(node) + 1] || null;
}

function matchOne(el, s) {
  let m = s.match(/^\[([\w-]+)\*="(.*)"\]$/);
  if (m) return (el.getAttribute(m[1]) || '').includes(m[2]);
  m = s.match(/^\[([\w-]+)\]$/);
  if (m) return el.getAttribute(m[1]) !== null;
  return el.tagName === s.toUpperCase();
}

function textsUnder(root) {
  const out = [];
  const walk = (e) => e.childNodes.forEach((c) => (c.nodeType === 3 ? out.push(c) : walk(c)));
  walk(root);
  return out;
}

const h = (tag, attrs, ...children) => new FakeEl(tag, attrs, children);

// Loads money.js in its own realm, the way a browser would run it.
function loadMoney({ search = '', timeZone = 'Asia/Manila', languages = ['en-US'], body = h('body', {}) } = {}) {
  const window = {};
  const document = {
    readyState: 'complete',
    documentElement: { dataset: {} },
    body,
    addEventListener() {},
    createTreeWalker(root) {
      const nodes = textsUnder(root);
      let i = -1;
      return {
        currentNode: null,
        nextNode() {
          i += 1;
          this.currentNode = nodes[i] || null;
          return this.currentNode;
        },
      };
    },
  };
  const FakeIntl = {
    DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }),
    Locale: Intl.Locale,
  };
  vm.runInNewContext(read('../assets/js/money.js'), {
    window,
    document,
    location: { search },
    navigator: { languages, language: languages[0] },
    Intl: FakeIntl,
    URLSearchParams,
    NodeFilter: { SHOW_TEXT: 4 },
    WeakSet,
  });
  return { M: window.ClaryoMoney, document, body };
}

const PHP = loadMoney().M;

// ── The module itself ─────────────────────────────────────────────────────────

describe('the two scripts', () => {
  test('calc-math.js default-imports in Node and sets window.ClaryoCalc in a browser', () => {
    assert.equal(typeof calc.growingAnnuityDue, 'function');
    const ctx = {};
    vm.runInNewContext(read('../assets/js/calc-math.js'), ctx);
    assert.equal(typeof ctx.ClaryoCalc.debtPayoff, 'function');
  });

  test('browser-safe syntax: no ?., ??, optional catch binding or replaceChildren', () => {
    for (const file of ['../assets/js/calc-math.js', '../assets/js/money.js']) {
      const code = read(file).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      assert.doesNotMatch(code, /\?\.|\?\?|catch\s*\{|replaceChildren/, file);
    }
  });
});

// ── Life cover — test/core/life_coverage_test.dart ───────────────────────────

const DRAW = 720000; // ₱60,000 a month, 30% of a ₱200,000 household
const basis = (o = {}) => Object.assign({
  annualBasis: 2400000, replacementPct: 30, years: 20, investmentRatePct: 6, incomeGrowthPct: 4,
  debtPayoff: 0, settlementPct: 0, liquidAssets: 0, assetCommitPct: 100,
}, o);
const life = (o, held) => calc.lifeNeed(Object.assign(basis(o), { heldCoverage: held }));
const pow = (b, e) => { let out = 1; for (let i = 0; i < e; i++) out *= b; return out; };
const due = (o = {}) => calc.growingAnnuityDue(Object.assign(
  { annualDraw: DRAW, investmentRatePct: 6, incomeGrowthPct: 4, years: 20 }, o));
const funded = (o) => calc.yearsFundedBy(Object.assign({ annualDraw: DRAW, investmentRatePct: 6, incomeGrowthPct: 4 }, o));

describe('growingAnnuityDue', () => {
  test('is an annuity DUE: 720,000 at 6%/4% over 20 years is 12,088,990.57', () => {
    close(due(), 12088990.57, 0.01);
    const ordinary = DRAW * (1 - pow(1.04 / 1.06, 20)) / 0.02;
    close(ordinary / 1e6, 11.405, 0.001);
    close(due(), ordinary * 1.06, 0.01);
  });

  test('r == g is EXACT: the draw times the years', () => {
    assert.equal(due({ investmentRatePct: 6, incomeGrowthPct: 6 }), DRAW * 20);
  });

  test('2% return with 2% inflation is finite everywhere, never NaN', () => {
    assert.equal(due({ investmentRatePct: 2, incomeGrowthPct: 2 }), DRAW * 20);
    const years = funded({ capital: 5e6, investmentRatePct: 2, incomeGrowthPct: 2 });
    assert.ok(Number.isFinite(years));
    close(years, 5e6 / DRAW, 1e-9);
    const l = life({ investmentRatePct: 2, incomeGrowthPct: 2 }, 5e6);
    for (const k of ['incomeNeeded', 'fundsFamily', 'incomeShare', 'incomeShortfall', 'yearsCovered']) {
      assert.ok(Number.isFinite(l[k]), k);
    }
    for (const row of calc.lifeDrawdown(l).held) assert.ok(Number.isFinite(row.balance));
  });

  test('the exact branch IS the limit of the closed form', () => {
    close(due({ incomeGrowthPct: 5.9999 }), DRAW * 20, DRAW * 20 * 0.0001);
  });

  test('nothing to fund is nothing to buy', () => {
    assert.equal(due({ years: 0 }), 0);
    assert.equal(due({ years: -1 }), 0);
    assert.equal(due({ annualDraw: 0 }), 0);
  });

  test('a faster-growing draw costs more; a better return costs less', () => {
    assert.ok(due({ incomeGrowthPct: 5 }) > due());
    assert.ok(due({ investmentRatePct: 7 }) < due());
  });
});

describe('yearsFundedBy', () => {
  test('inverts the annuity: the sized capital funds exactly the span', () => {
    close(funded({ capital: due() }), 20, 0.0001);
  });

  test('NULL means never runs out: 40M is null, 38M is not', () => {
    assert.equal(funded({ capital: 40000000 }), null);
    assert.notEqual(funded({ capital: 38000000 }), null);
  });

  test('a draw outrunning the return still terminates', () => {
    const years = funded({ capital: 12089000, investmentRatePct: 4, incomeGrowthPct: 5 });
    assert.ok(years > 0 && years < 20);
  });

  test('r == g divides; no capital is no years; no draw is no answer; the capital guard wins', () => {
    close(funded({ capital: DRAW * 7, incomeGrowthPct: 6 }), 7, 0.0001);
    assert.equal(funded({ capital: 0 }), 0);
    assert.equal(funded({ capital: 1000000, annualDraw: 0 }), null);
    assert.equal(funded({ capital: 0, annualDraw: 0 }), 0);
  });
});

describe('drawdownSeries', () => {
  const series = (o) => calc.drawdownSeries(Object.assign(
    { annualDraw: DRAW, investmentRatePct: 6, incomeGrowthPct: 4, years: 20 }, o));

  test('the closed form and the simulation agree: it lands on zero', () => {
    const s = series({ capital: due() });
    assert.equal(s.length, 21);
    close(s[0], due(), 0.001);
    close(s[20], 0, 0.01);
  });

  test('it agrees at every horizon', () => {
    for (const years of [5, 10, 15, 20, 25, 30]) {
      const s = series({ capital: due({ years }), years });
      assert.equal(s.length, years + 1);
      close(s[years], 0, 0.01, `${years} years`);
    }
  });

  test('r == g lands on zero too', () => {
    close(series({ capital: DRAW * 20, incomeGrowthPct: 6 }).at(-1), 0, 0.01);
  });

  test('a short capital reaches the floor and stays there', () => {
    const s = series({ capital: 2000000 });
    assert.ok(s.every((v) => v >= 0));
    assert.equal(s.at(-1), 0);
  });
});

describe('drawdownYears', () => {
  const rowsOf = (o) => calc.drawdownYears(Object.assign(
    { annualDraw: DRAW, investmentRatePct: 6, incomeGrowthPct: 4, years: 20 }, o));

  test('the crossover year is marked short while still paying part', () => {
    const rows = rowsOf({ capital: 2000000 });
    const crossover = rows.find((r) => !r.funded);
    assert.ok(crossover.draw > 0 && crossover.draw < crossover.required && crossover.balance > 0);
    for (const r of rows.filter((x) => x.year < crossover.year)) {
      assert.ok(r.funded);
      close(r.draw, r.required, 0.005);
    }
    for (const r of rows.filter((x) => x.year > crossover.year && x.year < 20)) {
      assert.equal(r.funded, false);
      assert.equal(r.draw, 0);
      assert.ok(r.required > 0);
    }
  });

  test('the closing entry is not a drawdown year', () => {
    const rows = rowsOf({ capital: due() });
    assert.equal(rows.length, 21);
    const last = rows.at(-1);
    assert.deepEqual([last.year, last.draw, last.required, last.growth, last.funded], [20, 0, 0, 0, true]);
    close(last.balance, 0, 0.01);
    assert.ok(rows.every((r) => r.funded));
  });

  test('the requirement grows at g and ignores the balance', () => {
    const rows = rowsOf({ capital: 1, years: 5 });
    for (let t = 0; t < 5; t++) close(rows[t].required, DRAW * pow(1.04, t), 0.01, `year ${t}`);
  });

  test('growth is earned on what is LEFT after the draw', () => {
    close(rowsOf({ capital: 10000000, years: 3 })[0].growth, (10000000 - DRAW) * 0.06, 0.01);
  });
});

describe('lifeNeed (computeLifeCoverage)', () => {
  test('the settlement is a share of the COVER, not of assets', () => {
    const c = life({ debtPayoff: 975770, settlementPct: 5 }, 13000000);
    close(c.settlementCosts, 975770 + 650000, 0.01);
    close(c.fundsFamily, 13000000 - 975770 - 650000, 0.01);
    assert.equal(c.settlementCovered, true);
  });

  test('the need and the settlement are never summed', () => {
    const c = life({ debtPayoff: 1000000, settlementPct: 10 }, 20000000);
    close(c.incomeNeeded, 12089000, 1000);
    close(c.settlementCosts, 3000000, 0.01);
    close(c.fundsFamily, 17000000, 0.01);
    assert.equal(c.covered, true);
    const againstGross = funded({ capital: c.held, annualDraw: c.annualDraw });
    assert.ok(c.yearsCovered < againstGross);
    close(c.settlementShare, 2000000, 0.01);
  });

  test('a shortfall is stated both ways: 6,088,990.57 short, incomeShare 0.49632', () => {
    const short = life({}, 6000000);
    assert.equal(short.covered, false);
    close(short.incomeShortfall, 6088990.57, 0.01);
    close(short.incomeShortfall, short.incomeNeeded - 6000000, 0.01);
    close(short.incomeShare, 0.49632, 0.00001);
    const covered = life({}, 20000000);
    assert.equal(covered.covered, true);
    assert.equal(covered.incomeShortfall, 0);
  });

  test('the family drawdown marks its first dry year off `funded`', () => {
    const d = calc.lifeDrawdown(life({}, 6000000));
    assert.equal(d.needed.length, 21);
    assert.equal(d.firstDry, 8); // yearsCovered 8.98: year 8 is the crossover
    assert.ok(d.held[8].draw > 0 && !d.held[8].funded);
    assert.equal(calc.lifeDrawdown(life({}, 20000000)).firstDry, -1);
  });

  test('cover swallowed whole by the settlement funds nothing', () => {
    const c = life({ debtPayoff: 5000000 }, 1000000);
    assert.equal(c.settlementCovered, false);
    assert.equal(c.fundsFamily, 0);
    assert.equal(c.yearsCovered, 0);
    assert.equal(c.covered, false);
    close(c.settlementShortfall, 4000000, 0.01);
  });

  test('…but savings still fund the family', () => {
    const c = life({ debtPayoff: 5000000, liquidAssets: 6000000 }, 1000000);
    close(c.fundsFamily, 2000000, 1);
    assert.equal(c.settlementCovered, true);
    assert.ok(c.yearsCovered > 0);
    assert.equal(c.settlementShortfall, 0);
  });

  test('savings fund the family and leave the settlement alone', () => {
    const bare = life({ settlementPct: 10, debtPayoff: 100000 }, 2000000);
    const banked = life({ settlementPct: 10, debtPayoff: 100000, liquidAssets: 5000000 }, 2000000);
    close(banked.settlementCosts, bare.settlementCosts, 0.01);
    close(banked.fundsFamily, bare.fundsFamily + 5000000, 0.01);
  });

  test('the share decides how much of the pile the family draws', () => {
    const at = (pct) => life({ liquidAssets: 4000000, assetCommitPct: pct }, 1000000);
    close(at(100).assetsUsed, 4000000, 0.01);
    close(at(100).fundsFamily, 5000000, 0.01);
    close(at(50).assetsUsed, 2000000, 0.01);
    close(at(50).fundsFamily, 3000000, 0.01);
    assert.equal(at(0).assetsUsed, 0);
    close(at(0).fundsFamily, 1000000, 0.01);
    // The default share is 100, the app's kDefaultAssetCommitPct.
    const unset = calc.lifeNeed(Object.assign(basis({ liquidAssets: 4000000 }), { assetCommitPct: undefined, heldCoverage: 1000000 }));
    close(unset.fundsFamily, 5000000, 0.01);
  });

  test('the share leaves the settlement alone, and the Estate row closes at a non-100 share', () => {
    const whole = life({ settlementPct: 10, liquidAssets: 4000000, assetCommitPct: 100 }, 2000000);
    const none = life({ settlementPct: 10, liquidAssets: 4000000, assetCommitPct: 0 }, 2000000);
    close(none.settlementCosts, whole.settlementCosts, 0.01);
    close(none.fundsFamily, whole.fundsFamily - 4000000, 0.01);
    const c = life({ settlementPct: 10, debtPayoff: 250000, liquidAssets: 4000000, assetCommitPct: 25 }, 2000000);
    close(c.held + c.assetsUsed - c.settlementCosts, c.fundsFamily, 0.01);
    assert.ok(Math.abs(c.held + c.liquidAssets - c.settlementCosts - c.fundsFamily) > 1);
  });

  test('settlementCovered reads the committed pile, and the fund floors at zero', () => {
    const c = life({ debtPayoff: 3000000, liquidAssets: 4000000, assetCommitPct: 25 }, 1000000);
    assert.equal(c.settlementCovered, false);
    assert.equal(c.fundsFamily, 0);
    const d = life({ debtPayoff: 9000000, liquidAssets: 500000 }, 1000000);
    assert.equal(d.fundsFamily, 0);
    assert.equal(d.settlementCovered, false);
    assert.equal(d.yearsCovered, 0);
  });

  test('no need is a real answer, and it is covered', () => {
    const c = life({ annualBasis: 0 }, 0);
    assert.equal(c.incomeNeeded, 0);
    assert.equal(c.covered, true);
    assert.equal(c.incomeShare, null);
    const banked = life({ annualBasis: 0, liquidAssets: 5000000 }, 0);
    assert.equal(banked.covered, true);
    assert.equal(banked.incomeShare, null);
  });

  test('lifeNeedAt: year 0 IS the need, it falls to zero, and the draw is held flat', () => {
    const b = basis();
    assert.equal(calc.lifeNeedAt(b, 0), life({}, 0).incomeNeeded);
    const s = [0, 5, 10, 15, 20].map((y) => calc.lifeNeedAt(b, y));
    for (let i = 1; i < s.length; i++) assert.ok(s[i] < s[i - 1]);
    assert.equal(s.at(-1), 0);
    assert.equal(calc.lifeNeedAt(b, 25), 0);
    assert.equal(calc.lifeNeedAt(b, 5), calc.lifeNeedAt(basis({ years: 15 }), 0));
  });

  test('the horizon tiers price each span with the app\'s own words', () => {
    const t = calc.coverageHorizonTiers(basis());
    assert.deepEqual(t.map((x) => x.value), [5, 10, 15, 20, 25]);
    close(t[3].need, 12088990.57, 0.01);
    assert.equal(t[3].line, 'of cover · Until the children are independent');
    assert.equal(t[4].line, 'of cover · Into a spouse\'s retirement');
  });
});

describe('the coverage walk — coverage_method_beats.dart', () => {
  const s = calc.samples.life;

  test('sampleCoverFor(10/20/30)', () => {
    close(s.coverFor[10], 7936138.80, 0.01);
    close(s.coverFor[20], 13891702.16, 0.01);
    close(s.coverFor[30], 18360970.63, 0.01);
    assert.ok(s.coverFor[10] < s.coverFor[20] && s.coverFor[20] < s.coverFor[30]);
  });

  test('the 12M rule of thumb funds 16.5 of 20 years, and the red band spans over a year', () => {
    assert.equal(s.ruleOfThumbCover, 12000000);
    close(s.ruleYearsFunded, 16.50, 0.005);
    assert.equal(s.ruleDryYear, 17);
    assert.equal(s.unfundedYears, 4);
    assert.ok(s.unfundedYears > 1);
    assert.equal(s.ruleDrawdown.length, 21);
    close(s.drawdown.at(-1), 0, 0.01);
  });

  test('ruleOfThumb is yearsFundedBy on 10 × income, raw', () => {
    const r = calc.ruleOfThumb(1200000, { annualDraw: 900000, investmentRatePct: 6, incomeGrowthPct: 3, years: 20 });
    assert.equal(r.cover, 12000000);
    assert.equal(r.yearsFunded, calc.yearsFundedBy({ capital: 12000000, annualDraw: 900000, investmentRatePct: 6, incomeGrowthPct: 3 }));
    const never = calc.ruleOfThumb(1200000, { annualDraw: 100000, investmentRatePct: 7, incomeGrowthPct: 2, years: 20 });
    assert.equal(never.yearsFunded, null);
    assert.equal(never.dryYear, -1);
    assert.equal(never.unfundedYears, 0);
  });
});

// ── Critical illness — test/core/health_coverage_test.dart ───────────────────

const INCOME = 75856;
const FUND = 466013;
const LUMP = 2000000;
const cover = (o = {}) => calc.healthRecovery(Object.assign({
  catastrophicBill: 2000000, annualLimit: 150000, lumpSum: LUMP, emergencyFund: FUND,
  efConsumePct: 100, monthlyIncome: INCOME, recoveryPct: 100,
}, o));

describe('healthRecovery (healthCoverFor)', () => {
  test('the capital is what is LEFT once the bill is settled: 616,013', () => {
    const c = cover();
    close(c.billAfterLimit, 1850000, 1);
    close(c.efUsed, FUND, 1);
    close(c.capital, 616013, 1);
    assert.equal(c.billShortfall, 0);
  });

  test('the medical insurance pays the bill and NOTHING else, at what it pays', () => {
    const c = cover({ annualLimit: 10000000 });
    assert.equal(c.billAfterLimit, 0);
    close(c.capital, LUMP + FUND, 1);
    assert.equal(cover().limitPaid, 150000);
    const capped = cover({ catastrophicBill: 1000000, annualLimit: 10000000 });
    assert.equal(capped.limitPaid, 1000000);
    close(capped.lumpSum + capped.limitPaid + capped.efUsed - capped.catastrophicBill, capped.capital, 0.01);
  });

  test('the emergency fund enters at its SHARE', () => {
    assert.equal(cover({ efConsumePct: 0 }).efUsed, 0);
    close(cover({ efConsumePct: 50 }).efUsed, FUND / 2, 1);
  });

  test('a 5M bill leaves no capital and a 2,383,987 shortfall', () => {
    const c = cover({ catastrophicBill: 5000000 });
    assert.equal(c.capital, 0);
    close(c.billShortfall, 2383987, 1);
    assert.equal(c.monthsOffWork, 0);
  });

  test('the span is a flat division: 8.12 months', () => {
    const c = cover();
    close(c.monthsOffWork, c.capital / c.recoveryPerMonth, 1e-9);
    close(c.monthsOffWork, 8.12, 0.02);
  });

  test('zero rates take the equality branch, never a division by zero', () => {
    close(calc.yearsFundedBy({ capital: 600000, annualDraw: 75000, investmentRatePct: 0, incomeGrowthPct: 0 }), 8, 1e-12);
    const rows = calc.drawdownYears({ capital: 600000, annualDraw: 75000, investmentRatePct: 0, incomeGrowthPct: 0, years: 4 });
    assert.ok(rows.every((r) => r.growth === 0));
    close(rows[1].balance, 525000, 1e-9);
  });

  test('null is unreachable from the dials, and the span is bounded', () => {
    for (const pct of calc.tiers.health.recovery.options.map((t) => t.value)) {
      assert.notEqual(cover({ recoveryPct: pct, lumpSum: 40000000, catastrophicBill: 0 }).monthsOffWork, null);
    }
    assert.equal(calc.healthSpanMonths(null), 60);
    assert.equal(calc.healthSpanMonths(0), 2);
    assert.equal(calc.healthSpanMonths(0.4), 2);
    assert.equal(calc.healthSpanMonths(8.2), 9);
    assert.equal(calc.healthSpanMonths(900), 60);
  });

  test('the drawdown closes on the capital', () => {
    const c = cover();
    const rows = calc.healthDrawdown(c);
    close(rows[0].balance, c.capital, 0.01);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      close(rows[i].balance, prev.balance - prev.draw + prev.growth, 0.01, `month ${i}`);
    }
  });

  test('care is inside the percentage, and the seed reaches every state', () => {
    close(cover({ recoveryPct: 125 }).recoveryPerMonth, INCOME * 1.25, 0.01);
    const m1 = cover({ catastrophicBill: 1000000 });
    close(m1.capital, 1616013, 1);
    close(m1.monthsOffWork, 21.3, 0.4);
    const m3 = cover({ catastrophicBill: 3000000 });
    assert.equal(m3.capital, 0);
    assert.ok(m3.billShortfall > 0);
  });

  test('no cover at all still states a bill and a shortfall', () => {
    const c = cover({ lumpSum: 0, annualLimit: 0 });
    close(c.efUsed, FUND, 1);
    assert.equal(c.capital, 0);
    close(c.billShortfall, 1533987, 1);
    assert.equal(c.monthsOffWork, 0);
    const rows = calc.healthDrawdown(c);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.balance === 0));
  });

  test('the three bill segments close, in every limit branch', () => {
    for (const c of [cover(), cover({ lumpSum: 0, annualLimit: 0 }), cover({ annualLimit: 10000000 }),
      cover({ catastrophicBill: 1000000, annualLimit: 10000000 }), cover({ catastrophicBill: 5000000 })]) {
      const spent = c.catastrophicBill - c.billShortfall;
      close(spent + c.billShortfall, c.catastrophicBill, 0.01);
      assert.ok(spent >= 0);
      close(c.capital + spent, c.lumpSum + c.limitPaid + c.efUsed, 0.01);
    }
  });

  test('the walk\'s sample: 500,000 left, five months, six bars', () => {
    const s = calc.samples.health;
    assert.equal(s.inputs.monthlyIncome, 100000);
    assert.equal(s.cover.capital, 500000);
    assert.equal(s.cover.monthsOffWork, 5);
    assert.equal(s.cover.spanMonths, 5);
    assert.equal(s.drawdown.length, 6);
  });
});

describe('the bill tiers — healthAnchorToHome', () => {
  test('a PHP household sees the anchor untouched; a foreign one a round figure', () => {
    for (const t of calc.tiers.health.bill.options) assert.equal(calc.healthAnchorToHome(t.anchorPhp, 1), t.anchorPhp);
    assert.equal(calc.healthAnchorToHome(2000000, 56), 36000);
    assert.equal(calc.healthAnchorToHome(0, 56), 0);
  });

  test('scaled by the site\'s factor', () => {
    assert.deepEqual(calc.healthBillTiers(10).map((t) => t.value), [100000, 200000, 300000, 500000]);
    assert.deepEqual(calc.healthBillTiers(2.5).map((t) => t.value), [400000, 800000, 1200000, 2000000]);
    assert.equal(calc.healthBillTiers(1).filter((t) => t.isDefault)[0].anchorPhp, 2000000);
  });
});

// ── Emergency fund — cash_reserves_signal_test.dart, cash_flow_pillar_page_test.dart ──

describe('reserve', () => {
  test('healthy at 3× expenses or more, attention below', () => {
    assert.equal(calc.reserve(7000, 2000).status, 'healthy');
    assert.equal(calc.reserve(5000, 2000).status, 'attention');
  });

  test('the status compares money, never the rounded months', () => {
    assert.equal(calc.reserve(6000, 2000).status, 'healthy');
    const r = calc.reserve(5999.99, 2000);
    assert.equal(r.status, 'attention');
    assert.equal(PHP.monthsSplit(r.monthsCovered).whole, '2');
  });

  test('monthsCovered is not clamped; null with no basis; a zero fund is a measured zero', () => {
    close(calc.reserve(20000, 2000).monthsCovered, 10, 0.01);
    const none = calc.reserve(20000, 0);
    assert.equal(none.monthsCovered, null);
    assert.equal(none.status, 'notSetUp');
    assert.deepEqual(none.milestones, []);
    assert.equal(calc.reserve(0, 0).monthsCovered, 0);
    assert.equal(calc.reserve(0, 2000).monthsCovered, 0);
  });

  test('212,000 against 50,000 a month: 4.2 months, 88,000 remaining for the 6-month target', () => {
    const r = calc.reserve(212000, 50000);
    assert.equal(r.targetLow, 150000);
    assert.equal(r.targetHigh, 300000);
    assert.equal(r.status, 'healthy');
    close(r.monthsCovered, 4.24, 1e-9);
    assert.deepEqual(plain(PHP.monthsSplit(r.monthsCovered)), { whole: '4', decimal: '2' });
    const six = r.milestones.find((m) => m.months === 6);
    assert.equal(six.diff, -88000);
    assert.equal(six.reached, false);
    assert.equal(PHP.money(Math.abs(six.diff)) + ' ' + six.phrase, '₱88,000 remaining for the 6-month target');
    const three = r.milestones.find((m) => m.months === 3);
    assert.equal(three.phrase, 'above the 3-month minimum');
    assert.deepEqual(r.milestones.map((m) => m.name),
      ['3-month minimum', '6-month target', '9-month buffer', '12-month buffer']);
  });
});

// ── Investment rate — test/providers/investment_trajectory_test.dart ─────────

describe('investmentRate and investmentStatus', () => {
  const at = (invested, income, target = 15) => {
    const rate = calc.investmentRate(invested, income);
    return { rate, status: calc.investmentStatus(rate, target) };
  };

  test('750 of 5,000 is healthy, 500 needs attention, 200 is at risk', () => {
    const healthy = at(750, 5000);
    close(healthy.rate, 15, 0.001);
    assert.equal(healthy.status, 'healthy');
    const attention = at(500, 5000);
    close(attention.rate, 10, 0.001);
    assert.equal(attention.status, 'attention');
    const risk = at(200, 5000);
    close(risk.rate, 4, 0.001);
    assert.equal(risk.status, 'atRisk');
  });

  test('income with nothing invested is 0% and at risk, never not set up', () => {
    const r = at(0, 5000);
    assert.equal(r.rate, 0);
    assert.equal(r.status, 'atRisk');
  });

  test('no income is no rate', () => {
    assert.equal(calc.investmentRate(750, 0), null);
    assert.equal(calc.investmentStatus(null, 15), 'notSetUp');
  });

  test('summed months reconcile, and 750 of 9,900 is 7.575% (attention)', () => {
    close(calc.investmentRate(1650, 11000), 15, 0.001);
    const r = at(750, 9900);
    close(r.rate, 7.575, 0.01);
    assert.equal(r.status, 'attention');
  });
});

// ── Projection — test/core/projection_math_test.dart ─────────────────────────

describe('projection', () => {
  const simulate = (p, pmt, annualPct, months) => {
    const r = annualPct / 100 / 12;
    let bal = p;
    for (let m = 0; m < months; m++) bal = bal * (1 + r) + pmt;
    return bal;
  };
  const simulateTwoPhase = (nestEgg, monthly, rate, contribYears, atYear) => {
    const r = rate / 100 / 12;
    let bal = nestEgg;
    for (let m = 0; m < atYear * 12; m++) bal = bal * (1 + r) + (m < contribYears * 12 ? monthly : 0);
    return bal;
  };

  test('today\'s money: 38,522,115 at 3% over 30 years is 15,870,601', () => {
    assert.equal(calc.todaysMoney(38522115, 3, 0), 38522115);
    close(calc.todaysMoney(38522115, 3, 30), 15870601, 1);
    close(calc.todaysMoney(38522115, 3, 30), 15870000, 50000);
    assert.ok(calc.todaysMoney(38522115, 6, 30) < calc.todaysMoney(38522115, 3, 30));
    assert.ok(calc.todaysMoney(1000000, 3, 10) < 1000000);
  });

  test('monthly income comes from today\'s money: 39,427.25', () => {
    close(calc.monthlyIncome(1200000, 4), 4000, 1e-9);
    assert.equal(calc.monthlyIncome(1200000, 0), 0);
    const nominal = 24765572;
    const today = calc.todaysMoney(nominal, 3, 25);
    const income = calc.monthlyIncome(today, 4);
    close(income, today * 0.04 / 12, 1e-6);
    assert.ok(income < calc.monthlyIncome(nominal, 4));
    close(income, 39427.25, 0.005);
  });

  test('projectFutureValue equals a month-by-month calculator', () => {
    for (const c of [[10000, 500, 7, 360], [0, 500, 7, 360], [50000, 0, 7, 240], [1311171, 8000, 7, 360],
      [25000, 1200, 10, 180], [100000, 2000, 4, 120]]) {
      const expected = simulate(...c);
      close(calc.projectFutureValue(...c), expected, Math.abs(expected) * 1e-6 + 0.01, c.join(' '));
    }
  });

  test('10,000 + 500 a month at 7% for 30 years is 691,150.47', () => {
    close(calc.projectFutureValue(10000, 500, 7, 360), 691150.47, 0.005);
  });

  test('a near-zero rate is a simple sum', () => {
    assert.equal(calc.projectFutureValue(1000, 100, 0, 12), 1000 + 100 * 12);
  });

  test('projectedNestEgg: contributions stop at the horizon', () => {
    const inside = calc.projectedNestEgg({ nestEgg: 10000, monthlyContribution: 500, annualReturnPct: 7, contributionYears: 30, atYear: 20 });
    close(inside, simulateTwoPhase(10000, 500, 7, 30, 20), 0.01);
    close(inside, calc.projectFutureValue(10000, 500, 7, 240), 0.01);
    const beyond = calc.projectedNestEgg({ nestEgg: 10000, monthlyContribution: 500, annualReturnPct: 7, contributionYears: 30, atYear: 40 });
    close(beyond, simulateTwoPhase(10000, 500, 7, 30, 40), 0.01);
    assert.ok(beyond < calc.projectFutureValue(10000, 500, 7, 480));
  });

  test('the milestone stack: the Growth fixture reads 3.5419', () => {
    const o = { returnRate: 7, contributionYears: 30 };
    const split = calc.milestone(300000, 24898, 30, o);
    close(split.multiple, 3.5419, 0.001);
    close(split.multiple, split.total / (split.nestEgg + split.contributions), 1e-9);
    close(split.total, split.nestEgg + split.contributions + split.gains, 1e-6);
    close(calc.milestone(300000, 24898, 0, o).multiple, 1, 1e-9);
    assert.equal(calc.milestone(0, 0, 30, o).multiple, null);
    const flat = calc.milestone(100000, 0, 10, o);
    assert.equal(flat.contributions, 0);
    close(flat.multiple, flat.total / 100000, 1e-9);
  });

  test('yearSeries runs 0 to 40, and each year is its milestone', () => {
    const o = { returnRate: 7, contributionYears: 30 };
    const s = calc.yearSeries(300000, 24898, o);
    assert.equal(s.length, 41);
    assert.deepEqual(s[30], calc.milestone(300000, 24898, 30, o));
  });

  test('no income means no contribution, whatever the rate', () => {
    assert.equal(calc.monthlyContributionAt(50000, 15), 7500);
    assert.equal(calc.monthlyContributionAt(0, 15), 0);
  });
});

// ── Debt — test/core/debt_payoff_simulation_test.dart, debt_interest_test.dart ──

const card = (id, balance, floor, apr = 30) => ({ debtId: id, shape: 'revolving', balanceHome: balance, floorHome: floor, aprPct: apr });
const loan = (id, balance, floor, apr = 5) => ({ debtId: id, shape: 'installment', balanceHome: balance, floorHome: floor, aprPct: apr });
const sim = (debts, order, capMonths) => calc.simulateDebtPayoff(debts, { order, capMonths });

describe('simulateDebtPayoff', () => {
  test('the rollover: cards clear in months 5 and 13', () => {
    const r = sim([card('a', 10000, 2000, 0), card('b', 40000, 2000, 0)], ['a', 'b']);
    assert.equal(r.outcome, 'amortizes');
    assert.equal(r.perDebt.a.clearedInMonth, 5);
    assert.equal(r.perDebt.b.clearedInMonth, 13);
    assert.equal(r.months, 13);
  });

  test('snowball and avalanche differ where they should', () => {
    const debts = [card('quick', 4000, 4000, 0), card('small', 9770, 1500, 12), card('big', 60000, 3000, 36)];
    const avalanche = sim(debts, ['quick', 'big', 'small']);
    const snowball = sim(debts, ['quick', 'small', 'big']);
    assert.equal(avalanche.outcome, 'amortizes');
    assert.equal(snowball.outcome, 'amortizes');
    assert.ok(avalanche.totalInterestHome < snowball.totalInterestHome);
    assert.ok(snowball.perDebt.small.clearedInMonth < avalanche.perDebt.small.clearedInMonth);
  });

  test('a loan is a fixed floor and never absorbs surplus', () => {
    assert.equal(sim([loan('car', 120000, 10000, 0)], []).perDebt.car.clearedInMonth, 12);
    const withCard = sim([card('visa', 5000, 5000, 0), loan('car', 120000, 10000, 0)], ['visa']);
    assert.equal(withCard.perDebt.car.clearedInMonth, 12);
    assert.equal(withCard.perDebt.visa.clearedInMonth, 1);
  });

  test('a card below its own interest never amortizes alone, and clears once surplus reaches it', () => {
    const alone = sim([card('trap', 50000, 1000)], ['trap']);
    assert.equal(alone.outcome, 'neverAmortizes');
    assert.equal(alone.months, null);
    assert.equal(alone.totalInterestHome, null);
    const rescued = sim([card('quick', 8000, 4000, 0), card('trap', 50000, 1000)], ['quick', 'trap']);
    assert.equal(rescued.outcome, 'amortizes');
    assert.equal(rescued.perDebt.quick.clearedInMonth, 2);
    assert.notEqual(rescued.perDebt.trap.clearedInMonth, null);
  });

  test('an unrated debt accrues nothing and nulls the household interest; 0% is a real 0', () => {
    const r = sim([card('a', 10000, 2000, null), card('b', 10000, 2000, 24)], ['a', 'b']);
    assert.equal(r.outcome, 'amortizes');
    assert.equal(r.perDebt.a.clearedInMonth, 5);
    assert.equal(r.perDebt.a.interestHome, null);
    assert.ok(r.perDebt.b.interestHome > 0);
    assert.equal(r.totalInterestHome, null);
    const zero = sim([card('a', 10000, 2000, 0)], ['a']);
    assert.equal(zero.totalInterestHome, 0);
    assert.equal(zero.perDebt.a.interestHome, 0);
  });

  test('a debt with nothing budgeted is excluded and named', () => {
    const r = sim([card('a', 10000, 2000, 0), card('b', 30000, 0)], ['a', 'b']);
    assert.deepEqual(r.excludedDebtIds, ['b']);
    assert.equal('b' in r.perDebt, false);
    assert.equal(r.outcome, 'amortizes');
    assert.equal(r.perDebt.a.clearedInMonth, 5);
    const none = sim([card('a', 10000, 0), loan('b', 30000, 0)], ['a']);
    assert.equal(none.outcome, 'noPaymentData');
    assert.deepEqual(none.excludedDebtIds, ['a', 'b']);
    assert.equal(none.months, null);
    assert.deepEqual(none.series, []);
  });

  test('the 600-month cap: never amortizes, and the run terminates', () => {
    const r = sim([card('a', 100000, 100, 40)], ['a']);
    assert.equal(r.outcome, 'neverAmortizes');
    assert.equal(r.months, null);
    assert.equal(r.perDebt.a.clearedInMonth, null);
    assert.equal(r.series.length, 601);
  });

  test('a revolving debt the order omits still runs, last', () => {
    const r = sim([card('a', 10000, 2000, 0), card('z', 10000, 2000, 0)], ['a']);
    assert.equal(r.perDebt.a.clearedInMonth, 5);
    assert.equal(r.perDebt.z.clearedInMonth, 5);
  });

  test('the series: input balances to zeros, the last to clear at the floor', () => {
    const r = sim([card('a', 10000, 2000, 0), card('b', 40000, 2000, 0)], ['a', 'b']);
    assert.equal(r.series.length, r.months + 1);
    assert.deepEqual(r.seriesDebtIds, ['b', 'a']);
    assert.deepEqual(r.series[0], [40000, 10000]);
    assert.ok(r.series.at(-1).every((v) => v === 0));
    assert.equal(r.series[5][r.seriesDebtIds.indexOf('a')], 0);
    const mixed = sim([card('visa', 60000, 2000, 0), loan('car', 12000, 4000, 0)], ['visa']);
    assert.equal(mixed.perDebt.car.clearedInMonth, 3);
    assert.deepEqual(mixed.seriesDebtIds, ['visa', 'car']);
    const tie = sim([card('a', 4000, 2000, 0), card('b', 4000, 2000, 0)], ['b', 'a']);
    assert.deepEqual(tie.seriesDebtIds, ['a', 'b']);
    const capped = sim([card('a', 100000, 100, 40)], ['a'], 24);
    assert.equal(capped.series.length, 25);
    assert.ok(capped.series.at(-1)[0] > capped.series[0][0]);
  });

  test('a debt already at zero is neither simulated nor excluded', () => {
    const r = sim([card('paid', 0, 2000), card('live', 4000, 2000, 0)], ['paid', 'live']);
    assert.deepEqual(r.excludedDebtIds, []);
    assert.equal('paid' in r.perDebt, false);
    assert.equal(r.perDebt.live.clearedInMonth, 2);
    const unbudgeted = sim([card('paid', 0, 0), card('live', 4000, 2000, 0)], ['paid', 'live']);
    assert.deepEqual(unbudgeted.excludedDebtIds, []);
    assert.equal(unbudgeted.outcome, 'amortizes');
  });
});

describe('sortDebtsByStrategy and the order in force', () => {
  const v = (id, balance, apr) => ({ debtId: id, balanceHome: balance, aprPct: apr });
  const ids = (list) => list.map((x) => x.debtId);

  test('avalanche leads with the highest RATE, never the biggest balance or cost', () => {
    assert.deepEqual(ids(calc.sortDebtsByStrategy([v('car', 200000, 3), v('visa', 40000, 26)], 'avalanche')), ['visa', 'car']);
    assert.deepEqual(ids(calc.sortDebtsByStrategy([v('car', 960000, 3), v('visa', 9770, 26)], 'avalanche')), ['visa', 'car']);
  });

  test('an unrated debt sorts last under avalanche; snowball ignores rate', () => {
    const list = [v('loose', 500000, null), v('visa', 40000, 26), v('car', 200000, 3)];
    assert.equal(ids(calc.sortDebtsByStrategy(list, 'avalanche')).at(-1), 'loose');
    assert.deepEqual(ids(calc.sortDebtsByStrategy([v('car', 200000, 3), v('visa', 40000, 26), v('loose', 500, null)], 'snowball')),
      ['loose', 'visa', 'car']);
  });

  test('ties break on balance, largest first, whatever the input order; the input is not mutated', () => {
    const a = [v('x', 1000, null), v('y', 9000, null)];
    const b = [v('y', 9000, null), v('x', 1000, null)];
    assert.deepEqual(ids(calc.sortDebtsByStrategy(a, 'avalanche')), ['y', 'x']);
    assert.deepEqual(ids(calc.sortDebtsByStrategy(b, 'avalanche')), ['y', 'x']);
    assert.deepEqual(ids(calc.sortDebtsByStrategy([v('p', 1000, 24), v('q', 9000, 24)], 'avalanche')), ['q', 'p']);
    assert.deepEqual(ids(a), ['x', 'y']);
  });

  test('avalanche when any debt has a rate, snowball when none does', () => {
    assert.equal(calc.debtStrategy([{ apr: null }, { apr: 0 }]), 'avalanche');
    assert.equal(calc.debtStrategy([{ apr: null }, { apr: '' }]), 'snowball');
    const order = calc.debtOrder([
      { id: 'big', kind: 'loan', balance: 90000, apr: null, payment: 1000 },
      { id: 'small', kind: 'card', balance: 2000, apr: null, payment: 500 },
    ]);
    assert.deepEqual(order.map((d) => d.id), ['small', 'big']);
  });

  test('debtPayoff: one run under the order in force, each debt\'s outcome read off it', () => {
    const r = calc.debtPayoff([
      { id: 'car', kind: 'loan', balance: 200000, apr: 3, payment: 8000 },
      { id: 'visa', kind: 'card', balance: 40000, apr: 26, payment: 3000 },
      { id: 'loose', kind: 'card', balance: 5000, apr: null, payment: 0 },
      { id: 'trap', kind: 'loan', balance: 50000, apr: 36, payment: 1000 },
    ]);
    assert.equal(r.strategy, 'avalanche');
    assert.deepEqual(r.debts.map((d) => d.id), ['trap', 'visa', 'car', 'loose']);
    assert.equal(r.outcome, 'neverAmortizes');
    assert.equal(r.totalInterest, null);
    const by = Object.fromEntries(r.debts.map((d) => [d.id, d]));
    assert.equal(by.loose.outcome, 'noPaymentData');
    assert.equal(by.trap.outcome, 'neverAmortizes');
    assert.equal(by.trap.clearMonth, null);
    assert.equal(by.visa.outcome, 'amortizes');
    assert.equal(by.car.outcome, 'amortizes');
    assert.deepEqual(r.excludedIds, ['loose']);
    assert.equal(by.visa.zone.rankedLabel, '3 · Big & costly');

    const clean = calc.debtPayoff([
      { id: 'a', kind: 'card', balance: 10000, apr: 0, payment: 2000 },
      { id: 'b', kind: 'card', balance: 40000, apr: 0, payment: 2000 },
    ]);
    assert.equal(clean.months, 13);
    assert.equal(clean.totalInterest, 0);
    assert.deepEqual(clean.debts.map((d) => [d.id, d.clearMonth]), [['b', 13], ['a', 5]]);
  });
});

describe('debtZone — debt_zones.dart', () => {
  test('costly at 20% or more, large at 31,622.78 or more, unrated has no zone', () => {
    assert.equal(calc.debtZone({ apr: 20, balance: 1000 }).key, 'smallCostly');
    assert.equal(calc.debtZone({ apr: 19.99, balance: 1000 }).key, 'smallCheap');
    assert.equal(calc.debtZone({ apr: 20, balance: 31622.78 }).key, 'largeCostly');
    assert.equal(calc.debtZone({ apr: 5, balance: 31622.77 }).key, 'smallCheap');
    assert.equal(calc.debtZone({ apr: 5, balance: 40000 }).key, 'largeCheap');
    assert.equal(calc.debtZone({ apr: null, balance: 40000 }), null);
    close(calc.tiers.debt.balanceSplit, 31622.78, 0.01);
    assert.equal(calc.tiers.debt.balanceSplit, Math.pow(10, 4.5));
  });

  test('a small cheap debt outranks a large costly one', () => {
    assert.ok(calc.debtZone({ apr: 0, balance: 2000 }).rank < calc.debtZone({ apr: 30, balance: 90000 }).rank);
  });

  test('every currency\'s sample lands one debt in each zone, unscaled', () => {
    assert.deepEqual(Object.keys(calc.debtSamples).sort(), ['AED', 'AUD', 'CAD', 'EUR', 'GBP', 'PHP', 'SGD', 'USD']);
    for (const code of Object.keys(calc.debtSamples)) {
      assert.deepEqual(calc.samples.debt[code].map((d) => d.zone.rank), [1, 2, 3, 4], code);
    }
    assert.deepEqual(calc.debtSampleViews('PHP').map((d) => d.balance), [18000, 12000, 240000, 820000]);
    assert.deepEqual(calc.debtSampleViews('JPY').map((d) => d.balance), [6000, 2000, 40000, 45000]);
  });

  test('debtRateLabel', () => {
    assert.equal(calc.debtRateLabel(26), '26% APR');
    assert.equal(calc.debtRateLabel(21.5), '21.5% APR');
    assert.equal(calc.debtRateLabel(26.04), '26% APR');
  });
});

describe('tiers', () => {
  test('defaults are members of their own option lists', () => {
    const t = calc.tiers;
    for (const [name, list] of [
      ['replacement', t.life.replacement], ['years', t.life.years], ['investmentRate', t.life.investmentRate],
      ['inflation', t.life.inflation], ['settlement', t.life.settlement], ['recovery', t.health.recovery],
      ['target', t.investment.target], ['return', t.projection.returnRate], ['pinflation', t.projection.inflation],
      ['withdrawal', t.projection.withdrawal], ['contributionYears', t.projection.contributionYears],
    ]) {
      assert.ok(list.options.some((o) => o.value === list.default), name);
    }
    assert.deepEqual([t.life.replacement.default, t.life.years.default, t.life.investmentRate.default,
      t.life.inflation.default, t.life.settlement.default], [75, 20, 7, 3, 5]);
    assert.deepEqual([t.projection.returnRate.default, t.projection.inflation.default, t.projection.withdrawal.default,
      t.projection.contributionYears.default, t.projection.viewYear.default], [7, 3, 4, 30, 30]);
    assert.equal(t.investment.target.default, 15);
    assert.equal(t.investment.target.options.at(-1).label, '40%+');
    assert.equal(t.status.attention, 'Needs attention');
  });
});

// ── Formatting — test/core/number_format_test.dart, money.js ─────────────────

describe('money.js formats', () => {
  test('formatPercent', () => {
    assert.deepEqual([5, 0, 100, 5.5, 2.7, 5.24, 5.27, -3, -3.5].map((v) => PHP.percent(v)),
      ['5%', '0%', '100%', '5.5%', '2.7%', '5.2%', '5.3%', '-3%', '-3.5%']);
    assert.equal(PHP.percent(33.7, 0), '34%');
    assert.equal(PHP.percent(33.2, 0), '33%');
    assert.equal(PHP.percent(5, 1), '5.0%');
  });

  test('formatCompact: 1,500 is 2K', () => {
    const cases = [[0, '0'], [1, '1'], [999, '999'], [999.9, '1000'], [1000, '1K'], [1500, '2K'], [12000, '12K'],
      [999000, '999K'], [1000000, '1.0M'], [1500000, '1.5M'], [2300000, '2.3M'], [1000000000, '1.0B'],
      [2300000000, '2.3B'], [-1500000, '-1.5M'], [-2000, '-2K'], [-500, '-500']];
    for (const [v, s] of cases) assert.equal(PHP.compact(v), s, String(v));
  });

  test('formatMultiple', () => {
    assert.deepEqual([28.06, 9.46, 10, 12.7, 3, 1, 3.5419].map(PHP.multiple),
      ['28×', '9.5×', '10×', '13×', '3×', '1×', '3.5×']);
  });

  test('compactScale', () => {
    assert.equal(PHP.compactScale(999).suffix, '');
    assert.equal(PHP.compactScale(1500).suffix, 'K');
    assert.equal(PHP.compactScale(2.3e6).suffix, 'M');
    assert.equal(PHP.compactScale(1.5e9).suffix, 'B');
    const r = PHP.compactScale(7421);
    assert.deepEqual([r.suffix, r.decimals, r.scaled.toFixed(r.decimals)], ['K', 0, '7']);
    assert.equal(PHP.compactScale(2.3e6, 1).decimals, 1);
    assert.equal(PHP.compactScale(4.352e8, 1).decimals, 0);
    const carry = PHP.compactScale(999500);
    assert.equal(carry.suffix, 'M');
    close(carry.scaled, 0.9995, 0.0001);
  });

  test('compactMoney (fmtCompactMoney): 9,950 is 9.9K and 999,500 is 1.0M', () => {
    assert.equal(PHP.compactMoney(9950), '₱9.9K');
    assert.equal(PHP.compactMoney(999500), '₱1.0M');
    assert.equal(PHP.compactMoney(7421), '₱7.4K');
    assert.equal(PHP.compactMoney(7421, { kDecimals: 0 }), '₱7K');
    assert.equal(PHP.compactMoney(10000), '₱10K');
    assert.equal(PHP.compactMoney(16198560), '₱16.2M');
    assert.equal(PHP.compactMoney(435200000), '₱435M');
    assert.equal(PHP.compactMoney(999900000), '₱1.0B');
    assert.equal(PHP.compactMoney(999.6), '₱1000');
  });

  test('whole and money: half away from zero, grouped, a U+2212 minus', () => {
    assert.equal(PHP.whole(48638.2), '48,638');
    assert.equal(PHP.whole(2.5), '3');
    assert.equal(PHP.whole(1234567.5), '1,234,568');
    assert.equal(PHP.whole(-1500.5), '-1,501');
    assert.equal(PHP.money(88000), '₱88,000');
    assert.equal(PHP.money(-1500), '−₱1,500');
    assert.equal(PHP.money(-0.4), '₱0');
    assert.equal(PHP.money(12088990.57), '₱12,088,991');
  });

  test('monthsSplit: MonthsHero floors the whole and clamps the tenth', () => {
    assert.deepEqual(plain(PHP.monthsSplit(4.24)), { whole: '4', decimal: '2' });
    assert.deepEqual(plain(PHP.monthsSplit(10)), { whole: '10', decimal: '0' });
    assert.deepEqual(plain(PHP.monthsSplit(2.95)), { whole: '2', decimal: '9' });
    assert.deepEqual(plain(PHP.monthsSplit(0)), { whole: '0', decimal: '0' });
  });
});

describe('money.js currency', () => {
  const codeFor = (o) => loadMoney(o).M.code;

  test('?cur= picks a supported currency, case-insensitively', () => {
    const usd = loadMoney({ search: '?cur=USD' }).M;
    assert.deepEqual([usd.code, usd.symbol, usd.factor, usd.unit], ['USD', '$', 10, 'dollar']);
    assert.equal(usd.scale(88000), 8800);
    assert.equal(usd.money(8800), '$8,800');
    const aed = loadMoney({ search: '?cur=aed' }).M;
    assert.deepEqual([aed.code, aed.symbol, aed.factor, aed.unit], ['AED', 'د.إ‎', 2.5, 'dirham']);
    assert.equal(codeFor({ search: '?cur=JPY', timeZone: 'Asia/Manila' }), 'PHP');
  });

  test('the time zone decides, and the language region stands in only for UTC', () => {
    assert.equal(codeFor({ timeZone: 'Asia/Manila' }), 'PHP');
    assert.equal(codeFor({ timeZone: 'Europe/Paris' }), 'EUR');
    assert.equal(codeFor({ timeZone: 'Australia/Sydney' }), 'AUD');
    assert.equal(codeFor({ timeZone: 'America/Toronto' }), 'CAD');
    assert.equal(codeFor({ timeZone: 'Canada/Eastern' }), 'CAD');
    assert.equal(codeFor({ timeZone: 'Asia/Dubai' }), 'AED');
    assert.equal(codeFor({ timeZone: 'Asia/Tokyo' }), 'USD');
    assert.equal(codeFor({ timeZone: 'America/New_York', languages: ['en-PH'] }), 'USD');
    assert.equal(codeFor({ timeZone: 'UTC', languages: ['en', 'en-GB'] }), 'GBP');
    assert.equal(codeFor({ timeZone: 'Etc/UTC', languages: ['fil-PH'] }), 'PHP');
    assert.equal(codeFor({ timeZone: 'UTC', languages: ['en'] }), 'USD');
  });

  test('the html element carries the currency', () => {
    assert.equal(loadMoney({ search: '?cur=GBP' }).document.documentElement.dataset.cur, 'GBP');
  });
});

describe('money.js rewrite', () => {
  const page = () => h('body', {},
    h('p', {}, 'A fund of ₱88,000 and a bill of ₱1.2M, or ₱5K a month.'),
    h('p', { class: 'hero' }, '₱12.0', h('span', { class: 'mag' }, 'M')),
    h('p', { class: 'hero' }, '₱20,000', h('span', { class: 'dec' }, '.00')),
    h('button', { 'aria-label': 'Set the bill to ₱2,000,000' }, 'Set'),
    h('span', { 'data-unit': '' }, 'peso'),
    h('span', { 'data-sym': '' }, '₱'),
    h('div', { 'data-noscale': '' }, h('p', {}, 'Store card ₱18,000'), h('span', { 'data-unit': '' }, 'peso')),
    h('script', {}, 'var label = "₱100";'),
  );

  test('dollars: figures, heroes, labels and the unit word scale; noscale and scripts do not', () => {
    const { body } = loadMoney({ search: '?cur=USD', body: page() });
    const [p, mag, dec, button, unit, sym, noscale, script] = body.childNodes;
    assert.equal(p.textContent, 'A fund of $8,800 and a bill of $120K, or $500 a month.');
    assert.equal(mag.textContent, '$1.2M');
    assert.equal(mag.childNodes[1].textContent, 'M');
    assert.equal(dec.textContent, '$2,000.00');
    assert.equal(button.getAttribute('aria-label'), 'Set the bill to $200,000');
    assert.equal(unit.textContent, 'dollar');
    assert.equal(sym.textContent, '$');
    assert.equal(noscale.textContent, 'Store card ₱18,000peso');
    assert.equal(script.textContent, 'var label = "₱100";');
  });

  test('a second call never rescales', () => {
    const { M, body } = loadMoney({ search: '?cur=USD', body: page() });
    const before = body.textContent;
    M.rewrite(body);
    M.rewrite();
    assert.equal(body.textContent, before);
    assert.equal(body.childNodes[3].getAttribute('aria-label'), 'Set the bill to $200,000');
  });

  test('dirhams scale by 2.5', () => {
    const { body } = loadMoney({ search: '?cur=AED', body: page() });
    assert.equal(body.childNodes[0].textContent,
      'A fund of د.إ‎35,200 and a bill of د.إ‎480K, or د.إ‎2K a month.');
  });

  test('pesos stay exactly as authored', () => {
    const authored = page().textContent;
    const { body } = loadMoney({ search: '?cur=PHP', body: page() });
    assert.equal(body.textContent, authored);
  });
});
