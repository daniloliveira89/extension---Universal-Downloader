'use strict';

const UI = Object.fromEntries([
  'urlForm', 'pageUrl', 'load', 'mode', 'pageInfo', 'pageTitle', 'openPage',
  'foundCount', 'sourceDescription', 'status', 'statusDot', 'format', 'folder',
  'useFolder', 'parallel', 'destinationTitle', 'counter', 'percent', 'progress', 'start',
  'stop', 'refresh', 'showFile', 'selectAll', 'selectNone', 'selectInvert', 'tracks', 'listCount'
].map(id => [id, document.getElementById(id)]));

const params = new URLSearchParams(location.search);
let sourceTabId = /^\d+$/.test(params.get('tab') || '') ? Number(params.get('tab')) : null;
const sourceTabUrl = (params.get('page') || '').split('#')[0];
let currentUrl = '';
let currentMode = '';
let currentData = null;
let tracks = [];
let running = false;
let loading = false;
let stopRequested = false;
let readSerial = 0;
let lastCompletedDownloadId = null;
let wrongFolderCount = 0;
let selectionAnchor = null;
let selectionAnchorValue = true;
let dragSelection = null;
let suppressClickAfterDrag = false;
let dragScrollFrame = null;

const ALLOWED_FORMATS = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'alac', 'wma']);

function safeUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new Error('Informe um endereço válido iniciado por https:// ou http://.');
  }
}
function khAlbum(raw) {
  try { return KHParser.normalizeAlbumUrl(raw); } catch { return null; }
}
function setStatus(message, kind = '') {
  UI.status.textContent = message;
  UI.statusDot.className = `dot ${kind}`;
}
function visible() {
  const format = UI.format.value;
  return currentMode === 'kh' || format === 'any' ? tracks : tracks.filter(t => t.ext === format);
}
function selected() { return visible().filter(t => t.selected); }
function formatLabel(ext) {
  if (ext === 'any') return 'Todos disponíveis';
  if (ext === 'm4a') return 'M4A (Áudio AAC)';
  return ext.toUpperCase();
}
function setFormats(data) {
  UI.format.replaceChildren();
  const formats = currentMode === 'kh' ?
    [data.formats?.mp3 ? 'mp3' : null, data.formats?.flac ? 'flac' : null].filter(Boolean) :
    ['any', ...new Set(data.tracks.map(t => t.ext).filter(ext => ALLOWED_FORMATS.has(ext)))];
  for (const format of formats) {
    const option = document.createElement('option');
    option.value = format;
    option.textContent = formatLabel(format);
    UI.format.append(option);
  }
  UI.format.disabled = !formats.length;
}
function updateProgress() {
  const queue = selected();
  const complete = queue.filter(t => t.state === 'Concluído').length;
  const errors = queue.filter(t => t.state === 'Erro').length;
  const percent = queue.length ? Math.round(complete / queue.length * 100) : 0;
  UI.counter.textContent = `${complete} de ${queue.length} concluídos${errors ? ` · ${errors} com erro` : ''}`;
  UI.percent.textContent = `${percent}%`;
  UI.progress.style.width = `${percent}%`;
  UI.progress.setAttribute('aria-valuemax', String(queue.length));
  UI.progress.setAttribute('aria-valuenow', String(complete));
}
function updateControls() {
  const queue = selected();
  const pending = queue.filter(t => t.state !== 'Concluído').length;
  UI.start.disabled = running || loading || !currentData || pending === 0;
  UI.start.textContent = pending ? `Baixar ${pending} ${pending === 1 ? 'arquivo' : 'arquivos'}${queue.some(t => t.state === 'Concluído') ? ' pendentes' : ''}` : 'Nada pendente';
  UI.stop.disabled = !running || stopRequested;
  UI.load.disabled = running || loading;
  UI.pageUrl.disabled = running || loading;
  UI.format.disabled = running || loading || !currentData;
  UI.parallel.disabled = running;
  UI.folder.disabled = running || loading || !currentData;
  UI.useFolder.disabled = running;
  UI.refresh.disabled = running || loading || !currentUrl;
  UI.selectAll.disabled = running || loading || !visible().length;
  UI.selectNone.disabled = running || loading || !visible().length;
  UI.selectInvert.disabled = running || loading || !visible().length;
  UI.destinationTitle.textContent = UI.useFolder.checked ? 'Downloads / Pasta' : 'Downloads (sem pasta)';
  updateProgress();
}
function updateTrackState(track, state, error = '') {
  track.state = state;
  track.error = error;
  const index = tracks.indexOf(track);
  const label = document.getElementById(`state-${index}`);
  if (label) {
    label.textContent = state;
    label.title = error;
    label.className = `song-state ${state === 'Concluído' ? 'done' : state === 'Erro' ? 'error' : state.startsWith('Baixando') || state.startsWith('Localizando') || state.startsWith('Tentativa') ? 'working' : ''}`;
  }
  updateControls();
}
function syncSelectionUI() {
  const files = visible();
  UI.listCount.textContent = currentData ? `${files.length} ${currentMode === 'soundcloud' ? (files.length === 1 ? 'faixa' : 'faixas') : (files.length === 1 ? 'arquivo' : 'arquivos')} neste filtro · ${files.filter(t => t.selected).length} selecionados` : 'Nenhum arquivo identificado';
  for (const row of UI.tracks.querySelectorAll('li[data-visible-index]')) {
    const item = files[Number(row.dataset.visibleIndex)];
    if (!item) continue;
    row.classList.toggle('is-selected', !!item.selected);
    row.classList.toggle('is-dragging', !!dragSelection?.active && Number(row.dataset.visibleIndex) >= Math.min(dragSelection.startIndex, dragSelection.lastIndex) && Number(row.dataset.visibleIndex) <= Math.max(dragSelection.startIndex, dragSelection.lastIndex));
    const checkbox = row.querySelector('.song-check');
    if (checkbox) checkbox.checked = !!item.selected;
  }
  updateControls();
}
function cancelSelectionDrag() {
  dragSelection = null;
  UI.tracks.classList.remove('drag-selecting');
  if (dragScrollFrame != null) cancelAnimationFrame(dragScrollFrame);
  dragScrollFrame = null;
}
function renderTracks() {
  cancelSelectionDrag();
  UI.tracks.replaceChildren();
  const files = visible();
  UI.listCount.textContent = currentData ? `${files.length} ${currentMode === 'soundcloud' ? (files.length === 1 ? 'faixa' : 'faixas') : (files.length === 1 ? 'arquivo' : 'arquivos')} neste filtro · ${files.filter(t => t.selected).length} selecionados` : 'Nenhum arquivo identificado';
  if (!files.length) {
    const row = document.createElement('li');
    row.className = 'empty';
    row.textContent = currentData ? 'Nenhum arquivo nesse formato.' : 'Os arquivos de áudio encontrados aparecerão aqui.';
    UI.tracks.append(row);
    return;
  }
  files.forEach((track, visibleIndex) => {
    const i = tracks.indexOf(track);
    const row = document.createElement('li');
    row.dataset.visibleIndex = String(visibleIndex);
    row.classList.toggle('is-selected', !!track.selected);
    row.title = 'Clique para marcar/desmarcar · Shift: intervalo · Ctrl: avulsas · arraste: intervalo';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'song-check';
    checkbox.checked = !!track.selected;
    checkbox.disabled = running || loading;
    checkbox.setAttribute('aria-label', `Selecionar ${track.title}`);
    const num = document.createElement('span');
    num.className = 'song-no';
    num.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'song-name';
    name.textContent = track.title;
    name.title = track.url;
    const ext = document.createElement('span');
    ext.className = 'song-ext';
    ext.textContent = currentMode === 'kh' ? 'FAIXA' : track.ext.toUpperCase();
    const state = document.createElement('span');
    state.id = `state-${i}`;
    state.textContent = track.state;
    state.title = track.error;
    state.className = `song-state ${track.state === 'Concluído' ? 'done' : track.state === 'Erro' ? 'error' : track.state.startsWith('Baixando') || track.state.startsWith('Localizando') ? 'working' : ''}`;
    row.append(checkbox, num, name, ext, state);
    UI.tracks.append(row);
  });
}
function clickSelection(index, shiftKey) {
  if (running || loading) return;
  const files = visible();
  const track = files[index];
  if (!track) return;
  const anchorIndex = selectionAnchor ? files.indexOf(selectionAnchor) : -1;
  if (shiftKey && anchorIndex >= 0) {
    for (let i = Math.min(index, anchorIndex); i <= Math.max(index, anchorIndex); i++) {
      files[i].selected = selectionAnchorValue;
    }
  } else {
    track.selected = !track.selected;
    selectionAnchor = track;
    selectionAnchorValue = track.selected;
  }
  syncSelectionUI();
}
function itemAtPointer(x, y) {
  const bounds = UI.tracks.getBoundingClientRect();
  if (!UI.tracks.children.length || x < bounds.left - 24 || x > bounds.right + 24) return -1;
  const target = document.elementFromPoint(
    Math.min(Math.max(x, bounds.left + 8), bounds.right - 8),
    Math.min(Math.max(y, bounds.top + 5), bounds.bottom - 5)
  );
  const row = target?.closest('li[data-visible-index]');
  return row && UI.tracks.contains(row) ? Number(row.dataset.visibleIndex) : -1;
}
function applyDraggedInterval(index) {
  const drag = dragSelection;
  if (!drag || index < 0 || index >= drag.files.length || index === drag.lastIndex && drag.active) return;
  drag.lastIndex = index;
  const low = Math.min(drag.startIndex, index);
  const high = Math.max(drag.startIndex, index);
  for (let i = 0; i < drag.files.length; i++) {
    drag.files[i].selected = i >= low && i <= high ? drag.targetValue : drag.original[i];
  }
  selectionAnchor = drag.files[drag.startIndex];
  selectionAnchorValue = drag.targetValue;
  syncSelectionUI();
}
function scrollDuringDrag() {
  dragScrollFrame = null;
  const drag = dragSelection;
  if (!drag?.active) return;
  const bounds = UI.tracks.getBoundingClientRect();
  const edge = 55;
  let delta = 0;
  if (drag.y > bounds.bottom - edge && drag.y < bounds.bottom + 40) delta = 10 + Math.max(0, drag.y - (bounds.bottom - edge)) / 3;
  else if (drag.y < bounds.top + edge && drag.y > bounds.top - 40) delta = -(10 + Math.max(0, (bounds.top + edge) - drag.y) / 3);
  if (delta) {
    const zone = delta > 0 ? 'bottom' : 'top';
    if (drag.edgeZone !== zone) {
      drag.edgeZone = zone;
      drag.edgeSince = performance.now();
    }
    if (performance.now() - drag.edgeSince >= 380) {
      const before = UI.tracks.scrollTop;
      UI.tracks.scrollTop += delta;
      if (UI.tracks.scrollTop !== before) applyDraggedInterval(itemAtPointer(drag.x, drag.y));
    }
  } else {
    drag.edgeZone = '';
    drag.edgeSince = 0;
  }
  dragScrollFrame = requestAnimationFrame(scrollDuringDrag);
}

