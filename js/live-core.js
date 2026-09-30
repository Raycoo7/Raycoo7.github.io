/* 课堂后台适配层
 * provider:
 *   cloudbase —— 腾讯云开发（上海）PostgreSQL 模式；学生匿名登录，教师账号密码登录
 *   mock      —— 本机测试用，数据存在浏览器 localStorage，只允许在 localhost 使用
 *   off       —— 不连接后台（页面照常可用，选择与作答只保存在本机）
 * 三张表：签到 ck_checkins、选择 ck_choices、作答 ck_answers（只增不改，教师端取每人最新一条）
 */
(function () {
  'use strict';
  const COLLECTIONS = { checkins: 'ck_checkins', choices: 'ck_choices', answers: 'ck_answers' };

  // 以北京时间的日期作为“这节课”的标识，例如 2026-09-30
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

  const unwrap = (result) => {
    if (result && result.error) throw result.error;
    return result;
  };

  // 腾讯云开发 PostgreSQL 模式（JS SDK v3）：三张表 ck_checkins / ck_choices / ck_answers，
  // 行级安全策略保证学生只能新增、教师账号才能读取和删除（见 tools/cloudbase-pg.sql）。
  function cloudbaseProvider(config) {
    if (!window.cloudbase) throw new Error('未加载 CloudBase SDK');
    const app = window.cloudbase.init({ env: config.env, region: config.region || 'ap-shanghai' });
    const auth = typeof app.auth === 'function' ? app.auth() : app.auth;
    const db = app.rdb();
    const PAGE = 500;
    const POLL_MS = 5000;
    // SQL 里 case 是保留字，列名用 case_no
    const column = (key) => (key === 'case' ? 'case_no' : key);
    const toRow = (doc) => {
      const row = {};
      Object.entries(doc).forEach(([key, value]) => { row[column(key)] = key === 'choice' ? String(value) : value; });
      return row;
    };
    const fromRow = (row) => ({ ...row, case: row.case_no, ts: Number(row.ts) || Date.parse(row.created_at) || 0 });
    const filtered = (query, where) => Object.entries(where).reduce((q, [key, value]) => q.eq(column(key), value), query);
    const sessionInfo = async () => {
      const result = await auth.getSession();
      const session = result && result.data && result.data.session;
      if (!session || !session.user) return null;
      const user = session.user;
      return {
        uid: user.id || user.sub || user.uid,
        anonymous: Boolean(user.is_anonymous),
        name: (user.user_metadata && (user.user_metadata.username || user.user_metadata.name)) || user.username || user.email || '',
      };
    };

    return {
      name: 'cloudbase',
      session: sessionInfo,
      async ensureAnonymous() {
        const current = await sessionInfo();
        if (current) return current.uid;
        unwrap(await auth.signInAnonymously());
        const created = await sessionInfo();
        return created && created.uid;
      },
      async signInTeacher(username, password) {
        unwrap(await auth.signInWithPassword({ username, password }));
        return sessionInfo();
      },
      async signOut() { unwrap(await auth.signOut()); },
      async add(kind, doc) {
        unwrap(await db.from(COLLECTIONS[kind]).insert(toRow({ ...doc, ts: Date.now() })));
      },
      async fetchAll(kind, where) {
        const rows = [];
        for (let from = 0; ; from += PAGE) {
          const result = unwrap(await filtered(db.from(COLLECTIONS[kind]).select('*'), where).order('id', { ascending: true }).range(from, from + PAGE - 1));
          const batch = result.data || [];
          rows.push(...batch.map(fromRow));
          if (batch.length < PAGE) return rows;
        }
      },
      watch(kind, where, onChange, onError, onStatus) {
        let closed = false;
        let live = false;
        let pending = null;
        let channel = null;
        let realtime = null;
        const refresh = async () => {
          try {
            const rows = await this.fetchAll(kind, where);
            if (!closed) onChange(rows);
          } catch (error) {
            if (onError) onError(error);
          }
        };
        const soon = () => { clearTimeout(pending); pending = setTimeout(refresh, 400); };
        // 实时推送连不上时关闭频道，不让 SDK 反复重连，改由定时刷新兜底
        const dropChannel = () => {
          if (channel && realtime) { try { realtime.removeChannel(channel); } catch (error) { /* 已关闭 */ } }
          channel = null;
        };
        refresh();
        try {
          realtime = app.realtime();
          channel = realtime
            .channel(`${COLLECTIONS[kind]}-${Math.random().toString(36).slice(2, 8)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: COLLECTIONS[kind], filter: `course=eq.${where.course}` }, soon)
            .subscribe((status) => {
              live = status === 'SUBSCRIBED';
              if (onStatus) onStatus(live ? 'live' : 'polling');
              if (live) soon();
              else if (status !== 'CLOSED') dropChannel();
            });
        } catch (error) {
          console.warn('[课堂后台] 实时推送不可用，改为定时刷新：', error);
          if (onStatus) onStatus('polling');
        }
        // 实时推送不可用时，每 5 秒自动刷新一次
        const timer = setInterval(() => { if (!live) refresh(); }, POLL_MS);
        return () => {
          closed = true;
          clearInterval(timer);
          clearTimeout(pending);
          dropChannel();
        };
      },
      async removeAll(kind, where) {
        unwrap(await filtered(db.from(COLLECTIONS[kind]).delete(), where));
      },
    };
  }

  function mockProvider() {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      throw new Error('本机测试后台（mock）只能在 localhost 使用，不能发布');
    }
    const prefix = 'classlive-mock:';
    const read = (kind) => { try { return JSON.parse(localStorage.getItem(prefix + kind) || '[]'); } catch (error) { return []; } };
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('classlive-mock') : null;
    const listeners = new Set();
    const notify = (kind) => listeners.forEach((listener) => { if (listener.kind === kind) listener.fire(); });
    const write = (kind, rows) => {
      localStorage.setItem(prefix + kind, JSON.stringify(rows));
      notify(kind);
      if (channel) channel.postMessage(kind);
    };
    if (channel) channel.onmessage = (event) => notify(event.data);
    window.addEventListener('storage', (event) => {
      if (event.key && event.key.startsWith(prefix)) notify(event.key.slice(prefix.length));
    });
    const matches = (doc, where) => Object.entries(where).every(([key, value]) => doc[key] === value);
    return {
      name: 'mock',
      async session() {
        const teacher = localStorage.getItem(prefix + 'teacher');
        if (teacher) return { uid: 'teacher-' + teacher, anonymous: false, name: teacher };
        const uid = localStorage.getItem(prefix + 'uid');
        return uid ? { uid, anonymous: true, name: '' } : null;
      },
      async ensureAnonymous() {
        let uid = localStorage.getItem(prefix + 'uid');
        if (!uid) { uid = 'anon-' + Math.random().toString(36).slice(2, 10); localStorage.setItem(prefix + 'uid', uid); }
        return uid;
      },
      async signInTeacher(username, password) {
        if (!username || !password) throw new Error('请输入账号和密码');
        localStorage.setItem(prefix + 'teacher', username);
        return this.session();
      },
      async signOut() { localStorage.removeItem(prefix + 'teacher'); },
      async add(kind, doc) {
        const uid = await this.ensureAnonymous();
        const rows = read(kind);
        rows.push({ _id: Math.random().toString(36).slice(2), _openid: uid, ...doc, ts: Date.now() });
        write(kind, rows);
      },
      watch(kind, where, onChange) {
        const listener = { kind, fire: () => onChange(read(kind).filter((doc) => matches(doc, where))) };
        listeners.add(listener);
        listener.fire();
        return () => listeners.delete(listener);
      },
      async fetchAll(kind, where) { return read(kind).filter((doc) => matches(doc, where)); },
      async removeAll(kind, where) { write(kind, read(kind).filter((doc) => !matches(doc, where))); },
    };
  }

  window.ClassLive = window.ClassLive || {};
  Object.assign(window.ClassLive, {
    attached: false,
    today,
    COLLECTIONS,
    create(config) {
      if (!config || config.provider === 'off') return null;
      if (config.provider === 'cloudbase') return cloudbaseProvider(config);
      if (config.provider === 'mock') return mockProvider(config);
      throw new Error('未知的课堂后台：' + config.provider);
    },
    // 每人每项只保留最新一条（按时间）
    latest(docs, keyOf) {
      const map = new Map();
      docs.forEach((doc) => {
        const key = keyOf(doc);
        const current = map.get(key);
        if (!current || (doc.ts || 0) >= (current.ts || 0)) map.set(key, doc);
      });
      return Array.from(map.values());
    },
  });
})();
