const express = require('express');
const sqlite3 = require('sqlite3');
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
  postsUpdatedThisSession: 0,
  postsDeletedThisSession: 0,
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

app.use(express.static('public'));

// --- API Endpoints ---

app.post('/posts', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'Name and content are required.' });
  }
  const createdAt = new Date().toISOString();

  if (req.get('X-Stress-Test')) {
    if (content === 'This is a user creation post.') {
      stats.usersCreatedThisSession++;
    } else {
      stats.postsCreatedThisSession++;
    }
  }

  db.run('BEGIN', (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const userSql = `INSERT INTO users (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`;
    db.run(userSql, [name, createdAt], (err) => {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: err.message });
      }

      db.get('SELECT id FROM users WHERE name = ?', [name], (err, user) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }

        if (!user) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to find or create user.' });
        }

        const postSql = `INSERT INTO posts (user_id, content, created_at) VALUES (?, ?, ?)`;
        db.run(postSql, [user.id, content, createdAt], function (err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }

          const lastID = this.lastID;
          db.run('COMMIT', (err) => {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: err.message });
            }

            broadcast({ type: 'NEW_POST', payload: { id: lastID, name, content, created_at: createdAt } });
            res.status(201).json({ message: 'Post created' });
          });
        });
      });
    });
  });
});

app.get('/posts', (req, res) => {
  const sql = `
    SELECT p.id, p.content, p.created_at, u.name
    FROM posts p
    JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC
    LIMIT 20;
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Get posts failed:', err.message);
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/test/start', (req, res) => {
  if (worker.isRunning) {
    return res.status(400).json({ message: 'Worker is already running.' });
  }
  worker.isRunning = true;
  worker.writesPerSecond = parseInt(req.body.writesPerSecond) || 10;
  
  worker.interval = setInterval(() => {
    let newPost = null;
    let updatedPost = null;
    let deletedPostId = null;
    const createdAt = new Date().toISOString();

    const action = Math.random();

    if (action < 0.7) { // 70% chance to create a post
      db.get('SELECT COUNT(*) as count FROM users', (err, userCountRes) => {
        if (err) return;
        if (userCountRes.count > 0) {
          db.get('SELECT id, name FROM users ORDER BY RANDOM() LIMIT 1', (err, randomUser) => {
            if (err) return;
            const content = `Automated post: ${crypto.randomBytes(8).toString('hex')}`;
            db.run('INSERT INTO posts (user_id, content, created_at) VALUES (?, ?, ?)', [randomUser.id, content, createdAt], function (err) {
              if (err) return;
              stats.postsCreatedThisSession++;
              newPost = { id: this.lastID, name: randomUser.name, content, created_at: createdAt };
              broadcast({ type: 'NEW_POST', payload: newPost });
            });
          });
        }
      });
    } else if (action < 0.85) { // 15% chance to update a post
      db.get('SELECT COUNT(*) as count FROM posts', (err, postCountRes) => {
        if (err) return;
        if (postCountRes.count > 0) {
          db.get('SELECT id, user_id FROM posts ORDER BY RANDOM() LIMIT 1', (err, randomPost) => {
            if (err) return;
            const content = `Updated post: ${crypto.randomBytes(8).toString('hex')}`;
            db.run('UPDATE posts SET content = ? WHERE id = ?', [content, randomPost.id], (err) => {
              if (err) return;
              stats.postsUpdatedThisSession++;
              db.get('SELECT name FROM users WHERE id = ?', [randomPost.user_id], (err, user) => {
                if (err) return;
                updatedPost = { id: randomPost.id, name: user.name, content, created_at: createdAt };
                broadcast({ type: 'UPDATED_POST', payload: updatedPost });
              });
            });
          });
        }
      });
    } else if (action < 0.95) { // 10% chance to delete a post
      db.get('SELECT COUNT(*) as count FROM posts', (err, postCountRes) => {
        if (err) return;
        if (postCountRes.count > 0) {
          db.get('SELECT id FROM posts ORDER BY RANDOM() LIMIT 1', (err, randomPost) => {
            if (err) return;
            db.run('DELETE FROM posts WHERE id = ?', [randomPost.id], (err) => {
              if (err) return;
              stats.postsDeletedThisSession++;
              deletedPostId = randomPost.id;
              broadcast({ type: 'DELETED_POST', payload: { id: deletedPostId } });
            });
          });
        }
      });
    } else { // 5% chance to create a user
      const name = `user_${crypto.randomBytes(4).toString('hex')}`;
      db.run('INSERT INTO users (name, created_at) VALUES (?, ?)', [name, createdAt], (err) => {
        if (err) return;
        stats.usersCreatedThisSession++;
      });
    }
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

const fs = require('fs');

app.get('/test/status', (req, res) => {
  db.get('SELECT COUNT(*) as count FROM users', (err, userCount) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    db.get('SELECT COUNT(*) as count FROM posts', (err, postCount) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const fileStats = fs.statSync(DB_PATH);
      const fileSizeInBytes = fileStats.size;
      res.json({
        usersCreatedThisSession: stats.usersCreatedThisSession,
        postsCreatedThisSession: stats.postsCreatedThisSession,
        postsUpdatedThisSession: stats.postsUpdatedThisSession,
        postsDeletedThisSession: stats.postsDeletedThisSession,
        isRunning: worker.isRunning,
        writesPerSecond: worker.writesPerSecond,
        totalUsers: userCount.count,
        totalPosts: postCount.count,
        dbFileSize: fileSizeInBytes
      });
    });
  });
});

// --- UI --- 

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// We now need to listen on the http server, not the express app
server.listen(port, () => {
  console.log(`+++ App is running and listening on port ${port} +++`);
});


