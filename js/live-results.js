/* 投屏实时结果：在教师投屏页面的互动区块下方显示学生递交的结果与对错统计。
 *   章节案例课程（课堂完整版）：前测、后测、证据—理论配对、方案推演（★ 为参考答案）；
 *   概念学习课程（讲解版，如《政治经济学》）：各概念的想一想、辨一辨、用一用（分一分 / 填一填 / 算一算 / 变一变）、
 *     一句话说清（人数），概念串联、小组辨析（人数）、出门测（每题只算学生第一次递交）。
 * 每块常显“已递交人数”，点“显示分布”才展开各选项人数、比例和正确率（由老师决定何时给全班看）。
 * 只显示“当前课堂”且与本页章节（案例）相同时的数据；需要教师已在同一浏览器登录教师工作台（读取需教师账号）。
 * 离线版（provider = offline，脚本内嵌在课程目录的离线完整版 HTML 里）：右下角“导入学生文件”，
 *   读取学生在离线学生版里导出的 HTML（内含作答数据），同一学号多份时每题取最早递交的，统计方式与在线相同。
 * 在线版需要页面先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 */
(function () {
  'use strict';
  const config = window.CLASS_LIVE_CONFIG;
  const OFFLINE = Boolean(config && config.provider === 'offline');
  if (!config || config.provider === 'off' || (!OFFLINE && !window.ClassLive)) return;
  let backend = null;
  if (!OFFLINE) {
    try { backend = window.ClassLive.create(config); } catch (error) { return; }
  }

  const REFRESH_MS = 4000;
  const HIDDEN_MS = 30000;
  const ROOM_MS = 15000;
  const CONCEPT = config.kind === 'concept-html';
  const chapter = config.unit || (location.pathname.match(/([a-z]{2,6}\d{2})\.html$/) || [])[1];
  const HERE = CONCEPT ? '本案例' : '本章';
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (value, total) => (total ? Math.round(value / total * 100) : 0);
  const WRONG_ALERT = 40;   // 证据—理论配对：错误率达到这一比例时标红
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const short = (value, size) => (value.length > size ? `${value.slice(0, size)}…` : value);

  const style = document.createElement('style');
  style.textContent = `
  .lv { margin: 14px 0 4px; padding: 10px 14px; border: 1.5px dashed var(--teal, #23655f); border-radius: 10px; background: rgba(228, 239, 235, .55); font-family: var(--sans, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif); text-align: left; }
  .lv-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .lv-tag { padding: 2px 9px; border-radius: 12px; color: #fff; background: var(--teal, #23655f); font-weight: 800; font-size: 13px; }
  .lv-count { color: var(--ink, #201c18); font-weight: 800; font-size: 16px; }
  .lv-note { color: var(--muted, #6d6259); font-size: 14px; }
  .lv-head button { margin-left: auto; padding: 5px 12px; border: 1px solid var(--teal, #23655f); border-radius: 6px; color: var(--teal, #23655f); background: #fff; font: 700 14px/1.2 inherit; cursor: pointer; }
  .lv-body { margin-top: 10px; }
  .lv-rate { margin: 0 0 6px; color: var(--teal, #23655f); font-weight: 800; font-size: 15px; }
  .lv-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(120px, 1fr) auto; gap: 10px; align-items: center; padding: 5px 0; font-size: 16px; }
  .lv-row.is-pair { grid-template-columns: minmax(0, 1.2fr) minmax(110px, 1fr) minmax(110px, 1fr) auto; }
  .lv-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lv-label b { margin-right: 6px; color: var(--teal, #23655f); }
  .lv-ref { color: var(--gold, #a87a2a); font-weight: 900; }
  .lv-bar { position: relative; height: 16px; border-radius: 8px; background: rgba(70, 51, 34, .12); overflow: hidden; }
  .lv-bar i { position: absolute; inset: 0 auto 0 0; background: var(--teal, #23655f); transition: width .4s ease; }
  .lv-bar.is-pre i { background: var(--gold, #a87a2a); }
  .lv-num { color: var(--muted, #6d6259); font-size: 14px; white-space: nowrap; }
  .lv-legend { display: flex; gap: 14px; margin-bottom: 4px; color: var(--muted, #6d6259); font-size: 13px; }
  .lv-legend i { display: inline-block; width: 12px; height: 10px; margin-right: 4px; border-radius: 3px; background: var(--teal, #23655f); }
  .lv-legend i.is-pre { background: var(--gold, #a87a2a); }
  .lv-table { width: 100%; border-collapse: collapse; font-size: 15px; }
  .lv-table th, .lv-table td { padding: 5px 8px; border-bottom: 1px solid rgba(70, 51, 34, .14); text-align: center; }
  .lv-table th:first-child, .lv-table td:first-child { text-align: left; }
  .lv-table td.is-ref { color: #fff; background: var(--teal, #23655f); font-weight: 800; }
  .lv-table td.is-alt { background: rgba(35, 101, 95, .16); }
  .lv-table small { display: block; opacity: .75; font-size: 11px; }
  .lv-table td.lv-wrong.is-high { color: #a4492d; background: rgba(164, 73, 45, .12); font-weight: 800; }
  .lv-values { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 8px; }
  .lv-values span { padding: 3px 9px; border: 1px solid rgba(70, 51, 34, .2); border-radius: 6px; background: #fff; font-size: 14px; }
  .lv-values span.is-ok { border-color: var(--teal, #23655f); background: rgba(35, 101, 95, .12); }
  .lv-field { padding: 6px 0; border-bottom: 1px dashed rgba(70, 51, 34, .16); }
  .lv-field > div:first-child { display: flex; justify-content: space-between; gap: 10px; font-size: 15px; }
  .lv-import { position: fixed; z-index: 301; right: 22px; bottom: 22px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: min(560px, calc(100vw - 44px)); padding: 5px 8px; border-radius: 8px;
    background: rgba(32, 28, 24, .72); color: #fff; font: 700 12.5px/1.3 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; opacity: .45; transition: opacity .2s ease; }
  .lv-import:hover, .lv-import:focus-within { opacity: 1; }
  .lv-import button, .lv-import label { padding: 3px 8px; border: 1px solid rgba(255,255,255,.4); border-radius: 5px; color: #fff; background: transparent; font: inherit; cursor: pointer; }
  .lv-import input[type=file] { display: none; }
  @media print { .lv, .lv-import { display: none !important; } }
  `;
  document.head.appendChild(style);

  // ---------- 在页面上找出各互动区块 ----------
  const blocks = [];
  const addBlock = (anchor, spec, where = 'afterend') => {
    if (!anchor) return;
    const box = document.createElement('div');
    box.className = 'lv';
    box.setAttribute('data-ix', '');
    box.innerHTML = '<div class="lv-head"><span class="lv-tag">学生实时结果</span><span class="lv-count" data-lv-count>—</span>'
      + '<span class="lv-note" data-lv-note></span><button type="button" data-lv-toggle>显示分布</button></div><div class="lv-body" data-lv-body hidden></div>';
    ['click', 'keydown'].forEach((type) => box.addEventListener(type, (event) => event.stopPropagation()));
    anchor.insertAdjacentElement(where, box);
    const block = { ...spec, box, open: false };
    box.querySelector('[data-lv-toggle]').addEventListener('click', () => {
      block.open = !block.open;
      box.querySelector('[data-lv-toggle]').textContent = block.open ? '隐藏分布' : '显示分布';
      box.querySelector('[data-lv-body]').hidden = !block.open;
      render();
    });
    blocks.push(block);
  };

  if (CONCEPT) conceptBlocks(); else caseBlocks();
  if (!blocks.length) return;

  // 章节案例课程（课堂完整版）
  function caseBlocks() {
    const caseOf = (el) => {
      const own = el.getAttribute('data-prepost') || el.getAttribute('data-poll-id');
      if (own) return own.replace('case-', '');
      const section = el.closest('[id^="case-"]');
      const match = section && section.id.match(/^case-(\d{2})/);
      return match ? match[1] : null;
    };
    const refOf = (caseNo) => { const section = document.querySelector(`section.ix-prepost[data-prepost="case-${caseNo}"]`); return section ? section.dataset.reference : null; };
    document.querySelectorAll('section.classroom-poll[data-poll-id]').forEach((section) => {
      const caseNo = caseOf(section);
      addBlock(section.querySelector('.poll-options'), {
        kind: 'poll', case: caseNo, item: 'pre', ref: refOf(caseNo),
        options: Array.from(section.querySelectorAll('.poll-option-copy')).map((el, index) => ({ key: String(index + 1), label: text(el.querySelector('span')), text: text(el.querySelector('strong')) })),
      });
    });
    document.querySelectorAll('section.ix-prepost[data-prepost]').forEach((section) => {
      addBlock(section.querySelector('.prepost-rows'), {
        kind: 'prepost', case: caseOf(section), ref: section.dataset.reference || null,
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
          return { item: `match-${index + 1}`, text: text(cell), answer: row.dataset.answer || '', accept: (row.dataset.accept || '').match(/\d/g) || [] };
        }),
      });
    });
    // 迁移任务“选一选”：参考 K 与可以成立的 K 都算对
    document.querySelectorAll('[data-transfer-choice]').forEach((box) => {
      addBlock(box.querySelector('.transfer-options'), {
        kind: 'poll', case: caseOf(box), item: 'transfer-k', ref: box.dataset.answer || null,
        accept: (box.dataset.accept || '').split(',').filter(Boolean),
        options: Array.from(box.querySelectorAll('.transfer-options li')).map((li) => ({ key: li.dataset.k, label: li.dataset.k, text: text(li.querySelector('strong')) })),
      });
    });
    document.querySelectorAll('section.ix-sim[data-sim]').forEach((section) => {
      const caseNo = caseOf(section);
      section.querySelectorAll('article.sim-round[data-sim-round]').forEach((round) => {
        const options = Array.from(round.querySelectorAll('.sim-option')).map((el) => ({ key: text(el.querySelector('span')), label: text(el.querySelector('span')), text: text(el.querySelector('strong')), reference: el.dataset.reference === 'true' }));
        addBlock(round.querySelector('.sim-options'), {
          kind: 'sim', case: caseNo, item: `sim-${round.getAttribute('data-sim-round')}`, options,
          ref: (options.find((option) => option.reference) || {}).key || null,
        });
      });
    });
  }

  // 概念学习课程（讲解版）：参考答案取自本页数据（教师端加密页面）
  function conceptBlocks() {
    const node = document.getElementById('concept-data');
    const D = node ? JSON.parse(node.textContent) : { concepts: [], exit: [] };
    const optionsOf = (root) => Array.from(root.querySelectorAll('.cl-option')).map((el, index) => ({
      key: String(index), label: text(el.querySelector('.cl-letter')) || String.fromCharCode(65 + index), text: text(el.querySelector('.cl-option-text')) }));
    const toNumber = (value) => { const s = String(value == null ? '' : value).trim(); return s ? Number(s.replace(/[％%\s]/g, '').replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))) : NaN; };
    const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
    (D.concepts || []).forEach((k) => {
      const unitEl = document.querySelector(`.cl-unit[data-concept="${k.id}"]`);
      if (!unitEl) return;
      const discover = unitEl.querySelector('.cl-mcq[data-kind="discover"]');
      if (discover) addBlock(discover, { kind: 'cl-option', key: `${k.id}.discover`, options: optionsOf(discover), answer: k.discover.answer });
      const step = unitEl.querySelector('[data-step="check"]');
      const judge = step && step.querySelector('.cl-judge');
      const choice = step && step.querySelector('.cl-mcq');
      if (judge) {
        addBlock(judge, { kind: 'cl-judge', key: `${k.id}.check`, answers: (k.check.answers || []).map((a) => (a ? 1 : 0)),
          statements: Array.from(judge.querySelectorAll('.cl-item')).map((el) => text(el.querySelector('.cl-item-text'))) });
      } else if (choice) {
        addBlock(choice, { kind: 'cl-option', key: `${k.id}.check`, options: optionsOf(choice), answer: k.check.answer });
      }
      const apply = unitEl.querySelector('[data-step="apply"]');
      const spec = k.apply || {};
      const sort = apply && apply.querySelector('.cl-sort');
      const fill = apply && apply.querySelector('.cl-fill');
      const calc = apply && apply.querySelector('.cl-calc');
      if (sort && spec.type === 'sort') {
        addBlock(sort, { kind: 'cl-sort', key: `${k.id}.apply`, bins: spec.bins, answers: spec.answers,
          items: Array.from(sort.querySelectorAll('.cl-item')).map((el) => text(el.querySelector('.cl-item-text'))) });
      } else if (fill && spec.type === 'fill') {
        addBlock(fill, { kind: 'cl-values', key: `${k.id}.apply`,
          fields: spec.answers.map((answer, i) => ({ label: `第 ${i + 1} 空`, answer, ok: (v) => String(v).trim() === answer })) });
      } else if (calc && spec.type === 'calc') {
        addBlock(calc.querySelector('.cl-fields') || calc, { kind: 'cl-values', key: `${k.id}.apply`,
          fields: spec.fields.map((f) => ({ label: `${f.label}${f.unit ? `（${f.unit}）` : ''}`, answer: f.answer, ok: (v) => near(toNumber(v), f.answer) })) });
        const challenge = calc.querySelector('.cl-challenge');
        if (challenge && spec.challenge) {
          addBlock(challenge, { kind: 'cl-values', key: `${k.id}.challenge`, single: true,
            fields: [{ label: `变一变${spec.challenge.unit ? `（${spec.challenge.unit}）` : ''}`, answer: spec.challenge.answer, ok: (v) => near(toNumber(v), spec.challenge.answer) }] }, 'beforeend');
        }
      }
      const explain = unitEl.querySelector('[data-step="explain"] textarea');
      if (explain) addBlock(explain, { kind: 'cl-count', key: `${k.id}.explain`, label: '递交了“一句话说清”' });
    });
    const chain = document.querySelector('.cl-chain');
    if (chain && D.chain && Array.isArray(config.chainPerm)) {
      addBlock(chain, { kind: 'cl-chain', key: 'chain', texts: D.chain.texts || [], perm: config.chainPerm });
    }
    const disc = document.querySelector('.cl-disc-work');
    if (disc) {
      addBlock(disc.querySelector('.cl-stance'), { kind: 'cl-stance', key: 'discussion',
        stances: Array.from(disc.querySelectorAll('.cl-stance input')).map((input) => input.value) });
      const later = disc.querySelector('textarea[data-cl-text="discussion.after"]');
      if (later) addBlock(later, { kind: 'cl-count', key: 'discussion.after', label: '递交了讨论后的补充' });
    }
    const exitList = document.querySelector('.cl-exit .cl-exit-list');
    if (exitList) {
      addBlock(exitList, { kind: 'cl-exit', key: 'exit',
        questions: Array.from(exitList.querySelectorAll('.cl-exit-item')).map((el, i) => {
          // 题干去掉前面的“概念 N · 名称”标签
          const legend = el.querySelector('legend').cloneNode(true);
          legend.querySelectorAll('.cl-exit-tag').forEach((tag) => tag.remove());
          return { prompt: text(legend), options: optionsOf(el), answer: ((D.exit || [])[i] || {}).answer };
        }) });
    }
  }

  // ---------- 数据 ----------
  let room = null;
  let status = '连接中……';
  let counts = new Map();   // 章节案例课程："案例|项目" → Map(选项 → 人数)
  let answers = [];         // 概念学习课程：每位学生 {题目编号: 作答}（每题取第一次递交）
  const tally = (caseNo, item) => counts.get(`${caseNo}|${item}`) || new Map();
  const total = (map) => Array.from(map.values()).reduce((a, b) => a + b, 0);
  const valuesOf = (key) => answers.filter((row) => Object.prototype.hasOwnProperty.call(row, key)).map((row) => row[key]);

  const bar = (count, all, cls) => `<span class="lv-bar ${cls || ''}"><i style="width:${pct(count, all)}%"></i></span>`;
  const star = (on) => (on ? '<span class="lv-ref" title="参考答案">★</span> ' : '');
  const rateLine = (right, all, extra) => `<p class="lv-rate">正确率 ${pct(right, all)}%（${right}/${all}）${extra || ''}</p>`;
  const optionRows = (options, map, all, ref) => options.map((option) => {
    const n = map.get(option.key) || 0;
    return `<div class="lv-row"><span class="lv-label">${star(ref != null && String(ref) === option.key)}<b>${esc(option.label)}</b>${esc(option.text)}</span>${bar(n, all)}<span class="lv-num">${n} 人 · ${pct(n, all)}%</span></div>`;
  }).join('');
  const countMap = (list) => { const map = new Map(); list.forEach((value) => map.set(String(value), (map.get(String(value)) || 0) + 1)); return map; };

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
    toggle.hidden = block.kind === 'cl-count';
    body.hidden = !block.open;
    const html = CONCEPT ? conceptView(block, countEl) : caseView(block, countEl);
    if (block.open && html !== null) body.innerHTML = html;
  }

  function caseView(block, countEl) {
    if (block.kind === 'poll' || block.kind === 'sim') {
      const map = tally(block.case, block.item);
      const all = total(map);
      countEl.textContent = `已递交 ${all} 人`;
      if (!block.open) return null;
      const accept = block.accept || [];
      const right = (map.get(String(block.ref)) || 0) + accept.reduce((n, key) => n + (map.get(key) || 0), 0);
      return (block.ref ? rateLine(right, all, accept.length ? `　（★参考 ${esc(block.ref)}，${accept.map(esc).join('、')} 也可以成立）` : '') : '') + optionRows(block.options, map, all, block.ref);
    }
    if (block.kind === 'prepost') {
      const pre = tally(block.case, 'pre');
      const post = tally(block.case, 'post');
      const preAll = total(pre);
      const postAll = total(post);
      countEl.textContent = `前测 ${preAll} 人 · 后测 ${postAll} 人`;
      if (!block.open) return null;
      const ref = block.ref;
      return (ref ? `<p class="lv-rate">选中参考答案：前测 ${pct(pre.get(ref) || 0, preAll)}% → 后测 ${pct(post.get(ref) || 0, postAll)}%</p>` : '')
        + '<div class="lv-legend"><span><i class="is-pre"></i>前测</span><span><i></i>后测</span></div>' + block.options.map((option) => {
          const a = pct(pre.get(option.key) || 0, preAll);
          const b = pct(post.get(option.key) || 0, postAll);
          const delta = b - a;
          return `<div class="lv-row is-pair"><span class="lv-label">${star(ref === option.key)}<b>${esc(option.label)}</b>${esc(option.text)}</span>${bar(pre.get(option.key) || 0, preAll, 'is-pre')}${bar(post.get(option.key) || 0, postAll)}
            <span class="lv-num">${a}% → ${b}%（${delta > 0 ? '+' : ''}${delta}）</span></div>`;
        }).join('');
    }
    if (block.kind === 'match') {
      const answered = Math.max(0, ...block.clues.map((clue) => total(tally(block.case, clue.item))));
      countEl.textContent = `已递交 ${answered} 人`;
      if (!block.open) return null;
      return `<table class="lv-table"><thead><tr><th>事实线索</th>${[1, 2, 3, 4].map((k) => `<th>K${k}</th>`).join('')}<th>人数</th><th>对应参考</th><th>错误率</th></tr></thead><tbody>${block.clues.map((clue) => {
        const map = tally(block.case, clue.item);
        const all = total(map);
        const alt = clue.accept.reduce((sum, k) => sum + (map.get('K' + k) || 0), 0);
        // 错误：既不是参考对应、也不是可以成立的答案
        const wrong = Math.max(0, all - (map.get('K' + clue.answer) || 0) - alt);
        return `<tr><td>${esc(clue.text)}</td>${[1, 2, 3, 4].map((k) => {
          const n = map.get('K' + k) || 0;
          const cls = String(k) === clue.answer ? 'is-ref' : clue.accept.includes(String(k)) ? 'is-alt' : '';
          return `<td class="${cls}">${n}<small>${pct(n, all)}%</small></td>`;
        }).join('')}<td>${all}</td><td>${pct(map.get('K' + clue.answer) || 0, all)}%${clue.accept.length ? `<small>可成立 ${pct(alt, all)}%</small>` : ''}</td>
          <td class="lv-wrong${all && pct(wrong, all) >= WRONG_ALERT ? ' is-high' : ''}">${pct(wrong, all)}%<small>${wrong} 人</small></td></tr>`;
      }).join('')}</tbody></table><p class="lv-note">深色格为参考对应，浅色格为也可以成立的答案。错误率＝选了其他理论要点的人数比例（参考对应和可以成立的都不算错）；${WRONG_ALERT}% 及以上标红，值得重点讲评。</p>`;
    }
    return null;
  }

  function conceptView(block, countEl) {
    if (block.kind === 'cl-exit') {
      const lists = block.questions.map((_, i) => valuesOf(`exit.${i}`));
      const full = answers.filter((row) => block.questions.every((_, i) => Object.prototype.hasOwnProperty.call(row, `exit.${i}`))).length;
      countEl.textContent = `已递交 ${Math.max(0, ...lists.map((list) => list.length))} 人 · 全部 ${block.questions.length} 题都递交 ${full} 人`;
      if (!block.open) return null;
      const width = Math.max(...block.questions.map((q) => q.options.length));
      const letters = Array.from({ length: width }, (_, i) => String.fromCharCode(65 + i));
      return `<table class="lv-table"><thead><tr><th>题目</th>${letters.map((l) => `<th>${l}</th>`).join('')}<th>人数</th><th>正确率</th></tr></thead><tbody>${block.questions.map((q, i) => {
        const map = countMap(lists[i]);
        const all = lists[i].length;
        return `<tr><td>${i + 1}. ${esc(short(q.prompt, 28))}</td>${letters.map((_, j) => {
          if (j >= q.options.length) return '<td></td>';
          const n = map.get(String(j)) || 0;
          return `<td class="${j === q.answer ? 'is-ref' : ''}">${n}<small>${pct(n, all)}%</small></td>`;
        }).join('')}<td>${all}</td><td>${pct(map.get(String(q.answer)) || 0, all)}%</td></tr>`;
      }).join('')}</tbody></table><p class="lv-note">深色格为正确答案。</p>`;
    }
    const list = valuesOf(block.key);
    const all = list.length;
    countEl.textContent = block.kind === 'cl-count' ? `${all} 人${block.label}` : `已递交 ${all} 人`;
    if (!block.open || block.kind === 'cl-count') return null;
    if (block.kind === 'cl-option') {
      const map = countMap(list);
      return rateLine(map.get(String(block.answer)) || 0, all) + optionRows(block.options, map, all, block.answer);
    }
    if (block.kind === 'cl-stance') {
      const map = countMap(list.map((value) => (value && value.stance) || ''));
      return optionRows(block.stances.map((s) => ({ key: s, label: '', text: s })), map, all, null);
    }
    if (block.kind === 'cl-judge') {
      const perfect = list.filter((values) => Array.isArray(values) && block.answers.every((a, i) => values[i] === a)).length;
      return rateLine(perfect, all, ' · 全部判断正确') + '<div class="lv-legend"><span><i></i>说得对</span><span><i class="is-pre"></i>说得不对</span></div>' + block.statements.map((statement, i) => {
        const yes = list.filter((values) => Array.isArray(values) && values[i] === 1).length;
        const no = list.filter((values) => Array.isArray(values) && values[i] === 0).length;
        const right = block.answers[i] === 1 ? yes : no;
        return `<div class="lv-row is-pair"><span class="lv-label" title="${esc(statement)}"><b>${i + 1}</b><span class="lv-ref">${block.answers[i] === 1 ? '✓' : '✗'}</span> ${esc(statement)}</span>${bar(yes, yes + no)}${bar(no, yes + no, 'is-pre')}
          <span class="lv-num">对 ${yes} · 不对 ${no} · 正确率 ${pct(right, yes + no)}%</span></div>`;
      }).join('');
    }
    if (block.kind === 'cl-sort') {
      const perfect = list.filter((values) => Array.isArray(values) && block.answers.every((a, i) => values[i] === a)).length;
      return rateLine(perfect, all, ' · 全部分对') + `<table class="lv-table"><thead><tr><th>项目</th>${block.bins.map((b) => `<th>${esc(b)}</th>`).join('')}<th>正确率</th></tr></thead><tbody>${block.items.map((item, i) => {
        const picks = list.map((values) => (Array.isArray(values) ? values[i] : null)).filter((v) => v !== null && v !== undefined);
        const map = countMap(picks);
        return `<tr><td>${esc(short(item, 24))}</td>${block.bins.map((_, j) => {
          const n = map.get(String(j)) || 0;
          return `<td class="${j === block.answers[i] ? 'is-ref' : ''}">${n}<small>${pct(n, picks.length)}%</small></td>`;
        }).join('')}<td>${pct(map.get(String(block.answers[i])) || 0, picks.length)}%</td></tr>`;
      }).join('')}</tbody></table>`;
    }
    if (block.kind === 'cl-values') {
      return block.fields.map((field, i) => {
        const picks = list.map((values) => (block.single ? values : Array.isArray(values) ? values[i] : null)).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
        const right = picks.filter((v) => field.ok(v)).length;
        const top = Array.from(countMap(picks.map((v) => String(v).trim())).entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
        return `<div class="lv-field"><div><span>${esc(field.label)}　<span class="lv-ref">★ ${esc(field.answer)}</span></span><b>正确率 ${pct(right, picks.length)}%（${right}/${picks.length}）</b></div>
          <div class="lv-values">${top.map(([value, n]) => `<span class="${field.ok(value) ? 'is-ok' : ''}">${esc(value)} · ${n} 人</span>`).join('')}</div></div>`;
      }).join('');
    }
    if (block.kind === 'cl-chain') {
      // 学生页的第 i 句是正确顺序中的第 perm[i] 句
      const orders = list.filter((order) => Array.isArray(order) && order.length === block.perm.length);
      const perfect = orders.filter((order) => order.every((id, pos) => block.perm[id] === pos)).length;
      return rateLine(perfect, orders.length, ' · 全部排对') + block.texts.map((sentence, pos) => {
        const right = orders.filter((order) => block.perm[order[pos]] === pos).length;
        return `<div class="lv-row"><span class="lv-label" title="${esc(sentence)}"><b>${pos + 1}</b>${esc(sentence)}</span>${bar(right, orders.length)}<span class="lv-num">放对 ${right} 人 · ${pct(right, orders.length)}%</span></div>`;
      }).join('');
    }
    return null;
  }
  function render() { blocks.forEach(renderBlock); }

  async function loadRoom() {
    try {
      const rooms = await backend.fetchAll('classrooms', { course: config.course });
      room = window.ClassLive.pickRoom(rooms, config.course, chapter);
      if (!room) status = '还没有发布课堂，发布后这里显示学生的递交结果。';
      else if (room.chapter !== chapter) status = `当前课堂“${esc(room.name)}”不是${HERE}，这里暂不显示学生结果。`;
      else status = '';
      if (!room || String(room.id) !== homeworkRoom) { homeworkRoom = room ? String(room.id) : ''; known.clear(); cursor = null; answers = []; }
    } catch (error) {
      room = null;
      status = '请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>，再刷新本页。';
    }
  }
  let lastLoad = 0;
  // 概念学习课程：读作业（只取有变化的行）；同一学号多行时合并，每题取最早递交的
  let homeworkRoom = '';
  let cursor = null;
  const known = new Map();
  const millis = (value) => Date.parse(String(value || '').replace(/(\.\d{3})\d+/, '$1'));
  async function loadHomework() {
    const rows = await backend.fetchAll('homework', { classroom: Number(room.id) }, cursor ? { since: ['updated_at', cursor] } : {});
    rows.forEach((row) => known.set(String(row.id), row));
    const latest = Math.max(0, ...Array.from(known.values()).map((row) => millis(row.updated_at)).filter(Number.isFinite));
    cursor = latest ? new Date(latest - 60000).toISOString() : null;
    const bySid = new Map();
    Array.from(known.values()).forEach((row) => {
      const merged = bySid.get(row.sid) || {};
      Object.entries(row.payload || {}).forEach(([key, entry]) => {
        if (!entry || typeof entry !== 'object' || !('v' in entry)) return;
        if (!merged[key] || millis(entry.at) < millis(merged[key].at)) merged[key] = entry;
      });
      bySid.set(row.sid, merged);
    });
    answers = Array.from(bySid.values()).map((merged) => Object.fromEntries(Object.entries(merged).map(([key, entry]) => [key, entry.v])));
  }
  async function loadChoices(force) {
    if (!room || status) return;
    // 页面在后台时降为每 30 秒一次，切回前台立即刷新
    if (!force && document.hidden && Date.now() - lastLoad < HIDDEN_MS) return;
    lastLoad = Date.now();
    if (CONCEPT) {
      try { await loadHomework(); } catch (error) { console.warn('[实时结果]', error); }
      return;
    }
    try {
      // 每题只收第一次递交；更早的旧记录可能有改选，取最新一条
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

  // ---------- 离线版：导入学生导出的文件 ----------
  function offlineImport() {
    const STORE_KEY = `classlive-import:${config.course}:${chapter}`;
    const dataNode = document.getElementById('concept-data');
    const pollSpec = dataNode ? (JSON.parse(dataNode.textContent).poll || null) : null;
    const bar = document.createElement('div');
    bar.className = 'lv-import';
    bar.setAttribute('data-ix', '');
    bar.innerHTML = '<span data-lv-import-state></span><label>导入学生文件<input type="file" accept=".html,.htm,text/html" multiple data-lv-files></label>'
      + '<button type="button" data-lv-clear>清空</button>';
    ['click', 'keydown', 'keyup'].forEach((type) => bar.addEventListener(type, (event) => event.stopPropagation()));
    document.body.appendChild(bar);
    const stateEl = bar.querySelector('[data-lv-import-state]');
    let students = {};   // 学号 → { name, class_name, answers: {题目编号: {v, at}} }
    try { students = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (error) { students = {}; }
    const apply = (notice) => {
      const list = Object.values(students);
      if (CONCEPT) {
        answers = list.map((row) => Object.fromEntries(Object.entries(row.answers).map(([key, entry]) => [key, entry.v])));
      } else {
        // 章节案例：{"01:pre": "2", "01:match": ["1","3",…], "01:sim-1": "B", …} → 各题选项人数
        const next = new Map();
        const add = (key, value) => { const map = next.get(key) || new Map(); map.set(String(value), (map.get(String(value)) || 0) + 1); next.set(key, map); };
        list.forEach((row) => Object.entries(row.answers).forEach(([key, entry]) => {
          const [caseNo, item] = key.split(':');
          if (item === 'match' && Array.isArray(entry.v)) entry.v.forEach((value, i) => { if (value) add(`${caseNo}|match-${i + 1}`, `K${value}`); });
          else if (/^(pre|post|sim-\d+|transfer-k)$/.test(item)) add(`${caseNo}|${item}`, entry.v);
        }));
        counts = next;
      }
      status = list.length ? '' : '离线统计：点右下角“导入学生文件”，选择学生发来的导出文件（可一次选多个）。';
      // 案例 01 的课堂投票（讲解版里没有投票区块，结果显示在这里）
      let poll = '';
      if (CONCEPT && pollSpec && list.length) {
        const votes = list.map((row) => row.answers.poll && row.answers.poll.v).filter(Boolean);
        poll = ` · 课堂投票：${(pollSpec.options || []).map((o) => `${o.label} ${votes.filter((v) => v === o.value).length} 人`).join('，')}`;
      }
      stateEl.textContent = list.length ? `离线统计：已导入 ${list.length} 人${poll}${notice ? ' · ' + notice : ''}` : `离线统计${notice ? '：' + notice : ''}`;
      render();
    };
    const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(students)); } catch (error) { /* 文件太多时只保留在本次打开的页面里 */ } };
    const parse = (html) => {
      const node = new DOMParser().parseFromString(html, 'text/html').getElementById('classlive-export');
      return node ? JSON.parse(node.textContent) : null;
    };
    bar.querySelector('[data-lv-files]').addEventListener('change', async (event) => {
      let added = 0;
      const skipped = [];
      for (const file of Array.from(event.target.files || [])) {
        try {
          const data = parse(await file.text());
          if (!data || data.format !== 'classlive-export') { skipped.push(`${file.name}（不是导出的作答文件）`); continue; }
          if (data.course !== config.course || data.unit !== chapter) { skipped.push(`${file.name}（不是本页的${CONCEPT ? '案例' : '章节'}）`); continue; }
          const sid = String((data.student && data.student.sid) || '').trim() || `未填学号:${(data.student && data.student.name) || file.name}`;
          const row = students[sid] || { name: (data.student && data.student.name) || '', class_name: (data.student && data.student.class_name) || '', answers: {} };
          // 每题只算第一次递交：同一学号多份文件时取最早的
          Object.entries(data.answers || {}).forEach(([key, entry]) => {
            const old = row.answers[key];
            if (!old || (entry.at && old.at && entry.at < old.at)) row.answers[key] = entry;
          });
          students[sid] = row;
          added += 1;
        } catch (error) {
          skipped.push(`${file.name}（无法读取）`);
        }
      }
      event.target.value = '';
      save();
      apply(`本次读入 ${added} 份${skipped.length ? `，跳过 ${skipped.length} 份` : ''}`);
      if (skipped.length) window.alert(`以下文件没有导入：\n${skipped.join('\n')}`);
    });
    bar.querySelector('[data-lv-clear]').addEventListener('click', () => {
      if (!Object.keys(students).length || !window.confirm('清空本页已导入的学生作答？（学生发来的文件不受影响，可以重新导入）')) return;
      students = {};
      try { localStorage.removeItem(STORE_KEY); } catch (error) { /* 忽略 */ }
      apply('');
    });
    apply('');
  }

  if (OFFLINE) { offlineImport(); return; }

  (async () => {
    const session = await backend.session().catch(() => null);
    if (!session || session.anonymous) {
      status = '请先<a href="/teacher/" target="_blank" rel="noopener">登录教师工作台</a>，再刷新本页，即可显示学生的递交结果。';
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
