/* 学生端：每天第一次打开网站时签到（姓名＋学号），之后把页面上的选择与作答提交到课堂后台。
 * 需要页面先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 */
(function () {
  'use strict';
  const config = window.CLASS_LIVE_CONFIG;
  if (!config || config.provider === 'off' || !window.ClassLive) return;
  let backend;
  try {
    backend = window.ClassLive.create(config);
  } catch (error) {
    console.warn('[课堂后台] 未启用：', error.message);
    return;
  }
  window.ClassLive.attached = true;

  const STORE = 'classlive-student';
  const session = window.ClassLive.today();
  const course = config.course;
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null') || {}; } catch (error) { return {}; } };
  const save = (value) => { try { localStorage.setItem(STORE, JSON.stringify(value)); } catch (error) { /* 忽略 */ } };
  let identity = load();
  const checkedInToday = () => identity.name && identity.sid && identity.days && identity.days[course + ':' + session];

  // ---------- 样式 ----------
  const style = document.createElement('style');
  style.textContent = `
  .cl-mask { position: fixed; inset: 0; z-index: 400; display: grid; place-items: center; padding: 16px; background: rgba(32, 28, 24, .6); }
  .cl-card { width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 24px 24px 20px; border-radius: 12px; background: #fffdf8; box-shadow: 0 20px 50px rgba(0,0,0,.25); color: #201c18; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .cl-card h2 { margin: 0 0 6px; font-size: 22px; }
  .cl-card p { margin: 0 0 12px; color: #6d6259; font-size: 14px; }
  .cl-card label { display: block; margin: 12px 0 4px; font-weight: 700; font-size: 15px; }
  .cl-card input[type=text] { width: 100%; padding: 10px 12px; border: 1.5px solid rgba(70,51,34,.25); border-radius: 8px; font: inherit; background: #fff; }
  .cl-card input[type=text]:focus { outline: none; border-color: #23655f; box-shadow: 0 0 0 3px #e4efeb; }
  .cl-consent { display: flex; gap: 8px; align-items: flex-start; margin: 14px 0 6px; padding: 10px 12px; border-radius: 8px; background: #f4ede3; font-size: 13.5px; line-height: 1.6; color: #4d443c; }
  .cl-consent input { margin-top: 4px; }
  .cl-error { min-height: 20px; margin: 6px 0 0; color: #a4492d; font-weight: 700; font-size: 14px; }
  .cl-submit { width: 100%; margin-top: 8px; padding: 12px; border: 0; border-radius: 8px; color: #fff; background: #23655f; font: 800 16px/1 inherit; cursor: pointer; }
  .cl-submit[disabled] { opacity: .55; cursor: default; }
  .cl-badge { position: fixed; z-index: 90; left: 18px; bottom: 64px; display: flex; gap: 8px; align-items: center; padding: 6px 10px; border: 1px solid rgba(35,101,95,.3); border-radius: 7px; background: rgba(255,253,248,.96); color: #23655f; box-shadow: 0 6px 16px rgba(0,0,0,.08); font: 700 13px/1.3 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .cl-badge button { padding: 0; border: 0; background: none; color: #a4492d; font: inherit; text-decoration: underline; cursor: pointer; }
  @media (max-width: 640px) { .cl-badge { left: 10px; bottom: 60px; } }
  `;
  document.head.appendChild(style);

  // ---------- 签到 ----------
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const showBadge = () => {
    let badge = document.querySelector('.cl-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'cl-badge';
      badge.setAttribute('data-ix', '');
      document.body.appendChild(badge);
      badge.addEventListener('click', (event) => event.stopPropagation());
    }
    badge.textContent = `已签到：${identity.name}（${identity.sid}）`;
    const change = document.createElement('button');
    change.type = 'button';
    change.textContent = '不是我';
    change.addEventListener('click', () => { identity = {}; save(identity); badge.remove(); openCheckin(true); });
    badge.appendChild(change);
  };

  function openCheckin(forceEmpty) {
    const mask = document.createElement('div');
    mask.className = 'cl-mask';
    mask.setAttribute('data-ix', '');
    mask.innerHTML = `
      <form class="cl-card" novalidate>
        <h2>课堂签到</h2>
        <p>每天第一次打开本站时签到一次。签到后，你在页面上的投票、选择和作答会提交给任课教师。</p>
        <label for="cl-name">姓名</label>
        <input id="cl-name" type="text" autocomplete="name" maxlength="20" required>
        <label for="cl-sid">学号</label>
        <input id="cl-sid" type="text" inputmode="numeric" autocomplete="off" maxlength="20" required>
        <div class="cl-consent"><input id="cl-agree" type="checkbox"><label for="cl-agree" style="margin:0;font-weight:400">我已了解：为课堂签到与互动统计，本站将记录我的姓名、学号，以及我在本站提交的投票和作答。数据保存在腾讯云开发（上海），仅任课教师可以查看，本学期结束后删除。</label></div>
        <p class="cl-error" role="alert"></p>
        <button class="cl-submit" type="submit">签到并进入</button>
      </form>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', (event) => event.stopPropagation());
    mask.addEventListener('keydown', (event) => event.stopPropagation());
    const form = mask.querySelector('form');
    const name = form.querySelector('#cl-name');
    const sid = form.querySelector('#cl-sid');
    const agree = form.querySelector('#cl-agree');
    const error = form.querySelector('.cl-error');
    const submit = form.querySelector('.cl-submit');
    if (!forceEmpty) { name.value = identity.name || ''; sid.value = identity.sid || ''; }
    setTimeout(() => (name.value ? sid : name).focus(), 50);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const n = name.value.trim();
      const s = sid.value.trim();
      if (n.length < 2) { error.textContent = '请填写真实姓名'; name.focus(); return; }
      if (!/^[A-Za-z0-9]{4,20}$/.test(s)) { error.textContent = '学号应为 4—20 位数字或字母'; sid.focus(); return; }
      if (!agree.checked) { error.textContent = '请先阅读并勾选数据使用说明'; return; }
      submit.disabled = true;
      error.textContent = '';
      submit.textContent = '正在签到……';
      try {
        await backend.ensureAnonymous();
        await backend.add('checkins', { course, session, name: n, sid: s, page: document.title.slice(0, 60), path: location.pathname });
        identity = { name: n, sid: s, days: { ...(identity.days || {}), [course + ':' + session]: true } };
        save(identity);
        mask.remove();
        showBadge();
        resolveReady();
      } catch (problem) {
        console.error(problem);
        error.textContent = '签到没有成功，请检查网络后再试一次。';
        submit.disabled = false;
        submit.textContent = '签到并进入';
      }
    });
  }

  if (checkedInToday()) {
    showBadge();
    resolveReady();
  } else {
    openCheckin(false);
  }

  // ---------- 提交选择与作答 ----------
  const time = () => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const ack = (el, ok, message) => document.dispatchEvent(new CustomEvent('classlive:ack', { detail: { el, ok, message } }));
  const base = () => ({ course, session, name: identity.name, sid: identity.sid, path: location.pathname });

  document.addEventListener('classlive:choice', async (event) => {
    const { el, choice, label, item } = event.detail;
    await ready;
    try {
      await backend.ensureAnonymous();
      await backend.add('choices', { ...base(), case: event.detail.case, item, choice, label: String(label || '').slice(0, 120) });
      ack(el, true, `已提交（${time()}），可以改选`);
    } catch (problem) {
      console.error(problem);
      ack(el, false, '提交失败：请检查网络后再点一次');
    }
  });

  document.addEventListener('classlive:answer', async (event) => {
    const { el, text, item } = event.detail;
    await ready;
    try {
      await backend.ensureAnonymous();
      await backend.add('answers', { ...base(), case: event.detail.case, item, text: String(text).slice(0, 1500) });
      ack(el, true, `已提交（${time()}）。修改后可再次提交，老师看到的是最新一次`);
    } catch (problem) {
      console.error(problem);
      ack(el, false, '提交失败：请检查网络后再提交一次（草稿已保存在本机）');
    }
  });
})();
