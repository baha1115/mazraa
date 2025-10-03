/* =====================================================
   Farmers — rent.js (Vanilla JS, no frameworks)
   Adds: Featured carousel, dependent city dropdown,
   filtering, lazy reveal, clickable cards, footer year.
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

(function () {
  'use strict';

  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  /* ---------- Footer year ---------- */
  qsa('[data-year]').forEach(el => (el.textContent = new Date().getFullYear()));

  /* =====================================================
     1) Featured Carousel (autoplay + controls + dots)
     ===================================================== */
  
  /* =====================================================
     2) Dependent City Dropdown
     ===================================================== */
  (function setupDependentCity() {
    const areaSel = qs('#area');
    const citySel = qs('#city');
    if (!areaSel || !citySel) return;

    function filterCityOptions() {
      const area = areaSel.value;
      let hasVisibleCity = false;

      qsa('option', citySel).forEach(opt => {
        const optArea = opt.getAttribute('data-area');
        const isCity  = !!optArea;          // Cities have data-area; the "All Cities" option has none
        if (!isCity) { opt.hidden = false; return; }

        const match = !area || optArea === area;
        opt.hidden = !match;
        if (match) hasVisibleCity = true;
      });

      // Reset city if current selection is now hidden
      const selected = citySel.selectedOptions[0];
      if (selected && selected.hidden) citySel.value = '';
      if (!hasVisibleCity) citySel.value = '';
    }

    areaSel.addEventListener('change', filterCityOptions);
    filterCityOptions();
  })();

  /* =====================================================
     3) Client-side Filtering of Farm Cards
     ===================================================== */
  (function setupFiltering() {
    const form = qs('#rent-filters');
    const grid = qs('.cards-grid');
    if (!form || !grid) return;

    function parseNum(v, fallback) {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : fallback;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const area   = (form.area.value || '').trim();
      const city   = (form.city.value || '').trim();
      const status = form.status.value || 'available-only';

      const priceMin = parseNum(form.price_min.value, -Infinity);
      const priceMax = parseNum(form.price_max.value,  Infinity);
      const sizeMin  = parseNum(form.size_min.value,  -Infinity);
      const sizeMax  = parseNum(form.size_max.value,   Infinity);

      qsa('.farm-card', grid).forEach(card => {
        const okApproved = card.dataset.approved !== 'false';

        const okArea  = !area || card.dataset.area === area;
        const okCity  = !city || card.dataset.city === city;

        const price   = parseNum(card.dataset.price, 0);
        const size    = parseNum(card.dataset.size, 0);
        const cStatus = (card.dataset.status || 'available').toLowerCase();
        const okStatus = status === 'all' ? true : cStatus === 'available';

        const okPrice = price >= priceMin && price <= priceMax;
        const okSize  = size  >= sizeMin  && size  <= sizeMax;

        const visible = okApproved && okArea && okCity && okStatus && okPrice && okSize;
        card.style.display = visible ? '' : 'none';
      });

      const results = qs('#results');
      if (results) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  })();

  /* =====================================================
     4) Lazy Reveal of Cards
     ===================================================== */
  (function setupLazyReveal() {
    const cards = qsa('.farm-card');
    if (!('IntersectionObserver' in window) || cards.length === 0) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible'); // (CSS can animate opacity/transform if you like)
        io.unobserve(entry.target);
      });
    }, { threshold: 0.2 });

    cards.forEach(c => io.observe(c));
  })();

  /* =====================================================
     5) Make Entire Card Clickable
     ===================================================== */
  (function setupClickableCards() {
    qsa('.farm-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Respect modifier keys for new tab, etc.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const link = card.querySelector('.farm-link');
        if (link) link.click();
      });
    });
  })();
})();
