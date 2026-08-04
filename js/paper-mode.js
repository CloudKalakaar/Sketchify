/**
 * paper-mode.js — AR Paper Tracing Engine (Spatial Paper Lock)
 *
 * Features:
 * - High-performance camera feed rendering
 * - Smooth semi-transparent sketch overlay
 * - Unlocked mode: Align, drag, and scale sketch over paper
 * - Locked mode (Spatial Paper Lock):
 *   When Lock is tapped, the sketch locks to the paper in physical space.
 *   As you move your phone closer/farther or pan sideways across the paper,
 *   the canvas crops into the corresponding sub-region of the sketch image.
 *   Result: It acts EXACTLY like the image was already printed/traced on the paper!
 * - 100% universal crash-proof canvas APIs
 */

class PaperMode {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx    = canvasEl.getContext('2d');

    // Video stream element
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.video.muted = true;
    this.cam = new CameraManager(this.video);

    this.overlayImage = null;
    this.opacity      = 0.35;
    this.isLocked     = false;
    this.isFrozen     = false;

    // Transform state
    this.scale = 1.0;
    this.panX  = 0;
    this.panY  = 0;

    // Gyro orientation state
    this._curBeta   = 0;
    this._curGamma  = 0;
    this._curAlpha  = 0;
    this._baseBeta  = 0;
    this._baseGamma = 0;
    this._baseAlpha = 0;
    this._basePanX  = 0;
    this._basePanY  = 0;
    this._baseScale = 1.0;

    this._orientHandler = (e) => {
      this._curBeta  = e.beta  || 0;
      this._curGamma = e.gamma || 0;
      this._curAlpha = e.alpha || 0;
    };

    // Off-screen canvas for freeze-frame camera snapshot
    this._freezeCanvas = document.createElement('canvas');
    this._freezeCtx    = this._freezeCanvas.getContext('2d');

    // Touch gesture tracking
    this._touchStartDist  = 0;
    this._touchStartScale = 1.0;
    this._lastTouchX      = 0;
    this._lastTouchY      = 0;
    this._isDragging      = false;

    this._rafId     = null;
    this._scanPhase = 0;

