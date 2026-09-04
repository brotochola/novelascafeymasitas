const CSV_URL = 'telenovelas.csv';

const novelaList = document.querySelector('#novelaList');
const episodeList = document.querySelector('#episodeList');
const novelaHeader = document.querySelector('#novelaHeader');
const player = document.querySelector('#player');
const mobileAccordion = document.querySelector('#mobileAccordion');
const csvFile = document.querySelector('#csvFile');

let novelas = [];
let selectedNovela = null;
let selectedItemIndex = 0;

function normalizeHeader(value) {
  return String(value).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];

    if (c === '"' && quoted && next === '"') {
      cell += '"'; i++; continue;
    }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ',' && !quoted) {
      row.push(cell.trim()); cell = ''; continue;
    }
    if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = ''; continue;
    }
    cell += c;
  }

  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map(values => {
    const obj = {};
    headers.forEach((header, i) => obj[header] = (values[i] || '').trim());
    return obj;
  });
}

function getField(row, ...names) {
  for (const name of names) {
    const key = normalizeHeader(name);
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

function driveImageUrl(url) {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url;
  const match = url.match(/\/file\/d\/([^/]+)/);
  return match ? `https://drive.google.com/thumbnail?id=${match[1]}&sz=w800` : url;
}

function getColumnLinks(row) {
  return Object.keys(row)
    .filter(key => key.startsWith('link_columna'))
    .sort((a, b) => {
      const na = a.match(/(\d+)/);
      const nb = b.match(/(\d+)/);
      if (!na && !nb) return 0;
      if (!na) return 1;
      if (!nb) return -1;
      return Number(na[1]) - Number(nb[1]);
    })
    .map((key, index) => {
      const url = row[key];
      if (!url) return null;
      const match = key.match(/(\d+)/);
      const number = match ? match[1] : String(index + 1);
      return {
        number,
        title: `Capítulo ${number}`,
        url
      };
    })
    .filter(Boolean);
}

function groupNovelas(rows) {
  return rows.map(row => ({
    title: getField(row, 'novela'),
    year: getField(row, 'año', 'anio'),
    channel: getField(row, 'canal'),
    protagonists: getField(row, 'protagonistas'),
    description: getField(row, '¿de que se trata la novela?', 'de que se trata la novela'),
    image: driveImageUrl(getField(row, 'imagen')),
    screenwriter: getField(row, 'guionista'),
    items: getColumnLinks(row)
  })).filter(n => n.title);
}

function youtubeId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
    const embed = parsed.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    if (embed) return embed[1];
    const shorts = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    if (shorts) return shorts[1];
  } catch {
    return '';
  }
  return '';
}

function mediaKind(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/soundcloud\.com/i.test(url)) return 'soundcloud';
  if (/docs\.google\.com/i.test(url)) return 'docs';
  return 'other';
}

function embedSrc(url) {
  const kind = mediaKind(url);
  if (kind === 'youtube') {
    const id = youtubeId(url);
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
  }
  if (kind === 'soundcloud') {
    return 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) + '&color=%237d3038&visual=true';
  }
  return '';
}