UI.tracks.addEventListener('click', event => {
  if (suppressClickAfterDrag) {
    event.preventDefault();
    setTimeout(() => syncSelectionUI(), 0);
    return;
  }
  const row = event.target.closest('li[data-visible-index]');
  if (!row || !UI.tracks.contains(row)) return;
  clickSelection(Number(row.dataset.visibleIndex), event.shiftKey);
});
UI.tracks.addEventListener('pointerdown', event => {
  if (running || loading || event.pointerType !== 'mouse' || event.button !== 0 || event.shiftKey) return;
  const row = event.target.closest('li[data-visible-index]');
  if (!row || !UI.tracks.contains(row)) return;
  const files = visible();
  const index = Number(row.dataset.visibleIndex);
  if (!files[index]) return;
  dragSelection = {
    pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    originX: event.clientX, originY: event.clientY,
    files, original: files.map(t => !!t.selected),
    startIndex: index, lastIndex: index,
    targetValue: !files[index].selected, active: false, edgeZone: '', edgeSince: 0
  };
});
document.addEventListener('pointermove', event => {
  const drag = dragSelection;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!(event.buttons & 1)) { cancelSelectionDrag(); return; }
  drag.x = event.clientX;
  drag.y = event.clientY;
  const index = itemAtPointer(event.clientX, event.clientY);
  if (!drag.active) {
    if (index === drag.startIndex && Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) < 6) return;
    drag.active = true;
    UI.tracks.classList.add('drag-selecting');
    drag.lastIndex = -1;
    dragScrollFrame = requestAnimationFrame(scrollDuringDrag);
  }
  event.preventDefault();
  if (index >= 0) applyDraggedInterval(index);
});
function finishSelectionPointer(event) {
  if (!dragSelection || dragSelection.pointerId !== event.pointerId) return;
  const dragged = dragSelection.active;
  cancelSelectionDrag();
  if (dragged) {
    suppressClickAfterDrag = true;
    syncSelectionUI();
    setTimeout(() => { suppressClickAfterDrag = false; }, 0);
  }
}
document.addEventListener('pointerup', finishSelectionPointer);
document.addEventListener('pointercancel', finishSelectionPointer);

