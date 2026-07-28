// ============================================================
// app.js — Core application logic
// Handles: rendering, CRUD, edit mode, image compression, import/export
// ============================================================

const App = (() => {
  // --- State ---
  let data = null;
  let editMode = false;
  let activeFilter = 'all';
  let imageUploadTarget = null; // { type: 'project', id: 'proj-x' }
  let lightboxImages = []; // current gallery images
  let lightboxIndex = 0;  // current image index in gallery
  let lbScale = 1, lbX = 0, lbY = 0; // zoom & pan state
  let lbDragging = false, lbDragStartX = 0, lbDragStartY = 0, lbStartX = 0, lbStartY = 0;
  let lbPinchStartDist = 0, lbPinchStartScale = 1;
  let lbPdfDoc = null, lbPdfPage = 1, lbPdfTotalPages = 1;
  let lbPdfProjectId = null, lbPdfImageIndex = -1; // 追踪当前 PDF 所属项目和索引

  // --- Utilities ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const uid = () => 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (str) => { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; };
  const nl2br = (str) => esc(str).replace(/\n/g, '<br>');

  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function getNestedValue(obj, path) {
    return path.split('.').reduce((o, k) => (o || {})[k], obj);
  }

  function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[last] = value;
  }

  // --- Image Compression ---
  // 读取图片或PDF文件，返回 data URL 或 PDF 标记对象
  function compressImage(file) {
    return new Promise((resolve) => {
      if (file.type === 'application/pdf') {
        // PDF: 生成缩略图用于画廊展示，存储完整PDF数据
        const reader = new FileReader();
        reader.onload = (e) => {
          const pdfDataUrl = e.target.result;
          renderPdfThumbnail(pdfDataUrl).then(thumbnail => {
            resolve({ type: 'pdf', data: pdfDataUrl, thumbnail: thumbnail });
          }).catch(() => {
            const placeholder = generatePdfPlaceholder(file.name);
            resolve({ type: 'pdf', data: pdfDataUrl, thumbnail: placeholder });
          });
        };
        reader.readAsDataURL(file);
      } else if (file.type.startsWith('video/')) {
        // 视频: 读取为 data URL，生成缩略图
        const reader = new FileReader();
        reader.onload = async (e) => {
          const videoDataUrl = e.target.result;
          const thumbnail = await generateVideoThumbnail(file);
          resolve({ type: 'video', data: videoDataUrl, thumbnail: thumbnail, mimeType: file.type, name: file.name });
        };
        reader.readAsDataURL(file);
      } else {
        // 图片: 直接读取原图（包括 GIF）
        const reader = new FileReader();
        reader.onload = (e) => { resolve(e.target.result); };
        reader.readAsDataURL(file);
      }
    });
  }

  function getImgSrc(img) {
    if (!img) return '';
    if (typeof img !== 'object') return img;
    return img.thumbnail || img;
  }

  function isPdfItem(img) {
    return img && typeof img === 'object' && img.type === 'pdf';
  }

  function isVideoItem(img) {
    return img && typeof img === 'object' && img.type === 'video';
  }

  function isMediaItem(img) {
    return isPdfItem(img) || isVideoItem(img);
  }

  // 生成视频缩略图
  function generateVideoThumbnail(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      const url = URL.createObjectURL(file);
      video.onloadeddata = () => {
        video.currentTime = Math.min(1, video.duration / 4);
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 400;
        canvas.height = video.videoHeight || 300;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(url);
        resolve(thumbnail);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        // 回退：生成一个视频占位图
        const canvas = document.createElement('canvas');
        canvas.width = 400; canvas.height = 300;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, 400, 300);
        ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.strokeRect(20, 20, 360, 260);
        ctx.fillStyle = '#00d4ff'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center';
        // 播放按钮三角
        ctx.beginPath(); ctx.moveTo(170, 120); ctx.lineTo(240, 150); ctx.lineTo(170, 180); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#999'; ctx.font = '14px sans-serif';
        const name = file.name.length > 30 ? file.name.slice(0, 27) + '...' : file.name;
        ctx.fillText(name, 200, 240);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      video.src = url;
    });
  }

  function renderPdfThumbnail(pdfDataUrl) {
    return new Promise((resolve, reject) => {
      if (typeof pdfjsLib === 'undefined') { reject('pdfjs not loaded'); return; }
      pdfjsLib.getDocument({ data: atob(pdfDataUrl.split(',')[1]) }).promise.then(pdf => {
        pdf.getPage(1).then(page => {
          const scale = 1.5;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise.then(() => {
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          });
        });
      }).catch(reject);
    });
  }

  function generatePdfPlaceholder(filename) {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 560;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, 400, 560);
    ctx.strokeStyle = '#6c63ff'; ctx.lineWidth = 2; ctx.strokeRect(20, 20, 360, 520);
    ctx.fillStyle = '#ff4757'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PDF', 200, 260);
    ctx.fillStyle = '#999'; ctx.font = '14px sans-serif';
    const name = filename.length > 30 ? filename.slice(0, 27) + '...' : filename;
    ctx.fillText(name, 200, 310);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  // --- IndexedDB for PDF binary storage ---
  const IDB_NAME = 'resume_pdf_store';
  const IDB_VERSION = 1;
  const IDB_STORE = 'pdfs';

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  // 保存 PDF 数据到 IndexedDB，key 格式: "projId_imageIndex"
  async function savePdfToIdb(projId, imageIndex, pdfDataUrl) {
    try {
      const db = await openIdb();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(pdfDataUrl, `${projId}_${imageIndex}`);
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    } catch (e) { /* ignore */ }
  }

  // 从 IndexedDB 读取 PDF 数据
  async function loadPdfFromIdb(projId, imageIndex) {
    try {
      const db = await openIdb();
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(`${projId}_${imageIndex}`);
      return new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  // 删除 IndexedDB 中的 PDF
  async function deletePdfFromIdb(projId, imageIndex) {
    try {
      const db = await openIdb();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(`${projId}_${imageIndex}`);
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    } catch (e) { /* ignore */ }
  }

  // --- LocalStorage Persistence ---
  // localStorage 只存元数据（不含大文件 base64），大文件由 IndexedDB 管理
  function saveToLocalStorage() {
    try {
      const stripped = JSON.parse(JSON.stringify(data));
      stripped.projects.forEach(p => {
        if (p.images) p.images = p.images.map((img, i) => {
          if (img && typeof img === 'object' && img.type === 'pdf') {
            return { type: 'pdf', data: '', thumbnail: img.thumbnail };
          }
          if (img && typeof img === 'object' && img.type === 'video') {
            return { type: 'video', data: '', thumbnail: img.thumbnail, mimeType: img.mimeType, name: img.name };
          }
          // 普通图片 base64 也存到 IndexedDB，localStorage 只留缩略图或标记
          if (img && typeof img === 'string' && img.length > 100000) {
            // 大图片：存入 IndexedDB，localStorage 留空标记
            if (img.startsWith('data:')) {
              return `__IDB_IMG__${p.id}_${i}__`;
            }
          }
          return img;
        });
      });
      localStorage.setItem('resume_data_draft', JSON.stringify(stripped));
    } catch (e) {
      console.warn('localStorage save failed:', e);
      // quota exceeded — 清除 localStorage 中的图片数据重试
      try {
        const lite = JSON.parse(JSON.stringify(data));
        lite.projects.forEach(p => {
          if (p.images) p.images = p.images.map((img, i) => {
            if (img && typeof img === 'object' && (img.type === 'pdf' || img.type === 'video')) {
              return { type: img.type, data: '', thumbnail: img.thumbnail };
            }
            if (img && typeof img === 'string' && img.startsWith('data:')) {
              return `__IDB_IMG__${p.id}_${i}__`;
            }
            return img;
          });
        });
        localStorage.setItem('resume_data_draft', JSON.stringify(lite));
      } catch (e2) {
        // 连轻量数据都存不下，放弃
      }
    }
  }

  function loadFromLocalStorage() {
    return new Promise(async (resolve) => {
      try {
        const saved = localStorage.getItem('resume_data_draft');
        if (!saved) { resolve(null); return; }
        const draft = JSON.parse(saved);
        // 恢复 IndexedDB 中存储的图片
        for (const p of draft.projects || []) {
          if (!p.images) continue;
          for (let i = 0; i < p.images.length; i++) {
            const img = p.images[i];
            if (typeof img === 'string' && img.startsWith('__IDB_IMG__')) {
              const mediaData = await loadPdfFromIdb(p.id, i);
              p.images[i] = mediaData || '';
            }
          }
        }
        resolve(draft);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // --- Render Functions ---
  function renderAll() {
    renderInlineEditables();
    renderSkills();
    renderWork();
    renderProjects();
    renderEducation();
    renderProjectFilters();
    initScrollAnimations();
    initNavScroll();
  }

  function renderInlineEditables() {
    $$('[data-editable]').forEach(el => {
      const path = el.getAttribute('data-editable');
      const val = getNestedValue(data, path);
      if (val !== undefined && val !== null) {
        if (el.tagName === 'DIV' || el.tagName === 'P' || el.tagName === 'SPAN') {
          if (path.includes('advantage') || path.includes('work') || path.includes('content') || path.includes('achievement')) {
            el.innerHTML = nl2br(val);
          } else {
            el.textContent = val;
          }
        }
      }
      el.contentEditable = editMode ? 'true' : 'false';
    });
  }

  function renderSkills() {
    const container = $('#skills-container');
    container.innerHTML = data.profile.skills.map(s =>
      `<span class="skill-tag">${esc(s)}</span>`
    ).join('');

    if (editMode) renderSkillsEditor();
  }

  function renderSkillsEditor() {
    const editor = $('#skills-editor');
    if (!editor) return;
    editor.innerHTML =
      data.profile.skills.map((s, i) =>
        `<span class="tag-editor-tag">${esc(s)}<button onclick="App.removeSkill(${i})">×</button></span>`
      ).join('') +
      `<input type="text" placeholder="输入技能后按回车" onkeydown="App.handleSkillInput(event)">`;
  }

  function renderWork() {
    const container = $('#work-container');
    container.innerHTML = data.workExperience.map(w => `
      <div class="timeline-item" data-id="${w.id}">
        <div class="timeline-dot"></div>
        <div class="timeline-period editable" data-editable="workMap.${w.id}.period">${esc(w.period)}</div>
        <div class="timeline-company editable" data-editable="workMap.${w.id}.company">${esc(w.company)}</div>
        <div class="timeline-position editable" data-editable="workMap.${w.id}.position">${esc(w.position)}</div>
        <div class="timeline-body">
          <p><strong>工作内容：</strong></p>
          <p class="editable" data-editable="workMap.${w.id}.content">${nl2br(w.content)}</p>
          <p style="margin-top:16px;"><strong>主要业绩：</strong></p>
          <p class="editable" data-editable="workMap.${w.id}.achievement">${nl2br(w.achievement)}</p>
        </div>
        <div class="edit-panel" style="display:none;margin-top:16px;">
          <div style="display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" onclick="App.editWork('${w.id}')">编辑</button>
            <button class="btn btn-danger btn-sm" onclick="App.deleteWork('${w.id}')">删除</button>
          </div>
        </div>
      </div>
    `).join('');

    // Build a flat map for inline editing
    data.workMap = {};
    data.workExperience.forEach(w => { data.workMap[w.id] = w; });

    if (editMode) {
      container.querySelectorAll('.edit-panel').forEach(p => p.style.display = 'block');
    }
  }

  function renderProjectFilters() {
    const cats = ['all', ...new Set(data.projects.map(p => p.category))];
    const container = $('#project-filters');
    container.innerHTML = cats.map(c =>
      `<button class="filter-btn ${activeFilter === c ? 'active' : ''}" onclick="App.filterProjects('${c}')">${c === 'all' ? '全部' : esc(c)}</button>`
    ).join('');
  }

  function renderProjects() {
    const container = $('#projects-container');
    const filtered = activeFilter === 'all'
      ? data.projects
      : data.projects.filter(p => p.category === activeFilter);

    container.innerHTML = filtered.map(p => {
      return `
        <div class="project-card" data-id="${p.id}">
          <div class="project-card-header">
            <div class="project-card-tags">
              ${p.tags.slice(0, 3).map(t => `<span class="project-tag">${esc(t)}</span>`).join('')}
              ${p.tags.length > 3 ? `<span class="project-tag">+${p.tags.length - 3}</span>` : ''}
            </div>
            <div class="project-card-name">${esc(p.name)}</div>
            <div class="project-card-meta">${esc(p.role)} · ${esc(p.period)} · ${esc(p.category)}</div>
            <div class="project-card-summary">${esc(p.summary).slice(0, 120)}${p.summary.length > 120 ? '...' : ''}</div>
          </div>
          <div class="project-card-actions">
            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();App.viewProject('${p.id}')">查看详情</button>
            <button class="btn btn-outline btn-sm btn-edit-only" style="display:none;" onclick="App.editProject('${p.id}')">编辑</button>
            <button class="btn btn-danger btn-sm btn-edit-only" style="display:none;" onclick="App.deleteProject('${p.id}')">删除</button>
          </div>
        </div>`;
    }).join('');

    // Show edit-only buttons in edit mode
    if (editMode) {
      container.querySelectorAll('.btn-edit-only').forEach(b => b.style.display = 'inline-flex');
    }

    // Click card (not buttons/images) to view detail
    container.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = card.dataset.id;
        if (!editMode) App.viewProject(id);
      });
    });
  }

  function renderEducation() {
    const container = $('#education-container');
    container.innerHTML = data.education.map(e => `
      <div class="education-card" data-id="${e.id}">
        <div class="edu-icon">🎓</div>
        <div>
          <div class="edu-school editable" data-editable="eduMap.${e.id}.school">${esc(e.school)}</div>
          <div class="edu-detail">
            <span class="editable" data-editable="eduMap.${e.id}.degree">${esc(e.degree)}</span> ·
            <span class="editable" data-editable="eduMap.${e.id}.major">${esc(e.major)}</span> ·
            <span class="editable" data-editable="eduMap.${e.id}.period">${esc(e.period)}</span>
          </div>
        </div>
        <div class="edit-panel" style="display:none;margin-left:auto;">
          <div style="display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" onclick="App.editEducation('${e.id}')">编辑</button>
            <button class="btn btn-danger btn-sm" onclick="App.deleteEducation('${e.id}')">删除</button>
          </div>
        </div>
      </div>
    `).join('');

    data.eduMap = {};
    data.education.forEach(e => { data.eduMap[e.id] = e; });

    if (editMode) {
      container.querySelectorAll('.edit-panel').forEach(p => p.style.display = 'block');
    }
  }

  // --- Project Modal ---
  function viewProject(id) {
    const p = data.projects.find(x => x.id === id);
    if (!p) return;

    const images = p.images || [];
    const gallery = images.map((img, i) =>
      `<div class="modal-gallery-item ${isMediaItem(img) ? img.type + '-item' : ''}" onclick="App.openLightboxWithGallery(${i})"><img src="${getImgSrc(img)}" alt="${esc(p.name)}" loading="lazy">${isPdfItem(img) ? '<div class="pdf-badge">PDF</div>' : ''}${isVideoItem(img) ? '<div class="video-badge">VIDEO</div>' : ''}</div>`
    ).join('');

    const tagsHtml = p.tags.map(t => `<span class="project-tag">${esc(t)}</span>`).join('');

    // Store images for lightbox navigation
    lightboxImages = images;
    lbPdfProjectId = id; // 记录所属项目 ID，用于 IndexedDB 查询

    $('#modal-content').innerHTML = `
      <div class="modal-header">
        <div>
          <div style="font-size:0.82rem;color:var(--color-accent);font-weight:600;margin-bottom:8px;">${esc(p.category)}</div>
          <h2 style="font-size:1.8rem;font-weight:800;">${esc(p.name)}</h2>
          <div style="font-size:0.9rem;color:var(--color-text-secondary);margin-top:6px;">${esc(p.role)} · ${esc(p.period)}</div>
        </div>
        <button class="modal-close" onclick="App.closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px;">${tagsHtml}</div>
        ${p.summary ? `<div class="modal-section"><div class="modal-section-title">项目概述</div><p>${nl2br(p.summary)}</p></div>` : ''}
        ${p.goal ? `<div class="modal-section"><div class="modal-section-title">项目目标</div><p>${nl2br(p.goal)}</p></div>` : ''}
        ${p.work ? `<div class="modal-section"><div class="modal-section-title">工作内容与业绩</div><p>${nl2br(p.work)}</p></div>` : ''}
        ${gallery ? `<div class="modal-section"><div class="modal-section-title">项目图片</div><div class="modal-gallery">${gallery}</div></div>` : ''}
      </div>
    `;

    $('#project-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#project-modal').classList.remove('active');
    document.body.style.overflow = '';
  }

  // --- Lightbox ---
  function openLightbox(src) {
    lightboxImages = [src];
    lightboxIndex = 0;
    _showLightbox();
  }

  function openProjectLightbox(projectId, index) {
    const p = data.projects.find(x => x.id === projectId);
    if (!p || !p.images || !p.images.length) return;
    lightboxImages = p.images;
    lightboxIndex = index;
    _showLightbox();
  }

  function openLightboxWithGallery(index) {
    lightboxIndex = index;
    _showLightbox();
  }

  function _applyLbTransform() {
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
    const pdfContainer = document.getElementById('lightbox-pdf-container');
    if (pdfContainer) pdfContainer.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
  }

  function _resetLbTransform() {
    lbScale = 1; lbX = 0; lbY = 0;
    _applyLbTransform();
  }

  // 渲染 PDF 指定页为 img
  async function _renderPdfPage(pageNum) {
    if (!lbPdfDoc || pageNum < 1 || pageNum > lbPdfTotalPages) return;
    lbPdfPage = pageNum;
    const wrap = $('#lightbox-img-wrap');
    const counter = $('#lightbox').querySelector('.lightbox-counter');
    const pdfNav = document.getElementById('lightbox-pdf-nav');

    // 更新翻页导航状态
    if (pdfNav) {
      const prevBtn = pdfNav.querySelector('.pdf-nav-prev');
      const nextBtn = pdfNav.querySelector('.pdf-nav-next');
      const pageIndicator = pdfNav.querySelector('.pdf-nav-page');
      if (prevBtn) prevBtn.disabled = pageNum <= 1;
      if (nextBtn) nextBtn.disabled = pageNum >= lbPdfTotalPages;
      if (pageIndicator) pageIndicator.textContent = `${pageNum} / ${lbPdfTotalPages}`;
    }
    // 更新计数器（保留画廊索引 + PDF 页码）
    if (counter && lightboxImages.length > 1) {
      counter.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}  (第${pageNum}页)`;
    }

    try {
      const page = await lbPdfDoc.getPage(pageNum);
      // 根据屏幕宽度动态计算缩放，确保 PDF 清晰
      const baseScale = 2; // 高清渲染
      const viewport = page.getViewport({ scale: baseScale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');

      const existing = document.getElementById('lightbox-img');
      if (existing) {
        existing.src = dataUrl;
      }
    } catch (err) {
      console.error('PDF 页面渲染失败:', err);
    }
  }

  // PDF 翻页
  function pdfPagePrev() {
    if (lbPdfPage > 1) _renderPdfPage(lbPdfPage - 1);
  }
  function pdfPageNext() {
    if (lbPdfPage < lbPdfTotalPages) _renderPdfPage(lbPdfPage + 1);
  }

  function lightboxZoomIn() {
    lbScale = lbScale * 1.3;
    _applyLbTransform();
  }

  function lightboxZoomOut() {
    lbScale = Math.max(lbScale / 1.3, 0.2);
    if (lbScale <= 1.01) { lbScale = 1; lbX = 0; lbY = 0; }
    _applyLbTransform();
  }

  function lightboxZoomReset() {
    _resetLbTransform();
  }

  function _showLightbox() {
    if (!lightboxImages.length) return;
    _resetLbTransform();
    const lb = $('#lightbox');
    const hasMultiple = lightboxImages.length > 1;

    const item = lightboxImages[lightboxIndex];
    _updateLightboxContent(item);

    // Update counter
    const counter = lb.querySelector('.lightbox-counter');
    if (counter) {
      counter.textContent = hasMultiple ? `${lightboxIndex + 1} / ${lightboxImages.length}` : '';
    }

    // Update arrow visibility
    lb.querySelectorAll('.lightbox-arrow').forEach(btn => {
      btn.style.display = hasMultiple ? 'flex' : 'none';
    });

    lb.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  async function _updateLightboxContent(item) {
    const wrap = $('#lightbox-img-wrap');
    const zoomCtrls = document.querySelector('.lightbox-zoom-controls');
    const pdfNav = document.getElementById('lightbox-pdf-nav');

    if (isPdfItem(item)) {
      // PDF: 用 pdf.js 渲染为 img，支持缩放/拖拽/翻页
      lbPdfDoc = null; lbPdfPage = 1; lbPdfTotalPages = 1;
      lbPdfImageIndex = lightboxIndex;
      wrap.innerHTML = `
        <div id="lightbox-pdf-container">
          <img id="lightbox-img" src="" alt="PDF" style="max-width:85vw;max-height:80vh;object-fit:contain;">
        </div>
        <div id="lightbox-pdf-nav">
          <button class="pdf-nav-prev" onclick="event.stopPropagation();App.pdfPagePrev()" title="上一页">&#9664;</button>
          <span class="pdf-nav-page">加载中...</span>
          <button class="pdf-nav-next" onclick="event.stopPropagation();App.pdfPageNext()" title="下一页">&#9654;</button>
        </div>
      `;
      if (zoomCtrls) zoomCtrls.style.display = '';

      // 获取 PDF 数据：优先内存 > IndexedDB > 报错
      let pdfData = (item.data && item.data.length > 10) ? item.data : null;
      if (!pdfData && lbPdfProjectId) {
        pdfData = await loadPdfFromIdb(lbPdfProjectId, lightboxIndex);
      }

      if (pdfData) {
        if (typeof pdfjsLib !== 'undefined') {
          // 用 Uint8Array 解析 base64
          const base64 = pdfData.split(',')[1] || pdfData;
          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

          const loadingTask = pdfjsLib.getDocument({ data: bytes });
          loadingTask.promise.then(pdf => {
            lbPdfDoc = pdf;
            lbPdfTotalPages = pdf.numPages;
            _renderPdfPage(1);
          }).catch(err => {
            console.error('PDF 加载失败:', err);
            const nav = document.getElementById('lightbox-pdf-nav');
            if (nav) nav.innerHTML = '<span style="color:var(--color-danger);">PDF 加载失败</span>';
          });
        } else {
          // pdf.js 不可用，回退到 iframe
          wrap.innerHTML = `<iframe src="${pdfData}" style="width:85vw;height:85vh;border:none;border-radius:var(--radius-sm);background:#fff;"></iframe>`;
          if (zoomCtrls) zoomCtrls.style.display = 'none';
        }
      } else {
        // PDF 数据确实不存在
        const nav = document.getElementById('lightbox-pdf-nav');
        if (nav) nav.innerHTML = '<span style="color:var(--color-warning);">PDF 数据已丢失，请重新上传</span>';
      }
    } else if (isVideoItem(item)) {
      // 视频: 播放视频
      if (pdfNav) pdfNav.style.display = 'none';
      // 视频不支持缩放拖拽，隐藏缩放控件
      if (zoomCtrls) zoomCtrls.style.display = 'none';
      // 获取视频数据：优先内存 > 显示丢失提示
      let videoSrc = (item.data && item.data.length > 10) ? item.data : null;
      if (!videoSrc && lbPdfProjectId) {
        videoSrc = await loadPdfFromIdb(lbPdfProjectId, lightboxIndex);
      }
      if (videoSrc) {
        wrap.innerHTML = `<video id="lightbox-video" controls autoplay style="max-width:85vw;max-height:85vh;outline:none;"><source src="${videoSrc}" type="${item.mimeType || 'video/mp4'}">浏览器不支持视频播放</video>`;
      } else {
        wrap.innerHTML = '<div style="color:var(--color-warning);text-align:center;padding:40px;">视频数据已丢失，请重新上传</div>';
      }
    } else {
      // 图片（包括 GIF）: 正常显示
      if (pdfNav) pdfNav.style.display = 'none';
      wrap.innerHTML = `<img id="lightbox-img" src="${item}" alt="">`;
      if (zoomCtrls) zoomCtrls.style.display = '';
    }
  }

  function lightboxPrev() {
    if (lightboxImages.length <= 1) return;
    lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
    _resetLbTransform();
    _updateLightboxContent(lightboxImages[lightboxIndex]);
    const counter = $('#lightbox').querySelector('.lightbox-counter');
    if (counter) counter.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
  }

  function lightboxNext() {
    if (lightboxImages.length <= 1) return;
    lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
    _resetLbTransform();
    _updateLightboxContent(lightboxImages[lightboxIndex]);
    const counter = $('#lightbox').querySelector('.lightbox-counter');
    if (counter) counter.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
  }

  function closeLightbox() {
    // 停止视频播放
    const video = document.getElementById('lightbox-video');
    if (video) video.pause();
    $('#lightbox').classList.remove('active');
    _resetLbTransform();
    lbPdfDoc = null; lbPdfPage = 1; lbPdfTotalPages = 1;
    // Restore default img element
    $('#lightbox-img-wrap').innerHTML = '<img id="lightbox-img" src="" alt="">';
    // Show zoom controls again
    const zoomCtrls = document.querySelector('.lightbox-zoom-controls');
    if (zoomCtrls) zoomCtrls.style.display = '';
    // Only restore scroll if modal is not open
    if (!$('#project-modal').classList.contains('active')) {
      document.body.style.overflow = '';
    }
  }

  // --- Edit Mode ---
  let passwordCallback = null;
  const EDIT_PASSWORD = '6540064aa';

  function confirmPassword() {
    const pwd = $('#password-input').value;
    if (pwd === EDIT_PASSWORD) {
      $('#password-modal').style.display = 'none';
      if (passwordCallback) { passwordCallback(); passwordCallback = null; }
    } else {
      toast('密码错误，请重试', 'error');
      $('#password-input').value = '';
      $('#password-input').focus();
    }
  }

  function cancelPassword() {
    $('#password-modal').style.display = 'none';
    passwordCallback = null;
  }

  function toggleEdit() {
    if (!editMode) {
      $('#password-input').value = '';
      $('#password-modal').style.display = 'flex';
      passwordCallback = () => {
        editMode = !editMode;
        document.body.classList.toggle('edit-mode', editMode);
        $('#toggle-edit').textContent = editMode ? '退出编辑' : '编辑模式';
        $('#toggle-edit').classList.toggle('btn-primary', editMode);
        $('#toggle-edit').classList.toggle('btn-outline', !editMode);
        $$('.edit-panel').forEach(p => {
          if (p.id === 'skills-edit-panel' || p.id === 'edit-banner') return;
          if (editMode) p.style.display = 'block';
          else if (p.style.display !== 'none' && !p.closest('.edit-mode-show')) p.style.display = '';
        });
        $$('.btn-edit-only').forEach(b => {
          b.style.display = editMode ? 'inline-flex' : 'none';
        });
        if (editMode) renderSkillsEditor();
        renderWork();
        renderEducation();
        $$('.editable').forEach(el => {
          el.contentEditable = editMode ? 'true' : 'false';
        });
        if (editMode) toast('编辑模式已开启', 'success');
      };
      setTimeout(() => {
        $('#password-input').focus();
        $('#password-input').onkeydown = (e) => {
          if (e.key === 'Enter') confirmPassword();
          if (e.key === 'Escape') cancelPassword();
        };
      }, 100);
      return;
    }
    // Exit edit mode
    editMode = !editMode;

    document.body.classList.toggle('edit-mode', editMode);
    $('#toggle-edit').textContent = editMode ? '退出编辑' : '编辑模式';
    $('#toggle-edit').classList.toggle('btn-primary', editMode);
    $('#toggle-edit').classList.toggle('btn-outline', !editMode);

    // Show/hide edit panels
    $$('.edit-panel').forEach(p => {
      if (p.id === 'skills-edit-panel' || p.id === 'edit-banner') return;
      if (editMode) p.style.display = 'block';
      else if (p.style.display !== 'none' && !p.closest('.edit-mode-show')) p.style.display = '';
    });

    // Show/hide project edit-only buttons
    $$('.btn-edit-only').forEach(b => {
      b.style.display = editMode ? 'inline-flex' : 'none';
    });

    // Re-render skills editor
    if (editMode) renderSkillsEditor();

    // Re-render to update edit panels
    renderWork();
    renderEducation();

    // Toggle contentEditable
    $$('.editable').forEach(el => {
      el.contentEditable = editMode ? 'true' : 'false';
    });

    if (editMode) toast('编辑模式已开启', 'success');
  }

  // --- Inline Editing ---
  function initInlineEditing() {
    // 保存可编辑字段的内容
    function saveEditable(el) {
      const path = el.getAttribute('data-editable');
      if (!path) return;
      let value;
      if (path.includes('advantage') || path.includes('content') || path.includes('achievement') || path.includes('work') || path.includes('goal') || path.includes('summary')) {
        value = el.innerText;
      } else {
        value = el.textContent.trim();
      }
      setNestedValue(data, path, value);
      saveToLocalStorage();
    }

    // 失焦时保存
    document.addEventListener('blur', (e) => {
      if (!editMode || !e.target.classList.contains('editable')) return;
      saveEditable(e.target);
    }, true);

    // 输入时实时保存
    document.addEventListener('input', (e) => {
      if (!editMode || !e.target.classList.contains('editable')) return;
      saveEditable(e.target);
    });
  }

  // --- Skill CRUD ---
  function removeSkill(index) {
    data.profile.skills.splice(index, 1);
    saveToLocalStorage();
    renderSkills();
    toast('技能已删除');
  }

  function handleSkillInput(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val) return;
    data.profile.skills.push(val);
    e.target.value = '';
    saveToLocalStorage();
    renderSkills();
    toast('技能已添加');
  }

  // --- Work Experience CRUD ---
  function addWork() {
    const item = { id: uid(), company: '新公司', position: '职位', period: '2020.01 - 至今', content: '工作内容...', achievement: '主要业绩...' };
    data.workExperience.unshift(item);
    saveToLocalStorage();
    renderWork();
    toast('工作经历已添加，请编辑详情');
    // Scroll to top of work section
    $('#experience').scrollIntoView({ behavior: 'smooth' });
  }

  function editWork(id) {
    const w = data.workExperience.find(x => x.id === id);
    if (!w) return;
    openEditModal({
      title: '编辑工作经历',
      fields: [
        { key: 'company', label: '公司名称', type: 'text', value: w.company },
        { key: 'position', label: '职位', type: 'text', value: w.position },
        { key: 'period', label: '时间段', type: 'daterange', value: w.period },
        { key: 'content', label: '工作内容', type: 'textarea', value: w.content },
        { key: 'achievement', label: '主要业绩', type: 'textarea', value: w.achievement },
      ],
      onSave: (values) => {
        Object.assign(w, values);
        saveToLocalStorage();
        renderWork();
        closeModal();
        toast('工作经历已更新');
      }
    });
  }

  function deleteWork(id) {
    if (!confirm('确定删除这条工作经历吗？')) return;
    data.workExperience = data.workExperience.filter(x => x.id !== id);
    saveToLocalStorage();
    renderWork();
    toast('工作经历已删除');
  }

  // --- Project CRUD ---
  function addProject() {
    openEditModal({
      title: '添加项目',
      fields: [
        { key: 'name', label: '项目名称', type: 'text', value: '' },
        { key: 'role', label: '角色', type: 'text', value: 'UX/UI 设计师' },
        { key: 'period', label: '时间段', type: 'daterange', value: '' },
        { key: 'category', label: '分类', type: 'text', value: '' },
        { key: 'summary', label: '项目概述', type: 'textarea', value: '' },
        { key: 'goal', label: '项目目标', type: 'textarea', value: '' },
        { key: 'work', label: '工作内容与业绩', type: 'textarea', value: '' },
        { key: 'tags', label: '标签（逗号分隔）', type: 'text', value: '' },
      ],
      onSave: (values) => {
        const item = {
          id: uid(),
          name: values.name,
          role: values.role,
          period: values.period,
          category: values.category,
          summary: values.summary,
          goal: values.goal,
          work: values.work,
          tags: values.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean),
          images: []
        };
        data.projects.unshift(item);
        saveToLocalStorage();
        renderProjects();
        renderProjectFilters();
        closeModal();
        toast('项目已添加');
      }
    });
  }

  function editProject(id) {
    const p = data.projects.find(x => x.id === id);
    if (!p) return;
    openEditModal({
      title: '编辑项目',
      fields: [
        { key: 'name', label: '项目名称', type: 'text', value: p.name },
        { key: 'role', label: '角色', type: 'text', value: p.role },
        { key: 'period', label: '时间段', type: 'daterange', value: p.period },
        { key: 'category', label: '分类', type: 'text', value: p.category },
        { key: 'summary', label: '项目概述', type: 'textarea', value: p.summary },
        { key: 'goal', label: '项目目标', type: 'textarea', value: p.goal },
        { key: 'work', label: '工作内容与业绩', type: 'textarea', value: p.work },
        { key: 'tags', label: '标签（逗号分隔）', type: 'text', value: p.tags.join(', ') },
      ],
      imageSection: {
        images: p.images || [],
        onUpload: async (files) => {
          for (const file of files) {
            const result = await compressImage(file);
            const idx = p.images.length;
            p.images.push(result);
            // PDF/视频存入 IndexedDB
            if (isPdfItem(result) && result.data) {
              await savePdfToIdb(p.id, idx, result.data);
            }
            if (isVideoItem(result) && result.data) {
              await savePdfToIdb(p.id, idx, result.data);
            }
          }
          saveToLocalStorage();
          // 大图片也存入 IndexedDB
          for (let j = 0; j < p.images.length; j++) {
            const img = p.images[j];
            if (typeof img === 'string' && img.startsWith('data:') && img.length > 100000) {
              await savePdfToIdb(p.id, j, img);
            }
          }
          renderProjects();
          toast(`${files.length} 个文件已添加`);
        },
        onRemove: async (index) => {
          const removed = p.images[index];
          // 清理 IndexedDB 中的 PDF/视频
          if (isMediaItem(removed)) {
            await deletePdfFromIdb(p.id, index);
          }
          p.images.splice(index, 1);
          // 删除后重新映射 IndexedDB 中后续媒体的索引
          for (let i = index; i < p.images.length; i++) {
            if (isMediaItem(p.images[i])) {
              const oldData = await loadPdfFromIdb(p.id, i + 1);
              if (oldData) {
                await savePdfToIdb(p.id, i, oldData);
                await deletePdfFromIdb(p.id, i + 1);
              }
            }
          }
          saveToLocalStorage();
          renderProjects();
          toast('图片已删除');
        }
      },
      onSave: (values) => {
        Object.assign(p, {
          name: values.name, role: values.role, period: values.period,
          category: values.category, summary: values.summary, goal: values.goal, work: values.work,
          tags: values.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        });
        saveToLocalStorage();
        renderProjects();
        renderProjectFilters();
        closeModal();
        toast('项目已更新');
      }
    });
  }

  function deleteProject(id) {
    if (!confirm('确定删除这个项目吗？')) return;
    data.projects = data.projects.filter(x => x.id !== id);
    saveToLocalStorage();
    renderProjects();
    renderProjectFilters();
    toast('项目已删除');
  }

  // --- Education CRUD ---
  function addEducation() {
    openEditModal({
      title: '添加教育经历',
      fields: [
        { key: 'school', label: '学校', type: 'text', value: '' },
        { key: 'degree', label: '学历', type: 'text', value: '本科' },
        { key: 'major', label: '专业', type: 'text', value: '' },
        { key: 'period', label: '时间段', type: 'daterange', value: '' },
      ],
      onSave: (values) => {
        data.education.push({ id: uid(), ...values });
        saveToLocalStorage();
        renderEducation();
        closeModal();
        toast('教育经历已添加');
      }
    });
  }

  function editEducation(id) {
    const e = data.education.find(x => x.id === id);
    if (!e) return;
    openEditModal({
      title: '编辑教育经历',
      fields: [
        { key: 'school', label: '学校', type: 'text', value: e.school },
        { key: 'degree', label: '学历', type: 'text', value: e.degree },
        { key: 'major', label: '专业', type: 'text', value: e.major },
        { key: 'period', label: '时间段', type: 'daterange', value: e.period },
      ],
      onSave: (values) => {
        Object.assign(e, values);
        saveToLocalStorage();
        renderEducation();
        closeModal();
        toast('教育经历已更新');
      }
    });
  }

  function deleteEducation(id) {
    if (!confirm('确定删除这条教育经历吗？')) return;
    data.education = data.education.filter(x => x.id !== id);
    saveToLocalStorage();
    renderEducation();
    toast('教育经历已删除');
  }

  // --- Generic Edit Modal ---
  function openEditModal({ title, fields, imageSection, onSave }) {
    const fieldsHtml = fields.map(f => {
      if (f.type === 'textarea') {
        return `<div class="form-group"><label class="form-label">${f.label}</label><textarea class="form-textarea" data-field="${f.key}">${esc(f.value)}</textarea></div>`;
      }
      if (f.type === 'daterange') {
        const parts = (f.value || '').split(' - ');
        const start = parts[0] ? parts[0].replace(/\./g, '-') : '';
        const end = parts[1] ? parts[1].replace(/\./g, '-') : '';
        return `<div class="form-group"><label class="form-label">${f.label}</label><div class="form-row"><input class="form-input" type="month" data-field="${f.key}_start" value="${start}"><input class="form-input" type="month" data-field="${f.key}_end" value="${end}"></div></div>`;
      }
      return `<div class="form-group"><label class="form-label">${f.label}</label><input class="form-input" type="text" data-field="${f.key}" value="${esc(f.value)}"></div>`;
    }).join('');

    let imageHtml = '';
    if (imageSection) {
      const thumbs = imageSection.images.map((img, i) =>
        `<div class="image-grid-edit-item ${isMediaItem(img) ? img.type + '-item' : ''}"><img src="${getImgSrc(img)}" alt="">${isPdfItem(img) ? '<div class="pdf-badge">PDF</div>' : ''}${isVideoItem(img) ? '<div class="video-badge">VIDEO</div>' : ''}<button class="remove-img" onclick="App._removeEditImage(${i})">×</button></div>`
      ).join('');

      imageHtml = `
        <div class="modal-section">
          <div class="modal-section-title">项目图片</div>
          <div class="upload-zone" onclick="App._triggerImageUpload()">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div>点击上传图片/PDF/视频（支持多选）</div>
          </div>
          <div class="image-grid-edit" id="edit-image-grid">${thumbs}</div>
        </div>
      `;
      imageUploadTarget = imageSection;
    } else {
      imageUploadTarget = null;
    }

    $('#modal-content').innerHTML = `
      <div class="modal-header">
        <h2 style="font-size:1.4rem;font-weight:700;">${title}</h2>
        <button class="modal-close" onclick="App.closeModal()">×</button>
      </div>
      <div class="modal-body">
        ${fieldsHtml}
        ${imageHtml}
        <div style="display:flex;gap:12px;margin-top:24px;justify-content:flex-end;">
          <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
          <button class="btn btn-primary" onclick="App._saveEditModal()">保存</button>
        </div>
      </div>
    `;

    // Store onSave callback
    $('#modal-content')._onSave = onSave;

    $('#project-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function _saveEditModal() {
    const modal = $('#modal-content');
    if (!modal._onSave) return;
    const values = {};
    const rangeMerged = {};
    modal.querySelectorAll('[data-field]').forEach(el => {
      const key = el.dataset.field;
      if (key.endsWith('_start')) {
        const base = key.slice(0, -6);
        if (!rangeMerged[base]) rangeMerged[base] = {};
        rangeMerged[base].start = el.value;
      } else if (key.endsWith('_end')) {
        const base = key.slice(0, -4);
        if (!rangeMerged[base]) rangeMerged[base] = {};
        rangeMerged[base].end = el.value;
      } else {
        values[key] = el.value;
      }
    });
    // Merge daterange values into period format
    for (const [base, parts] of Object.entries(rangeMerged)) {
      const s = parts.start ? parts.start.replace(/-/g, '.') : '';
      const e = parts.end ? parts.end.replace(/-/g, '.') : '';
      values[base] = (s && e) ? `${s} - ${e}` : (s || e);
    }
    modal._onSave(values);
  }

  function _triggerImageUpload() {
    $('#image-input').click();
  }

  function _removeEditImage(index) {
    if (imageUploadTarget && imageUploadTarget.onRemove) {
      imageUploadTarget.onRemove(index);
      // Re-render the image grid in the modal
      const grid = $('#edit-image-grid');
      if (grid) {
        const thumbs = imageUploadTarget.images.map((img, i) =>
          `<div class="image-grid-edit-item ${isMediaItem(img) ? img.type + '-item' : ''}"><img src="${getImgSrc(img)}" alt="">${isPdfItem(img) ? '<div class="pdf-badge">PDF</div>' : ''}${isVideoItem(img) ? '<div class="video-badge">VIDEO</div>' : ''}<button class="remove-img" onclick="App._removeEditImage(${i})">×</button></div>`
        ).join('');
        grid.innerHTML = thumbs;
      }
    }
  }

  // --- Image Upload Handler ---
  function initImageUpload() {
    $('#image-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length || !imageUploadTarget) return;
      await imageUploadTarget.onUpload(files);
      // Re-render image grid in modal
      const grid = $('#edit-image-grid');
      if (grid) {
        const thumbs = imageUploadTarget.images.map((img, i) =>
          `<div class="image-grid-edit-item ${isMediaItem(img) ? img.type + '-item' : ''}"><img src="${getImgSrc(img)}" alt="">${isPdfItem(img) ? '<div class="pdf-badge">PDF</div>' : ''}${isVideoItem(img) ? '<div class="video-badge">VIDEO</div>' : ''}<button class="remove-img" onclick="App._removeEditImage(${i})">×</button></div>`
        ).join('');
        grid.innerHTML = thumbs;
      }
      e.target.value = ''; // Reset
    });
  }

  // --- Filter ---
  function filterProjects(cat) {
    activeFilter = cat;
    renderProjectFilters();
    renderProjects();
  }

  // --- Export / Import ---
  async function exportData() {
    toast('正在导出，含 PDF 文件可能需要几秒...');
    // Remove internal helper maps before export
    const clean = JSON.parse(JSON.stringify(data));
    delete clean.workMap;
    delete clean.eduMap;

    // 从 IndexedDB 补充 PDF/视频/大图片数据到导出
    for (const p of clean.projects) {
      if (!p.images) continue;
      const origProject = data.projects.find(op => op.id === p.id);
      for (let i = 0; i < p.images.length; i++) {
        const img = p.images[i];
        if (isMediaItem(img) && (!img.data || img.data.length <= 10)) {
          // 先尝试从内存取
          if (origProject && origProject.images && origProject.images[i] && isMediaItem(origProject.images[i]) && origProject.images[i].data) {
            p.images[i].data = origProject.images[i].data;
          } else {
            // 从 IndexedDB 取
            const mediaData = await loadPdfFromIdb(p.id, i);
            if (mediaData) p.images[i].data = mediaData;
          }
        }
        // 恢复 IndexedDB 中存的大图片
        if (typeof img === 'string' && img.startsWith('__IDB_IMG__')) {
          if (origProject && origProject.images && origProject.images[i] && typeof origProject.images[i] === 'string' && !origProject.images[i].startsWith('__IDB_IMG__')) {
            p.images[i] = origProject.images[i];
          } else {
            const mediaData = await loadPdfFromIdb(p.id, i);
            if (mediaData) p.images[i] = mediaData;
          }
        }
      }
    }

    // Update timestamp
    clean.meta.lastUpdated = new Date().toISOString().split('T')[0];

    const content = `/**
 * resumeData — 个人简历网站数据文件
 *
 * 修改方式：
 *   1. 推荐：在网页上点击「编辑模式」按钮，直接增删改查所有内容，改完点「导出数据」，
 *      用导出的 data.js 覆盖本文件，push 到 GitHub 即可生效。
 *   2. 手动：直接编辑本文件的 JSON 内容。
 *
 * 所有图片以 base64 字符串存储在 images 数组中，方便单文件部署。
 */
window.resumeData = ${JSON.stringify(clean, null, 2)};
`;

    const blob = new Blob([content], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.js';
    a.click();
    URL.revokeObjectURL(url);
    toast('数据已导出为 data.js，请用此文件替换仓库中的 data.js 后 push 到 GitHub');
  }

  function importData() {
    $('#import-input').click();
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        // Extract JSON from window.resumeData = {...};
        const match = text.match(/window\.resumeData\s*=\s*([\s\S]+);?\s*$/);
        if (!match) throw new Error('Invalid format');
        const imported = JSON.parse(match[1]);
        // Merge with current data
        Object.assign(data, imported);
        // 将导入的 PDF/视频数据存入 IndexedDB
        for (const p of (data.projects || [])) {
          if (!p.images) continue;
          for (let i = 0; i < p.images.length; i++) {
            if (isMediaItem(p.images[i]) && p.images[i].data && p.images[i].data.length > 10) {
              savePdfToIdb(p.id, i, p.images[i].data);
            }
          }
        }
        saveToLocalStorage();
        renderAll();
        toast('数据导入成功');
      } catch (err) {
        toast('导入失败：文件格式不正确', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // --- Scroll Animations ---
  function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    $$('.fade-in').forEach(el => observer.observe(el));
  }

  // --- Nav Scroll ---
  function initNavScroll() {
    window.addEventListener('scroll', () => {
      $('#nav').classList.toggle('scrolled', window.scrollY > 20);

      // Active nav link
      const sections = ['about', 'experience', 'projects', 'education'];
      let current = '';
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 150) current = id;
      }
      $$('[data-nav]').forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + current);
      });
    });
  }

  // --- Modal close on overlay click / ESC ---
  function initModalEvents() {
    $('#project-modal').addEventListener('click', (e) => {
      if (e.target === $('#project-modal')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      const lb = $('#lightbox');
      if (lb.classList.contains('active')) {
        if (e.key === 'Escape') { closeLightbox(); e.preventDefault(); return; }
        if (e.key === 'ArrowLeft') { lightboxPrev(); e.preventDefault(); return; }
        if (e.key === 'ArrowRight') { lightboxNext(); e.preventDefault(); return; }
        if (e.key === '+' || e.key === '=') { lightboxZoomIn(); e.preventDefault(); return; }
        if (e.key === '-') { lightboxZoomOut(); e.preventDefault(); return; }
        if (e.key === '0') { lightboxZoomReset(); e.preventDefault(); return; }
      }
      if (e.key === 'Escape') closeModal();
    });

    const imgWrap = $('#lightbox-img-wrap');

    // Close on background click (not on image)
    $('#lightbox').addEventListener('click', (e) => {
      if (e.target === $('#lightbox')) {
        closeLightbox();
      }
    });

    // Mouse wheel zoom
    $('#lightbox').addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.85 : 1.18;
      const newScale = Math.min(Math.max(lbScale * delta, 0.5), 5);
      // Zoom toward cursor
      if (newScale !== lbScale) {
        const rect = imgWrap.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const ratio = newScale / lbScale;
        lbX = cx - (cx - lbX) * ratio;
        lbY = cy - (cy - lbY) * ratio;
        lbScale = newScale;
        _applyLbTransform();
      }
    }, { passive: false });

    // Double-click to toggle zoom
    let lastClickTime = 0;
    imgWrap.addEventListener('click', (e) => {
      const now = Date.now();
      if (now - lastClickTime < 300) {
        if (lbScale > 1.05) { _resetLbTransform(); }
        else { lbScale = 2.5; lbX = 0; lbY = 0; _applyLbTransform(); }
        e.preventDefault();
      }
      lastClickTime = now;
    });

    // Mouse drag to pan (only when zoomed)
    imgWrap.addEventListener('mousedown', (e) => {
      if (lbScale <= 1) return;
      e.preventDefault();
      lbDragging = true;
      lbDragStartX = e.clientX; lbDragStartY = e.clientY;
      lbStartX = lbX; lbStartY = lbY;
      imgWrap.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
      if (!lbDragging) return;
      lbX = lbStartX + (e.clientX - lbDragStartX);
      lbY = lbStartY + (e.clientY - lbDragStartY);
      _applyLbTransform();
    });
    document.addEventListener('mouseup', () => {
      if (lbDragging) { lbDragging = false; imgWrap.style.cursor = ''; }
    });

    // Touch: pinch zoom + single-finger pan + swipe nav
    let touchStartX = 0, touchStartY = 0;
    let touchStartSingleX = 0;
    let isSwiping = false;

    imgWrap.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lbPinchStartDist = Math.hypot(dx, dy);
        lbPinchStartScale = lbScale;
      } else if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartSingleX = touchStartX;
        isSwiping = lbScale <= 1;
        if (lbScale > 1) {
          lbDragging = true;
          lbDragStartX = e.touches[0].clientX;
          lbDragStartY = e.touches[0].clientY;
          lbStartX = lbX; lbStartY = lbY;
        }
      }
    }, { passive: false });

    imgWrap.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        lbScale = Math.min(Math.max(lbPinchStartScale * (dist / lbPinchStartDist), 0.5), 5);
        if (lbScale <= 1.01) { lbScale = 1; lbX = 0; lbY = 0; }
        _applyLbTransform();
        isSwiping = false;
      } else if (e.touches.length === 1 && lbDragging) {
        e.preventDefault();
        lbX = lbStartX + (e.touches[0].clientX - lbDragStartX);
        lbY = lbStartY + (e.touches[0].clientY - lbDragStartY);
        _applyLbTransform();
        isSwiping = false;
      }
    }, { passive: false });

    imgWrap.addEventListener('touchend', (e) => {
      lbDragging = false;
      if (isSwiping && e.changedTouches.length) {
        const diff = e.changedTouches[0].screenX - touchStartX;
        if (Math.abs(diff) > 50) {
          if (diff > 0) lightboxPrev();
          else lightboxNext();
        }
      }
      isSwiping = false;
    });
  }

  // 补充草稿中丢失的 PDF/视频数据（从原始 data.js 中恢复）
  function _mergePdfData(draft, original) {
    if (!original || !original.projects) return;
    const origMap = {};
    original.projects.forEach(p => {
      if (p.images) {
        origMap[p.id] = {};
        p.images.forEach((img, i) => {
          if (img && typeof img === 'object' && isMediaItem(img) && img.data) {
            origMap[p.id][i] = img.data;
          }
        });
      }
    });
    (draft.projects || []).forEach(p => {
      if (!origMap[p.id]) return;
      (p.images || []).forEach((img, i) => {
        if (img && typeof img === 'object' && isMediaItem(img) && (!img.data || img.data.length <= 10) && origMap[p.id][i]) {
          img.data = origMap[p.id][i];
        }
      });
    });
  }

  // --- Init ---
  async function init() {
    const originalData = JSON.parse(JSON.stringify(window.resumeData));
    const draft = await loadFromLocalStorage();
    if (draft) {
      // 草稿存在，恢复但用原始数据补充 PDF/视频二进制
      _mergePdfData(draft, originalData);
      // 同时恢复草稿中的大图片从 IndexedDB
      for (const p of (draft.projects || [])) {
        if (!p.images) continue;
        for (let i = 0; i < p.images.length; i++) {
          if (typeof p.images[i] === 'string' && p.images[i].startsWith('__IDB_IMG__')) {
            const mediaData = await loadPdfFromIdb(p.id, i);
            if (mediaData) p.images[i] = mediaData;
          }
        }
      }
      data = draft;
    } else {
      data = originalData;
      // 如果原始数据包含 PDF/视频，存入 IndexedDB 备用
      for (const p of (data.projects || [])) {
        if (!p.images) continue;
        for (let i = 0; i < p.images.length; i++) {
          if (isMediaItem(p.images[i]) && p.images[i].data && p.images[i].data.length > 10) {
            savePdfToIdb(p.id, i, p.images[i].data);
          }
        }
      }
    }

    renderAll();
    initInlineEditing();
    initImageUpload();
    initModalEvents();

    $('#toggle-edit').addEventListener('click', toggleEdit);
    $('#import-input').addEventListener('change', handleImport);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // --- Public API ---
  return {
    toggleEdit, confirmPassword, cancelPassword, exportData, importData,
    removeSkill, handleSkillInput,
    addWork, editWork, deleteWork,
    addProject, editProject, deleteProject, viewProject, closeModal,
    addEducation, editEducation, deleteEducation,
    filterProjects, openLightbox, openProjectLightbox, openLightboxWithGallery, lightboxPrev, lightboxNext, closeLightbox, lightboxZoomIn, lightboxZoomOut, lightboxZoomReset, pdfPagePrev, pdfPageNext,
    _saveEditModal, _triggerImageUpload, _removeEditImage,
  };
})();
