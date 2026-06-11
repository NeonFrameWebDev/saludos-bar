/* Saludos Bar — "The Pour" hero (v2).
   A pure-canvas ice-cold beer that pours in from above once the loader clears:
   a real height-field liquid that ripples + sloshes (tilt / cursor / taps),
   a falling pour stream with splashing droplets, a foam head that builds and
   settles, carbonation rising from nucleation points, light caustics through the
   glass, a warm bar backlight, glass rim-light, and condensation that streaks down.
   Fills the SALUDOS wordmark as it rises.

   Safe + light: one rAF loop, DPR capped 2, pauses off-screen / tab-hidden,
   wordmark pre-rendered to offscreen sprites, reduced-motion = static full glass.
   No image, no WebGL. */
(function () {
  'use strict';
  var canvas = document.getElementById('pour-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  var hero = canvas.closest('.hero') || canvas.parentNode;
  var prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var COL = {
    bgTop: '#150c04', bgBot: '#1c1107',
    amberHi: '#F0C25E', amber: '#C9912F', amberMid: '#9c6e24', amberDeep: '#5e3f18', dark: '#241606',
    cream: '#F6ECCF', foam: '245,237,214'
  };

  // ---- state --------------------------------------------------------------
  var W = 0, H = 0, DPR = 1;
  var raf = null, running = false, t0 = 0, lastT = 0, lastTime = 0, visible = true;

  var REST = 0.76;
  var fillFrac = 0;
  var poured = false, pouring = false, streamA = 0;   // streamA: stream visibility 0..1

  // height-field ripple sim (fine surface motion); bulk tilt handled by a spring
  var N = 80;
  var hh = [], vv = [], foam = [];
  var tiltTarget = 0, tilt = 0, tiltVel = 0, lastInput = -1e9;

  // particles
  var bubbles = [], drops = [], cond = [], nucle = [];
  var MAXBUB = 40, MAXDROP = 60, MAXCOND = 26;

  var textReady = false, spriteBright = null, spriteDim = null;

  function initField() {
    N = Math.max(60, Math.min(200, Math.round(W / 6)));
    hh = new Array(N); vv = new Array(N); foam = new Array(N);
    for (var i = 0; i < N; i++) { hh[i] = 0; vv[i] = 0; foam[i] = 0; }
    nucle = [];
    var sites = Math.max(3, Math.round(W / 220));
    for (var s = 0; s < sites; s++) nucle.push({ x: (0.12 + 0.76 * Math.random()) * W, rate: 0.4 + Math.random() * 0.8, acc: 0 });
  }

  function buildSprites() {
    if (W < 2 || H < 2) return;
    // place SALUDOS in the clear band above the DOM hero content so it is never covered
    var content = hero.querySelector('.hero__content');
    var ctop = H * 0.58;
    if (content) {
      var hr = hero.getBoundingClientRect(), cr = content.getBoundingClientRect();
      if (cr.height) ctop = cr.top - hr.top;
    }
    var navSafe = 78;
    var band = Math.max(40, ctop - navSafe);
    var fs = Math.min(W * 0.175, H * 0.205, band * 0.66);
    var cx = W / 2;
    var cy = Math.max(H * 0.17, Math.min(H * 0.42, navSafe + band * 0.5));
    function mk(paintWord) {
      var c = document.createElement('canvas');
      c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
      var g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.font = '900 ' + fs + 'px "Abril Fatface", Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      paintWord(g, cx, cy, fs);
      return c;
    }
    spriteBright = mk(function (g) {
      g.shadowColor = 'rgba(240,200,100,0.6)'; g.shadowBlur = 26;
      g.fillStyle = COL.cream; g.fillText('SALUDOS', cx, cy);
      g.shadowBlur = 0; g.lineWidth = Math.max(1, fs * 0.01);
      g.strokeStyle = 'rgba(255,245,220,0.5)'; g.strokeText('SALUDOS', cx, cy);
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
    initField();
    if (textReady) buildSprites();
    if (!running) { if (prefersReduce) renderStatic(); else paint(lastTime, 0); }
  }

  // ---- helpers ------------------------------------------------------------
  function baseY() { return H * (1 - fillFrac); }
  function surfaceYpx(x) {
    var f = x / W * (N - 1); if (f < 0) f = 0; if (f > N - 1) f = N - 1;
    var i = f | 0, fr = f - i, a = hh[i], b = hh[i + 1 < N ? i + 1 : i];
    return baseY() + tilt * (x - W / 2) * 0.22 + (a + (b - a) * fr);
  }
  function foamAt(x) {
    var f = x / W * (N - 1); if (f < 0) f = 0; if (f > N - 1) f = N - 1;
    var i = f | 0, fr = f - i, a = foam[i], b = foam[i + 1 < N ? i + 1 : i];
    return a + (b - a) * fr;
  }
  function impulse(x, force, spread) {
    var c = Math.round(x / W * (N - 1));
    for (var j = -spread; j <= spread; j++) {
      var idx = c + j; if (idx < 0 || idx >= N) continue;
      vv[idx] += force * (1 - Math.abs(j) / (spread + 1));
    }
  }
  function addFoam(x, amt, spread) {
    var c = Math.round(x / W * (N - 1));
    for (var j = -spread; j <= spread; j++) {
      var idx = c + j; if (idx < 0 || idx >= N) continue;
      foam[idx] = Math.min(46, foam[idx] + amt * (1 - Math.abs(j) / (spread + 1)));
    }
  }
  function makeBubble(x) {
    return { x: (x == null ? Math.random() * W : x + (Math.random() - 0.5) * 8),
      y: H - 4 - Math.random() * 6, r: 0.8 + Math.random() * 2.6,
      sp: 18 + Math.random() * 40, ph: Math.random() * 6.283, w: 0.4 + Math.random() * 1.1 };
  }
  function makeCond() {
    return { x: 6 + Math.random() * (W - 12), y: H * (0.06 + Math.random() * 0.5),
      r: 1.2 + Math.random() * 2.6, vy: 0, slide: false, life: 0, trail: 0 };
  }

  // ---- simulation ---------------------------------------------------------
  function step(time, dt) {
    // bulk tilt spring (the body sloshes)
    if ((performance.now() - lastInput) > 1500) {
      tiltTarget = Math.sin(time * 0.7) * 0.10 + Math.sin(time * 1.7) * 0.04;
    }
    tiltVel += ((tiltTarget - tilt) * 24 - tiltVel * 4.0) * dt;
    tilt += tiltVel * dt;

    // pour: stream adds volume + churns the surface where it lands
    var sx = W * 0.5 + tilt * W * 0.05 + Math.sin(time * 1.3) * W * 0.012;
    if (pouring) {
      fillFrac += (REST / 1.55) * dt;
      streamA = Math.min(1, streamA + dt * 6);
      impulse(sx, -7 * dt * 60 * 0.016, 2);
      addFoam(sx, 60 * dt, 3);
      if (Math.random() < 0.5 && drops.length < MAXDROP) {
        drops.push({ x: sx + (Math.random() - 0.5) * 18, y: surfaceYpx(sx) - 4,
          vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 90 });
      }
      if (fillFrac >= REST) { fillFrac = REST; pouring = false; }
    } else if (streamA > 0) {
      streamA = Math.max(0, streamA - dt * 2.2);
    }

    // height-field wave propagation (reflective edges)
    var i;
    for (i = 1; i < N - 1; i++) vv[i] += (hh[i - 1] + hh[i + 1] - 2 * hh[i]) * 0.30;
    vv[0] = vv[1]; vv[N - 1] = vv[N - 2];
    for (i = 0; i < N; i++) { hh[i] += vv[i] * dt * 60 * 0.016 * 3.2; vv[i] *= 0.96; hh[i] *= 0.992; foam[i] *= Math.pow(0.55, dt); }
    // tiny foam spread
    for (i = 1; i < N - 1; i++) foam[i] += (foam[i - 1] + foam[i + 1] - 2 * foam[i]) * 0.12;

    // carbonation
    for (var nk = 0; nk < nucle.length; nk++) {
      var nu = nucle[nk]; nu.acc += dt * nu.rate * (pouring ? 3 : 6);
      while (nu.acc >= 1 && bubbles.length < MAXBUB) { nu.acc -= 1; bubbles.push(makeBubble(nu.x)); }
    }
    for (i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i]; b.sp += 14 * dt; b.y -= b.sp * dt; b.x += Math.sin(time * 3 + b.ph) * b.w;
      if (b.y <= surfaceYpx(b.x) + 1) { impulse(b.x, -b.r * 0.5, 1); addFoam(b.x, b.r * 1.6, 1); bubbles.splice(i, 1); }
    }

    // splash droplets
    for (i = drops.length - 1; i >= 0; i--) {
      var d = drops[i]; d.vy += 520 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.vy > 0 && d.y >= surfaceYpx(d.x)) { impulse(d.x, 3.5, 1); addFoam(d.x, 5, 1); drops.splice(i, 1); }
      else if (d.x < -10 || d.x > W + 10) drops.splice(i, 1);
    }

    // condensation (foreground glass)
    if (cond.length < MAXCOND && Math.random() < dt * 6) cond.push(makeCond());
    for (i = cond.length - 1; i >= 0; i--) {
      var cd = cond[i]; cd.life += dt;
      if (!cd.slide) { cd.r += dt * 0.6; if (cd.r > 3 && Math.random() < dt * 0.8) cd.slide = true; }
      else { cd.vy += 60 * dt; cd.y += cd.vy * dt; cd.trail = Math.min(60, cd.trail + cd.vy * dt); }
      if (cd.y > H + 12) cond.splice(i, 1);
    }
  }

  // ---- render -------------------------------------------------------------
  function surfacePts() {
    var pts = [], step = Math.max(4, W / 140);
    for (var x = 0; x <= W; x += step) pts.push([x, surfaceYpx(x)]);
    pts.push([W, surfaceYpx(W)]);
    return pts;
  }
  function liquidPath(pts) {
    ctx.beginPath(); ctx.moveTo(0, H + 2); ctx.lineTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(W, H + 2); ctx.closePath();
  }

  function paint(time, dt) {
    // background + warm bar backlight + vignette
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COL.bgTop); g.addColorStop(1, COL.bgBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var bl = ctx.createRadialGradient(W / 2, H * 0.36, H * 0.04, W / 2, H * 0.42, H * 0.7);
    bl.addColorStop(0, 'rgba(225,150,60,0.16)'); bl.addColorStop(0.5, 'rgba(120,60,150,0.08)'); bl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bl; ctx.fillRect(0, 0, W, H);

    if (spriteDim) ctx.drawImage(spriteDim, 0, 0, W, H);

    var pts = surfacePts();
    var sx = W * 0.5 + tilt * W * 0.05 + Math.sin(time * 1.3) * W * 0.012;

    // pour stream (single wavy path, one gradient) diving into the surface
    if (streamA > 0.01) {
      var sy = surfaceYpx(sx) + 4, syd = sy || 1;
      ctx.save(); ctx.globalAlpha = streamA;
      var sw = Math.max(4, W * 0.013);
      var sg = ctx.createLinearGradient(sx - sw, 0, sx + sw, 0);
      sg.addColorStop(0, 'rgba(150,100,35,0)'); sg.addColorStop(0.5, COL.amberHi); sg.addColorStop(1, 'rgba(150,100,35,0)');
      ctx.fillStyle = sg; ctx.beginPath();
      var yy, wob;
      for (yy = 0; yy <= sy; yy += 8) { wob = Math.sin(yy * 0.05 + time * 16) * 2.2 * (yy / syd); ctx.lineTo(sx + wob - sw, yy); }
      for (yy = sy; yy >= 0; yy -= 8) { wob = Math.sin(yy * 0.05 + time * 16) * 2.2 * (yy / syd); ctx.lineTo(sx + wob + sw, yy); }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();
    }

    // body of the drink
    liquidPath(pts);
    var top = baseY();
    var lg = ctx.createLinearGradient(0, top - 14, 0, H);
    lg.addColorStop(0, COL.amberHi); lg.addColorStop(0.12, COL.amber);
    lg.addColorStop(0.45, COL.amberMid); lg.addColorStop(0.78, COL.amberDeep); lg.addColorStop(1, COL.dark);
    ctx.fillStyle = lg; ctx.fill();

    // submerged word + caustics + bubbles, clipped to the liquid
    ctx.save();
    liquidPath(pts); ctx.clip();
    if (spriteBright) ctx.drawImage(spriteBright, 0, 0, W, H);
    // caustics: drifting light bands
    ctx.globalCompositeOperation = 'overlay';
    for (var cb = 0; cb < 3; cb++) {
      var cy2 = top + (0.25 + cb * 0.26) * (H - top) + Math.sin(time * 0.9 + cb) * 16;
      var cg = ctx.createLinearGradient(0, cy2 - 30, 0, cy2 + 30);
      cg.addColorStop(0, 'rgba(255,240,200,0)'); cg.addColorStop(0.5, 'rgba(255,240,200,0.10)'); cg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = cg; ctx.fillRect(0, cy2 - 30, W, 60);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (var j = 0; j < bubbles.length; j++) {
      var b = bubbles[j];
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(245,237,214,0.16)'; ctx.fill();
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.42, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,250,235,0.55)'; ctx.fill();
    }
    ctx.restore();

    // foam head on the surface (single path, one fill)
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var fb = 1; fb < pts.length; fb++) ctx.lineTo(pts[fb][0], pts[fb][1]);
    for (var ft = pts.length - 1; ft >= 0; ft--) ctx.lineTo(pts[ft][0], pts[ft][1] - foamAt(pts[ft][0]));
    ctx.closePath();
    var fg = ctx.createLinearGradient(0, baseY() - 34, 0, baseY() + 6);
    fg.addColorStop(0, 'rgba(' + COL.foam + ',0.0)');
    fg.addColorStop(0.5, 'rgba(' + COL.foam + ',0.9)');
    fg.addColorStop(1, 'rgba(' + COL.foam + ',0.6)');
    ctx.fillStyle = fg; ctx.fill();
    // surface highlight + foam fizz
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(246,236,207,0.7)'; ctx.stroke();
    for (var m = 0; m < pts.length; m += 2) {
      var px = pts[m][0], py = pts[m][1] - foamAt(px) * 0.5;
      var rr = 1.4 + (Math.sin(px * 0.3 + time * 4) * 0.5 + 0.5) * 2.2;
      ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832);
      ctx.fillStyle = 'rgba(' + COL.foam + ',' + (0.2 + (Math.sin(px + time * 5) * 0.5 + 0.5) * 0.2).toFixed(3) + ')';
      ctx.fill();
    }

    // splash droplets
    for (var di = 0; di < drops.length; di++) {
      var d = drops[di];
      ctx.beginPath(); ctx.arc(d.x, d.y, 1.6, 0, 6.2832);
      ctx.fillStyle = 'rgba(240,200,120,0.85)'; ctx.fill();
    }

    // glass rim light (suggests a curved glass) + top sheen
    var rimW = Math.max(14, W * 0.05);
    var rl = ctx.createLinearGradient(0, 0, rimW, 0);
    rl.addColorStop(0, 'rgba(255,244,214,0.10)'); rl.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = rl; ctx.fillRect(0, 0, rimW, H);
    var rr2 = ctx.createLinearGradient(W - rimW, 0, W, 0);
    rr2.addColorStop(0, 'rgba(255,244,214,0)'); rr2.addColorStop(1, 'rgba(255,244,214,0.08)');
    ctx.fillStyle = rr2; ctx.fillRect(W - rimW, 0, rimW, H);

    // condensation on the glass (foreground)
    for (var ci = 0; ci < cond.length; ci++) {
      var cd = cond[ci];
      if (cd.trail > 1) {
        var tg = ctx.createLinearGradient(0, cd.y - cd.trail, 0, cd.y);
        tg.addColorStop(0, 'rgba(220,230,235,0)'); tg.addColorStop(1, 'rgba(220,230,235,0.10)');
        ctx.fillStyle = tg; ctx.fillRect(cd.x - cd.r * 0.5, cd.y - cd.trail, cd.r, cd.trail);
      }
      ctx.beginPath(); ctx.arc(cd.x, cd.y, cd.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(210,222,228,0.22)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cd.x - cd.r * 0.3, cd.y - cd.r * 0.3, cd.r * 0.4, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    }

    var sh = ctx.createLinearGradient(0, 0, W, H);
    sh.addColorStop(0, 'rgba(255,255,255,0.045)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
  }

  function frame(now) {
    if (!running) return;
    if (!t0) { t0 = now; lastT = now; }
    var time = (now - t0) / 1000; lastTime = time;
    var dt = (now - lastT) / 1000; lastT = now;
    if (dt > 0.05) dt = 0.05;
    step(time, dt);
    paint(time, dt);
    raf = requestAnimationFrame(frame);
  }

  function renderStatic() {
    fillFrac = REST; tilt = 0; tiltVel = 0; poured = true; pouring = false; streamA = 0;
    for (var i = 0; i < N; i++) { hh[i] = 0; vv[i] = 0; foam[i] = 6 + Math.sin(i) * 2; }
    paint(0, 0);
  }
  function beginPour() { if (poured) return; poured = true; pouring = true; }

  function start() { if (running || prefersReduce) return; running = true; t0 = 0; lastT = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  function whenRevealed(cb) {
    var loader = document.getElementById('loader');
    if (!loader) { cb(); return; }
    var done = false, ticks = 0;
    (function check() {
      if (done) return;
      var cs = window.getComputedStyle(loader);
      if (!document.body.contains(loader) || cs.display === 'none' || cs.visibility === 'hidden' ||
          parseFloat(cs.opacity) < 0.05 || loader.offsetParent === null) { done = true; cb(); return; }
      if (++ticks > 300) { done = true; cb(); return; }
      requestAnimationFrame(check);
    })();
  }

  // ---- inputs -------------------------------------------------------------
  function setTilt(v) { tiltTarget = Math.max(-1, Math.min(1, v)); lastInput = performance.now(); }
  function ripple(clientX, clientY) {
    var r = hero.getBoundingClientRect();
    var x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || x > r.width) return;
    if (y > surfaceYpx(x) - 12) { impulse(x, 14, 3); addFoam(x, 8, 2); }
    else if (drops.length < MAXDROP) { drops.push({ x: x, y: y, vx: (Math.random() - 0.5) * 60, vy: 30 }); }
  }
  if (!prefersReduce) {
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      setTilt(((e.clientX - r.left) / r.width - 0.5) * 1.1);
    }, { passive: true });
    hero.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('a,button')) return;
      ripple(e.clientX, e.clientY);
    }, { passive: true });

    var attachGyro = function () {
      window.addEventListener('deviceorientation', function (e) {
        if (e.gamma == null && e.beta == null) return;
        var ang = (window.screen && screen.orientation && typeof screen.orientation.angle === 'number')
          ? screen.orientation.angle : (window.orientation || 0);
        var v;
        if (ang === 90) v = -(e.beta || 0);
        else if (ang === -90 || ang === 270) v = (e.beta || 0);
        else v = (e.gamma || 0);
        setTilt(v / 30);
      }, { passive: true });
    };
    var needsPerm = typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
    if (needsPerm) {
      var hint = document.getElementById('pour-hint');
      var ask = function (e) {
        if (e && e.target && e.target.closest && e.target.closest('a,button')) return;
        DeviceOrientationEvent.requestPermission()
          .then(function (s) { if (s === 'granted') attachGyro(); })
          .catch(function () {})
          .then(function () { if (hint) hint.classList.add('is-hidden'); });
        window.removeEventListener('touchend', ask); window.removeEventListener('click', ask);
      };
      if (hint) hint.classList.add('is-show');
      window.addEventListener('touchend', ask); window.addEventListener('click', ask);
    } else {
      attachGyro();   // Android / older iOS need no permission; harmless if no sensor exists
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
    if (prefersReduce) renderStatic(); else if (!running) paint(lastTime, 0);
  };
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(onFont);
    document.fonts.load('900 100px "Abril Fatface"').then(onFont).catch(function () {});
  } else { textReady = true; }

  resize();
  if (prefersReduce) { renderStatic(); }
  else { start(); whenRevealed(beginPour); }
})();
