/* Saludos Bar — "The Pour" hero (v3: Slam & Pour).
   A real beer glass SLAMS down on the bar (impact shake + dust), THEN beer pours
   in from above and the level rises inside the glass, capped with a foam head that
   crests the rim. The beer is a height-field liquid that ripples + sloshes with tilt
   (gyro on phones / cursor on desktop) and reacts to taps. A dim SALUDOS glows behind.

   Safe + light: one rAF loop, DPR capped 2, pauses off-screen / tab-hidden, the
   wordmark is a pre-rendered sprite, reduced-motion = static already-full glass.
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
    amberHi: '#F2C861', amber: '#CE952F', amberMid: '#9c6e24', amberDeep: '#5e3f18', dark: '#241606',
    cream: '#F6ECCF', foam: '246,238,216', glass: '255,247,224'
  };

  var W = 0, H = 0, DPR = 1;
  var raf = null, running = false, t0 = 0, lastT = 0, lastTime = 0, visible = true;

  // sequence
  var phase = 'fall';          // fall -> prepour -> pour -> idle
  var phaseT = 0, revealed = false;
  var glassYoff = 0, glassVy = 0, bounces = 0;
  var squash = 0, squashV = 0;     // impact squash/stretch spring
  var shake = 0;                   // screen-shake amplitude (decays)
  var beerFrac = 0, pouring = false, streamA = 0;
  var BEER_MAX = 0.9;              // share of interior filled

  // beer surface height-field (ripples) + bulk tilt spring
  var N = 64, hh = [], vv = [], foam = [];
  var tiltTarget = 0, tilt = 0, tiltVel = 0, lastInput = -1e9;

  // particles
  var bubbles = [], drops = [], cond = [], dust = [];
  var MAXBUB = 36, MAXDROP = 50, MAXCOND = 22;

  var textReady = false, sprite = null;

  // ---- glass geometry -----------------------------------------------------
  var G = {};
  function computeGlass() {
    var content = hero.querySelector('.hero__content');
    var ctop = H * 0.62;
    if (content) {
      var hr = hero.getBoundingClientRect(), cr = content.getBoundingClientRect();
      if (cr.height) ctop = cr.top - hr.top;
    }
    var navSafe = 74;
    var barY = Math.min(H * 0.78, Math.max(H * 0.5, ctop - 14));     // the bar surface (glass base)
    var gh = Math.min(H * 0.42, barY - navSafe - 28, 460);
    gh = Math.max(180, gh);
    var topW = Math.min(W * 0.36, gh * 0.66);
    var botW = topW * 0.8;
    G = {
      cx: W / 2, barY: barY, topY: barY - gh, gh: gh,
      topW: topW, botW: botW, wall: Math.max(5, topW * 0.05),
      navSafe: navSafe
    };
  }
  // half-width of the glass interior at absolute y
  function halfAtY(y, outer) {
    var t = (y - G.topY) / G.gh; if (t < 0) t = 0; if (t > 1) t = 1;
    var w = (G.topW + (G.botW - G.topW) * t) / 2;
    return outer ? w : w - G.wall;
  }
  function glassTransform() {
    // squash pivots at the base; shake jitters the whole glass
    var sx = 1 - squash * 0.55, sy = 1 + squash;
    var jx = shake ? (Math.sin(lastTime * 90) * shake) : 0;
    var jy = shake ? (Math.cos(lastTime * 75) * shake * 0.6) : 0;
    ctx.save();
    ctx.translate(G.cx + jx, G.barY + glassYoff + jy);
    ctx.scale(sx, sy);
    ctx.translate(-G.cx, -(G.barY + glassYoff));
  }

  function initField() {
    N = Math.max(36, Math.min(96, Math.round((G.topW || W * 0.3) / 4)));
    hh = new Array(N); vv = new Array(N); foam = new Array(N);
    for (var i = 0; i < N; i++) { hh[i] = 0; vv[i] = 0; foam[i] = 0; }
  }

  function buildSprite() {
    if (W < 2 || H < 2) return;
    var fs = Math.min(W * 0.2, G.topY * 0.62, H * 0.22);
    var cy = Math.max(H * 0.14, G.topY * 0.52);
    var c = document.createElement('canvas');
    c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    var g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.font = '900 ' + fs + 'px "Abril Fatface", Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(240,200,100,0.35)'; g.shadowBlur = 30;
    g.fillStyle = 'rgba(240,210,150,0.10)'; g.fillText('SALUDOS', W / 2, cy);
    g.shadowBlur = 0; g.lineWidth = Math.max(1, fs * 0.012);
    g.strokeStyle = 'rgba(242,200,110,0.22)'; g.strokeText('SALUDOS', W / 2, cy);
    sprite = c;
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    computeGlass(); initField();
    if (textReady) buildSprite();
    if (!running) { if (prefersReduce) renderStatic(); else paint(lastTime, 0); }
  }

  // ---- helpers ------------------------------------------------------------
  function beerSurfaceAbs() {                // absolute y of resting beer surface
    var iTop = G.topY + G.wall, iBot = G.barY - G.wall;
    return iBot - beerFrac * (iBot - iTop);
  }
  function colX(i) { return G.cx - G.topW / 2 + G.wall + (i / (N - 1)) * (G.topW - 2 * G.wall); }
  function surfAt(i) {
    var x = colX(i);
    return beerSurfaceAbs() + tilt * (x - G.cx) * 0.5 + hh[i];
  }
  function impulse(i, force, spread) {
    for (var j = -spread; j <= spread; j++) { var k = i + j; if (k < 0 || k >= N) continue; vv[k] += force * (1 - Math.abs(j) / (spread + 1)); }
  }
  function addFoam(i, amt, spread) {
    for (var j = -spread; j <= spread; j++) { var k = i + j; if (k < 0 || k >= N) continue; foam[k] = Math.min(34, foam[k] + amt * (1 - Math.abs(j) / (spread + 1))); }
  }
  function xToCol(x) { return Math.round(((x - (G.cx - G.topW / 2 + G.wall)) / (G.topW - 2 * G.wall)) * (N - 1)); }

  function doImpact(v) {
    squashV -= Math.min(0.5, v / 2600);
    shake = Math.min(16, v / 150);
    var n = 14;
    for (var i = 0; i < n; i++) {
      var a = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9;
      var sp = 60 + Math.random() * 160;
      dust.push({ x: G.cx + (Math.random() - 0.5) * G.botW, y: G.barY, vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1) * 0.5 + (Math.random() - 0.5) * 120, vy: -Math.random() * 120 - 20, r: 2 + Math.random() * 5, life: 0, max: 0.5 + Math.random() * 0.4 });
    }
  }

  // ---- simulation ---------------------------------------------------------
  function step(time, dt) {
    if (!revealed) return;          // hold everything until the loader has cleared
    // tilt spring
    if ((performance.now() - lastInput) > 1500) tiltTarget = Math.sin(time * 0.7) * 0.09 + Math.sin(time * 1.7) * 0.035;
    tiltVel += ((tiltTarget - tilt) * 22 - tiltVel * 4.0) * dt; tilt += tiltVel * dt;

    // sequence
    if (phase === 'fall') {
      glassVy += 3000 * dt; glassYoff += glassVy * dt;
      if (glassYoff >= 0) {
        glassYoff = 0; doImpact(glassVy);
        if (glassVy > 380 && bounces < 1) { glassVy = -glassVy * 0.24; bounces++; }
        else { glassVy = 0; phase = 'prepour'; phaseT = time; }
        // jolt the (empty) beer field a touch so the first pour churns nicely
      }
    } else if (phase === 'prepour') {
      if (time - phaseT > 0.32) { phase = 'pour'; pouring = true; }
    }

    // squash spring + shake decay
    squashV += (-squash * 240 - squashV * 22) * dt; squash += squashV * dt;
    shake *= Math.pow(0.0008, dt);
    if (shake < 0.15) shake = 0;

    // pour
    var sx = G.cx + tilt * G.topW * 0.12 + Math.sin(time * 1.3) * G.topW * 0.04;
    var sc = xToCol(sx);
    if (pouring) {
      beerFrac += (BEER_MAX / 1.5) * dt;
      streamA = Math.min(1, streamA + dt * 6);
      impulse(sc, -0.45, 2); addFoam(sc, 50 * dt, 3);
      if (Math.random() < 0.5 && drops.length < MAXDROP) drops.push({ x: sx + (Math.random() - 0.5) * 14, y: surfAt(sc) - 4, vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 70 });
      if (beerFrac >= BEER_MAX) { beerFrac = BEER_MAX; pouring = false; phase = 'idle'; }
    } else if (streamA > 0) streamA = Math.max(0, streamA - dt * 2.4);

    // height-field ripples (reflective edges)
    var i;
    for (i = 1; i < N - 1; i++) vv[i] += (hh[i - 1] + hh[i + 1] - 2 * hh[i]) * 0.30;
    vv[0] = vv[1]; vv[N - 1] = vv[N - 2];
    var k2 = dt * 60 * 0.052;
    for (i = 0; i < N; i++) { hh[i] += vv[i] * k2; vv[i] *= 0.95; hh[i] *= 0.99; foam[i] *= Math.pow(0.5, dt); }
    for (i = 1; i < N - 1; i++) foam[i] += (foam[i - 1] + foam[i + 1] - 2 * foam[i]) * 0.12;

    // carbonation (only once there is beer)
    if (beerFrac > 0.08) {
      if (bubbles.length < MAXBUB && Math.random() < dt * (pouring ? 30 : 14)) {
        var bi = 2 + ((Math.random() * (N - 4)) | 0);
        bubbles.push({ i: bi, y: G.barY - G.wall - 2, r: 0.8 + Math.random() * 2.4, sp: 14 + Math.random() * 34, ph: Math.random() * 6.283, w: 0.3 + Math.random() * 0.9 });
      }
      for (i = bubbles.length - 1; i >= 0; i--) {
        var b = bubbles[i]; b.sp += 12 * dt; b.y -= b.sp * dt;
        if (b.y <= surfAt(b.i) + 1) { impulse(b.i, -b.r * 0.4, 1); addFoam(b.i, b.r * 1.4, 1); bubbles.splice(i, 1); }
      }
    }

    // splash droplets
    for (i = drops.length - 1; i >= 0; i--) {
      var d = drops[i]; d.vy += 460 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      var dc = xToCol(d.x);
      if (d.vy > 0 && d.y >= surfAt(Math.max(0, Math.min(N - 1, dc)))) { impulse(dc, 2.5, 1); addFoam(dc, 4, 1); drops.splice(i, 1); }
    }

    // impact dust
    for (i = dust.length - 1; i >= 0; i--) {
      var du = dust[i]; du.life += dt; du.vy += 240 * dt; du.x += du.vx * dt; du.y += du.vy * dt; du.r += dt * 18;
      if (du.life > du.max) dust.splice(i, 1);
    }

    // condensation on the glass (only after it lands)
    if (phase !== 'fall' && cond.length < MAXCOND && Math.random() < dt * 5) {
      var hy = G.topY + G.wall + Math.random() * (G.gh - G.wall) * 0.85;
      cond.push({ x: G.cx + (Math.random() - 0.5) * (halfAtY(hy) * 1.7), y: hy, r: 1.1 + Math.random() * 2.2, vy: 0, slide: false, trail: 0 });
    }
    for (i = cond.length - 1; i >= 0; i--) {
      var cd = cond[i];
      if (!cd.slide) { cd.r += dt * 0.5; if (cd.r > 2.6 && Math.random() < dt * 0.7) cd.slide = true; }
      else { cd.vy += 50 * dt; cd.y += cd.vy * dt; cd.trail = Math.min(50, cd.trail + cd.vy * dt); }
      if (cd.y > G.barY - 2) cond.splice(i, 1);
    }
  }

  // ---- render -------------------------------------------------------------
  function outerPath() {
    var l = G.cx - G.topW / 2, r = G.cx + G.topW / 2, bl = G.cx - G.botW / 2, br = G.cx + G.botW / 2;
    var rad = Math.min(18, G.botW * 0.12);
    ctx.beginPath();
    ctx.moveTo(l, G.topY); ctx.lineTo(bl, G.barY - rad);
    ctx.quadraticCurveTo(bl, G.barY, bl + rad, G.barY);
    ctx.lineTo(br - rad, G.barY); ctx.quadraticCurveTo(br, G.barY, br, G.barY - rad);
    ctx.lineTo(r, G.topY); ctx.closePath();
  }
  function interiorPath() {
    var l = G.cx - G.topW / 2 + G.wall, r = G.cx + G.topW / 2 - G.wall;
    var bl = G.cx - G.botW / 2 + G.wall, br = G.cx + G.botW / 2 - G.wall, iBot = G.barY - G.wall;
    var rad = Math.min(14, G.botW * 0.1);
    ctx.beginPath();
    ctx.moveTo(l, G.topY + G.wall); ctx.lineTo(bl, iBot - rad);
    ctx.quadraticCurveTo(bl, iBot, bl + rad, iBot);
    ctx.lineTo(br - rad, iBot); ctx.quadraticCurveTo(br, iBot, br, iBot - rad);
    ctx.lineTo(r, G.topY + G.wall); ctx.closePath();
  }

  function paint(time, dt) {
    // bg + warm backlight
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COL.bgTop); g.addColorStop(1, COL.bgBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var bl = ctx.createRadialGradient(W / 2, H * 0.34, H * 0.04, W / 2, H * 0.42, H * 0.72);
    bl.addColorStop(0, 'rgba(225,150,60,0.16)'); bl.addColorStop(0.5, 'rgba(120,60,150,0.07)'); bl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bl; ctx.fillRect(0, 0, W, H);

    if (sprite) ctx.drawImage(sprite, 0, 0, W, H);

    // bar surface line + glass shadow
    ctx.save();
    var bg = ctx.createLinearGradient(0, G.barY, 0, G.barY + 3);
    bg.addColorStop(0, 'rgba(246,224,180,0.18)'); bg.addColorStop(1, 'rgba(246,224,180,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, G.barY, W, 3);
    var sh = ctx.createRadialGradient(G.cx, G.barY + 8, 2, G.cx, G.barY + 8, G.botW * 0.95);
    sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(G.cx, G.barY + 8, G.botW * 0.85, 10 + squash * 30, 0, 0, 6.2832); ctx.fill();
    ctx.restore();

    // impact dust (behind glass)
    for (var pdi = 0; pdi < dust.length; pdi++) {
      var du = dust[pdi], a = Math.max(0, 1 - du.life / du.max) * 0.4;
      ctx.beginPath(); ctx.arc(du.x, du.y, du.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(214,196,160,' + a.toFixed(3) + ')'; ctx.fill();
    }

    glassTransform();   // ctx.save + squash/shake transform

    // pour stream (from top into the glass)
    if (streamA > 0.01) {
      var sx = G.cx + tilt * G.topW * 0.12 + Math.sin(time * 1.3) * G.topW * 0.04;
      var sc = Math.max(0, Math.min(N - 1, xToCol(sx)));
      var sy = surfAt(sc) + 3, syd = (sy - (G.topY - 26)) || 1, sTop = G.topY - 26;
      ctx.save(); ctx.globalAlpha = streamA;
      var sw = Math.max(3, G.topW * 0.04);
      var sg = ctx.createLinearGradient(sx - sw, 0, sx + sw, 0);
      sg.addColorStop(0, 'rgba(150,100,35,0)'); sg.addColorStop(0.5, COL.amberHi); sg.addColorStop(1, 'rgba(150,100,35,0)');
      ctx.fillStyle = sg; ctx.beginPath();
      var yy, wob;
      for (yy = sTop; yy <= sy; yy += 8) { wob = Math.sin(yy * 0.05 + time * 16) * 2 * ((yy - sTop) / syd); ctx.lineTo(sx + wob - sw, yy); }
      for (yy = sy; yy >= sTop; yy -= 8) { wob = Math.sin(yy * 0.05 + time * 16) * 2 * ((yy - sTop) / syd); ctx.lineTo(sx + wob + sw, yy); }
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.restore();
    }

    // glass interior backing (subtle)
    interiorPath();
    ctx.fillStyle = 'rgba(40,26,12,0.45)'; ctx.fill();

    // beer (clipped to interior)
    if (beerFrac > 0.001) {
      ctx.save(); interiorPath(); ctx.clip();
      var top = surfAt(0), iBot = G.barY - G.wall;
      // body
      ctx.beginPath(); ctx.moveTo(G.cx - G.topW, iBot + 4);
      for (var ci = 0; ci < N; ci++) ctx.lineTo(colX(ci), surfAt(ci));
      ctx.lineTo(G.cx + G.topW, iBot + 4); ctx.closePath();
      var bsy = beerSurfaceAbs();
      var lg = ctx.createLinearGradient(0, bsy - 8, 0, iBot);
      lg.addColorStop(0, COL.amberHi); lg.addColorStop(0.14, COL.amber);
      lg.addColorStop(0.5, COL.amberMid); lg.addColorStop(0.85, COL.amberDeep); lg.addColorStop(1, COL.dark);
      ctx.fillStyle = lg; ctx.fill();
      // caustics
      ctx.globalCompositeOperation = 'overlay';
      for (var cc = 0; cc < 2; cc++) {
        var cy2 = bsy + (0.3 + cc * 0.34) * (iBot - bsy) + Math.sin(time * 0.9 + cc) * 12;
        var cg = ctx.createLinearGradient(0, cy2 - 22, 0, cy2 + 22);
        cg.addColorStop(0, 'rgba(255,240,200,0)'); cg.addColorStop(0.5, 'rgba(255,240,200,0.10)'); cg.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = cg; ctx.fillRect(0, cy2 - 22, W, 44);
      }
      ctx.globalCompositeOperation = 'source-over';
      // bubbles
      for (var bi2 = 0; bi2 < bubbles.length; bi2++) {
        var b = bubbles[bi2], bx = colX(b.i) + Math.sin(time * 3 + b.ph) * b.w * 4;
        ctx.beginPath(); ctx.arc(bx, b.y, b.r, 0, 6.2832); ctx.fillStyle = 'rgba(246,238,216,0.16)'; ctx.fill();
        ctx.beginPath(); ctx.arc(bx - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.42, 0, 6.2832); ctx.fillStyle = 'rgba(255,250,235,0.5)'; ctx.fill();
      }
      // foam head (inside, single path)
      ctx.beginPath(); ctx.moveTo(colX(0), surfAt(0));
      for (var f1 = 1; f1 < N; f1++) ctx.lineTo(colX(f1), surfAt(f1));
      for (var f2 = N - 1; f2 >= 0; f2--) ctx.lineTo(colX(f2), surfAt(f2) - (8 + foam[f2]));
      ctx.closePath();
      var fg = ctx.createLinearGradient(0, bsy - 30, 0, bsy + 4);
      fg.addColorStop(0, 'rgba(' + COL.foam + ',0)'); fg.addColorStop(0.5, 'rgba(' + COL.foam + ',0.92)'); fg.addColorStop(1, 'rgba(' + COL.foam + ',0.66)');
      ctx.fillStyle = fg; ctx.fill();
      // fizz dots
      for (var fz = 0; fz < N; fz += 1) {
        var fx = colX(fz), fy = surfAt(fz) - (6 + foam[fz]) * 0.6;
        var rr = 1.1 + (Math.sin(fz * 0.7 + time * 4) * 0.5 + 0.5) * 1.8;
        ctx.beginPath(); ctx.arc(fx, fy, rr, 0, 6.2832);
        ctx.fillStyle = 'rgba(' + COL.foam + ',' + (0.25 + (Math.sin(fz + time * 5) * 0.5 + 0.5) * 0.25).toFixed(3) + ')'; ctx.fill();
      }
      ctx.restore();

      // splash droplets (above surface, clipped softly to glass top region — drawn unclipped, small)
      for (var di = 0; di < drops.length; di++) { ctx.beginPath(); ctx.arc(drops[di].x, drops[di].y, 1.5, 0, 6.2832); ctx.fillStyle = 'rgba(242,200,120,0.85)'; ctx.fill(); }
    }

    // glass body: edges, rim, highlight (drawn over the beer => translucent glass)
    outerPath();
    ctx.lineWidth = Math.max(2, G.wall * 0.5);
    var eg = ctx.createLinearGradient(G.cx - G.topW / 2, 0, G.cx + G.topW / 2, 0);
    eg.addColorStop(0, 'rgba(' + COL.glass + ',0.55)'); eg.addColorStop(0.5, 'rgba(' + COL.glass + ',0.12)'); eg.addColorStop(1, 'rgba(' + COL.glass + ',0.4)');
    ctx.strokeStyle = eg; ctx.stroke();
    // left vertical highlight streak
    var hlx = G.cx - G.topW * 0.34;
    var hg = ctx.createLinearGradient(hlx - 6, 0, hlx + 6, 0);
    hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(0.5, 'rgba(255,255,255,0.16)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg; ctx.fillRect(hlx - 6, G.topY + G.wall + 4, 12, G.gh - G.wall * 2 - 8);
    // rim ellipse (top opening)
    ctx.beginPath(); ctx.ellipse(G.cx, G.topY, G.topW / 2, Math.max(5, G.topW * 0.07), 0, 0, 6.2832);
    ctx.lineWidth = Math.max(2, G.wall * 0.5); ctx.strokeStyle = 'rgba(' + COL.glass + ',0.6)'; ctx.stroke();
    ctx.fillStyle = 'rgba(20,12,5,0.35)'; ctx.fill();

    // condensation on glass front
    for (var cdi = 0; cdi < cond.length; cdi++) {
      var cd = cond[cdi];
      if (cd.trail > 1) { var tg = ctx.createLinearGradient(0, cd.y - cd.trail, 0, cd.y); tg.addColorStop(0, 'rgba(220,232,236,0)'); tg.addColorStop(1, 'rgba(220,232,236,0.12)'); ctx.fillStyle = tg; ctx.fillRect(cd.x - cd.r * 0.5, cd.y - cd.trail, cd.r, cd.trail); }
      ctx.beginPath(); ctx.arc(cd.x, cd.y, cd.r, 0, 6.2832); ctx.fillStyle = 'rgba(210,222,228,0.25)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cd.x - cd.r * 0.3, cd.y - cd.r * 0.3, cd.r * 0.4, 0, 6.2832); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    }

    ctx.restore();   // end glassTransform
  }

  function frame(now) {
    if (!running) return;
    if (!t0) { t0 = now; lastT = now; }
    var time = (now - t0) / 1000; lastTime = time;
    var dt = (now - lastT) / 1000; lastT = now;
    if (dt > 0.05) dt = 0.05;
    step(time, dt); paint(time, dt);
    raf = requestAnimationFrame(frame);
  }

  function renderStatic() {
    phase = 'idle'; glassYoff = 0; glassVy = 0; squash = 0; shake = 0; tilt = 0; tiltVel = 0;
    beerFrac = BEER_MAX; pouring = false; streamA = 0;
    for (var i = 0; i < N; i++) { hh[i] = 0; vv[i] = 0; foam[i] = 7 + Math.sin(i) * 2; }
    paint(0, 0);
  }
  function placeAbove() {
    phase = 'fall'; glassYoff = -(G.barY + G.gh + 60); glassVy = 0; bounces = 0;
    squash = 0; squashV = 0; shake = 0;
  }

  function start() { if (running || prefersReduce) return; running = true; t0 = 0; lastT = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  function whenRevealed(cb) {
    var loader = document.getElementById('loader');
    if (!loader) { cb(); return; }
    var done = false, ticks = 0;
    (function check() {
      if (done) return;
      var cs = window.getComputedStyle(loader);
      if (!document.body.contains(loader) || cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05 || loader.offsetParent === null) { done = true; cb(); return; }
      if (++ticks > 300) { done = true; cb(); return; }
      requestAnimationFrame(check);
    })();
  }

  // ---- inputs -------------------------------------------------------------
  function setTilt(v) { tiltTarget = Math.max(-1, Math.min(1, v)); lastInput = performance.now(); }
  if (!prefersReduce) {
    hero.addEventListener('mousemove', function (e) { var r = hero.getBoundingClientRect(); setTilt(((e.clientX - r.left) / r.width - 0.5) * 1.1); }, { passive: true });
    hero.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('a,button')) return;
      var r = hero.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (beerFrac > 0.05) { var c = Math.max(0, Math.min(N - 1, xToCol(x))); if (y > surfAt(c) - 14) { impulse(c, 10, 3); addFoam(c, 6, 2); } }
    }, { passive: true });

    var attachGyro = function () {
      window.addEventListener('deviceorientation', function (e) {
        if (e.gamma == null && e.beta == null) return;
        var ang = (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
        var v; if (ang === 90) v = -(e.beta || 0); else if (ang === -90 || ang === 270) v = (e.beta || 0); else v = (e.gamma || 0);
        setTilt(v / 30);
      }, { passive: true });
    };
    var needsPerm = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if (needsPerm) {
      var hint = document.getElementById('pour-hint');
      var ask = function (e) {
        if (e && e.target && e.target.closest && e.target.closest('a,button')) return;
        DeviceOrientationEvent.requestPermission().then(function (s) { if (s === 'granted') attachGyro(); }).catch(function () {}).then(function () { if (hint) hint.classList.add('is-hidden'); });
        window.removeEventListener('touchend', ask); window.removeEventListener('click', ask);
      };
      if (hint) hint.classList.add('is-show');
      window.addEventListener('touchend', ask); window.addEventListener('click', ask);
    } else { attachGyro(); }
  }

  // ---- lifecycle ----------------------------------------------------------
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (visible && !prefersReduce) start(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (ents) { visible = ents[0].isIntersecting; if (visible && !document.hidden) start(); else stop(); }, { threshold: 0.04 }).observe(hero);
  }

  var onFont = function () { textReady = true; buildSprite(); if (prefersReduce) renderStatic(); else if (!running) paint(lastTime, 0); };
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(onFont); document.fonts.load('900 100px "Abril Fatface"').then(onFont).catch(function () {}); } else { textReady = true; }

  resize();
  if (prefersReduce) { renderStatic(); }
  else { placeAbove(); start(); whenRevealed(function () { revealed = true; t0 = 0; placeAbove(); }); }
})();
