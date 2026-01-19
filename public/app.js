const app = {
    ws: null,
    sessionId: null,
    canvas: document.getElementById('scratch-canvas'),
    ctx: document.getElementById('scratch-canvas').getContext('2d'),

    // Off-screen buffer for SAFE heat caching (Grayscale intensity)
    heatCanvas: document.createElement('canvas'),
    heatCtx: null,

    touches: [],

    // Config
    FADE_DURATION: 10000,
    isCreator: false,

    // Hardcoded Rainbow Palette (256 colors * 4 bytes)
    colorPalette: null,

    init() {
        // Initialize off-screen buffer safely
        this.heatCtx = this.heatCanvas.getContext('2d', { willReadFrequently: true });
        this.generatePalette();

        const urlParams = new URLSearchParams(window.location.search);
        this.sessionId = urlParams.get('session');

        this.setupEventListeners();

        const img = document.getElementById('back-image');
        if (img.complete) {
            this.resizeCanvas();
        } else {
            img.onload = () => this.resizeCanvas();
        }

        if (this.sessionId) {
            this.isCreator = sessionStorage.getItem(`role_${this.sessionId}`) === 'creator';
            this.updateRoleUI();

            this.showSessionView();
            this.connectWebSocket();
            this.startFadeLoop();
        } else {
            document.getElementById('welcome-view').classList.remove('hidden');
        }

        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.renderHeatmap();
        });
    },

    updateRoleUI() {
        const statusText = document.getElementById('status-text');
        const claimBtn = document.getElementById('claim-control-btn');
        const clearBtn = document.getElementById('clear-btn');

        if (this.isCreator) {
            this.canvas.style.cursor = 'crosshair';
            statusText.innerText = 'You have the Itch! (Touch to mark)';
            statusText.style.color = '#22c55e'; // Green
            if (claimBtn) claimBtn.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'block';
        } else {
            this.canvas.style.cursor = 'default';
            statusText.innerText = 'Partner is scratching...';
            statusText.style.color = '#faa945'; // Orange
            if (claimBtn) claimBtn.style.display = 'block';
            if (clearBtn) clearBtn.style.display = 'none';
        }
    },

    generatePalette() {
        // Pre-calculate 256 colors: Blue -> Cyan -> Green -> Yellow -> Red
        this.colorPalette = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            let r = 0, g = 0, b = 0;

            if (t < 0.25) { // Blue -> Cyan
                const u = t / 0.25;
                r = 0; g = Math.floor(255 * u); b = 255;
            } else if (t < 0.5) { // Cyan -> Green
                const u = (t - 0.25) / 0.25;
                r = 0; g = 255; b = Math.floor(255 * (1 - u));
            } else if (t < 0.75) { // Green -> Yellow
                const u = (t - 0.5) / 0.25;
                r = Math.floor(255 * u); g = 255; b = 0;
            } else { // Yellow -> Red
                const u = (t - 0.75) / 0.25;
                r = 255; g = Math.floor(255 * (1 - u)); b = 0;
            }

            const idx = i * 4;
            this.colorPalette[idx] = r;
            this.colorPalette[idx + 1] = g;
            this.colorPalette[idx + 2] = b;
            this.colorPalette[idx + 3] = 255; // Fully opaque color, alpha handled by map
        }
    },

    setupEventListeners() {
        document.getElementById('create-session-btn').addEventListener('click', async () => {
            try {
                const response = await fetch('/api/create-session');
                const data = await response.json();
                sessionStorage.setItem(`role_${data.sessionId}`, 'creator');
                window.location.search = `?session=${data.sessionId}`;
            } catch (err) {
                console.error('Failed to create session:', err);
                alert('Could not create session. Please try again.');
            }
        });

        document.getElementById('copy-btn').addEventListener('click', () => {
            const nv = document.getElementById('share-link');
            nv.select();
            nv.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(nv.value).then(() => {
                const btn = document.getElementById('copy-btn');
                const originalText = btn.innerText;
                btn.innerText = 'Copied!';
                setTimeout(() => btn.innerText = originalText, 2000);
            });
        });

        document.getElementById('clear-btn').addEventListener('click', () => {
            if (!this.isCreator) return;
            this.touches = [];
            this.renderHeatmap();
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'clear' }));
            }
        });

        const claimBtn = document.getElementById('claim-control-btn');
        if (claimBtn) {
            claimBtn.addEventListener('click', () => {
                this.isCreator = true;
                sessionStorage.setItem(`role_${this.sessionId}`, 'creator');
                this.updateRoleUI();
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'claim_control' }));
                }
            });
        }

        this.canvas.addEventListener('pointerdown', (e) => this.handlePointer(e));
    },

    handlePointer(e) {
        if (!this.sessionId || !this.isCreator) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        const touch = { x, y, timestamp: Date.now() };

        this.touches.push(touch);
        this.renderHeatmap();

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'touch', ...touch }));
        }
    },

    startFadeLoop() {
        const loop = () => {
            if (this.touches.length > 0) this.renderHeatmap();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    },

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        this.ws = new WebSocket(`${protocol}//${host}?session=${this.sessionId}`);

        const indicator = document.getElementById('status-indicator');

        this.ws.onopen = () => {
            console.log('Connected');
            indicator.classList.add('connected');
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'init') {
                const now = Date.now();
                this.touches = (data.touches || []).map(t => ({ ...t, timestamp: now }));
                this.renderHeatmap();
            } else if (data.type === 'update') {
                this.touches.push(data.touch);
                this.renderHeatmap();
            } else if (data.type === 'clear') {
                this.touches = [];
                this.renderHeatmap();
            } else if (data.type === 'claim_control') {
                this.isCreator = false;
                sessionStorage.removeItem(`role_${this.sessionId}`);
                this.updateRoleUI();
            }
        };

        this.ws.onclose = () => {
            indicator.classList.remove('connected');
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    },

    showSessionView() {
        document.getElementById('welcome-view').classList.add('hidden');
        document.getElementById('session-view').classList.remove('hidden');
        document.getElementById('share-link').value = window.location.href;
    },

    resizeCanvas() {
        const wrapper = document.querySelector('.canvas-wrapper');
        if (wrapper) {
            const rect = wrapper.getBoundingClientRect();
            // Use Math.floor to strictly integer-align dimensions
            // Artifacts can happen with fractional widths in getImageData
            const w = Math.floor(rect.width);
            const h = Math.floor(rect.height);

            this.canvas.width = w;
            this.canvas.height = h;
            this.heatCanvas.width = w;
            this.heatCanvas.height = h;

            this.renderHeatmap();
        }
    },

    renderHeatmap() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const hCtx = this.heatCtx;
        const now = Date.now();

        // 1. Clear both canvases
        this.ctx.clearRect(0, 0, width, height);
        hCtx.clearRect(0, 0, width, height);

        let activeTouches = 0;

        // 2. Draw Grayscale Intensity to Off-screen Buffer
        // Stack alpha to build 'heat'

        this.touches.forEach(touch => {
            let age = now - touch.timestamp;
            if (age < 0) age = 0;
            if (age > this.FADE_DURATION) return;

            activeTouches++;

            const life = 1 - (age / this.FADE_DURATION); // 1.0 -> 0.0
            const x = touch.x * width;
            const y = touch.y * height;
            const radius = 40;

            // Base alpha intensity: 0.15 * life
            // Overlapping 5-6 clicks gets close to 1.0
            const alpha = 0.15 * life;

            const gradient = hCtx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');

            hCtx.fillStyle = gradient;
            hCtx.beginPath();
            hCtx.arc(x, y, radius, 0, Math.PI * 2);
            hCtx.fill();
        });

        if (activeTouches === 0) return;

        // 3. Map Intensity (Alpha) to Color
        try {
            const intensityData = hCtx.getImageData(0, 0, width, height);
            const intensity = intensityData.data;
            const finalImage = this.ctx.createImageData(width, height);
            const output = finalImage.data;
            const palette = this.colorPalette;

            // Iterate pixels
            for (let i = 0; i < intensity.length; i += 4) {
                const val = intensity[i + 3]; // Alpha channel contains our 'heat'

                if (val > 0) {
                    // val is 0..255
                    // Amplify heat: map 0-100 input to 0-255 spectrum
                    let heatIdx = val * 3;
                    if (heatIdx > 255) heatIdx = 255;

                    const pIdx = Math.floor(heatIdx) * 4;

                    output[i] = palette[pIdx];     // R
                    output[i + 1] = palette[pIdx + 1]; // G
                    output[i + 2] = palette[pIdx + 2]; // B

                    // Final alpha: visible but transparent enough to see back
                    // Scale alpha by heat so cooler areas are more transparent
                    output[i + 3] = Math.min(255, val * 2 + 50);
                }
            }
            this.ctx.putImageData(finalImage, 0, 0);

        } catch (e) {
            console.error("Heatmap render failed, falling back", e);
            // Fallback: draw the grayscale buffer directly if mapping fails
            this.ctx.drawImage(this.heatCanvas, 0, 0);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
