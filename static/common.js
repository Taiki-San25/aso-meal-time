/* 共通ヘルパー: API・モーダル・トースト */
window.AMT = (function () {
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, init);
    if (r.status === 401 && url !== '/api/login') { location.href = '/login'; throw new Error('401'); }
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      let msg = '通信エラーが発生しました';
      if (data && typeof data.detail === 'string') msg = data.detail;
      else if (data && Array.isArray(data.detail)) msg = data.detail.map(d => String(d.msg).replace(/^Value error, /, '')).join(' / ');
      toast(msg, true);
      throw new Error(msg);
    }
    return data;
  }

  let toastTimer;
  function toast(msg, isError) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3000);
  }

  // buttons: [{label, primary, danger, left, onClick}] — onClick が false を返すか例外なら閉じない
  // onClose: 閉じ方に関わらず閉じたときに1回呼ばれる
  function modal({ title, body, buttons = [], wide, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'modalWrap';
    wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modalHead"><h2>${esc(title)}</h2><button class="iconBtn" data-close aria-label="閉じる"><i class="ti ti-x"></i></button></div>
      <div class="modalBody">${body}</div>
      <div class="modalFoot"></div></div>`;
    const foot = wrap.querySelector('.modalFoot');
    const close = () => {
      if (!wrap.isConnected) return;
      wrap.remove(); document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const isTop = () => [...document.querySelectorAll('.modalWrap')].pop() === wrap;
    const onKey = e => { if (e.key === 'Escape' && isTop()) close(); };
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      if (b.left) btn.style.marginRight = 'auto';
      btn.textContent = b.label;
      btn.addEventListener('click', async () => {
        if (!b.onClick) return close();
        btn.disabled = true;
        try { if ((await b.onClick()) !== false) close(); } catch (e) { /* toast 済み */ }
        btn.disabled = false;
      });
      foot.appendChild(btn);
    });
    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);
    const form = wrap.querySelector('form');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); foot.querySelector('.primary')?.click(); });
    document.body.appendChild(wrap);
    wrap.querySelector('input,select,textarea')?.focus();
    wrap.close = close;
    return wrap;
  }

  return { esc, api, toast, modal, isModalOpen: () => !!document.querySelector('.modalWrap') };
})();

/* common.js — 上部バー・サイドバーを生成し、body直下の要素を #mainContent に移す */
(function () {
  const CONFIG = {
    siteName: '阿蘇リゾートグランヴィリオホテル　喫食時間管理表',
    favicon: null,          // 未定: 決まったら '/static/favicon.png' などに差し替え
    ticker: '',             // お知らせ(空なら非表示)
    topButtons: [
      { label: 'パスワード変更', icon: 'ti-key', type: 'normal', href: '#password' },
      { label: 'ログアウト', icon: 'ti-logout', type: 'normal', href: '/logout' }
    ],
    mainMenu: [
      { label: '夕食時間管理表', icon: 'ti-moon', href: '/dinner' },
      { label: '朝食時間管理表', icon: 'ti-sun', href: '/breakfast' }
    ],
    adminMenu: {
      heading: '管理者メニュー',
      items: [{ label: '管理者ページ', icon: 'ti-settings', href: '/admin' }]
    }
  };
  const LS_KEY = 'sidebarCollapsed';
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pageNodes = Array.from(document.body.childNodes)
    .filter(n => !(n.nodeType === 1 && n.tagName === 'SCRIPT'));

  const path = location.pathname.replace(/\/$/, '') || '/';
  const navRow = (it, admin) => {
    const active = path === it.href;
    return `<a class="navRow${admin ? ' adminPage' : ''}${active ? ' navRowActive' : ''}" href="${it.href}">
      <i class="ti ${it.icon}"></i><span class="lbl">${esc(it.label)}</span>
      ${it.badge ? `<span class="badge">${it.badge}</span>` : ''}</a>`;
  };

  // 上部バー
  const topbar = document.createElement('header');
  topbar.id = 'topbar';
  topbar.innerHTML = `
    <div class="tbLeft">
      <button id="hamburger" aria-label="メニューを開く"><i class="ti ti-menu-2"></i></button>
      ${CONFIG.favicon
        ? `<img class="tbFavicon" src="${CONFIG.favicon}" alt="">`
        : `<div class="tbFaviconPh" aria-hidden="true">未定</div>`}
      <div class="tbLogo">${esc(CONFIG.siteName)}</div>
    </div>
    ${CONFIG.ticker ? `<div class="ticker"><i class="ti ti-speakerphone"></i><span>${esc(CONFIG.ticker)}</span></div>` : ''}
    <div class="tbRight">
      ${CONFIG.topButtons.map(b => `<a class="pillBtn ${b.type}" href="${b.href}" title="${esc(b.label)}" style="text-decoration:none"><i class="ti ${b.icon}"></i><span class="btnLbl">${esc(b.label)}</span></a>`).join('')}
    </div>`;

  // サイドバー
  const sidebar = document.createElement('nav');
  sidebar.id = 'sidebar';
  sidebar.innerHTML = `
    <div class="sbTop">
      <div id="accountRow">
        <div class="avatar"></div>
        <div class="userName"></div>
        <button id="collapseBtn" aria-label="サイドバーを格納"><i class="ti ti-arrow-left"></i></button>
      </div>
      <div class="navGroup">
        ${CONFIG.mainMenu.map(it => navRow(it, false)).join('')}
        <div class="navHeading" id="adminHeading">${esc(CONFIG.adminMenu.heading)}<i class="ti ti-chevron-down"></i></div>
        <div class="navSection" id="adminSection">${CONFIG.adminMenu.items.map(it => navRow(it, true)).join('')}</div>
      </div>
    </div>`;

  const main = document.createElement('main');
  main.id = 'mainContent';
  pageNodes.forEach(n => main.appendChild(n));

  const backdrop = document.createElement('div');
  backdrop.id = 'drawerBackdrop';

  document.body.prepend(topbar, sidebar, backdrop, main);

  // ユーザー名・管理者メニュー
  const setUser = name => {
    sidebar.querySelector('.avatar').textContent = name.charAt(0);
    sidebar.querySelector('.userName').textContent = name;
  };
  setUser('…');
  const adminEls = [document.getElementById('adminHeading'), document.getElementById('adminSection')];
  adminEls.forEach(el => { el.hidden = true; });
  AMT.me = AMT.api('/api/me').then(d => {
    setUser(d.name);
    adminEls.forEach(el => { el.hidden = !d.is_admin; });
    return d;
  });

  // 格納
  const collapseBtn = document.getElementById('collapseBtn');
  const applyCollapsed = c => {
    document.body.classList.toggle('sbCollapsed', c);
    collapseBtn.querySelector('i').className = 'ti ' + (c ? 'ti-arrow-right' : 'ti-arrow-left');
    collapseBtn.setAttribute('aria-label', c ? 'サイドバーを展開' : 'サイドバーを格納');
  };
  applyCollapsed(lsGet(LS_KEY) === '1');
  collapseBtn.addEventListener('click', () => {
    const c = !document.body.classList.contains('sbCollapsed');
    applyCollapsed(c); lsSet(LS_KEY, c ? '1' : '0');
  });

  // 管理者見出しの開閉
  document.getElementById('adminHeading').addEventListener('click', e => {
    e.currentTarget.classList.toggle('closed');
    document.getElementById('adminSection').classList.toggle('closed');
  });

  // ハンバーガー(640px以下)
  document.getElementById('hamburger').addEventListener('click', () => document.body.classList.toggle('drawerOpen'));
  backdrop.addEventListener('click', () => document.body.classList.remove('drawerOpen'));

  // パスワード変更
  topbar.querySelector('a[href="#password"]').addEventListener('click', e => {
    e.preventDefault();
    const m = AMT.modal({
      title: 'パスワード変更',
      body: `<form class="form">
        <label>現在のパスワード<input type="password" name="current" required autocomplete="current-password"></label>
        <label>新しいパスワード(8文字以上)<input type="password" name="new" required minlength="8" autocomplete="new-password"></label>
        <label>新しいパスワード(確認)<input type="password" name="confirm" required minlength="8" autocomplete="new-password"></label>
      </form>`,
      buttons: [{ label: 'キャンセル' }, {
        label: '変更する', primary: true, onClick: async () => {
          const f = m.querySelector('form');
          if (!f.reportValidity()) return false;
          if (f.new.value !== f.confirm.value) { AMT.toast('確認用パスワードが一致しません', true); return false; }
          await AMT.api('/api/me/password', { method: 'POST', body: { current: f.current.value, new: f.new.value } });
          AMT.toast('パスワードを変更しました');
        }
      }]
    });
  });
})();
