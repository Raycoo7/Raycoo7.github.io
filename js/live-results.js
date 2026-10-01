/* 投屏实时投票：在课堂完整版页面的前测、后测、证据—理论配对、方案推演各区块内显示学生的实时选择。
 * 每块常显“已提交人数”，点“显示分布”才展开各选项人数与比例（由老师决定何时给全班看）。
 * 只显示“当前课堂”且与本页章节相同时的数据；需要教师已在同一浏览器登录教师工作台（读取需教师账号）。
 * 页面需先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 */
(function () {
  'use strict';
  const config = window.CLASS_LIVE_CONFIG;
  if (!config || config.provider === 'off' || !window.ClassLive) return;
  let backend;
  try { backend = window.ClassLive.create(config); } catch (error) { return; }

  const REFRESH_MS = 4000;
  const HIDDEN_MS = 30000;
  const ROOM_MS = 15000;
  const chapter = (location.pathname.match(/(ch\d{2})\.html$/) || [])[1];
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (value, total) => (total ? Math.round(value / total * 100) : 0);
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  const style = document.createElement('style');
  style.textContent = `
  .lv { margin: 14px 0 4px; padding: 10px 14px; border: 1.5px dashed var(--teal, #23655f); border-radius: 10px; background: rgba(228, 239, 235, .55); font-family: var(--sans, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif); }
  .lv-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .lv-tag { padding: 2px 9px; border-radius: 12px; color: #fff; background: var(--teal, #23655f); font-weight: 800; font-size: 13px; }
  .lv-count { color: var(--ink, #201c18); font-weight: 800; font-size: 16px; }
  .lv-note { color: var(--muted, #6d6259); font-size: 14px; }
  .lv-head button { margin-left: auto; padding: 5px 12px; border: 1px solid var(--teal, #23655f); border-radius: 6px; color: var(--teal, #23655f); background: #fff; font: 700 14px/1.2 inherit; cursor: pointer; }
  .lv-body { margin-top: 10px; }
  .lv-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(120px, 1fr) auto; gap: 10px; align-items: center; padding: 5px 0; font-size: 16px; }
  .lv-row.is-pair { grid-template-columns: minmax(0, 1.2fr) minmax(110px, 1fr) minmax(110px, 1fr) auto; }
  .lv-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lv-label b { margin-right: 6px; color: var(--teal, #23655f); }
  .lv-bar { position: relative; height: 16px; border-radius: 8px; background: rgba(70, 51, 34, .12); overflow: hidden; }
  .lv-bar i { position: absolute; inset: 0 auto 0 0; background: var(--teal, #23655f); transition: width .4s ease; }
  .lv-bar.is-pre i { background: var(--gold, #a87a2a); }
  .lv-bar em { position: absolute; right: 6px; top: -1px; color: var(--ink, #201c18); font: 700 12px/18px inherit; font-style: normal; }
  .lv-num { color: var(--muted, #6d6259); font-size: 14px; white-space: nowrap; }
  .lv-legend { display: flex; gap: 14px; margin-bottom: 4px; color: var(--muted, #6d6259); font-size: 13px; }
  .lv-legend i { display: inline-block; width: 12px; height: 10px; margin-right: 4px; border-radius: 3px; background: var(--teal, #23655f); }
  .lv-legend i.is-pre { background: var(--gold, #a87a2a); }
  .lv-table { width: 100%; border-collapse: collapse; font-size: 15px; }
  .lv-table th, .lv-table td { padding: 5px 8px; border-bottom: 1px solid rgba(70, 51, 34, .14); text-align: center; }
  .lv-table th:first-child, .lv-table td:first-child { text-align: left; }
  .lv-table td.is-top { color: #fff; background: var(--teal, #23655f); font-weight: 800; }
  .lv-table small { display: block; opacity: .75; font-size: 11px; }
  @media print { .lv { display: none !important; } }
  `;
  document.head.appendChild(style);

  // ---------- 在页面上找出各互动区块 ----------
  const caseOf = (el) => {
    const own = el.getAttribute('data-prepost') || el.getAttribute('data-poll-id');
    if (own) return own.replace('case-', '');
    const section = el.closest('[id^="case-"]');
    const match = section && section.id.match(/^case-(\d{2})/);
    return match ? match[1] : null;
  };
  const blocks = [];
  const addBlock = (anchor, spec) => {
    if (!anchor || !spec.case) return;
    const box = document.createElement('div');
    box.className = 'lv';
    box.setAttribute('data-ix', '');
    box.innerHTML = '<div class="lv-head"><span class="lv-tag">学生实时结果</span><span class="lv-count" data-lv-count>—</span>'
      + '<span class="lv-note" data-lv-note></span><button type="button" data-lv-toggle>显示分布</button></div><div class="lv-body" data-lv-body hidden></div>';
    ['click', 'keydown'].forEach((type) => box.addEventListener(type, (event) => event.stopPropagation()));
    anchor.insertAdjacentElement('afterend', box);
    const block = { ...spec, box, open: false };
    box.querySelector('[data-lv-toggle]').addEventListener('click', () => {
      block.open = !block.open;
      box.querySelector('[data-lv-toggle]').textContent = block.open ? '隐藏分布' : '显示分布';
      box.querySelector('[data-lv-body]').hidden = !block.open;
      render();
    });
    blocks.push(block);
  };

  document.querySelectorAll('section.classroom-poll[data-poll-id]').forEach((section) => {
    addBlock(section.querySelector('.poll-options'), {
      kind: 'poll', case: caseOf(section),
      options: Array.from(section.querySelectorAll('.poll-option-copy')).map((el, index) => ({ key: String(index + 1), label: text(el.querySelector('span')), text: text(el.querySelector('strong')) })),
    });
  });
  document.querySelectorAll('section.ix-prepost[data-prepost]').forEach((section) => {
    addBlock(section.querySelector('.prepost-rows'), {
      kind: 'prepost', case: caseOf(section),
      options: Array.from(section.querySelectorAll('.prepost-label')).map((el, index) => ({ key: String(index + 1), label: text(el.querySelector('span')), text: text(el.querySelector('strong')) })),
    });
  });
  document.querySelectorAll('section.ix-match[data-match]').forEach((section) => {
    addBlock(section.querySelector('.match-table-wrap'), {
      kind: 'match', case: caseOf(section),
      clues: Array.from(section.querySelectorAll('tr[data-match-row]')).map((row, index) => {
        // 只取线索标题（如“01 制度起点”），不带下方的说明文字
        const cell = row.cells[0].cloneNode(true);
        cell.querySelectorAll('small, p').forEach((el) => el.remove());
        return { item: `match-${index + 1}`, text: text(cell) };
      }),
    });
  });
  document.querySelectorAll('section.ix-sim[data-sim]').forEach((section) => {
    const caseNo = caseOf(section);
    section.querySelectorAll('article.sim-round[data-sim-round]').forEach((round) => {
      addBlock(round.querySelector('.sim-options'), {
        kind: 'sim', case: caseNo, item: `sim-${round.getAttribute('data-sim-round')}`,
        options: Array.from(round.querySelectorAll('.sim-option')).map((el) => ({ key: text(el.querySelector('span')), label: text(el.querySelector('span')), text: text(el.querySelector('strong')) })),
      });
    });
  });
  if (!blocks.length) return;

  // ---------- 数据 ----------
  let room = null;
  let status = '连接中……';
  let counts = new Map();   // "案例|项目" → Map(选项 → 人数)
  const tally = (caseNo, item) => counts.get(`${caseNo}|${item}`) || new Map();
  const total = (map) => Array.from(map.values()).reduce((a, b) => a + b, 0);

  const bar = (count, all, cls) => `<span class="lv-bar ${cls || ''}"><i style="width:${pct(count, all)}%"></i></span>`;
  function renderBlock(block) {
    const countEl = block.box.querySelector('[data-lv-count]');
    const noteEl = block.box.querySelector('[data-lv-note]');
    const body = block.box.querySelector('[data-lv-body]');
    const toggle = block.box.querySelector('[data-lv-toggle]');
    if (status) {
      countEl.textContent = '';
      noteEl.innerHTML = status;
      toggle.hidden = true;
      body.hidden = true;
      return;
    }
    noteEl.textContent = '';
    toggle.hidden = false;
    if (block.kind === 'poll' || block.kind === 'sim') {
      const map = tally(block.case, block.kind === 'poll' ? 'pre' : block.item);
      const all = total(map);
      countEl.textContent = `已提交 ${all} 人`;
      if (block.open) {
        body.innerHTML = block.options.map((option) => {
          const n = map.get(option.key) || 0;
          return `<div class="lv-row"><span class="lv-label"><b>${esc(option.label)}</b>${esc(option.text)}</span>${bar(n, all)}<span class="lv-num">${n} 人 · ${pct(n, all)}%</span></div>`;
        }).join('');
      }
    } else if (block.kind === 'prepost') {
      const pre = tally(block.case, 'pre');
      const post = tally(block.case, 'post');
      const preAll = total(pre);
      const postAll = total(post);
      countEl.textContent = `前测 ${preAll} 人 · 后测 ${postAll} 人`;
      if (block.open) {
        body.innerHTML = '<div class="lv-legend"><span><i class="is-pre"></i>前测</span><span><i></i>后测</span></div>' + block.options.map((option) => {
          const a = pct(pre.get(option.key) || 0, preAll);
          const b = pct(post.get(option.key) || 0, postAll);
          const delta = b - a;
          return `<div class="lv-row is-pair"><span class="lv-label"><b>${esc(option.label)}</b>${esc(option.text)}</span>${bar(pre.get(option.key) || 0, preAll, 'is-pre')}${bar(post.get(option.key) || 0, postAll)}
            <span class="lv-num">${a}% → ${b}%（${delta > 0 ? '+' : ''}${delta}）</span></div>`;
        }).join('');
      }
    } else if (block.kind === 'match') {
      const answered = Math.max(0, ...block.clues.map((clue) => total(tally(block.case, clue.item))));
      countEl.textContent = `已作答 ${answered} 人`;
      if (block.open) {
        body.innerHTML = `<table class="lv-table"><thead><tr><th>事实线索</th>${[1, 2, 3, 4].map((k) => `<th>K${k}</th>`).join('')}<th>人数</th></tr></thead><tbody>${block.clues.map((clue) => {
          const map = tally(block.case, clue.item);
          const all = total(map);
          const top = Math.max(0, ...[1, 2, 3, 4].map((k) => map.get('K' + k) || 0));
          return `<tr><td>${esc(clue.text)}</td>${[1, 2, 3, 4].map((k) => {
            const n = map.get('K' + k) || 0;
            return `<td class="${n && n === top ? 'is-top' : ''}">${n}<small>${pct(n, all)}%</small></td>`;
          }).join('')}<td>${all}</td></tr>`;
        }).join('')}</tbody></table>`;
      }
    }
  }
  function render() { blocks.forEach(renderBlock); }

  async function loadRoom() {
    try {
      const rooms = await backend.fetchAll('classrooms', { course: config.course });
      room = rooms.find((row) => row.is_current) || null;
      if (!room) status = '还没有发布课堂，发布后这里显示学生的实时选择。';
      else if (room.chapter !== chapter) status = `当前课堂“${esc(room.name)}”不是本章，这里暂不显示学生结果。`;
      else status = '';
    } catch (error) {
      room = null;
      status = '请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>，再刷新本页。';
    }
  }
  let lastLoad = 0;
  async function loadChoices(force) {
    if (!room || status) return;
    // 页面在后台时降为每 30 秒一次，切回前台立即刷新
    if (!force && document.hidden && Date.now() - lastLoad < HIDDEN_MS) return;
    lastLoad = Date.now();
    try {
      const docs = window.ClassLive.latest(
        await backend.fetchAll('choices', { classroom: Number(room.id) }),
        (doc) => `${doc.sid}|${doc.case}|${doc.item}`,
      );
      const next = new Map();
      docs.forEach((doc) => {
        const key = `${doc.case}|${doc.item}`;
        const map = next.get(key) || new Map();
        map.set(String(doc.choice), (map.get(String(doc.choice)) || 0) + 1);
        next.set(key, map);
      });
      counts = next;
    } catch (error) {
      console.warn('[实时投票]', error);
    }
  }

  (async () => {
    const session = await backend.session().catch(() => null);
    if (!session || session.anonymous) {
      status = '请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>，再刷新本页，即可显示学生的实时选择。';
      render();
      return;
    }
    await loadRoom();
    await loadChoices(true);
    render();
    document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await loadChoices(true); render(); } });
    setInterval(async () => { await loadChoices(); render(); }, REFRESH_MS);
    setInterval(async () => { await loadRoom(); render(); }, ROOM_MS);
  })();
})();
