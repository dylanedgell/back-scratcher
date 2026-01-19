const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory session store
// Structure: { sessionId: { clients: Set<ws>, touches: Array<{x, y, timestamp}> } }
const sessions = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');

    if (!sessionId) {
        // If no session ID in WS connection, wait for 'join' message or handle logic
        // For simplicity, we expect the client to connect with ?session=ID
        ws.close();
        return;
    }

    // Initialize session if it doesn't exist
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            clients: new Set(),
            touches: []
        });
    }

    const session = sessions.get(sessionId);
    session.clients.add(ws);

    console.log(`Client joined session: ${sessionId}. Total clients: ${session.clients.size}`);

    // Send initial state (existing touches) to the new client
    ws.send(JSON.stringify({
        type: 'init',
        touches: session.touches
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'touch') {
                // Add timestamp and store touch
                const touchPoint = {
                    x: data.x,
                    y: data.y,
                    timestamp: Date.now()
                };
                session.touches.push(touchPoint);

                // Broadcast to ALL clients in this session (including sender, to confirm receipt/simple logic)
                // Or sender can update optimistically. Let's broadcast to all.
                const updateMsg = JSON.stringify({
                    type: 'update',
                    touch: touchPoint
                });

                session.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(updateMsg);
                    }
                });
            }

            if (data.type === 'clear') {
                session.touches = [];
                const clearMsg = JSON.stringify({ type: 'clear' });
                session.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(clearMsg);
                    }
                });
            }

            if (data.type === 'claim_control') {
                // Broadcast to others so they know they lost control
                // We don't enforce only-one-creator on server strictly, we trust clients.
                // Simpler for MVP.
                const claimMsg = JSON.stringify({ type: 'claim_control' });
                session.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) { // Don't send back to sender (optional)
                        client.send(claimMsg);
                    }
                });
            }

        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        if (sessions.has(sessionId)) {
            const session = sessions.get(sessionId);
            session.clients.delete(ws);
            console.log(`Client left session: ${sessionId}. Remaining clients: ${session.clients.size}`);

            // Optional: cleanup empty sessions after a delay
            if (session.clients.size === 0) {
                // Keep data for a bit in case of refresh, but for now we leave it in memory
                // setTimeout(() => { ... }, 30000); 
            }
        }
    });
});

// API endpoint to generate a new session
app.get('/api/create-session', (req, res) => {
    const sessionId = crypto.randomBytes(4).toString('hex');
    // Pre-initialize? Not strictly necessary as WS will do it on connect, 
    // but good for validation if we wanted strict session existence checks.
    sessions.set(sessionId, { clients: new Set(), touches: [] });
    res.json({ sessionId });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
