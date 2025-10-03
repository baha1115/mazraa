/* =====================================================
   Farmers — app.js (Vanilla JS, no frameworks)
   Interactivity:
   - Mobile menu toggle
   - Smooth in-page scrolling
   - Dynamic current year
   - Hero mouse-parallax (green/yellow layers)
   - Card tilt on Subscription & Testimonial cards
   - KPI counters (metrics) animate on scroll
   - Skill meters (<progress>) animate on scroll
   - Subtle hover pulse on WhatsApp FAB
   ===================================================== */

(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasFinePointer = matchMedia('(pointer:fine)').matches;

  /* ---------- Helpers ---------- */
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function animateNumber(el, start, end, duration, format = (v) => String(v)) {
    if (prefersReducedMotion || duration <= 0) {
      el.textContent = format(end);
      return;
    }
    const startTs = performance.now();
    const delta   = end - start;
    function tick(ts) {
      const p = clamp((ts - startTs) / duration, 0, 1);
      const val = Math.round(start + delta * p);
      el.textContent = format(val);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------- Current year ---------- */
  qsa('[data-year]').forEach(el => (el.textContent = new Date().getFullYear()));

  /* ---------- Mobile menu toggle ---------- */
  const navToggle  = qs('.nav-toggle');
  const mobileMenu = qs('#mobile-menu');

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!expanded));
      if (mobileMenu.hasAttribute('hidden')) mobileMenu.removeAttribute('hidden');
      else mobileMenu.setAttribute('hidden', '');
    });

    // Close when a link is clicked
    mobileMenu.addEventListener('click', (e) => {
      if (e.target.matches('a')) {
        mobileMenu.setAttribute('hidden', '');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- Smooth in-page scrolling ---------- */
  qsa('a[href^="#"]:not([href="#"])').forEach(link => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      const target = id && qs(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ---------- Hero mouse-parallax (layers) ---------- */
  (function setupHeroParallax() {
    const hero   = qs('.hero');
    const layers = qsa('.hero-layer', hero);
    if (!hero || layers.length === 0 || !hasFinePointer) return;

    let rafId = null;
    let targetX = 0, targetY = 0;
    let currX = 0, currY = 0;

    function onMove(e) {
      const r = hero.getBoundingClientRect();
      const relX = (e.clientX - (r.left + r.width / 2)) / r.width;  // -0.5..0.5
      const relY = (e.clientY - (r.top  + r.height / 2)) / r.height; // -0.5..0.5
      targetX = relX * 2;  // -1..1
      targetY = relY * 2;
      if (!rafId) rafId = requestAnimationFrame(update);
    }

    function update() {
      // Ease current toward target for smoothness
      currX += (targetX - currX) * 0.12;
      currY += (targetY - currY) * 0.12;

      layers.forEach(layer => {
        const depthAttr = layer.dataset.depth || layer.getAttribute('depth');
        const depth = parseFloat(depthAttr || (layer.classList.contains('hero-layer--green') ? 0.25 : 0.45));
        const maxShift = 40; // px
        const tx = (-currX * depth) * maxShift;
        const ty = (-currY * depth) * maxShift;
        layer.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
      });

      if (Math.abs(targetX - currX) > 0.001 || Math.abs(targetY - currY) > 0.001) {
        rafId = requestAnimationFrame(update);
      } else {
        rafId = null;
      }
    }

    if (!prefersReducedMotion) {
      hero.addEventListener('mousemove', onMove);
      hero.addEventListener('mouseleave', () => { targetX = 0; targetY = 0; if (!rafId) rafId = requestAnimationFrame(update); });
    }
  })();

  /* ---------- Card tilt (plans & testimonials) ---------- */
  (function setupTilt() {
    if (prefersReducedMotion || !hasFinePointer) return;
    const TILT_SELECTOR = '.plan, .testimonial';
    const cards = qsa(TILT_SELECTOR);
    if (!cards.length) return;

    const MAX_TILT = 8; // deg
    const PERSPECTIVE = 900; // px

    cards.forEach(card => {
      let ticking = false;

      function move(e) {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;   // 0..1
        const py = (e.clientY - r.top)  / r.height;  // 0..1
        const rx = (py - 0.5) * -2 * MAX_TILT;       // deg
        const ry = (px - 0.5) *  2 * MAX_TILT;       // deg

        if (!ticking) {
          requestAnimationFrame(() => {
            card.style.transform = `perspective(${PERSPECTIVE}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
            ticking = false;
          });
          ticking = true;
        }
      }

      function leave() {
        card.style.transform = `perspective(${PERSPECTIVE}px) rotateX(0deg) rotateY(0deg)`;
      }

      card.addEventListener('mousemove', move);
      card.addEventListener('mouseleave', leave);
      card.addEventListener('mouseenter', () => { card.style.willChange = 'transform'; });
      card.addEventListener('transitionend', () => { card.style.willChange = ''; });
    });
  })();

  /* ---------- KPI counters on scroll ---------- */
  (function setupCounters() {
    const counters = qsa('.kpi-value[data-counter]');
    if (!counters.length) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = Number(el.getAttribute('data-counter') || '0');
        const text   = (el.textContent || '').trim();
        const match  = text.match(/(\d+)(.*)$/); // capture suffix like %, +, h
        const suffix = match ? match[2] : '';
        if (prefersReducedMotion) {
          el.textContent = `${target}${suffix}`;
        } else {
          el.textContent = `0${suffix}`;
          animateNumber(el, 0, target, 1000, (v) => `${v}${suffix}`);
        }
        io.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(el => io.observe(el));
  })();

  /* ---------- Skill meters animate on scroll ---------- */
  (function setupSkillMeters() {
    const meters = qsa('.skill-meter');
    if (!meters.length) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const meter = entry.target;
        const target = parseFloat(meter.getAttribute('value') || '0');
        if (prefersReducedMotion || target <= 0) {
          meter.value = target;
        } else {
          // animate value
          const startTs = performance.now();
          const duration = 900;
          function tick(ts) {
            const p = clamp((ts - startTs) / duration, 0, 1);
            meter.value = Math.round(target * p);
            if (p < 1) requestAnimationFrame(tick);
          }
          meter.value = 0;
          requestAnimationFrame(tick);
        }
        io.unobserve(meter);
      });
    }, { threshold: 0.4 });

    meters.forEach(m => io.observe(m));
  })();

  /* ---------- Scrollspy (active nav link) ---------- */
  (function setupScrollspy() {
    const sections = qsa('section[id], main[id]');
    const links = new Map();
    qsa('.navlinks a, .mobile-menu a').forEach(a => {
      const id = a.getAttribute('href') || '';
      if (id.startsWith('#')) links.set(id.slice(1), a);
    });
    if (!sections.length || links.size === 0) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = entry.target.id;
        const link = links.get(id);
        if (!link) return;
        if (entry.isIntersecting) {
          qsa('.navlinks a.is-active').forEach(x => x.classList.remove('is-active'));
          link.classList.add('is-active');
        }
      });
    }, { threshold: 0.55 });

    sections.forEach(sec => io.observe(sec));
  })();

  /* ---------- WhatsApp FAB tiny pulse on hover ---------- */
  (function setupFabHover() {
    if (prefersReducedMotion || !hasFinePointer) return;
    const fab = qs('.fab-whatsapp');
    if (!fab || !fab.animate) return;
    fab.addEventListener('mouseenter', () => {
      fab.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
        { duration: 240, easing: 'ease-out' }
      );
    });
  })();
})();
