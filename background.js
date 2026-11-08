'use strict';

// O download e a determinação final do nome são controlados no service worker.
// Somente downloads iniciados na própria interface podem ser redirecionados.
const pendingByUrl = new Map();
const pendingById = new Map();

function addJob(job) {
  const items = pendingByUrl.get(job.url) || [];
  items.push(job);
  pendingByUrl.set(job.url, items);
}
function forgetJob(job) {
  if (!job) return;
  if (job.id != null) pendingById.delete(job.id);
  const items = pendingByUrl.get(job.url);
  if (items) {
    const rest = items.filter(item => item !== job);
    if (rest.length) pendingByUrl.set(job.url, rest);
    else pendingByUrl.delete(job.url);
  }
}

chrome.action.onClicked.addListener(async tab => {
  const params = new URLSearchParams();
  if (typeof tab?.id === 'number') params.set('tab', String(tab.id));
  if (/^https?:\/\//i.test(tab?.url || '')) params.set('page', tab.url);
  const suffix = params.size ? `?${params}` : '';
  try { await chrome.tabs.create({ url: chrome.runtime.getURL(`index.html${suffix}`) }); }
  catch (err) { console.error('Não foi possível abrir a extensão:', err); }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'UMD_DOWNLOAD') return false;
  // Mensagens enviadas por content scripts em páginas externas são ignoradas.
  const ownUrl = chrome.runtime.getURL('');
  if (!sender.url?.startsWith(ownUrl)) {
    sendResponse({error: 'Solicitação de origem não autorizada.'});
    return false;
  }
  const {url, filename} = message;
  if (typeof url !== 'string' || !/^(?:https?:|data:text\/plain[,;])/i.test(url) ||
      typeof filename !== 'string' || !filename || filename.startsWith('/') ||
      filename.includes('\\') || filename.split('/').some(s => !s || s === '.' || s === '..')) {
    sendResponse({error:'Endereço ou nome de arquivo inválido.'});
    return false;
  }
  const job = {url, filename, id:null};
  addJob(job);
  chrome.downloads.download({url, filename, saveAs:false, conflictAction:'uniquify'})
    .then(id => {
      if (!Number.isInteger(id)) throw new Error('O Chrome não iniciou o download.');
      job.id = id;
      pendingById.set(id, job);
      sendResponse({id});
    })
    .catch(err => {
      forgetJob(job);
      sendResponse({error: err.message || 'Erro ao iniciar o download.'});
    });
  return true;
});

// Segunda oportunidade de impor o caminho. Outros gerenciadores/extensões
// ainda podem ter prioridade, razão pela qual a interface verifica o destino real.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let job = pendingById.get(item.id);
  if (!job) job = (pendingByUrl.get(item.url) || []).find(x => x.id == null || x.id === item.id);
  if (job) {
    job.id = item.id;
    pendingById.set(item.id, job);
    suggest({filename:job.filename, conflictAction:'uniquify'});
  } else suggest();
});

chrome.downloads.onChanged.addListener(delta => {
  if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
    forgetJob(pendingById.get(delta.id));
  }
});
