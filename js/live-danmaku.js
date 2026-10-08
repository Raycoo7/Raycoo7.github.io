/* 投屏弹幕：在课堂完整版页面上滚动显示当前课堂的学生弹幕（“姓名：内容”），并循环播放。
 * 需要教师已在同一浏览器登录教师工作台（读取弹幕需教师账号）。
 * 弹幕模式由工作台设置：关闭 / 直接上屏（未隐藏的都显示）/ 审核后上屏（只显示已通过的）。
 * 播放规则：新来的弹幕立即上屏；空档时按顺序循环播放本课堂可显示的弹幕（最近 60 条），被隐藏的立即撤下。
 * 清屏：撤下屏幕上现有弹幕，并让它们不再循环（本机按课堂记住，刷新页面也不会回来）；之后的新弹幕照常上屏和循环。
 *       清屏只影响投屏显示，工作台里的弹幕记录不受影响。
 * 左下角小控件：循环开关、暂停、清屏、收起。页面需先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 * 机制图“弹幕接龙”：学生弹幕以“【案例号箭头】”开头（如【01①→②】），除照常滚动外，还会放进投屏机制图对应节点下的
 *   [data-mech-wall]（每个箭头显示最新 3 条，新来的弹入并让节点闪一下）；显示规则与滚动弹幕相同（模式、审核、清屏）。
 */
