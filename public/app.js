const API = '';
let authToken = localStorage.getItem('token') || null;
let currentUser = localStorage.getItem('username') || null;
let socket = null;
let feedBeforeId = null;
let followingSet = new Set();

function setAuth(token, username) {
  authToken = token; currentUser = username;
  localStorage.setItem('token', token);
  localStorage.setItem('username', username);
}

async function apiFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error || 'Request failed');
  return res.json();
}

function qs(sel) { return document.querySelector(sel); }
function ce(tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el; }

function showAuth(show) {
  qs('#authSection').hidden = !show;
  qs('#appSection').hidden = show;
  qs('#navActions').hidden = show;
  if (!show) qs('#currentUser').textContent = '@' + currentUser;
}

function renderPost(post) {
  const div = ce('div', 'card post');
  div.dataset.id = post.id;
  const header = ce('div', 'post-header');
  const left = ce('div');
  const usernameEl = ce('span', 'post-username');
  usernameEl.textContent = '@' + post.username;
  left.appendChild(usernameEl);

  const right = ce('div', 'post-actions');
  const followBtn = ce('button', 'btn small');
  followBtn.textContent = followingSet.has(post.username) || post.username === currentUser ? 'Following' : 'Follow';
  followBtn.disabled = post.username === currentUser;
  followBtn.addEventListener('click', async () => {
    try {
      if (followingSet.has(post.username)) {
        await apiFetch(`/api/follow/${encodeURIComponent(post.username)}`, { method: 'DELETE' });
        followingSet.delete(post.username);
        followBtn.textContent = 'Follow';
      } else {
        await apiFetch(`/api/follow/${encodeURIComponent(post.username)}`, { method: 'POST' });
        followingSet.add(post.username);
        followBtn.textContent = 'Following';
      }
    } catch (e) { toast(e.message, true); }
  });
  right.appendChild(followBtn);
  header.append(left, right);

  const content = ce('div');
  content.textContent = post.content;

  const actions = ce('div', 'post-actions');
  const likeBtn = ce('button', 'btn small'); likeBtn.textContent = 'Like';
  const likeCount = ce('span', 'count'); likeCount.textContent = `${post.like_count || 0} likes`;
  const commentToggle = ce('button', 'btn small'); commentToggle.textContent = 'Comments';

  likeBtn.addEventListener('click', async () => {
    try {
      // naive toggle: try like then unlike on failure
      try {
        const p = await apiFetch(`/api/posts/${post.id}/like`, { method: 'POST' });
        likeCount.textContent = `${p.like_count || 0} likes`;
        likeBtn.textContent = 'Liked';
      } catch {
        const p = await apiFetch(`/api/posts/${post.id}/like`, { method: 'DELETE' });
        likeCount.textContent = `${p.like_count || 0} likes`;
        likeBtn.textContent = 'Like';
      }
    } catch (e) { toast(e.message, true); }
  });

  actions.append(likeBtn, likeCount, commentToggle);

  const commentsBox = ce('div', 'comment-box'); commentsBox.hidden = true;
  const commentsList = ce('div');
  const commentForm = ce('form');
  const commentInput = ce('input'); commentInput.placeholder = 'Write a comment...';
  const commentBtn = ce('button', 'btn small'); commentBtn.textContent = 'Reply'; commentBtn.type = 'submit';
  commentForm.append(commentInput, commentBtn);

  async function loadComments() {
    try {
      const comments = await apiFetch(`/api/posts/${post.id}/comments?limit=20`);
      commentsList.innerHTML = '';
      comments.forEach(c => {
        const item = ce('div', 'comment');
        item.textContent = `@${c.username}: ${c.content}`;
        commentsList.appendChild(item);
      });
    } catch (e) { toast(e.message, true); }
  }

  commentForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const content = commentInput.value.trim();
    if (!content) return;
    try {
      await apiFetch(`/api/posts/${post.id}/comments`, { method: 'POST', body: { content } });
      commentInput.value = '';
      await loadComments();
    } catch (e) { toast(e.message, true); }
  });

  commentToggle.addEventListener('click', async () => {
    commentsBox.hidden = !commentsBox.hidden;
    if (!commentsBox.hidden) await loadComments();
  });

  commentsBox.append(commentsList, commentForm);

  div.append(header, content, actions, commentsBox);
  return div;
}