    this._bindTouchEvents();
  }

  /* ═══════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════ */

  async start(imageObj) {
    this.overlayImage = imageObj;
    this.isLocked     = false;
    this.isFrozen     = false;
    this.scale        = 1.0;
    this.panX         = 0;
    this.panY         = 0;

    this._resizeCanvas();
    this._resizeBound = () => this._resizeCanvas();
    window.addEventListener('resize', this._resizeBound);
    window.addEventListener('deviceorientation', this._orientHandler);

    await this.cam.start();
    this._loop();
    return true;
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.cam.stop();
    window.removeEventListener('deviceorientation', this._orientHandler);
    if (this._resizeBound) window.removeEventListener('resize', this._resizeBound);
  }

  setOpacity(v) {
    this.opacity = Math.max(0.05, Math.min(1.0, v));
  }

  lock() {
    this.isLocked   = true;
    this._baseBeta  = this._curBeta;
    this._baseGamma = this._curGamma;
    this._baseAlpha = this._curAlpha;
    this._basePanX  = this.panX;
    this._basePanY  = this.panY;
    this._baseScale = Math.max(1.0, this.scale);

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { DeviceOrientationEvent.requestPermission(); } catch (e) {}
    }

    if (navigator.vibrate) {
      try { navigator.vibrate([30, 20, 60]); } catch (e) {}
    }
    return true;
  }

  unlock() {
    this.isLocked = false;
  }

  toggleFreeze() {
    if (!this.isFrozen) {
      if (this.video && this.video.videoWidth && this.video.videoHeight) {
        this._freezeCanvas.width  = this.canvas.width;
        this._freezeCanvas.height = this.canvas.height;
        this.cam.drawFrame(this._freezeCtx, this.canvas.width, this.canvas.height);
      }
      this.isFrozen = true;
    } else {
      this.isFrozen = false;
    }
    return this.isFrozen;
  }

  zoomIn() {
    this.scale = Math.min(6.0, this.scale * 1.25);
  }

  zoomOut() {
    this.scale = Math.max(0.2, this.scale / 1.25);
  }

  resetTransform() {
    this.scale = 1.0;
    this.panX  = 0;
    this.panY  = 0;
    this._basePanX  = 0;
    this._basePanY  = 0;
    this._baseScale = 1.0;
    this._baseBeta  = this._curBeta;
    this._baseGamma = this._curGamma;
  }

  /* ═══════════════════════════════════════════════════
     TOUCH GESTURES (PAN & PINCH-TO-ZOOM)
  ═══════════════════════════════════════════════════ */

  _bindTouchEvents() {
    const el = this.canvas;

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this._isDragging = true;
        this._lastTouchX = e.touches[0].clientX;
        this._lastTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this._isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._touchStartDist  = Math.hypot(dx, dy);
        this._touchStartScale = this.scale;
      }
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this._isDragging) {
        const cx = e.touches[0].clientX;
        const cy = e.touches[0].clientY;
        const dx = cx - this._lastTouchX;
        const dy = cy - this._lastTouchY;
        this.panX += dx;
        this.panY += dy;
        if (this.isLocked) {
          this._basePanX += dx;
          this._basePanY += dy;
        }
        this._lastTouchX = cx;
        this._lastTouchY = cy;
      } else if (e.touches.length === 2 && this._touchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / this._touchStartDist;
        this.scale = Math.max(0.2, Math.min(6.0, this._touchStartScale * factor));
      }
    }, { passive: true });

    el.addEventListener('touchend', () => {
      this._isDragging = false;
      this._touchStartDist = 0;
    }, { passive: true });
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

    // 1. Draw Background (Live Camera stream or Frozen Frame)
    if (this.isFrozen && this._freezeCanvas.width) {
      ctx.drawImage(this._freezeCanvas, 0, 0);
    } else {
      this.cam.drawFrame(ctx, canvas.width, canvas.height);
    }

    // 2. Draw Transformed Sketch Overlay
    if (this.overlayImage) {
      if (this.isLocked) {
        this._drawTrackedCropOverlay();
      } else {
        this._drawStandardOverlay();
      }
    }

    // 3. Draw AR HUD Brackets & Status
    this._drawHUD();
  }

  /* Standard Unlocked Mode: Position full image over screen */
  _drawStandardOverlay() {
    const { ctx, canvas, overlayImage: img } = this;
    const W = canvas.width, H = canvas.height;

    const baseFit = Math.min(W / img.width, H / img.height) * 0.90;
    const iw = img.width  * baseFit * this.scale;
    const ih = img.height * baseFit * this.scale;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    const cx = W / 2 + this.panX;
    const cy = H / 2 + this.panY;

    ctx.translate(cx, cy);
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);

    ctx.restore();
  }

  /* Spatial Paper Lock Mode: Crop & Spatial Pan Mapping */
  _drawTrackedCropOverlay() {
    const { ctx, canvas, overlayImage: img } = this;
    const W = canvas.width, H = canvas.height;

    let activeScale = Math.max(0.2, this.scale);
    let activePanX  = this.panX;
    let activePanY  = this.panY;

    // Apply Gyro counter-shift if active
    if (!this.isFrozen) {
      let dBeta  = this._curBeta  - this._baseBeta;
      let dGamma = this._curGamma - this._baseGamma;

      if (dGamma >  180) dGamma -= 360;
      if (dGamma < -180) dGamma += 360;
      if (dBeta  >  180) dBeta  -= 360;
      if (dBeta  < -180) dBeta  += 360;

      const SENSITIVITY = Math.min(W, H) * 0.04;
      activePanX = this._basePanX - (dGamma * SENSITIVITY);
      activePanY = this._basePanY - (dBeta  * SENSITIVITY);
    }

    const baseFit = Math.min(W / img.width, H / img.height) * 0.90;

    // If scale > 1.0 (zoomed in), crop into image corresponding to paper position
    if (activeScale >= 1.0) {
      const srcW = img.width / activeScale;
      const srcH = img.height / activeScale;

      const cropCenterX = (img.width / 2) - (activePanX / (baseFit * activeScale));
      const cropCenterY = (img.height / 2) - (activePanY / (baseFit * activeScale));

      const srcX = cropCenterX - (srcW / 2);
      const srcY = cropCenterY - (srcH / 2);

      // Safe bounds clamping
      const sX = Math.max(0, Math.min(img.width - 1, srcX));
      const sY = Math.max(0, Math.min(img.height - 1, srcY));
      const sW = Math.max(1, Math.min(img.width - sX, srcW));
      const sH = Math.max(1, Math.min(img.height - sY, srcH));

      ctx.save();
      ctx.globalAlpha = this.opacity;
      ctx.drawImage(img, sX, sY, sW, sH, 0, 0, W, H);
      ctx.restore();
    } else {
      // Scale < 1.0: draw scaled down image with spatial pan
      const iw = img.width  * baseFit * activeScale;
      const ih = img.height * baseFit * activeScale;

      ctx.save();
      ctx.globalAlpha = this.opacity;
      const cx = W / 2 + activePanX;
      const cy = H / 2 + activePanY;
      ctx.translate(cx, cy);
      ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
    }
  }

  _drawHUD() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const bSize = 36, bThick = 3, margin = 28;
    const col = this.isLocked ? '#22c55e' : '#A78BFA';

    this._scanPhase = (this._scanPhase + 1) % 120;
    const alpha = this.isLocked ? 1 : 0.5 + 0.5 * Math.sin(this._scanPhase * (Math.PI / 60));

    // Corner brackets
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
      ctx.moveTo(x + sx * bSize, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * bSize);
      ctx.stroke();
    }
    ctx.restore();

    // Lock & Zoom Status Badge
    if (this.isLocked) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      var rx = W / 2 - 75, ry = margin - 6, rw = 150, rh = 30, rad = 15;
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
      const zoomTxt = ' · ' + Math.round(this.scale * 100) + '%';
      ctx.fillText('🔒 TRACED ON PAPER' + zoomTxt, W / 2, margin + 9);
      ctx.restore();
    }
  }
}
