/* 学生端（学生页）：确认是从首页用课堂码进入的本周课堂后，在左下角显示课堂面板。
 * 两类课程：
 *   · 案例课程（kind = case-html，如《习近平经济思想概论》章节页）
 *       投票、配对、推演等选择点选后立即交给老师；文字作答存本机草稿，点“提交作业”一次交给老师；
 *   · 概念学习课程（kind = concept-html，如《政治经济学》练习页）
 *       页面每次保存作答后约 4 秒自动同步给老师（老师课上可看进度和选择分布），点“提交作业”标记完成；
 *       页面里的姓名、学号、班级按课堂登录信息自动填写并锁定。
 * 两类都可发弹幕：连同姓名显示在老师投屏的课堂页面上（老师开放后可用）。
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
  const unit = window.ClassLive.unitOf();
  const worksheet = config.kind === 'concept-html';
  const joined = Boolean(identity.classroom && identity.name && identity.sid
    && identity.course === config.course && identity.chapter === unit);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (withSeconds) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}) }).format(new Date());
  const joinUrl = () => '/' + (identity.code ? `?join=${encodeURIComponent(identity.code)}` : '');
  const closedText = '本课堂已结束提交或已停止，请留意老师发布的新课堂码';

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
  input[data-student-field][readonly] { background: #f1ece3; color: #4d443c; }
  @media print { .cl-panel { display: none !important; } }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('aside');
  panel.className = 'cl-panel';
  panel.setAttribute('data-ix', '');
  panel.setAttribute('aria-label', '课堂作业');
  ['click', 'keydown', 'keyup', 'input'].forEach((type) => panel.addEventListener(type, (event) => event.stopPropagation()));
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

  // ---------- 未从课堂码进入：只读，作答仍存本机 ----------
  if (!joined) {
    panel.classList.add('is-gate');
    const elsewhere = identity.classroom && identity.course === config.course && identity.chapter && identity.chapter !== unit;
    panel.innerHTML = elsewhere
      ? `<strong>本周课堂不在这一页</strong><div class="cl-room">你已进入“${esc(identity.classroom_name)}”。本页的作答不会交给老师。</div><a href="${joinUrl()}">回到登录页</a>`
      : '<strong>还没有进入课堂</strong><div class="cl-room">请在首页输入老师发布的课堂码并填写个人信息，作答才能交给老师。</div><a href="/">去登录</a>';
    document.body.appendChild(panel);
    dodge();
    return;
  }

  // ---------- 面板 ----------
  panel.innerHTML = `
    <div class="cl-who"><span><strong>${esc(identity.name)}</strong> <small>${esc(identity.sid)} · ${esc(identity.class_name || '')}${identity.group_name ? ' · ' + esc(identity.group_name) : ''}</small></span>
      <span><button type="button" class="cl-link" data-cl-fold>收起</button> <button type="button" class="cl-link" data-cl-switch>不是我</button></span></div>
    <div class="cl-body">
      <div class="cl-room">${esc(identity.classroom_name || '')}</div>
      <div class="cl-progress"><span><span data-cl-count></span><br><span class="cl-state" data-cl-state></span></span><button type="button" class="cl-submit" data-cl-submit>提交作业</button></div>
      <form class="cl-danmaku" data-cl-danmaku>
        <input type="text" maxlength="40" placeholder="发一条弹幕（40 字内）" aria-label="弹幕内容" autocomplete="off">
        <button type="submit">发送</button>
      </form>
      <p class="cl-hint" data-cl-dm-state>弹幕会以“你的姓名：内容”显示在老师投屏的页面上，请文明发言。</p>
    </div>`;
  document.body.appendChild(panel);
  dodge();
  panel.querySelector('[data-cl-switch]').addEventListener('click', () => {
    save(STORE, { code: identity.code });
    location.href = joinUrl();
  });
  const fold = panel.querySelector('[data-cl-fold]');
  const setFolded = (value) => { panel.classList.toggle('is-folded', value); fold.textContent = value ? '展开' : '收起'; save('classlive-panel-folded', value); };
  fold.addEventListener('click', () => setFolded(!panel.classList.contains('is-folded')));
  // 手机等窄屏默认收起，避免挡住正文；学生展开或收起后记住选择
  const savedFold = load('classlive-panel-folded', null);
  setFolded(savedFold === null ? window.innerWidth < 700 : Boolean(savedFold));

  const countEl = panel.querySelector('[data-cl-count]');
  const stateEl = panel.querySelector('[data-cl-state]');
  const submitButton = panel.querySelector('[data-cl-submit]');
  const setState = (text, state) => { stateEl.textContent = text; stateEl.dataset.state = state || ''; };
  window.ClassLive.attached = true;

  if (worksheet) worksheetHomework(); else caseHomework();

  // ---------- 案例课程：即时选择＋统一“提交作业” ----------
  function caseHomework() {
    const base = () => ({ course: config.course, classroom: identity.classroom, session: window.ClassLive.today(),
      name: identity.name, sid: identity.sid, path: location.pathname });
    const ack = (el, ok, message) => document.dispatchEvent(new CustomEvent('classlive:ack', { detail: { el, ok, message } }));
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

    const boxes = Array.from(document.querySelectorAll('[data-live-answer]'));
    if (!boxes.length) panel.querySelector('.cl-progress').hidden = true;
    const areaOf = (box) => box.querySelector('textarea');
    const filled = () => boxes.filter((box) => areaOf(box).value.trim());
    const digest = () => boxes.map((box) => areaOf(box).value.trim()).join('\u0001');
    const SUBMIT_KEY = `classlive-submitted:${identity.classroom}:${location.pathname}`;
    let submitted = load(SUBMIT_KEY, null);
    const refresh = () => {
      countEl.textContent = `作业：已填写 ${filled().length}/${boxes.length} 题`;
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
  }

  // ---------- 概念学习课程：作答自动同步＋“提交作业” ----------
  function worksheetHomework() {
    const node = document.getElementById('concept-data');
    const D = node ? JSON.parse(node.textContent) : { concepts: [], exit: [] };
    const KEY = config.stateKey;
    const readState = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (error) { return {}; } };

    // 页面里的姓名、学号、班级：按课堂登录信息填写并锁定（页面会把它们写进作答记录）
    const fields = { name: identity.name, id: identity.sid, class: identity.class_name || '' };
    document.querySelectorAll('input[data-student-field]').forEach((input) => {
      const value = fields[input.dataset.studentField];
      if (value === undefined) return;
      if (input.value !== value) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
      input.readOnly = true;
      input.title = '已按课堂登录信息填写';
    });

    const filledValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
    const progressOf = (S) => {
      let done = 0;
      let total = 0;
      const count = (ok) => { total += 1; if (ok) done += 1; };
      (D.concepts || []).forEach((k) => {
        const box = S[k.id] || {};
        count(Number.isInteger((box.discover || {}).choice));
        if (k.check.type === 'judge') (k.check.texts || []).forEach((_, i) => count(Number.isInteger(((box.check || {}).sel || [])[i])));
        else count(Number.isInteger((box.check || {}).choice));
        const apply = k.apply || {};
        const size = apply.type === 'calc' ? (apply.fields || []).length : apply.n || (apply.texts || []).length;
        const values = apply.type === 'sort' ? ((box.apply || {}).sel || []) : ((box.apply || {}).vals || []);
        for (let i = 0; i < size; i += 1) count(filledValue(values[i]));
        count(filledValue((S.texts || {})[`${k.id}.explain`]));
      });
      count(Array.isArray((S.chain || {}).order) && JSON.stringify(S.chain.order) !== JSON.stringify((D.chain || {}).shuffle));
      count(Boolean((S.discussion || {}).stance) || filledValue((S.texts || {})['discussion.reason']));
      (D.exit || []).forEach((_, i) => count(Number.isInteger(((S.exit || {}).answers || [])[i])));
      if (D.poll) count(Boolean((S.poll || {}).choice));
      return { done, total };
    };

    let lastSent = '';
    let inflight = false;
    let timer = null;
    let submittedAt = load(`classlive-homework:${identity.classroom}:${unit}`, null);
    const refresh = (S = readState()) => {
      const { done, total } = progressOf(S);
      const exitDone = (S.exit || {}).submitted;
      countEl.textContent = `作业：已作答 ${done}/${total} 项 · 出门测${exitDone ? '已交卷' : '未交卷'}`;
    };
    const schedule = (delay) => { clearTimeout(timer); timer = setTimeout(() => flush(false), delay); };
    async function flush(submit) {
      const S = readState();
      const body = JSON.stringify(S);
      if (!submit && body === lastSent) return true;
      if (inflight) { schedule(1500); return false; }
      inflight = true;
      if (!submit) setState('正在同步……', '');
      try {
        const { done, total } = progressOf(S);
        const rows = await backend.rpc('ck_save_homework', {
          p_classroom: identity.classroom, p_unit: unit, p_name: identity.name, p_sid: identity.sid,
          p_class: identity.class_name || '', p_group: identity.group_name || '', p_payload: S,
          p_progress: done, p_total: total, p_submit: Boolean(submit),
        });
        lastSent = body;
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (submit) {
          submittedAt = time();
          save(`classlive-homework:${identity.classroom}:${unit}`, submittedAt);
        }
        if (row && row.submitted && submittedAt) setState(`已提交（${submittedAt}）；之后的修改会继续自动同步`, 'ok');
        else setState(`已自动同步给老师（${time(true)}）`, 'ok');
        return true;
      } catch (problem) {
        console.error(problem);
        if (window.ClassLive.isClosedError(problem)) setState(`${closedText}，作答仍保存在本机`, 'error');
        else { setState('同步失败，稍后自动重试（作答已保存在本机）', 'error'); schedule(15000); }
        return false;
      } finally {
        inflight = false;
      }
    }

    // 页面每次保存作答（写入本机）后，约 4 秒自动同步
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key) {
      originalSetItem.apply(this, arguments);
      if (this === window.localStorage && key === KEY) { refresh(); schedule(4000); }
    };
    refresh();
    setState(submittedAt ? `已提交（${submittedAt}）；之后的修改会继续自动同步` : '作答会自动同步给老师，全部完成后点“提交作业”', submittedAt ? 'ok' : '');
    schedule(1500);

    submitButton.addEventListener('click', async () => {
      const S = readState();
      const { done, total } = progressOf(S);
      const notes = [];
      if (done < total) notes.push(`还有 ${total - done} 项没有作答`);
      if (D.exit && D.exit.length && !(S.exit || {}).submitted) notes.push('出门测还没有点“交卷”');
      if (notes.length && !window.confirm(`${notes.join('，')}。确定现在提交吗？提交后仍可继续作答，老师看到最新的作答。`)) return;
      submitButton.disabled = true;
      submitButton.textContent = '正在提交……';
      await flush(true);
      submitButton.disabled = false;
      submitButton.textContent = '提交作业';
    });
  }

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
