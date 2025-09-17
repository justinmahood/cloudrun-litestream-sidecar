const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const port = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || 'poll.db';

// --- WebSocket Setup ---
wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(JSON.stringify(data));
    }
  });
}

// In-memory state for the stress test
let worker = {
  interval: null,
  isRunning: false,
  writesPerSecond: 0
};
let stats = {
  usersCreatedThisSession: 0,
  postsCreatedThisSession: 0,
};

console.log(`--- Node App Started [${new Date().toISOString()}] ---`);
console.log(`DB_PATH is set to: ${DB_PATH}`);

console.log('Attempting to connect to database...');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('!!! FAILED TO CONNECT TO DATABASE !!!');
    console.error(err.message);
    process.exit(1);
  }
  console.log('+++ Successfully connected to the SQLite database. +++');

  db.exec('PRAGMA journal_mode = WAL;', (err) => {
    if (err) {
      console.error('!!! FAILED TO ENABLE WAL MODE !!!');
      console.error(err.message);
      process.exit(1);
    }
    console.log('+++ WAL mode enabled. +++');

    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        content TEXT,
        created_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
    `;
    db.exec(schema, (err) => {
      if (err) {
        console.error('!!! FAILED TO INITIALIZE SCHEMA !!!', err.message);
        process.exit(1);
      }
      console.log('+++ Database schema initialized. +++');
    });
  });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API Endpoints ---

app.post('/posts', async (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'Name and content are required.' });
  }
  const createdAt = new Date().toISOString();

  try {
    // Use a transaction for atomicity 
    await db.run('BEGIN');
    const userSql = `INSERT INTO users (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`;
    await db.run(userSql, [name, createdAt]);

    const user = await db.get('SELECT id FROM users WHERE name = ?', [name]);
    if (!user) {
      throw new Error('Failed to find or create user.');
    }

    const postSql = `INSERT INTO posts (user_id, content, created_at) VALUES (?, ?, ?)`;
    await db.run(postSql, [user.id, content, createdAt]);
    
    await db.run('COMMIT');

    broadcast({ type: 'NEW_POST', payload: { name, content, created_at: createdAt } });
    res.status(201).json({ message: 'Post created' });
  } catch (err) {
    console.error('Post creation failed:', err.message);
    await db.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.get('/posts', async (req, res) => {
  try {
    const sql = `
      SELECT p.content, p.created_at, u.name
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
      LIMIT 20;
    `;
    const rows = await db.all(sql, []);
    res.json(rows);
  } catch (err) {
    console.error('Get posts failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/test/start', (req, res) => {
  if (worker.isRunning) {
    return res.status(400).json({ message: 'Worker is already running.' });
  }
  worker.isRunning = true;
  worker.writesPerSecond = parseInt(req.body.writesPerSecond) || 10;
  
  worker.interval = setInterval(async () => {
    try {
      let newPost = null;
      let newUser = null;
      const createdAt = new Date().toISOString();

      if (Math.random() < 0.8) {
        const userCountRes = await db.get('SELECT COUNT(*) as count FROM users');
        if (userCountRes.count > 0) {
          const randomUser = await db.get('SELECT id, name FROM users ORDER BY RANDOM() LIMIT 1');
          const content = `Automated post: ${crypto.randomBytes(8).toString('hex')}`;
          await db.run('INSERT INTO posts (user_id, content, created_at) VALUES (?, ?, ?)', [randomUser.id, content, createdAt]);
          stats.postsCreated++;
          newPost = { name: randomUser.name, content, created_at: createdAt };
        }
      } else {
        const name = `user_${crypto.randomBytes(4).toString('hex')}`;
        await db.run('INSERT INTO users (name, created_at) VALUES (?, ?)', [name, createdAt]);
        stats.usersCreated++;
      }
      if (newPost) {
        broadcast({ type: 'NEW_POST', payload: newPost });
      }
    } catch (e) { /* ignore errors during stress test */ }
  }, 1000 / worker.writesPerSecond);

  res.json({ message: `Stress test started with ${worker.writesPerSecond} writes/sec.` });
});

app.post('/test/stop', (req, res) => {
  if (!worker.isRunning) {
    return res.status(400).json({ message: 'Worker is not running.' });
  }
  clearInterval(worker.interval);
  worker.isRunning = false;
  res.json({ message: 'Stress test stopped.' });
});

app.get('/test/status', async (req, res) => {
  try {
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    const postCount = await db.get('SELECT COUNT(*) as count FROM posts');

    res.json({
      usersCreatedThisSession: stats.usersCreatedThisSession,
      postsCreatedThisSession: stats.postsCreatedThisSession,
      isRunning: worker.isRunning,
      writesPerSecond: worker.writesPerSecond,
      totalUsers: userCount.count,
      totalPosts: postCount.count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- UI --- 

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Litestream Stress Test</title>
      <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; background: #f0f2f5; }
        .container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 80%; max-width: 800px; margin-top: 2rem; }
        h1, h2 { text-align: center; color: #333; }
        .section { margin-bottom: 2rem; border-top: 1px solid #ddd; padding-top: 1rem; }
        form { display: flex; flex-direction: column; gap: 0.5rem; }
        input, textarea, button { font-size: 1rem; padding: 0.5rem; border-radius: 4px; border: 1px solid #ccc; }
        button { background-color: #007bff; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        #feed { max-height: 400px; overflow-y: auto; border: 1px solid #eee; padding: 1rem; border-radius: 4px; }
        .post { border-bottom: 1px solid #eee; padding: 0.5rem 0; background-color: #fff; transition: background-color 1s; }
        .post:last-child { border-bottom: none; }
        .post.new { background-color: #e7f3ff; }
        .post strong { color: #007bff; }
        #stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Litestream Stress Test</h1>
        
        <div class="section">
          <h2>Manual Post</h2>
          <form id="post-form">
            <input type="text" id="name" placeholder="Your Name" required>
            <textarea id="content" placeholder="What's on your mind?" required></textarea>
            <button type="submit">Post</button>
          </form>
        </div>

        <div class="section">
          <h2>Automated Stress Test</h2>
          <div id="stats">
            <p><strong>Status:</strong> <span id="worker-status">Stopped</span></p>
            <p><strong>Writes/Sec:</strong> <span id="writes-per-sec">0</span></p>
            <p><strong>Users Created (Session):</strong> <span id="users-created-session">0</span></p>
            <p><strong>Posts Created (Session):</strong> <span id="posts-created-session">0</span></p>
            <p><strong>Total Users (DB):</strong> <span id="total-users">0</span></p>
            <p><strong>Total Posts (DB):</strong> <span id="total-posts">0</span></p>
          </div>
          <form id="stress-form">
            <input type="number" id="wps" value="50" placeholder="Writes per second">
            <button type="submit">Start Test</button>
            <button type="button" id="stop-btn">Stop Test</button>
          </form>
        </div>

        <div class="section">
          <h2>Live Feed</h2>
          <div id="feed"></div>
        </div>
      </div>

      <script>
        const postForm = document.getElementById('post-form');
        const stressForm = document.getElementById('stress-form');
        const stopBtn = document.getElementById('stop-btn');
        const feedDiv = document.getElementById('feed');

        // --- WebSocket Connection ---
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const socket = new WebSocket(protocol + '://' + window.location.host);

        socket.onopen = () => console.log('WebSocket connection established');
        socket.onclose = () => console.log('WebSocket connection closed');
        socket.onerror = (error) => console.error('WebSocket Error:', error);
        socket.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'NEW_POST') {
            prependPost(data.payload);
          }
        };

        function createPostElement(post) {
            const el = document.createElement('div');
            el.className = 'post new';
            el.innerHTML = '<strong>' + post.name + '</strong>: ' + post.content +
                         '<br><small>' + new Date(post.created_at).toLocaleString() + '</small>';
            // Remove the 'new' class after animation
            setTimeout(() => el.classList.remove('new'), 1000);
            return el;
        }

        function prependPost(post) {
            const postElement = createPostElement(post);
            feedDiv.prepend(postElement);
            // Keep the feed to a max of 20 posts
            while (feedDiv.children.length > 20) {
                feedDiv.removeChild(feedDiv.lastChild);
            }
        }

        // --- Manual Posting ---
        postForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = document.getElementById('name').value;
          const content = document.getElementById('content').value;
          await fetch('/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content })
          });
          postForm.reset();
        });

        // --- Stress Test Controls ---
        stressForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const writesPerSecond = document.getElementById('wps').value;
          await fetch('/test/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ writesPerSecond })
          });
        });

        stopBtn.addEventListener('click', async () => {
          await fetch('/test/stop', { method: 'POST' });
        });

        // --- Data Fetching ---
        async function fetchInitialFeed() {
          const res = await fetch('/posts');
          const posts = await res.json();
          feedDiv.innerHTML = ''; // Clear existing
          posts.forEach(post => feedDiv.appendChild(createPostElement(post)));
        }

        async function fetchStatus() {
          const res = await fetch('/test/status');
          const status = await res.json();
          document.getElementById('worker-status').textContent = status.isRunning ? 'Running' : 'Stopped';
          document.getElementById('writes-per-sec').textContent = status.writesPerSecond;
          document.getElementById('users-created-session').textContent = status.usersCreatedThisSession;
          document.getElementById('posts-created-session').textContent = status.postsCreatedThisSession;
          document.getElementById('total-users').textContent = status.totalUsers;
          document.getElementById('total-posts').textContent = status.totalPosts;
        }

        // --- Initial Load & Periodic Refresh ---
        fetchInitialFeed();
        fetchStatus();
        setInterval(fetchStatus, 2000); // Refresh stats every 2 seconds
      </script>
    </body>
    </html>
  `);
});

// We now need to listen on the http server, not the express app
server.listen(port, () => {
  console.log(`+++ App is running and listening on port ${port} +++`);
});

// Promisify db methods for async/await usage in worker
const util = require('util');
db.run = util.promisify(db.run);
db.get = util.promisify(db.get);
db.all = util.promisify(db.all);
