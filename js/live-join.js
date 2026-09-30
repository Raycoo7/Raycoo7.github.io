/* 学生登录（首页）：填写课堂码和个人信息 → 后台核对课堂码（ck_join）→ 记录加入 → 打开本周章节。
 * 章节页各自加密，ck_join 只在课堂码有效时返回该章节的解密值，页面凭它自动打开（并记住 30 天）。
 * 需要页面先加载 live-core.js，并设置 window.CLASS_LIVE_CONFIG。
 */
(function () {
  'use strict';
  const form = document.querySelector('[data-join-form]');
  if (!form) return;
  const config = window.CLASS_LIVE_CONFIG || { provider: 'off' };
  const field = (name) => form.elements[name];
  const errorBox = form.querySelector('[data-join-error]');
  const button = form.querySelector('[type=submit]');
  const STORE = 'classlive-student';
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null') || {}; } catch (error) { return {}; } };
  const save = (value) => { try { localStorage.setItem(STORE, JSON.stringify(value)); } catch (error) { /* 无痕模式等情况下忽略 */ } };
  const showError = (message, focus) => { errorBox.textContent = message; if (focus) focus.focus(); };

  let backend = null;
  try { backend = window.ClassLive && window.ClassLive.create(config); } catch (error) { console.warn('[课堂后台]', error.message); }
  if (!backend) {
    showError('课堂后台尚未开通，暂时无法登录。请联系任课教师。');
    button.disabled = true;
    return;
  }
  const normalize = window.ClassLive.normalizeCode;

  // 预填：加入链接 ?join=课堂码，其余信息沿用这台设备上次填写的内容
  const saved = load();
  const params = new URLSearchParams(location.search);
  field('code').value = normalize(params.get('join') || '');
  ['name', 'sid', 'class_name', 'group_name'].forEach((key) => { if (saved[key]) field(key).value = saved[key]; });
  field('agree').checked = Boolean(saved.agreed);
  field('code').addEventListener('input', () => {
    const input = field('code');
    const position = input.selectionStart;
    input.value = input.value.toUpperCase();
    input.setSelectionRange(position, position);
  });
  setTimeout(() => (field('code').value ? field('name') : field('code')).focus(), 50);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = normalize(field('code').value);
    const name = field('name').value.trim();
    const sid = field('sid').value.trim();
    const className = field('class_name').value.trim();
    const groupName = field('group_name').value.trim();
    if (!/^[A-Z0-9]{8}$/.test(code)) return showError('课堂码是 8 位字母和数字，请核对老师公布的课堂码', field('code'));
    if (name.length < 2) return showError('请填写真实姓名', field('name'));
    if (!/^[A-Za-z0-9]{4,20}$/.test(sid)) return showError('学号应为 4—20 位数字或字母', field('sid'));
    if (!className) return showError('请填写班级', field('class_name'));
    if (!field('agree').checked) return showError('请先阅读并勾选数据使用说明');
    showError('');
    button.disabled = true;
    button.textContent = '正在核对课堂码……';
    let leaving = false;
    try {
      await backend.ensureAnonymous();
      const rows = await backend.rpc('ck_join', { p_code: code });
      const room = Array.isArray(rows) ? rows[0] : rows;
      if (!room) {
        showError('课堂码不正确，或这个课堂已经停止开放。请核对老师公布的最新课堂码。', field('code'));
        return;
      }
      await backend.add('checkins', {
        course: room.course, classroom: room.classroom, session: window.ClassLive.today(),
        name, sid, class_name: className, group_name: groupName || null, page: room.chapter, path: location.pathname,
      });
      save({
        code, name, sid, class_name: className, group_name: groupName, agreed: true,
        course: room.course, chapter: room.chapter, classroom: room.classroom, classroom_name: room.name, joined_at: Date.now(),
      });
      leaving = true;
      button.textContent = '正在进入课堂……';
      location.href = `/${room.course}/cases/${room.chapter}.html` + (room.pwd_hash ? `#staticrypt_pwd=${room.pwd_hash}&remember_me` : '');
    } catch (problem) {
      console.error(problem);
      showError(window.ClassLive.isClosedError(problem)
        ? '这个课堂刚刚停止开放，请核对老师公布的最新课堂码。'
        : '登录没有成功，请检查网络后再试一次。');
    } finally {
      if (!leaving) {
        button.disabled = false;
        button.textContent = '登录并进入课堂 →';
      }
    }
  });
})();
