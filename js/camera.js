/**
 * camera.js — Camera stream lifecycle manager (no ES modules)
 */
class CameraManager {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.isActive = false;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.isActive = true;
      return true;
    } catch (err) {
      console.error('Camera error:', err);
      this.isActive = false;
      return false;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.isActive = false;
  }

  drawFrame(ctx, canvasW, canvasH) {
    if (!this.video.videoWidth) return;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const scale = Math.max(canvasW / vw, canvasH / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = (canvasW - dw) / 2, dy = (canvasH - dh) / 2;
    ctx.drawImage(this.video, dx, dy, dw, dh);
  }
}

async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      return res === 'granted';
    } catch { return false; }
  }
  return true;
}
