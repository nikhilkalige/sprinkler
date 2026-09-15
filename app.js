(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const inputs = {
    treeRows: document.getElementById('treeRows'),
    treeCols: document.getElementById('treeCols'),
    treeSpacing: document.getElementById('treeSpacing'),
    treeGirth: document.getElementById('treeGirth'),
    treeLinkRC: document.getElementById('treeLinkRC'),
    sprRows: document.getElementById('sprRows'),
    sprCols: document.getElementById('sprCols'),
    sprSpacing: document.getElementById('sprSpacing'),
    sprRadius: document.getElementById('sprRadius'),
    sprLinkRC: document.getElementById('sprLinkRC'),
    sprOffsetX: document.getElementById('sprOffsetX'),
    sprOffsetY: document.getElementById('sprOffsetY'),
  };

  const statArea = document.getElementById('statArea');
  const statTrees = document.getElementById('statTrees');
  const statOverlap = document.getElementById('statOverlap');
  const zoomLabel = document.getElementById('zoomLabel');

  function resizeCanvasToContainer() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
  }

  let trees = [];       // {x, y} world coords (feet)
  let sprinklers = [];  // {x, y}
  let treeGirth = 1.5;
  let sprRadius = 6;
  // Tracks the whole-grid offset last applied, so the offset inputs can shift
  // the current sprinkler positions (including any manual drags) rigidly.
  let sprOffsetX = 0;
  let sprOffsetY = 0;

  // baseTransform is the "fit to canvas" view; zoom/pan are applied on top of it
  // so parameter tweaks (which recompute the fit) don't fight the user's current view.
  let baseTransform = { scale: 1, offsetX: 0, offsetY: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let transform = { scale: 1, offsetX: 0, offsetY: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 8;

  let dragIndex = -1;
  let isPanning = false;
  let panLast = { x: 0, y: 0 };

  let showSprayLines = false;
  const SPRAY_RAY_COUNT = 96;

  function buildGrid(rows, cols, spacing, offsetX = 0, offsetY = 0) {
    const pts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pts.push({ x: c * spacing + offsetX, y: r * spacing + offsetY });
      }
    }
    return pts;
  }

  function readConfig() {
    return {
      treeRows: clampInt(inputs.treeRows, 1, 20),
      treeCols: clampInt(inputs.treeCols, 1, 20),
      treeSpacing: clampFloat(inputs.treeSpacing, 3, 100),
      treeGirth: circumferenceToRadius(clampFloat(inputs.treeGirth, 3, 190)),
      sprRows: clampInt(inputs.sprRows, 1, 20),
      sprCols: clampInt(inputs.sprCols, 1, 20),
      sprSpacing: clampFloat(inputs.sprSpacing, 3, 120),
      sprRadius: clampFloat(inputs.sprRadius, 1, 80),
      sprOffsetX: clampFloat(inputs.sprOffsetX, -60, 60),
      sprOffsetY: clampFloat(inputs.sprOffsetY, -60, 60),
    };
  }

  function clampInt(el, min, max) {
    let v = parseInt(el.value, 10);
    if (Number.isNaN(v)) v = min;
    v = Math.max(min, Math.min(max, v));
    el.value = v;
    return v;
  }

  function clampFloat(el, min, max) {
    let v = parseFloat(el.value);
    if (Number.isNaN(v)) v = min;
    v = Math.max(min, Math.min(max, v));
    el.value = v;
    return v;
  }

  // Reads a float without rewriting el.value, so it's safe to call on every
  // keystroke (rewriting mid-typing strips a trailing "." and breaks decimals like "4.5").
  // Only clamps the number; the visible text is cleaned up later on blur ('change').
  function peekFloat(el, min, max, fallback) {
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }

  // "Girth" is entered as canopy circumference; rendering/coverage math needs the radius.
  function circumferenceToRadius(circumference) {
    return circumference / (2 * Math.PI);
  }

  function regenerate() {
    const cfg = readConfig();
    treeGirth = cfg.treeGirth;
    sprRadius = cfg.sprRadius;
    sprOffsetX = cfg.sprOffsetX;
    sprOffsetY = cfg.sprOffsetY;
    trees = buildGrid(cfg.treeRows, cfg.treeCols, cfg.treeSpacing);
    sprinklers = buildGrid(cfg.sprRows, cfg.sprCols, cfg.sprSpacing, sprOffsetX, sprOffsetY);
    computeBaseTransform();
    resetView();
    render();
  }

  function resetPositions() {
    const cfg = readConfig();
    sprRadius = cfg.sprRadius;
    treeGirth = cfg.treeGirth;
    sprOffsetX = cfg.sprOffsetX;
    sprOffsetY = cfg.sprOffsetY;
    sprinklers = buildGrid(cfg.sprRows, cfg.sprCols, cfg.sprSpacing, sprOffsetX, sprOffsetY);
    computeBaseTransform();
    resetView();
    render();
  }

  // Shifts every current sprinkler position (including manual drags) by the
  // change in the offset inputs, so the whole grid can be moved as one unit.
  function applySprOffset() {
    const newOffsetX = peekFloat(inputs.sprOffsetX, -60, 60, sprOffsetX);
    const newOffsetY = peekFloat(inputs.sprOffsetY, -60, 60, sprOffsetY);
    const dx = newOffsetX - sprOffsetX;
    const dy = newOffsetY - sprOffsetY;
    for (const s of sprinklers) {
      s.x += dx;
      s.y += dy;
    }
    sprOffsetX = newOffsetX;
    sprOffsetY = newOffsetY;
    computeBaseTransform();
    updateEffectiveTransform();
    render();
  }

  // Shifts the sprinkler grid by half the tree spacing so sprinklers sit in the gaps between trees.
  function centerBetweenTrees() {
    const treeSpacing = clampFloat(inputs.treeSpacing, 3, 100);
    const half = treeSpacing / 2;
    inputs.sprOffsetX.value = half;
    inputs.sprOffsetY.value = half;
    applySprOffset();
  }

  // Only spray radius / girth can change live without regenerating the grid shape.
  // Zoom/pan are preserved here so tweaking a slider doesn't snap the view back to fit.
  function applyLiveParams() {
    sprRadius = peekFloat(inputs.sprRadius, 1, 80, sprRadius);
    const currentCircumference = treeGirth * 2 * Math.PI;
    const girthCircumference = peekFloat(inputs.treeGirth, 3, 190, currentCircumference);
    treeGirth = circumferenceToRadius(girthCircumference);
    computeBaseTransform();
    updateEffectiveTransform();
    render();
  }

  function extent(points) {
    if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY };
  }

  // Computes the "fit everything to the canvas" transform. Zoom/pan are layered on top of this.
  function computeBaseTransform() {
    const te = extent(trees);
    const se = extent(sprinklers);
    const margin = Math.max(sprRadius, treeGirth) + 1;

    const minX = Math.min(te.minX, se.minX) - margin;
    const maxX = Math.max(te.maxX, se.maxX) + margin;
    const minY = Math.min(te.minY, se.minY) - margin;
    const maxY = Math.max(te.maxY, se.maxY) + margin;

    const worldW = Math.max(maxX - minX, 1);
    const worldH = Math.max(maxY - minY, 1);

    const scale = Math.min(canvas.width / worldW, canvas.height / worldH);

    const usedW = worldW * scale;
    const usedH = worldH * scale;
    const padX = (canvas.width - usedW) / 2;
    const padY = (canvas.height - usedH) / 2;

    baseTransform = {
      scale,
      offsetX: padX - minX * scale,
      offsetY: padY - minY * scale,
      minX, maxX, minY, maxY,
    };
  }

  // Merges baseTransform with the current zoom/pan into the effective `transform`
  // used for rendering, hit-testing, and screen<->world conversion.
  function updateEffectiveTransform() {
    transform = {
      scale: baseTransform.scale * zoom,
      offsetX: baseTransform.offsetX * zoom + panX,
      offsetY: baseTransform.offsetY * zoom + panY,
      minX: baseTransform.minX,
      maxX: baseTransform.maxX,
      minY: baseTransform.minY,
      maxY: baseTransform.maxY,
    };
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    updateEffectiveTransform();
    updateZoomLabel();
  }

  // Zooms by `factor`, keeping the world point under (screenX, screenY) fixed on screen.
  function zoomBy(factor, screenX, screenY) {
    const worldX = (screenX - transform.offsetX) / transform.scale;
    const worldY = (screenY - transform.offsetY) / transform.scale;

    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    if (newZoom === zoom) return;
    zoom = newZoom;

    const newScale = baseTransform.scale * zoom;
    const newOffsetX = screenX - worldX * newScale;
    const newOffsetY = screenY - worldY * newScale;
    panX = newOffsetX - baseTransform.offsetX * zoom;
    panY = newOffsetY - baseTransform.offsetY * zoom;

    updateEffectiveTransform();
    updateZoomLabel();
    render();
  }

  function panBy(dx, dy) {
    panX += dx;
    panY += dy;
    updateEffectiveTransform();
    render();
  }

  function updateZoomLabel() {
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function toScreen(p) {
    return {
      x: p.x * transform.scale + transform.offsetX,
      y: p.y * transform.scale + transform.offsetY,
    };
  }

  function toWorld(sx, sy) {
    return {
      x: (sx - transform.offsetX) / transform.scale,
      y: (sy - transform.offsetY) / transform.scale,
    };
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showSprayLines) {
      renderSprayLines();
    } else {
      renderSprayCircles();
    }

    // Trees
    for (const t of trees) {
      const p = toScreen(t);
      const rCanopy = treeGirth * transform.scale;
      const covered = isPointCovered(t, sprRadius, t);

      ctx.beginPath();
      ctx.fillStyle = covered ? 'rgba(47, 125, 63, 0.55)' : 'rgba(160, 160, 160, 0.4)';
      ctx.arc(p.x, p.y, Math.max(rCanopy, 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = covered ? '#2f7d3f' : '#8a8a8a';
      ctx.lineWidth = 1;
      ctx.stroke();

      // trunk dot
      ctx.beginPath();
      ctx.fillStyle = '#6b4423';
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sprinklers
    for (let i = 0; i < sprinklers.length; i++) {
      const p = toScreen(sprinklers[i]);
      ctx.beginPath();
      ctx.fillStyle = i === dragIndex ? '#1d4ed8' : '#2563eb';
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    updateStats();
  }

  // Default mode: translucent filled circles, no outlines, so overlaps just blend into a
  // darker smooth region instead of a mess of crossing circle strokes.
  function renderSprayCircles() {
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.16)';
    for (const s of sprinklers) {
      const p = toScreen(s);
      const r = sprRadius * transform.scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Blocked-coverage mode: fills the actual ground a sprinkler reaches (a circle with bites
  // taken out where tree canopies block its line of sight), instead of a plain full circle.
  // No per-shape outline, so overlaps blend the same smooth way as the default mode.
  function renderSprayLines() {
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.16)';
    for (const s of sprinklers) {
      ctx.beginPath();
      for (let i = 0; i < SPRAY_RAY_COUNT; i++) {
        const angle = (i / SPRAY_RAY_COUNT) * Math.PI * 2;
        const hit = raySprayHit(s, angle, sprRadius);
        const p = toScreen(hit.point);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Finds where a spray ray from `origin` at `angle` first hits a tree canopy (if any),
  // otherwise returns the full-radius endpoint.
  function raySprayHit(origin, angle, maxRadius) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let minT = maxRadius;
    for (const tree of trees) {
      const ocx = origin.x - tree.x;
      const ocy = origin.y - tree.y;
      const b = 2 * (ocx * dirX + ocy * dirY);
      const c = ocx * ocx + ocy * ocy - treeGirth * treeGirth;
      const disc = b * b - 4 * c;
      if (disc < 0) continue;
      const sqrtDisc = Math.sqrt(disc);
      const t0 = (-b - sqrtDisc) / 2;
      if (t0 > 0.01 && t0 < minT) minT = t0;
    }
    return {
      point: { x: origin.x + dirX * minT, y: origin.y + dirY * minT },
      blocked: minT < maxRadius - 0.01,
    };
  }

  // Whether a tree (other than excludeTree) sits between `from` and `to`, blocking that
  // sprinkler's line of sight to that point. Only applied when spray-lines mode is on.
  function segmentBlockedByTrees(from, to, excludeTree) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return false;
    for (const tree of trees) {
      if (tree === excludeTree) continue;
      const tx = tree.x - from.x;
      const ty = tree.y - from.y;
      const t = (tx * dx + ty * dy) / lenSq;
      if (t <= 0.02 || t >= 0.98) continue; // tree isn't between the two points
      const closestX = from.x + t * dx;
      const closestY = from.y + t * dy;
      const distSq = (tree.x - closestX) ** 2 + (tree.y - closestY) ** 2;
      if (distSq <= treeGirth * treeGirth) return true;
    }
    return false;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // A point is covered if it's within radius of a sprinkler and, in spray-lines mode,
  // no other tree canopy blocks that sprinkler's line of sight to it.
  function isPointCovered(point, radius, excludeTree) {
    for (const s of sprinklers) {
      if (dist(point, s) > radius) continue;
      if (showSprayLines && segmentBlockedByTrees(s, point, excludeTree)) continue;
      return true;
    }
    return false;
  }

  function pointCoverageCount(point, radius, excludeTree) {
    let count = 0;
    for (const s of sprinklers) {
      if (dist(point, s) > radius) continue;
      if (showSprayLines && segmentBlockedByTrees(s, point, excludeTree)) continue;
      count++;
    }
    return count;
  }

  function updateStats() {
    // Trees watered
    let wateredTrees = 0;
    for (const t of trees) {
      if (isPointCovered(t, sprRadius, t)) wateredTrees++;
    }
    statTrees.textContent = `${wateredTrees} / ${trees.length}`;

    // Sample the tree field's bounding box to estimate area coverage & overlap
    const te = extent(trees);
    const pad = Math.max(sprRadius, treeGirth) * 0.5;
    const minX = te.minX - pad, maxX = te.maxX + pad;
    const minY = te.minY - pad, maxY = te.maxY + pad;
    const w = Math.max(maxX - minX, 0.001);
    const h = Math.max(maxY - minY, 0.001);

    const SAMPLES = 60; // 60x60 grid = 3600 samples, cheap
    let covered = 0;
    let overlapped = 0;
    let total = 0;

    for (let i = 0; i < SAMPLES; i++) {
      for (let j = 0; j < SAMPLES; j++) {
        const x = minX + (w * (i + 0.5)) / SAMPLES;
        const y = minY + (h * (j + 0.5)) / SAMPLES;
        const c = pointCoverageCount({ x, y }, sprRadius, null);
        total++;
        if (c >= 1) covered++;
        if (c >= 2) overlapped++;
      }
    }

    const areaPct = total ? Math.round((covered / total) * 100) : 0;
    const overlapPct = total ? Math.round((overlapped / total) * 100) : 0;

    statArea.textContent = `${areaPct}%`;
    statOverlap.textContent = `${overlapPct}%`;
  }

  // --- Drag handling ---

  function getPosFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function getMousePos(evt) {
    return getPosFromClient(evt.clientX, evt.clientY);
  }

  function touchDist(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  function findSprinklerAt(screenPos) {
    for (let i = sprinklers.length - 1; i >= 0; i--) {
      const p = toScreen(sprinklers[i]);
      if (Math.hypot(p.x - screenPos.x, p.y - screenPos.y) <= 10) return i;
    }
    return -1;
  }

  canvas.addEventListener('mousedown', (evt) => {
    const pos = getMousePos(evt);
    const idx = findSprinklerAt(pos);
    if (idx >= 0) {
      dragIndex = idx;
      canvas.classList.add('dragging');
      render();
    } else {
      isPanning = true;
      panLast = pos;
      canvas.classList.add('panning');
    }
  });

  window.addEventListener('mousemove', (evt) => {
    if (dragIndex >= 0) {
      const pos = getMousePos(evt);
      const world = toWorld(pos.x, pos.y);
      // clamp within current world bounds so sprinklers stay visible
      world.x = Math.max(transform.minX, Math.min(transform.maxX, world.x));
      world.y = Math.max(transform.minY, Math.min(transform.maxY, world.y));
      sprinklers[dragIndex] = world;
      render();
    } else if (isPanning) {
      const pos = getMousePos(evt);
      panBy(pos.x - panLast.x, pos.y - panLast.y);
      panLast = pos;
    }
  });

  window.addEventListener('mouseup', () => {
    if (dragIndex >= 0) {
      dragIndex = -1;
      canvas.classList.remove('dragging');
      render();
    }
    if (isPanning) {
      isPanning = false;
      canvas.classList.remove('panning');
    }
  });

  canvas.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    const pos = getMousePos(evt);
    const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomBy(factor, pos.x, pos.y);
  }, { passive: false });

  // --- Touch handling (drag a sprinkler / one-finger pan / two-finger pinch-zoom) ---

  let pinch = null; // { startDist, startZoom, mid }

  canvas.addEventListener('touchstart', (evt) => {
    evt.preventDefault();
    if (evt.touches.length === 2) {
      dragIndex = -1;
      isPanning = false;
      canvas.classList.remove('dragging', 'panning');
      const [t1, t2] = evt.touches;
      pinch = {
        startDist: touchDist(t1, t2),
        startZoom: zoom,
        mid: getPosFromClient((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2),
      };
      return;
    }
    if (evt.touches.length === 1) {
      const pos = getPosFromClient(evt.touches[0].clientX, evt.touches[0].clientY);
      const idx = findSprinklerAt(pos);
      if (idx >= 0) {
        dragIndex = idx;
        canvas.classList.add('dragging');
        render();
      } else {
        isPanning = true;
        panLast = pos;
        canvas.classList.add('panning');
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (evt) => {
    evt.preventDefault();
    if (pinch && evt.touches.length === 2) {
      const [t1, t2] = evt.touches;
      const dist = touchDist(t1, t2);
      const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.startZoom * (dist / pinch.startDist)));
      const factor = targetZoom / zoom;
      if (factor !== 1) zoomBy(factor, pinch.mid.x, pinch.mid.y);
      return;
    }
    if (evt.touches.length === 1) {
      const pos = getPosFromClient(evt.touches[0].clientX, evt.touches[0].clientY);
      if (dragIndex >= 0) {
        const world = toWorld(pos.x, pos.y);
        world.x = Math.max(transform.minX, Math.min(transform.maxX, world.x));
        world.y = Math.max(transform.minY, Math.min(transform.maxY, world.y));
        sprinklers[dragIndex] = world;
        render();
      } else if (isPanning) {
        panBy(pos.x - panLast.x, pos.y - panLast.y);
        panLast = pos;
      }
    }
  }, { passive: false });

  function endTouchInteraction(evt) {
    if (evt.touches.length < 2) pinch = null;
    if (evt.touches.length === 0) {
      if (dragIndex >= 0) {
        dragIndex = -1;
        canvas.classList.remove('dragging');
        render();
      }
      if (isPanning) {
        isPanning = false;
        canvas.classList.remove('panning');
      }
    }
  }

  canvas.addEventListener('touchend', endTouchInteraction);
  canvas.addEventListener('touchcancel', endTouchInteraction);

  // --- Wiring ---

  // Mobile: the control panel is a slide-in drawer opened via the hamburger button.
  const panel = document.getElementById('panel');
  const menuToggle = document.getElementById('menuToggle');
  const panelBackdrop = document.getElementById('panelBackdrop');

  function setPanelOpen(open) {
    panel.classList.toggle('open', open);
    panelBackdrop.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  }

  menuToggle.addEventListener('click', () => setPanelOpen(!panel.classList.contains('open')));
  panelBackdrop.addEventListener('click', () => setPanelOpen(false));

  document.getElementById('regenerateBtn').addEventListener('click', regenerate);
  document.getElementById('resetPositionsBtn').addEventListener('click', resetPositions);

  document.getElementById('zoomInBtn').addEventListener('click', () => {
    zoomBy(1.25, canvas.width / 2, canvas.height / 2);
  });
  document.getElementById('zoomOutBtn').addEventListener('click', () => {
    zoomBy(1 / 1.25, canvas.width / 2, canvas.height / 2);
  });
  document.getElementById('fitBtn').addEventListener('click', () => {
    resetView();
    render();
  });

  const sprayLinesToggle = document.getElementById('sprayLinesToggle');
  sprayLinesToggle.addEventListener('click', () => {
    showSprayLines = !showSprayLines;
    sprayLinesToggle.setAttribute('aria-pressed', String(showSprayLines));
    sprayLinesToggle.classList.toggle('active', showSprayLines);
    sprayLinesToggle.textContent = `Tree Blocking: ${showSprayLines ? 'On' : 'Off'}`;
    render();
  });

  // Grid-shape inputs require regeneration; radius/girth can apply live.
  [inputs.treeRows, inputs.treeCols, inputs.treeSpacing, inputs.sprRows, inputs.sprCols, inputs.sprSpacing]
    .forEach((el) => el.addEventListener('change', regenerate));

  [inputs.treeGirth, inputs.sprRadius].forEach((el) => el.addEventListener('input', applyLiveParams));
  // On blur, clean up the displayed text (e.g. trailing "." or an out-of-range value).
  inputs.treeGirth.addEventListener('change', () => { clampFloat(inputs.treeGirth, 3, 190); applyLiveParams(); });
  inputs.sprRadius.addEventListener('change', () => { clampFloat(inputs.sprRadius, 1, 80); applyLiveParams(); });

  [inputs.sprOffsetX, inputs.sprOffsetY].forEach((el) => el.addEventListener('input', applySprOffset));
  inputs.sprOffsetX.addEventListener('change', () => { clampFloat(inputs.sprOffsetX, -60, 60); applySprOffset(); });
  inputs.sprOffsetY.addEventListener('change', () => { clampFloat(inputs.sprOffsetY, -60, 60); applySprOffset(); });
  document.getElementById('centerBetweenTreesBtn').addEventListener('click', centerBetweenTrees);

  // Optionally keep a grid's rows and columns equal (square grid), toggled by the link button.
  function linkRowsAndCols(rowsEl, colsEl, toggleEl) {
    const isLinked = () => toggleEl.getAttribute('aria-pressed') === 'true';
    const setLinked = (linked) => {
      toggleEl.setAttribute('aria-pressed', String(linked));
      toggleEl.classList.toggle('active', linked);
    };

    rowsEl.addEventListener('input', () => {
      if (isLinked()) colsEl.value = rowsEl.value;
    });
    colsEl.addEventListener('input', () => {
      if (isLinked()) rowsEl.value = colsEl.value;
    });
    toggleEl.addEventListener('click', () => {
      setLinked(!isLinked());
      if (isLinked()) {
        colsEl.value = rowsEl.value;
        regenerate();
      }
    });
  }

  linkRowsAndCols(inputs.treeRows, inputs.treeCols, inputs.treeLinkRC);
  linkRowsAndCols(inputs.sprRows, inputs.sprCols, inputs.sprLinkRC);

  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      resizeCanvasToContainer();
      computeBaseTransform();
      updateEffectiveTransform();
      render();
    });
  });

  resizeCanvasToContainer();
  regenerate();
})();
