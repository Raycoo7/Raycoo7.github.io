/* 学生端（章节页）：确认是从首页用课堂码进入的本周课堂后，
 *   · 投票、配对、推演等选择：点选后立即交给老师，可以改选；
 *   · 文字作答：自动保存为本机草稿，点“提交作业”一次交给老师，修改后可再次提交（老师看到最新一次）；
 *   · 弹幕：发送短句，显示在老师投屏的课堂页面上（老师开放后可用，发送人仅老师可见）。
 * 需要页面先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 */
(function () {
  'use strict';
  const config = window.CLASS_LIVE_CONFIG;
  if (!config || config.provider === 'off' || !window.ClassLive) return;
  // 地址栏里的解密值用完即清，避免被复制转发
  if (/staticrypt_pwd=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  let backend;
  try {
    backend = window.ClassLive.create(config);
  } catch (error) {
    console.warn('[课堂后台] 未启用：', error.message);
    return;
  }

  const STORE = 'classlive-student';
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (error) { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* 忽略 */ } };
  const identity = load(STORE, {});
  const chapter = (location.pathname.match(/(ch\d{2})\.html$/) || [])[1];
  const joined = Boolean(identity.classroom && identity.name && identity.sid
    && identity.course === config.course && identity.chapter === chapter);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = () => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const joinUrl = () => '/' + (identity.code ? `?join=${encodeURIComponent(identity.code)}` : '');

  const style = document.createElement('style');
  style.textContent = `
  .cl-panel { position: fixed; z-index: 90; left: 16px; bottom: 80px; width: min(360px, calc(100vw - 32px)); padding: 12px 14px; border: 1px solid rgba(35,101,95,.28); border-radius: 10px; background: rgba(255,253,248,.97); color: #201c18; box-shadow: 0 12px 30px rgba(0,0,0,.14); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .cl-who { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .cl-who strong { font-size: 15px; }
  .cl-who small, .cl-room, .cl-hint { color: #6d6259; font-size: 12.5px; }
  .cl-hint { margin: 6px 0 0; line-height: 1.5; }
  .cl-hint[data-state=ok] { color: #23655f; }
  .cl-hint[data-state=error] { color: #a4492d; font-weight: 700; }
  .cl-link { padding: 0; border: 0; background: none; color: #a4492d; font: inherit; font-size: 12.5px; text-decoration: underline; cursor: pointer; white-space: nowrap; }
  .cl-progress { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(70,51,34,.2); }
  .cl-state { color: #6d6259; font-size: 13px; }
  .cl-state[data-state=ok] { color: #23655f; font-weight: 700; }
  .cl-state[data-state=error], .cl-state[data-state=dirty] { color: #a4492d; font-weight: 700; }
  .cl-submit { flex: 0 0 auto; padding: 9px 14px; border: 0; border-radius: 7px; color: #fff; background: #23655f; font: 800 14px/1 inherit; cursor: pointer; }
  .cl-submit[disabled] { opacity: .55; cursor: default; }
  .cl-danmaku { display: flex; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(70,51,34,.2); }
  .cl-danmaku input { flex: 1 1 auto; min-width: 0; padding: 7px 9px; border: 1.5px solid rgba(70,51,34,.2); border-radius: 7px; font: inherit; background: #fff; }
  .cl-danmaku input:focus { outline: none; border-color: #23655f; }
  .cl-danmaku button { flex: 0 0 auto; min-width: 52px; padding: 7px 10px; border: 0; border-radius: 7px; color: #fff; background: #a4492d; font: 800 13px/1 inherit; cursor: pointer; }
  .cl-danmaku button[disabled] { opacity: .55; cursor: default; }
  .cl-panel.is-folded .cl-body { display: none; }
  .cl-panel.is-gate { border-color: rgba(164,73,45,.35); }
  .cl-panel.is-gate a { display: inline-block; margin-top: 8px; padding: 8px 12px; border-radius: 7px; color: #fff; background: #a4492d; text-decoration: none; font-weight: 800; }
  @media print { .cl-panel { display: none !important; } }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('aside');
  panel.className = 'cl-panel';
  panel.setAttribute('data-ix', '');
  panel.setAttribute('aria-label', '课堂作业');
  ['click', 'keydown', 'keyup', 'input'].forEach((type) => panel.addEventListener(type, (event) => event.stopPropagation()));

  // ---------- 未从课堂码进入：只读，作答仍存本机草稿 ----------
  if (!joined) {
    panel.classList.add('is-gate');
    const elsewhere = identity.classroom && identity.course === config.course && identity.chapter && identity.chapter !== chapter;
    panel.innerHTML = elsewhere
      ? `<strong>本周课堂不在这一章</strong><div class="cl-room">你已进入“${esc(identity.classroom_name)}”。本页的选择和作答不会交给老师。</div><a href="${joinUrl()}">回到登录页</a>`
      : '<strong>还没有进入课堂</strong><div class="cl-room">请在首页输入老师发布的课堂码并填写个人信息，作答才能交给老师。</div><a href="/">去登录</a>';
    document.body.appendChild(panel);
    return;
  }

  window.ClassLive.attached = true;
  const base = () => ({ course: config.course, classroom: identity.classroom, session: window.ClassLive.today(),
    name: identity.name, sid: identity.sid, path: location.pathname });
  const ack = (el, ok, message) => document.dispatchEvent(new CustomEvent('classlive:ack', { detail: { el, ok, message } }));
  const closedText = '本课堂已结束提交或已停止，请留意老师发布的新课堂码';

  // ---------- 投票类：即时提交 ----------
  document.addEventListener('classlive:choice', async (event) => {
    const { el, choice, label, item } = event.detail;
    try {
      await backend.add('choices', { ...base(), case: event.detail.case, item, choice, label: String(label || '').slice(0, 120) });
      ack(el, true, `已提交（${time()}），可以改选`);
    } catch (problem) {
      console.error(problem);
      ack(el, false, window.ClassLive.isClosedError(problem) ? closedText : '提交失败：请检查网络后再点一次');
    }
  });

  // ---------- 面板 ----------
  const boxes = Array.from(document.querySelectorAll('[data-live-answer]'));
  panel.innerHTML = `
    <div class="cl-who"><span><strong>${esc(identity.name)}</strong> <small>${esc(identity.sid)} · ${esc(identity.class_name || '')}${identity.group_name ? ' · ' + esc(identity.group_name) : ''}</small></span>
      <span><button type="button" class="cl-link" data-cl-fold>收起</button> <button type="button" class="cl-link" data-cl-switch>不是我</button></span></div>
    <div class="cl-body">
      <div class="cl-room">${esc(identity.classroom_name || '')}</div>
      <div class="cl-progress"${boxes.length ? '' : ' hidden'}><span><span data-cl-count></span><br><span class="cl-state" data-cl-state></span></span><button type="button" class="cl-submit" data-cl-submit>提交作业</button></div>
      <form class="cl-danmaku" data-cl-danmaku>
        <input type="text" maxlength="40" placeholder="发一条弹幕（40 字内）" aria-label="弹幕内容" autocomplete="off">
        <button type="submit">发送</button>
      </form>
      <p class="cl-hint" data-cl-dm-state>弹幕显示在老师投屏的页面上；实名记录，发送人仅老师可见。</p>
    </div>`;
  document.body.appendChild(panel);
  panel.querySelector('[data-cl-switch]').addEventListener('click', () => {
    save(STORE, { code: identity.code });
    location.href = joinUrl();
  });
  const fold = panel.querySelector('[data-cl-fold]');
  const setFolded = (value) => { panel.classList.toggle('is-folded', value); fold.textContent = value ? '展开' : '收起'; save('classlive-panel-folded', value); };
  fold.addEventListener('click', () => setFolded(!panel.classList.contains('is-folded')));
  setFolded(Boolean(load('classlive-panel-folded', false)));

  // ---------- 文字作答：统一“提交作业” ----------
  const areaOf = (box) => box.querySelector('textarea');
  const filled = () => boxes.filter((box) => areaOf(box).value.trim());
  const digest = () => boxes.map((box) => areaOf(box).value.trim()).join('\u0001');
  const SUBMIT_KEY = `classlive-submitted:${identity.classroom}:${location.pathname}`;
  let submitted = load(SUBMIT_KEY, null);
  const stateEl = panel.querySelector('[data-cl-state]');
  const submitButton = panel.querySelector('[data-cl-submit]');
  const setState = (text, state) => { stateEl.textContent = text; stateEl.dataset.state = state || ''; };
  const refresh = () => {
    panel.querySelector('[data-cl-count]').textContent = `作业：已填写 ${filled().length}/${boxes.length} 题`;
    if (submitted && submitted.digest === digest()) setState(`已提交（${submitted.time}），修改后可再次提交`, 'ok');
    else if (submitted) setState('有修改尚未提交', 'dirty');
    else setState('草稿自动保存在本机，写完后点“提交作业”', '');
  };
  document.addEventListener('input', (event) => { if (event.target.closest && event.target.closest('[data-live-answer]')) refresh(); });
  refresh();

  submitButton.addEventListener('click', async () => {
    const ready = filled();
    if (!ready.length) { setState('还没有写任何作答', 'error'); return; }
    const missing = boxes.length - ready.length;
    if (missing && !window.confirm(`还有 ${missing} 题没有填写，确定现在提交吗？提交后仍可修改再交。`)) return;
    submitButton.disabled = true;
    submitButton.textContent = '正在提交……';
    try {
      await backend.addMany('answers', ready.map((box) => ({
        ...base(), case: box.dataset.liveCase, item: box.dataset.liveItem, text: areaOf(box).value.trim().slice(0, 1500),
      })));
      submitted = { time: time(), digest: digest() };
      save(SUBMIT_KEY, submitted);
      ready.forEach((box) => ack(box, true, `已随作业提交（${submitted.time}）`));
      refresh();
    } catch (problem) {
      console.error(problem);
      setState(window.ClassLive.isClosedError(problem) ? `${closedText}，作答仍保存在本机` : '提交失败：请检查网络后再试（草稿已保存在本机）', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = '提交作业';
    }
  });

  // ---------- 弹幕 ----------
  const dmForm = panel.querySelector('[data-cl-danmaku]');
  const dmInput = dmForm.querySelector('input');
  const dmButton = dmForm.querySelector('button');
  const dmState = panel.querySelector('[data-cl-dm-state]');
  const COOLDOWN = 5;
  let cooling = 0;
  const cool = () => {
    cooling = COOLDOWN;
    dmButton.disabled = true;
    const tick = setInterval(() => {
      cooling -= 1;
      dmButton.textContent = cooling > 0 ? `${cooling}s` : '发送';
      if (cooling <= 0) { clearInterval(tick); dmButton.disabled = false; }
    }, 1000);
    dmButton.textContent = `${cooling}s`;
  };
  dmForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = dmInput.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!text || cooling > 0) return;
    dmButton.disabled = true;
    try {
      await backend.add('danmaku', { course: config.course, classroom: identity.classroom, name: identity.name, sid: identity.sid, text });
      dmInput.value = '';
      dmState.textContent = `已发送（${time()}）。若老师开启了审核，通过后才会上屏。`;
      dmState.dataset.state = 'ok';
      cool();
    } catch (problem) {
      console.error(problem);
      dmButton.disabled = false;
      dmState.dataset.state = 'error';
      dmState.textContent = window.ClassLive.isClosedError(problem)
        ? '现在不能发弹幕：老师未开放弹幕，或发送太快（每 5 秒一条）。'
        : '发送失败：请检查网络后再试。';
    }
  });
})();