function showPage(data, url, mode) {
  currentData = data;
  currentMode = mode;
  currentUrl = url;
  UI.pageUrl.value = url;
  UI.pageInfo.hidden = false;
  UI.pageTitle.textContent = data.title;
  UI.openPage.href = url;
  UI.foundCount.textContent = `${data.tracks.length} ${mode === 'soundcloud' ? (data.tracks.length === 1 ? 'faixa' : 'faixas') : (data.tracks.length === 1 ? 'arquivo' : 'arquivos')}`;
  UI.sourceDescription.textContent = mode === 'kh' ? 'Reconhecimento especializado KHInsider' :
    mode === 'soundcloud' ? 'Metadados oficiais da playlist SoundCloud' : 'Detecção genérica de áudio';
  UI.mode.textContent = mode === 'kh' ? 'KHInsider reconhecido' :
    mode === 'soundcloud' ? 'SoundCloud reconhecido' : 'Detecção universal';
  UI.mode.className = `pill ${mode === 'kh' ? 'special' : mode === 'soundcloud' ? 'special' : 'generic'}`;
  UI.folder.value = data.folder;
  setFormats(data);
  // Prioriza FLAC se houver; se não houver, mantém 'any' ou M4A/MP3
  UI.format.value = [...UI.format.options].some(op => op.value === 'flac') ? 'flac' :
    [...UI.format.options].some(op => op.value === 'any') ? 'any' :
    UI.format.options[0]?.value || 'any';
  renderTracks();
  updateControls();
}
function mergeGeneric(data, url) {
  if (!data?.tracks || !Array.isArray(data.tracks)) return;
  const old = new Map(tracks.map(t => [t.url || t.id, t]));
  const incoming = data.tracks.filter(t =>
    t && (typeof t.url === 'string' || t.id) && typeof t.title === 'string');
  const merged = incoming.map(t => {
    const key = t.url || t.id;
    const previous = old.get(key);
    if (!previous) {
      return { ...t, selected: t.selected ?? true, state: t.state || 'Pendente', error: '' };
    }
    return { ...previous, ...t, selected: previous.selected, state: previous.state, error: previous.error };
  });
  if (currentMode === 'generic' && currentUrl === url) {
    const added = new Set(merged.map(t => t.url || t.id));
    for (const t of tracks) if (!added.has(t.url || t.id)) merged.push(t);
  }
  const previousFormat = currentUrl === url ? UI.format.value : null;
  const previousFolder = currentUrl === url ? UI.folder.value : '';
  tracks = merged;
  showPage({ ...data, tracks }, url, data.source === 'soundcloud' ? 'soundcloud' : 'generic');
  if (previousFolder) UI.folder.value = previousFolder;
  if (previousFormat && [...UI.format.options].some(op => op.value === previousFormat)) UI.format.value = previousFormat;
  renderTracks();
  updateControls();
}
function resetPage() {
  selectionAnchor = null;
  selectionAnchorValue = true;
  lastCompletedDownloadId = null;
  wrongFolderCount = 0;
  UI.showFile.hidden = true;
  currentUrl = '';
  currentMode = '';
  currentData = null;
  tracks = [];
  UI.pageInfo.hidden = true;
  UI.folder.value = '';
  UI.mode.textContent = 'Aguardando página';
  UI.mode.className = 'pill';
  UI.format.replaceChildren();
  UI.format.add(new Option('FLAC', 'flac'));
  renderTracks();
  updateControls();
}
async function getHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`O site respondeu HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > 8_000_000) throw new Error('Página grande demais para análise.');
    const html = await response.text();
    if (html.length > 8_000_000) throw new Error('Página grande demais para análise.');
    return html;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('O site não respondeu em 30 segundos.');
    throw err;
  } finally { clearTimeout(timeout); }
}
async function loadKh(url) {
  loading = true;
  const seq = ++readSerial;
  resetPage();
  setStatus('Lendo as faixas do KHInsider...', 'active');
  updateControls();
  try {
    const data = KHParser.readAlbum(await getHtml(url), url);
    if (seq !== readSerial) return;
    if (!data.tracks.length) throw new Error('Nenhuma faixa identificada. A página pode ter mudado.');
    tracks = data.tracks.map(t => ({ ...t, ext: 'mp3', selected: true, state: 'Pendente', error: '' }));
    showPage(data, url, 'kh');
    if (data.statedCount != null && data.statedCount !== tracks.length) {
      setStatus(`Detectei ${tracks.length} faixas; o site informa ${data.statedCount}. Confira a lista.`, 'warn');
    } else setStatus(`${tracks.length} faixas prontas para download.`, 'ok');
  } catch (err) {
    resetPage();
    setStatus(`Não foi possível analisar o álbum: ${err.message}`, 'error');
  } finally { loading = false; updateControls(); }
}
async function loadSoundCloud(url, tabId = null) {
  loading = true;
  const seq = ++readSerial;
  resetPage();
  setStatus('Lendo faixas e metadados do SoundCloud...', 'active');
  updateControls();
  try {
    const data = await SoundCloudApi.loadPlaylist(tabId, url);
    if (seq !== readSerial) return;
    mergeGeneric(data, url);
    const count = data.tracks.length;
    setStatus(`SoundCloud identificado: ${count} ${count === 1 ? 'faixa pronta' : 'faixas prontas'} para download com títulos originais.`, 'ok');
  } catch (err) {
    resetPage();
    setStatus(`Não foi possível analisar o SoundCloud: ${err.message}`, 'error');
  } finally {
    loading = false;
    updateControls();
  }
}
async function scanActiveTab(tabId, pageUrl) {
  loading = true;
  const seq = ++readSerial;
  resetPage();
  setStatus('Detectando arquivos de áudio na aba...', 'active');
  updateControls();
  try {
    if (SoundCloudApi.isSoundCloudUrl(pageUrl)) {
      await loadSoundCloud(pageUrl, tabId);
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['naming.js', 'generic.js', 'content.js'] });
    const result = await chrome.tabs.sendMessage(tabId, { type: 'UNIVERSAL_AUDIO_SCAN' });
    if (seq !== readSerial) return;
    mergeGeneric(result, pageUrl);
    setStatus(tracks.length ? `Encontrei ${tracks.length} arquivos. Continuarei detectando novos links nesta aba.` : 'Nenhum arquivo direto encontrado. Reproduza/expanda a lista no site e clique em Reanalisar.', tracks.length ? 'ok' : 'warn');
  } catch (err) {
    resetPage();
    setStatus(`Não consegui analisar esta aba: ${err.message}. Abra uma página HTTP(S) e clique no ícone da extensão.`, 'error');
  } finally { loading = false; updateControls(); }
}
async function loadManualGeneric(url) {
  loading = true;
  const seq = ++readSerial;
  resetPage();
  setStatus('Lendo a página informada...', 'active');
  updateControls();
  try {
    const html = await getHtml(url);
    if (seq !== readSerial) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const data = AudioScanner.read(doc, url);
    mergeGeneric(data, url);
    setStatus(tracks.length ? `Localizei ${tracks.length} arquivos diretos no HTML.` : 'Nenhum áudio direto no HTML. Abra o site no Chrome e clique no ícone da extensão para analisar a página carregada.', tracks.length ? 'ok' : 'warn');
  } catch (err) {
    resetPage();
    setStatus(`Não foi possível ler a página: ${err.message}`, 'error');
  } finally { loading = false; updateControls(); }
}
function loadTypedUrl(raw) {
  if (running || loading) return;
  let url;
  try { url = safeUrl(raw); } catch (err) { setStatus(err.message, 'error'); return; }
  const album = khAlbum(url);
  if (album) { loadKh(album); return; }
  if (SoundCloudApi.isSoundCloudUrl(url)) {
    loadSoundCloud(url, sourceTabId);
    return;
  }
  if (sourceTabId != null && sourceTabUrl && url === safeUrl(sourceTabUrl)) { scanActiveTab(sourceTabId, url); return; }
  const originPattern = `${new URL(url).origin}/*`;
  chrome.permissions.request({ origins: [originPattern] })
    .then(granted => {
      if (granted) return loadManualGeneric(url);
      setStatus('O acesso ao site não foi permitido. Abra-o no Chrome e clique no ícone da extensão.', 'warn');
    })
    .catch(err => setStatus(`Permissão recusada ou indisponível: ${err.message}`, 'error'));
}
async function managedDownload(url, filename) {
  const result = await chrome.runtime.sendMessage({ type: 'UMD_DOWNLOAD', url, filename });
  if (!Number.isInteger(result?.id)) throw new Error(result?.error || 'Não foi possível iniciar o download.');
  return result.id;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function waitDownload(id) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      if (finished) return false;
      finished = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(changed);
      return true;
    };
    const changed = e => {
      if (e.id !== id || !e.state) return;
      if (e.state.current === 'complete' && cleanup()) resolve();
      if (e.state.current === 'interrupted' && cleanup()) reject(new Error(e.error?.current || 'Download interrompido.'));
    };
    const timeout = setTimeout(() => { if (cleanup()) reject(new Error('Download excedeu 20 minutos.')); }, 20 * 60 * 1000);
    chrome.downloads.onChanged.addListener(changed);
    chrome.downloads.search({ id }).then(items => {
      if (finished) return;
      const item = items[0];
      if (item?.state === 'complete' && cleanup()) resolve();
      if (item?.state === 'interrupted' && cleanup()) reject(new Error(item.error || 'Download interrompido.'));
    }).catch(err => { if (cleanup()) reject(err); });
  });
}
function savedToFolder(actualPath, folder) {
  if (!folder || !actualPath) return true;
  const path = actualPath.replace(/\\/g, '/');
  const parent = path.slice(0, path.lastIndexOf('/')).toLocaleLowerCase();
  return parent.endsWith(`/${folder}`.toLocaleLowerCase());
}
async function checkFolderLocation(id, folder, track) {
  if (!folder) return true;
  const files = await chrome.downloads.search({ id });
  const actual = files?.[0]?.filename;
  if (!actual || !savedToFolder(actual, folder)) {
    wrongFolderCount++;
    const details = actual ? `Destino real: ${actual}` : 'O Chrome não informou o destino do arquivo.';
    track.error = `Arquivo não foi salvo na pasta ${folder}. ${details}`;
    return false;
  }
  return true;
}

async function verifyAndCreateFolder(folder) {
  if (!folder) return;
  setStatus(`Preparando e verificando a pasta “${folder}”...`, 'active');
  const file = `__verificacao_pasta_${Date.now()}.txt`;
  const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent('Arquivo temporário de verificação da Universal Music Downloader.');
  const id = await managedDownload(url, `${folder}/${file}`);
  await waitDownload(id);
  const [record] = await chrome.downloads.search({id});
  const actual = record?.filename || '';
  const ok = !!actual && savedToFolder(actual, folder);
  try {
    await chrome.downloads.removeFile(id);
    await chrome.downloads.erase({id});
  } catch { /* O arquivo de teste pode permanecer, sem afetar as músicas. */ }
  if (!ok) {
    throw new Error(`O Chrome ignorou a pasta “${folder}”. ${actual ? `Salvou o teste em: ${actual}` : 'Não foi possível identificar o destino.'} Abra chrome://settings/downloads, desative “Perguntar onde salvar cada arquivo” e desative temporariamente outras extensões de download.`);
  }
  setStatus(`Pasta verificada: ${folder}. Iniciando músicas...`, 'ok');
}

