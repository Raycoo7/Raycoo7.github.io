/* 教师工作台：登录（第二道锁）后管理“我的课堂”——发布本周课堂（选定章节、生成课堂码）、
 * 结束提交、重新发布；查看加入名单、投票与选择、文字作答、弹幕；导出 CSV；学期末清空。
 * 页面需先设置 window.CLASS_LIVE_CONFIG、window.TEACHER_DATA，并加载 live-core.js。
 */
(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const config = window.CLASS_LIVE_CONFIG || { provider: 'off' };
  const DATA = window.TEACHER_DATA;
  const course = DATA.courses.find((item) => item.slug === config.course) || DATA.courses[0];
  const caseMap = new Map(course.cases.map((item) => [item.number, item]));
  const chapterMap = new Map(course.chapters.map((item) => [item.id, item]));
  const KINDS = ['checkins', 'choices', 'answers', 'danmaku'];
  const store = {
    get: (key) => { try { return localStorage.getItem('teacher:' + key); } catch (error) { return null; } },
    set: (key, value) => { try { localStorage.setItem('teacher:' + key, value); } catch (error) { /* 忽略 */ } },
  };
  const clock = (ts) => ts ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ts)) : '';
  const isoDay = (ts) => ts ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(ts)) : '';
  const pct = (value, total) => (total ? Math.round(value / total * 100) : 0);
  const joinLink = (code) => `${location.origin}/?join=${encodeURIComponent(code)}`;
  $('[data-course-title]').textContent = course.title;

  let backend = null;
  let backendError = '';
  try { backend = window.ClassLive.create(config); } catch (error) { backendError = error.message; }

  const state = {
    rooms: [],
    room: null,
    docs: { checkins: [], choices: [], answers: [], danmaku: [] },
    stops: [],
  };

  // ---------------- 登录 ----------------
  const showLogin = (message) => {
    $('[data-login]').hidden = false;
    $('[data-app]').hidden = true;
    $('[data-when-login]').hidden = true;
    const hint = $('[data-provider-hint]');
    if (!backend) {
      hint.textContent = backendError || '课堂后台尚未配置：请在网站的 live.config.json 中填写云开发环境后重新发布。';
      $('[data-login-form] button').disabled = true;
    } else if (backend.name === 'mock') {
      hint.textContent = '本机测试模式：数据只存在这台电脑的浏览器里，任意账号密码均可登录。';
    }
    if (message) $('[data-login-error]').textContent = message;
  };

  $('[data-login-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $('[data-login-error]');
    const button = form.querySelector('button');
    error.textContent = '';
    button.disabled = true;
    button.textContent = '正在登录……';
    try {
      const session = await backend.signInTeacher(form.username.value.trim(), form.password.value);
      if (!session || session.anonymous) throw new Error('not-teacher');
      form.password.value = '';
      enterApp(session);
    } catch (problem) {
      console.error(problem);
      error.textContent = '登录失败：账号或密码不正确，或该账号尚未在云开发后台创建。';
    } finally {
      button.disabled = false;
      button.textContent = '登录';
    }
  });

  $('[data-logout]').addEventListener('click', async () => {
    state.stops.forEach((stop) => stop());
    try { await backend.signOut(); } catch (error) { /* 忽略 */ }
    location.reload();
  });

  async function enterApp(session) {
    $('[data-login]').hidden = true;
    $('[data-app]').hidden = false;
    $('[data-when-login]').hidden = false;
    $('[data-user]').textContent = session.name ? `教师：${session.name}` : '教师已登录';
    renderPages();
    fillChapterOptions();
    await loadRooms(store.get('room'));
  }

  // ---------------- 我的课堂 ----------------
  const roomStatus = (room) => {
    if (!room.is_current) return { text: '历史课堂（未开放）', cls: 'is-past' };
    return room.submissions_open ? { text: '当前课堂 · 学生可进入', cls: 'is-live' } : { text: '当前课堂 · 已结束提交', cls: 'is-closed' };
  };
  const chapterLabel = (room) => {
    const chapter = chapterMap.get(room.chapter);
    return chapter ? `${chapter.cn} ${chapter.title}` : room.chapter;
  };
  const roomCases = () => {
    const chapter = state.room && chapterMap.get(state.room.chapter);
    return chapter ? chapter.cases.map((item) => caseMap.get(item.number)).filter(Boolean) : [];
  };

  async function loadRooms(preferId) {
    const rows = await backend.fetchAll('classrooms', { course: course.slug });
    state.rooms = rows.sort((a, b) => Number(b.id) - Number(a.id));
    const select = $('[data-room-select]');
    select.innerHTML = state.rooms.map((room) => `<option value="${room.id}">${esc(room.name)} · ${esc(room.code)}${room.is_current ? '（当前）' : ''}</option>`).join('');
    $('[data-room-empty]').hidden = state.rooms.length > 0;
    $('[data-room-area]').hidden = state.rooms.length === 0;
    select.closest('.tw-bar').hidden = state.rooms.length === 0;
    if (!state.rooms.length) { selectRoom(null); setLive('尚未发布课堂'); return; }
    const current = state.rooms.find((room) => room.is_current);
    const wanted = state.rooms.find((room) => String(room.id) === String(preferId)) || current || state.rooms[0];
    select.value = String(wanted.id);
    selectRoom(wanted);
  }
  $('[data-room-select]').addEventListener('change', (event) => {
    selectRoom(state.rooms.find((room) => String(room.id) === event.target.value));
  });

  function selectRoom(room) {
    const changed = !state.room || !room || String(state.room.id) !== String(room.id);
    state.room = room;
    if (!room) { stopWatching(); return; }
    store.set('room', room.id);
    renderRoom();
    if (changed) { setupSelectors(); subscribe(); }
  }

  function renderRoom() {
    const room = state.room;
    const status = roomStatus(room);
    const badge = $('[data-room-status]');
    badge.textContent = status.text;
    badge.className = `tw-badge ${status.cls}`;
    $('[data-room-name]').textContent = room.name;
    const chapter = chapterMap.get(room.chapter);
    $('[data-room-chapter]').textContent = chapter
      ? `${chapterLabel(room)}：${chapter.cases.map((item) => `案例${item.number} ${item.title}`).join('；')}` : room.chapter;
    const open = $('[data-room-classroom]');
    open.href = chapter ? `/${chapter.file}` : '#';
    $('[data-room-code]').textContent = room.code;
    $('[data-room-code-label]').textContent = room.is_current ? '当前课堂码' : '历史课堂码（未开放）';
    $('[data-room-link]').value = joinLink(room.code);
    $('[data-set-current]').hidden = room.is_current;
    $('[data-toggle-open]').hidden = !room.is_current;
    $('[data-toggle-open]').textContent = room.submissions_open ? '结束提交' : '重新开放提交';
    $('[data-stop-room]').hidden = !room.is_current;
    const mode = $('[data-danmaku-mode]');
    mode.value = room.danmaku || 'off';
    mode.disabled = !room.is_current;
    renderDanmaku();
  }

  const actionStatus = (text) => { $('[data-room-action-status]').textContent = text || ''; };
  async function roomAction(label, call) {
    actionStatus(`${label}……`);
    try {
      const row = await call();
      const updated = Array.isArray(row) ? row[0] : row;
      await loadRooms(updated && updated.id ? updated.id : state.room && state.room.id);
      actionStatus(`${label}：已完成（${clock(Date.now())}）`);
    } catch (error) {
      console.error(error);
      actionStatus(`${label}失败：${error.message || error}`);
    }
  }
  $('[data-set-current]').addEventListener('click', () => {
    if (!window.confirm(`把“${state.room.name}”重新设为当前课堂？原课堂码 ${state.room.code} 将重新开放，其他课堂随即停止进入。`)) return;
    roomAction('重新发布', () => backend.rpc('ck_set_current', { p_classroom: Number(state.room.id), p_current: true }));
  });
  $('[data-toggle-open]').addEventListener('click', () => {
    const open = !state.room.submissions_open;
    if (!open && !window.confirm('结束提交后，学生不能再提交投票、作业和弹幕（已提交的保留）。确定结束吗？')) return;
    roomAction(open ? '重新开放提交' : '结束提交', () => backend.rpc('ck_set_open', { p_classroom: Number(state.room.id), p_open: open }));
  });
  $('[data-stop-room]').addEventListener('click', () => {
    if (!window.confirm(`停止“${state.room.name}”？课堂码 ${state.room.code} 将不能再进入，已提交的记录保留。`)) return;
    roomAction('停止课堂', () => backend.rpc('ck_set_current', { p_classroom: Number(state.room.id), p_current: false }));
  });
  $('[data-danmaku-mode]').addEventListener('change', (event) => {
    roomAction('设置弹幕', () => backend.rpc('ck_set_danmaku', { p_classroom: Number(state.room.id), p_mode: event.target.value }));
  });
  $('[data-copy-link]').addEventListener('click', async () => {
    const link = joinLink(state.room.code);
    try { await navigator.clipboard.writeText(link); actionStatus('加入链接已复制'); } catch (error) {
      $('[data-room-link]').select();
      actionStatus('请按 Ctrl/⌘ + C 复制加入链接');
    }
  });

  // 发布本周课堂
  const dialog = $('[data-publish-dialog]');
  const publishForm = $('[data-publish-form]');
  function fillChapterOptions() {
    publishForm.elements.chapter.innerHTML = course.chapters.map((chapter) =>
      `<option value="${chapter.id}">${esc(chapter.cn)} ${esc(chapter.title)}（案例 ${chapter.cases.map((item) => item.number).join('、')}）</option>`).join('');
  }
  $('[data-publish-open]').addEventListener('click', () => {
    $('[data-publish-error]').textContent = '';
    if (state.room) publishForm.elements.chapter.value = state.room.chapter;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    publishForm.elements.name.focus();
  });
  $('[data-publish-cancel]').addEventListener('click', () => dialog.close());
  publishForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = publishForm.elements.name.value.trim();
    if (!name) { $('[data-publish-error]').textContent = '请填写课堂名称'; return; }
    const button = publishForm.querySelector('[type=submit]');
    button.disabled = true;
    button.textContent = '正在发布……';
    try {
      const row = await backend.rpc('ck_publish', { p_course: course.slug, p_name: name, p_chapter: publishForm.elements.chapter.value });
      const room = Array.isArray(row) ? row[0] : row;
      dialog.close();
      publishForm.elements.name.value = '';
      await loadRooms(room && room.id);
      actionStatus(`已发布：课堂码 ${room.code}`);
    } catch (error) {
      console.error(error);
      $('[data-publish-error]').textContent = `发布失败：${error.message || error}`;
    } finally {
      button.disabled = false;
      button.textContent = '发布并生成课堂码';
    }
  });

  // ---------------- 数据同步 ----------------
  const setLive = (text, bad) => {
    const badge = $('[data-live-state]');
    badge.textContent = text;
    badge.classList.toggle('is-bad', Boolean(bad));
  };
  function stopWatching() {
    state.stops.forEach((stop) => stop());
    state.stops = [];
  }
  function subscribe() {
    stopWatching();
    state.docs = { checkins: [], choices: [], answers: [], danmaku: [] };
    renderAll();
    setLive('连接中……');
    // 实时推送不可用时后台自动改为每 5 秒刷新，这里只提示方式
    const modes = {};
    const mode = () => {
      const values = Object.values(modes);
      if (values.includes('polling')) return '每 5 秒自动刷新';
      return values.length === KINDS.length ? '实时同步中' : '已连接';
    };
    const where = { course: course.slug, classroom: Number(state.room.id) };
    KINDS.forEach((kind) => {
      state.stops.push(backend.watch(kind, where, (docs) => {
        state.docs[kind] = docs;
        setLive(`${mode()} · ${clock(Date.now())}`);
        renderAll();
      }, (error) => {
        console.error(error);
        setLive('读取数据失败，请刷新页面或重新登录', true);
      }, (status) => { modes[kind] = status; setLive(`${mode()} · ${clock(Date.now())}`); }));
    });
  }

  // ---------------- 标签页 ----------------
  $$('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
    $$('[data-tab]').forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
    $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
    store.set('tab', tab.dataset.tab);
  }));
  const savedTab = store.get('tab');
  if (savedTab && $(`[data-tab="${savedTab}"]`)) $(`[data-tab="${savedTab}"]`).click();

  function renderAll() {
    renderStats();
    renderCheckins();
    renderChoices();
    renderAnswers();
    renderDanmaku();
  }

  // ---------------- 加入名单与统计 ----------------
  const students = () => {
    const map = new Map();
    state.docs.checkins.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach((doc) => {
      const row = map.get(doc.sid) || { sid: doc.sid, names: new Set(), first: doc.ts };
      row.names.add(doc.name);
      row.class_name = doc.class_name || row.class_name || '';
      row.group_name = doc.group_name || row.group_name || '';
      map.set(doc.sid, row);
    });
    return Array.from(map.values());
  };
  const submissions = () => {
    const map = new Map();
    state.docs.answers.forEach((doc) => { if ((doc.ts || 0) > (map.get(doc.sid) || 0)) map.set(doc.sid, doc.ts || 0); });
    return map;
  };
  function renderStats() {
    const joined = students();
    const submitted = submissions();
    $('[data-stat-joined]').textContent = joined.length;
    $('[data-stat-submitted]').textContent = submitted.size;
    $('[data-stat-pending]').textContent = joined.filter((row) => !submitted.has(row.sid)).length;
    $('[data-stat-danmaku]').textContent = state.docs.danmaku.length;
  }
  $('[data-checkin-search]').addEventListener('input', renderCheckins);
  function renderCheckins() {
    const submitted = submissions();
    const query = $('[data-checkin-search]').value.trim();
    const rows = students().filter((row) => !query || [row.sid, row.class_name, row.group_name, ...row.names].some((value) => String(value || '').includes(query)));
    $('[data-checkin-rows]').innerHTML = rows.map((row, index) => {
      const names = Array.from(row.names);
      const remark = names.length > 1 ? `同一学号填写了不同姓名：${names.join('、')}` : '';
      const done = submitted.get(row.sid);
      return `<tr><td>${index + 1}</td><td>${esc(row.sid)}</td><td>${esc(names[0])}</td><td>${esc(row.class_name)}</td><td>${esc(row.group_name)}</td><td>${clock(row.first)}</td>
        <td class="${done ? 'ok' : 'warn'}">${done ? `已提交 ${clock(done)}` : '未提交'}</td><td class="warn">${esc(remark)}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">还没有学生加入这个课堂。把课堂码或加入链接展示给学生。</td></tr>';
  }

  // ---------------- 投票与选择 ----------------
  function setupSelectors() {
    const cases = roomCases();
    const options = cases.map((item) => `<option value="${item.number}">案例${item.number} ${esc(item.title)}</option>`).join('');
    $('[data-case-select]').innerHTML = options;
    $('[data-answer-case]').innerHTML = options;
    fillItems();
  }
  $('[data-case-select]').addEventListener('change', renderChoices);
  $('[data-show-reference]').addEventListener('change', renderChoices);
  $('[data-answer-case]').addEventListener('change', () => { fillItems(); renderAnswers(); });
  $('[data-answer-item]').addEventListener('change', renderAnswers);
  $('[data-answer-search]').addEventListener('input', renderAnswers);

  const latestChoices = (caseNo) => window.ClassLive.latest(
    state.docs.choices.filter((doc) => doc.case === caseNo),
    (doc) => `${doc.sid}|${doc.item}`,
  );
  const tally = (docs, item) => {
    const counts = new Map();
    docs.filter((doc) => doc.item === item).forEach((doc) => counts.set(String(doc.choice), (counts.get(String(doc.choice)) || 0) + 1));
    return counts;
  };
  const bar = (count, total, cls) => `<span class="tw-meter ${cls || ''}"><i style="width:${pct(count, total)}%"></i></span><em>${count} 人 · ${pct(count, total)}%</em>`;
  const sum = (counts) => Array.from(counts.values()).reduce((a, b) => a + b, 0);

  function renderChoices() {
    const item = caseMap.get($('[data-case-select]').value);
    const view = $('[data-choice-view]');
    if (!item) { view.innerHTML = ''; return; }
    const showRef = $('[data-show-reference]').checked;
    const docs = latestChoices(item.number);
    const star = (flag) => (showRef && flag ? '<b class="ref" title="参考答案">★</b>' : '');
    const pre = tally(docs, 'pre');
    const post = tally(docs, 'post');
    const preTotal = sum(pre);
    const postTotal = sum(post);
    const poll = `
      <article class="tw-card wide">
        <h2>前测与后测投票 <small>前测 ${preTotal} 人 · 后测 ${postTotal} 人</small></h2>
        <p class="tw-q">${esc(item.poll.question)}</p>
        ${item.poll.options.map((option, index) => {
          const key = String(index + 1);
          return `<div class="tw-option"><div class="tw-option-label">${star(item.poll.reference === index + 1)}<span>${String(index + 1).padStart(2, '0')}</span>${esc(option)}</div>
            <div class="tw-pair"><label>前测</label>${bar(pre.get(key) || 0, preTotal, 'pre')}</div>
            <div class="tw-pair"><label>后测</label>${bar(post.get(key) || 0, postTotal, 'post')}</div></div>`;
        }).join('')}
      </article>`;
    const match = `
      <article class="tw-card wide">
        <h2>证据—理论配对</h2>
        <ol class="tw-legend">${item.matching.legend.map((text, index) => `<li><b>K${index + 1}</b>${esc(text)}</li>`).join('')}</ol>
        <table class="tw-table compact"><thead><tr><th>事实线索</th>${[1, 2, 3, 4].map((k) => `<th>K${k}</th>`).join('')}<th>人数</th></tr></thead><tbody>
        ${item.matching.clues.map((clue, index) => {
          const counts = tally(docs, `match-${index + 1}`);
          const total = sum(counts);
          return `<tr><th>${esc(clue.label)}</th>${[1, 2, 3, 4].map((k) => {
            const mark = showRef ? (clue.answer === k ? ' is-answer' : clue.accept.includes(k) ? ' is-accept' : '') : '';
            const count = counts.get('K' + k) || 0;
            return `<td class="tw-cell${mark}">${count}<small>${pct(count, total)}%</small></td>`;
          }).join('')}<td>${total}</td></tr>`;
        }).join('')}</tbody></table>
        ${showRef ? '<p class="tw-hint">深色格为参考对应，浅色格为可以成立的答案。</p>' : ''}
      </article>`;
    const sim = `
      <article class="tw-card wide">
        <h2>方案推演：${esc(item.sim.title)}</h2>
        ${item.sim.rounds.map((round, index) => {
          const counts = tally(docs, `sim-${index + 1}`);
          const total = sum(counts);
          return `<div class="tw-round"><h3>${esc(round.title)} <small>${total} 人</small></h3><p class="tw-q">${esc(round.question)}</p>
            ${round.options.map((option) => `<div class="tw-option single"><div class="tw-option-label">${star(option.reference)}<span>${option.letter}</span>${esc(option.text)}</div>${bar(counts.get(option.letter) || 0, total)}</div>`).join('')}</div>`;
        }).join('')}
      </article>`;
    view.innerHTML = poll + match + sim;
  }

  // ---------------- 文字作答 ----------------
  function fillItems() {
    const item = caseMap.get($('[data-answer-case]').value);
    const select = $('[data-answer-item]');
    const previous = select.value;
    select.innerHTML = item ? item.items.map((entry) => `<option value="${entry.key}">${esc(entry.label)}</option>`).join('') : '';
    if (item && item.items.some((entry) => entry.key === previous)) select.value = previous;
  }
  function renderAnswers() {
    const item = caseMap.get($('[data-answer-case]').value);
    if (!item) { $('[data-answer-list]').innerHTML = ''; $('[data-answer-prompt]').textContent = ''; return; }
    const key = $('[data-answer-item]').value;
    const entry = item.items.find((candidate) => candidate.key === key);
    $('[data-answer-prompt]').textContent = entry ? entry.prompt : '';
    const query = $('[data-answer-search]').value.trim();
    const docs = window.ClassLive.latest(
      state.docs.answers.filter((doc) => doc.case === item.number && doc.item === key),
      (doc) => doc.sid,
    ).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const answered = new Set(docs.map((doc) => doc.sid));
    const missing = students().filter((row) => !answered.has(row.sid));
    $('[data-answer-count]').textContent = docs.length;
    $('[data-answer-missing]').textContent = missing.length;
    $('[data-missing-names]').textContent = missing.map((row) => `${Array.from(row.names)[0]}（${row.sid}）`).join('、') || '无';
    const shown = docs.filter((doc) => !query || doc.sid.includes(query) || doc.name.includes(query));
    $('[data-answer-list]').innerHTML = shown.map((doc) => `
      <article class="tw-answer"><header><strong>${esc(doc.name)}</strong><span>${esc(doc.sid)}</span><time>${clock(doc.ts)}</time></header><p>${esc(doc.text)}</p></article>`).join('')
      || '<p class="empty">还没有学生提交这道题。</p>';
  }

  // ---------------- 弹幕 ----------------
  const DANMAKU_HINT = {
    off: '弹幕已关闭：学生暂时不能发送。在上方“弹幕”处选择“直接上屏”或“审核后上屏”即可开启。',
    direct: '直接上屏：学生发送后立即在投屏的课堂页面滚动显示；可随时点“隐藏”撤下。',
    review: '审核后上屏：学生发送后先出现在这里，点“上屏”才会在投屏页面显示。',
  };
  const STATUS_TEXT = { new: '待上屏', shown: '已上屏', hidden: '已隐藏' };
  // 导出记录用审核状态表述（直接上屏模式下未审核的弹幕也会上屏）
  const RECORD_STATUS = { new: '未审核', shown: '已通过审核', hidden: '已隐藏' };
  // 发送人的班级、小组取自本课堂的加入记录
  const whoMap = () => {
    const map = new Map();
    state.docs.checkins.forEach((doc) => map.set(doc.sid, doc));
    return map;
  };
  $('[data-dm-date]').addEventListener('change', renderDanmaku);
  $('[data-dm-search]').addEventListener('input', renderDanmaku);
  function renderDanmaku() {
    const room = state.room;
    if (!room) return;
    const mode = room.danmaku || 'off';
    $('[data-danmaku-hint]').textContent = room.is_current ? DANMAKU_HINT[mode] : '历史课堂：弹幕记录只供查看和导出。';
    const all = state.docs.danmaku.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0) || Number(b.id) - Number(a.id));
    // 日期选项：本课堂出现过的每一天（每节课）
    const dateSelect = $('[data-dm-date]');
    const dates = Array.from(new Set(all.map((doc) => isoDay(doc.ts)))).filter(Boolean).sort().reverse();
    const chosen = dates.includes(dateSelect.value) ? dateSelect.value : '';
    dateSelect.innerHTML = '<option value="">全部日期</option>' + dates.map((date) =>
      `<option value="${date}">${date}（${all.filter((doc) => isoDay(doc.ts) === date).length} 条）</option>`).join('');
    dateSelect.value = chosen;
    const who = whoMap();
    const query = $('[data-dm-search]').value.trim();
    const rows = all.filter((doc) => !chosen || isoDay(doc.ts) === chosen).filter((doc) => {
      if (!query) return true;
      const info = who.get(doc.sid) || {};
      return [doc.name, doc.sid, doc.text, info.class_name, info.group_name].some((value) => String(value || '').includes(query));
    });
    const senders = new Set(rows.map((doc) => doc.sid)).size;
    $('[data-dm-summary]').textContent = `${chosen || '全部日期'}：共 ${rows.length} 条，发送人 ${senders} 人。`;
    $('[data-danmaku-list]').innerHTML = rows.map((doc) => {
      const info = who.get(doc.sid) || {};
      const status = mode === 'direct' && doc.status === 'new' ? '已上屏' : STATUS_TEXT[doc.status] || doc.status;
      const canShow = doc.status !== 'shown' && !(mode === 'direct' && doc.status === 'new');
      const shownClass = mode === 'direct' && doc.status === 'new' ? 'shown' : doc.status;
      return `<tr class="tw-dm is-${esc(shownClass)}"><td>${esc(isoDay(doc.ts))}</td><td>${clock(doc.ts)}</td><td>${esc(doc.name)}</td><td>${esc(doc.sid)}</td>
        <td>${esc(info.class_name || '')}</td><td>${esc(info.group_name || '')}</td><td class="tw-dm-text">${esc(doc.text)}</td><td><em>${esc(status)}</em></td>
        <td class="tw-dm-actions">${canShow ? `<button type="button" data-dm="${esc(doc.id)}" data-dm-status="shown">上屏</button>` : ''}${doc.status !== 'hidden' ? `<button type="button" data-dm="${esc(doc.id)}" data-dm-status="hidden">隐藏</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">没有弹幕记录。</td></tr>';
  }
  $('[data-danmaku-list]').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-dm]');
    if (!button) return;
    button.disabled = true;
    try {
      await backend.rpc('ck_danmaku_status', { p_id: Number(button.dataset.dm) || button.dataset.dm, p_status: button.dataset.dmStatus });
      const doc = state.docs.danmaku.find((item) => String(item.id) === button.dataset.dm);
      if (doc) doc.status = button.dataset.dmStatus;
      renderDanmaku();
    } catch (error) {
      console.error(error);
      button.disabled = false;
      actionStatus(`弹幕操作失败：${error.message || error}`);
    }
  });

  // ---------------- 课堂网页 ----------------
  function renderPages() {
    $('[data-pages]').innerHTML = course.chapters.map((chapter) => `
      <a class="tw-page" href="/${chapter.file}" target="_blank" rel="noopener"><small>${esc(chapter.cn)}</small><strong>${esc(chapter.title)}</strong>
      <span>${chapter.cases.map((item) => `案例${item.number} ${esc(item.title)}`).join('<br>')}</span></a>`).join('');
  }

  // ---------------- 导出 ----------------
  const itemLabel = (caseNo, key) => {
    const item = caseMap.get(caseNo);
    return (item && item.labels[key]) || key;
  };
  const csv = (rows) => '﻿' + rows.map((row) => row.map((cell) => {
    const text = String(cell == null ? '' : cell);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n');
  const download = (name, content) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const safeName = (text) => String(text).replace(/[\\/:*?"<>|\s]+/g, '_');

  async function exportRooms(rooms, label, only, statusEl) {
    const status = statusEl || $('[data-export-status]');
    status.textContent = `正在导出${label}……`;
    try {
      const roomMap = new Map(rooms.map((room) => [String(room.id), room]));
      const pick = (docs) => docs.filter((doc) => roomMap.has(String(doc.classroom))).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const [checkins, choices, answers, danmaku] = await Promise.all(
        ['checkins', 'choices', 'answers', 'danmaku'].map(async (kind) => pick(await backend.fetchAll(kind, { course: course.slug }))));
      const who = new Map();
      checkins.forEach((doc) => who.set(`${doc.classroom}|${doc.sid}`, doc));
      const roomCols = (doc) => { const room = roomMap.get(String(doc.classroom)) || {}; return [room.name, room.code]; };
      const person = (doc) => { const info = who.get(`${doc.classroom}|${doc.sid}`) || {}; return [doc.sid, doc.name, info.class_name, info.group_name]; };
      const when = (doc) => [isoDay(doc.ts), clock(doc.ts)];
      const stamp = window.ClassLive.today();
      const prefix = `${course.title}_${label}_${stamp}`;
      const danmakuCsv = () => csv([['课堂', '课堂码', '日期', '时间', '学号', '姓名', '班级', '小组', '弹幕', '状态'],
        ...danmaku.map((d) => [...roomCols(d), isoDay(d.ts), clock(d.ts), ...person(d), d.text, RECORD_STATUS[d.status] || d.status])]);
      if (only === 'danmaku') {
        download(`${prefix}_弹幕记录.csv`, danmakuCsv());
        status.textContent = `已导出${label}弹幕记录：${danmaku.length} 条（含发送人姓名、学号、班级、小组）。`;
        return;
      }
      download(`${prefix}_加入名单.csv`, csv([['课堂', '课堂码', '日期', '时间', '学号', '姓名', '班级', '小组'],
        ...checkins.map((d) => [...roomCols(d), ...when(d), d.sid, d.name, d.class_name, d.group_name])]));
      download(`${prefix}_投票与选择.csv`, csv([['课堂', '课堂码', '日期', '时间', '学号', '姓名', '班级', '小组', '案例', '项目', '选择', '选项内容'],
        ...choices.map((d) => [...roomCols(d), ...when(d), ...person(d), d.case, itemLabel(d.case, d.item), d.choice, d.label])]));
      download(`${prefix}_作业.csv`, csv([['课堂', '课堂码', '日期', '时间', '学号', '姓名', '班级', '小组', '案例', '题目', '作答'],
        ...answers.map((d) => [...roomCols(d), ...when(d), ...person(d), d.case, itemLabel(d.case, d.item), d.text])]));
      download(`${prefix}_弹幕记录.csv`, danmakuCsv());
      status.textContent = `已导出${label}：加入 ${checkins.length} 条、选择 ${choices.length} 条、作答 ${answers.length} 条、弹幕 ${danmaku.length} 条。`;
    } catch (error) {
      console.error(error);
      status.textContent = `导出失败：${error.message || error}`;
    }
  }
  $$('[data-dm-export]').forEach((button) => button.addEventListener('click', () => {
    const status = $('[data-dm-summary]');
    if (button.dataset.dmExport === 'room') {
      if (state.room) exportRooms([state.room], safeName(state.room.name), 'danmaku', status);
    } else {
      exportRooms(state.rooms, '全部课堂', 'danmaku', status);
    }
  }));
  $$('[data-export]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.export === 'room') {
      if (state.room) exportRooms([state.room], safeName(state.room.name));
    } else {
      exportRooms(state.rooms, '全部课堂');
    }
  }));

  // ---------------- 清空 ----------------
  const confirmInput = $('[data-clear-confirm]');
  const clearButton = $('[data-clear]');
  confirmInput.addEventListener('input', () => { clearButton.disabled = confirmInput.value.trim() !== '清空全部数据'; });
  clearButton.addEventListener('click', async () => {
    if (!window.confirm(`确定删除“${course.title}”的全部课堂、加入记录、选择、作答和弹幕吗？此操作无法恢复。`)) return;
    const status = $('[data-clear-status]');
    clearButton.disabled = true;
    status.textContent = '正在清空……';
    try {
      for (const kind of ['checkins', 'choices', 'answers', 'danmaku', 'classrooms']) await backend.removeAll(kind, { course: course.slug });
      status.textContent = '已清空全部数据。';
      confirmInput.value = '';
      state.room = null;
      await loadRooms();
    } catch (error) {
      console.error(error);
      status.textContent = `清空失败：${error.message || error}。也可以在云开发控制台“SQL 型数据库 → SQL 编辑器”中执行 tools/cloudbase-pg.sql 末尾的清空语句。`;
    }
  });

  // ---------------- 启动 ----------------
  (async () => {
    if (!backend) { showLogin(); return; }
    try {
      const session = await backend.session();
      if (session && !session.anonymous) await enterApp(session);
      else showLogin();
    } catch (error) {
      console.error(error);
      showLogin('无法连接课堂后台，请检查网络后刷新。');
    }
  })();
})();
