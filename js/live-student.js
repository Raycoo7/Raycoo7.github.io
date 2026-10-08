/* 学生端（学生页）：确认是从首页用课堂码进入的本周课堂后，在左下角显示课堂面板。
 * 两类课程共用同一套做法：
 *   · 每道题下方有“递交”按钮：选好或写好后点“递交”（再点一次确认），交给老师；
 *     每题只收第一次，递交后不能修改（数据库同样只收第一次）。老师在工作台和投屏页统计人数与对错。
 *   · 每道题下方有“我的备注”：只保存在这台设备上，不交给老师，导出时一起带走。
 *   · 面板里可以“导出 HTML”（单个文件，离线可打开）或“导出 PDF”（浏览器“存储为 PDF”），内含题目、作答、递交状态与备注。
 * 课程类型：
 *   · 案例课程（kind = case-html，如《习近平经济思想概论》章节页）：投票、配对、推演、文字作答 → ck_choices / ck_answers；
 *   · 概念学习课程（kind = concept-html，如《政治经济学》练习页）：各题 → RPC ck_submit_answer（并入每人一份作业）；
 *     页面里的姓名、学号、班级按课堂登录信息自动填写并锁定。
 * 两类都可发弹幕：连同姓名显示在老师投屏的课堂页面上（老师开放后可用）。
 * 未从课堂码进入（或本周课堂不在这一页）时只能写备注、导出，不能递交。
 * 离线版（provider = offline，脚本内嵌在课程目录的离线 HTML 里，网络不可用时直接发给学生）：
 *   不连接后台；学生在面板里填写姓名、学号、班级；“递交”只在本机锁定答案（每题只算第一次）；
 *   做完后导出文件发给老师，老师在离线完整版里“导入学生文件”统计。导出文件内含作答数据（JSON）。
 * 在线版需要页面先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 */
