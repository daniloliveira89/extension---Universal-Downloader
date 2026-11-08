 'use strict';

// Simplificar o nome da pasta sem alterar o título exibido na página.
(() => {
  const cleanup = (title, year = '') => {
    let value = String(title || '').replace(/\s+/g, ' ').trim();
    if (year) {
      const escaped = String(year).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      value = value.replace(new RegExp(`^${escaped}\\s*[-–—:|]\\s*`), '')
        .replace(new RegExp(`\\s*\\(?${escaped}\\)?\\s*$`), '').trim();
    }
    // Ex.: "GOD OF WAR III: ORIGINAL SOUNDTRACK FROM THE VIDEO GAME".
    // A remoção precisa estar no FINAL para preservar subtítulos de jogos,
    // como "God of War: Ghost of Sparta".
    const edition = String.raw`(?:original|official|unofficial|complete|expanded|remastered|deluxe|video\s+game|game|the|playstation|ps\d)`;
    const format = String.raw`(?:soundtrack|ost|original\s+score|video\s+game\s+music|game\s+music|gamerip|game\s+rip)`;
    const suffix = new RegExp(String.raw`(?:\s*[:\-–—|]\s*|\s+|\s*\(\s*)` +
      String.raw`(?:${edition}\s+)*${format}(?:\s+(?:from|of|for)\s+(?:the\s+)?(?:video\s+)?game)?\s*\)?$`, 'i');
    const trailingYear = /\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/;
    const platform = /\s*[([]\s*(?:PS[1-5]|PSP|PS Vita|Nintendo Switch|Wii|Windows|PC|Xbox(?:\s+\w+)?|Gamerip|Game Rip)\s*[)\]]\s*$/i;
    for (let i = 0; i < 5; i++) {
      const before = value;
      value = value.replace(trailingYear, '').replace(platform, '').replace(suffix, '').trim();
      if (value === before) break;
    }
    return value.replace(/\s*[:\-–—|]\s*$/, '').trim() || String(title || '').trim();
  };
  globalThis.MusicNaming = { cleanup };
})();
