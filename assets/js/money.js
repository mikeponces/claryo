/*
 * window.ClaryoMoney — the visitor's currency and the app's number formats.
 *
 * The household is authored in pesos. Elsewhere it is shown in the visitor's currency, scaled
 * by one factor so every ratio stays true; unsupported currencies get dollars (founder,
 * 2026-11-13). Location is the browser's time zone, never a request (tech-website §2).
 * A failure leaves pesos, exactly as authored. ES2017 syntax only.
 */
(function () {
  'use strict';

  // ── The app's number formats, ported exactly ───────────────────────────────

  // Dart's double.round(): half away from zero (JS Math.round goes half up).
  function roundHalfAway(x) {
    var a = Math.abs(x);
    var f = Math.floor(a);
    var r = a - f >= 0.5 ? f + 1 : f;
    return x < 0 ? -r : r;
  }

  function groupDigits(s) {
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatsFor(symbol) {
    // lib/core/amount_formats.dart:24 — kWholeAmount '#,##0', half away from zero on |v|.
    function whole(v) {
      var r = roundHalfAway(Math.abs(v));
      return (v < 0 && r !== 0 ? '-' : '') + groupDigits(r.toFixed(0));
    }

    // lib/widgets/animated_number.dart:273 — the sign is U+2212, outside the symbol, and decided from
    // the ROUNDED magnitude, so −0.4 reads '₱0'.
    function money(v) {
      var r = roundHalfAway(Math.abs(v));
      return (v < 0 && r !== 0 ? '\u2212' : '') + symbol + groupDigits(r.toFixed(0));
    }

    // lib/core/number_format.dart:50 — formatCompact: M and B to one decimal, K to none, no carry.
    function compact(value) {
      value = Math.abs(value) < 1e-6 ? 0 : value; // money_math.dart:14 clampNearZero
      var sign = value < 0 ? '-' : '';
      var v = Math.abs(value);
      if (v >= 1e9) return sign + (v / 1e9).toFixed(1) + 'B';
      if (v >= 1e6) return sign + (v / 1e6).toFixed(1) + 'M';
      if (v >= 1e3) return sign + (v / 1e3).toFixed(0) + 'K';
      return sign + v.toFixed(0);
    }

    // lib/core/number_format.dart:139 — compactScale: three significant figures, K's decimal only
    // below ten, and a mantissa that rounds to 1000 carries up ('1000K' → '1.0M').
    function compactScale(value, kDecimals) {
      var kd = kDecimals || 0;
      var v = Math.abs(value);
      function decimalsFor(m, sfx) {
        return sfx === 'K' ? (kd === 0 || Math.abs(m) >= 10 ? 0 : kd) : (Math.abs(m) >= 100 ? 0 : 1);
      }
      function at(div, sfx) {
        var m = value / div;
        return { scaled: m, suffix: sfx, decimals: decimalsFor(m, sfx) };
      }
      function carries(r) {
        return parseFloat(Math.abs(r.scaled).toFixed(r.decimals)) >= 1000;
      }
      if (v >= 1e9) return at(1e9, 'B');
      if (v >= 1e6) {
        var rm = at(1e6, 'M');
        return carries(rm) ? at(1e9, 'B') : rm;
      }
      if (v >= 1e3) {
        var rk = at(1e3, 'K');
        return carries(rk) ? at(1e6, 'M') : rk;
      }
      return { scaled: value, suffix: '', decimals: 0 };
    }

    // lib/core/amount_formats.dart:88 — fmtCompactMoney, whose K decimals default to 1.
    function compactMoney(v, opts) {
      var kd = opts && opts.kDecimals !== undefined && opts.kDecimals !== null ? opts.kDecimals : 1;
      var s = compactScale(v, kd);
      var digits = s.decimals === 0 ? String(roundHalfAway(s.scaled)) : s.scaled.toFixed(s.decimals);
      return symbol + digits + s.suffix;
    }

    // lib/core/number_format.dart:33 — formatPercent: whole → no decimal, else one.
    function percent(v, decimals) {
      var places = decimals !== undefined && decimals !== null ? decimals : (v % 1 === 0 ? 0 : 1);
      return v.toFixed(places) + '%';
    }

    // lib/core/number_format.dart:63 — formatMultiple: one decimal below ten, none at or above or when whole.
    function multiple(v) {
      return v >= 10 || v === roundHalfAway(v) ? roundHalfAway(v) + '\u00D7' : v.toFixed(1) + '\u00D7';
    }

    // lib/widgets/months_report.dart:75-76 — MonthsHero: floor the whole, round the tenth, clamp 0–9.
    function monthsSplit(v) {
      var w = Math.floor(v);
      var d = Math.min(Math.max(roundHalfAway((v - w) * 10), 0), 9);
      return { whole: String(w), decimal: String(d) };
    }

    return {
      whole: whole,
      money: money,
      compact: compact,
      compactScale: compactScale,
      compactMoney: compactMoney,
      percent: percent,
      multiple: multiple,
      monthsSplit: monthsSplit,
    };
  }

  // ── The visitor's currency ─────────────────────────────────────────────────

  // Copied from index.html's currency script; change both together (tech-website §2).
  // Symbol and unit word are the app's Currency enum (lib/domain/enums.dart); the symbol always leads.
  // AED's trailing LRM: without it, bidi moves a plain-text figure in front of the Arabic symbol.
  var CUR = {
    PHP: ['\u20B1', 1, 'peso'], USD: ['$', 10, 'dollar'], EUR: ['\u20AC', 10, 'euro'], GBP: ['\u00A3', 10, 'pound'],
    CAD: ['CA$', 10, 'dollar'], AUD: ['A$', 10, 'dollar'], SGD: ['S$', 10, 'dollar'], AED: ['\u062F.\u0625\u200E', 2.5, 'dirham'],
  };
  var ZONES = {
    PHP: 'Asia/Manila',
    SGD: 'Asia/Singapore Singapore',
    AED: 'Asia/Dubai',
    GBP: 'Europe/London Europe/Belfast Europe/Jersey Europe/Guernsey Europe/Isle_of_Man GB GB-Eire',
    CAD: 'America/St_Johns America/Halifax America/Glace_Bay America/Moncton America/Goose_Bay America/Blanc-Sablon ' +
      'America/Toronto America/Montreal America/Nipigon America/Thunder_Bay America/Iqaluit America/Pangnirtung ' +
      'America/Atikokan America/Winnipeg America/Rainy_River America/Resolute America/Rankin_Inlet America/Regina ' +
      'America/Swift_Current America/Edmonton America/Cambridge_Bay America/Yellowknife America/Inuvik America/Creston ' +
      'America/Dawson_Creek America/Fort_Nelson America/Whitehorse America/Dawson America/Vancouver',
    EUR: 'Europe/Vienna Europe/Brussels Europe/Sofia Europe/Zagreb Europe/Nicosia Asia/Nicosia Asia/Famagusta ' +
      'Europe/Tallinn Europe/Helsinki Europe/Mariehamn Europe/Paris Europe/Berlin Europe/Busingen Europe/Athens ' +
      'Europe/Dublin Eire Europe/Rome Europe/Riga Europe/Vilnius Europe/Luxembourg Europe/Malta Europe/Amsterdam ' +
      'Europe/Lisbon Portugal Atlantic/Azores Atlantic/Madeira Europe/Bratislava Europe/Ljubljana Europe/Madrid ' +
      'Atlantic/Canary Africa/Ceuta Europe/Andorra Europe/Monaco Europe/San_Marino Europe/Vatican Europe/Podgorica',
  };
  var COUNTRIES = {
    PHP: 'PH', SGD: 'SG', AED: 'AE', GBP: 'GB', CAD: 'CA', AUD: 'AU',
    EUR: 'AT BE BG HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES AD MC SM VA ME',
  };

  function find(table, key) {
    var codes = Object.keys(table);
    for (var i = 0; i < codes.length; i++) {
      if (table[codes[i]].split(' ').indexOf(key) >= 0) return codes[i];
    }
    return 'USD';
  }
  function fromZone(z) {
    return /^Australia\//.test(z) ? 'AUD' : /^Canada\//.test(z) ? 'CAD' : find(ZONES, z);
  }
  function region(l) {
    try { return new Intl.Locale(l).region; } catch (e) { return undefined; }
  }

  function detect() {
    var asked = (new URLSearchParams(location.search).get('cur') || '').toUpperCase();
    if (CUR[asked]) return asked;
    var zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    // A privacy browser reports UTC; only then does the language's region stand in for the zone.
    if (zone && !/^(Etc\/|UTC$|UCT$|GMT$|Universal$|Zulu$)/.test(zone)) return fromZone(zone);
    var tags = navigator.languages || [navigator.language];
    for (var i = 0; i < tags.length; i++) {
      if (tags[i] && region(tags[i])) return find(COUNTRIES, region(tags[i]));
    }
    return 'USD';
  }

  var code = 'PHP';
  try {
    code = detect();
  } catch (e) {
    code = 'PHP';
  }
  var symbol = CUR[code][0];
  var factor = CUR[code][1];
  var unit = CUR[code][2];

  // ── Rewriting authored pesos ───────────────────────────────────────────────

  // index.html's handling, copied: K and M stay compact, a figure keeps the cents it was written with.
  function group(v, d) {
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function compactParts(v) {
    return v >= 1e9 ? [(v / 1e9).toFixed(1), 'B']
      : v >= 1e6 ? [(v / 1e6).toFixed(1), 'M']
        : v >= 1e3 ? [(v / 1e3).toFixed(0), 'K']
          : [group(v, 0), ''];
  }
  function scaleText(num, mag, decimals) {
    var v = Number(num.replace(/,/g, '')) * (mag === 'M' ? 1e6 : mag === 'K' ? 1e3 : 1) / factor;
    return mag ? compactParts(v) : [group(v, decimals), ''];
  }
  function places(num) {
    return num.indexOf('.') >= 0 ? num.length - num.indexOf('.') - 1 : 0;
  }
  var RE = /\u20B1(\d+(?:,\d{3})*(?:\.\d+)?)([KM]?)/g;   // a comma joins digit groups only, so a figure keeps the comma after it
  function inline(all, num, mag) {
    return symbol + scaleText(num, mag, places(num)).join('');
  }

  var done = typeof WeakSet === 'function' ? new WeakSet() : null;
  function seen(node) {
    if (!done) return false;
    if (done.has(node)) return true;
    done.add(node);
    return false;
  }
  function skipped(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && el.closest && el.closest('[data-noscale], script, style, textarea, noscript'));
  }
  function within(root, selector) {
    var out = Array.prototype.slice.call(root.querySelectorAll(selector));
    if (root.matches && root.matches(selector)) out.unshift(root);
    return out;
  }

  function rewrite(root) {
    root = root || document.body;
    if (!root) return;
    within(root, '[data-sym]').forEach(function (el) { el.textContent = symbol; });
    within(root, '[data-unit]').forEach(function (el) {
      if (!skipped(el)) el.textContent = unit;
    });
    if (factor === 1) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var texts = [];
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.data.indexOf('\u20B1') >= 0 && !skipped(n)) texts.push(n);
    }
    texts.forEach(function (t) {
      if (seen(t)) return;
      t.data = t.data.replace(RE, function (all, num, mag, at, s) {
        // A hero splits its figure: "₱12.0" + <span class="mag">M</span>, "₱20,000" + <span class="dec">.00</span>.
        var next = !mag && at + all.length === s.length && t.nextSibling && t.nextSibling.classList;
        if (next && next.contains('mag')) {
          var parts = scaleText(num, t.nextSibling.textContent, 0);
          t.nextSibling.textContent = parts[1];
          return symbol + parts[0];
        }
        if (next && next.contains('dec')) {
          var split = scaleText(num, '', t.nextSibling.textContent.length - 1)[0].split('.');
          t.nextSibling.textContent = '.' + split[1];
          return symbol + split[0];
        }
        return inline(all, num, mag);
      });
    });
    within(root, '[aria-label*="\u20B1"]').forEach(function (el) {
      if (skipped(el) || seen(el)) return;
      el.setAttribute('aria-label', el.getAttribute('aria-label').replace(RE, inline));
    });
  }

  var formats = formatsFor(symbol);
  var api = {
    code: code,
    symbol: symbol,
    factor: factor,
    unit: unit,
    scale: function (pesos) { return pesos / factor; },
    whole: formats.whole,
    money: formats.money,
    compact: formats.compact,
    compactScale: formats.compactScale,
    compactMoney: formats.compactMoney,
    percent: formats.percent,
    multiple: formats.multiple,
    monthsSplit: formats.monthsSplit,
    rewrite: function (root) {
      try {
        rewrite(root);
      } catch (e) {
        // Pesos, exactly as authored.
      }
    },
  };
  window.ClaryoMoney = api;

  try {
    document.documentElement.dataset.cur = code;
  } catch (e) {
    // No dataset: the currency still applies.
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { api.rewrite(document.body); });
  } else {
    api.rewrite(document.body);
  }
})();