async function downloadOne(track, folder, format) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (stopRequested && attempt > 1) { updateTrackState(track, 'Pendente'); return; }
    let blobToRevoke = null;
    try {
      let audioUrl = track.url;
      if (currentMode === 'kh') {
        updateTrackState(track, 'Localizando');
        audioUrl = KHParser.discoverMedia(await getHtml(track.url), track.url, format);
      } else if (currentMode === 'soundcloud' || track.media || track.soundcloudTrackId) {
        updateTrackState(track, 'Localizando');
        const sc = await SoundCloudApi.resolveAudio(track, format, (pct) => {
          updateTrackState(track, `Baixando ${pct}`);
        }, () => stopRequested);
        audioUrl = sc.url;
        if (sc.blobUrl) blobToRevoke = sc.blobUrl;
        if (sc.ext) track.ext = sc.ext;
      }
      const file = currentMode === 'kh'
        ? KHParser.fileNameFromUrl(audioUrl)
        : AudioScanner.getName({ url: audioUrl, ext: track.ext, title: track.title });
      const path = folder ? `${folder}/${file}` : file;

      updateTrackState(track, 'Baixando');
      const id = await managedDownload(audioUrl, path);
      if (!Number.isInteger(id)) throw new Error('O Chrome não iniciou o download.');
      await waitDownload(id);
      lastCompletedDownloadId = id;
      UI.showFile.hidden = false;
      if (!await checkFolderLocation(id, folder, track)) {
        updateTrackState(track, 'Erro', track.error);
        stopRequested = true;
        return;
      }
      updateTrackState(track, 'Concluído');
      return;
    } catch (err) {
      if (attempt === 3) { updateTrackState(track, 'Erro', err.message); return; }
      updateTrackState(track, `Tentativa ${attempt + 1}/3`, err.message);
      await delay(1100 * attempt);
    } finally {
      if (blobToRevoke) {
        try { URL.revokeObjectURL(blobToRevoke); } catch {}
      }
    }
  }
}

