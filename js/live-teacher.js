/* 教师工作台：登录（第二道锁）后实时查看签到、投票与选择、文字作答；导出 CSV；学期末清空。
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
  const KINDS = ['checkins', 'choices', 'answers'];
  const store = {
    get: (key) => { try { return localStorage.getItem('teacher:' + key); } catch (error) { return null; } },
    set: (key, value) => { try { localStorage.setItem('teacher:' + key, value); } catch (error) { /* 忽略 */ } },
  };
  const clock = (ts) => ts ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ts)) : '';
  const pct = (value, total) => (total ? Math.round(value / total * 100) : 0);
  $('[data-course-title]').textContent = course.title;

  let backend = null;
  let backendError = '';
  try { backend = window.ClassLive.create(config); } catch (error) { backendError = error.message; }

  const state = {
    date: window.ClassLive.today(),
    docs: { checkins: [], choices: [], answers: [] },
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

  function enterApp(session) {
    $('[data-login]').hidden = true;
    $('[data-app]').hidden = false;
    $('[data-when-login]').hidden = false;
    $('[data-user]').textContent = session.name ? `教师：${session.name}` : '教师已登录';
    const dateInput = $('[data-date]');
    dateInput.value = state.date;
    dateInput.addEventListener('change', () => { state.date = dateInput.value || window.ClassLive.today(); subscribe(); });
    setupSelectors();
    renderPages();
    subscribe();
  }

  // ---------------- 实时订阅 ----------------
  const setLive = (text, bad) => {
    const badge = $('[data-live-state]');
    badge.textContent = text;
    badge.classList.toggle('is-bad', Boolean(bad));
  };
  function subscribe() {
    state.stops.forEach((stop) => stop());
    state.stops = [];
    state.docs = { checkins: [], choices: [], answers: [] };
    setLive('连接中……');
    // 实时推送不可用时后台自动改为每 5 秒刷新，这里只提示方式
    const modes = {};
    const mode = () => {
      const values = Object.values(modes);
      if (values.includes('polling')) return '每 5 秒自动刷新';
      return values.length === KINDS.length ? '实时同步中' : '已连接';
    };
    KINDS.forEach((kind) => {
      state.stops.push(backend.watch(kind, { course: course.slug, session: state.date }, (docs) => {
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
    renderCheckins();
    renderChoices();
    renderAnswers();
  }

  // ---------------- 签到 ----------------
  const students = () => {
    const map = new Map();
    state.docs.checkins.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach((doc) => {
      const row = map.get(doc.sid) || { sid: doc.sid, names: new Set(), first: doc.ts, last: doc.ts, page: doc.page };
      row.names.add(doc.name);
      row.last = doc.ts;
      row.page = doc.page;
      map.set(doc.sid, row);
    });
    return Array.from(map.values());
  };
  $('[data-checkin-search]').addEventListener('input', renderCheckins);
  function renderCheckins() {
    const rows = students();
    const query = $('[data-checkin-search]').value.trim();
    $('[data-checkin-count]').textContent = rows.length;
    $('[data-checkin-latest]').textContent = rows.length ? clock(Math.max(...rows.map((row) => row.last || 0))) : '—';
    const shown = rows.filter((row) => !query || row.sid.includes(query) || Array.from(row.names).some((name) => name.includes(query)));
    $('[data-checkin-rows]').innerHTML = shown.map((row, index) => {
      const names = Array.from(row.names);
      const remark = names.length > 1 ? `同一学号填写了不同姓名：${names.join('、')}` : '';
      return `<tr><td>${index + 1}</td><td>${esc(row.sid)}</td><td>${esc(names[0])}</td><td>${clock(row.first)}</td><td>${esc(row.page || '')}</td><td class="warn">${esc(remark)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">这一天还没有学生签到。</td></tr>';
  }

  // ---------------- 投票与选择 ----------------
  function setupSelectors() {
    const options = course.cases.map((item) => `<option value="${item.number}">案例${item.number} ${esc(item.title)}</option>`).join('');
    const caseSelect = $('[data-case-select]');
    const answerCase = $('[data-answer-case]');
    caseSelect.innerHTML = options;
    answerCase.innerHTML = options;
    const savedCase = store.get('case');
    if (savedCase && caseMap.has(savedCase)) { caseSelect.value = savedCase; answerCase.value = savedCase; }
    caseSelect.addEventListener('change', () => { store.set('case', caseSelect.value); renderChoices(); });
    $('[data-show-reference]').addEventListener('change', renderChoices);
    answerCase.addEventListener('change', () => { store.set('case', answerCase.value); fillItems(); renderAnswers(); });
    $('[data-answer-item]').addEventListener('change', renderAnswers);
    $('[data-answer-search]').addEventListener('input', renderAnswers);
    fillItems();
  }

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
    if (!item) return;
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
    $('[data-choice-view]').innerHTML = poll + match + sim;
  }

  // ---------------- 文字作答 ----------------
  function fillItems() {
    const item = caseMap.get($('[data-answer-case]').value);
    const select = $('[data-answer-item]');
    const previous = select.value;
    select.innerHTML = item.items.map((entry) => `<option value="${entry.key}">${esc(entry.label)}</option>`).join('');
    if (item.items.some((entry) => entry.key === previous)) select.value = previous;
  }
  function renderAnswers() {
    const item = caseMap.get($('[data-answer-case]').value);
    if (!item) return;
    const key = $('[data-answer-item]').value;
    const entry = item.items.find((candidate) => candidate.key === key);
    $('[data-answer-prompt]').textContent = entry ? entry.prompt : '';
    const query = $('[data-answer-search]').value.trim();
    const docs = window.ClassLive.latest(
      state.docs.answers.filter((doc) => doc.case === item.number && doc.item === key),
      (doc) => doc.sid,
    ).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const submitted = new Set(docs.map((doc) => doc.sid));
    const missing = students().filter((row) => !submitted.has(row.sid));
    $('[data-answer-count]').textContent = docs.length;
    $('[data-answer-missing]').textContent = missing.length;
    $('[data-missing-names]').textContent = missing.map((row) => `${Array.from(row.names)[0]}（${row.sid}）`).join('、') || '无';
    const shown = docs.filter((doc) => !query || doc.sid.includes(query) || doc.name.includes(query));
    $('[data-answer-list]').innerHTML = shown.map((doc) => `
      <article class="tw-answer"><header><strong>${esc(doc.name)}</strong><span>${esc(doc.sid)}</span><time>${clock(doc.ts)}</time></header><p>${esc(doc.text)}</p></article>`).join('')
      || '<p class="empty">还没有学生提交这道题。</p>';
  }

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
  const EXPORTS = {
    checkins: { title: '签到记录', head: ['日期', '时间', '学号', '姓名', '页面'], row: (d) => [d.session, clock(d.ts), d.sid, d.name, d.page] },
    choices: { title: '投票与选择', head: ['日期', '时间', '学号', '姓名', '案例', '项目', '选择', '选项内容'], row: (d) => [d.session, clock(d.ts), d.sid, d.name, d.case, itemLabel(d.case, d.item), d.choice, d.label] },
    answers: { title: '文字作答', head: ['日期', '时间', '学号', '姓名', '案例', '题目', '作答'], row: (d) => [d.session, clock(d.ts), d.sid, d.name, d.case, itemLabel(d.case, d.item), d.text] },
  };
  $$('[data-export]').forEach((button) => button.addEventListener('click', async () => {
    const kind = button.dataset.export;
    const spec = EXPORTS[kind];
    const status = $('[data-export-status]');
    status.textContent = `正在导出${spec.title}……`;
    try {
      const docs = (await backend.fetchAll(kind, { course: course.slug })).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      download(`${course.title}_${spec.title}_${window.ClassLive.today()}.csv`, csv([spec.head, ...docs.map(spec.row)]));
      status.textContent = `已导出${spec.title}：${docs.length} 条。`;
    } catch (error) {
      console.error(error);
      status.textContent = `导出失败：${error.message || error}`;
    }
  }));

  // ---------------- 清空 ----------------
  const confirmInput = $('[data-clear-confirm]');
  const clearButton = $('[data-clear]');
  confirmInput.addEventListener('input', () => { clearButton.disabled = confirmInput.value.trim() !== '清空全部数据'; });
  clearButton.addEventListener('click', async () => {
    if (!window.confirm(`确定删除“${course.title}”的全部签到、选择和作答记录吗？此操作无法恢复。`)) return;
    const status = $('[data-clear-status]');
    clearButton.disabled = true;
    status.textContent = '正在清空……';
    try {
      for (const kind of KINDS) await backend.removeAll(kind, { course: course.slug });
      status.textContent = '已清空全部数据。';
      confirmInput.value = '';
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
      if (session && !session.anonymous) enterApp(session);
      else showLogin();
    } catch (error) {
      console.error(error);
      showLogin('无法连接课堂后台，请检查网络后刷新。');
    }
  })();
})();
