'use strict';

// Módulo SoundCloud: extrai metadados completos de playlists e faixas
// e permite o download de alta qualidade através dos fluxos de mídia do SoundCloud.
(() => {
  const API_BASE = 'https://api-v2.soundcloud.com';
  const FALLBACK_CLIENT_ID = 'QhVEWrrJKvW4uSU5u5EoI0FTXYUGzy5k';

  function isSoundCloudUrl(raw) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
    } catch {
      return false;
    }
  }

  function projectTrack(value) {
    if (!value || typeof value !== 'object') return null;
    const id = value.id == null ? null : String(value.id);
    const title = typeof value.title === 'string' ? value.title : '';
    const permalink = value.permalink_url || value.permalinkUrl || '';
    if (!id && !title && !permalink) return null;
    return {
      id,
      title,
      permalink_url: permalink,
      downloadable: true,
      download_url: value.download_url || '',
      track_authorization: value.track_authorization || '',
      kind: value.kind || '',
      user: value.user?.username || '',
      media: value.media || null,
      duration: value.duration || value.full_duration || 0
    };
  }

  async function extractPageData(tabId) {
    if (!tabId) {
      return { clientId: FALLBACK_CLIENT_ID, playlist: null, hydratedTracks: [] };
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const projectItem = value => {
            if (!value || typeof value !== 'object') return null;
            const id = value.id == null ? null : String(value.id);
            const title = typeof value.title === 'string' ? value.title : '';
            const permalink = value.permalink_url || value.permalinkUrl || '';
            if (!id && !title && !permalink) return null;
            return {
              id,
              title,
              permalink_url: permalink,
              downloadable: true,
              download_url: value.download_url || '',
              track_authorization: value.track_authorization || '',
              kind: value.kind || '',
              user: value.user?.username || '',
              media: value.media || null,
              duration: value.duration || value.full_duration || 0
            };
          };

          let hydration = Array.isArray(window.__sc_hydration) ? window.__sc_hydration : null;
          if (!hydration) {
            const scripts = Array.from(document.scripts);
            for (const script of scripts) {
              const text = script.textContent || '';
              const marker = text.indexOf('__sc_hydration');
              if (marker < 0) continue;
              const start = text.indexOf('[', marker);
              if (start < 0) continue;
              let depth = 0, quoted = false, escaped = false, end = -1;
              for (let i = start; i < text.length; i++) {
                const ch = text[i];
                if (quoted) {
                  if (escaped) escaped = false;
                  else if (ch === '\\') escaped = true;
                  else if (ch === '"') quoted = false;
                  continue;
                }
                if (ch === '"') quoted = true;
                else if (ch === '[') depth++;
                else if (ch === ']') {
                  depth--;
                  if (depth === 0) { end = i + 1; break; }
                }
              }
              if (end > start) {
                try { hydration = JSON.parse(text.slice(start, end)); } catch {}
              }
              if (hydration) break;
            }
          }

          if (!Array.isArray(hydration)) {
            return { clientId: '', playlist: null, hydratedTracks: [] };
          }

          const apiEntry = hydration.find(entry =>
            /apiclient/i.test(entry?.hydratable || ''));
          const playlistEntry = hydration.find(entry =>
            /playlist/i.test(entry?.hydratable || '') &&
            entry?.data && Array.isArray(entry.data.tracks));
          const soundEntries = hydration
            .filter(entry => /^(sound|track)$/i.test(entry?.hydratable || ''))
            .map(entry => projectItem(entry.data))
            .filter(Boolean);

          const rawPlaylist = playlistEntry?.data || null;
          const playlist = rawPlaylist ? {
            id: rawPlaylist.id == null ? null : String(rawPlaylist.id),
            title: rawPlaylist.title || '',
            permalink_url: rawPlaylist.permalink_url || location.href,
            track_count: Number(rawPlaylist.track_count || rawPlaylist.tracks?.length || 0),
            tracks: rawPlaylist.tracks.map(projectItem).filter(Boolean)
          } : null;

          return {
            clientId: String(apiEntry?.data?.id || apiEntry?.data?.client_id || ''),
            playlist,
            hydratedTracks: soundEntries
          };
        }
      });
      const data = results?.[0]?.result;
      return {
        clientId: data?.clientId || FALLBACK_CLIENT_ID,
        playlist: data?.playlist || null,
        hydratedTracks: data?.hydratedTracks || []
      };
    } catch {
      return { clientId: FALLBACK_CLIENT_ID, playlist: null, hydratedTracks: [] };
    }
  }

  async function apiRequest(pathOrUrl, clientId) {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`);
    if (!url.searchParams.has('client_id')) url.searchParams.set('client_id', clientId || FALLBACK_CLIENT_ID);
    const response = await fetch(url.href, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body?.error?.message || body?.message || '';
      } catch {}
      throw new Error(`SoundCloud API respondeu HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
    }
    return response.json();
  }

  function asTracks(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.collection)) return data.collection;
    if (Array.isArray(data?.tracks)) return data.tracks;
    return [];
  }

  async function loadPlaylist(tabId, pageUrl) {
    if (!isSoundCloudUrl(pageUrl)) {
      throw new Error('Esta página não parece ser do SoundCloud.');
    }

    const page = await extractPageData(tabId);
    const clientId = page.clientId || FALLBACK_CLIENT_ID;

    const canonicalUrl = new URL(pageUrl);
    canonicalUrl.hostname = 'soundcloud.com';
    canonicalUrl.hash = '';
    canonicalUrl.search = '';
    const resolved = await apiRequest(
      `/resolve?url=${encodeURIComponent(canonicalUrl.href)}`,
      clientId
    );

    let rawTracks = asTracks(resolved);
    const playlistId = resolved.id || page.playlist?.id;
    const reportedCount = Number(resolved.track_count || page.playlist?.track_count || rawTracks.length);

    // Algumas respostas de /resolve trazem apenas parte da lista.
    if (playlistId && rawTracks.length < reportedCount) {
      try {
        const collection = await apiRequest(
          `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=200&offset=0`,
          clientId
        );
        const expanded = asTracks(collection);
        if (expanded.length > rawTracks.length) rawTracks = expanded;
      } catch {
        // Mantém a resposta de /resolve
      }
    }

    if (!rawTracks.length && page.playlist?.tracks?.length) {
      rawTracks = page.playlist.tracks;
    }

    // Mescla dados presentes na hidratação com a resposta da API
    const hydrationById = new Map();
    for (const track of [...(page.playlist?.tracks || []), ...page.hydratedTracks]) {
      if (track?.id) hydrationById.set(String(track.id), track);
    }

    const orderedIds = rawTracks.map(t => t?.id == null ? '' : String(t.id)).filter(Boolean);
    const needsHydration = [...new Set(orderedIds)].filter(id => {
      const source = rawTracks.find(t => String(t?.id) === id);
      const hydrated = hydrationById.get(id);
      const titleKnown = !!(source?.title || hydrated?.title);
      const mediaKnown = !!(source?.media?.transcodings?.length || hydrated?.media?.transcodings?.length);
      return !(titleKnown && mediaKnown);
    });

    for (let i = 0; i < needsHydration.length; i += 30) {
      const batch = needsHydration.slice(i, i + 30);
      try {
        const data = await apiRequest(`/tracks?ids=${batch.join(',')}`, clientId);
        for (const track of asTracks(data)) {
          if (track?.id != null) hydrationById.set(String(track.id), track);
        }
      } catch (err) {
        console.warn('Erro ao hidratar faixas:', err);
      }
    }

    const merged = rawTracks.map(raw => {
      const id = raw?.id == null ? '' : String(raw.id);
      const hydrated = id ? hydrationById.get(id) : null;
      return { ...(hydrated || {}), ...(raw || {}) };
    }).filter(track => track && (track.id != null || track.title));

    if (!merged.length && page.playlist?.tracks?.length) {
      for (const track of page.playlist.tracks) merged.push(track);
    }

    // Se for faixa avulsa
    if (!merged.length && resolved?.kind === 'track' && resolved.id) {
      merged.push(resolved);
    }

    if (!merged.length) {
      throw new Error('A página foi encontrada, mas o SoundCloud não forneceu os metadados das faixas.');
    }

    const tracks = [];
    for (const track of merged) {
      const id = track.id == null ? '' : String(track.id);
      const title = String(track.title || '').replace(/\s+/g, ' ').trim();
      if (!title) continue;

      const permalink = String(track.permalink_url || `https://soundcloud.com/`);
      tracks.push({
        id,
        url: permalink,
        ext: 'm4a',
        title,
        downloadable: true,
        selected: true,
        state: 'Pendente',
        error: '',
        soundcloudTrackId: id,
        track_authorization: track.track_authorization || '',
        media: track.media || null,
        download_url: track.download_url || '',
        clientId
      });
    }

    if (!tracks.length) {
      throw new Error('Não encontrei faixas com títulos válidos nesta página do SoundCloud.');
    }

    const playlistTitle = String(resolved.title || page.playlist?.title || 'SoundCloud Playlist')
      .replace(/\s+/g, ' ').trim();
    const folder = playlistTitle.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
      .replace(/\s+/g, ' ').trim().slice(0, 90) || 'SoundCloud';

    return {
      title: playlistTitle,
      folder,
      year: '',
      source: 'soundcloud',
      playlistTrackCount: tracks.length,
      reportedTrackCount: reportedCount,
      downloadableCount: tracks.length,
      tracks
    };
  }

  async function fetchWithRetry(url, retries = 3) {
    for (let i = 1; i <= retries; i++) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (err) {
        if (i === retries) throw err;
        await new Promise(r => setTimeout(r, 450 * i));
      }
    }
  }

  async function downloadHlsStream(m3u8Url, onProgress, isStopRequested) {
    const res = await fetchWithRetry(m3u8Url, 3);
    const m3u8Text = await res.text();

    const initMatch = m3u8Text.match(/#EXT-X-MAP:URI="([^"]+)"/);
    const initUrl = initMatch ? new URL(initMatch[1], m3u8Url).href : null;
    const segmentUrls = m3u8Text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => new URL(l, m3u8Url).href);

    if (!segmentUrls.length && !initUrl) {
      throw new Error('Nenhum segmento de áudio encontrado no fluxo HLS.');
    }

    const isFmp4 = !!initUrl;
    const mimeType = isFmp4 ? 'audio/mp4' : 'audio/aac';
    const ext = isFmp4 ? 'm4a' : 'aac';

    let initBuffer = null;
    if (initUrl) {
      if (isStopRequested && isStopRequested()) throw new Error('Download cancelado.');
      const r = await fetchWithRetry(initUrl, 3);
      initBuffer = await r.arrayBuffer();
    }

    const total = segmentUrls.length;
    const segmentBuffers = new Array(total);
    let completed = 0;
    const concurrency = Math.min(4, Math.max(1, total));
    let cursor = 0;

    const worker = async () => {
      while (cursor < total) {
        if (isStopRequested && isStopRequested()) throw new Error('Download cancelado.');
        const idx = cursor++;
        const url = segmentUrls[idx];
        const segRes = await fetchWithRetry(url, 3);
        segmentBuffers[idx] = await segRes.arrayBuffer();
        completed++;
        if (typeof onProgress === 'function') {
          const pct = Math.round((completed / total) * 100);
          onProgress(`${pct}%`);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const parts = initBuffer ? [initBuffer, ...segmentBuffers] : segmentBuffers;
    const blob = new Blob(parts, { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    return { blobUrl, ext, size: blob.size };
  }

  async function resolveAudio(track, preferredFormat, onProgress, isStopRequested) {
    const clientId = track.clientId || FALLBACK_CLIENT_ID;

    // 1. Se houver URL de download oficial disponibilizada pelo artista
    if (track.download_url) {
      try {
        const dlUrl = new URL(track.download_url.startsWith('http') ? track.download_url : `${API_BASE}/tracks/${encodeURIComponent(track.id)}/download`);
        dlUrl.searchParams.set('client_id', clientId);
        if (track.track_authorization) dlUrl.searchParams.set('track_authorization', track.track_authorization);
        const res = await fetch(dlUrl.href, { cache: 'no-store' });
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            const json = await res.json();
            if (json.redirectUri) return { url: json.redirectUri, ext: 'mp3' };
          } else {
            return { url: dlUrl.href, ext: 'mp3' };
          }
        }
      } catch {
        // Prossegue para resolução via streams
      }
    }

    // 2. Garante que os transcodings da faixa estejam disponíveis
    let transcodings = track.media?.transcodings || [];
    if (!transcodings.length && track.id) {
      try {
        const full = await apiRequest(`/tracks/${encodeURIComponent(track.id)}`, clientId);
        if (full?.media?.transcodings) {
          transcodings = full.media.transcodings;
          track.media = full.media;
          if (full.track_authorization) track.track_authorization = full.track_authorization;
        }
      } catch (err) {
        console.warn('Erro ao obter transcodings:', err);
      }
    }

    if (!transcodings.length) {
      throw new Error('Não há fluxo de áudio disponível para esta faixa no SoundCloud.');
    }

    // Seleção de formato:
    // Se o usuário pediu explicitamente MP3, busca stream progressivo MP3 primeiro
    let chosen = null;
    if (preferredFormat === 'mp3') {
      chosen = transcodings.find(t => t.format?.protocol === 'progressive' && /mp3/i.test(t.preset || ''));
    }

    // Caso não encontre progressivo ou o formato seja automático/M4A, prefere AAC de alta qualidade (160k)
    if (!chosen) {
      chosen = transcodings.find(t => /aac_160/i.test(t.preset || '')) ||
               transcodings.find(t => t.format?.protocol === 'progressive') ||
               transcodings.find(t => t.format?.protocol === 'hls' && !/abr/i.test(t.preset || '')) ||
               transcodings[0];
    }

    if (!chosen?.url) {
      throw new Error('Formato de áudio incompatível para esta faixa.');
    }

    const streamApiUrl = new URL(chosen.url);
    streamApiUrl.searchParams.set('client_id', clientId);
    if (track.track_authorization) {
      streamApiUrl.searchParams.set('track_authorization', track.track_authorization);
    }

    const streamInfo = await apiRequest(streamApiUrl.href, clientId);
    const mediaUrl = streamInfo?.url;
    if (!mediaUrl) {
      throw new Error('O SoundCloud não retornou o endereço de áudio da faixa.');
    }

    // Se for stream progressivo direto (ex: MP3)
    if (chosen.format?.protocol === 'progressive') {
      return { url: mediaUrl, ext: 'mp3' };
    }

    // Se for fluxo HLS (fMP4 AAC / M4A)
    const hlsResult = await downloadHlsStream(mediaUrl, onProgress, isStopRequested);
    return {
      url: hlsResult.blobUrl,
      blobUrl: hlsResult.blobUrl,
      ext: hlsResult.ext
    };
  }

  globalThis.SoundCloudApi = {
    isSoundCloudUrl,
    loadPlaylist,
    resolveAudio,
    downloadHlsStream
  };
})();
