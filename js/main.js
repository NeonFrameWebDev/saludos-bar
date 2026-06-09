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
    const LOADER_MS = 1200;
    setTimeout(() => {
      loader.classList.add('done');
      setTimeout(() => {
        loader.style.display = 'none';
      }, 450);
    }, LOADER_MS);
  }

  /* ── Sticky nav ─────────────────────────────────────────────── */
  const nav = document.getElementById('navbar');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 80);
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

  /* ── Hero parallax (desktop only, home page) ────────────────── */
  const heroBgImg = document.querySelector('.hero__bg img');
  if (
    heroBgImg &&
    window.matchMedia('(min-width: 768px)').matches &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  ) {
    let ticking = false;
    const onScrollHero = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const y = window.scrollY;
          if (y < window.innerHeight) {
            heroBgImg.style.transform = `translateY(${y * 0.40}px)`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScrollHero, { passive: true });
  }

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
