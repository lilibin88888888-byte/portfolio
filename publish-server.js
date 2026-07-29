/**
 * publish-server.js — 本地发布服务
 * 接收前端发送的 data.js 内容，写入文件并推送到 GitHub
 *
 * 启动方式：node publish-server.js
 * 默认端口：9999
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 9999;
const ROOT = __dirname;

function run(cmd, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) reject(stderr || stdout || err.message);
      else resolve(stdout);
    });
  });
}

function sendProgress(res, progress, message, done = false, success = true, error = null) {
  const data = JSON.stringify({ progress, message, done, success, error });
  res.write(data + '\n');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/publish' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        sendProgress(res, 10, '接收数据...');
        const { content } = JSON.parse(body);
        if (!content || typeof content !== 'string') {
          throw new Error('缺少 data.js 内容');
        }

        sendProgress(res, 25, '写入 data.js...');
        fs.writeFileSync(path.join(ROOT, 'data.js'), content);

        sendProgress(res, 45, '检查仓库状态...');
        const status = await run('git status --porcelain');
        if (!status.trim()) {
          sendProgress(res, 100, '没有需要发布的更改', true, true);
          res.end();
          return;
        }

        sendProgress(res, 60, '提交更改...');
        await run('git add -A && git commit -m "publish: update portfolio data"');

        sendProgress(res, 80, '推送到 GitHub...');
        await run('git push --force origin main');

        sendProgress(res, 100, '发布成功！约 1-2 分钟后网站更新。', true, true);
        res.end();
      } catch (err) {
        sendProgress(res, 100, '发布失败：' + err, true, false, String(err));
        res.end();
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`发布服务已启动：http://localhost:${PORT}`);
  console.log('在编辑模式下点击“发布到 GitHub”按钮即可使用');
});
