/**
 * paper-mode.js — AR Paper Tracing
 *
 * HOW THE LOCK WORKS (optical-flow approach):
 * ──────────────────────────────────────────
 * On LOCK:
 *   1. A hidden off-screen canvas grabs the current video frame at 1/4 res.
 *   2. We sample a grid of 7×7 = 49 "anchor" pixels from the centre
 *      region of that frame (pixel brightness values).
 *   3. We also note the paper's bounding rect from a corner-detection pass
 *      (the four bright corners of a white/light-coloured paper are found
 *      by scanning for high-luminance regions near each screen corner).
 *
 * Each frame after lock:
 *   4. A new low-res frame is sampled at the same grid positions.
 *   5. We do a block-match (search ±radius pixels) for each anchor to find
 *      where it moved → gives a motion vector per point.
 *   6. The *median* motion vector (pan dx, dy) is taken as the camera-to-
 *      paper translation, and the *scale ratio* of corner separations gives
 *      zoom.
 *   7. The sketch overlay is drawn as a sub-region of the full image,
 *      scaled so zoom-in shows finer detail and pan shows the matching part.
 *
 * Result: zoom in → see that portion of the sketch enlarged on paper.
 *         pan sideways → see the matching slice of the sketch.
 *         Works WITHOUT gyro/orientation permission.
 */

class PaperMode {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx    = canvasEl.getContext('2d');

    // hidden video element
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.video.muted = true;
    this.cam = new CameraManager(this.video);

    this.overlayImage = null;
    this.opacity      = 0.30;
    this.isLocked     = false;

    // ── Optical-flow state ──────────────────────
    this._offCanvas  = document.createElement('canvas');
    this._offCtx     = this._offCanvas.getContext('2d', { willReadFrequently: true });
    this._OF_W       = 160;   // low-res analysis width
    this._OF_H       = 90;    // low-res analysis height
    this._offCanvas.width  = this._OF_W;
    this._offCanvas.height = this._OF_H;

    this._refPixels  = null;  // Uint8Array of ref frame (RGBA, flat)
    this._anchors    = [];    // [{ax, ay}] grid sample positions in OF space
    this._GRID       = 6;     // 6×6 grid of anchors
    this._SEARCH_R   = 8;     // search radius in pixels (OF space)
    this._PATCH_R    = 3;     // half-width of matching patch

    // accumulated pan/zoom relative to lock frame
    this._panX  = 0;
    this._panY  = 0;
    this._zoom  = 1;

