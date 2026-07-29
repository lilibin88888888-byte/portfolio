const fs = require('fs');

const dataPath = '/Users/abin/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a66d0cd59406ce57e60fe9f/data.js';
const text = fs.readFileSync(dataPath, 'utf8');

const start = text.indexOf('window.resumeData = ');
if (start === -1) {
  console.error('无法解析 data.js');
  process.exit(1);
}
let jsonText = text.slice(start + 'window.resumeData = '.length).replace(/;\s*$/, '');

let data;
try {
  data = JSON.parse(jsonText);
} catch (e) {
  let depth = 0, end = 0;
  for (let i = 0; i < jsonText.length; i++) {
    if (jsonText[i] === '{' || jsonText[i] === '[') depth++;
    else if (jsonText[i] === '}' || jsonText[i] === ']') {
      depth--;
      if (depth === 0) end = i + 1;
    }
  }
  data = JSON.parse(jsonText.slice(0, end));
}

const totalBytes = Buffer.byteLength(text, 'utf8');
console.log(`data.js 总大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`GitHub 限制: 100 MB`);
console.log(`超出: ${Math.max(0, (totalBytes - 100 * 1024 * 1024) / 1024 / 1024).toFixed(2)} MB`);
console.log('');

function getBase64Size(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round(base64.length * 0.75);
}

function getItemSize(img) {
  if (img && typeof img === 'object') {
    return getBase64Size(img.data) || getBase64Size(img.thumbnail);
  }
  if (typeof img === 'string') return getBase64Size(img);
  return 0;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

const allMedia = [];
for (const p of data.projects || []) {
  if (!p.images) continue;
  for (let i = 0; i < p.images.length; i++) {
    const img = p.images[i];
    const size = getItemSize(img);
    let type = 'image';
    if (img && typeof img === 'object' && img.type === 'pdf') type = 'pdf';
    if (img && typeof img === 'object' && img.type === 'video') type = 'video';
    allMedia.push({
      projectId: p.id,
      projectName: p.name,
      index: i,
      type,
      size,
      sizeFormatted: formatSize(size),
    });
  }
}

allMedia.sort((a, b) => b.size - a.size);
console.log(`共有 ${allMedia.length} 个媒体文件，按大小排序:`);
for (const m of allMedia) {
  console.log(`${m.projectName} [${m.type}] #${m.index + 1}: ${m.sizeFormatted}`);
}

console.log('');
console.log('前 10 个最大文件:');
for (let i = 0; i < Math.min(10, allMedia.length); i++) {
  const m = allMedia[i];
  console.log(`${i + 1}. ${m.projectName} [${m.type}] #${m.index + 1}: ${m.sizeFormatted}`);
}

let remaining = totalBytes;
let deleteCount = 0;
for (const m of allMedia) {
  if (remaining <= 100 * 1024 * 1024) break;
  remaining -= m.size;
  deleteCount++;
}
console.log('');
console.log(`需要删除前 ${deleteCount} 个最大文件才能低于 100MB`);
console.log(`删除后估算大小: ${(remaining / 1024 / 1024).toFixed(2)} MB`);