(function () {
  'use strict';
  const config = window.CLASS_LIVE_CONFIG;
  if (!config || config.provider === 'off' || !window.ClassLive) return;
  let backend;
  try { backend = window.ClassLive.create(config); } catch (error) { return; }
  // 有弹幕的投屏页才显示机制图的“弹幕接龙”说明和节点弹幕区（本地或离线打开时不显示）
  document.documentElement.classList.add('has-danmaku');

  const POLL_MS = 3000;
  const ROOM_MS = 10000;
  const LOOP_MS = 2200;
  const POOL = 60;
  const LANES = 7;
  const store = {
    get: (key) => { try { return localStorage.getItem('danmaku:' + key); } catch (error) { return null; } },
    set: (key, value) => { try { localStorage.setItem('danmaku:' + key, value); } catch (error) { /* 忽略 */ } },
  };

  const style = document.createElement('style');
  style.textContent = `
  .dm-stage { position: fixed; inset: 64px 0 auto 0; height: 58vh; z-index: 300; overflow: hidden; pointer-events: none; }
  .dm-item { position: absolute; left: 100%; white-space: nowrap; padding: 4px 16px; border-radius: 22px; color: #fff; background: rgba(32, 28, 24, .55);
    font: 800 clamp(22px, 2.4vw, 34px)/1.3 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; text-shadow: 0 1px 2px rgba(0,0,0,.6);
    will-change: transform; animation: dm-fly var(--dm-duration, 11s) linear forwards; }
  .dm-item.is-new { background: rgba(164, 73, 45, .78); }
  .dm-name { margin-right: 2px; color: #ffd98a; }
  .dm-stage.is-paused .dm-item { animation-play-state: paused; }
  @keyframes dm-fly { from { transform: translateX(0); } to { transform: translateX(calc(-100vw - 100%)); } }
  .dm-bar { position: fixed; z-index: 301; left: 108px; bottom: 22px; display: flex; gap: 6px; align-items: center; padding: 5px 8px; border-radius: 8px;
    background: rgba(32, 28, 24, .72); color: #fff; font: 700 12.5px/1.3 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; opacity: .45; transition: opacity .2s ease; }
  .dm-bar:hover, .dm-bar:focus-within { opacity: 1; }
  .dm-bar button { padding: 3px 8px; border: 1px solid rgba(255,255,255,.4); border-radius: 5px; color: #fff; background: transparent; font: inherit; cursor: pointer; }
  .dm-bar button[aria-pressed="true"] { background: rgba(255,255,255,.2); }
  .dm-bar a { color: #ffd98a; }
  .dm-bar.is-min > :not([data-dm-toggle]) { display: none; }
  .dm-link { margin: 0 4px; padding: 0 6px; border-radius: 9px; color: #201c18; background: #ffd98a; font-size: .8em; }
  .dm-bubble { padding: 6px 10px; border: 1px solid rgba(35, 101, 95, .28); border-radius: 12px 12px 12px 3px; color: #201c18; background: #fff;
    box-shadow: 0 4px 12px rgba(35, 101, 95, .16); font: 600 15px/1.45 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow-wrap: anywhere; }
  .dm-bubble b { margin-right: 4px; color: #a4492d; }
  .dm-bubble.is-pop { animation: dm-pop .6s cubic-bezier(.2, 1.4, .4, 1) both; }
  .dm-wall-count { justify-self: end; color: #23655f; font: 800 12px/1 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .mechanism-node.dm-hit::before { content: ""; position: absolute; inset: -2px; border-radius: 10px; pointer-events: none; animation: dm-hit 1.1s ease-out 2; }
  @keyframes dm-pop { 0% { opacity: 0; transform: translateY(12px) scale(.6); } 100% { opacity: 1; transform: none; } }
  @keyframes dm-hit { 0% { box-shadow: 0 0 0 0 rgba(164, 73, 45, .55); } 100% { box-shadow: 0 0 0 22px rgba(164, 73, 45, 0); } }
  @media (prefers-reduced-motion: reduce) { .dm-bubble.is-pop, .mechanism-node.dm-hit::before { animation: none; } }
  @media print { .dm-stage, .dm-bar { display: none !important; } }
  `;
  document.head.appendChild(style);

  const stage = document.createElement('div');
  stage.className = 'dm-stage';
  stage.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('div');
  bar.className = 'dm-bar';
  bar.setAttribute('data-ix', '');
  bar.innerHTML = '<span data-dm-state>弹幕：连接中</span><button type="button" data-dm-loop aria-pressed="true">循环：开</button>'
    + '<button type="button" data-dm-pause>暂停</button><button type="button" data-dm-clear title="撤下现有弹幕，且不再循环播放；之后的新弹幕照常显示">清屏</button><button type="button" data-dm-toggle>收起</button>';
  ['click', 'keydown'].forEach((type) => bar.addEventListener(type, (event) => event.stopPropagation()));
  document.body.append(stage, bar);
  const stateEl = bar.querySelector('[data-dm-state]');
  const setState = (html) => { stateEl.innerHTML = html; };
  const loopButton = bar.querySelector('[data-dm-loop]');

  let room = null;
  let paused = false;
  let looping = store.get('loop') !== 'off';
  let primed = false;
  let cursor = 0;
  const pool = [];              // 可循环播放的弹幕（按发送顺序）
  const inPool = new Set();
  const seen = new Set();       // 已见过的 id（用于判断“新来的”）
  const flying = new Map();     // id → 正在飞的元素
  let cleared = new Set();      // 已清屏的弹幕 id（不再上屏、不再循环），按课堂保存在本机
  let clearedRoom = null;
  const loadCleared = (roomId) => {
    try { return new Set(JSON.parse(store.get(`cleared:${roomId}`) || '[]')); } catch (error) { return new Set(); }
  };
  const saveCleared = () => store.set(`cleared:${clearedRoom}`, JSON.stringify(Array.from(cleared).slice(-800)));
  const laneFree = new Array(LANES).fill(0);

  const modeText = () => (room.danmaku === 'review' ? '审核后上屏' : '直接上屏');
  const refreshState = () => {
    if (!room) return;
    if (room.danmaku === 'off') setState('弹幕：已关闭（在工作台开启）');
    else setState(`弹幕：${modeText()} · ${pool.length} 条`);
  };
  const setLoop = (value) => {
    looping = value;
    store.set('loop', value ? 'on' : 'off');
    loopButton.textContent = value ? '循环：开' : '循环：关';
    loopButton.setAttribute('aria-pressed', String(value));
  };
  setLoop(looping);

  const launch = (doc, isNew) => {
    const id = String(doc.id);
    if (paused || flying.has(id)) return false;
    const now = Date.now();
    let lane = 0;
    for (let i = 1; i < LANES; i += 1) if (laneFree[i] < laneFree[lane]) lane = i;
    // 所有轨道都还没空出来时，循环播放先等一等（新弹幕仍然排队上屏）
    if (!isNew && laneFree[lane] > now + 400) return false;
    const delay = Math.max(0, laneFree[lane] - now);
    laneFree[lane] = Math.max(now, laneFree[lane]) + 2200;
    const item = document.createElement('div');
    item.className = isNew ? 'dm-item is-new' : 'dm-item';
    const name = document.createElement('span');
    name.className = 'dm-name';
    const tag = tagOf(doc);
    if (tag) {
      name.textContent = doc.name;
      const link = document.createElement('span');
      link.className = 'dm-link';
      link.textContent = tag.link;
      item.append(name, link, document.createTextNode(`：${tag.text}`));
    } else {
      name.textContent = `${doc.name}：`;
      item.append(name, document.createTextNode(doc.text));
    }
    item.style.top = `${lane * (100 / LANES)}%`;
    item.style.setProperty('--dm-duration', `${10 + Math.min(doc.text.length + String(doc.name).length, 50) / 8}s`);
    item.style.animationDelay = `${delay}ms`;
    item.addEventListener('animationend', () => { item.remove(); flying.delete(id); });
    flying.set(id, item);
    stage.appendChild(item);
    return true;
  };

  const visible = (doc) => (room.danmaku === 'review' ? doc.status === 'shown' : doc.status !== 'hidden');

  // ---------- 机制图“弹幕接龙” ----------
  const TAG = /^【(\d{2})([①②③④])→([①②③④])】\s*/;
  function tagOf(doc) {
    const match = TAG.exec(doc.text || '');
    return match ? { key: `${match[1]}|${match[2]}→${match[3]}`, link: `${match[2]}→${match[3]}`, text: doc.text.slice(match[0].length) } : null;
  }
  const WALL_MAX = 3;
  const walls = new Map();
  document.querySelectorAll('[data-mech-wall]').forEach((el) => walls.set(`${el.dataset.case}|${el.dataset.link}`, el));
  const wallShown = new Map();   // 箭头 → 正在显示的弹幕 id
  let wallsPrimed = false;
  function renderWalls(docs) {
    if (!walls.size) return;
    const groups = new Map();
    docs.forEach((doc) => {
      const tag = tagOf(doc);
      if (!tag || !walls.has(tag.key)) return;
      if (!groups.has(tag.key)) groups.set(tag.key, []);
      groups.get(tag.key).push({ doc, tag });
    });
    walls.forEach((wall, key) => {
      const list = groups.get(key) || [];
      const latest = list.slice(-WALL_MAX);
      const before = wallShown.get(key) || [];
      const ids = latest.map(({ doc }) => String(doc.id));
      const placeholder = wall.querySelector('em');
      if (placeholder) placeholder.hidden = list.length > 0;
      let count = wall.querySelector('.dm-wall-count');
      if (ids.join() !== before.join()) {
        wall.querySelectorAll('.dm-bubble').forEach((el) => el.remove());
        let fresh = false;
        latest.forEach(({ doc, tag }) => {
          const bubble = document.createElement('div');
          const isNew = wallsPrimed && !before.includes(String(doc.id));
          fresh = fresh || isNew;
          bubble.className = isNew ? 'dm-bubble is-pop' : 'dm-bubble';
          const who = document.createElement('b');
          who.textContent = `${doc.name}：`;
          bubble.append(who, document.createTextNode(tag.text));
          wall.insertBefore(bubble, count);
        });
        wallShown.set(key, ids);
        const node = wall.closest('.mechanism-node');
        if (fresh && node) {
          node.classList.remove('dm-hit');
          void node.offsetWidth;
          node.classList.add('dm-hit');
          setTimeout(() => node.classList.remove('dm-hit'), 2400);
        }
      }
      if (list.length > WALL_MAX) {
        if (!count) { count = document.createElement('span'); count.className = 'dm-wall-count'; wall.appendChild(count); }
        count.textContent = `共 ${list.length} 条`;
      } else if (count) count.remove();
    });
    wallsPrimed = true;
  }
  const dropFromPool = (id) => {
    if (!inPool.has(id)) return;
    inPool.delete(id);
    const index = pool.findIndex((doc) => String(doc.id) === id);
    if (index >= 0) { pool.splice(index, 1); if (cursor > index) cursor -= 1; }
    if (flying.has(id)) { flying.get(id).remove(); flying.delete(id); }
  };

  async function pollRoom() {
    try {
      const rooms = await backend.fetchAll('classrooms', { course: config.course });
      const unit = config.unit || (location.pathname.match(/([a-z]{2,6}\d{2})\.html$/) || [])[1];
      const next = window.ClassLive.pickRoom(rooms, config.course, unit);
      const changed = !room || !next || `${room.id}|${room.danmaku}` !== `${next.id}|${next.danmaku}`;
      room = next;
      if (!room) { setState('弹幕：没有当前课堂'); return false; }
      refreshState();
      return changed;
    } catch (error) {
      room = null;
      setState('弹幕：请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>');
      return false;
    }
  }

  async function pollDanmaku() {
    if (!room || room.danmaku === 'off') return;
    if (clearedRoom !== String(room.id)) { clearedRoom = String(room.id); cleared = loadCleared(clearedRoom); }
    try {
      const rows = (await backend.fetchAll('danmaku', { classroom: Number(room.id) }, { limit: 80 })).reverse();
      rows.forEach((doc) => {
        const id = String(doc.id);
        if (cleared.has(id)) { seen.add(id); dropFromPool(id); return; }
        if (!visible(doc)) { dropFromPool(id); return; }
        if (!inPool.has(id)) {
          inPool.add(id);
          pool.push(doc);
          if (pool.length > POOL) inPool.delete(String(pool.shift().id));
        }
        // 打开页面时已有的弹幕进入循环；之后新来的（或新通过审核的）立即上屏
        if (!seen.has(id)) {
          seen.add(id);
          if (primed) launch(doc, true);
        }
      });
      primed = true;
      renderWalls(rows.filter((doc) => !cleared.has(String(doc.id)) && visible(doc)));
      refreshState();
    } catch (error) {
      console.warn('[弹幕]', error);
    }
  }

  // 循环播放：空档时依次播放可显示的弹幕
  setInterval(() => {
    if (!looping || paused || !room || room.danmaku === 'off' || !pool.length) return;
    for (let tries = 0; tries < pool.length; tries += 1) {
      cursor = cursor % pool.length;
      const doc = pool[cursor];
      cursor += 1;
      if (!flying.has(String(doc.id))) { launch(doc, false); return; }
    }
  }, LOOP_MS);

  loopButton.addEventListener('click', () => setLoop(!looping));
  bar.querySelector('[data-dm-pause]').addEventListener('click', (event) => {
    paused = !paused;
    stage.classList.toggle('is-paused', paused);
    event.currentTarget.textContent = paused ? '继续' : '暂停';
  });
  // 清屏：撤下现有弹幕，并把已出现过的弹幕移出循环；之后的新弹幕照常显示
  bar.querySelector('[data-dm-clear]').addEventListener('click', () => {
    if (clearedRoom) {
      [...seen, ...inPool].forEach((id) => cleared.add(id));
      saveCleared();
    }
    pool.length = 0;
    inPool.clear();
    cursor = 0;
    stage.innerHTML = '';
    flying.clear();
    laneFree.fill(0);
    renderWalls([]);
    if (room) setState(`弹幕：${room.danmaku === 'off' ? '已关闭' : modeText()} · 已清屏，之前的弹幕不再循环`);
  });
  bar.querySelector('[data-dm-toggle]').addEventListener('click', (event) => {
    const min = bar.classList.toggle('is-min');
    event.currentTarget.textContent = min ? '弹幕' : '收起';
  });

  (async () => {
    const session = await backend.session().catch(() => null);
    if (!session || session.anonymous) {
      setState('弹幕：请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>');
      return;
    }
    await pollRoom();
    await pollDanmaku();
    setInterval(pollDanmaku, POLL_MS);
    setInterval(async () => {
      if (await pollRoom()) {
        // 换了课堂或弹幕模式：重新整理循环列表，已有弹幕不当作新弹幕
        pool.length = 0;
        inPool.clear();
        cursor = 0;
        primed = false;
        await pollDanmaku();
      }
    }, ROOM_MS);
  })();
})();