async function startDownloads() {
  if (loading || running || !currentData) return;
  wrongFolderCount = 0;
  const queue = selected().filter(t => t.state !== 'Concluído');
  if (!queue.length) return;
  const folder = UI.useFolder.checked ? AudioScanner.sanitize(UI.folder.value.trim() || currentData.folder, 'Músicas').slice(0, 90) : '';
  UI.folder.value = folder || UI.folder.value;
  const format = UI.format.value;
  running = true;
  stopRequested = false;
  updateControls();
  renderTracks();
  try {
    if (folder) await verifyAndCreateFolder(folder);
    const concurrency = Math.min(Math.max(Number(UI.parallel.value) || 1, 1), 4, queue.length);
    let cursor = 0;
    let started = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (!stopRequested) {
        const index = cursor++;
        if (index >= queue.length) break;
        const track = queue[index];
        started += 1;
        setStatus(`Baixando arquivos: ${started} de ${queue.length} iniciados (até ${concurrency} simultâneos).`, 'active');
        await downloadOne(track, folder, format);
        if (!stopRequested) await delay(concurrency === 1 ? 650 : 300);
      }
    });
    await Promise.all(workers);
    const complete = queue.filter(t => t.state === 'Concluído').length;
    const errors = queue.filter(t => t.state === 'Erro').length;
    if (wrongFolderCount) setStatus(`Interrompido: ${wrongFolderCount} arquivo(s) fora da pasta. Consulte o erro indicado na faixa e outras extensões de download.`, 'error');
    else if (stopRequested) setStatus(`Fila interrompida após os downloads que já estavam ativos. ${complete} de ${queue.length} concluídos.`, 'warn');
    else if (errors) setStatus(`${complete} concluídos, ${errors} com erro. Use o botão para tentar os pendentes.`, 'error');
    else setStatus(`Concluído: ${complete} arquivos salvos em Downloads${folder ? ` / ${folder}` : ''}.`, 'ok');
  } catch (err) {
    setStatus(`Pasta não confirmada — downloads não iniciados. ${err.message}`, 'error');
  } finally {
    running = false;
    updateControls();
    renderTracks();
  }
}
async function reanalyze() {
  if (running || loading || !currentUrl) return;
  const album = khAlbum(currentUrl);
  if (album) { await loadKh(album); return; }
  if (SoundCloudApi.isSoundCloudUrl(currentUrl)) {
    await loadSoundCloud(currentUrl, sourceTabId);
    return;
  }
  if (sourceTabId != null && currentUrl === sourceTabUrl) {
    await scanActiveTab(sourceTabId, currentUrl);
    return;
  }
  await loadManualGeneric(currentUrl);
}