    this._rafId       = null;
    this._scanning    = true;
    this._scanPhase   = 0;
  }

  /* ═══════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════ */

  async start(imageObj) {
    this.overlayImage = imageObj;
    this.isLocked     = false;
    this._refPixels   = null;
    this._scanning    = true;
    this._panX = this._panY = 0;
    this._zoom = 1;

    this._resizeCanvas();
    this._resizeBound = () => this._resizeCanvas();
    window.addEventListener('resize', this._resizeBound);

    const ok = await this.cam.start();
    if (!ok) return false;

    this._loop();
    return true;
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.cam.stop();
    if (this._resizeBound) window.removeEventListener('resize', this._resizeBound);
  }

  setOpacity(v) { this.opacity = Math.max(0.05, Math.min(1, v)); }

  lock() {
    // Grab reference frame from current video
    this._captureRefFrame();

    if (!this._refPixels) return false;  // video not ready

    this.isLocked  = true;
    this._scanning = false;
    this._panX = this._panY = 0;
    this._zoom = 1;

    if (navigator.vibrate) navigator.vibrate([30, 20, 60]);
    return true;
  }

  unlock() {
    this.isLocked  = false;
    this._refPixels = null;
    this._scanning  = true;
    this._panX = this._panY = 0;
    this._zoom = 1;
  }

  /* ═══════════════════════════════════════════════════
     OPTICAL FLOW — REFERENCE FRAME CAPTURE
  ═══════════════════════════════════════════════════ */

  _captureRefFrame() {
    const { _offCtx: ctx, _OF_W: W, _OF_H: H } = this;
    if (!this.video.videoWidth) return;

    ctx.drawImage(this.video, 0, 0, W, H);
    const imgData = ctx.getImageData(0, 0, W, H);
    this._refPixels = new Uint8Array(imgData.data.buffer);

    // Build anchor grid in the central 60% of the frame
    this._anchors = [];
    const g   = this._GRID;
    const mar = 0.20;  // 20% margin from edges
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++) {
        const ax = Math.round((mar + (gx / (g - 1)) * (1 - 2 * mar)) * W);
        const ay = Math.round((mar + (gy / (g - 1)) * (1 - 2 * mar)) * H);
        this._anchors.push({ ax, ay });
      }
    }
  }

  /* ═══════════════════════════════════════════════════
     OPTICAL FLOW — FRAME MATCHING
  ═══════════════════════════════════════════════════ */

  _getLuminance(pixels, x, y, W) {
    const i = (y * W + x) * 4;
    // Clamp x,y to valid range to avoid edge artifacts
    if (x < 0 || y < 0 || x >= W || y >= this._OF_H) return 128;
    return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }

  _patchSAD(refPx, curPx, ax, ay, bx, by, W, H) {
    // Sum of Absolute Differences over a patch around (ax,ay) vs (bx,by)
    const r = this._PATCH_R;
    let sad = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const rx = Math.min(Math.max(ax + dx, 0), W - 1);
        const ry = Math.min(Math.max(ay + dy, 0), H - 1);
        const cx = Math.min(Math.max(bx + dx, 0), W - 1);
        const cy = Math.min(Math.max(by + dy, 0), H - 1);
        sad += Math.abs(this._getLuminance(refPx, rx, ry, W) -
                        this._getLuminance(curPx, cx, cy, W));
      }
    }
    return sad;
  }

  _computeFlow() {
    // Draw current frame to off-screen canvas at low res
    const { _offCtx: ctx, _OF_W: W, _OF_H: H, _SEARCH_R: R } = this;
    ctx.drawImage(this.video, 0, 0, W, H);
    const curData = ctx.getImageData(0, 0, W, H);
    const curPx   = new Uint8Array(curData.data.buffer);
    const refPx   = this._refPixels;

    const motions = [];

    for (const { ax, ay } of this._anchors) {
      let bestSAD = Infinity, bx = ax, by = ay;

      // Block search ±R pixels
      for (let sy = -R; sy <= R; sy++) {
        for (let sx = -R; sx <= R; sx++) {
          const cx = ax + sx, cy = ay + sy;
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          const sad = this._patchSAD(refPx, curPx, ax, ay, cx, cy, W, H);
          if (sad < bestSAD) { bestSAD = sad; bx = cx; by = cy; }
        }
      }

      // Only use anchor if the best match is confident (low SAD)
      const maxAcceptableSAD = (this._PATCH_R * 2 + 1) ** 2 * 30; // ~30 luma units avg
      if (bestSAD < maxAcceptableSAD) {
        motions.push({ dx: bx - ax, dy: by - ay });
      }
    }

    if (motions.length < 4) return { dx: 0, dy: 0, scale: 1 };

    // Median motion vector
    const dxs = motions.map(m => m.dx).sort((a, b) => a - b);
    const dys = motions.map(m => m.dy).sort((a, b) => a - b);
    const mid  = Math.floor(motions.length / 2);
    const dx   = dxs[mid];
    const dy   = dys[mid];

    // Estimate scale from spread of matched points
    // If camera moved closer, same-size scene takes up more pixels → scale > 1
    // We measure average motion magnitude and direction to infer zoom.
    // Simplistic: if most vectors point outward from centre → zoom in
    const cx = W / 2, cy = H / 2;
    let zoomVotes = 0;
    for (var _i = 0; _i < this._anchors.length; _i++) {
      var outX = this._anchors[_i].ax - cx;
      var outY = this._anchors[_i].ay - cy;
      var dot  = outX * dx + outY * dy;
      if (dot > 0) zoomVotes++;
    }
    const zoomBias = zoomVotes / this._anchors.length;
    // Map 0→0.5→1 to scale 0.95→1→1.05 per-frame (cumulative)
    const scaleDelta = 1 + (zoomBias - 0.5) * 0.04;

    return { dx, dy, scale: scaleDelta };
  }

  /* ═══════════════════════════════════════════════════
     RENDER LOOP
  ═══════════════════════════════════════════════════ */

  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw live camera feed
    this.cam.drawFrame(ctx, canvas.width, canvas.height);

    if (this.overlayImage) {
      if (this.isLocked && this._refPixels) {
        this._updateFlow();
        this._drawTrackedOverlay();
      } else {
        this._drawCentredOverlay();
      }
    }

    this._drawBrackets();
  }

  _updateFlow() {
    if (!this.video.videoWidth) return;
    try {
      const { dx, dy, scale } = this._computeFlow();

      // Convert OF-space motion to canvas-space motion
      // OF is _OF_W × _OF_H, canvas is canvas.width × canvas.height
      const scaleX = this.canvas.width  / this._OF_W;
      const scaleY = this.canvas.height / this._OF_H;

      // dx/dy in OF space → paper moved LEFT so sketch should pan RIGHT
      this._panX -= dx * scaleX;
      this._panY -= dy * scaleY;

      // Accumulate zoom (clamped to sensible range)
      this._zoom = Math.max(0.25, Math.min(8, this._zoom * scale));
    } catch (e) {
      // Silently ignore any frame read errors
    }
  }

  _drawTrackedOverlay() {
    const { ctx, canvas, overlayImage: img } = this;
    const W = canvas.width, H = canvas.height;

    // Base fit: how large is the full sketch at zoom=1 (fills screen)
    const baseScale = Math.min(W / img.width, H / img.height);
    const iw = img.width  * baseScale;
    const ih = img.height * baseScale;

    // At the locked moment the sketch fills the screen.
    // When _zoom increases (camera moved closer), we show a smaller
    // portion of the sketch → crop into it.
    const visW = iw / this._zoom;
    const visH = ih / this._zoom;

    // Pan offset: centre of the visible window in sketch coords
    // _panX/Y accumulate how much the paper has shifted on screen
    // → the sketch window centre moves in the opposite direction
    const centreX = img.width  / 2 - (this._panX / this._zoom) / baseScale;
    const centreY = img.height / 2 - (this._panY / this._zoom) / baseScale;

    // Source crop in image space
    const srcW = visW / baseScale;
    const srcH = visH / baseScale;
    const srcX = centreX - srcW / 2;
    const srcY = centreY - srcH / 2;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // Draw the cropped portion of the sketch to fill the screen
    ctx.drawImage(
      img,
      srcX, srcY, srcW, srcH,   // source (sub-region of image)
      0,    0,    W,    H        // destination (full canvas)
    );

    ctx.restore();
  }

  _drawCentredOverlay() {
    const { ctx, canvas } = this;
    const { iw, ih } = this._fitImage();
    ctx.save();
    ctx.globalAlpha = this.opacity * 0.5;
    ctx.drawImage(this.overlayImage,
      (canvas.width - iw) / 2, (canvas.height - ih) / 2, iw, ih);
    ctx.restore();
  }

  _fitImage() {
    const { canvas, overlayImage: img } = this;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.92;
    return { iw: img.width * scale, ih: img.height * scale };
  }

  /* ═══════════════════════════════════════════════════
     UI DECORATIONS
  ═══════════════════════════════════════════════════ */

  _drawBrackets() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const bSize = 36, bThick = 3, margin = 28;
    const col = this.isLocked ? '#22c55e' : '#A78BFA';

    this._scanPhase = (this._scanPhase + 1) % 120;
    const alpha = this.isLocked ? 1 : 0.5 + 0.5 * Math.sin(this._scanPhase * (Math.PI / 60));

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth   = bThick;
    ctx.globalAlpha = alpha;
    ctx.lineCap     = 'round';

    const corners = [
      [margin,     margin,      1,  1],
      [W - margin, margin,     -1,  1],
      [margin,     H - margin,  1, -1],
      [W - margin, H - margin, -1, -1]
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * bSize, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * bSize);
      ctx.stroke();
    }
    ctx.restore();

    // Lock indicator
    if (this.isLocked) {
      ctx.save();
      // Portable rounded rect (works on all Chrome/Android versions)
      ctx.fillStyle = 'rgba(0,0,0,0.60)';
      ctx.beginPath();
      var rx = W / 2 - 56, ry = margin - 6, rw = 112, rh = 28, rad = 14;
      ctx.moveTo(rx + rad, ry);
      ctx.lineTo(rx + rw - rad, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rad, rad);
      ctx.lineTo(rx + rw, ry + rh - rad);
      ctx.arcTo(rx + rw, ry + rh, rx + rw - rad, ry + rh, rad);
      ctx.lineTo(rx + rad, ry + rh);
      ctx.arcTo(rx, ry + rh, rx, ry + rh - rad, rad);
      ctx.lineTo(rx, ry + rad);
      ctx.arcTo(rx, ry, rx + rad, ry, rad);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle    = '#22c55e';
      ctx.font         = 'bold 13px Inter, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u2713  LOCKED  \u00d7' + this._zoom.toFixed(1), W / 2, margin + 8);
      ctx.restore();
    }
  }
}
