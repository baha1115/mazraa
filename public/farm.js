/* =====================================================
   Farmers — farm.js (Vanilla JS, no frameworks)
   Adds: image gallery slider (thumbs + arrows + keys),
   optional click-to-play video (set data-video-src),
   smooth scroll to contact, footer year.
   ===================================================== */

(function () {
  'use strict';

  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  /* ---------- Footer year ---------- */
  qsa('[data-year]').forEach(el => (el.textContent = new Date().getFullYear()));

  /* =====================================================
     1) Gallery Slider
     ===================================================== */
  (function setupGallery() {
    const slider = qs('.gallery-slider');
    const track  = qs('.gallery-track', slider || document);
    if (!slider || !track) return;

    const slides = qsa('.gallery-slide', track);
    const prev   = qs('.gallery-prev', slider);
    const next   = qs('.gallery-next', slider);
    const thumbs = qsa('.gallery-thumbs .thumb', slider);

    let index = slides.findIndex(s => s.classList.contains('is-active'));
    if (index < 0) index = 0;

    function goTo(i) {
      index = clamp(i, 0, slides.length - 1);
      track.style.transform = `translateX(${-100 * index}%)`;
      slides.forEach((s, k) => s.classList.toggle('is-active', k === index));
      thumbs.forEach((t, k) => {
        t.classList.toggle('is-active', k === index);
        t.setAttribute('aria-selected', k === index ? 'true' : 'false');
      });
    }

    function onPrev() { goTo(index - 1); }
    function onNext() { goTo(index + 1); }

    if (prev)  prev.addEventListener('click', onPrev);
    if (next)  next.addEventListener('click', onNext);
    thumbs.forEach((btn, k) => btn.addEventListener('click', () => goTo(k)));

    // Keyboard navigation when slider is focused
    slider.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft')  onPrev();
      if (e.key === 'ArrowRight') onNext();
    });

    // Initialize
    goTo(index);
  })();

  /* =====================================================
     2) Optional Click-to-Play Video
     - Add data-video-src="path/to/video.mp4" to .video-frame
     - Or data-yt="YouTubeVideoId" to embed YouTube
     ===================================================== */
  (function setupVideo() {
    const section = qs('#video[data-has-video="true"]');
    const frame   = qs('.video-frame', section || document);
    if (!section || !frame) return;

    const mp4 = frame.getAttribute('data-video-src');
    const yt  = frame.getAttribute('data-yt');

    if (!mp4 && !yt) return; // Keep the poster image

    frame.style.position = 'relative';
    frame.style.cursor   = 'pointer';

    const overlay = document.createElement('button');
    overlay.type = 'button';
    overlay.setAttribute('aria-label', 'Play video');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.background = 'linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.35))';
    overlay.style.display = 'grid';
    overlay.style.placeItems = 'center';
    overlay.style.border = '0';
    overlay.style.color = '#fff';
    overlay.style.fontWeight = '800';
    overlay.style.fontSize = '1.1rem';
    overlay.textContent = '► Play video';
    frame.appendChild(overlay);

    function play() {
      overlay.remove();
      frame.innerHTML = ''; // clear poster
      if (mp4) {
        const v = document.createElement('video');
        v.src = mp4;
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        v.style.width = '100%';
        v.style.height = '360px';
        v.style.objectFit = 'cover';
        frame.appendChild(v);
      } else if (yt) {
        const iframe = document.createElement('iframe');
        iframe.width = '100%';
        iframe.height = '360';
        iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0`;
        iframe.title = 'YouTube video player';
        iframe.frameBorder = '0';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        frame.appendChild(iframe);
      }
    }

    overlay.addEventListener('click', play);
    frame.addEventListener('click', (e) => {
      if (e.target === frame) play();
    });
  })();

  /* =====================================================
     3) Smooth scroll to contact (progressive enhancement)
     ===================================================== */
  (function setupScrollToContact() {
    qsa('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        const target = id && qs(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  })();
})();
