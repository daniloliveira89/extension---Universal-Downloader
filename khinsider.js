'use strict';

// Funções puras de extração do HTML do KHInsider.
const KHParser = (() => {
  const SITE = 'downloads.khinsider.com';
  const MEDIA_EXTENSIONS = /\.(mp3|flac)$/i;

  function normalizeAlbumUrl(input) {
    let url;
    try { url = new URL(String(input || '').trim()); }
    catch { throw new Error('Cole um link completo de álbum do KHInsider.'); }
    if (url.protocol !== 'https:' || url.hostname !== SITE) {
      throw new Error('O link deve começar com https://downloads.khinsider.com/');
    }
    const match = url.pathname.match(/^\/game-soundtracks\/album\/([^/]+)(?:\/.*)?$/);
    if (!match) throw new Error('O endereço informado não é uma página de álbum.');
    return `${url.origin}/game-soundtracks/album/${match[1]}`;
  }

  function parseDocument(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function safeUrl(href, base) {
    try {
      const url = new URL(href, base);
      return url.protocol === 'https:' ? url : null;
    } catch { return null; }
  }

  function safeFileName(value, fallback = 'arquivo') {
    return String(value || '')
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .slice(0, 160)
      .replace(/[. ]+$/g, '') || fallback;
  }

  function fileNameFromUrl(url) {
    const raw = new URL(url).pathname.split('/').pop();
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* Usar valor original. */ }
    return safeFileName(decoded, 'faixa.mp3');
  }

  function readableTitle(anchor, url) {
    const title = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    if (title && !/^(?:get_app|download|\d+(?:[.:]\d+)?|\d+(?:\.\d+)?\s*(?:MB|KB|GB))$/i.test(title)) {
      return title;
    }
    return fileNameFromUrl(url).replace(/\.(?:mp3|flac)$/i, '');
  }

  function isDetailLink(url, albumUrl) {
    const album = new URL(albumUrl);
    return url && url.origin === album.origin &&
      url.pathname.startsWith(`${album.pathname}/`) && MEDIA_EXTENSIONS.test(url.pathname);
  }

  function canonicalTrackKey(url) {
    return new URL(url).pathname.replace(MEDIA_EXTENSIONS, '').toLowerCase();
  }

  function discoverTracks(doc, albumUrl) {
    const records = new Map();
    // Uma linha é uma faixa; assim, MP3/FLAC e vários links de tamanho não a duplicam.
    const tableRows = [...doc.querySelectorAll('#songlist tr')];
    const rows = tableRows.length ? tableRows : [...doc.querySelectorAll('table tr')];
    for (const row of rows) {
      const anchors = [...row.querySelectorAll('a[href]')];
      const matching = anchors.map(a => ({ anchor: a, url: safeUrl(a.getAttribute('href'), albumUrl) }))
        .filter(item => isDetailLink(item.url, albumUrl));
      if (!matching.length) continue;
      const named = matching.find(item => !/^(?:get_app|download|\d+(?:[.:]\d+)?|\d+(?:\.\d+)?\s*(?:MB|KB|GB))$/i.test(item.anchor.textContent.trim()));
      const primary = named || matching[0];
      const key = canonicalTrackKey(primary.url);
      if (!records.has(key)) records.set(key, {
        url: primary.url.href,
        title: readableTitle(primary.anchor, primary.url.href)
      });
    }
    // Layout alternativo: extrair diretamente os links de faixa.
    if (!records.size) {
      for (const anchor of doc.querySelectorAll('a[href]')) {
        const url = safeUrl(anchor.getAttribute('href'), albumUrl);
        if (!isDetailLink(url, albumUrl)) continue;
        const key = canonicalTrackKey(url);
        if (!records.has(key)) records.set(key, { url: url.href, title: readableTitle(anchor, url.href) });
        else if (records.get(key).title.match(/\.(mp3|flac)$/i)) records.get(key).title = readableTitle(anchor, url.href);
      }
    }
    return [...records.values()];
  }

  function discoverFormats(doc) {
    // Detectar cabeçalhos MP3 / FLAC da tabela, sem inferir do nome do arquivo.
    const headings = [...doc.querySelectorAll('#songlist th, table th')]
      .map(el => (el.textContent || '').trim().toUpperCase());
    const sizes = (doc.body?.textContent || '').match(/Total Filesize:[^\n\r]{0,150}/i)?.[0] || '';
    const hasMP3 = headings.some(h => h === 'MP3') || /\bMP3\b/i.test(sizes);
    const hasFLAC = headings.some(h => h === 'FLAC') || /\bFLAC\b/i.test(sizes);
    return { mp3: hasMP3 || !hasFLAC, flac: hasFLAC };
  }

  function readAlbum(html, albumUrl) {
    const doc = parseDocument(html);
    const rawTitle = doc.querySelector('h2')?.textContent?.trim() ||
      doc.querySelector('meta[property="og:title"]')?.content?.split(' MP3 -')[0].trim() ||
      decodeURIComponent(new URL(albumUrl).pathname.split('/').pop()).replace(/-/g, ' ');
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    const bodyText = doc.body?.textContent || '';
    const year = bodyText.match(/Year:\s*((?:19|20)\d{2})(?!\d)/)?.[1] || '';
    const countText = bodyText.match(/Number of Files:\s*(\d+)(?!\d)/)?.[1];
    const statedCount = countText ? Number(countText) : null;
    const tracks = discoverTracks(doc, albumUrl);
    const formats = discoverFormats(doc);
    // Se houver um ano confiável, padronizar Ano - Nome, sem duplicar ano já no título.
    const cleanedTitle = year ? title
      .replace(new RegExp(`^\\s*${year}\\s*[-–—:|]\\s*`), '')
      .replace(new RegExp(`\\s*\\(?${year}\\)?\\s*$`), '')
      .trim() : title;
    const gameTitle = MusicNaming.cleanup(cleanedTitle || title, year);
    const folder = safeFileName(year ? `${year} - ${gameTitle}` : gameTitle, 'Album KHInsider').slice(0, 110);
    return { title, year, folder, statedCount, tracks, formats };
  }

  function discoverMedia(html, detailUrl, format) {
    const doc = parseDocument(html);
    const extension = format === 'flac' ? 'flac' : 'mp3';
    const candidates = [];
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const url = safeUrl(anchor.getAttribute('href'), detailUrl);
      if (!url || url.hostname === SITE || !new RegExp(`\\.${extension}$`, 'i').test(url.pathname)) continue;
      const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
      const knownHost = url.hostname === 'vgmtreasurechest.com' || url.hostname.endsWith('.vgmtreasurechest.com');
      const explicit = new RegExp(`download\\s+as\\s+${extension}`, 'i').test(text);
      const generic = /(?:click here to download|download|baixar)/i.test(text);
      // Primeiro preferir o botão explicitamente associado ao formato escolhido.
      candidates.push({ url: url.href, score: (explicit ? 100 : 0) + (generic ? 20 : 0) + (knownHost ? 10 : 0) });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length) throw new Error(`Link ${extension.toUpperCase()} não disponível para esta faixa.`);
    return candidates[0].url;
  }

  return { normalizeAlbumUrl, readAlbum, discoverMedia, safeFileName, fileNameFromUrl };
})();