(function () {
  'use strict';
  const config = window.CLASS_LIVE_CONFIG;
  const OFFLINE = Boolean(config && config.provider === 'offline');
  if (!config || config.provider === 'off' || (!OFFLINE && !window.ClassLive)) return;
  // 地址栏里的解密值用完即清，避免被复制转发
  if (/staticrypt_pwd=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  let backend = null;
  if (!OFFLINE) {
    try {
      backend = window.ClassLive.create(config);
    } catch (error) {
      console.warn('[课堂后台] 未启用：', error.message);
      return;
    }
  }
  const Live = window.ClassLive || {
    isClosedError: () => false,
    isDuplicateError: () => false,
    today: () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  };

  const STORE = 'classlive-student';
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (error) { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* 忽略 */ } };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const OFFLINE_STORE = 'classlive-offline-student';
  const identity = OFFLINE ? load(OFFLINE_STORE, {}) : load(STORE, {});
  const unit = config.unit || Live.unitOf();
  const worksheet = config.kind === 'concept-html';
  const joined = OFFLINE || Boolean(identity.classroom && identity.name && identity.sid
    && identity.course === config.course && identity.chapter === unit);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const textOf = (el) => (el ? clean(el.textContent) : '');
  const time = (withSeconds) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}) }).format(new Date());
  const stamp = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit' }).format(new Date());
  const joinUrl = () => '/' + (identity.code ? `?join=${encodeURIComponent(identity.code)}` : '');
  const closedText = '本课堂已结束提交或已停止，请留意老师发布的新课堂码';
  const shield = (el, types = ['click', 'keydown', 'keyup', 'input']) => types.forEach((type) => el.addEventListener(type, (event) => event.stopPropagation()));

  const style = document.createElement('style');
  style.textContent = `
  .clp-panel { position: fixed; z-index: 90; left: 16px; bottom: 80px; width: min(360px, calc(100vw - 32px)); padding: 12px 14px; border: 1px solid rgba(35,101,95,.28); border-radius: 10px; background: rgba(255,253,248,.97); color: #201c18; box-shadow: 0 12px 30px rgba(0,0,0,.14); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .clp-who { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .clp-who strong { font-size: 15px; }
  .clp-who small, .clp-room, .clp-hint { color: #6d6259; font-size: 12.5px; }
  .clp-hint { margin: 6px 0 0; line-height: 1.5; }
  .clp-hint[data-state=ok] { color: #23655f; }
  .clp-hint[data-state=error] { color: #a4492d; font-weight: 700; }
  .clp-link { padding: 0; border: 0; background: none; color: #a4492d; font: inherit; font-size: 12.5px; text-decoration: underline; cursor: pointer; white-space: nowrap; }
  .clp-progress { margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(70,51,34,.2); }
  .clp-count { font-weight: 800; }
  .clp-state { display: block; color: #6d6259; font-size: 13px; }
  .clp-state[data-state=ok] { color: #23655f; font-weight: 700; }
  .clp-state[data-state=error] { color: #a4492d; font-weight: 700; }
  .clp-ident { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 8px; }
  .clp-ident input { min-width: 0; padding: 7px 8px; border: 1.5px solid rgba(70,51,34,.2); border-radius: 7px; background: #fff; font: inherit; }
  .clp-ident input:focus { outline: none; border-color: #23655f; }
  .clp-tools { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .clp-tools button { padding: 7px 11px; border: 1px solid rgba(35,101,95,.45); border-radius: 7px; color: #23655f; background: #fff; font: 700 13px/1 inherit; cursor: pointer; }
  .clp-tools button.is-main { border-color: #23655f; color: #fff; background: #23655f; }
  .clp-danmaku { display: flex; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(70,51,34,.2); }
  .clp-danmaku input { flex: 1 1 auto; min-width: 0; padding: 7px 9px; border: 1.5px solid rgba(70,51,34,.2); border-radius: 7px; font: inherit; background: #fff; }
  .clp-danmaku input:focus { outline: none; border-color: #23655f; }
  .clp-danmaku button { flex: 0 0 auto; min-width: 52px; padding: 7px 10px; border: 0; border-radius: 7px; color: #fff; background: #a4492d; font: 800 13px/1 inherit; cursor: pointer; }
  .clp-danmaku button[disabled] { opacity: .55; cursor: default; }
  .clp-panel.is-folded .clp-body { display: none; }
  .clp-panel.is-gate { border-color: rgba(164,73,45,.35); }
  .clp-panel.is-gate a { display: inline-block; margin-top: 8px; padding: 8px 12px; border-radius: 7px; color: #fff; background: #a4492d; text-decoration: none; font-weight: 800; }
  input[data-student-field][readonly] { background: #f1ece3; color: #4d443c; }
  .clp-q { margin: 10px 0 6px; padding: 8px 10px; border: 1px dashed rgba(35,101,95,.4); border-radius: 8px; background: rgba(228,239,235,.45); color: #201c18; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; text-align: left; }
  .clp-q.is-locked { border-style: solid; background: rgba(228,239,235,.7); }
  .clp-q-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .clp-q-send { flex: 0 0 auto; padding: 7px 16px; border: 0; border-radius: 7px; color: #fff; background: #23655f; font: 800 14px/1 inherit; cursor: pointer; }
  .clp-q-send.is-confirm { background: #a4492d; }
  .clp-q-send[disabled] { opacity: .5; cursor: default; }
  .clp-q-state { color: #6d6259; font-size: 13px; }
  .clp-q-state[data-state=ok] { color: #23655f; font-weight: 700; }
  .clp-q-state[data-state=error] { color: #a4492d; font-weight: 700; }
  .clp-note { margin-top: 6px; }
  .clp-note summary { color: #a4492d; font-size: 13px; font-weight: 700; cursor: pointer; }
  .clp-note textarea { display: block; box-sizing: border-box; width: 100%; min-height: 64px; margin-top: 6px; padding: 7px 9px; border: 1.5px solid rgba(70,51,34,.2); border-radius: 7px; background: #fffdf8; color: #201c18; font: 14px/1.6 inherit; resize: vertical; }
  .clp-note textarea:focus { outline: none; border-color: #23655f; }
  #clp-print-view { display: none; }
  @media print {
    .clp-panel, .clp-q { display: none !important; }
    body.clp-printing > *:not(#clp-print-view) { display: none !important; }
    body.clp-printing #clp-print-view { display: block !important; }
  }
  ${worksheet ? `
  form.cl-mcq > .cl-actions { display: none !important; }
  .cl-exit [data-action="submit"], .cl-exit [data-action="reset"], .cl-export, .cl-overview-exit { display: none !important; }` : ''}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('aside');
  panel.className = 'clp-panel';
  panel.setAttribute('data-ix', '');
  panel.setAttribute('aria-label', '课堂作业');
  shield(panel);
  // 避开页面自带的底部固定元素（页码、手机版底部导航等），防止互相遮挡
  const dodge = () => {
    const left = panel.getBoundingClientRect().left;
    const right = panel.getBoundingClientRect().right;
    let bottom = 80;
    document.querySelectorAll('body *').forEach((el) => {
      if (el === panel || panel.contains(el) || getComputedStyle(el).position !== 'fixed') return;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.top < innerHeight / 2 || box.right <= left || box.left >= right) return;
      bottom = Math.max(bottom, Math.ceil(innerHeight - box.top) + 8);
    });
    panel.style.bottom = `${bottom}px`;
  };
  let dodgeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(dodgeTimer); dodgeTimer = setTimeout(dodge, 200); });

  // ---------- 题目 ----------
  // 每道题：{ key, section, title, prompt, el, anchor, read(), check(v), show(v), lock(), restore(v), send(v) }
  const questions = worksheet ? conceptQuestions() : caseQuestions();

  // 递交记录：按页面保存，每个课堂一份（同一页面在别的课堂重新发布时重新作答）
  const LOCK_KEY = `classlive-locked:${location.pathname}`;
  const lockBook = load(LOCK_KEY, {});
  const lastRoom = () => Object.keys(lockBook).sort((a, b) => (lockBook[b].$t || 0) - (lockBook[a].$t || 0))[0];
  const roomKey = OFFLINE ? 'offline' : joined ? String(identity.classroom) : lastRoom();
  const locked = (roomKey && lockBook[roomKey]) || {};
  const remember = (key, entry) => {
    if (!joined) return;
    lockBook[roomKey] = { ...(lockBook[roomKey] || {}), [key]: entry, $t: Date.now() };
    Object.assign(locked, { [key]: entry });
    save(LOCK_KEY, lockBook);
  };
  const noteKey = (key) => `classlive-note:${location.pathname}:${key}`;
  const noteOf = (key) => { try { return localStorage.getItem(noteKey(key)) || ''; } catch (error) { return ''; } };

  // 题目下方：递交按钮、状态、我的备注
  questions.forEach((q) => {
    const bar = document.createElement('div');
    bar.className = 'clp-q';
    bar.setAttribute('data-ix', '');
    bar.innerHTML = `<div class="clp-q-row"${joined ? '' : ' hidden'}><button type="button" class="clp-q-send">递交</button><span class="clp-q-state" aria-live="polite"></span></div>
      <details class="clp-note"><summary>我的备注</summary><textarea rows="3" maxlength="2000" placeholder="写下自己的理解、疑问或课堂讲评要点（只保存在这台设备上，可导出复习）"></textarea></details>`;
    shield(bar);
    q.anchor(bar);
    q.bar = bar;
    q.button = $('.clp-q-send', bar);
    q.state = $('.clp-q-state', bar);
    const note = $('textarea', bar);
    note.value = noteOf(q.key);
    if (note.value) $('details', bar).open = true;
    note.addEventListener('input', () => { try { localStorage.setItem(noteKey(q.key), note.value); } catch (error) { /* 忽略 */ } });
    q.button.addEventListener('click', () => submit(q));
  });

  const IDLE = OFFLINE ? '选好或写好后点“递交”锁定答案，递交后不能修改' : '选好或写好后点“递交”交给老师，递交后不能修改';
  const setQ = (q, text, state) => { q.state.textContent = text; q.state.dataset.state = state || ''; };
  const markLocked = (q, entry) => {
    q.bar.classList.add('is-locked');
    q.button.hidden = true;
    q.lock();
    if (entry && entry.v !== undefined && entry.v !== null && q.restore) q.restore(entry.v);
    setQ(q, entry && entry.other ? '已在其他设备递交（每题只算第一次）' : `已递交（${(entry && entry.at) || ''}），不能再修改`, 'ok');
  };
  questions.forEach((q) => {
    if (locked[q.key]) markLocked(q, locked[q.key]);
    else setQ(q, joined ? IDLE : '', '');
  });

  // 递交：第一次点出现“确认递交？”，3 秒内再点一次才发送
  async function submit(q) {
    if (!joined || locked[q.key]) return;
    const value = q.read();
    const problem = q.check(value);
    if (problem) { setQ(q, problem, 'error'); return; }
    if (!q.button.classList.contains('is-confirm')) {
      q.button.classList.add('is-confirm');
      q.button.textContent = '确认递交？';
      const hint = q.remind ? q.remind() : '';
      setQ(q, hint ? `${hint}；递交后不能修改，确认请再点一次` : '递交后不能修改，确认请再点一次', 'error');
      clearTimeout(q.timer);
      q.timer = setTimeout(() => {
        q.button.classList.remove('is-confirm');
        q.button.textContent = '递交';
        if (!locked[q.key]) setQ(q, IDLE, '');
      }, 3000);
      return;
    }
    clearTimeout(q.timer);
    q.button.classList.remove('is-confirm');
    q.button.textContent = '正在递交……';
    q.button.disabled = true;
    try {
      // 离线版只在本机锁定；在线版交给后台
      const result = OFFLINE ? null : await q.send(value);
      // 服务器说这题之前已递交过（例如在另一台设备上）：以第一次为准，不记这次的作答
      const rejected = result && result.accepted === false;
      const entry = rejected ? { at: '', v: null, other: true } : { at: time(), iso: new Date().toISOString(), v: value };
      remember(q.key, entry);
      markLocked(q, entry);
      if (rejected) setQ(q, '这道题之前已递交过，以第一次为准', 'ok');
      if (result && Array.isArray(result.keys)) syncKeys(result.keys);
    } catch (problemError) {
      console.error(problemError);
      if (Live.isDuplicateError(problemError)) {
        const entry = { at: '', v: null, other: true };
        remember(q.key, entry);
        markLocked(q, entry);
        setQ(q, '这道题之前已递交过，以第一次为准', 'ok');
      } else {
        q.button.disabled = false;
        q.button.textContent = '递交';
        setQ(q, Live.isClosedError(problemError) ? closedText : '递交失败：请检查网络后再试（作答仍在页面上）', 'error');
      }
    }
    refreshCount();
  }
  // 概念学习课程：服务器返回本人已递交的全部题目（可能来自另一台设备）
  function syncKeys(keys) {
    questions.forEach((q) => {
      if (keys.includes(q.key) && !locked[q.key]) {
        const entry = { at: '', v: null, other: true };
        remember(q.key, entry);
        markLocked(q, entry);
      }
    });
  }

  // 收起 / 展开（手机等窄屏默认收起，避免挡住正文；学生展开或收起后记住选择）
  function setupFold() {
    const fold = panel.querySelector('[data-cl-fold]');
    const setFolded = (value) => { panel.classList.toggle('is-folded', value); fold.textContent = value ? '展开' : '收起'; save('classlive-panel-folded', value); };
    fold.addEventListener('click', () => setFolded(!panel.classList.contains('is-folded')));
    const savedFold = load('classlive-panel-folded', null);
    setFolded(savedFold === null ? window.innerWidth < 700 : Boolean(savedFold));
  }

  // ---------- 面板按钮：下一道未递交、导出 ----------
  function bindTools() {
    const next = panel.querySelector('[data-cl-next]');
    if (next) next.addEventListener('click', () => {
      const q = questions.find((item) => !locked[item.key]);
      if (!q) { const state = panel.querySelector('[data-cl-state]'); if (state) { state.textContent = '全部题目都已递交'; state.dataset.state = 'ok'; } return; }
      reveal(q.bar);
    });
    panel.querySelectorAll('[data-cl-export]').forEach((button) => button.addEventListener('click', () => exportWork(button.dataset.clExport)));
  }
  // 翻到题目所在的页（分页式页面），再滚动到题目
  function reveal(el) {
    const page = el.closest('section.page[id], section[id^="case-"]');
    if (page && !page.offsetParent && page.id) location.hash = page.id;
    setTimeout(() => {
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      const button = el.querySelector('.clp-q-send');
      if (button && !button.hidden) button.focus({ preventScroll: true });
    }, 250);
  }

  // ---------- 导出 ----------
  function exportBody() {
    const who = identity.name ? `${esc(identity.name)}（${esc(identity.sid)}${identity.class_name ? ' · ' + esc(identity.class_name) : ''}）` : '未登录';
    let html = `<h1>${esc(document.title)}</h1><p class="meta">${who}　导出时间：${esc(stamp())}${identity.classroom_name && joined ? '　课堂：' + esc(identity.classroom_name) : ''}</p>
      <p class="meta">本文件由课程网站导出，包含题目、我的作答、递交状态${questions.some((q) => q.extra) ? '、自检' : ''}和备注（不含参考答案），供课后复习。</p>`;
    let section = '';
    questions.forEach((q) => {
      if (q.section !== section) { section = q.section; html += `<h2>${esc(section)}</h2>`; }
      const entry = locked[q.key];
      const value = entry && entry.v !== null && entry.v !== undefined ? entry.v : q.read();
      // 在其他设备递交的题：本设备没有当时的作答，不拿页面上现在的选择冒充
      const lines = entry && entry.other ? ['（本题已在其他设备递交，以第一次递交为准；本设备没有记录当时的作答）'] : q.show(value);
      const note = noteOf(q.key).trim();
      const extra = q.extra ? q.extra() : null;
      const state = entry ? (entry.other ? '已在其他设备递交' : `已递交 ${entry.at || ''}`) : (lines.length ? '未递交（草稿）' : '未作答');
      html += `<article><h3>${esc(q.title)}<span class="state${entry ? ' ok' : ''}">${esc(state)}</span></h3>
        ${q.prompt ? `<p class="prompt">${esc(q.prompt)}</p>` : ''}
        <div class="answer"><b>我的作答</b>${lines.length ? lines.map((line) => `<p>${esc(line)}</p>`).join('') : '<p class="empty">（未作答）</p>'}</div>
        ${extra ? `<div class="check"><b>${esc(extra.label)}</b>${extra.lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>` : ''}
        ${note ? `<div class="note"><b>我的备注</b><p>${esc(note)}</p></div>` : ''}</article>`;
    });
    return html;
  }
  const EXPORT_CSS = `body{margin:0 auto;max-width:860px;padding:28px 22px;color:#201c18;background:#fff;font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","SimSun",sans-serif}
    h1{margin:0 0 6px;font-size:24px}h2{margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid #23655f;color:#23655f;font-size:19px}
    h3{display:flex;justify-content:space-between;gap:12px;margin:0 0 4px;font-size:16px}.meta{margin:2px 0;color:#6d6259;font-size:13px}
    article{margin:12px 0;padding:12px 14px;border:1px solid #ddd3c4;border-radius:8px;break-inside:avoid;page-break-inside:avoid}
    .state{flex:0 0 auto;color:#a4492d;font-size:13px;font-weight:600}.state.ok{color:#23655f}.prompt{margin:4px 0 8px;color:#4d443c}
    .answer,.note,.check{margin-top:6px;padding:8px 10px;border-radius:6px;background:#f4f8f6}.note{background:#fbf3e6}.check{background:#f1f3f8}
    .answer b,.note b,.check b{display:block;color:#6d6259;font-size:12.5px}.answer p,.note p,.check p{margin:2px 0;white-space:pre-wrap}.empty{color:#9a8f85}`;
  // 导出文件里附带已递交的作答（JSON），老师可在离线完整版“导入学生文件”统计
  function exportData() {
    const answers = {};
    questions.forEach((q) => {
      const entry = locked[q.key];
      if (entry && entry.v !== null && entry.v !== undefined) answers[q.key] = { v: entry.v, at: entry.iso || '' };
    });
    return { format: 'classlive-export', version: 1, course: config.course, kind: config.kind, unit, title: document.title,
      mode: OFFLINE ? 'offline' : 'online', exported_at: new Date().toISOString(), total: questions.length,
      student: { name: identity.name || '', sid: identity.sid || '', class_name: identity.class_name || '' }, answers };
  }
  function exportWork(kind) {
    const state = panel.querySelector('[data-cl-export-state]');
    const wechat = /MicroMessenger/i.test(navigator.userAgent);
    if (OFFLINE && (!identity.name || !identity.sid)) {
      if (state) { state.textContent = '请先在面板上方填写姓名和学号，导出的文件交给老师时才能对上人。'; state.dataset.state = 'error'; }
      const first = panel.querySelector(identity.name ? '[data-off="sid"]' : '[data-off="name"]');
      if (first) first.focus();
      return;
    }
    if (state) state.dataset.state = '';
    const who = identity.name ? `${identity.name}_${identity.sid || ''}_` : '';
    const name = `${who}${document.title.replace(/[\\/:*?"<>|\s·]+/g, '_')}_我的作答与备注_${stamp().slice(0, 10)}`.replace(/[\\/:*?"<>|\s]+/g, '_');
    if (kind === 'html') {
      const data = JSON.stringify(exportData()).replace(/</g, '\\u003c');
      const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(document.title)} · 我的作答与备注</title><style>${EXPORT_CSS}</style>`
        + `<script type="application/json" id="classlive-export">${data}</` + `script></head><body>${exportBody()}</body></html>`;
      const url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (state) state.textContent = wechat ? '微信里可能无法下载文件：请点右上角“…”，选择在浏览器中打开后再导出。'
        : OFFLINE ? '已生成 HTML 文件（在“下载”里找到）：把这个文件发给老师，自己也可以离线打开复习。' : '已生成 HTML 文件（在“下载”里找到，离线也能打开）。';
      return;
    }
    // PDF：只打印导出内容，在打印对话框里选“存储为 PDF”
    let view = document.getElementById('clp-print-view');
    if (!view) { view = document.createElement('div'); view.id = 'clp-print-view'; document.body.appendChild(view); }
    view.innerHTML = `<style>@media print{${EXPORT_CSS.replace(/body\{/, '#clp-print-view{')}}</style>${exportBody()}`;
    document.body.classList.add('clp-printing');
    const done = () => { document.body.classList.remove('clp-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    if (state) state.textContent = wechat ? '微信里可能无法打印：请点右上角“…”，选择在浏览器中打开后再导出。' : '在打印窗口的“目标打印机”里选择“存储为 PDF”（手机上选“打印”后再分享或存储）。';
    try { window.print(); } catch (error) { done(); }
    setTimeout(done, 60000);
  }

  // ---------- 面板 ----------
  const tools = `<div class="clp-tools"><button type="button" data-cl-next class="is-main"${joined ? '' : ' hidden'}>下一道未递交 ↓</button><button type="button" data-cl-export="html">导出 HTML</button><button type="button" data-cl-export="pdf">导出 PDF</button></div>
    <p class="clp-hint" data-cl-export-state>导出内容：题目、我的作答、递交状态${questions.some((q) => q.extra) ? '、自检' : ''}和备注，方便课后复习。</p>`;
  if (!joined) {
    panel.classList.add('is-gate');
    const elsewhere = identity.classroom && identity.course === config.course && identity.chapter && identity.chapter !== unit;
    panel.innerHTML = (elsewhere
      ? `<strong>本周课堂不在这一页</strong><div class="clp-room">你已进入“${esc(identity.classroom_name)}”。本页可以写备注、导出复习，但不能递交。</div><a href="${joinUrl()}">回到登录页</a>`
      : '<strong>还没有进入课堂</strong><div class="clp-room">请在首页输入老师发布的课堂码并填写个人信息，才能递交作答。本页可以写备注、导出复习。</div><a href="/">去登录</a>')
      + (questions.length ? tools : '');
    document.body.appendChild(panel);
    dodge();
    bindTools();
    setupMechDanmaku(false, elsewhere ? '本周课堂不在这一页，这里不能发弹幕。' : '进入课堂后才能发弹幕：请先在首页输入老师发布的课堂码。');
    return;
  }

  // 离线版：面板里填写姓名、学号、班级（导出文件靠它对上人）；不联网，没有弹幕
  if (OFFLINE) {
    panel.innerHTML = `
      <div class="clp-who"><span><strong>离线作业</strong> <small>不联网也能用</small></span><span><button type="button" class="clp-link" data-cl-fold>收起</button></span></div>
      <div class="clp-body">
        <div class="clp-ident">
          <input type="text" data-off="name" maxlength="20" placeholder="姓名" aria-label="姓名" autocomplete="name">
          <input type="text" data-off="sid" maxlength="20" placeholder="学号" aria-label="学号" autocomplete="off">
          <input type="text" data-off="class_name" maxlength="40" placeholder="班级" aria-label="班级" autocomplete="off">
        </div>
        <div class="clp-progress"${questions.length ? '' : ' hidden'}><span class="clp-count" data-cl-count></span><span class="clp-state" data-cl-state>每题做完点题目下方的“递交”锁定答案；全部做完后点“导出 HTML”，把文件发给老师</span>${tools}</div>
      </div>`;
    document.body.appendChild(panel);
    dodge();
    setupFold();
    bindTools();
    refreshCount();
    setupMechDanmaku(false, '离线版不能发弹幕，可以在课堂上直接说一说。');
    // 与练习页自带的姓名、学号、班级同步
    const pageField = { name: 'name', sid: 'id', class_name: 'class' };
    panel.querySelectorAll('[data-off]').forEach((input) => {
      const field = input.dataset.off;
      const pageInput = document.querySelector(`input[data-student-field="${pageField[field]}"]`);
      input.value = identity[field] || (pageInput && pageInput.value) || '';
      identity[field] = input.value.trim();
      input.addEventListener('input', () => {
        identity[field] = input.value.trim();
        save(OFFLINE_STORE, identity);
        if (pageInput) { pageInput.value = input.value; pageInput.dispatchEvent(new Event('input', { bubbles: true })); }
      });
    });
    return;
  }

  panel.innerHTML = `
    <div class="clp-who"><span><strong>${esc(identity.name)}</strong> <small>${esc(identity.sid)} · ${esc(identity.class_name || '')}${identity.group_name ? ' · ' + esc(identity.group_name) : ''}</small></span>
      <span><button type="button" class="clp-link" data-cl-fold>收起</button> <button type="button" class="clp-link" data-cl-switch>不是我</button></span></div>
    <div class="clp-body">
      <div class="clp-room">${esc(identity.classroom_name || '')}</div>
      <div class="clp-progress"${questions.length ? '' : ' hidden'}><span class="clp-count" data-cl-count></span><span class="clp-state" data-cl-state>每题做完点题目下方的“递交”，递交后不能修改</span>${tools}</div>
      <form class="clp-danmaku" data-cl-danmaku>
        <input type="text" maxlength="40" placeholder="发一条弹幕（40 字内）" aria-label="弹幕内容" autocomplete="off">
        <button type="submit">发送</button>
      </form>
      <p class="clp-hint" data-cl-dm-state>弹幕会以“你的姓名：内容”显示在老师投屏的页面上，请文明发言。</p>
    </div>`;
  document.body.appendChild(panel);
  dodge();
  panel.querySelector('[data-cl-switch]').addEventListener('click', () => {
    save(STORE, { code: identity.code });
    location.href = joinUrl();
  });
  setupFold();
  if (window.ClassLive) window.ClassLive.attached = true;
  bindTools();

  function refreshCount() {
    const countEl = panel.querySelector('[data-cl-count]');
    if (!countEl) return;
    const done = questions.filter((q) => locked[q.key]).length;
    countEl.textContent = `已递交 ${done}/${questions.length} 题`;
  }
  refreshCount();

  // 页面原有的即时提交（选择类）改为先选、再“递交”
  document.addEventListener('classlive:choice', (event) => {
    const el = event.detail && event.detail.el;
    const status = el && el.querySelector('[data-live-status]');
    if (status) { status.textContent = '已选择，点下方“递交”交给老师'; status.dataset.state = ''; }
  });

  // 页面里的姓名、学号、班级：按课堂登录信息填写并锁定
  const fields = { name: identity.name, id: identity.sid, class: identity.class_name || '' };
  $$('input[data-student-field]').forEach((input) => {
    const value = fields[input.dataset.studentField];
    if (value === undefined) return;
    if (input.value !== value) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
    input.readOnly = true;
    input.title = '已按课堂登录信息填写';
  });

  // ---------- 弹幕 ----------
  const dmForm = panel.querySelector('[data-cl-danmaku]');
  const dmInput = dmForm.querySelector('input');
  const dmButton = dmForm.querySelector('button');
  const dmState = panel.querySelector('[data-cl-dm-state]');
  const COOLDOWN = 5;
  let cooling = 0;
  // 面板和机制图“弹幕接龙”共用每 5 秒一条的冷却；ready() 为 false 的按钮冷却结束后仍保持不可用
  const dmButtons = [{ button: dmButton, ready: () => true }];
  const showCooling = () => dmButtons.forEach(({ button, ready }) => {
    button.textContent = cooling > 0 ? `${cooling}s` : '发送';
    button.disabled = cooling > 0 || !ready();
  });
  const cool = () => {
    cooling = COOLDOWN;
    showCooling();
    const tick = setInterval(() => {
      cooling -= 1;
      showCooling();
      if (cooling <= 0) clearInterval(tick);
    }, 1000);
  };
  const dmProblem = (problem) => (Live.isClosedError(problem)
    ? '现在不能发弹幕：老师未开放弹幕，或发送太快（每 5 秒一条）。'
    : '发送失败：请检查网络后再试。');
  async function sendDanmaku(text) {
    await backend.add('danmaku', { course: config.course, classroom: identity.classroom, name: identity.name, sid: identity.sid, text });
    cool();
  }
  dmForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = dmInput.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!text || cooling > 0) return;
    dmButton.disabled = true;
    try {
      await sendDanmaku(text);
      dmInput.value = '';
      dmState.textContent = `已发送（${time()}）。若老师开启了审核，通过后才会上屏。`;
      dmState.dataset.state = 'ok';
    } catch (problem) {
      console.error(problem);
      dmButton.disabled = false;
      dmState.dataset.state = 'error';
      dmState.textContent = dmProblem(problem);
    }
  });
  setupMechDanmaku(true);

  // 机制图“弹幕接龙”：选一个箭头（如 ①→②），用一句话说这两步的关系；
  // 弹幕带“【案例号箭头】”标签（如【01①→②】），投屏机制图据此把它放到对应节点下面
  function setupMechDanmaku(enabled, note) {
    $$('[data-mech-dm]').forEach((box) => {
      const links = $$('[data-mech-link]', box);
      const form = $('[data-mech-dm-form]', box);
      const input = $('input', form);
      const button = $('button', form);
      const state = $('[data-mech-dm-state]', box);
      const say = (text, kind) => { state.textContent = text; state.dataset.state = kind || ''; };
      shield(box);
      if (!enabled) {
        links.forEach((link) => { link.disabled = true; });
        input.disabled = true;
        button.disabled = true;
        say(note);
        return;
      }
      let link = '';
      dmButtons.push({ button, ready: () => Boolean(link) });
      links.forEach((item) => { item.disabled = false; });
      say('先选一个箭头，再写一句话（弹幕会显示你的姓名）。');
      links.forEach((item) => item.addEventListener('click', () => {
        link = item.dataset.mechLink;
        links.forEach((other) => other.setAttribute('aria-pressed', String(other === item)));
        input.disabled = false;
        input.placeholder = `${link}：这两步之间是什么关系？`;
        showCooling();
        input.focus();
        say(`已选 ${link}，写一句话后点“发送”（${input.maxLength} 字内）。`);
      }));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = input.value.replace(/\s+/g, ' ').trim();
        if (!link) { say('先选一个箭头。', 'error'); return; }
        if (!text || cooling > 0) return;
        button.disabled = true;
        try {
          await sendDanmaku(`【${box.dataset.case}${link}】${text}`.slice(0, 40));
          input.value = '';
          say(`已发送（${time()}），会出现在投屏机制图 ${link} 的位置。若老师开启了审核，通过后才会上屏。`, 'ok');
        } catch (problem) {
          console.error(problem);
          showCooling();
          say(dmProblem(problem), 'error');
        }
      });
    });
  }

  // ================= 两类课程的题目 =================
  function base() {
    return { course: config.course, classroom: identity.classroom, session: Live.today(),
      name: identity.name, sid: identity.sid, path: location.pathname };
  }

  // ---------- 案例课程（习经章节页） ----------
  function caseQuestions() {
    const list = [];
    const caseTitle = (el) => {
      const section = el.closest('[id^="case-"]');
      const no = el.dataset.liveCase || (section && (section.id.match(/^case-(\d{2})/) || [])[1]) || '';
      const heading = section && section.querySelector('h2');
      return `案例 ${no}${heading ? ' · ' + textOf(heading) : ''}`;
    };
    const pressed = (root, selector) => root.querySelector(`${selector}[aria-pressed="true"]`);
    // 投票（前测、后测）与方案推演每一轮
    $$('[data-live-choice]').forEach((group) => {
      const options = $$('[data-live-option]', group);
      const item = group.dataset.liveItem;
      const heading = group.matches('li') ? `${textOf(group.querySelector('strong'))}：${textOf(group.querySelector('p'))}` : textOf(group.querySelector('h3'));
      const kind = item === 'pre' ? '课堂投票 · 前测' : item === 'post' ? '课堂投票 · 后测' : item === 'transfer-k' ? '迁移任务 · 选一选' : `方案推演 · ${textOf(group.querySelector('strong')) || item}`;
      const labelOf = (value) => { const button = options.find((b) => b.dataset.liveOption === value); return button ? `${textOf(button.querySelector('span'))} ${textOf(button.querySelector('strong') || button)}` : value; };
      list.push({
        key: `${group.dataset.liveCase}:${item}`, section: caseTitle(group), title: kind, prompt: heading,
        anchor: (bar) => group.appendChild(bar),
        read: () => { const button = pressed(group, '[data-live-option]'); return button ? button.dataset.liveOption : null; },
        check: (value) => (value ? '' : '请先选一项，再点“递交”'),
        show: (value) => (value ? [labelOf(value)] : []),
        lock: () => options.forEach((button) => { button.disabled = true; }),
        restore: (value) => options.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.liveOption === value))),
        send: (value) => {
          const button = options.find((b) => b.dataset.liveOption === value);
          return backend.add('choices', { ...base(), case: group.dataset.liveCase, item, choice: value,
            label: textOf(button && (button.querySelector('strong') || button)).slice(0, 120) });
        },
      });
    });
    // 证据—理论配对：一次递交全部线索
    $$('[data-live-match]').forEach((matchPanel) => {
      const rows = $$('[data-match-row]', matchPanel);
      const clue = (row) => { const cell = row.querySelector('th').cloneNode(true); cell.querySelectorAll('small').forEach((el) => el.remove()); return textOf(cell); };
      const choiceOf = (row) => { const button = pressed(row, '[data-match-choice]'); return button ? button.dataset.matchChoice : (row.dataset.choice || null); };
      list.push({
        key: `${matchPanel.dataset.liveCase}:match`, section: caseTitle(matchPanel), title: '证据—理论配对', prompt: textOf(matchPanel.querySelector('h3')),
        anchor: (bar) => matchPanel.appendChild(bar),
        read: () => { const value = rows.map(choiceOf); return value.some(Boolean) ? value : null; },
        check: (value) => { const missing = rows.length - (value || []).filter(Boolean).length; return missing ? `还有 ${missing} 条线索没有选，全部选好再递交` : ''; },
        show: (value) => (value ? rows.map((row, i) => `${clue(row)} → ${value[i] ? 'K' + value[i] : '未选'}`) : []),
        lock: () => rows.forEach((row) => $$('[data-match-choice]', row).forEach((button) => { button.disabled = true; })),
        restore: (value) => rows.forEach((row, i) => $$('[data-match-choice]', row).forEach((button) => {
          const on = button.dataset.matchChoice === String(value[i]);
          button.setAttribute('aria-pressed', String(on));
          button.classList.toggle('selected', on);
        })),
        send: (value) => backend.addMany('choices', rows.map((row, i) => ({ ...base(), case: matchPanel.dataset.liveCase, item: row.dataset.liveItem,
          choice: `K${value[i]}`, label: `K${value[i]}` }))),
      });
    });
    // 文字作答
    $$('[data-live-answer]').forEach((box) => {
      const area = box.querySelector('textarea');
      let holder = box.parentElement;
      while (holder && !holder.querySelector('h3')) holder = holder.parentElement;
      const heading = holder ? holder.querySelector('h3') : null;
      const number = box.closest('.question-item') ? textOf(box.closest('.question-item').querySelector('.question-number')) : '';
      const names = { warmup: '导入问题 · 第一判断', digest: '材料归纳 · 申论式', role: '四方立场 · 我选的角色', 'sim-basis': '方案推演 · 教材依据', transfer: '迁移任务 · 说一说', summary: '三句话结论' };
      const item = box.dataset.liveItem;
      const title = names[item] || (/^myth-/.test(item) ? `常见误区 ${item.slice(5)}` : number || item.toUpperCase());
      const selfcheck = box.parentElement ? box.parentElement.querySelector('[data-selfcheck]') : null;
      list.push({
        key: `${box.dataset.liveCase}:${item}`, section: caseTitle(box), title, prompt: heading ? textOf(heading) : '',
        extra: selfcheck ? () => {
          const boxes = $$('input[data-selfcheck-item]', selfcheck);
          const done = boxes.filter((input) => input.checked).length;
          const steps = boxes.map((input) => `${input.checked ? '☑' : '☐'} ${textOf(input.closest('label').querySelector('b')).replace(/^[①②③④]\s*/, '')}`);
          return { label: `写完自检（${done}/${boxes.length}）`, lines: [steps.join('　')] };
        } : null,
        // 自检没勾全时，在“确认递交？”这一步提醒一句（不阻止递交）
        remind: selfcheck ? () => {
          const missing = $$('input[data-selfcheck-item]', selfcheck).filter((input) => !input.checked)
            .map((input) => textOf(input.closest('label').querySelector('b')).replace(/^[①②③④]\s*/, ''));
          return missing.length ? `自检还没勾：${missing.join('、')}，可以先补上` : '';
        } : null,
        // Q1—Q4：递交放在“写完自检”下面——先写、再自检、最后递交
        anchor: (bar) => (selfcheck ? selfcheck.insertAdjacentElement('afterend', bar) : box.appendChild(bar)),
        read: () => (area.value.trim() ? area.value.trim() : null),
        check: (value) => (value ? '' : '请先写好作答，再点“递交”'),
        show: (value) => (value ? [value] : []),
        lock: () => { area.readOnly = true; },
        restore: (value) => { if (!area.value.trim()) area.value = value; },
        send: (value) => backend.add('answers', { ...base(), case: box.dataset.liveCase, item, text: String(value).slice(0, 1500) }),
      });
    });
    return list;
  }

  // ---------- 概念学习课程（政治经济学练习页） ----------
  function conceptQuestions() {
    const node = document.getElementById('concept-data');
    const D = node ? JSON.parse(node.textContent) : { concepts: [], exit: [] };
    const list = [];
    const LET = (i) => String.fromCharCode(65 + Number(i));
    const radio = (root) => { const input = root.querySelector('input[type=radio]:checked'); return input ? input.value : null; };
    const setRadio = (root, value) => $$('input[type=radio]', root).forEach((input) => { input.checked = String(input.value) === String(value); });
    const segValues = (root) => $$('.cl-item', root).map((item) => { const button = item.querySelector('button[aria-pressed="true"]'); return button ? Number(button.dataset.value) : null; });
    const segRestore = (root, values) => $$('.cl-item', root).forEach((item, i) => $$('button', item).forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.value) === values[i]))));
    const disable = (root, selector) => $$(selector, root).forEach((el) => { el.disabled = true; });
    const text = (el) => (el && el.value.trim() ? el.value.trim() : null);
    const after = (el) => (bar) => el.insertAdjacentElement('afterend', bar);
    const send = (key) => async (value) => {
      const rows = await backend.rpc('ck_submit_answer', {
        p_classroom: identity.classroom, p_unit: unit, p_name: identity.name, p_sid: identity.sid,
        p_class: identity.class_name || '', p_group: identity.group_name || '', p_key: key, p_value: value, p_total: list.length,
      });
      return Array.isArray(rows) ? rows[0] : rows;
    };
    const choiceQuestion = (key, section, title, form) => ({
      key, section, title, prompt: textOf(form.querySelector('legend')), anchor: after(form),
      read: () => { const value = radio(form); return value === null ? null : Number(value); },
      check: (value) => (value === null ? '请先选一项，再点“递交”' : ''),
      show: (value) => (value === null || value === undefined ? [] : [`${LET(value)}. ${textOf($$('.cl-option-text', form)[value])}`]),
      lock: () => { const fieldset = form.querySelector('fieldset'); if (fieldset) fieldset.disabled = true; },
      restore: (value) => setRadio(form, value),
      // 先让页面记下这次选择（本机进度），再交给老师
      send: (value) => { try { form.requestSubmit(); } catch (error) { /* 旧浏览器忽略 */ } return send(key)(value); },
    });
    (D.concepts || []).forEach((k, index) => {
      const unitEl = $(`.cl-unit[data-concept="${k.id}"]`);
      if (!unitEl) return;
      const section = `概念 ${index + 1} · ${k.name}`;
      const discover = unitEl.querySelector('.cl-mcq[data-kind="discover"]');
      if (discover) list.push(choiceQuestion(`${k.id}.discover`, section, '想一想', discover));
      const checkStep = unitEl.querySelector('[data-step="check"]');
      const judge = checkStep && checkStep.querySelector('.cl-judge');
      const checkForm = checkStep && checkStep.querySelector('.cl-mcq');
      if (judge) {
        const items = $$('.cl-item', judge);
        list.push({
          key: `${k.id}.check`, section, title: '辨一辨', prompt: textOf(judge.querySelector('.cl-prompt')), anchor: after(judge),
          read: () => { const values = segValues(judge); return values.some((v) => v !== null) ? values : null; },
          check: (values) => { const missing = items.length - (values || []).filter((v) => v !== null).length; return missing ? `还有 ${missing} 条没有判断，全部判断后再递交` : ''; },
          show: (values) => (values ? items.map((item, i) => `${i + 1}. ${textOf(item.querySelector('.cl-item-text'))} —— ${values[i] === 1 ? '说得对' : values[i] === 0 ? '说得不对' : '未选'}`) : []),
          lock: () => disable(judge, 'button'),
          restore: (values) => segRestore(judge, values),
          send: send(`${k.id}.check`),
        });
      } else if (checkForm) {
        list.push(choiceQuestion(`${k.id}.check`, section, '辨一辨', checkForm));
      }
      const applyStep = unitEl.querySelector('[data-step="apply"]');
      const sort = applyStep && applyStep.querySelector('.cl-sort');
      const fill = applyStep && applyStep.querySelector('.cl-fill');
      const calc = applyStep && applyStep.querySelector('.cl-calc');
      if (sort) {
        const items = $$('.cl-item', sort);
        const binOf = (i, value) => { const button = items[i] && items[i].querySelector(`button[data-value="${value}"]`); return button ? textOf(button) : ''; };
        list.push({
          key: `${k.id}.apply`, section, title: '用一用 · 分一分', prompt: textOf(sort.querySelector('.cl-prompt')), anchor: after(sort),
          read: () => { const values = segValues(sort); return values.some((v) => v !== null) ? values : null; },
          check: (values) => { const missing = items.length - (values || []).filter((v) => v !== null).length; return missing ? `还有 ${missing} 项没有分类，全部分好再递交` : ''; },
          show: (values) => (values ? items.map((item, i) => `${textOf(item.querySelector('.cl-item-text'))} → ${values[i] === null ? '未选' : binOf(i, values[i])}`) : []),
          lock: () => disable(sort, 'button'),
          restore: (values) => segRestore(sort, values),
          send: send(`${k.id}.apply`),
        });
      } else if (fill) {
        const selects = $$('select', fill);
        list.push({
          key: `${k.id}.apply`, section, title: '用一用 · 填一填', prompt: textOf(fill.querySelector('.cl-prompt')), anchor: after(fill),
          read: () => { const values = selects.map((s) => s.value || null); return values.some(Boolean) ? values : null; },
          check: (values) => { const missing = selects.length - (values || []).filter(Boolean).length; return missing ? `还有 ${missing} 个空没有选，全部选好再递交` : ''; },
          show: (values) => (values ? selects.map((s, i) => `第 ${i + 1} 空：${values[i] || '未选'}`) : []),
          lock: () => selects.forEach((s) => { s.disabled = true; }),
          restore: (values) => selects.forEach((s, i) => { s.value = values[i] || ''; }),
          send: send(`${k.id}.apply`),
        });
      } else if (calc) {
        const fields = $$('.cl-fields .cl-field', calc);
        const inputs = fields.map((f) => f.querySelector('input'));
        const fieldsBox = calc.querySelector('.cl-fields');
        list.push({
          key: `${k.id}.apply`, section, title: '用一用 · 算一算', prompt: textOf(calc.querySelector('.cl-prompt')),
          anchor: (bar) => (calc.querySelector('.cl-actions') || fieldsBox).insertAdjacentElement('afterend', bar),
          read: () => { const values = inputs.map((i) => i.value.trim() || null); return values.some(Boolean) ? values : null; },
          check: (values) => { const missing = inputs.length - (values || []).filter(Boolean).length; return missing ? `还有 ${missing} 项没有填，全部填好再递交` : ''; },
          show: (values) => (values ? fields.map((f, i) => `${textOf(f.querySelector('label'))}：${values[i] || '未填'} ${textOf(f.querySelector('.cl-input span'))}`.trim()) : []),
          lock: () => inputs.forEach((i) => { i.readOnly = true; }),
          restore: (values) => inputs.forEach((input, i) => { input.value = values[i] || ''; }),
          send: send(`${k.id}.apply`),
        });
        const challenge = calc.querySelector('.cl-challenge');
        if (challenge) {
          const input = challenge.querySelector('input');
          list.push({
            key: `${k.id}.challenge`, section, title: '用一用 · 变一变', prompt: textOf(challenge.querySelector('.cl-prompt')), anchor: (bar) => challenge.appendChild(bar),
            read: () => text(input),
            check: (value) => (value ? '' : '请先填好答案，再点“递交”'),
            show: (value) => (value ? [`${value} ${textOf(challenge.querySelector('.cl-input span'))}`.trim()] : []),
            lock: () => { input.readOnly = true; },
            restore: (value) => { input.value = value; },
            send: send(`${k.id}.challenge`),
          });
        }
      }
      const explainStep = unitEl.querySelector('[data-step="explain"]');
      const explain = explainStep && explainStep.querySelector('textarea');
      if (explain) {
        list.push({
          key: `${k.id}.explain`, section, title: '一句话说清', prompt: textOf(explainStep.querySelector('.cl-frame')).replace(/^句式/, '句式：'),
          anchor: (bar) => explainStep.appendChild(bar),
          read: () => text(explain),
          check: (value) => (value ? '' : '请先写好这句话，再点“递交”'),
          show: (value) => (value ? [value] : []),
          lock: () => { explain.readOnly = true; },
          restore: (value) => { if (!explain.value.trim()) explain.value = value; },
          send: send(`${k.id}.explain`),
        });
      }
    });
    // 概念串联：按页面上的先后顺序递交句子编号
    const chain = $('.cl-chain');
    if (chain) {
      const listEl = chain.querySelector('.cl-chain-list');
      const itemText = (id) => textOf(listEl.querySelector(`.cl-chain-item[data-step-id="${id}"] p`));
      list.push({
        key: 'chain', section: '概念串联', title: '排一排', prompt: textOf(chain.querySelector('.cl-prompt')), anchor: after(chain),
        read: () => $$('.cl-chain-item', listEl).map((li) => Number(li.dataset.stepId)),
        check: () => '',
        show: (order) => (order ? order.map((id, pos) => `${pos + 1}. ${itemText(id)}`) : []),
        lock: () => disable(chain, 'button'),
        restore: (order) => order.forEach((id) => { const li = listEl.querySelector(`.cl-chain-item[data-step-id="${id}"]`); if (li) listEl.appendChild(li); }),
        send: send('chain'),
      });
    }
    // 小组辨析：立场＋理由；讨论后的补充另行递交
    const disc = $('.cl-disc-work');
    if (disc) {
      const reason = disc.querySelector('textarea[data-cl-text="discussion.reason"]');
      const later = disc.querySelector('textarea[data-cl-text="discussion.after"]');
      const question = textOf(document.querySelector('.cl-claim h3'));
      list.push({
        key: 'discussion', section: '小组辨析', title: '我的立场和理由', prompt: question,
        anchor: (bar) => ((reason && reason.nextElementSibling && reason.nextElementSibling.classList.contains('cl-print')) ? reason.nextElementSibling : reason).insertAdjacentElement('afterend', bar),
        read: () => { const value = { stance: radio(disc.querySelector('.cl-stance')), reason: text(reason) }; return value.stance || value.reason ? value : null; },
        check: (value) => (!value || !value.stance ? '请先选择立场' : !value.reason ? '请写好理由再递交' : ''),
        show: (value) => (value ? [`立场：${value.stance || '未选'}`, `理由：${value.reason || '未写'}`] : []),
        lock: () => { disable(disc.querySelector('.cl-stance'), 'input'); if (reason) reason.readOnly = true; },
        restore: (value) => { setRadio(disc.querySelector('.cl-stance'), value.stance); if (reason && !reason.value.trim()) reason.value = value.reason || ''; },
        send: send('discussion'),
      });
      if (later) {
        list.push({
          key: 'discussion.after', section: '小组辨析', title: '讨论后的修改或补充', prompt: '讨论后，我修改或补充的想法',
          anchor: (bar) => ((later.nextElementSibling && later.nextElementSibling.classList.contains('cl-print')) ? later.nextElementSibling : later).insertAdjacentElement('afterend', bar),
          read: () => text(later),
          check: (value) => (value ? '' : '请先写好，再点“递交”'),
          show: (value) => (value ? [value] : []),
          lock: () => { later.readOnly = true; },
          restore: (value) => { if (!later.value.trim()) later.value = value; },
          send: send('discussion.after'),
        });
      }
    }
    // 出门测：每题单独递交
    $$('.cl-exit .cl-exit-item').forEach((item, i) => {
      const legend = item.querySelector('legend').cloneNode(true);
      legend.querySelectorAll('.cl-exit-tag').forEach((tag) => tag.remove());
      list.push({
        key: `exit.${i}`, section: '出门测', title: `第 ${i + 1} 题`, prompt: textOf(legend), anchor: (bar) => item.appendChild(bar),
        read: () => { const value = radio(item); return value === null ? null : Number(value); },
        check: (value) => (value === null ? '请先选一项，再点“递交”' : ''),
        show: (value) => (value === null || value === undefined ? [] : [`${LET(value)}. ${textOf($$('.cl-option-text', item)[value])}`]),
        lock: () => disable(item, 'input'),
        restore: (value) => setRadio(item, value),
        send: send(`exit.${i}`),
      });
    });
    // 案例 01：课堂投票
    const poll = $('[data-poll]');
    if (poll && D.poll) {
      const labelOf = (value) => ((D.poll.options || []).find((o) => o.value === value) || {}).label || value;
      list.push({
        key: 'poll', section: '课堂投票', title: textOf(poll.querySelector('h3')), prompt: textOf(poll.querySelector('h3 + p')),
        anchor: after(poll.querySelector('fieldset')),
        read: () => radio(poll),
        check: (value) => (value ? '' : '请先选一项，再点“递交”'),
        show: (value) => (value ? [labelOf(value)] : []),
        lock: () => disable(poll, 'input'),
        restore: (value) => setRadio(poll, value),
        send: send('poll'),
      });
    }
    return list;
  }
})();
