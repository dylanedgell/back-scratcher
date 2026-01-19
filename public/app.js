const app = {
    ws: null,
    sessionId: null,
    canvas: document.getElementById('scratch-canvas'),
    ctx: document.getElementById('scratch-canvas').getContext('2d'),
    // Off-screen canvas for calculating intensity (alpha)
    heatCanvas: document.createElement('canvas'),
    heatCtx: null, // Initialized in init

    touches: [],
    palette: null,

    // Config
    FADE_DURATION: 10000,
    isCreator: false,

    init() {
        this.heatCtx = this.heatCanvas.getContext('2d', { willReadFrequently: true });
        this.palette = this.generateGradientPalette();

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

    generateGradientPalette() {
        // Create a 256x1 gradient canvas to pick colors from
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 256, 0);
        // Rainbow Heatmap Gradient: Blue -> Green -> Yellow -> Red
        gradient.addColorStop(0.0, 'rgba(0, 0, 255, 0)'); // Fully transparent at bottom
        gradient.addColorStop(0.1, '#0000ff'); // Blue
        gradient.addColorStop(0.3, '#00ffff'); // Cyan
        gradient.addColorStop(0.5, '#00ff00'); // Green
        gradient.addColorStop(0.7, '#ffff00'); // Yellow
        gradient.addColorStop(1.0, '#ff0000'); // Red

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 1);

        // Get the pixel data
        return ctx.getImageData(0, 0, 256, 1).data;
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
        // Add move event for dragging support
        this.canvas.addEventListener('pointermove', (e) => {
            if (e.buttons > 0) this.handlePointer(e);
        });
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

            // Resize visible canvas
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;

            // Resize off-screen heat canvas to match
            this.heatCanvas.width = rect.width;
            this.heatCanvas.height = rect.height;

            this.renderHeatmap();
        }
    },

    renderHeatmap() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const ctx = this.ctx;
        const heatCtx = this.heatCtx;
        const now = Date.now();

        if (width === 0 || height === 0) return;

        // 1. Clear both canvases
        ctx.clearRect(0, 0, width, height);
        heatCtx.clearRect(0, 0, width, height);

        // 2. Draw black spots with varying alpha onto the off-screen heatCanvas
        // The more overlaps, the higher the alpha accumulates.
        // We use 'source-over' but we are drawing with low opacity black. 
        // Better yet, just use normal blending. The alpha will increase as we stack.
        // HOWEVER, 'lighter' (additive) is better for intensity accumulation if we use grayscale values.
        // Let's use 'lighter' with very low intensity white/grayscale pixels, then read the brightness.
        // Actually, easiest mapping is: Alpha channel accumulation.

        heatCtx.globalCompositeOperation = 'source-over';
        // Resetting to default for new frame, but we want accumulation...
        // Let's use simple alpha blending.

        this.touches.forEach(touch => {
            let age = now - touch.timestamp;
            if (age < 0) age = 0;
            if (age > this.FADE_DURATION) return; // Skip old touches

            const life = 1 - (age / this.FADE_DURATION);
            const x = touch.x * width;
            const y = touch.y * height;
            const radius = 50; // Bigger radius for smoother heatmap

            // Intensity based on life. 
            // We want overlapping to increase intensity.
            // Using a radial gradient with low alpha.
            const gradient = heatCtx.createRadialGradient(x, y, 0, x, y, radius);

            // We draw BLACK with alpha. The alpha channel is all we care about.
            // Actually, if we just draw standard semi-transparent circles, standard alpha blending applies.
            // A better way for "heat" is often additive blending of values.
            // Let's try standard alpha blending first. 
            // Center is more opaque (higher intensity).

            const intensity = 0.15 * life; // Max intensity per spot

            gradient.addColorStop(0, `rgba(0, 0, 0, ${intensity})`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

            heatCtx.fillStyle = gradient;
            heatCtx.beginPath();
            heatCtx.arc(x, y, radius, 0, Math.PI * 2);
            heatCtx.fill();
        });

        // 3. Map the off-screen alpha values to the palette
        // This is safe because heatCanvas has no external images drawn on it.
        const imageData = heatCtx.getImageData(0, 0, width, height);
        const data = imageData.data; // R, G, B, A array
        const palette = this.palette;

        // Create new image data for the visible canvas
        const outputData = ctx.createImageData(width, height);
        const out = outputData.data;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3]; // Get the accumulated alpha

            if (alpha > 0) {
                // Map alpha (0-255) to palette index
                // Palette is 256 pixels wide (1024 bytes: R,G,B,A)
                const offset = alpha * 4;

                out[i] = palette[offset];     // R
                out[i + 1] = palette[offset + 1]; // G
                out[i + 2] = palette[offset + 2]; // B
                out[i + 3] = palette[offset + 3]; // A (from palette, usually 255 unless low end of gradient)

                // Optional: Preserve some transparency for very low values if palette alpha is 0 at index 0
                // Our palette has alpha 0 at index 0, effectively handling the background.
            }
        }

        // 4. Put the colorized pixels onto the visible canvas
        ctx.putImageData(outputData, 0, 0);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
