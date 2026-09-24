/* common.js — 上部バー・サイドバーを生成し、body直下の要素を #mainContent に移す */
(function () {
  const CONFIG = {
    siteName: '阿蘇リゾートグランヴィリオホテル　喫食時間管理表',
    favicon: null,          // 未定: 決まったら '/static/favicon.png' などに差し替え
    ticker: '',             // お知らせ(空なら非表示)
    topButtons: [
      { label: 'ログアウト', icon: 'ti-logout', type: 'normal', href: '/logout' }
    ],
    mainMenu: [
      { label: '夕食時間管理表', icon: 'ti-moon', href: '/dinner' },
      { label: '朝食時間管理表', icon: 'ti-sun', href: '/breakfast' }
    ],
    adminMenu: {
      heading: '管理者メニュー',
      items: [{ label: '管理者ページ(未定)', icon: 'ti-settings', href: '/admin' }]
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

  // ユーザー名
  const setUser = name => {
    sidebar.querySelector('.avatar').textContent = name.charAt(0);
    sidebar.querySelector('.userName').textContent = name;
  };
  setUser('…');
  fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => d && d.name && setUser(d.name)).catch(() => {});

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
})();
