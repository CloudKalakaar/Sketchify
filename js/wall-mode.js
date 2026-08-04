/**
 * wall-mode.js — Wall Grid AR Tracing (no ES modules)
 */
class WallMode {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.cam = new CameraManager(this.video);

    this.overlayImage = null;
    this.gridSize = 3;
    this.selectedCell = 0;
    this.completedCells = new Set();
    this.opacity = 0.28;
    this._rafId = null;
    this._onCellChange = null;
  }

  async start(imageObj, gridSize) {
    this.overlayImage = imageObj;
    this.gridSize = gridSize || 3;
    this.selectedCell = 0;
    this.completedCells.clear();

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

  setGridSize(n) {
    this.gridSize = n;
    this.selectedCell = 0;
    this.completedCells.clear();
    this._notifyCellChange();
  }

  selectCell(index) {
    const total = this.gridSize * this.gridSize;
    if (index < 0 || index >= total) return;
    this.selectedCell = index;
    this._notifyCellChange();
    if (navigator.vibrate) navigator.vibrate(20);
  }

  markDone() {
    this.completedCells.add(this.selectedCell);
    const total = this.gridSize * this.gridSize;
    for (let i = 1; i <= total; i++) {
      const next = (this.selectedCell + i) % total;
      if (!this.completedCells.has(next)) { this.selectedCell = next; break; }
    }
    this._notifyCellChange();
    if (navigator.vibrate) navigator.vibrate([20, 10, 40]);
  }

  prevCell() { this.selectCell(this.selectedCell - 1); }
  nextCell() { this.selectCell(this.selectedCell + 1); }

  onCellChange(cb) { this._onCellChange = cb; }

  _notifyCellChange() {
    if (this._onCellChange) {
      this._onCellChange(this.selectedCell, this.gridSize * this.gridSize, this.completedCells.size);
    }
  }

  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.cam.drawFrame(ctx, canvas.width, canvas.height);
    if (this.overlayImage) this._drawCellOverlay();
    this._drawGrid();
  }

  _drawCellOverlay() {
    const { ctx, canvas, overlayImage: img, gridSize, selectedCell } = this;
    const W = canvas.width, H = canvas.height;
    const cw = W / gridSize, ch = H / gridSize;
    const col = selectedCell % gridSize;
    const row = Math.floor(selectedCell / gridSize);
    const x = col * cw, y = row * ch;

    const sw = img.width / gridSize, sh = img.height / gridSize;
    const sx = col * sw, sy = row * sh;

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, cw, ch);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(124,58,237,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
    ctx.restore();
  }

  _drawGrid() {
    const { ctx, canvas, gridSize, selectedCell, completedCells } = this;
    const W = canvas.width, H = canvas.height;
    const cw = W / gridSize, ch = H / gridSize;

    ctx.save();
    ctx.strokeStyle = 'rgba(167,139,250,0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (let i = 1; i < gridSize; i++) {
      ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * ch); ctx.lineTo(W, i * ch); ctx.stroke();
    }
    ctx.setLineDash([]);

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const idx = r * gridSize + c;
        const cx = c * cw + cw / 2, cy = r * ch + ch / 2;
        const isSel = idx === selectedCell, isDone = completedCells.has(idx);

        if (isDone) {
          ctx.fillStyle = 'rgba(34,197,94,0.18)';
          ctx.fillRect(c * cw, r * ch, cw, ch);
        }

        const badgeR = 18;
        ctx.beginPath();
        ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? 'rgba(124,58,237,0.85)' : (isDone ? 'rgba(34,197,94,0.75)' : 'rgba(0,0,0,0.5)');
        ctx.fill();

        ctx.font = `bold ${badgeR}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(isDone ? '✓' : String(idx + 1), cx, cy);
      }
    }
    ctx.restore();
  }
}
