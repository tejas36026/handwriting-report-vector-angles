(function () {
  'use strict';

  /* ═══════════════ STATE ═══════════════ */
  const S = {
    sigs: [],
    active: -1,
    tool: 'ruler',
    pts: [],
    all: [],           // completed measurements
    undo: [],
    redo: [],
    dpi: 96,
    zoom: 1, px: 0, py: 0,
    pan: false, lastM: null,
    preview: null,
    arcSide: 'inside',
    ovOp: 0.5,
    colors: ['#1a1a1a', '#c0392b', '#27ae60', '#d35400', '#8e44ad', '#e84393', '#0984e3', '#6ab04c'],
    dragging: null,     // {id, offX, offY} when dragging a label
    resizing: null,     // {id, startDist, startScale} when resizing a label
    exporting: false    // true during PNG export (hides UI elements)
  };
  let mid = 0;

  /* ═══════════════ DOM ═══════════════ */
  const cvs = document.getElementById('cvs');
  let c = cvs.getContext('2d');
  const wrap = document.getElementById('cvsWrap');
  const hint = document.getElementById('hint');
  const drop = document.getElementById('dropZone');
  const fin = document.getElementById('fileIn');
  const slist = document.getElementById('sigList');
  const ub = document.getElementById('undoBtn');
  const rb = document.getElementById('redoBtn');
  const arcO = document.getElementById('arcOpts');
  const arcSel = document.getElementById('arcSide');
  const dlB = document.getElementById('dlBtn');
  const dlSvg = document.getElementById('dlSvgBtn');
  const clrB = document.getElementById('clrBtn');
  const ovC = document.getElementById('ovCtrl');
  const mBody = document.getElementById('mBody');
  const dBody = document.getElementById('dBody');
  const aBody = document.getElementById('aBody');
  const arcBd = document.getElementById('arcBody');
  const mE = document.getElementById('mEmpty');

  /* ═══════════════ INIT ═══════════════ */
  function init() {
    resize();
    window.addEventListener('resize', resize);

    document.querySelectorAll('.tbtn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.tbtn').forEach(x => x.classList.remove('on', 'arc-on'));
        b.classList.add(b.dataset.tool === 'arc' ? 'arc-on' : 'on');
        S.tool = b.dataset.tool;
        S.pts = []; S.preview = null;
        arcO.classList.toggle('show', S.tool === 'arc');
        ovC.classList.toggle('show', S.tool === 'overlay');
        cvs.style.cursor = S.tool === 'hand' ? 'grab' : 'crosshair';
        setHint(); draw();
      });
    });

    drop.addEventListener('click', () => fin.click());
    fin.addEventListener('change', e => loadFiles(e.target.files));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over') });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); loadFiles(e.dataTransfer.files) });

    document.addEventListener('paste', e => {
      for (let i of e.clipboardData.items)
        if (i.type.startsWith('image/')) loadImg(i.getAsFile(), 'Pasted');
    });

    cvs.addEventListener('mousedown', mdown);
    cvs.addEventListener('mousemove', mmove);
    cvs.addEventListener('mouseup', mup);
    cvs.addEventListener('dblclick', mdbl);
    cvs.addEventListener('wheel', e => {
      e.preventDefault();
      // Always zoom toward cursor
      const rect = cvs.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = clamp(S.zoom * factor, .1, 5);
      S.px = mx - (mx - S.px) * (newZoom / S.zoom);
      S.py = my - (my - S.py) * (newZoom / S.zoom);
      S.zoom = newZoom;
      draw();
    }, { passive: false });

    ub.addEventListener('click', doUndo);
    rb.addEventListener('click', doRedo);
    dlB.addEventListener('click', download);
    dlSvg.addEventListener('click', downloadSVG);
    clrB.addEventListener('click', clearAll);
    document.getElementById('dpiIn').addEventListener('change', e => { S.dpi = parseInt(e.target.value) || 96; tables() });
    arcSel.addEventListener('change', () => { S.arcSide = arcSel.value });
    document.getElementById('ovOp').addEventListener('input', e => { S.ovOp = +e.target.value; draw() });

    document.getElementById('zi').addEventListener('click', () => { S.zoom = clamp(S.zoom * 1.25, .1, 5); draw() });
    document.getElementById('zo').addEventListener('click', () => { S.zoom = clamp(S.zoom / 1.25, .1, 5); draw() });
    document.getElementById('zf').addEventListener('click', () => { S.zoom = 1; S.px = 0; S.py = 0; draw() });

    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); doUndo() }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); doRedo() }
      if (e.key === 'Escape') { S.pts = []; S.preview = null; draw() }
      // Enter finishes multi-point arc
      if (e.key === 'Enter' && S.tool === 'arc' && S.pts.length >= 3) { finishArc(); }
    });

    draw();
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

  function resize() {
    const r = wrap.getBoundingClientRect();
    cvs.width = r.width - 16;
    cvs.height = r.height - 16;
    draw();
  }

  function loadFiles(fl) { for (let f of fl) if (f.type.startsWith('image/')) loadImg(f, f.name) }

  function loadImg(blob, name) {
    const rd = new FileReader();
    rd.onload = e => {
      const img = new Image();
      img.onload = () => {
        const i = S.sigs.length;
        const tp = i === 0 ? 'Disputed' : 'Specimen ' + i;
        const nm = name.length > 14 ? name.slice(0, 11) + '…' : name;
        const sc = Math.min((cvs.width * .75) / img.width, (cvs.height * .75) / img.height, 1);
        const w = img.width * sc, h = img.height * sc;
        const x = (cvs.width - w) / 2 + i * 20;
        const y = (cvs.height - h) / 2 + i * 20;
        S.sigs.push({ id: i, name: nm, type: tp, img, x, y, w, h, ow: img.width, oh: img.height });
        S.active = i;
        sigUI(); dimTbl(); setHint(); draw();
      };
      img.src = e.target.result;
    };
    rd.readAsDataURL(blob);
  }

  function sigUI() {
    slist.innerHTML = '';
    S.sigs.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'sig-item' + (i === S.active ? ' sel' : '');
      d.innerHTML = `<img src="${s.img.src}"><div><div class="nm">${s.name}</div><div class="tp" style="color:${S.colors[i % 8]}">${s.type}</div></div><button class="del" data-i="${i}">✕</button>`;
      d.addEventListener('click', e => {
        if (e.target.classList.contains('del')) { rmSig(i); return }
        S.active = i; sigUI(); draw();
      });
      slist.appendChild(d);
    });
    ovSel();
  }

  function rmSig(i) {
    S.sigs.splice(i, 1);
    S.all = S.all.filter(m => m.si !== i);
    S.all.forEach(m => { if (m.si > i) m.si-- });
    if (S.active >= S.sigs.length) S.active = S.sigs.length - 1;
    sigUI(); tables(); draw();
  }

  function ovSel() {
    const a = document.getElementById('ovA'), b = document.getElementById('ovB');
    const o = S.sigs.map((s, i) => `<option value="${i}">${s.type}</option>`).join('');
    a.innerHTML = o; b.innerHTML = o;
    if (S.sigs.length > 1) b.value = '1';
  }

  function cp(e) {
    const r = cvs.getBoundingClientRect();
    return { x: (e.clientX - r.left - S.px) / S.zoom, y: (e.clientY - r.top - S.py) / S.zoom };
  }

  function snapToDarkest(pt, radius) {
    const sig = S.sigs[S.active];
    if (!sig) return pt;
    const tc = document.createElement('canvas');
    tc.width = sig.img.width; tc.height = sig.img.height;
    const tx = tc.getContext('2d');
    tx.drawImage(sig.img, 0, 0);

    const scX = sig.img.width / sig.w;
    const scY = sig.img.height / sig.h;
    const imgX = (pt.x - sig.x) * scX;
    const imgY = (pt.y - sig.y) * scY;
    const r = Math.round(radius * scX);

    const x0 = Math.max(0, Math.round(imgX) - r);
    const y0 = Math.max(0, Math.round(imgY) - r);
    const x1 = Math.min(tc.width - 1, Math.round(imgX) + r);
    const y1 = Math.min(tc.height - 1, Math.round(imgY) + r);
    if (x1 <= x0 || y1 <= y0) return pt;

    const data = tx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
    const darkThreshold = 420; // pixels darker than this are "ink" (max brightness = 765)
    let bestDist = Infinity, bestX = imgX, bestY = imgY;
    let found = false;

    for (let dy = 0; dy <= y1 - y0; dy++) {
      for (let dx = 0; dx <= x1 - x0; dx++) {
        const i = (dy * (x1 - x0 + 1) + dx) * 4;
        const brightness = data[i] + data[i + 1] + data[i + 2];
        if (brightness >= darkThreshold) continue; // skip light pixels
        const px = x0 + dx, py = y0 + dy;
        const ddx = px - imgX, ddy = py - imgY;
        const dist = ddx * ddx + ddy * ddy;
        if (dist > r * r) continue;
        if (dist < bestDist) {
          bestDist = dist;
          bestX = px;
          bestY = py;
          found = true;
        }
      }
    }

    if (!found) return pt; // no dark pixel nearby, keep original
    return { x: bestX / scX + sig.x, y: bestY / scY + sig.y };
  }

  // Check if a point is near a measurement's label position
  function findLabelAt(pt) {
    const threshold = 20 / S.zoom;
    for (let i = S.all.length - 1; i >= 0; i--) {
      const m = S.all[i];
      if (!m.labelPos) continue;
      const dx = pt.x - m.labelPos.x, dy = pt.y - m.labelPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return m;
    }
    return null;
  }

  // Check if near a resize handle (bottom-right of label box)
  function findResizeAt(pt) {
    const threshold = 15 / S.zoom;
    for (let i = S.all.length - 1; i >= 0; i--) {
      const m = S.all[i];
      if (!m.labelPos || !m._box) continue;
      const hx = m._box.x + m._box.w;
      const hy = m._box.y + m._box.h;
      const dx = pt.x - hx, dy = pt.y - hy;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return m;
    }
    return null;
  }

  function mdown(e) {
    const pt = cp(e);

    // ALWAYS check resize handle first, then label drag — works in any tool mode
    const rh = findResizeAt(pt);
    if (rh) {
      const dist = Math.sqrt((pt.x - rh.labelPos.x) ** 2 + (pt.y - rh.labelPos.y) ** 2);
      S.resizing = { id: rh.id, startDist: dist, startScale: rh.labelScale || 1 };
      cvs.style.cursor = 'nwse-resize';
      return;
    }
    const label = findLabelAt(pt);
    if (label) {
      S.dragging = { id: label.id, offX: pt.x - label.labelPos.x, offY: pt.y - label.labelPos.y };
      cvs.style.cursor = 'move';
      return;
    }

    // Pan with middle click, Alt+click, or Hand tool (no label hit)
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && S.tool === 'hand')) {
      S.pan = true; S.lastM = { x: e.clientX, y: e.clientY }; cvs.style.cursor = 'grabbing'; return;
    }

    if (S.tool === 'overlay' || !S.sigs.length) return;

    // Snap to darkest pixel nearby for precise ink placement
    const snapped = snapToDarkest(pt, 8);
    S.pts.push({ ...snapped, si: S.active });

    // For arc tool: don't auto-finish (multi-point), show instruction
    if (S.tool === 'arc') {
      setHint();
      draw();
      return;
    }

    // For other tools: auto-finish when enough points
    if (S.pts.length >= ptsN()) finish();
    draw();
  }

  function mmove(e) {
    if (S.pan) {
      S.px += e.clientX - S.lastM.x; S.py += e.clientY - S.lastM.y;
      S.lastM = { x: e.clientX, y: e.clientY }; draw(); return;
    }

    // Resizing a label
    if (S.resizing) {
      const pt = cp(e);
      const m = S.all.find(m => m.id === S.resizing.id);
      if (m) {
        const dist = Math.sqrt((pt.x - m.labelPos.x) ** 2 + (pt.y - m.labelPos.y) ** 2);
        const ratio = dist / Math.max(S.resizing.startDist, 1);
        m.labelScale = clamp(S.resizing.startScale * ratio, 0.4, 4);
        draw();
      }
      return;
    }

    // Dragging a label
    if (S.dragging) {
      const pt = cp(e);
      const m = S.all.find(m => m.id === S.dragging.id);
      if (m) {
        m.labelPos = { x: pt.x - S.dragging.offX, y: pt.y - S.dragging.offY };
        draw();
      }
      return;
    }

    // Preview line
    const pt = cp(e);

    // Update cursor if near a label
    if (e.shiftKey) {
      const label = findLabelAt(pt);
      cvs.style.cursor = label ? 'move' : 'crosshair';
    }

    if (S.pts.length > 0) {
      if (S.tool === 'arc' || S.pts.length < ptsN()) {
        S.preview = pt;
        draw();
      }
    }
  }

  function mup() {
    if (S.pan) { S.pan = false; cvs.style.cursor = S.tool === 'hand' ? 'grab' : 'crosshair'; }
    if (S.dragging) { S.dragging = null; cvs.style.cursor = S.tool === 'hand' ? 'grab' : 'crosshair'; }
    if (S.resizing) { S.resizing = null; cvs.style.cursor = S.tool === 'hand' ? 'grab' : 'crosshair'; }
  }

  // Double-click finishes multi-point arc
  function mdbl(e) {
    if (S.tool === 'arc' && S.pts.length >= 3) {
      // Remove the duplicate point added by the second click of dblclick
      S.pts.pop();
      finishArc();
    }
  }

  function ptsN() { return S.tool === 'angle' ? 3 : 2 }

  /* ═══════════════ FINISH MEASUREMENT ═══════════════ */
  function finish() {
    const p = [...S.pts];
    const t = S.tool;
    const si = S.active;
    const id = ++mid;
    let val, ex = {};

    if (t === 'ruler') {
      const dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      val = d;
      ex = { px: d, mm: d / S.dpi * 25.4, cm: d / S.dpi * 2.54 };
    } else if (t === 'offset') {
      const dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
      val = Math.sqrt(dx * dx + dy * dy);
      ex = { dx, dy, d: val };
    } else if (t === 'angle') {
      val = ang3(p[0], p[1], p[2]);
      ex = { deg: val };
    }

    const m = { id, t, si, p, val, ex, label: S.sigs[si]?.type || '?', labelPos: null, labelScale: 1 };
    S.all.push(m);
    S.undo.push({ a: 'add', m });
    S.redo = [];
    S.pts = []; S.preview = null;
    btns(); tables(); draw();
  }

  /* ═══════════════ FINISH ARC (multi-point) ═══════════════ */
  function finishArc() {
    const p = [...S.pts];
    if (p.length < 3) return;

    const si = S.active;
    const id = ++mid;
    const result = leastSquaresCircle(p);
    const side = S.arcSide;
    const { cx: ox, cy: oy, r: radius } = result;

    // Compute arc length along the clicked points (chord-length approximation)
    let arcLen = 0;
    for (let i = 1; i < p.length; i++) {
      arcLen += Math.sqrt((p[i].x - p[i - 1].x) ** 2 + (p[i].y - p[i - 1].y) ** 2);
    }

    // Curvature κ = 1/R (independent of start/end points!)
    const kappa = isFinite(radius) && radius > 0 ? 1 / radius : 0;

    // Sharpest bend angle: minimum internal angle at any point along the curve
    // Tight hook = small (acute), gentle bend = large (obtuse), straight = 180°
    let minAngle = 180;
    for (let i = 1; i < p.length - 1; i++) {
      const a = ang3(p[i - 1], p[i], p[i + 1]);
      if (a < minAngle) minAngle = a;
    }
    const turnDeg = minAngle;

    const ex = {
      radius: Math.round(radius * 100) / 100,
      kappa: Math.round(kappa * 10000) / 10000,
      arcLen: Math.round(arcLen * 100) / 100,
      turnAngle: Math.round(turnDeg * 100) / 100,
      ox, oy,
      side,
      fitError: result.err,
      nPoints: p.length
    };

    const m = {
      id, t: 'arc', si, p, val: ex.radius, ex,
      label: S.sigs[si]?.type || '?',
      labelPos: null,
      labelScale: 1
    };
    S.all.push(m);
    S.undo.push({ a: 'add', m });
    S.redo = [];
    S.pts = []; S.preview = null;
    btns(); tables(); draw();
  }

  /* ═══════════════ LEAST-SQUARES CIRCLE FIT (Kåsa method) ═══════════════ */
  function leastSquaresCircle(pts) {
    const n = pts.length;
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    const mx = sx / n, my = sy / n;

    let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (const p of pts) {
      const u = p.x - mx, v = p.y - my;
      suu += u * u; suv += u * v; svv += v * v;
      suuu += u * u * u; svvv += v * v * v;
      suvv += u * v * v; svuu += v * u * u;
    }

    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-12) {
      // Degenerate — use first 3 points
      return fallback3pt(pts);
    }

    const uc = (0.5 * (suuu + suvv) * svv - 0.5 * (svvv + svuu) * suv) / det;
    const vc = (0.5 * (svvv + svuu) * suu - 0.5 * (suuu + suvv) * suv) / det;
    const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);

    const cx = mx + uc, cy = my + vc;

    // Fit error: RMS distance from circle
    let errSum = 0;
    for (const p of pts) {
      const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2) - r;
      errSum += d * d;
    }
    const err = Math.sqrt(errSum / n);

    return { cx, cy, r, err };
  }

  function fallback3pt(pts) {
    const [p1, p2, p3] = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
    const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return { cx: bx, cy: by, r: Infinity, err: Infinity };
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    const r = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);
    return { cx: ux, cy: uy, r, err: 0 };
  }

  /* ═══════════════ SWEEP DIRECTION ═══════════════ */
  function normA(a) { return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }

  function checkSweepOrder(angles) {
    // Check if angles are in increasing (positive) order relative to first angle
    const base = normA(angles[0]);
    let prev = 0;
    for (let i = 1; i < angles.length; i++) {
      const d = normA(normA(angles[i]) - base);
      if (d < prev) return false;
      prev = d;
    }
    return true;
  }

  /* ═══════════════ MATH ═══════════════ */
  function ang3(a, v, b) {
    const v1 = { x: a.x - v.x, y: a.y - v.y }, v2 = { x: b.x - v.x, y: b.y - v.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const cross = v1.x * v2.y - v1.y * v2.x;
    return Math.round(Math.atan2(Math.abs(cross), dot) * 18000 / Math.PI) / 100;
  }

  /* ═══════════════ UNDO/REDO ═══════════════ */
  function doUndo() {
    if (!S.undo.length) return;
    const u = S.undo.pop();
    if (u.a === 'add') { const i = S.all.findIndex(m => m.id === u.m.id); if (i >= 0) S.all.splice(i, 1); S.redo.push(u) }
    btns(); tables(); draw();
  }
  function doRedo() {
    if (!S.redo.length) return;
    const r = S.redo.pop();
    if (r.a === 'add') { S.all.push(r.m); S.undo.push(r) }
    btns(); tables(); draw();
  }
  function btns() { ub.disabled = !S.undo.length; rb.disabled = !S.redo.length }
  function download() {
    // Compute bounding box of all images + annotations
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    S.sigs.forEach(s => {
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
    });
    S.all.forEach(m => {
      if (m.labelPos) {
        minX = Math.min(minX, m.labelPos.x - 120); minY = Math.min(minY, m.labelPos.y - 40);
        maxX = Math.max(maxX, m.labelPos.x + 120); maxY = Math.max(maxY, m.labelPos.y + 40);
      }
      m.p.forEach(pt => {
        minX = Math.min(minX, pt.x - 10); minY = Math.min(minY, pt.y - 10);
        maxX = Math.max(maxX, pt.x + 10); maxY = Math.max(maxY, pt.y + 10);
      });
    });
    const pad = 30;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const imgW = Math.max(maxX - minX, 100), imgH = Math.max(maxY - minY, 100);

    // Table dimensions
    const tblW = 110; // narrow table
    const rowH = 14;
    const tblRows = S.all.length + 1;
    const tblH = Math.max(tblRows * rowH + 20, 40);
    const totalW = imgW + tblW + 15;
    const totalH = Math.max(imgH, tblH + 20);

    // Export at 2x resolution for sharpness
    const dpr = 2;
    const oc = document.createElement('canvas');
    oc.width = totalW * dpr; oc.height = totalH * dpr;
    const oc2 = oc.getContext('2d');
    oc2.scale(dpr, dpr);
    oc2.fillStyle = '#fff';
    oc2.fillRect(0, 0, totalW, totalH);
    oc2.save();
    oc2.translate(-minX, -minY);

    // Draw images
    S.sigs.forEach(s => {
      oc2.fillStyle = '#fff';
      oc2.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
      oc2.drawImage(s.img, s.x, s.y, s.w, s.h);
    });

    // Draw annotations
    const origC = c;
    const origZoom = S.zoom;
    c = oc2; S.zoom = 3; S.exporting = true;
    S.all.forEach((m, idx) => { m._idx = idx + 1; drawM(m); });
    c = origC; S.zoom = origZoom; S.exporting = false;
    oc2.restore();

    // === Draw compact summary table on the right ===
    const tx = imgW + 8;
    const ty = 10;

    oc2.font = 'bold 10px Inter, sans-serif';
    oc2.fillStyle = '#111';
    oc2.textAlign = 'left'; oc2.textBaseline = 'top';
    oc2.fillText('Summary', tx, ty);

    const headerY = ty + 14;
    oc2.fillStyle = '#f0f0f0';
    oc2.fillRect(tx, headerY, tblW, rowH);
    oc2.font = 'bold 8px Inter, sans-serif';
    oc2.fillStyle = '#333';
    oc2.fillText('#', tx + 4, headerY + 3);
    oc2.fillText('Value', tx + 22, headerY + 3);
    oc2.strokeStyle = '#ccc'; oc2.lineWidth = 0.5;
    oc2.strokeRect(tx, headerY, tblW, rowH);

    S.all.forEach((m, idx) => {
      const ry = headerY + rowH * (idx + 1);
      oc2.fillStyle = idx % 2 === 0 ? '#fff' : '#f8f8f8';
      oc2.fillRect(tx, ry, tblW, rowH);
      oc2.strokeStyle = '#ddd'; oc2.lineWidth = 0.3;
      oc2.strokeRect(tx, ry, tblW, rowH);

      let v = '';
      if (m.t === 'ruler') v = `${m.ex.px.toFixed(1)}px`;
      else if (m.t === 'offset') v = `${m.ex.d.toFixed(1)}px`;
      else if (m.t === 'angle') v = `${m.ex.deg.toFixed(1)}\u00b0`;
      else if (m.t === 'arc') v = `R${m.ex.radius}  ${m.ex.turnAngle.toFixed(1)}\u00b0`;
      oc2.font = 'bold 8px Inter, sans-serif';
      oc2.fillStyle = '#c0392b';
      oc2.fillText(String(idx + 1), tx + 4, ry + 3);
      oc2.font = '9px Inter, sans-serif';
      oc2.fillStyle = '#222';
      oc2.fillText(v, tx + 22, ry + 3);
    });

    oc2.strokeStyle = '#999'; oc2.lineWidth = 0.8;
    oc2.strokeRect(tx, headerY, tblW, rowH * (S.all.length + 1));
    oc2.textAlign = 'start'; oc2.textBaseline = 'alphabetic';

    const a = document.createElement('a');
    a.download = 'signature-analysis.png';
    a.href = oc.toDataURL('image/png');
    a.click();
  }

  /* ═══════════════ HTML EXPORT (interactive — annotations can be moved) ═══════════════ */
  function downloadSVG() {  // still called downloadSVG internally (button wiring)
    // Bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    S.sigs.forEach(s => {
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
    });
    S.all.forEach(m => {
      if (m.labelPos) {
        minX = Math.min(minX, m.labelPos.x - 150); minY = Math.min(minY, m.labelPos.y - 60);
        maxX = Math.max(maxX, m.labelPos.x + 150); maxY = Math.max(maxY, m.labelPos.y + 60);
      }
      m.p.forEach(pt => {
        minX = Math.min(minX, pt.x - 10); minY = Math.min(minY, pt.y - 10);
        maxX = Math.max(maxX, pt.x + 10); maxY = Math.max(maxY, pt.y + 10);
      });
      // Include arc leader line geometry (center + bend points)
      if (m.t === 'arc' && m.ex) {
        const ox = m.ex.ox || 0, oy = m.ex.oy || 0;
        minX = Math.min(minX, ox - 10); minY = Math.min(minY, oy - 10);
        maxX = Math.max(maxX, ox + 10); maxY = Math.max(maxY, oy + 10);
        // Approximate leader bend point
        if (m.p.length > 0) {
          const mi = Math.floor(m.p.length / 2), mp = m.p[mi];
          const dx = mp.x - ox, dy = mp.y - oy, d = Math.sqrt(dx * dx + dy * dy) || 1;
          const bd = Math.max((m.ex.radius || 0) * .4, 20);
          const bx = mp.x + dx / d * bd, by = mp.y + dy / d * bd;
          minX = Math.min(minX, bx - 10); minY = Math.min(minY, by - 10);
          maxX = Math.max(maxX, bx + 10); maxY = Math.max(maxY, by + 10);
        }
      }
    });
    const pad = 20;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const W = maxX - minX, H = maxY - minY;

    // Get images as base64
    const imgData = S.sigs.map(s => {
      const tc = document.createElement('canvas');
      tc.width = s.img.width; tc.height = s.img.height;
      tc.getContext('2d').drawImage(s.img, 0, 0);
      return { x: s.x - minX, y: s.y - minY, w: s.w, h: s.h, src: tc.toDataURL('image/png') };
    });

    // Build measurement data for the HTML
    const annots = S.all.map((m, idx) => {
      const pts = m.p.map(p => ({ x: p.x - minX, y: p.y - minY }));
      let val = '';
      if (m.t === 'ruler') val = `${m.ex.px.toFixed(1)}px / ${m.ex.mm.toFixed(1)}mm`;
      else if (m.t === 'offset') val = `Δ${m.ex.d.toFixed(1)}px`;
      else if (m.t === 'angle') val = `${m.ex.deg.toFixed(1)}°`;
      else if (m.t === 'arc') val = `R${m.ex.radius}  ${m.ex.turnAngle.toFixed(1)}°`;

      let lx, ly;
      if (m.labelPos) { lx = m.labelPos.x - minX; ly = m.labelPos.y - minY; }
      else if (pts.length >= 2) { lx = (pts[0].x + pts[pts.length - 1].x) / 2; ly = (pts[0].y + pts[pts.length - 1].y) / 2 - 20; }
      else { lx = pts[0].x + 20; ly = pts[0].y - 20; }

      return { num: idx + 1, t: m.t, pts, val, lx, ly, ex: m.ex, ox: (m.ex.ox || 0) - minX, oy: (m.ex.oy || 0) - minY };
    });

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Signature Analysis</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f5f5f5;font-family:Inter,system-ui,sans-serif;display:flex;gap:16px;padding:16px}
.canvas-area{position:relative;width:${W}px;height:${H}px;background:#fff;border:1px solid #ddd;flex-shrink:0;overflow:visible}
.canvas-area img{position:absolute}
svg.overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
.label{position:absolute;background:#fff;border:1px solid #ccc;padding:0px 3px;font-size:5px;font-weight:600;color:#111;cursor:move;user-select:none;white-space:nowrap;border-radius:1px;box-shadow:0 1px 2px rgba(0,0,0,.12);z-index:10}
.label .num{font-size:4px;color:#c0392b;margin-right:1px;font-weight:700}
.summary{background:#fff;border:1px solid #ddd;padding:12px;border-radius:4px;min-width:140px;height:fit-content}
.summary h3{font-size:12px;margin-bottom:8px;color:#333}
.summary table{border-collapse:collapse;font-size:10px;width:100%}
.summary th,.summary td{padding:3px 6px;border:1px solid #eee;text-align:left}
.summary th{background:#f0f0f0;font-weight:600;color:#555}
.summary .n{color:#c0392b;font-weight:700}
</style></head><body>
<div class="canvas-area" id="area">
${imgData.map(i => `<img src="${i.src}" style="left:${i.x}px;top:${i.y}px;width:${i.w}px;height:${i.h}px">`).join('\n')}
<svg class="overlay" viewBox="0 0 ${W} ${H}">
${annots.map(a => {
      let lines = '';
      if (a.t === 'ruler' && a.pts.length >= 2) {
        lines += `<line x1="${a.pts[0].x}" y1="${a.pts[0].y}" x2="${a.pts[1].x}" y2="${a.pts[1].y}" stroke="#222" stroke-width="1"/>`;
      } else if (a.t === 'offset' && a.pts.length >= 2) {
        lines += `<line x1="${a.pts[0].x}" y1="${a.pts[0].y}" x2="${a.pts[1].x}" y2="${a.pts[1].y}" stroke="#222" stroke-width="1" stroke-dasharray="4,3"/>`;
      } else if (a.t === 'angle' && a.pts.length >= 3) {
        lines += `<line x1="${a.pts[1].x}" y1="${a.pts[1].y}" x2="${a.pts[0].x}" y2="${a.pts[0].y}" stroke="#222" stroke-width="1"/>`;
        lines += `<line x1="${a.pts[1].x}" y1="${a.pts[1].y}" x2="${a.pts[2].x}" y2="${a.pts[2].y}" stroke="#222" stroke-width="1"/>`;
      } else if (a.t === 'arc' && a.pts.length >= 2) {
        let d = 'M' + a.pts[0].x + ',' + a.pts[0].y;
        for (let i = 0; i < a.pts.length - 1; i++) {
          const p0 = a.pts[Math.max(i - 1, 0)], p1 = a.pts[i], p2 = a.pts[i + 1], p3 = a.pts[Math.min(i + 2, a.pts.length - 1)];
          d += ' C' + (p1.x + (p2.x - p0.x) / 12) + ',' + (p1.y + (p2.y - p0.y) / 12) + ' ' + (p2.x - (p3.x - p1.x) / 12) + ',' + (p2.y - (p3.y - p1.y) / 12) + ' ' + p2.x + ',' + p2.y;
        }
        lines += '<path d="' + d + '" stroke="#222" stroke-width="1.5" fill="none"/>';
        // Leader line
        const mi = Math.floor(a.pts.length / 2), mp = a.pts[mi];
        const ux = mp.x - a.ox, uy = mp.y - a.oy, ul = Math.sqrt(ux * ux + uy * uy) || 1;
        const bd = Math.max(a.ex.radius * .4, 20);
        const bx = mp.x + ux / ul * bd, by = mp.y + uy / ul * bd;
        lines += '<polyline points="' + mp.x + ',' + mp.y + ' ' + bx + ',' + by + ' ' + a.lx + ',' + a.ly + '" stroke="#333" stroke-width="0.8" fill="none"/>';
      }
      // Dots
      a.pts.forEach(p => { lines += '<circle cx="' + p.x + '" cy="' + p.y + '" r="1.5" fill="#ff2d55" stroke="#fff" stroke-width="0.7"/>'; });
      return lines;
    }).join('\n')}
</svg>
${annots.map(a => `<div class="label" style="left:${a.lx}px;top:${a.ly - 16}px" data-n="${a.num}"><span class="num">${a.num}</span>${a.val}</div>`).join('\n')}
</div>
<div class="summary">
<h3>Summary</h3>
<table><tr><th>#</th><th>Value</th></tr>
${annots.map(a => `<tr><td class="n">${a.num}</td><td>${a.val}</td></tr>`).join('\n')}
</table></div>
<script>
document.querySelectorAll('.label').forEach(el=>{
  let ox,oy,sx,sy;
  el.onmousedown=e=>{e.preventDefault();ox=e.clientX;oy=e.clientY;sx=parseInt(el.style.left);sy=parseInt(el.style.top);
    const mm=e2=>{el.style.left=(sx+e2.clientX-ox)+'px';el.style.top=(sy+e2.clientY-oy)+'px'};
    const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu)};
    document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);
  };
});
</script></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.download = 'signature-analysis.html';
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearAll() { S.all = []; S.undo = []; S.redo = []; S.pts = []; mid = 0; btns(); tables(); draw() }

  function setHint() {
    if (!S.sigs.length) { hint.textContent = 'Upload a signature image to begin'; return }
    const n = S.pts.length;
    const h = {
      ruler: 'Click 2 points — dimension line with arrows',
      angle: 'Click 3 points: A → Vertex → B — angle arc',
      arc: n === 0
        ? 'Click points along the curve (min 3), then double-click or Enter to finish'
        : `${n} point${n > 1 ? 's' : ''} — keep clicking, double-click or Enter to finish`,
      offset: 'Click 2 points — displacement vector',
      overlay: 'Select two signatures, adjust opacity',
      hand: 'Click and drag to pan the canvas'
    };
    hint.textContent = h[S.tool] || '';
  }

  function draw() {
    c.clearRect(0, 0, cvs.width, cvs.height);
    c.save();
    c.translate(S.px, S.py);
    c.scale(S.zoom, S.zoom);

    if (S.tool === 'overlay' && S.sigs.length >= 2) { drawOv(); }
    else {
      S.sigs.forEach((s, i) => {
        // White background behind each image
        c.fillStyle = '#fff';
        c.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
        c.globalAlpha = i === S.active ? 1 : .3;
        c.drawImage(s.img, s.x, s.y, s.w, s.h);
        c.globalAlpha = 1;
      });
    }

    S.all.forEach((m, idx) => { m._idx = idx + 1; drawM(m); });
    drawPts();
    c.restore();
  }

  function drawOv() {
    const ia = +(document.getElementById('ovA').value) || 0;
    const ib = +(document.getElementById('ovB').value) || 1;
    const a = S.sigs[ia], b = S.sigs[ib]; if (!a || !b) return;
    c.globalAlpha = 1; c.drawImage(a.img, a.x, a.y, a.w, a.h);
    c.globalAlpha = S.ovOp; c.drawImage(b.img, a.x, a.y, a.w, a.h);
    c.globalAlpha = 1;
  }

  function drawM(m) {
    const z = S.zoom;
    if (m.t === 'ruler') drawDimLine(m, z);
    else if (m.t === 'offset') drawOffsetVec(m, z);
    else if (m.t === 'angle') drawAngleArc(m, z);
    else if (m.t === 'arc') drawArcRadius(m, z);

    // Draw small index number near first point
    if (m._idx && m.p.length) {
      const p0 = m.p[0];
      const fs = 6 / z;
      c.font = `bold ${fs}px Inter,sans-serif`;
      const numTxt = String(m._idx);
      const tw = c.measureText(numTxt).width;
      c.fillStyle = '#fff';
      c.fillRect(p0.x - tw / 2 - 1 / z, p0.y - 11 / z, tw + 2 / z, fs + 2 / z);
      c.fillStyle = '#c0392b';
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(numTxt, p0.x, p0.y - 4 / z);
      c.textAlign = 'start'; c.textBaseline = 'alphabetic';
    }
  }

  function drawDimLine(m, z) {
    const [a, b] = m.p;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = m.ex.px;
    if (len < 1) return;

    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const off = 14 / z;
    const ext = 6 / z;

    const a2 = { x: a.x + nx * off, y: a.y + ny * off };
    const b2 = { x: b.x + nx * off, y: b.y + ny * off };

    c.strokeStyle = '#111'; c.fillStyle = '#111'; c.lineWidth = 0.8 / z;

    // Extension lines
    c.beginPath();
    c.moveTo(a.x + nx * 2 / z, a.y + ny * 2 / z);
    c.lineTo(a2.x + nx * ext, a2.y + ny * ext);
    c.moveTo(b.x + nx * 2 / z, b.y + ny * 2 / z);
    c.lineTo(b2.x + nx * ext, b2.y + ny * ext);
    c.stroke();

    // Dimension line
    c.lineWidth = 0.6 / z;
    c.beginPath(); c.moveTo(a2.x, a2.y); c.lineTo(b2.x, b2.y); c.stroke();

    // Arrowheads
    engArrow(a2, { x: a2.x + ux, y: a2.y + uy }, z);
    engArrow(b2, { x: b2.x - ux, y: b2.y - uy }, z);

    // Label (use stored position if dragged, otherwise auto)
    const autoX = (a2.x + b2.x) / 2, autoY = (a2.y + b2.y) / 2;
    if (!m.labelPos) m.labelPos = { x: autoX, y: autoY };
    const lx = m.labelPos.x, ly = m.labelPos.y;
    const sc = m.labelScale || 1;

    const angle = Math.atan2(dy, dx);
    const txt = `${len.toFixed(1)} (${m.ex.mm.toFixed(1)}mm)`;

    c.save();
    c.translate(lx, ly);
    let ra = angle;
    if (ra > Math.PI / 2) ra -= Math.PI;
    if (ra < -Math.PI / 2) ra += Math.PI;
    c.rotate(ra);
    c.font = `500 ${18 * sc / z}px Inter,sans-serif`;
    const tw = c.measureText(txt).width;
    const th = 20 * sc / z;
    c.fillStyle = '#fff';
    c.fillRect(-tw / 2 - 3 / z, -th / 2 - 1 / z, tw + 6 / z, th + 2 / z);
    c.fillStyle = '#111';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(txt, 0, 0);
    c.restore();
    m._box = { x: lx - tw / 2 - 3 / z, y: ly - th / 2 - 1 / z, w: tw + 6 / z, h: th + 2 / z };
    drawGrip(m._box.x + m._box.w, m._box.y + m._box.h, z);
    engDot(a, z); engDot(b, z);
  }

  function engArrow(tip, dir, z) {
    const angle = Math.atan2(dir.y - tip.y, dir.x - tip.x);
    const L = 6 / z, W = 2 / z;
    c.fillStyle = '#111';
    c.beginPath();
    c.moveTo(tip.x, tip.y);
    c.lineTo(tip.x + L * Math.cos(angle) + W * Math.cos(angle + Math.PI / 2),
      tip.y + L * Math.sin(angle) + W * Math.sin(angle + Math.PI / 2));
    c.lineTo(tip.x + L * Math.cos(angle) + W * Math.cos(angle - Math.PI / 2),
      tip.y + L * Math.sin(angle) + W * Math.sin(angle - Math.PI / 2));
    c.closePath(); c.fill();
  }

  /* ══════════════════════════════════════════
     OFFSET VECTOR
     ══════════════════════════════════════════ */
  function drawOffsetVec(m, z) {
    const [a, b] = m.p;
    c.strokeStyle = '#333'; c.fillStyle = '#333';

    c.lineWidth = 0.8 / z;
    c.setLineDash([4 / z, 2 / z]);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    c.setLineDash([]);
    engArrow(b, { x: b.x - (b.x - a.x) * .01, y: b.y - (b.y - a.y) * .01 }, z);

    c.strokeStyle = '#888'; c.lineWidth = 0.5 / z;
    c.setLineDash([2 / z, 2 / z]);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, a.y); c.stroke();
    c.beginPath(); c.moveTo(b.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    c.setLineDash([]);

    c.font = `500 ${8 / z}px Inter,sans-serif`; c.fillStyle = '#555';
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(`Δx: ${m.ex.dx.toFixed(1)}`, (a.x + b.x) / 2, a.y - 3 / z);

    c.save();
    c.translate(b.x + 8 / z, (a.y + b.y) / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(`Δy: ${m.ex.dy.toFixed(1)}`, 0, 0);
    c.restore();

    // Total distance label (draggable)
    const dTxt = `d: ${m.ex.d.toFixed(1)}px`;
    const autoX = (a.x + b.x) / 2, autoY = (a.y + b.y) / 2 + 12 / z;
    if (!m.labelPos) m.labelPos = { x: autoX, y: autoY };
    const sc = m.labelScale || 1;

    c.font = `600 ${18 * sc / z}px Inter,sans-serif`;
    const tw = c.measureText(dTxt).width;
    const bx = m.labelPos.x - tw / 2 - 2 / z, by2 = m.labelPos.y - 5 / z;
    const bw = tw + 4 / z, bh2 = 11 / z;
    c.fillStyle = '#fff';
    c.fillRect(bx, by2, bw, bh2);
    c.fillStyle = '#111';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(dTxt, m.labelPos.x, m.labelPos.y);
    c.textAlign = 'start'; c.textBaseline = 'alphabetic';

    m._box = { x: bx, y: by2, w: bw, h: bh2 };
    drawGrip(bx + bw, by2 + bh2, z);

    engDot(a, z); engDot(b, z);
  }

  /* ══════════════════════════════════════════
     ANGLE ARC
     ══════════════════════════════════════════ */
  function drawAngleArc(m, z) {
    const [a, v, b] = m.p;
    c.strokeStyle = '#111'; c.lineWidth = 0.7 / z;

    c.beginPath(); c.moveTo(v.x, v.y); c.lineTo(a.x, a.y); c.stroke();
    c.beginPath(); c.moveTo(v.x, v.y); c.lineTo(b.x, b.y); c.stroke();

    const r = 20 / z;
    const sa = Math.atan2(a.y - v.y, a.x - v.x);
    const ea = Math.atan2(b.y - v.y, b.x - v.x);
    let sweep = ea - sa;
    if (sweep < 0) sweep += Math.PI * 2;
    const ccw = sweep > Math.PI;

    c.lineWidth = 0.8 / z;
    c.beginPath(); c.arc(v.x, v.y, r, sa, ea, ccw); c.stroke();

    // Label (draggable)
    const midA = ccw ? sa - (2 * Math.PI - sweep) / 2 : sa + sweep / 2;
    const autoX = v.x + Math.cos(midA) * (r + 10 / z);
    const autoY = v.y + Math.sin(midA) * (r + 10 / z);
    if (!m.labelPos) m.labelPos = { x: autoX, y: autoY };
    const sc = m.labelScale || 1;

    c.font = `600 ${20 * sc / z}px Inter,sans-serif`;
    const txt = m.ex.deg.toFixed(1) + '\u00b0';
    const tw = c.measureText(txt).width;
    const bx = m.labelPos.x - tw / 2 - 2 / z, by = m.labelPos.y - 6 / z;
    const bw = tw + 4 / z, bh = 12 / z;
    c.fillStyle = '#fff';
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = '#111';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(txt, m.labelPos.x, m.labelPos.y);
    c.textAlign = 'start'; c.textBaseline = 'alphabetic';

    m._box = { x: bx, y: by, w: bw, h: bh };
    if (S.tool === 'hand') drawGrip(bx + bw, by + bh, z);

    engDot(a, z); engDot(v, z); engDot(b, z);
  }

  /* ══════════════════════════════════════════
     ARC CURVATURE — Multi-point, Least-Squares Fit
     - All clicked points shown as dots
     - Best-fit arc drawn through the point range
     - R-value with leader line (draggable)
     - Center mark, radius line, angle sector
     ══════════════════════════════════════════ */
  function drawArcRadius(m, z) {
    const pts = m.p;
    const { ox, oy, radius, nPoints } = m.ex;
    const sc = m.labelScale || 1;

    // 1. Draw smooth SPLINE through all clicked points
    c.strokeStyle = '#111';
    c.lineWidth = 1.2 / z;
    if (pts.length >= 3) {
      drawCatmullRom(pts, z);
    } else {
      c.beginPath();
      pts.forEach((p, i) => i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
      c.stroke();
    }

    // 2. Draw all clicked points (bright red + white outline)
    pts.forEach((p, i) => {
      c.strokeStyle = '#fff'; c.lineWidth = 1.5 / z;
      c.beginPath(); c.arc(p.x, p.y, 3 / z, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#ff2d55';
      c.beginPath(); c.arc(p.x, p.y, 2.5 / z, 0, Math.PI * 2); c.fill();
    });

    if (!isFinite(radius) || radius > 1e4) return;

    // 3. Center cross mark (small +)
    const cm = 4 / z;
    c.strokeStyle = '#555'; c.lineWidth = 0.5 / z;
    c.beginPath();
    c.moveTo(ox - cm, oy); c.lineTo(ox + cm, oy);
    c.moveTo(ox, oy - cm); c.lineTo(ox, oy + cm);
    c.stroke();

    // === ENGINEERING ELBOW LEADER ===
    const midPt = pts[Math.floor(pts.length / 2)];

    // Direction from center to curve point (outward)
    const dx = midPt.x - ox, dy = midPt.y - oy;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / d, uy = dy / d;

    // Auto-position: bend point is offset outward from curve, then shelf goes horizontal
    const bendDist = Math.max(radius * 0.4, 20 / z);
    const shelfLen = 30 / z;
    const shelfDir = 1; // Always place label to the right for consistency

    const bendX = midPt.x + ux * bendDist;
    const bendY = midPt.y + uy * bendDist;
    const shelfEndX = bendX + shelfDir * shelfLen;
    const shelfEndY = bendY;

    if (!m.labelPos) m.labelPos = { x: shelfEndX, y: shelfEndY };

    // Recompute bend from current labelPos (supports dragging)
    const lx = m.labelPos.x, ly = m.labelPos.y;
    // Bend point: same Y as label, on the line from midPt
    const bx2 = lx - shelfDir * shelfLen;
    const by2 = ly;

    // Draw: curve point → bend → horizontal shelf
    c.strokeStyle = '#111'; c.lineWidth = 0.7 / z;
    c.beginPath();
    c.moveTo(midPt.x, midPt.y);
    c.lineTo(bx2, by2);
    c.lineTo(lx, ly);
    c.stroke();

    engArrow(midPt, { x: midPt.x - ux, y: midPt.y - uy }, z);

    const labelTxt = `R${radius.toFixed(0)}  ${m.ex.turnAngle.toFixed(1)}\u00b0`;
    const fontSize = 20 * sc / z;
    c.font = `600 ${fontSize}px Inter,sans-serif`;
    const tw = c.measureText(labelTxt).width;

    // White background box behind label
    const textX = shelfDir > 0 ? bx2 + 2 / z : bx2 - 2 / z;
    const bgX = shelfDir > 0 ? textX - 3 / z : textX - tw - 3 / z;
    const bgY = ly - fontSize - 4 / z;
    const bgW = tw + 6 / z;
    const bgH = fontSize + 6 / z;
    c.fillStyle = '#fff';
    c.fillRect(bgX, bgY, bgW, bgH);

    // Label text
    c.fillStyle = '#111';
    c.textAlign = shelfDir > 0 ? 'left' : 'right';
    c.textBaseline = 'bottom';
    c.fillText(labelTxt, textX, ly - 2 / z);
    c.textAlign = 'start'; c.textBaseline = 'alphabetic';

    // Store box for move/resize hit-test
    const boxX = shelfDir > 0 ? bx2 : lx - 4 / z;
    const boxW = Math.abs(lx - bx2) + 8 / z;
    m._box = { x: boxX - 2 / z, y: ly - fontSize - 4 / z, w: boxW + 4 / z, h: fontSize + 16 / z };
    drawGrip(m._box.x + m._box.w, m._box.y + m._box.h, z);
  }

  /* \u2500\u2500\u2500 Catmull-Rom spline through N points \u2500\u2500\u2500 */
  function drawCatmullRom(pts, z) {
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i], p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const t = 0.5;
      c.bezierCurveTo(
        p1.x + (p2.x - p0.x) / (6 / t), p1.y + (p2.y - p0.y) / (6 / t),
        p2.x - (p3.x - p1.x) / (6 / t), p2.y - (p3.y - p1.y) / (6 / t),
        p2.x, p2.y
      );
    }
    c.stroke();
  }

  /* ─── Resize handle — bright visible square at corner (hidden during export) ─── */
  function drawGrip(x, y, z) {
    if (S.exporting) return; // hide from exported PNG
    const s = 10 / z;
    // Blue filled square with white border
    c.fillStyle = '#3b82f6';
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5 / z;
    c.beginPath();
    c.rect(x - s, y - s, s, s);
    c.fill(); c.stroke();
    // Diagonal resize arrow inside
    c.strokeStyle = '#fff';
    c.lineWidth = 1.2 / z;
    c.beginPath();
    c.moveTo(x - s * 0.8, y - s * 0.2);
    c.lineTo(x - s * 0.2, y - s * 0.8);
    c.stroke();
    // Small arrowheads
    c.beginPath();
    c.moveTo(x - s * 0.8, y - s * 0.2);
    c.lineTo(x - s * 0.5, y - s * 0.2);
    c.lineTo(x - s * 0.8, y - s * 0.5);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(x - s * 0.2, y - s * 0.8);
    c.lineTo(x - s * 0.5, y - s * 0.8);
    c.lineTo(x - s * 0.2, y - s * 0.5);
    c.closePath(); c.fill();
  }

  /* ─── Engineering dot ─── */
  function engDot(p, z) {
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5 / z;
    c.beginPath(); c.arc(p.x, p.y, 3 / z, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#ff2d55';
    c.beginPath(); c.arc(p.x, p.y, 2.5 / z, 0, Math.PI * 2); c.fill();
  }

  /* ─── In-progress click points ─── */
  function drawPts() {
    if (!S.pts.length) return;
    const z = S.zoom;

    // For arc tool: draw connected dots path
    if (S.tool === 'arc' && S.pts.length >= 1) {
      c.strokeStyle = '#7c3aed88';
      c.lineWidth = 1 / z;
      c.beginPath();
      S.pts.forEach((p, i) => i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
      if (S.preview) c.lineTo(S.preview.x, S.preview.y);
      c.stroke();

      // If enough points, show preview of best-fit circle
      if (S.pts.length >= 3) {
        const result = leastSquaresCircle(S.pts);
        if (isFinite(result.r) && result.r < 1e4) {
          c.strokeStyle = '#7c3aed44';
          c.lineWidth = 0.8 / z;
          c.setLineDash([4 / z, 3 / z]);
          const sa = Math.atan2(S.pts[0].y - result.cy, S.pts[0].x - result.cx);
          const ea = Math.atan2(S.pts[S.pts.length - 1].y - result.cy, S.pts[S.pts.length - 1].x - result.cx);
          const angles = S.pts.map(pt => Math.atan2(pt.y - result.cy, pt.x - result.cx));
          const goCCW = checkSweepOrder(angles);
          c.beginPath(); c.arc(result.cx, result.cy, result.r, sa, ea, !goCCW); c.stroke();
          c.setLineDash([]);

          // Show live R-value
          c.font = `600 ${9 / z}px Inter,sans-serif`;
          c.fillStyle = '#7c3aed';
          c.fillText(`R${result.r.toFixed(0)} (${S.pts.length}pts)`, S.pts[0].x, S.pts[0].y - 10 / z);
        }
      }
    }

    // Point markers (bright, visible on dark ink)
    S.pts.forEach((p, i) => {
      const clr = S.tool === 'arc' ? '#ff2d55' : '#00d4ff';
      c.strokeStyle = '#fff';
      c.lineWidth = 2 / z;
      c.beginPath(); c.arc(p.x, p.y, 4.5 / z, 0, Math.PI * 2); c.stroke();
      c.fillStyle = clr;
      c.beginPath(); c.arc(p.x, p.y, 3.5 / z, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(p.x, p.y, 1.5 / z, 0, Math.PI * 2); c.fill();
      c.font = `700 ${8 / z}px Inter,sans-serif`;
      c.strokeStyle = '#fff'; c.lineWidth = 2.5 / z;
      c.strokeText(String(i + 1), p.x + 5 / z, p.y - 5 / z);
      c.fillStyle = clr;
      c.fillText(String(i + 1), p.x + 5 / z, p.y - 5 / z);
    });

    // Preview line for non-arc tools
    if (S.tool !== 'arc' && S.preview && S.pts.length > 0) {
      const last = S.pts[S.pts.length - 1];
      c.strokeStyle = '#4f46e588'; c.setLineDash([3 / z, 2 / z]); c.lineWidth = 0.7 / z;
      c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(S.preview.x, S.preview.y); c.stroke();
      c.setLineDash([]);
    }
  }

  /* ═══════════════ TABLES ═══════════════ */
  function tables() { mTbl(); dimTbl(); angTbl(); arcTbl() }

  function mTbl() {
    mBody.innerHTML = '';
    mE.style.display = S.all.length ? 'none' : 'block';
    S.all.forEach(m => {
      const tr = document.createElement('tr');
      let v = '';
      if (m.t === 'ruler') v = `${m.ex.px.toFixed(1)}px / ${m.ex.mm.toFixed(1)}mm`;
      else if (m.t === 'offset') v = `Δ(${m.ex.dx.toFixed(1)},${m.ex.dy.toFixed(1)}) = ${m.ex.d.toFixed(1)}px`;
      else if (m.t === 'angle') v = `${m.ex.deg.toFixed(1)}°`;
      else if (m.t === 'arc') v = `R${m.ex.radius} \u2014 ${m.ex.turnAngle.toFixed(1)}\u00b0 \u03ba${m.ex.kappa.toFixed(4)} [${m.ex.nPoints}pts]`;
      tr.innerHTML = `<td>${m.id}</td><td><span class="pill pill-${m.t}">${m.t.toUpperCase()}</span></td><td>${m.label}</td><td>${v}</td>`;
      mBody.appendChild(tr);
    });
  }

  function dimTbl() {
    dBody.innerHTML = '';
    S.sigs.forEach((s, i) => {
      const tr = document.createElement('tr');
      const wm = (s.ow / S.dpi * 25.4).toFixed(1);
      const hm = (s.oh / S.dpi * 25.4).toFixed(1);
      tr.innerHTML = `<td style="color:${S.colors[i % 8]};font-weight:600">${s.type}</td><td>${s.ow}px (${wm}mm)</td><td>${s.oh}px (${hm}mm)</td><td>${(s.ow / s.oh).toFixed(2)}</td>`;
      dBody.appendChild(tr);
    });
  }

  function angTbl() {
    aBody.innerHTML = '';
    const g = {};
    S.all.filter(m => m.t === 'angle').forEach(m => { if (!g[m.si]) g[m.si] = []; g[m.si].push(m.ex.deg) });
    for (const [i, arr] of Object.entries(g)) {
      const s = S.sigs[i]; if (!s) continue;
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const std = Math.sqrt(arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="color:${S.colors[i % 8]};font-weight:600">${s.type}</td><td>${avg.toFixed(1)}°</td><td>${std.toFixed(2)}</td><td>${arr.length}</td>`;
      aBody.appendChild(tr);
    }
  }

  function arcTbl() {
    arcBd.innerHTML = '';
    S.all.filter(m => m.t === 'arc').forEach(m => {
      const tr = document.createElement('tr');
      const rMm = (m.ex.radius / S.dpi * 25.4).toFixed(1);
      tr.innerHTML = `<td>${m.id}</td><td style="color:${S.colors[m.si % 8]};font-weight:600">${m.label}</td><td>${m.ex.turnAngle.toFixed(1)}\u00b0</td><td>\u03ba ${m.ex.kappa.toFixed(4)}</td><td>R${m.ex.radius} (${rMm}mm)</td>`;
      arcBd.appendChild(tr);
    });
  }

  /* ═══════════════ START ═══════════════ */
  init();
})();
