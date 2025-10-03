/* =====================================================
   contractor.js — My Farm (Individual Contractor Page)
   Vanilla JS only (no frameworks)
   Features:
   - Mobile menu toggle
   - Smooth in-page scrolling
   - Footer year autoupdate
   - RTL toggle (persists)
   - Portfolio gallery slider (thumbs + arrows + keys)
   - Simple request form validation + inline alert
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
     Gallery Slider (thumbnails + arrows + keys)
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
     Request Form (basic validation + inline alert)
     ===================================================== */
  (function setupRequestForm() {
    const form = qs('#request-form');
    if (!form) return;

    // Create or reuse alert node
    function getAlert() {
      let a = qs('.form-alert', form.parentElement);
      if (!a) {
        a = document.createElement('div');
        a.className = 'form-alert';
        a.setAttribute('role', 'alert');
        a.style.margin = '0 0 .8rem';
        a.style.display = 'none';
        form.parentElement.insertBefore(a, form);
      }
      return a;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Use native validation first
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const alert = getAlert();
      alert.style.display = '';
      alert.style.background = '#ecfdf5';
      alert.style.border = '1px solid #a7f3d0';
      alert.style.color = '#065f46';
      alert.style.padding = '.7rem .9rem';
      alert.style.borderRadius = '12px';
      alert.textContent = 'Request sent successfully! We will contact you shortly.';

      form.reset();

      if (!prefersReducedMotion) {
        alert.animate(
          [{ opacity: 0 }, { opacity: 1 }, { opacity: 1 }, { opacity: 0 }],
          { duration: 3500, easing: 'ease' }
        ).addEventListener('finish', () => { alert.style.display = 'none'; });
      } else {
        setTimeout(() => { alert.style.display = 'none'; }, 3000);
      }
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
