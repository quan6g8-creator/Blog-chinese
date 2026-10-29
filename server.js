const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4321;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'dist');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const postsFile = path.join(DATA_DIR, 'posts.json');
const usersFile = path.join(DATA_DIR, 'users.json');
const tokensFile = path.join(DATA_DIR, 'tokens.json');

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function loadPosts() {
  return loadJSON(postsFile);
}

function savePosts(posts) {
  saveJSON(postsFile, posts);
}

function loadUsers() {
  return loadJSON(usersFile);
}

function saveUsers(users) {
  saveJSON(usersFile, users);
}

function loadTokens() {
  return loadJSON(tokensFile);
}

function saveTokens(tokens) {
  saveJSON(tokensFile, tokens);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function authToken(token) {
  const tokens = loadTokens();
  return tokens.find(t => t.token === token);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // API routes
  if (pathname.startsWith('/api/')) {
    try {
      if (req.method === 'POST' && pathname === '/api/login') {
        const { username, password } = await readBody(req);
        const users = loadUsers();
        const user = users.find(u => u.username === username && u.password === password);
        if (!user) {
          return sendJSON(res, 401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }
        const token = generateToken();
        const tokens = loadTokens();
        tokens.push({ token, userId: user.username });
        saveTokens(tokens);
        return sendJSON(res, 200, {
          token,
          user: { username: user.username, email: user.email, level: user.level, createdAt: user.createdAt }
        });
      }

      if (req.method === 'POST' && pathname === '/api/register') {
        const { username, email, password, level } = await readBody(req);
        const users = loadUsers();
        if (users.find(u => u.username === username)) {
          return sendJSON(res, 400, { error: 'Tên đăng nhập đã tồn tại' });
        }
        if (users.find(u => u.email === email)) {
          return sendJSON(res, 400, { error: 'Email đã được đăng ký' });
        }
        if (!['beginner', 'elementary', 'intermediate', 'advanced', 'admin'].includes(level)) {
          return sendJSON(res, 400, { error: 'Trình độ không hợp lệ' });
        }
        const newUser = {
          username,
          email,
          password,
          level,
          createdAt: new Date().toISOString()
        };
        users.push(newUser);
        saveUsers(users);
        const token = generateToken();
        const tokens = loadTokens();
        tokens.push({ token, userId: newUser.username });
        saveTokens(tokens);
        return sendJSON(res, 201, {
          token,
          user: { username: newUser.username, email: newUser.email, level: newUser.level, createdAt: newUser.createdAt }
        });
      }

      if (req.method === 'GET' && pathname === '/api/me') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const userToken = authToken(token);
        if (!userToken) {
          return sendJSON(res, 401, { error: 'Vui lòng đăng nhập' });
        }
        const users = loadUsers();
        const user = users.find(u => u.username === userToken.userId);
        if (!user) {
          return sendJSON(res, 404, { error: 'Không tìm thấy tài khoản' });
        }
        return sendJSON(res, 200, user);
      }

      if (req.method === 'GET' && pathname === '/api/posts') {
        const posts = loadPosts();
        return sendJSON(res, 200, posts);
      }

      if (req.method === 'POST' && pathname === '/api/posts') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token || !authToken(token)) {
          return sendJSON(res, 401, { error: 'Vui lòng đăng nhập để đăng bài' });
        }
        const { title, content, tags = [] } = await readBody(req);
        if (!title || !content) {
          return sendJSON(res, 400, { error: 'Vui lòng nhập tiêu đề và nội dung' });
        }
        const users = loadUsers();
        const currentUser = users.find(u => u.username === authToken(token).userId);
        if (!currentUser) {
          return sendJSON(res, 401, { error: 'Không tìm thấy tài khoản' });
        }
        const posts = loadPosts();
        const newPost = {
          id: crypto.randomUUID(),
          title,
          content,
          tags,
          author: { username: currentUser.username, email: currentUser.email, level: currentUser.level },
          status: currentUser.level === 'admin' || currentUser.level === 'Admin' ? 'published' : 'pending',
          createdAt: new Date().toISOString()
        };
        posts.push(newPost);
        savePosts(posts);
        return sendJSON(res, 201, newPost);
      }

      if (req.method === 'POST' && /^\/api\/posts\/[^/]+$/.test(pathname)) {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token || !authToken(token)) {
          return sendJSON(res, 401, { error: 'Vui lòng đăng nhập' });
        }
        const users = loadUsers();
        const user = users.find(u => u.username === authToken(token).userId);
        if (!user || (user.level !== 'admin' && user.level !== 'Admin')) {
          return sendJSON(res, 403, { error: 'Chỉ admin mới có quyền quản lý bài viết' });
        }
        const { id } = pathname.split('/').filter(Boolean).slice(-1)[0];
        const posts = loadPosts();
        const postIndex = posts.findIndex(p => p.id === id);
        if (postIndex === -1) {
          return sendJSON(res, 404, { error: 'Không tìm thấy bài viết' });
        }
        const post = posts[postIndex];
        if (post.status === 'published') {
          return sendJSON(res, 400, { error: 'Bài viết đã được xuất bản' });
        }
        const action = pathname.split('/').filter(Boolean).slice(-2)[0];
        if (action === 'approve') {
          post.status = 'published';
        } else if (action === 'reject') {
          post.status = 'rejected';
        } else {
          return sendJSON(res, 400, { error: 'Hành động không hợp lệ' });
        }
        posts[postIndex] = post;
        savePosts(posts);
        return sendJSON(res, 200, post);
      }

      return sendJSON(res, 404, { error: 'Không tìm thấy endpoint' });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Lỗi server nội bộ' });
    }
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webp': 'image/webp',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.txt': 'text/plain; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