UI.urlForm.addEventListener('submit', event => { event.preventDefault(); loadTypedUrl(UI.pageUrl.value); });
UI.start.addEventListener('click', startDownloads);
UI.stop.addEventListener('click', () => { stopRequested = true; updateControls(); setStatus('Parando após finalizar os downloads em andamento...', 'active'); });
UI.refresh.addEventListener('click', reanalyze);
UI.showFile.addEventListener('click', () => {
  if (lastCompletedDownloadId != null) chrome.downloads.show(lastCompletedDownloadId);
});
UI.useFolder.addEventListener('change', updateControls);
UI.format.addEventListener('change', () => {
  selectionAnchor = null;
  if (currentMode === 'kh') for (const t of tracks) { t.state = 'Pendente'; t.error = ''; }
  renderTracks();
  updateControls();
});
UI.selectAll.addEventListener('click', () => {
  selectionAnchor = null;
  for (const t of visible()) t.selected = true;
  renderTracks(); updateControls();
});
UI.selectNone.addEventListener('click', () => {
  selectionAnchor = null;
  for (const t of visible()) t.selected = false;
  renderTracks(); updateControls();
});
UI.selectInvert.addEventListener('click', () => {
  selectionAnchor = null;
  for (const t of visible()) t.selected = !t.selected;
  renderTracks(); updateControls();
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'UNIVERSAL_AUDIO_UPDATE' || sender.tab?.id !== sourceTabId ||
      running || loading || currentMode !== 'generic' || currentUrl !== sourceTabUrl) return;
  if (!message.payload || !Array.isArray(message.payload.tracks)) return;
  const before = tracks.length;
  mergeGeneric(message.payload, currentUrl);
  if (tracks.length > before) setStatus(`Mais ${tracks.length - before} arquivos detectados automaticamente. Total: ${tracks.length}.`, 'ok');
});

resetPage();
if (sourceTabUrl) {
  UI.pageUrl.value = sourceTabUrl;
  const album = khAlbum(sourceTabUrl);
  if (album) loadKh(album);
  else if (SoundCloudApi.isSoundCloudUrl(sourceTabUrl)) loadSoundCloud(sourceTabUrl, sourceTabId);
  else if (sourceTabId != null && /^https?:\/\//i.test(sourceTabUrl)) scanActiveTab(sourceTabId, safeUrl(sourceTabUrl));
  else setStatus('O Chrome não permite analisar esta página. Abra um site HTTP(S).', 'warn');
}
