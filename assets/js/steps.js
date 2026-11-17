/* The stepper for guides and tools (Story L.9, contract §4).
   Without this script every step shows in reading order and the chapter list is a table of
   contents. With it, one step shows at a time. The chapter bar is the app's walk timeline
   (walk_timeline_bar.dart): wordless pills, one per step, 44px tall targets.
   Keep it inside what every current browser parses: ES2017, no ?. ?? ??= or replaceChildren. */
(function () {
  'use strict';

  var LABELS = { back: 'Back', next: 'Next', result: 'See the result', restart: 'Start over' };
  var STATES = new WeakMap();
  var roots = [];
  var uid = 0;

  function childrenWith(root, cls) {
    var out = [];
    for (var i = 0; i < root.children.length; i++) {
      if (root.children[i].classList.contains(cls)) out.push(root.children[i]);
    }
    return out;
  }

  function heading(step) {
    return step.querySelector('h2');
  }

  // The first field that would refuse its step, or null. `willValidate` is false for disabled,
  // readonly and hidden inputs, so those never block.
  function firstInvalid(step) {
    var list = step.querySelectorAll('input, select, textarea');
    for (var i = 0; i < list.length; i++) {
      if (list[i].willValidate && !list[i].validity.valid) return list[i];
    }
    return null;
  }

  // How far towards `index` a step may open: a tool never opens past its first step with an
  // unanswered required field. A guide has no fields and opens anywhere.
  function reachable(st, index) {
    if (st.mode !== 'tool') return index;
    for (var i = 0; i < index; i++) {
      if (firstInvalid(st.steps[i])) return i;
    }
    return index;
  }

  // The step that is, or holds, the element with this id; -1 when none of this root's does.
  function stepIndexFor(st, id) {
    if (!id) return -1;
    var el = document.getElementById(id);
    if (!el) return -1;
    for (var i = 0; i < st.steps.length; i++) {
      if (st.steps[i] === el || st.steps[i].contains(el)) return i;
    }
    return -1;
  }

  function hashId() {
    var h = location.hash.slice(1);
    try { return decodeURIComponent(h); } catch (e) { return h; }
  }

  // replaceState only: a step never adds a history entry, so Back leaves the page.
  function setHash(id) {
    if (!id || hashId() === id) return;
    try { history.replaceState(history.state, '', '#' + encodeURIComponent(id)); } catch (e) { /* sandboxed */ }
  }

  function fire(root, name, detail, cancelable) {
    var ev = new CustomEvent(name, { bubbles: true, cancelable: !!cancelable, detail: detail });
    return root.dispatchEvent(ev);
  }

  function button(cls, text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // The sticky header plus air, so a step's top never lands under it.
  function headerOffset() {
    var bar = document.querySelector('header.top');
    return (bar ? bar.offsetHeight : 0) + 16;
  }

  function bringIntoView(root) {
    var off = headerOffset();
    var top = root.getBoundingClientRect().top;
    if (top < off) window.scrollTo(0, Math.max(0, window.pageYOffset + top - off));
  }

  function sync(st) {
    var i = st.index;
    st.count.textContent = 'Step ' + (i + 1) + ' of ' + st.steps.length;
    for (var k = 0; k < st.steps.length; k++) st.steps[k].classList.toggle('is-current', k === i);
    for (var j = 0; j < st.links.length; j++) {
      if (st.links[j].index === i) st.links[j].a.setAttribute('aria-current', 'step');
      else st.links[j].a.removeAttribute('aria-current');
    }
  }

  // Shows step `index`. Events go out before focus moves, so a tool can fill its result step
  // and the heading is read with what it now says.
  function show(st, index, how) {
    st.index = index;
    sync(st);
    var step = st.steps[index];
    if (!how.initial) {
      // A step's fade restarts each time it is displayed again; the CSS runs it only under
      // prefers-reduced-motion: no-preference.
      step.classList.add('step-in');
      if (!how.keepHash) setHash(step.id);
    }
    var initial = !!how.initial;
    fire(st.root, 'steps:change', { index: index, initial: initial });
    if (index === st.steps.length - 1) fire(st.root, 'steps:finish', { index: index, initial: initial });
    if (how.focus) {
      bringIntoView(st.root);
      var h = heading(step);
      if (h) h.focus({ preventScroll: true });
    }
  }

  // A reader's move: Back, Next, a chapter, a hash. Forward in a tool checks every step before
  // the target and stops at the first unanswered one, with the browser's own message.
  function move(st, index, how) {
    if (index < 0 || index >= st.steps.length || index === st.index) return;
    if (index > st.index) {
      var to = reachable(st, index);
      if (to !== index) {
        if (to !== st.index) show(st, to, { focus: false });
        var field = firstInvalid(st.steps[to]);
        if (field) field.reportValidity();
        return;
      }
    }
    show(st, index, how || { focus: true });
  }

  function restart(st) {
    // Cancelable: a tool that wants to keep the answers calls preventDefault().
    if (fire(st.root, 'steps:restart', { index: st.index }, true)) {
      var form = st.root.closest('form');
      if (form) form.reset();
    }
    show(st, 0, { focus: true });
  }

  function navFor(st, step, k) {
    var last = st.steps.length - 1;
    var row = document.createElement('div');
    row.className = 'step-nav';
    if (k > 0) {
      row.appendChild(button('step-back', LABELS.back, function () { move(st, st.index - 1); }));
    }
    if (k < last) {
      var label = step.getAttribute('data-next') ||
        (st.mode === 'tool' && k === last - 1 ? LABELS.result : LABELS.next);
      row.appendChild(button('step-next', label, function () { move(st, st.index + 1); }));
    } else if (st.mode === 'tool') {
      row.appendChild(button('step-restart', LABELS.restart, function () { restart(st); }));
    }
    // A guide's last step has no Next: the page's own door follows the steps.
    if (row.firstChild) {
      step.appendChild(row);
      st.made.push(row);
    }
  }

  function wireChapters(st) {
    var list = childrenWith(st.root, 'chapters')[0];
    if (!list) return;
    var links = list.querySelectorAll('a[href^="#"]');
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        var id = a.getAttribute('href').slice(1);
        try { id = decodeURIComponent(id); } catch (e) { /* keep as written */ }
        var k = stepIndexFor(st, id);
        if (k < 0) return;
        if (!a.hasAttribute('title')) a.setAttribute('title', a.textContent.trim());
        // The pill is wordless; its name stays in the link for a screen reader.
        var name = document.createElement('span');
        name.className = 'ch-t';
        while (a.firstChild) name.appendChild(a.firstChild);
        a.appendChild(name);
        st.unwrap.push({ a: a, name: name });
        st.links.push({ a: a, index: k });
        a.addEventListener('click', function (e) {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          move(st, k);
        });
      })(links[i]);
    }
  }

  // Tools: Enter in a field answers the step (the phone keyboard's Next/Go key does the same),
  // and the form never submits, so nothing typed can reach a URL.
  function wireTool(st) {
    var form = st.root.closest('form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });
    var last = st.steps.length - 1;
    for (var k = 0; k < last; k++) {
      var inputs = st.steps[k].querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        if (/^(text|search|tel|number|email|url)$/.test(inputs[i].type) && !inputs[i].hasAttribute('enterkeyhint')) {
          inputs[i].setAttribute('enterkeyhint', k === last - 1 ? 'go' : 'next');
        }
      }
    }
    st.root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
      var t = e.target;
      if (!t || t.tagName !== 'INPUT' || /^(button|submit|reset|checkbox|file|image)$/.test(t.type)) return;
      if (st.index >= last || !st.steps[st.index].contains(t)) return;
      e.preventDefault();
      move(st, st.index + 1);
    });
  }

  // Puts the page back as the markup wrote it: every step showing, the chapters a list.
  function undo(st) {
    st.root.classList.remove('js-steps');
    for (var i = 0; i < st.made.length; i++) {
      if (st.made[i].parentNode) st.made[i].parentNode.removeChild(st.made[i]);
    }
    for (var j = 0; j < st.unwrap.length; j++) {
      var u = st.unwrap[j];
      while (u.name.firstChild) u.a.insertBefore(u.name.firstChild, u.name);
      if (u.name.parentNode) u.name.parentNode.removeChild(u.name);
    }
    STATES.delete(st.root);
  }

  function init(root) {
    var known = STATES.get(root);
    if (known) return known;
    var steps = childrenWith(root, 'step');
    if (steps.length < 2) return null;

    var st = {
      root: root,
      steps: steps,
      mode: root.getAttribute('data-steps') === 'tool' ? 'tool' : 'guide',
      index: -1,
      links: [],
      made: [],
      unwrap: []
    };
    STATES.set(root, st);

    try {
      // Hidden from assistive tech and read through each heading's description instead, so
      // "Step 2 of 5" is heard once, with the heading focus lands on.
      var count = document.createElement('p');
      count.className = 'steps-count';
      count.id = 'steps-count-' + (++uid);
      count.setAttribute('aria-hidden', 'true');
      root.insertBefore(count, steps[0]);
      st.count = count;
      st.made.push(count);

      for (var k = 0; k < steps.length; k++) {
        var h = heading(steps[k]);
        if (h) {
          if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
          if (!h.hasAttribute('aria-describedby')) h.setAttribute('aria-describedby', count.id);
        }
        navFor(st, steps[k], k);
      }
      wireChapters(st);
      if (st.mode === 'tool') wireTool(st);

      var asked = stepIndexFor(st, hashId());
      var start = asked >= 0 ? reachable(st, asked) : 0;
      root.classList.add('js-steps');
      show(st, start, { initial: true });
      if (asked >= 0) {
        if (start !== asked) setHash(steps[start].id);
        // The browser scrolled to the anchor before the other steps were put away.
        root.scrollIntoView({ block: 'start' });
      }
    } catch (e) {
      undo(st);
      return null;
    }
    if (roots.indexOf(st) < 0) roots.push(st);
    return st;
  }

  function start() {
    var list = document.querySelectorAll('.steps');
    for (var i = 0; i < list.length; i++) init(list[i]);
  }

  // An in-page link to a step (or to an anchor inside one) opens that step.
  window.addEventListener('hashchange', function () {
    var id = hashId();
    for (var i = 0; i < roots.length; i++) {
      var st = roots[i];
      var k = stepIndexFor(st, id);
      if (k < 0 || k === st.index) continue;
      move(st, k, { focus: true, keepHash: true });
      var target = document.getElementById(id);
      if (st.index === k && target && target !== st.steps[k]) target.scrollIntoView({ block: 'start' });
    }
  });

  window.ClaryoSteps = {
    init: init,
    // Opens a step as a reader's move would, minus the checks: a tool's own "start over" or a
    // link it draws. Focus goes to the step's heading.
    go: function (root, index) {
      var st = STATES.get(root) || init(root);
      if (!st || index < 0 || index >= st.steps.length || index === st.index) return;
      show(st, index, { focus: true });
    },
    index: function (root) {
      var st = STATES.get(root);
      return st ? st.index : -1;
    }
  };

  // Deferred, this runs before DOMContentLoaded, so a page's own DOMContentLoaded handler
  // (registered earlier, while parsing) runs first and can set its fields' defaults before the
  // opening step is chosen. `load` covers a late insertion.
  if (document.readyState === 'complete') {
    start();
  } else {
    var started = false;
    var once = function () {
      if (started) return;
      started = true;
      start();
    };
    document.addEventListener('DOMContentLoaded', once);
    window.addEventListener('load', once);
  }
})();
