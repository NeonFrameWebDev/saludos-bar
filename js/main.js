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

  /* ── Bilingual EN / ES toggle ───────────────────────────────── */
  /* Text nodes carry data-en / data-es (set as textContent). Markup-bearing
     nodes (e.g. an address with <br>) carry data-en-html / data-es-html (set as
     innerHTML). Inputs carry data-ph-en / data-ph-es (set as placeholder). The
     nav flag chips and the menu-image viewer both follow the global language. */
  const LANG_KEY = 'saludos_lang';
  const getLang = () => {
    try { return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'en'; }
    catch (e) { return 'en'; }
  };

  const applyLang = (lang) => {
    document.documentElement.setAttribute('lang', lang);

    document.querySelectorAll('[data-en], [data-es], [data-en-html], [data-es-html]').forEach((el) => {
      const html = el.getAttribute('data-' + lang + '-html');
      if (html !== null) { el.innerHTML = html; return; }
      const txt = el.getAttribute('data-' + lang);
      if (txt !== null) el.textContent = txt;
    });

    document.querySelectorAll('[data-ph-' + lang + ']').forEach((el) => {
      el.setAttribute('placeholder', el.getAttribute('data-ph-' + lang));
    });

    document.querySelectorAll('.lang-chip').forEach((c) => {
      const on = c.getAttribute('data-setlang') === lang;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // Menu-image viewer (menu.html) mirrors the global language.
    document.querySelectorAll('.mpv-btn').forEach((b) => {
      const on = b.getAttribute('data-lang') === lang;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('.mpv-page').forEach((p) => {
      p.classList.toggle('mpv-hidden', p.getAttribute('data-lang-group') !== lang);
    });
  };

  const setLang = (lang) => {
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    applyLang(lang);
  };

  document.querySelectorAll('.lang-chip').forEach((c) => {
    c.addEventListener('click', () => setLang(c.getAttribute('data-setlang')));
  });
  // The menu-image toggle buttons also drive the global language.
  document.querySelectorAll('.mpv-btn').forEach((b) => {
    b.addEventListener('click', () => setLang(b.getAttribute('data-lang')));
  });

  // ?lang=es / ?lang=en deep-links the language (and remembers it).
  const urlLang = new URLSearchParams(location.search).get('lang');
  if (urlLang === 'es' || urlLang === 'en') setLang(urlLang);
  else applyLang(getLang());

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