function renderFeed(posts, { append = false } = {}) {
  const feed = qs('#feed');
  if (!append) feed.innerHTML = '';
  posts.forEach(p => feed.appendChild(renderPost(p)));
}

async function loadFeed({ append = false } = {}) {
  const params = new URLSearchParams();
  if (feedBeforeId) params.set('beforeId', String(feedBeforeId));
  const feed = await apiFetch(`/api/feed?${params}`);
  if (feed.length > 0) {
    feedBeforeId = feed[feed.length - 1].id;
    renderFeed(feed, { append });
    qs('#loadMoreBtn').hidden = false;
  } else {
    if (!append) qs('#feed').innerHTML = '<div class="muted">No posts yet. Be the first!</div>';
    qs('#loadMoreBtn').hidden = true;
  }
}

function connectSocket() {
  socket = io();
  socket.on('connect', () => {
    if (currentUser) socket.emit('join', currentUser);
  });
  socket.on('post created', (post) => {
    const feed = qs('#feed');
    feed.prepend(renderPost(post));
  });
  socket.on('post deleted', ({ postId }) => {
    const el = qs(`.post[data-id="${postId}"]`);
    if (el) el.remove();
  });
  socket.on('post like updated', ({ postId, likeCount }) => {
    const postEl = qs(`.post[data-id="${postId}"]`);
    if (!postEl) return;
    const likeCountEl = postEl.querySelector('.count');
    if (likeCountEl) likeCountEl.textContent = `${likeCount || 0} likes`;
  });
  socket.on('comment added', ({ postId }) => {
    const postEl = qs(`.post[data-id="${postId}"]`);
    if (!postEl) return;
    // reload comments if open
    const box = postEl.querySelector('.comment-box');
    if (box && !box.hidden) {
      const toggle = postEl.querySelector('.post-actions .btn.small:last-child');
      if (toggle) toggle.click(); // close
      setTimeout(() => toggle && toggle.click(), 0); // reopen to reload
    }
  });
}

function toast(msg, isError = false) {
  console[isError ? 'error' : 'log'](msg);
}

async function refreshRelations() {
  if (!currentUser) return;
  try {
    const [following, followers] = await Promise.all([
      apiFetch(`/api/users/${encodeURIComponent(currentUser)}/following`),
      apiFetch(`/api/users/${encodeURIComponent(currentUser)}/followers`),
    ]);
    followingSet = new Set(following);
    const followingList = qs('#followingList');
    const followersList = qs('#followersList');
    followingList.innerHTML = '';
    followersList.innerHTML = '';
    following.forEach(u => { const li = ce('li'); li.textContent = '@' + u; followingList.appendChild(li); });
    followers.forEach(u => { const li = ce('li'); li.textContent = '@' + u; followersList.appendChild(li); });
  } catch (e) { /* ignore */ }
}

function bindAuthUI() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const tab = t.dataset.tab; qs(`#${tab}Form`).classList.add('active');
  }));

  qs('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: {
          username: String(fd.get('username')).trim(),
          password: String(fd.get('password')),
        }
      });
      setAuth(data.token, data.user.username);
      await afterAuth();
    } catch (e2) { toast(e2.message, true); }
  });

  qs('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: {
          username: String(fd.get('username')).trim(),
          email: String(fd.get('email') || ''),
          password: String(fd.get('password')),
        }
      });
      setAuth(data.token, data.user.username);
      await afterAuth();
    } catch (e2) { toast(e2.message, true); }
  });
}

function bindAppUI() {
  qs('#logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    authToken = null; currentUser = null;
    try { socket && socket.disconnect(); } catch {}
    showAuth(true);
  });

  qs('#postBtn').addEventListener('click', async () => {
    const input = qs('#composeInput');
    const content = input.value.trim();
    if (!content) return;
    try {
      await apiFetch('/api/posts', { method: 'POST', body: { content } });
      input.value = '';
    } catch (e) { toast(e.message, true); }
  });

  qs('#loadMoreBtn').addEventListener('click', async () => {
    try { await loadFeed({ append: true }); } catch (e) { toast(e.message, true); }
  });
}

async function afterAuth() {
  showAuth(false);
  await refreshRelations();
  feedBeforeId = null;
  await loadFeed();
  connectSocket();
}

async function init() {
  bindAuthUI();
  bindAppUI();
  if (authToken && currentUser) {
    try { await afterAuth(); } catch { showAuth(true); }
  } else {
    showAuth(true);
  }
}

document.addEventListener('DOMContentLoaded', init);
