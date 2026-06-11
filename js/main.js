/* ================================================================
   SALUDOS BAR & COCINA — main.js
   Nav scroll state, hamburger, scroll reveal, hero parallax,
   page loader (index.html only).
   ================================================================ */

(function () {
  'use strict';

  /* ── Page loader (index.html only) ─────────────────────────── */
  const loader = document.getElementById('loader');
  if (loader) {
    const start = performance.now();
    let done = false;
    const dismiss = () => {
      if (done) return; done = true;
      loader.classList.add('done');
      setTimeout(() => { loader.style.display = 'none'; }, 450);
    };
    // Dismiss as soon as the page is actually ready (min ~450ms brand beat, 2.2s safety cap)
    const ready = () => setTimeout(dismiss, Math.max(0, 450 - (performance.now() - start)));
    if (document.readyState === 'complete') ready();
    else window.addEventListener('load', ready);
    setTimeout(dismiss, 2200);
  }

  /* ── Sticky nav ─────────────────────────────────────────────── */
  const nav = document.getElementById('navbar');
  if (nav) {
    let scrolled = false;
    const onScroll = () => {
      const s = window.scrollY > 80;
      if (s !== scrolled) { scrolled = s; nav.classList.toggle('scrolled', s); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── Hamburger / mobile menu ────────────────────────────────── */
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      hamburger.classList.toggle('active');
      hamburger.setAttribute('aria-expanded', String(open));
    });

    navLinks.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', (e) => {
      if (
        navLinks.classList.contains('open') &&
        !navLinks.contains(e.target) &&
        e.target !== hamburger &&
        !hamburger.contains(e.target)
      ) {
        navLinks.classList.remove('open');
        hamburger.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ── Scroll reveal (IntersectionObserver) ───────────────────── */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  );

  document.querySelectorAll('.appear').forEach((el) => revealObserver.observe(el));

  /* (hero parallax removed — the home hero is the self-animating <canvas>) */

  /* ── Menu jump nav active state ─────────────────────────────── */
  const menuJumpLinks = document.querySelectorAll('.menu-jump__link');
  if (menuJumpLinks.length) {
    const sections = [];
    menuJumpLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const el = document.querySelector(href);
        if (el) sections.push({ link, el });
      }
    });

    const jumpObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            menuJumpLinks.forEach((l) => l.classList.remove('active'));
            const match = sections.find((s) => s.el === entry.target);
            if (match) match.link.classList.add('active');
          }
        });
      },
      { threshold: 0.3 }
    );

    sections.forEach((s) => jumpObserver.observe(s.el));
  }

})();
