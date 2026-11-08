# Universal Music Downloader (v3.7.0)

Extensão para navegadores baseados em Chromium (Brave, Google Chrome, Edge) que permite baixar áudios e trilhas sonoras completas com facilidade, organização automática em pastas, suporte a múltiplos formatos e renomeação precisa.

## 🚀 Recursos Principais
- **SoundCloud (v3.7.0 Atualizado):** lê títulos originais e ordem completa das faixas de playlists e páginas do SoundCloud, permitindo o download direto de todas as músicas em alta qualidade (AAC 160k / M4A e MP3), sem restrições de "não liberadas".
- **KHInsider + Leitura Genérica de Áudio:** Suporte nativo para o catálogo de trilhas de videogames do KHInsider e detecção inteligente de áudios diretos em outras páginas web.
- **Preferência por FLAC / Alta Qualidade:** Seleciona automaticamente a melhor qualidade disponível (FLAC como padrão quando houver, ou MP3 / M4A AAC).
- **Renomeação Correta Automática:** Salva cada arquivo com o título original limpo, evitando nomes genéricos de hashes ou identificadores de URL.
- **Organização Inteligente de Pastas:** Salva com a estrutura `[Ano] - [Nome do jogo / Álbum]` (removendo sufixos redundantes como "Original Soundtrack").
- **Validação de Destino:** Cria e valida a pasta de destino antes de iniciar a fila de downloads para evitar poluir a pasta padrão de Downloads.
- **Seleção Avançada:** Seleção por Shift, Ctrl, arrasto e botões rápidos (*Selecionar Todos* / *Nenhum* / *Inverter*).
- **Downloads Paralelos:** Controle de 1 a 4 downloads simultâneos, com acompanhamento em tempo real e opção de interrupção.

---

## 📦 Como Instalar no Brave / Chrome / Edge

1. Abra o navegador e acesse a página de extensões:
   - No Chrome: `chrome://extensions`
   - No Brave: `brave://extensions`
   - No Edge: `edge://extensions`
2. Ative o **Modo do desenvolvedor** (no canto superior direito).
3. Remova ou desative qualquer versão anterior da extensão.
4. Clique em **Carregar sem compactação** (ou *Load unpacked*).
5. Selecione a pasta `Universal-Downloader-v3.7.0` onde se encontra o arquivo `manifest.json`.

---

## 🛠️ Permissões Utilizadas
- `activeTab` / `scripting`: Para inspecionar e extrair links e títulos de áudio da página em reprodução.
- `downloads`: Para gerenciar a fila de download e criar subpastas organizadas.
- `storage`: Para salvar preferências de usuário (qualidade preferida, limite de conexões paralelas).
- `host_permissions`: Para acessar os metadados e os fluxos de áudio de alta fidelidade do SoundCloud e KHInsider.
