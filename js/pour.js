/* Saludos Bar — "The Pour" hero.
   A pure-canvas ice-cold drink that pours up once the loader clears, sloshes with
   device tilt (gyro on phones / cursor on desktop, auto-sloshes otherwise), streams
   bubbles, crests with foam, and fills the SALUDOS wordmark as the liquid rises.

   Safe + light: one rAF loop, DPR capped at 2, pauses off-screen / tab-hidden, the
   wordmark is pre-rendered to offscreen sprites (no per-frame shadow blur), and
   reduced-motion users get a single static already-full frame. No image, no WebGL. */
(function () {
  'use strict';
  var canvas = document.getElementById('pour-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  var hero = canvas.closest('.hero') || canvas.parentNode;
  var prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var COL = {
    bgTop: '#160d05', bgBot: '#1b1006',
    amberHi: '#E6B85C', amber: '#C08A30', amberDeep: '#6b4a1d', dark: '#241606',
    cream: '#F3E8CC', foam: 'rgba(245,236,216,'
  };

  var W = 0, H = 0, DPR = 1;
  var raf = null, running = false, t0 = 0, lastT = 0, lastTime = 0, visible = true;

  var REST = 0.74;
  var fillFrac = 0;
  var poured = false, pourStart = 0;

  var tiltTarget = 0, tilt = 0, tiltVel = 0, lastInput = -1e9;

  var bubbles = [];
  var MAXB = 26;
  var textReady = false;
  var spriteBright = null, spriteDim = null;

  function buildSprites() {
    if (W < 2 || H < 2) return;
    var fs = Math.min(W * 0.17, H * 0.2);
    var cx = W / 2, cy = H * 0.4;
    function mk(paintWord) {
      var c = document.createElement('canvas');
      c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
      var g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.font = '900 ' + fs + 'px "Abril Fatface", Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      paintWord(g);
      return c;
    }
    spriteBright = mk(function (g) {
      g.shadowColor = 'rgba(230,184,92,0.55)'; g.shadowBlur = 24;
      g.fillStyle = COL.cream; g.fillText('SALUDOS', cx, cy);
    });
    spriteDim = mk(function (g) {
      g.lineWidth = Math.max(1, fs * 0.012);
      g.strokeStyle = 'rgba(237,224,196,0.20)'; g.fillStyle = 'rgba(237,224,196,0.045)';
      g.fillText('SALUDOS', cx, cy); g.strokeText('SALUDOS', cx, cy);
    });
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (textReady) buildSprites();
    if (!running) { if (prefersReduce) renderStatic(); else paint(lastTime, 0); }
  }

  function makeBubble(scatter) {
    var top = H * (1 - REST);
    return {
      x: Math.random() * W, y: scatter ? top + Math.random() * (H - top) : H + 6,
      r: 1.2 + Math.random() * 3.0, sp: 16 + Math.random() * 36,
      drift: (Math.random() - 0.5) * 16, ph: Math.random() * 6.283
    };
  }
  for (var i = 0; i < MAXB; i++) bubbles.push(makeBubble(true));

  function surfaceY(x, time) {
    var base = H * (1 - fillFrac);
    var tiltPx = tilt * (x - W / 2) * 0.26;
    var amp = Math.min(28, 3.5 + Math.abs(tiltVel) * 0.55);
    return base + tiltPx + Math.sin(x * 0.011 + time * 1.7) * amp + Math.sin(x * 0.027 - time * 2.6) * amp * 0.4;
  }
  function buildSurface(time, step) {
    var pts = [];
    for (var x = 0; x <= W; x += step) pts.push([x, surfaceY(x, time)]);
    pts.push([W, surfaceY(W, time)]);
    return pts;
  }
  function liquidPath(pts) {
    ctx.beginPath(); ctx.moveTo(0, H + 2); ctx.lineTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(W, H + 2); ctx.closePath();
  }

  function paint(time, dt) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COL.bgTop); g.addColorStop(1, COL.bgBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var rg = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.08, W / 2, H * 0.5, H * 0.85);
    rg.addColorStop(0, 'rgba(74,32,112,0.12)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    if (spriteDim) ctx.drawImage(spriteDim, 0, 0, W, H);

    var pts = buildSurface(time, 10);

    liquidPath(pts);
    var top = H * (1 - fillFrac);
    var lg = ctx.createLinearGradient(0, top - 12, 0, H);
    lg.addColorStop(0, COL.amberHi); lg.addColorStop(0.16, COL.amber);
    lg.addColorStop(0.62, COL.amberDeep); lg.addColorStop(1, COL.dark);
    ctx.fillStyle = lg; ctx.fill();

    ctx.save();
    liquidPath(pts); ctx.clip();
    if (spriteBright) ctx.drawImage(spriteBright, 0, 0, W, H);
    for (var j = 0; j < bubbles.length; j++) {
      var b = bubbles[j];
      b.y -= b.sp * dt; b.x += Math.sin(time * 2 + b.ph) * b.drift * dt;
      if (b.y < surfaceY(b.x, time) + 2 || b.x < -6 || b.x > W + 6) { bubbles[j] = makeBubble(false); continue; }
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(245,236,216,0.15)'; ctx.fill();
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.42, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,250,235,0.5)'; ctx.fill();
    }
    ctx.restore();

    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(245,236,216,0.65)'; ctx.stroke();
    for (var m = 0; m < pts.length; m += 2) {
      var px = pts[m][0], py = pts[m][1];
      var rr = 2.4 + Math.sin(px * 0.5 + time * 3) * 1.3 + 1.8;
      ctx.beginPath(); ctx.arc(px, py - 1, Math.max(1, rr), 0, 6.2832);
      ctx.fillStyle = COL.foam + (0.16 + (Math.sin(px * 0.3 + time * 4) * 0.5 + 0.5) * 0.14).toFixed(3) + ')';
      ctx.fill();
    }

    var sh = ctx.createLinearGradient(0, 0, W, H);
    sh.addColorStop(0, 'rgba(255,255,255,0.05)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
  }

  function frame(now) {
    if (!running) return;
    if (!t0) { t0 = now; lastT = now; }
    var time = (now - t0) / 1000; lastTime = time;
    var dt = (now - lastT) / 1000; lastT = now;
    if (dt > 0.05) dt = 0.05;

    if (poured && fillFrac < REST) {
      var p = Math.min(1, (now - pourStart) / 1600);
      fillFrac = REST * (1 - Math.pow(1 - p, 3));
    }
    if ((now - lastInput) > 1400) {
      tiltTarget = Math.sin(time * 0.8) * 0.12 + Math.sin(time * 1.9) * 0.05;
    }
    var acc = (tiltTarget - tilt) * 26 - tiltVel * 4.2;
    tiltVel += acc * dt; tilt += tiltVel * dt;

    paint(time, dt);
    raf = requestAnimationFrame(frame);
  }

  function renderStatic() { fillFrac = REST; tilt = 0; tiltVel = 0; poured = true; paint(0, 0); }
  function beginPour() { if (poured) return; poured = true; pourStart = performance.now(); }

  function start() {
    if (running || prefersReduce) return;
    running = true; t0 = 0; lastT = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  // Hold the pour until the page loader has cleared, so the reveal isn't wasted.
  function whenRevealed(cb) {
    var loader = document.getElementById('loader');
    if (!loader) { cb(); return; }
    var done = false, ticks = 0;
    (function check() {
      if (done) return;
      var cs = window.getComputedStyle(loader);
      if (!document.body.contains(loader) || cs.display === 'none' ||
          cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05 || loader.offsetParent === null) {
        done = true; cb(); return;
      }
      if (++ticks > 300) { done = true; cb(); return; } // ~5s safety
      requestAnimationFrame(check);
    })();
  }

  // ---- inputs -------------------------------------------------------------
  function setTilt(v) { tiltTarget = Math.max(-1, Math.min(1, v)); lastInput = performance.now(); }
  if (!prefersReduce) {
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      setTilt(((e.clientX - r.left) / r.width - 0.5) * 1.1);
    }, { passive: true });

    var attachGyro = function () {
      window.addEventListener('deviceorientation', function (e) {
        if (e.gamma == null && e.beta == null) return;
        var ang = (window.screen && screen.orientation && typeof screen.orientation.angle === 'number')
          ? screen.orientation.angle : (window.orientation || 0);
        var v;
        if (ang === 90) v = -(e.beta || 0);
        else if (ang === -90 || ang === 270) v = (e.beta || 0);
        else v = (e.gamma || 0);            // portrait
        setTilt(v / 32);
      }, { passive: true });
    };

    var needsPerm = typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
    if (needsPerm) {
      var hint = document.getElementById('pour-hint');
      var ask = function (e) {
        // ignore taps on the CTA links/buttons (let those navigate normally)
        if (e && e.target && e.target.closest && e.target.closest('a,button')) return;
        DeviceOrientationEvent.requestPermission()
          .then(function (s) { if (s === 'granted') attachGyro(); })
          .catch(function () {})
          .then(function () { if (hint) hint.classList.add('is-hidden'); });
        window.removeEventListener('touchend', ask);
        window.removeEventListener('click', ask);
      };
      if (hint) hint.classList.add('is-show');
      window.addEventListener('touchend', ask);
      window.addEventListener('click', ask);
    } else if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) {
      attachGyro();
    }
  }

  // ---- lifecycle ----------------------------------------------------------
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else if (visible && !prefersReduce) start();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (ents) {
      visible = ents[0].isIntersecting;
      if (visible && !document.hidden) start(); else stop();
    }, { threshold: 0.04 }).observe(hero);
  }

  var onFont = function () {
    textReady = true; buildSprites();
    if (prefersReduce) renderStatic();
    else if (!running) paint(lastTime, 0);
  };
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(onFont);
    document.fonts.load('900 100px "Abril Fatface"').then(onFont).catch(function () {});
  } else { textReady = true; buildSprites(); }

  resize();
  if (prefersReduce) { renderStatic(); }
  else { start(); whenRevealed(beginPour); }
})();
