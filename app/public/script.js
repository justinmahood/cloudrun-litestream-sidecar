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
  } else if (data.type === 'UPDATED_POST') {
    updatePost(data.payload);
  } else if (data.type === 'DELETED_POST') {
    deletePost(data.payload.id);
  }
};

function createPostElement(post) {
    const el = document.createElement('div');
    el.className = 'post new';
    el.id = `post-${post.id}`;
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

function updatePost(post) {
    const postElement = document.getElementById(`post-${post.id}`);
    if (postElement) {
        postElement.innerHTML = '<strong>' + post.name + '</strong>: ' + post.content +
                 '<br><small>' + new Date(post.created_at).toLocaleString() + ' (updated)</small>';
        postElement.classList.add('new');
        setTimeout(() => postElement.classList.remove('new'), 1000);
    }
}

function deletePost(postId) {
    const postElement = document.getElementById(`post-${postId}`);
    if (postElement) {
        postElement.remove();
    }
}

const searchForm = document.getElementById('search-form');
const searchQuery = document.getElementById('search-query');

// --- Search ---
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  fetchSearchResults();
});

searchQuery.addEventListener('keyup', () => {
  fetchSearchResults();
});

async function fetchSearchResults() {
  const query = searchQuery.value;
  if (!query) {
    fetchInitialFeed();
    return;
  }

  const res = await fetch(`/search?q=${query}`);
  const posts = await res.json();
  feedDiv.innerHTML = ''; // Clear existing
  posts.forEach(post => feedDiv.appendChild(createPostElement(post)));
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

const stressTestSide = document.getElementById('stress-test-side');
let clientWorker = { interval: null, isRunning: false };

// --- Stress Test Controls ---
stressForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const writesPerSecond = document.getElementById('wps').value;

  if (stressTestSide.checked) {
    // Client-side stress test
    if (clientWorker.isRunning) return;
    clientWorker.isRunning = true;
    clientWorker.interval = setInterval(async () => {
      const action = Math.random();
      if (action < 0.7) { // 70% chance to create a post
        const name = `user_${Math.random().toString(36).substring(2, 10)}`
        const content = `Client-side post: ${Math.random().toString(36).substring(2, 10)}`
        await fetch('/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Stress-Test': 'true' },
          body: JSON.stringify({ name, content })
        });
      } else if (action < 0.85) { // 15% chance to update a post
        // Not implemented for client-side test, as we don't have post IDs
      } else if (action < 0.95) { // 10% chance to delete a post
        // Not implemented for client-side test, as we don't have post IDs
      } else { // 5% chance to create a user
        const name = `user_${Math.random().toString(36).substring(2, 10)}`
        await fetch('/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Stress-Test': 'true' },
          body: JSON.stringify({ name, content: 'This is a user creation post.' })
        });
      }
    }, 1000 / writesPerSecond);
  } else {
    // Server-side stress test
    await fetch('/test/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writesPerSecond })
    });
  }
});

stopBtn.addEventListener('click', async () => {
  if (stressTestSide.checked) {
    // Client-side stress test
    clearInterval(clientWorker.interval);
    clientWorker.isRunning = false;
  } else {
    // Server-side stress test
    await fetch('/test/stop', { method: 'POST' });
  }
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
  document.getElementById('posts-updated-session').textContent = status.postsUpdatedThisSession;
  document.getElementById('posts-deleted-session').textContent = status.postsDeletedThisSession;
  document.getElementById('total-users').textContent = status.totalUsers;
  document.getElementById('total-posts').textContent = status.totalPosts;
  document.getElementById('db-file-size').textContent = `${(status.dbFileSize / 1024).toFixed(2)} KB`;
}

// --- Initial Load & Periodic Refresh ---
fetchInitialFeed();
fetchStatus();
setInterval(fetchStatus, 2000); // Refresh stats every 2 seconds