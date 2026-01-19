const app = {
    ws: null,
    sessionId: null,
    canvas: document.getElementById('scratch-canvas'),
    ctx: document.getElementById('scratch-canvas').getContext('2d'),
    touches: [], // Array<{x, y, timestamp}>

    // Config
    FADE_DURATION: 10000,
    isCreator: false,

    init() {
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
        const width = this.canvas.width;
        const height = this.canvas.height;
        const ctx = this.ctx;
        const now = Date.now();

        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';

        this.touches.forEach(touch => {
            let age = now - touch.timestamp;
            if (age < 0) age = 0;
            if (age > this.FADE_DURATION) return;

            const life = 1 - (age / this.FADE_DURATION);
            const x = touch.x * width;
            const y = touch.y * height;
            const radius = 35;

            // Simple Red Blob Logic
            // Start at 0.8 opacity and fade to 0
            const alpha = 0.8 * life;

            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            // Center: Red
            gradient.addColorStop(0, `rgba(255, 50, 50, ${alpha})`);
            // Edge: Transparent
            gradient.addColorStop(1, 'rgba(255, 50, 50, 0)');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
