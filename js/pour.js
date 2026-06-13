/* Saludos Bar — hero "Big Cup Slam & Pour" (v4).
   A giant full-width glass SLAMS down (shake + squash + shockwave + dust + flash),
   then beer floods in from the top across the whole width, SALUDOS fills with beer
   as the level rises past it, and a foam head crests the surface. The beer is a
   height-field liquid that sloshes with tilt (gyro / cursor) and ripples on tap.

   Light + safe: one rAF loop, DPR capped 2, pauses off-screen / tab-hidden, the
   wordmark is pre-rendered to sprites, reduced-motion = static already-full glass. */
(function () {
  'use strict';
  var canvas = document.getElementById('pour-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  var hero = canvas.closest('.hero') || canvas.parentNode;
  var prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var COL = {
    bgTop: '#140b03', bgBot: '#1d1208',
    amberHi: '#FFD56B', amber: '#E0A23A', amberMid: '#A9761F', amberDeep: '#5e3f18', dark: '#241606',
    cream: '#FBF1D6', foam: '248,240,220', glass: '255,247,224'
  };

  var W = 0, H = 0, DPR = 1;
  var raf = null, running = false, t0 = 0, lastT = 0, lastTime = 0, visible = true, revealed = false;

  // sequence
  var phase = 'fall', phaseT = 0;
  var slamY = 0, slamV = 0, bounces = 0;
  var squash = 0, squashV = 0, shake = 0, flash = 0;
  var shock = -1;                  // shockwave radius (-1 = inactive)
  var beerFrac = 0, pouring = false, streamA = 0;
  var BEER_MAX = 0.95;

  // geometry
  var rimY = 0, topLevel = 0;

  // beer surface field + tilt spring
  var N = 100, hh = [], vv = [], foam = [];
  var tiltTarget = 0, tilt = 0, tiltVel = 0, lastInput = -1e9, waveAmp = 0;

  // particles
  var bubbles = [], drops = [], cond = [], dust = [];
  var MAXBUB = 54, MAXDROP = 70, MAXCOND = 26;

  var textReady = false, spriteBright = null, spriteDim = null;
  var gBg, gBack, gShadow, gRimL, gRimR, gSheen, rimW = 0;   // cached static gradients
  var LOWEND = window.matchMedia('(pointer: coarse)').matches; // skip costliest effects on touch/mobile
  var calm = false, lastBsyR = -1e9, gBeer = null, gFoam = null; // cached beer/foam gradients

  function computeGeo() {
    var content = hero.querySelector('.hero__content');
    var ctop = H * 0.6;
    if (content) { var hr = hero.getBoundingClientRect(), cr = content.getBoundingClientRect(); if (cr.height) ctop = cr.top - hr.top; }
    rimY = Math.max(64, H * 0.13);
    topLevel = rimY + 14;
    return { ctop: ctop };
  }
  function initField() {
    N = Math.max(60, Math.min(220, Math.round(W / 6)));
    hh = new Array(N); vv = new Array(N); foam = new Array(N);
    for (var i = 0; i < N; i++) { hh[i] = 0; vv[i] = 0; foam[i] = 0; }
  }

  function buildSprites() {
    if (W < 2 || H < 2) return;
    var g0 = computeGeo();
    var band = Math.max(60, g0.ctop - rimY);
    var fs = Math.min(W * 0.205, H * 0.2, band * 0.7);
    var down = W < 640 ? 0.78 : 0.66;   // sit lower on mobile
    var cx = W / 2, cy = Math.max(rimY + fs * 0.6, Math.min(g0.ctop - fs * 0.5, rimY + band * down));
    function mk(draw) {
      var c = document.createElement('canvas'); c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
      var g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.font = '900 ' + fs + 'px "Abril Fatface", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      draw(g, cx, cy, fs); return c;
    }
    spriteBright = mk(function (g) {
      /* Dark halo first — makes cream legible against amber on any screen */
      g.shadowColor = 'rgba(10,4,0,0.92)'; g.shadowBlur = Math.max(18, fs * 0.12);
      g.fillStyle = COL.cream; g.fillText('SALUDOS', cx, cy);
      /* Second pass: soft amber inner glow on top */
      g.shadowColor = 'rgba(255,210,110,0.45)'; g.shadowBlur = Math.max(6, fs * 0.04);
      g.fillStyle = 'rgba(251,241,214,0.55)'; g.fillText('SALUDOS', cx, cy);
      g.shadowBlur = 0;
      g.lineWidth = Math.max(1.5, fs * 0.01); g.strokeStyle = 'rgba(255,250,230,0.6)'; g.strokeText('SALUDOS', cx, cy);
    });
    spriteDim = mk(function (g) {
      /* Lifted so SALUDOS reads on dark background before beer rises */
      g.lineWidth = Math.max(1.5, fs * 0.015); g.strokeStyle = 'rgba(240,224,190,0.45)'; g.fillStyle = 'rgba(240,224,190,0.18)';
      g.fillText('SALUDOS', cx, cy); g.strokeText('SALUDOS', cx, cy);
    });
  }

  function buildGradients() {
    if (W < 2 || H < 2) return;
    gBg = ctx.createLinearGradient(0, 0, 0, H); gBg.addColorStop(0, COL.bgTop); gBg.addColorStop(1, COL.bgBot);
    gBack = ctx.createRadialGradient(W / 2, H * 0.33, H * 0.04, W / 2, H * 0.42, H * 0.78);
    gBack.addColorStop(0, 'rgba(235,160,60,0.18)'); gBack.addColorStop(0.5, 'rgba(120,60,150,0.07)'); gBack.addColorStop(1, 'rgba(0,0,0,0)');
    gShadow = ctx.createLinearGradient(0, H - 18, 0, H); gShadow.addColorStop(0, 'rgba(0,0,0,0)'); gShadow.addColorStop(1, 'rgba(0,0,0,0.5)');
    rimW = Math.max(16, W * 0.06);
    gRimL = ctx.createLinearGradient(0, 0, rimW, 0); gRimL.addColorStop(0, 'rgba(' + COL.glass + ',0.42)'); gRimL.addColorStop(1, 'rgba(' + COL.glass + ',0)');
    gRimR = ctx.createLinearGradient(W - rimW, 0, W, 0); gRimR.addColorStop(0, 'rgba(' + COL.glass + ',0)'); gRimR.addColorStop(1, 'rgba(' + COL.glass + ',0.42)');
    gSheen = ctx.createLinearGradient(0, 0, W, H); gSheen.addColorStop(0, 'rgba(255,255,255,0.05)'); gSheen.addColorStop(0.45, 'rgba(255,255,255,0)');
  }

  function buildBeerGrads(bsy) {
    gBeer = ctx.createLinearGradient(0, bsy - 14, 0, H);
    gBeer.addColorStop(0, COL.amberHi); gBeer.addColorStop(0.12, COL.amber); gBeer.addColorStop(0.46, COL.amberMid); gBeer.addColorStop(0.8, COL.amberDeep); gBeer.addColorStop(1, COL.dark);
    gFoam = ctx.createLinearGradient(0, bsy - 56, 0, bsy + 6);
    gFoam.addColorStop(0, 'rgba(' + COL.foam + ',0)'); gFoam.addColorStop(0.5, 'rgba(' + COL.foam + ',0.94)'); gFoam.addColorStop(1, 'rgba(' + COL.foam + ',0.66)');
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * DPR)); canvas.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    computeGeo(); initField(); buildGradients(); lastBsyR = -1e9;
    if (textReady) buildSprites();
    if (!running) { if (prefersReduce) renderStatic(); else paint(lastTime, 0); }
  }

  // ---- helpers ------------------------------------------------------------
  function restSurface() { return H - beerFrac * (H - topLevel); }
  function colX(i) { return (i / (N - 1)) * W; }
  function swave(x) { return waveAmp ? (Math.sin(x * 0.013 + lastTime * 2.2) + Math.sin(x * 0.031 - lastTime * 3.1) * 0.45) * waveAmp : 0; }
  function surfAt(i) { var x = colX(i); return restSurface() + tilt * (x - W / 2) * 0.22 + hh[i] + swave(x); }
  function surfAtX(x) { var f = x / W * (N - 1); if (f < 0) f = 0; if (f > N - 1) f = N - 1; var i = f | 0, fr = f - i, a = hh[i], b = hh[i + 1 < N ? i + 1 : i]; return restSurface() + tilt * (x - W / 2) * 0.22 + (a + (b - a) * fr) + swave(x); }
  function xToCol(x) { return Math.round(x / W * (N - 1)); }
  function impulse(i, force, spread) { for (var j = -spread; j <= spread; j++) { var k = i + j; if (k < 0 || k >= N) continue; vv[k] += force * (1 - Math.abs(j) / (spread + 1)); } }
  function addFoam(i, amt, spread) { for (var j = -spread; j <= spread; j++) { var k = i + j; if (k < 0 || k >= N) continue; foam[k] = Math.min(66, foam[k] + amt * (1 - Math.abs(j) / (spread + 1))); } }
  function foamAt(x) { var f = x / W * (N - 1); if (f < 0) f = 0; if (f > N - 1) f = N - 1; var i = f | 0, fr = f - i, a = foam[i], b = foam[i + 1 < N ? i + 1 : i]; return a + (b - a) * fr; }

  function doImpact(v) {
    squashV -= Math.min(0.42, v / 3200); shake = Math.min(9, v / 300); flash = 1; shock = 0;
    for (var i = 0; i < 22; i++) {
      var side = Math.random() < 0.5 ? -1 : 1;
      dust.push({ x: W * (0.15 + 0.7 * Math.random()), y: H, vx: side * (60 + Math.random() * 260), vy: -40 - Math.random() * 220, r: 2 + Math.random() * 7, life: 0, max: 0.55 + Math.random() * 0.5 });
    }
  }

  // ---- simulation ---------------------------------------------------------
  function step(time, dt) {
    if (!revealed) return;
    if ((performance.now() - lastInput) > 1500) tiltTarget = Math.sin(time * 0.7) * 0.08 + Math.sin(time * 1.7) * 0.03;
    tiltVel += ((tiltTarget - tilt) * 22 - tiltVel * 4.0) * dt; tilt += tiltVel * dt;
    var wtgt = Math.min(16, Math.abs(tiltVel) * 12); waveAmp += (wtgt - waveAmp) * Math.min(1, dt * 5);
    calm = (phase === 'idle') && (performance.now() - lastInput > 2500) && Math.abs(tiltVel) < 0.015 && waveAmp < 0.6;

    if (phase === 'fall') {
      slamV += 3400 * dt; slamY += slamV * dt;
      if (slamY >= 0) {
        slamY = 0; doImpact(slamV); slamV = 0; phase = 'prepour'; phaseT = time;
      }
    } else if (phase === 'prepour') { if (time - phaseT > 0.3) { phase = 'pour'; pouring = true; } }

    squashV += (-squash * 260 - squashV * 23) * dt; squash += squashV * dt;
    shake *= Math.pow(0.0006, dt); if (shake < 0.2) shake = 0;
    flash = Math.max(0, flash - dt * 3.2);
    if (shock >= 0) { shock += dt * W * 2.2; if (shock > W * 1.1) shock = -1; }

    var sx = W * 0.5 + tilt * W * 0.06 + Math.sin(time * 1.2) * W * 0.02, sc = xToCol(sx);
    if (pouring) {
      beerFrac += (BEER_MAX / 2.9) * dt; streamA = Math.min(1, streamA + dt * 6);
      impulse(sc, -0.5, 3); addFoam(sc, 95 * dt, 4);
      if (drops.length < MAXDROP && Math.random() < 0.7) { var crown = Math.random() < 0.5 ? 1 : -1; drops.push({ x: sx + crown * (4 + Math.random() * 10), y: surfAtX(sx) - 4, vx: crown * (40 + Math.random() * 150), vy: -60 - Math.random() * 120 }); }
      if (beerFrac >= BEER_MAX) { beerFrac = BEER_MAX; pouring = false; phase = 'idle'; }
    } else if (streamA > 0) streamA = Math.max(0, streamA - dt * 2.4);

    var i;
    for (i = 1; i < N - 1; i++) vv[i] += (hh[i - 1] + hh[i + 1] - 2 * hh[i]) * 0.32;
    vv[0] = vv[1]; vv[N - 1] = vv[N - 2];
    var k2 = dt * 60 * 0.05;
    for (i = 0; i < N; i++) { hh[i] += vv[i] * k2; vv[i] *= 0.955; hh[i] *= 0.992; foam[i] *= Math.pow(0.7, dt); }
    for (i = 1; i < N - 1; i++) foam[i] += (foam[i - 1] + foam[i + 1] - 2 * foam[i]) * 0.12;

    if (beerFrac > 0.05) {
      if (bubbles.length < MAXBUB && Math.random() < dt * (pouring ? 60 : (calm ? 7 : 26))) bubbles.push({ x: Math.random() * W, y: H - 2, r: 0.8 + Math.random() * 2.6, sp: 16 + Math.random() * 42, ph: Math.random() * 6.283, w: 0.3 + Math.random() * 1.0 });
      for (i = bubbles.length - 1; i >= 0; i--) { var b = bubbles[i]; b.sp += 14 * dt; b.y -= b.sp * dt; b.x += Math.sin(time * 3 + b.ph) * b.w; if (b.y <= surfAtX(b.x) + 1) { var bc = xToCol(b.x); impulse(bc, -b.r * 0.4, 1); addFoam(bc, b.r * 1.4, 1); bubbles.splice(i, 1); } }
    }
    for (i = drops.length - 1; i >= 0; i--) { var d = drops[i]; d.vy += 520 * dt; d.x += d.vx * dt; d.y += d.vy * dt; if (d.vy > 0 && d.y >= surfAtX(d.x)) { var dc = xToCol(d.x); impulse(dc, 3, 1); addFoam(dc, 5, 1); drops.splice(i, 1); } else if (d.x < -12 || d.x > W + 12) drops.splice(i, 1); }
    for (i = dust.length - 1; i >= 0; i--) { var du = dust[i]; du.life += dt; du.vy += 360 * dt; du.x += du.vx * dt; du.y += du.vy * dt; du.r += dt * 22; if (du.life > du.max) dust.splice(i, 1); }

    if (phase !== 'fall' && cond.length < MAXCOND && Math.random() < dt * 6) cond.push({ x: 8 + Math.random() * (W - 16), y: rimY + 20 + Math.random() * (H - rimY) * 0.4, r: 1.2 + Math.random() * 2.6, vy: 0, slide: false, trail: 0 });
    for (i = cond.length - 1; i >= 0; i--) { var cd = cond[i]; if (!cd.slide) { cd.r += dt * 0.6; if (cd.r > 3 && Math.random() < dt * 0.7) cd.slide = true; } else { cd.vy += 55 * dt; cd.y += cd.vy * dt; cd.trail = Math.min(70, cd.trail + cd.vy * dt); } if (cd.y > H + 10) cond.splice(i, 1); }
  }

  // ---- render -------------------------------------------------------------
  function surfacePts() { var pts = [], st = Math.max(4, W / 160); for (var x = 0; x <= W; x += st) pts.push([x, surfAtX(x)]); pts.push([W, surfAtX(W)]); return pts; }

  function paint(time, dt) {
    if (!gBg) buildGradients();
    // bg + warm backlight (cached)
    ctx.fillStyle = gBg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = gBack; ctx.fillRect(0, 0, W, H);

    if (spriteDim) ctx.drawImage(spriteDim, 0, 0, W, H);

    // glass shadow (screen space, cached)
    ctx.fillStyle = gShadow; ctx.fillRect(0, H - 18, W, 18);

    // ---- slam transform (translate + squash + shake) on the whole cup ----
    var jx = shake ? Math.sin(time * 42) * shake : 0, jy = shake ? Math.cos(time * 34) * shake * 0.55 : 0;
    ctx.save();
    ctx.translate(jx, slamY + jy);
    ctx.translate(0, H); ctx.scale(1 - squash * 0.1, 1 + squash * 0.6); ctx.translate(0, -H);

    // cup interior (dark) above the beer
    ctx.fillStyle = 'rgba(34,22,10,0.5)'; ctx.fillRect(0, rimY, W, H - rimY);

    var pts = surfacePts();

    // pour stream
    if (streamA > 0.01) {
      var sx = W * 0.5 + tilt * W * 0.06 + Math.sin(time * 1.2) * W * 0.02;
      var sy = surfAtX(sx) + 4, sTop = rimY - 30, syd = (sy - sTop) || 1;
      ctx.save(); ctx.globalAlpha = streamA;
      var sw = Math.max(5, W * 0.022);
      var sg = ctx.createLinearGradient(sx - sw, 0, sx + sw, 0); sg.addColorStop(0, 'rgba(160,110,40,0)'); sg.addColorStop(0.5, COL.amberHi); sg.addColorStop(1, 'rgba(160,110,40,0)');
      ctx.fillStyle = sg; ctx.beginPath(); var yy, wob;
      for (yy = sTop; yy <= sy; yy += 8) { wob = Math.sin(yy * 0.05 + time * 18) * 2.4 * ((yy - sTop) / syd); ctx.lineTo(sx + wob - sw, yy); }
      for (yy = sy; yy >= sTop; yy -= 8) { wob = Math.sin(yy * 0.05 + time * 18) * 2.4 * ((yy - sTop) / syd); ctx.lineTo(sx + wob + sw, yy); }
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.restore();
    }

    if (beerFrac > 0.001) {
      // beer body
      ctx.beginPath(); ctx.moveTo(0, H + 2); ctx.lineTo(pts[0][0], pts[0][1]);
      for (var ci = 1; ci < pts.length; ci++) ctx.lineTo(pts[ci][0], pts[ci][1]);
      ctx.lineTo(W, H + 2); ctx.closePath();
      var bsy = restSurface();
      var bsyR = Math.round(bsy); if (bsyR !== lastBsyR) { buildBeerGrads(bsy); lastBsyR = bsyR; }
      ctx.save(); ctx.fillStyle = gBeer; ctx.fill();
      // clip to beer for word + caustics + bubbles
      ctx.clip();
      if (spriteBright) ctx.drawImage(spriteBright, 0, 0, W, H);
      for (var bi = 0; bi < bubbles.length; bi++) { var b = bubbles[bi]; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832); ctx.fillStyle = 'rgba(248,240,220,0.16)'; ctx.fill(); ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.42, 0, 6.2832); ctx.fillStyle = 'rgba(255,250,235,0.55)'; ctx.fill(); }
      ctx.restore();

      // foam head (single path) cresting the surface
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var f1 = 1; f1 < pts.length; f1++) ctx.lineTo(pts[f1][0], pts[f1][1]);
      for (var f2 = pts.length - 1; f2 >= 0; f2--) ctx.lineTo(pts[f2][0], pts[f2][1] - (20 + foamAt(pts[f2][0])));
      ctx.closePath();
      ctx.fillStyle = gFoam; ctx.fill();
      var FIZZ = LOWEND ? 22 : 46, fstep = Math.max(2, Math.floor(pts.length / FIZZ));
      ctx.fillStyle = 'rgba(' + COL.foam + ',0.32)';
      for (var m = 0; m < pts.length; m += fstep) { var px = pts[m][0], py = pts[m][1] - (14 + foamAt(px)) * 0.6; var rr = 1.3 + (Math.sin(px * 0.3 + time * 4) * 0.5 + 0.5) * 2.2; ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(248,240,220,0.7)'; ctx.stroke();

      for (var di = 0; di < drops.length; di++) { ctx.beginPath(); ctx.arc(drops[di].x, drops[di].y, 1.7, 0, 6.2832); ctx.fillStyle = 'rgba(255,210,130,0.9)'; ctx.fill(); }
    }

    // cup glass framing: side rim-lights + top rim ellipse
    ctx.fillStyle = gRimL; ctx.fillRect(0, rimY, rimW, H - rimY);
    ctx.fillStyle = gRimR; ctx.fillRect(W - rimW, rimY, rimW, H - rimY);
    // rim ellipse (cup mouth)
    ctx.beginPath(); ctx.ellipse(W / 2, rimY, W * 0.5, Math.max(6, H * 0.022), 0, 0, 6.2832);
    ctx.fillStyle = 'rgba(18,11,4,0.4)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(' + COL.glass + ',0.5)'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(W / 2, rimY, W * 0.5, Math.max(6, H * 0.022), 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,250,235,0.5)'; ctx.stroke();

    // condensation
    for (var cdi = 0; cdi < cond.length; cdi++) { var cd = cond[cdi]; if (cd.trail > 1) { var tg = ctx.createLinearGradient(0, cd.y - cd.trail, 0, cd.y); tg.addColorStop(0, 'rgba(220,232,236,0)'); tg.addColorStop(1, 'rgba(220,232,236,0.10)'); ctx.fillStyle = tg; ctx.fillRect(cd.x - cd.r * 0.5, cd.y - cd.trail, cd.r, cd.trail); } ctx.beginPath(); ctx.arc(cd.x, cd.y, cd.r, 0, 6.2832); ctx.fillStyle = 'rgba(210,222,228,0.22)'; ctx.fill(); ctx.beginPath(); ctx.arc(cd.x - cd.r * 0.3, cd.y - cd.r * 0.3, cd.r * 0.4, 0, 6.2832); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill(); }

    ctx.fillStyle = gSheen; ctx.fillRect(0, 0, W, H);

    ctx.restore(); // end slam transform

    // impact shockwave (screen space, along the base)
    if (shock >= 0) { var sa = Math.max(0, 1 - shock / (W * 1.1)) * 0.5; ctx.beginPath(); ctx.ellipse(W / 2, H - 6, shock, shock * 0.18, 0, Math.PI, 0); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,225,160,' + sa.toFixed(3) + ')'; ctx.stroke(); }
    // impact flash
    if (flash > 0.001) { ctx.fillStyle = 'rgba(255,236,200,' + (flash * 0.32).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
  }

  function frame(now) {
    if (!running) return;
    if (!t0) { t0 = now; lastT = now; }
    var time = (now - t0) / 1000; lastTime = time;
    var dt = (now - lastT) / 1000; lastT = now; if (dt > 0.05) dt = 0.05;
    step(time, dt); paint(time, dt);
    raf = requestAnimationFrame(frame);
  }

  function renderStatic() {
    revealed = true; phase = 'idle'; slamY = 0; squash = 0; shake = 0; flash = 0; shock = -1; tilt = 0; tiltVel = 0;
    beerFrac = BEER_MAX; pouring = false; streamA = 0;
    for (var i = 0; i < N; i++) { hh[i] = 0; vv[i] = 0; foam[i] = 20 + Math.sin(i) * 3; }
    paint(0, 0);
  }
  function placeAbove() { phase = 'fall'; slamY = -(H + 80); slamV = 0; bounces = 0; squash = 0; squashV = 0; shake = 0; }

  function start() { if (running || prefersReduce) return; running = true; t0 = 0; lastT = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  function whenRevealed(cb) {
    var loader = document.getElementById('loader'); if (!loader) { cb(); return; }
    var done = false, ticks = 0;
    (function check() { if (done) return; var cs = window.getComputedStyle(loader);
      if (!document.body.contains(loader) || cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05 || loader.offsetParent === null) { done = true; cb(); return; }
      if (++ticks > 300) { done = true; cb(); return; } requestAnimationFrame(check); })();
  }

  // ---- inputs -------------------------------------------------------------
  function setTilt(v) { tiltTarget = Math.max(-1, Math.min(1, v)); lastInput = performance.now(); }
  if (!prefersReduce) {
    hero.addEventListener('mousemove', function (e) { var r = hero.getBoundingClientRect(); setTilt(((e.clientX - r.left) / r.width - 0.5) * 1.1); }, { passive: true });
    hero.addEventListener('pointerdown', function (e) { if (e.target && e.target.closest && e.target.closest('a,button')) return; var r = hero.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (beerFrac > 0.05 && y > surfAtX(x) - 16) { var c = xToCol(x); impulse(c, 13, 3); addFoam(c, 7, 2); } }, { passive: true });
    var attachGyro = function () { window.addEventListener('deviceorientation', function (e) { if (e.gamma == null && e.beta == null) return; var ang = (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0); var v; if (ang === 90) v = -(e.beta || 0); else if (ang === -90 || ang === 270) v = (e.beta || 0); else v = (e.gamma || 0); setTilt(v / 30); }, { passive: true }); };
    var needsPerm = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if (needsPerm) {
      var hint = document.getElementById('pour-hint');
      var ask = function (e) { if (e && e.target && e.target.closest && e.target.closest('a,button')) return; DeviceOrientationEvent.requestPermission().then(function (s) { if (s === 'granted') attachGyro(); }).catch(function () {}).then(function () { if (hint) hint.classList.add('is-hidden'); }); window.removeEventListener('touchend', ask); window.removeEventListener('click', ask); };
      if (hint) hint.classList.add('is-show'); window.addEventListener('touchend', ask); window.addEventListener('click', ask);
    } else { attachGyro(); }
  }

  // ---- lifecycle ----------------------------------------------------------
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (visible && !prefersReduce) start(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (ents) { visible = ents[0].isIntersecting; if (visible && !document.hidden) start(); else stop(); }, { threshold: 0.04 }).observe(hero);

  var onFont = function () { textReady = true; buildSprites(); if (prefersReduce) renderStatic(); else if (!running) paint(lastTime, 0); };
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(onFont); document.fonts.load('900 100px "Abril Fatface"').then(onFont).catch(function () {}); } else { textReady = true; }

  resize();
  if (prefersReduce) { renderStatic(); }
  else { placeAbove(); paint(0, 0); start(); whenRevealed(function () { revealed = true; t0 = 0; placeAbove(); }); }
})();
