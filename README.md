# Universal Music Downloader (v3.4.0)

Extensão para navegadores baseados em Chromium (Brave, Google Chrome, Edge) que permite baixar áudios e trilhas sonoras completas com facilidade, organização automática em pastas e suporte a múltiplos formatos.

## 🚀 Recursos Principais
- **KHInsider + Leitura Genérica de Áudio:** Suporte nativo para o catálogo de trilhas de videogames do KHInsider e detecção inteligente de áudios em outras páginas.
- **Preferência por FLAC:** Seleciona automaticamente a melhor qualidade disponível (FLAC como padrão quando houver, ou MP3).
- **Organização Inteligente de Pastas:** Salva com a estrutura `[Ano] - [Nome do jogo]` (removendo sufixos redundantes como "Original Soundtrack").
- **Validação de Destino:** Cria e valida a pasta de destino antes de iniciar a fila de downloads para evitar poluir a pasta padrão de Downloads.
- **Seleção Avançada:** Seleção por Shift, Ctrl, arrasto e botões rápidos (*Selecionar Todos* / *Nenhum* / *Inverter*).
- **Downloads Paralelos:** Controle de 1 a 4 downloads simultâneos, com acompanhamento em tempo real e opção de interrupção.

---

## 📦 Como Instalar no Brave / Chrome

1. Baixe ou clone este repositório.
2. Abra o navegador e acerte para:
   - No Brave: `brave://extensions`
   - No Chrome: `chrome://extensions`
3. Ative o **Modo do desenvolvedor** (no canto superior direito).
4. Clique em **Carregar sem compactação** (ou *Load unpacked*).
5. Selecione a pasta deste repositório onde se encontra o arquivo `manifest.json`.

---

## 🛠️ Permissões Utilizadas
- `activeTab` / `scripting`: Para inspecionar e extrair links de áudio da página em reprodução.
- `downloads`: Para gerenciar a fila de download e criar subpastas.
- `storage`: Para salvar preferências de usuário (qualidade preferida, limite de conexões paralelas).
