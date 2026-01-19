const app = {
    ws: null,
    sessionId: null,
    canvas: document.getElementById('scratch-canvas'),
    ctx: document.getElementById('scratch-canvas').getContext('2d'),
    touches: [], // Array<{x, y, timestamp}>

    // Config
    gradient: null,
    FADE_DURATION: 10000,
    isCreator: false,

    init() {
        this.createGradient();
        const urlParams = new URLSearchParams(window.location.search);
        this.sessionId = urlParams.get('session');

        this.setupEventListeners();

        // Ensure image is loaded before sizing
        const img = document.getElementById('back-image');
        if (img.complete) {
            this.resizeCanvas();
        } else {
            img.onload = () => this.resizeCanvas();
        }

        if (this.sessionId) {
            // Check role
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

    createGradient() {
        // Create gradient manually to ensure consistent colors
        // Avoids potential issues with hidden canvas elements in some browsers
        const data = new Uint8ClampedArray(256 * 4);
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            let r = 0, g = 0, b = 0;

            // Spectrum: Blue (Cold) -> Green -> Yellow -> Red (Hot)
            if (t < 0.33) {
                // Blue -> Green
                const localT = t / 0.33;
                r = 0;
                g = Math.floor(255 * localT);
                b = Math.floor(255 * (1 - localT));
            } else if (t < 0.66) {
                // Green -> Yellow (Green + Red)
                const localT = (t - 0.33) / 0.33;
                r = Math.floor(255 * localT);
                g = 255;
                b = 0;
            } else {
                // Yellow -> Red
                const localT = (t - 0.66) / 0.34;
                r = 255;
                g = Math.floor(255 * (1 - localT));
                b = 0;
            }

            const idx = i * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255; // Alpha for list, not used directly but good for debug
        }
        this.gradient = data;
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
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.renderHeatmap();
        }
    },

    renderHeatmap() {
        if (!this.gradient) return;

        const width = this.canvas.width;
        const height = this.canvas.height;
        const ctx = this.ctx;
        const now = Date.now();

        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';

        let activeTouches = 0;

        // 1. Draw Intensity Map (Alpha)
        // Use WHITE circles (255,255,255) to build intensity.
        // If the color mapping fails, users will see white spots instead of black shadows,
        // which prevents the "black box" issue from obscuring the image.
        this.touches.forEach(touch => {
            let age = now - touch.timestamp;
            if (age < 0) age = 0;
            if (age > this.FADE_DURATION) return;

            activeTouches++;

            const life = 1 - (age / this.FADE_DURATION);
            const x = touch.x * width;
            const y = touch.y * height;
            const radius = 35;
            const alpha = 0.25 * life;

            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
            gradient.addColorStop(1, 'rgba(255,255,255,0)');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        });

        if (activeTouches === 0) return;

        // 2. Colorize
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const gradientByt = this.gradient;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha > 0) {
                let heatIndex = alpha * 3;
                if (heatIndex > 255) heatIndex = 255;

                const gIdx = Math.floor(heatIndex) * 4;

                data[i] = gradientByt[gIdx];
                data[i + 1] = gradientByt[gIdx + 1];
                data[i + 2] = gradientByt[gIdx + 2];
                // Keep the alpha from the heatmap (don't force opaque)
                // But boost it a bit for visibility?
                // Let's settle on: keep alpha 220ish constant where there is any heat?
                // Or just use the heatmap alpha?
                // The user complained about transparency not being "visible enough".
                // Let's set a floor for visibility.
                data[i + 3] = Math.max(alpha, 150);
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
