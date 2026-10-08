/* 投屏页右下角的“课堂”悬浮控件：与教师工作台的“结束提交 / 重新开放提交”“停止课堂”功能相同，上课时不必切回工作台。
 * 平时半透明，鼠标移上去才完全显示；可收起成一个小按钮。只有当前课堂就是本页章节（案例）时才显示操作按钮。
 * 需要教师已在同一浏览器登录教师工作台（操作需教师账号）。页面需先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 */
(function () {
  'use strict';
  const config = window.CLASS_LIVE_CONFIG;
  if (!config || config.provider === 'off' || !window.ClassLive) return;
  let backend;
  try { backend = window.ClassLive.create(config); } catch (error) { return; }

  const unit = config.unit || (location.pathname.match(/([a-z]{2,6}\d{2})\.html$/) || [])[1];
  const HERE = config.kind === 'concept-html' ? '本案例' : '本章';
  const ROOM_MS = 15000;
  const MIN_KEY = 'classlive-room-bar-min';
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const style = document.createElement('style');
  style.textContent = `
  .rm-bar { position: fixed; z-index: 301; right: 22px; bottom: 22px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: min(560px, calc(100vw - 44px)); padding: 5px 8px; border-radius: 8px;
    background: rgba(32, 28, 24, .72); color: #fff; font: 700 12.5px/1.3 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; opacity: .45; transition: opacity .2s ease; }
  .rm-bar:hover, .rm-bar:focus-within { opacity: 1; }
  .rm-bar button { padding: 3px 8px; border: 1px solid rgba(255,255,255,.4); border-radius: 5px; color: #fff; background: transparent; font: inherit; cursor: pointer; }
  .rm-bar button.is-warn { border-color: #f0b49e; color: #ffd2c2; }
  .rm-bar button[disabled] { opacity: .5; cursor: default; }
  .rm-bar a { color: #ffd98a; }
  .rm-bar b { color: #ffd98a; letter-spacing: .06em; }
  .rm-bar.is-min > :not([data-rm-min]) { display: none; }
  @media print { .rm-bar { display: none !important; } }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'rm-bar';
  bar.setAttribute('data-ix', '');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', '课堂控制');
  bar.innerHTML = '<span data-rm-state>课堂：连接中……</span>'
    + '<button type="button" data-rm-open hidden>结束提交</button>'
    + '<button type="button" class="is-warn" data-rm-stop hidden>停止课堂</button>'
    + '<button type="button" data-rm-min title="收起 / 展开课堂控件">课堂</button>';
  ['click', 'keydown', 'keyup'].forEach((type) => bar.addEventListener(type, (event) => event.stopPropagation()));
  document.body.appendChild(bar);
  const stateEl = bar.querySelector('[data-rm-state]');
  const openButton = bar.querySelector('[data-rm-open]');
  const stopButton = bar.querySelector('[data-rm-stop]');
  const minButton = bar.querySelector('[data-rm-min]');
  const setMin = (value) => {
    bar.classList.toggle('is-min', value);
    minButton.textContent = value ? '课堂' : '收起';
    try { localStorage.setItem(MIN_KEY, value ? '1' : ''); } catch (error) { /* 忽略 */ }
  };
  minButton.addEventListener('click', () => setMin(!bar.classList.contains('is-min')));
  let savedMin = false;
  try { savedMin = Boolean(localStorage.getItem(MIN_KEY)); } catch (error) { /* 忽略 */ }
  setMin(savedMin);

  // 避开页面右下角自带的固定元素（如页码、工具条）
  const dodge = () => {
    const box = bar.getBoundingClientRect();
    let bottom = 22;
    document.querySelectorAll('body *').forEach((el) => {
      if (el === bar || bar.contains(el) || el.classList.contains('dm-bar') || getComputedStyle(el).position !== 'fixed') return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top < innerHeight / 2 || rect.right <= box.left || rect.left >= box.right) return;
      bottom = Math.max(bottom, Math.ceil(innerHeight - rect.top) + 8);
    });
    bar.style.bottom = `${bottom}px`;
  };

  let room = null;
  const show = (html, current) => {
    stateEl.innerHTML = html;
    openButton.hidden = !current;
    stopButton.hidden = !current;
    if (current) openButton.textContent = room.submissions_open ? '结束提交' : '重新开放提交';
  };
  async function load() {
    try {
      const rooms = await backend.fetchAll('classrooms', { course: config.course });
      room = window.ClassLive.pickRoom(rooms, config.course, unit);
      if (!room) show('课堂：当前没有开放的课堂（在工作台发布）', false);
      else if (room.chapter !== unit) show(`课堂：当前课堂“${esc(room.name)}”不是${HERE}`, false);
      else show(`课堂：${esc(room.name)} <b>${esc(room.code)}</b> · ${room.submissions_open ? '学生可递交' : '已结束提交'}`, true);
    } catch (error) {
      room = null;
      show('课堂：请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>', false);
    }
    dodge();
  }
  async function act(label, call) {
    openButton.disabled = true;
    stopButton.disabled = true;
    stateEl.textContent = `课堂：正在${label}……`;
    try {
      await call();
    } catch (error) {
      console.error(error);
      window.alert(`${label}失败：${error.message || error}`);
    } finally {
      openButton.disabled = false;
      stopButton.disabled = false;
      await load();
    }
  }
  openButton.addEventListener('click', () => {
    if (!room) return;
    const open = !room.submissions_open;
    if (!open && !window.confirm('结束提交后，学生不能再递交作答、发弹幕（已递交的保留）。确定结束吗？')) return;
    act(open ? '重新开放提交' : '结束提交', () => backend.rpc('ck_set_open', { p_classroom: Number(room.id), p_open: open }));
  });
  stopButton.addEventListener('click', () => {
    if (!room) return;
    if (!window.confirm(`停止“${room.name}”？课堂码 ${room.code} 将不能再进入，已提交的记录保留。`)) return;
    act('停止课堂', () => backend.rpc('ck_set_current', { p_classroom: Number(room.id), p_current: false }));
  });

  (async () => {
    const session = await backend.session().catch(() => null);
    if (!session || session.anonymous) {
      show('课堂：请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>，再刷新本页', false);
      dodge();
      return;
    }
    await load();
    setInterval(load, ROOM_MS);
    window.addEventListener('resize', dodge);
  })();
})();
