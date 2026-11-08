'use strict';

// Leitor genérico: identifica links diretos, não extrai áudio protegido ou streams.
(() => {
  const EXT = 'mp3|flac|wav|m4a|aac|ogg|opus|aiff?|alac|wma';
  const EXT_RE = new RegExp(`\\.(${EXT})$`, 'i');
  const TEXT_RE = new RegExp(`\\.(${EXT})(?:[?#]|$)`, 'i');
  const TYPES = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/flac': 'flac',
    'audio/x-flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg',
    'audio/opus': 'opus', 'audio/aiff': 'aiff'
  };

  const sanitize = (text, fallback = 'audio') => String(text || '')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 145) || fallback;

  function urlInfo(raw, base, hint = '') {
    if (!raw || /^\s*(?:blob:|data:|javascript:|file:)/i.test(raw)) return null;
    let url;
    try { url = new URL(raw, base); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { /* sem alteração */ }
    const candidates = [path, ...['filename', 'file', 'download', 'name'].map(k => url.searchParams.get(k) || '')];
    const match = candidates.map(s => s.match(EXT_RE)).find(Boolean);
    const ext = match?.[1]?.toLowerCase() || TYPES[hint.split(';')[0].trim().toLowerCase()] || '';
    if (!ext) return null;
    return { url: url.href, ext: ext === 'aif' ? 'aiff' : ext };
  }

  function getName(item) {
    const ext = item.ext || 'mp3';
    const preferred = sanitize(item.title || '', '');
    if (preferred && !/^[a-z\d_-]{8,}(?:\.\d+)?$/i.test(preferred)) {
      return new RegExp(`\\.${ext}$`, 'i').test(preferred) ? preferred : `${preferred}.${ext}`;
    }
    let url;
    try {
      url = new URL(item.url);
    } catch {
      return sanitize(preferred || `arquivo.${ext}`, `arquivo.${ext}`);
    }
    let name = ['filename', 'file', 'download', 'name']
      .map(k => url.searchParams?.get(k)).find(t => t && TEXT_RE.test(t)) || url.pathname.split('/').pop();
    try { name = decodeURIComponent(name); } catch { /* sem alteração */ }
    name = sanitize(name, `arquivo.${ext}`);
    if (!new RegExp(`\\.${ext}$`, 'i').test(name)) name += `.${ext}`;
    return name;
  }

  function getTitle(text, item) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized && normalized.length <= 160 &&
      !/^(download|baixar|save|salvar|play|listen|ouvir|\d+(?:[.,]\d+)?\s*(?:kb|mb|gb))$/i.test(normalized)) {
      return sanitize(normalized, getName(item));
    }
    const fallback = getName(item).replace(/\.[a-z\d]+$/i, '');
    return /^[a-z\d_-]{8,}(?:\.\d+)?$/i.test(fallback)
      ? 'Faixa sem título identificado' : fallback;
  }

  function read(doc, pageUrl, resourceUrls = []) {
    const found = new Map();
    const collect = (raw, title, hint = '') => {
      const info = urlInfo(raw, pageUrl, hint);
      if (!info || found.has(info.url)) return;
      found.set(info.url, { url: info.url, ext: info.ext, title: getTitle(title, info) });
    };
    for (const el of doc.querySelectorAll('a[href], audio[src], source[src], video source[src], [data-audio-url], [data-src]')) {
      const tag = el.tagName?.toLowerCase();
      const title = (el.getAttribute('download') || el.getAttribute('title') || el.textContent || '').trim();
      if (tag === 'a') collect(el.getAttribute('href'), title);
      if (el.hasAttribute('src')) collect(el.getAttribute('src'), title, el.getAttribute('type') || '');
      if (el.hasAttribute('data-audio-url')) collect(el.getAttribute('data-audio-url'), title);
      if (el.hasAttribute('data-src')) collect(el.getAttribute('data-src'), title, el.getAttribute('type') || '');
    }
    // audio.currentSrc cobre <source> cuja faixa foi escolhida dinamicamente.
    for (const player of doc.querySelectorAll('audio')) {
      if (player.currentSrc) collect(player.currentSrc, player.getAttribute('title') || '');
    }
    for (const url of resourceUrls.slice(-800)) collect(url, '');
    const title = (doc.querySelector('meta[property="og:title"]')?.content || doc.title ||
      new URL(pageUrl).hostname).trim();
    // Apenas datas associadas explicitamente ao lançamento: não usar a data do artigo/site.
    const releaseMeta = doc.querySelector('meta[property="music:release_date"], meta[property="music:releaseDate"], meta[name="release_date"], meta[name="album:release_date"]')?.getAttribute('content') || '';
    const releaseYear = releaseMeta.match(/(?:19|20)\d{2}/)?.[0] || '';
    const labelledYear = (doc.body?.textContent || '').match(/(?:Album Year|Release Year|Release Date|Year|Released|Ano|Lançamento)\s*[:：]\s*((?:19|20)\d{2})(?!\d)/i)?.[1] || '';
    const titleYear = title.match(/(?:^|[\s[(])((?:19|20)\d{2})(?=[\s)\]]|$)/)?.[1] || '';
    const year = releaseYear || labelledYear || titleYear;
    const cleanTitle = year ? title
      .replace(new RegExp(`^\\s*${year}\\s*[-–—:|]\\s*`), '')
      .replace(new RegExp(`\\s*\\(?${year}\\)?\\s*$`), '')
      .trim() : title;
    const gameTitle = MusicNaming.cleanup(cleanTitle || title, year);
    const folder = sanitize(year ? `${year} - ${gameTitle}` : gameTitle, 'Arquivos de áudio').slice(0, 90);
    return { title, year, folder, source: 'generic', tracks: [...found.values()].slice(0, 1200) };
  }

  globalThis.AudioScanner = { read, urlInfo, sanitize, getName };
})();