function renderPlayer(container, item) {
  if (!container) return;
  if (!item) {
    container.innerHTML = '<p class="empty">Todavía no hay videos para esta novela.</p>';
    return;
  }
  const src = embedSrc(item.url);
  if (src) {
    container.innerHTML = `<iframe class="player-frame" src="${escapeAttr(src)}" title="${escapeAttr(item.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
    return;
  }
  if (mediaKind(item.url) === 'docs') {
    container.innerHTML = `<p class="empty">Esta entrega es un guion, no un video. <a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Ver guion</a></p>`;
    return;
  }
  container.innerHTML = '<p class="empty">No se puede reproducir este enlace acá.</p>';
}

function imageOrPlaceholder(src, className = 'cover') {
  if (!src) return '<span class="' + className + ' placeholder-cover">♥</span>';
  return `<img class="${className}" src="${escapeAttr(src)}" alt="" loading="lazy">`;
}

document.addEventListener('error', event => {
  const el = event.target;
  if (!(el instanceof HTMLImageElement)) return;
  if (!el.classList.contains('thumb') && !el.classList.contains('cover')) return;
  const span = document.createElement('span');
  span.className = el.className + ' placeholder-cover';
  span.textContent = '♥';
  el.replaceWith(span);
}, true);

function renderDesktopList() {
  novelaList.innerHTML = '';

  novelas.forEach(novela => {
    const button = document.createElement('button');
    button.className = 'novela-button';
    button.type = 'button';
    button.innerHTML = `
      <span class="thumb-wrap">${imageOrPlaceholder(novela.image, 'thumb')}</span>
      <span class="novela-name">${escapeHTML(novela.title)}</span>
      <span class="item-count">${novela.items.length}</span>`;

    if (selectedNovela && selectedNovela.title === novela.title) button.classList.add('active');
    button.addEventListener('click', () => selectNovela(novela));
    novelaList.appendChild(button);
  });
}

function episodeRow(item, index) {
  const active = index === selectedItemIndex ? ' active' : '';
  return `
    <button class="episode${active}" type="button" data-index="${index}">
      <span class="play-btn" aria-hidden="true">▶</span>
      <span class="episode-title">${escapeHTML(item.title)}</span>
      <span class="episode-duration">20:00</span>
    </button>`;
}

function renderSelected(novela) {
  selectedNovela = novela;
  selectedItemIndex = 0;

  novelaHeader.innerHTML = `
    ${imageOrPlaceholder(novela.image, 'cover')}
    <div>
      <p class="meta">${escapeHTML([novela.year, novela.channel].filter(Boolean).join(' · ') || 'COLUMNA DE RADIO')}</p>
      <h2>${escapeHTML(novela.title)}</h2>
      ${novela.protagonists ? `<p class="protagonists"><strong>Protagonistas:</strong> ${escapeHTML(novela.protagonists)}</p>` : ''}
      <p class="description">${escapeHTML(novela.description || 'Escuchá las columnas de radio de esta telenovela.')}</p>
    </div>`;

  renderPlayer(player, novela.items[0] || null);

  if (!novela.items.length) {
    episodeList.innerHTML = '<p class="empty">Todavía no hay links cargados para esta novela.</p>';
    return;
  }

  episodeList.innerHTML = novela.items.map(episodeRow).join('');
  episodeList.querySelectorAll('.episode').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedItemIndex = Number(btn.dataset.index);
      renderPlayer(player, novela.items[selectedItemIndex]);
      episodeList.querySelectorAll('.episode').forEach(el => el.classList.toggle('active', el === btn));
    });
  });
}

function selectNovela(novela) {
  renderSelected(novela);
  novelaList.querySelectorAll('.novela-button').forEach(button => {
    button.classList.toggle('active', button.querySelector('.novela-name')?.textContent === novela.title);
  });
}

function renderMobile() {
  mobileAccordion.innerHTML = '';

  novelas.forEach((novela, index) => {
    const card = document.createElement('article');
    const open = selectedNovela ? selectedNovela.title === novela.title : index === 0;
    card.className = 'mobile-card' + (open ? ' open' : '');

    const meta = [novela.year, novela.channel].filter(Boolean).join(' · ');
    const playerId = 'mobile-player-' + index;
    const items = novela.items.length
      ? novela.items.map((item, itemIndex) => `
        <button class="mobile-item${itemIndex === 0 && open ? ' active' : ''}" type="button" data-index="${itemIndex}">
          <span class="play-btn" aria-hidden="true">▶</span>
          <span class="mobile-item-title">${escapeHTML(item.title)}</span>
          <span class="mobile-item-duration">20:00</span>
        </button>`).join('')
      : '<p class="empty">Sin columnas cargadas.</p>';

    card.innerHTML = `
      <button class="mobile-trigger" type="button">
        <span class="thumb-wrap">${imageOrPlaceholder(novela.image, 'thumb')}</span>
        <span><strong>${escapeHTML(novela.title)}</strong><small>${escapeHTML(meta)}</small></span>
        <span class="arrow">⌄</span>
      </button>
      <div class="mobile-items">
        <div class="player" id="${playerId}"></div>
        ${items}
      </div>`;

    const mobilePlayer = card.querySelector('#' + playerId);
    card.querySelector('.mobile-trigger').addEventListener('click', () => {
      const willOpen = !card.classList.contains('open');
      mobileAccordion.querySelectorAll('.mobile-card').forEach(other => other.classList.remove('open'));
      if (willOpen) {
        card.classList.add('open');
        selectedNovela = novela;
        selectedItemIndex = 0;
        renderPlayer(mobilePlayer, novela.items[0] || null);
      }
    });

    card.querySelectorAll('.mobile-item').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedItemIndex = Number(btn.dataset.index);
        renderPlayer(mobilePlayer, novela.items[selectedItemIndex]);
        card.querySelectorAll('.mobile-item').forEach(el => el.classList.toggle('active', el === btn));
      });
    });

    if (open) renderPlayer(mobilePlayer, novela.items[0] || null);
    mobileAccordion.appendChild(card);
  });
}

function render() {
  if (!novelas.length) {
    novelaList.innerHTML = '<p class="error">No encontré telenovelas en el CSV.</p>';
    episodeList.innerHTML = '';
    player.innerHTML = '';
    mobileAccordion.innerHTML = '<p class="error">No encontré telenovelas en el CSV.</p>';
    return;
  }
  if (!selectedNovela || !novelas.some(n => n.title === selectedNovela.title)) {
    selectedNovela = novelas[0];
  }
  renderDesktopList();
  renderSelected(selectedNovela);
  renderMobile();
}

function loadCSV(text) {
  try {
    novelas = groupNovelas(parseCSV(text));
    selectedNovela = novelas[0] || null;
    render();
  } catch (error) {
    console.error(error);
    novelaList.innerHTML = '<p class="error">No pude leer el CSV.</p>';
  }
}

async function loadDefaultCSV() {
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    loadCSV(await response.text());
  } catch {
    novelaList.innerHTML = '<p class="error">No se encontró <code>telenovelas.csv</code>.</p>';
  }
}

if (csvFile) {
  csvFile.addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadCSV(reader.result);
    reader.readAsText(file, 'UTF-8');
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/`/g, '&#96;');
}

