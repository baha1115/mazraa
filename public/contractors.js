/* =====================================================
   contractors.js — My Farm (Landing for Contractors)
   Vanilla JS only (no frameworks)
   Features:
   - Mobile menu toggle
   - Smooth in-page scrolling
   - Footer year autoupdate
   - RTL toggle (persists via localStorage)
   - Hero carousel (autoplay, prev/next, dots, pause on hover/focus)
   - VIP-first sorting
   - Filtering by specialization & region
   - Lazy reveal of cards
   - Make entire card clickable
   ===================================================== */

(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasFinePointer = window.matchMedia('(pointer:fine)').matches;

  /* ---------- Helpers ---------- */
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  /* ---------- Footer year ---------- */
  qsa('[data-year]').forEach(el => (el.textContent = String(new Date().getFullYear())));

  /* ---------- Mobile menu ---------- */
  (function setupMobileMenu() {
    const btn = qs('.nav-toggle');
    const menu = qs('#mobile-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      if (menu.hasAttribute('hidden')) menu.removeAttribute('hidden');
      else menu.setAttribute('hidden', '');
    });

    menu.addEventListener('click', (e) => {
      if (e.target.matches('a')) {
        menu.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  })();

  /* ---------- Smooth in-page anchors ---------- */
  (function setupSmoothScroll() {
    qsa('a[href^="#"]:not([href="#"])').forEach(a => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        const t = id && qs(id);
        if (!t) return;
        e.preventDefault();
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  })();

  /* ---------- RTL toggle (Arabic support) ---------- */
  (function setupRTL() {
    const toggle = qs('[data-toggle-rtl]');
    const root = document.documentElement;
    const KEY = 'myfarm_rtl';
    function apply(state) {
      root.setAttribute('dir', state ? 'rtl' : 'ltr');
      if (toggle) {
        toggle.textContent = state ? 'English' : 'العربية';
        toggle.setAttribute('title', state ? 'Switch to English (LTR)' : 'التبديل إلى العربية (RTL)');
      }
      localStorage.setItem(KEY, state ? '1' : '0');
    }
    if (toggle) {
      const saved = localStorage.getItem(KEY) === '1';
      apply(saved);
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const nowRtl = root.getAttribute('dir') === 'rtl';
        apply(!nowRtl);
      });
    }
  })();

  /* =====================================================
     Hero Carousel (autoplay + controls + dots)
     ===================================================== */
  document.addEventListener('DOMContentLoaded', function(){
    const gSwiper = new Swiper('.gallery-swiper', {
      loop: true,
      slidesPerView: 1,
      spaceBetween: 14,
      autoplay: {
        delay: 3500,
        disableOnInteraction: false,
      },
      pagination: {
        el: '.gallery-swiper .swiper-pagination',
        clickable: true,
      },
      navigation: {
        nextEl: '.gallery-swiper .swiper-button-next',
        prevEl: '.gallery-swiper .swiper-button-prev',
      },
    });
  });
  /* =====================================================
     VIP-first sorting (DOM reorder once on load)
     ===================================================== */
  (function sortCardsVIPFirst() {
    const grid = qs('.cards-grid');
    if (!grid) return;
    const priority = { VIP: 3, Premium: 2, Basic: 1 };
    const cards = qsa('.contractor-card', grid);

    // Filter out unapproved (defense-in-depth)
    cards.forEach(c => {
      if (c.dataset.approved === 'false') c.remove();
    });

    const sorted = [...qsa('.contractor-card', grid)].sort((a, b) => {
      const pa = priority[a.dataset.subscription] || 0;
      const pb = priority[b.dataset.subscription] || 0;
      if (pb !== pa) return pb - pa;
      // Stable fallback: by name
      const na = (a.querySelector('.name')?.textContent || '').trim();
      const nb = (b.querySelector('.name')?.textContent || '').trim();
      return na.localeCompare(nb);
    });

    sorted.forEach(c => grid.appendChild(c));
  })();

  /* =====================================================
     Filtering (specialization & region)
     ===================================================== */
  (function setupFiltering() {
    const form = qs('#contractor-filters');
    const grid = qs('.cards-grid');
    if (!form || !grid) return;

    const noResId = 'no-results-msg';

    function ensureNoResultsEl() {
      let el = qs('#' + noResId);
      if (!el) {
        el = document.createElement('p');
        el.id = noResId;
        el.className = 'muted';
        el.style.display = 'none';
        el.textContent = 'No contractors found for the selected filters.';
        grid.parentElement.insertBefore(el, grid.nextSibling);
      }
      return el;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const spec = (form.specialization.value || '').trim();
      const region = (form.region.value || '').trim();

      let visibleCount = 0;

      qsa('.contractor-card', grid).forEach(card => {
        const okApproved = card.dataset.approved !== 'false';
        const okSpec = !spec || (card.dataset.specialization === spec);
        const okRegion = !region || (card.dataset.region === region);

        const show = okApproved && okSpec && okRegion;
        card.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });

      const msg = ensureNoResultsEl();
      msg.style.display = visibleCount === 0 ? '' : 'none';

      const list = qs('#list');
      if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  })();

  /* =====================================================
     Lazy reveal of cards
     ===================================================== */
  (function setupLazyReveal() {
    const cards = qsa('.contractor-card');
    if (!('IntersectionObserver' in window) || cards.length === 0) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.15 });

    cards.forEach(c => io.observe(c));
  })();

  /* =====================================================
     Make entire card clickable
     ===================================================== */
  (function setupClickableCards() {
    qsa('.contractor-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Respect modifiers (open new tab)
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const link = card.querySelector('.contractor-link');
        if (!link) return;
        // If user clicked a button inside, also follow the link
        if (!e.target.closest('a')) link.click();
      });
      // Cursor hint
      card.style.cursor = 'pointer';
    });
  })();

  /* =====================================================
     Tiny hover pulse on WhatsApp FAB
     ===================================================== */
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
