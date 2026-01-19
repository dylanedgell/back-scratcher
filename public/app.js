const app = {
    ws: null,
    sessionId: null,
    canvas: document.getElementById('scratch-canvas'),
    ctx: document.getElementById('scratch-canvas').getContext('2d'),

    // Off-screen buffer for SAFE heat caching
    heatCanvas: document.createElement('canvas'),
    heatCtx: null,

    touches: [],

    // Config
    gradient: null,
    FADE_DURATION: 10000,
    isCreator: false,

    init() {
        this.heatCtx = this.heatCanvas.getContext('2d', { willReadFrequently: true });
        this.createGradient();

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

    createGradient() {
        // Create the rainbow lookup table (256 colors)
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 256, 1);

        // Classic Heatmap: Blue -> Cyan -> Green -> Yellow -> Red
        gradient.addColorStop(0.0, 'rgba(0,0,255,1)');
        gradient.addColorStop(0.2, 'rgba(0,255,255,1)');
        gradient.addColorStop(0.4, 'rgba(0,255,0,1)');
        gradient.addColorStop(0.6, 'rgba(255,255,0,1)');
        gradient.addColorStop(1.0, 'rgba(255,0,0,1)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 1);
        this.gradient = ctx.getImageData(0, 0, 256, 1).data;
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
            // Sync buffer size to display canvas
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.heatCanvas.width = rect.width;
            this.heatCanvas.height = rect.height;
            this.renderHeatmap();
        }
    },

    renderHeatmap() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const now = Date.now();

        // 1. Draw Intensity Analysis on the OFF-SCREEN buffer
        // We act like this is a grayscale image where alpha = intensity
        const hCtx = this.heatCtx;
        hCtx.clearRect(0, 0, width, height);

        let activeTouches = 0;

        this.touches.forEach(touch => {
            let age = now - touch.timestamp;
            if (age < 0) age = 0;
            if (age > this.FADE_DURATION) return;

            activeTouches++;

            const life = 1 - (age / this.FADE_DURATION);
            const x = touch.x * width;
            const y = touch.y * height;
            // Slightly smaller radius for sharper heatmap feel?
            const radius = 40;

            // Draw a black circle with alpha varying by life
            // Alpha of 0.1-0.2 stacks up quickly to 1.0
            const alpha = 0.2 * life;

            const gradient = hCtx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');

            hCtx.fillStyle = gradient;
            hCtx.beginPath();
            hCtx.arc(x, y, radius, 0, Math.PI * 2);
            hCtx.fill();
        });

        // Clear the main visible canvas
        this.ctx.clearRect(0, 0, width, height);

        if (activeTouches === 0) return;

        // 2. Read intensity -> Map to Color
        // This is safe because hCtx only has our black spots, nothing else.
        const intensityData = hCtx.getImageData(0, 0, width, height);
        const intensityPixels = intensityData.data; // The black pixels
        const gradient = this.gradient; // The rainbow lookup

        const outputData = this.ctx.createImageData(width, height);
        const outputPixels = outputData.data;

        // Loop through pixels
        for (let i = 0; i < intensityPixels.length; i += 4) {
            // Check alpha channel (3) of intensity map
            const a = intensityPixels[i + 3];

            if (a > 0) {
                // 'a' is 0-255. Map this to our gradient index.
                // We want higher sensitivity? 'a' is already accumulated opacity.
                // If 3-4 spots overlap, 'a' gets close to 255.

                // Map 0-255 alpha -> 0-255 gradient index
                // Multiply map by 2 to make it "hotter" faster?
                let gradIndex = a * 3;
                if (gradIndex > 255) gradIndex = 255;

                const gBase = Math.floor(gradIndex) * 4;

                outputPixels[i] = gradient[gBase];     // R
                outputPixels[i + 1] = gradient[gBase + 1]; // G
                outputPixels[i + 2] = gradient[gBase + 2]; // B

                // Final Alpha: 
                // We want the heatmap to be semi-transparent so we can see the back image.
                // But solid enough to see color.
                // Gradient has alpha 1.0 (255).
                // Let's create a "Ghostly" effect:
                // Use the intensity (a) * 0.8 as the alpha?
                outputPixels[i + 3] = Math.max(a, 160); // Min alpha 160 for visibility
            }
        }

        this.ctx.putImageData(outputData, 0, 0);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