const navToggle = document.querySelector('.nav-toggle');
const siteNav = document.querySelector('#siteNav');

if (navToggle && siteNav) {
  navToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(open));
  });

  siteNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      siteNav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

const LANG_KEY = 'lang';
const langButtons = document.querySelectorAll('[data-lang-btn]');

function setLang(lang) {
  const next = lang === 'en' ? 'en' : 'es';
  document.documentElement.lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* ignore quota / private mode */
  }
  langButtons.forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.langBtn === next));
  });
}

try {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'en' || saved === 'es') setLang(saved);
} catch {
  /* ignore */
}

langButtons.forEach(btn => {
  btn.addEventListener('click', () => setLang(btn.dataset.langBtn));
});

document.querySelectorAll('.sobre-more').forEach(details => {
  details.addEventListener('toggle', () => {
    if (!details.open) details.open = true;
  });
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktopParallax = window.matchMedia('(min-width: 761px)');
const parallaxLayers = [
  { el: document.querySelector('.hero-bg'), factor: 0.18 },
  { el: document.querySelector('.sobre-mi'), factor: 0.12 },
  { el: document.querySelector('.libro-img'), factor: 0.16 }
];

function tickParallax() {
  const off = reduceMotion.matches || !desktopParallax.matches;
  const vh = window.innerHeight;
  parallaxLayers.forEach(({ el, factor }) => {
    if (!el) return;
    if (off) {
      el.style.setProperty('--p', '0px');
      return;
    }
    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2 - vh / 2;
    el.style.setProperty('--p', (mid * factor).toFixed(1) + 'px');
  });
}

let parallaxRaf = 0;
function onParallaxScroll() {
  if (parallaxRaf) return;
  parallaxRaf = requestAnimationFrame(() => {
    parallaxRaf = 0;
    tickParallax();
  });
}

window.addEventListener('scroll', onParallaxScroll, { passive: true });
window.addEventListener('resize', onParallaxScroll, { passive: true });
tickParallax();

loadDefaultCSV();
