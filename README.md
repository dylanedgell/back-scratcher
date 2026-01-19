# Scratchanitch 🖐️

A real-time collaborative web app that lets you show someone *exactly* where you need a scratch.

**Features:**
- **Real-time Heatmap**: Touch points appear instantly on connected devices.
- **True Heatmap Visualization**: Spots transition from Blue (new) → Green → Red (intense) as you tap.
- **Auto-Fading**: Scratches naturally fade away after 10 seconds.
- **One-Way Communication**: Only the "Creator" can add spots; the "Helper" just sees them.

## 🚀 How to Run Locally

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   ```

3. **Open Access**
   - Go to `http://localhost:3000`
   - Click "Start a Scratch Session"
   - Share the generated link with a friend (or open in a new tab)

## ☁️ How to Deploy

Since this app uses **WebSockets** for real-time communication, it requires a running Node.js server. **Standard static hosts like Netlify or Vercel (Starter plan) will NOT work** because they don't support long-running WebSocket servers.

### Recommended: Render.com (Free Tier)
1. Push this code to a GitHub repository.
2. Sign up for [Render.com](https://render.com).
3. Click **New +** -> **Web Service**.
4. Connect your GitHub repo.
5. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Click **Deploy**. Render will give you a URL (e.g., `back-scratcher.onrender.com`).

### Alternative: Glitch.com (Easiest for quick sharing)
1. Go to [Glitch.com](https://glitch.com).
2. Click **New Project** -> **Import from GitHub** (after you push this code).
3. It will run automatically!

## 🔗 How it Works
1. **One Deployment URL**: You deploy the app to *one* place (e.g., `myapp.com`).
2. **Session Links**: When you click "Start Session", the app adds a unique ID to the URL (e.g., `myapp.com/?session=xyz`).
3. **Sharing**: You just send that specific session link to your helper. They don't need to install anything.

## 🛠️ Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS + Canvas API
- **Backend**: Node.js + Express
- **Real-time**: `ws` (WebSocket library)
