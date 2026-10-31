# Bomberman Land 3 (SLPM-62643) — notas de engenharia reversa

## Disco
- BIN MODE2/2352, 1 trilha. `tools/bin2iso.py` converte para ISO 2048 (offset 24 em cada setor).
- Boot: `SLPM_626.43` (ELF PS2). `CDROM.MAP` = tabela C `mapFile[127]` {nome, setor ini, setor fim, nº setores}
  -> **o jogo carrega arquivos por setor fixo**. Reinserir arquivo maior = patch dessa tabela no ELF (ou manter tamanho).

## Texto
| Local | Formato | Status |
|---|---|---|
| `MSG.MGC` (198 linhas) | `chave\tTEXTO_SJIS\r\n`, quebra = `\n` literal | texto puro, menus/sistema |
| `OVL/*.BIN`, `SLPM_626.43` | strings SJIS embutidas (ponteiros) | menus de minigames, opções |
| `CDDATA*.DIG` | arquivo + dados **comprimidos** | provável roteiro/diálogos |

## Formato .DIG (RESOLVIDO)
- Header: registros de 16 bytes até um registro todo zero:
  `u32 setor_ini, u32 setores_descomp, u32 n_subarquivos, u32 setores_comp` (comp == 0 -> armazenado cru)
- ID de recurso no jogo: `(indice_entrada << 4) | indice_arquivo_DIG` (tabela de nomes @ 0x2bd2f0, headers carregados em 0x372da0).
- Entrada descomprimida começa com `n_subarquivos` registros de 16 bytes: `u32 tipo, u32 tamanho, u32 offset, u32 0`.
- Ferramentas: `tools/digcomp.py` (descompressor), `tools/dig_extract.py ARQ.DIG SAIDA/` (gera eNNNN.bin, eNNNN/sMM_tTIPO.bin, index.tsv).

### Compressão (SLPM_626.43)
| Endereço | Função |
|---|---|
| 0x12a1b0 | thread de CD; switch no tipo de comando (tabela @ 0x2c9a60), caso 5 = leitura comprimida @ 0x12a3a8 |
| 0x12a010 | init (dest, tamanho), zera cursores[256] @ 0x356000 |
| 0x12a070 | decodifica um bloco (buf, len); blocos de 0x9000 bytes |
| 0x12a050 | flush do cache |
| 0x12a910 | enfileira comando tipo 5 |

Algoritmo: tokens de 9 bits LSB-first. bit8=1 -> literal (bits0-7). bit8=0 -> cópia de `(bits0-2)+1` bytes
a partir de `hist[ctx][bits3-7]` (posição absoluta na saída). Após cada token: `hist[ctx][cur[ctx]++ & 31] = pos_inicio_token`,
`ctx = último byte escrito` (inicia em 0). 0x9000 bytes = 32768 tokens exatos, então os blocos não quebram tokens.

Recompressor: para reinserir basta gerar tokens válidos. O caminho mais simples é tudo literal (9/8 do tamanho), e o ideal é um
encoder guloso que procura o maior match entre as 32 posições de hist[ctx].

## Ferramentas de RE
- `traducao/.venv` com capstone. `tools/elfdis.py ELF ENDERECO_HEX [N]` desmonta (R5900 aparece como lixo MSA em sq/lq: ignorar).
## Fonte
- `FONT.MRG` = contêiner MGFD0131 com `font.tm2` (TIM2, ~10 KB) -> pequeno, verificar se é a fonte do diálogo.
- PT-BR precisa de á à â ã é ê í ó ô õ ú ç: substituir glifos não usados.

## Extração validada
| Arquivo | Entradas | Subarquivos | Descomp. |
|---|---|---|---|
| CDDATA.DIG | 1187 | 9754 | 508 MB |
| CDDATA0.DIG | 65 | 3757 | 151 MB |
| CDDATA1.DIG | 80 | 159 | 14 MB |
| CDDATA2.DIG | 707 | 707 | 663 MB |
| CDDATA4.DIG | 170 | 6712 | 261 MB |
| CDDATA5.DIG | 1 | 258 | 4 MB |
- Todas as entradas descomprimem no tamanho exato; nenhum subarquivo fora dos limites.
- Diálogo NÃO está em Shift-JIS nos .DIG: usa índices de glifo (ver "Codificação dos diálogos").
- Para refazer: `python3 tools/bin2iso.py JOGO.bin game.iso`, `7z x game.iso -oiso`, `python3 tools/dig_extract.py iso/CDDATA.DIG dig/CDDATA`.

## Codificação dos diálogos
### Rotinas de texto no ELF
| Endereço | Função |
|---|---|
| 0x1fef70 | imprime string SJIS terminada em 0 com a fonte do sistema (0x0a = quebra). Usada por menus/MSG.MGC/debug |
| 0x1ff260 | isSJISLead(c): 0x81-0x9f, 0xe0-0xfc |
| 0x1ff2a0 | lê u16 big-endian |
| 0x1ff380 | SJIS -> código interno (<0x889f: 0x1ff3f0 com tabela @ 0x32f9a0; nível 1: 0x1ff4d0 -> 0x1000+; nível 2: 0x1ff550 -> 0x2000+) |
| 0x1ff2c0 | código interno -> metadados do glifo (22 bytes/glifo; tabelas em gp-0x6128/-0x612c/-0x6130) |
| 0x1ff630 | ASCII meia-largura -> SJIS |

### Fonte por cena ("glyph table"), dentro dos .DIG
```
u16 0, u16 1, u16 count, u16 tex_w, u16 tex_h, u16 cell_w, u16 cell_h, u16 0
count x { u16 index, u8 sjis[2] (big-endian), u16 advance, u16 0 }
```
- Só contém os glifos usados pelo texto (24x24 ou 16x16). A textura vem logo antes, como outro subarquivo (pacote GS).
- 60 fontes distintas no disco.

### Tabela de strings
```
u32 count, u32 offset[count] (a partir do início da tabela)
strings: u16 LE; < 0x8000 = índice de glifo; >= 0x8000 = controle
```
Mapeados a partir do renderizador de strings de glifo **0x14d050** (lê u16 via 0x14c310; bit 15 = controle)
e da expansão de variáveis **0x14f5d0** (roda antes do desenho). Tag = como aparece em `dialogos_jp.tsv` (`textscan.CONTROL`).

| Código | Tag | Efeito (handler) | Uso no texto |
|---|---|---|---|
| 0x8000 | (fim) | fim da string | — |
| 0x8001 | `\n` | quebra de linha: x = margem (+0x16), y += altura (+0x28); centraliza se flag 0x4c&1 | — |
| 0x8036 | `{PAG}` | quebra de página: espera botão e limpa a janela (contador 0x14e7b0, fim/próxima 0x14e720) | 1565 |
| 0x8006 | `{TAM:1}` | tamanho normal (modo 0) | 63 |
| 0x8005 / 0x8007 / 0x8003 / 0x8004 | `{TAM:0.8}` / `{TAM:1.5}` / `{TAM:0.6}` / `{TAM:2}` | escala do glifo (0x14c8f0 ×8/10, 0x14c8c0 ×15/10, 0x14c940 ×6/10, 0x14c910 ×20/10) | 4 / 58 / 7 / 3 |
| 0x800A–0x800F, 0x8022, 0x8023 | `{COR:...}` | cor RGB do GS (0x80 = cheio): preto, vermelho, verde, azul, amarelo, rosa (80,20,80), laranja (80,20,00), branco | vermelho 168, azul 46, rosa 26, verde 24 |
| 0x8024 | `{COR}` | volta para a cor padrão da janela (+0x52..0x54) | 261 |
| 0x8033 / 0x8034 / 0x8035 | `{CONTORNO}` / `{CONTORNO:2}` / `{CONTORNO:3}` | liga contorno/sombra (flag sp+0x140, cor sp+0x150..0x170) | 304 / 0 / 0 |
| 0x8032 | `{CONTORNO:off}` | desliga contorno | 304 |
| 0x8009 / 0x8008 | `{ONDA}` / `{ONDA:off}` | texto ondulado (seno, fase += +0x34, 360°, constantes 45.0/70.0) | 109 / 103 |
| 0x8031 / 0x8038 / 0x8037 | `{ESP:1/2}` / `{ESP:1/4}` / `{ESP:1}` | avança x em ½, ¼ ou 1 glifo | 1 / 12 / 0 |
| 0x8021 | `{X8021}` | incrementa contador +0x38 (máx 32); nada no módulo de texto lê | 0 |
| 0x8025 | `{NOME}` | nome do jogador (save + 0x10b4, via 0x1969f0), expandido entre 0x8102/0x8103 | 149 |
| 0x8100 | `{VAR}` | texto do chamador, mesma fonte (lista em janela+0x30) | 113 |
| 0x8101 | `{VAR2}` | texto do chamador, segunda fonte (lista em janela+0x2c), entre 0x8102/0x8103 | 51 |
| 0x8102 / 0x8103 | `{FONTE2}` / `{FONTE1}` | troca para o 2º fluxo de glifos da janela (+0xc/+0x10) e volta; só gerado pela expansão | — |

Padrões no texto: `{CONTORNO}{COR:x}…{COR}{CONTORNO:off}` para destaque; `{TAM:1.5}…{TAM:1}`; `{ONDA}…{ONDA:off}`.
- Containers `C2B1` aparecem junto (cabeçalho de bloco de mensagem?).

### Ligação tabela de strings -> fonte (`tools/fontbind.py`)
| Endereço | Função |
|---|---|
| 0x144900 | getResource(id): `id = (entrada << 16) \| tipo_subarquivo`; nibble alto do tipo = índice do .DIG (0=CDDATA, 1=CDDATA0, 2=CDDATA1, 3=CDDATA2, 4=CDDATA4, 5=CDDATA5) |
| 0x144f10 | resolveGroup(g): devolve o 1º ID do grupo cuja entrada está carregada (testa com 0x144850) |
| 0x2bb280 | tabela de grupos: 1033 × `{u32 ptr_lista_ids, u32 n}`; cada lista = mesmo recurso em cada cena |
- Grupos de diálogo dos mapas: strings 1010 -> textura 1011 -> fonte 1012; strings 1013 -> textura 1014 -> fonte 1015.
  O pareamento é coluna a coluna, e **a fonte está sempre na mesma entrada** da tabela de strings (25/25).
- O resto (menus, minigames, overlays) é ligado em código espalhado por módulo/overlay, sem tabela única.
- Hipótese descartada: a ordem dos glifos seguir a ordem de aparição no texto (a maioria das tabelas tem saltos).
- Regra usada (`bind()`):
  1. grupos do ELF ('elf', 50 tabelas, exato);
  2. demais: pontuação de um modelo de bigramas (treinado no texto 'elf' + MSG.MGC) + bônus de fonte local (+1)
     + bônus de encaixe exato `count == maior_índice + 1` (+4). 'local' = fonte escolhida está na mesma entrada, 'lm' = de outra.
  3. `margin` = diferença para a melhor fonte que decodifica **diferente** (fontes idênticas repetidas por cena não contam).

### Dump
- `tools/textscan.py DIG_OUT SLPM_626.43 MSG.MGC dialogos_jp.tsv`
  colunas: archive, entry, file, id, string_res, font_res, method, margin, text.
- 12.413 strings, 186 tabelas, 0 glifos desconhecidos. elf 3.238 | local 4.603 | lm 4.572.
- Margin < 0,5 = 52 tabelas (1.784 strings), mas quase todas corretas (o rival é uma fonte quase igual).
- **Ainda erradas (~85 strings, < 1%)**:
  - lixo: `00e20038` (50), `02320004` (16), `012d0006` (2);
  - 1–2 caracteres trocados: `00221016`/`00321022`/`00331008`, `00191007`, `01290002`/`012a0002`, `00081034`, `018c000c`.
  - Resolver achando no overlay correspondente qual fonte essas telas carregam (são de minigames/menus).

### Implicação para a tradução
- Cada cena tem fonte própria só com os glifos usados: para PT-BR é preciso **regerar fonte + textura** por cena (ou trocar para uma fonte latina compartilhada).
- Texto latino em 16x16/24x24 de largura fixa fica largo; o campo `advance` permite largura proporcional.

## Reinserção (`tools/encode.py`)
```
python3 tools/encode.py DIG_OUT ISO_ROOT game.iso traduzido.tsv saida/ [--ttf FONTE] [--no-reuse]
```
- Entrada: `dialogos_jp.tsv` + coluna `pt` (vazia = mantém o original). Sintaxe: `\n`, tags de `textscan.CONTROL`, `{XXXX}` código cru, `{?n}` glifo cru.
- Saída: `saida/Bomberman Land 3 (PT-BR).iso`, os `.DIG` novos e `encode.log`.
- Teste de referência: `teste/teste_pt.tsv` (5 strings minhas) -> `teste/preview.png` (simulação do renderizador com a textura reconstruída).

### Textura de fonte (subarquivo irmão da glyph table) — `tools/fonttex.py`
```
u32 pages, u32 chunks, u64 0
pages × bloco GIF 0x50 (TEX0 em +0x40: psm 0x14 = PSMT4, 0x13 = PSMT8; tbw 4)
pages × registro 20 B: u16 chunk_da_página, u16 0xffff, u32 -1, u16 chunk_da_CLUT, u16 0x0101, u32 0, u16 w_usado, u16 h_usado
chunks × transferência 16 B: u32 0, u32 rel (a partir do registro), u16 w32, u16 h32, u32 flag
dados alinhados em 0x40, na ordem das transferências; cada CLUT vem logo após a 1ª página que a usa
```
| Variante | chunks | Exemplo |
|---|---|---|
| PSMT4, CLUT única (16 cores, 8×2 words) | pages+1 | maioria (66 fontes) |
| PSMT4, CLUT por página | 2·pages | 0x200a7 |
| PSMT4, CLUTs compartilhadas em grupos | entre os dois | 0x2720001, 0x386000f (4 páginas, 6 chunks) |
| **PSMT8**, CLUT por página (256 cores, 16×16 words, ordem CSM1: bits 3 e 4 do índice trocados) | 2·pages | **0x1950003** (fonte colorida azul com contorno, 48 tabelas) |
- Página enviada como retângulo PSMCT32 w32×h32 em (0,0) de buffer com 128 words de largura: PSMT4 256×256 = 128×64; PSMT8 240×240 = 120×120.
  `gsswizzle.py` tem PSMT4, PSMT8 e PSMCT32. A última página pode ser parcial; o writer reescreve tudo com as dimensões da página 0.
- O `flag` da transferência não foi decifrado (0x80 = página PSMT4 cheia, 1 = CLUT 16 cores, 4 = CLUT 256, 0xfd = PSMT8 120×120): o writer copia o da página 0 / da CLUT.
- Glifo i: página i // por_pag, u = (i % cols)·cell, v = ((i % por_pag) // cols)·cell (renderizador @ 0x14d734).
- **Localização da textura** (`find_texture_in_dir`): subarquivo da mesma entrada com mesmo nº de páginas e largura, altura usada ≥ a necessária,
  **validado pelo conteúdo**: as células visíveis têm que ser exatamente os índices < count (`validate`). 70/70 fontes resolvidas.
  Altura usada maior que a mínima é normal (ex.: 0xae0021, 0xce002a, 0x2700004 têm 1 linha a mais).
  Para fontes ligadas pelo ELF, o grupo de textura (1011/1014) confirma: 0x386000f -> 0x386000e = `e0902/s14`.
- Reescrita: 48 texturas byte a byte idênticas; as outras 22 diferem só por terem última página parcial, e todas decodificam nos mesmos pixels e CLUTs.
- Glifos novos (`GlyphRenderer`): fonte "rampa" (uma cor, alpha crescente) recebe o alpha direto; fonte colorida copia o estilo dos glifos existentes,
  separados por brilho: preenchimento claro por linha (mantém o degradê), contorno escuro opaco de 1 px, borda suave escura semitransparente de 1 px.
  Na fonte colorida a letra nova fica menor que a original (Á + g + contorno precisam caber em 24 px).

### Regras do encoder
- Strings não traduzidas mantêm os códigos originais byte a byte.
- Glifos 0–12 nunca são reaproveitados (o código imprime dígitos direto por índice).
- Char novo vai para slot que nenhuma tabela ligada usa mais; depois anexa ao fim. `--no-reuse` só anexa.
- Chars novos Latin-1 ficam no campo sjis como `0x00XX` (o jogo desenha por índice; `parse_glyphs` lê de volta).
- Fonte nova: Noto Sans CJK JP Black, tamanho ajustado para `ÁÉÍÓÚÂÊÔÃÕÀÇgjpqy` caber na célula (16 px -> corpo 10, 20 -> 14, 24 -> 17).
- Só entram no .DIG os subarquivos cujos bytes mudaram (tabelas não traduzidas são idênticas), então uma fonte compartilhada
  por 48 tabelas não força reescrever as 26 entradas delas.
- Entrada reorganizada com alinhamento 16 (ou o maior alinhamento original até 128), recomprimida (`digcomp.compress`, ~1% menor que o original), anexada ao fim do .DIG.
- .DIG modificado é anexado ao fim do ISO; o registro de diretório (LBA/tamanho LE+BE) e o tamanho do volume no PVD são corrigidos. O jogo abre os .DIG pelo nome (comando 1 da thread de CD -> busca no diretório ISO).

### Verificação (`tools/verify.py`)
```
python3 tools/verify.py DIG_OUT game.iso "saida/Bomberman Land 3 (PT-BR).iso" traduzido.tsv [--all]
```
Lê o ISO como o jogo (diretório -> .DIG -> entrada), decodifica todas as strings das fontes tocadas e compara com `pt`/original,
valida as texturas reconstruídas e lista os setores alterados da imagem original. Sai com código 1 se algo diferir.
- Teste das 7 fontes antes recusadas (`teste/teste_7fontes_pt.tsv`): 2.699 strings, 0 diferenças; 7 texturas válidas;
  só os setores 0x10 e 0x16 mudam. Prévias em `teste/preview_7fontes.png` e `teste/preview_fonte_colorida.png`.

### Verificado
- Round-trip do ISO pelo diretório: 243/243 strings das tabelas afetadas corretas (5 traduzidas = `pt`, 238 idênticas), só os setores 0x10 (PVD) e 0x16 (diretório raiz) mudam dentro da imagem original, entradas não tocadas idênticas.
- Texturas: 23 fontes de páginas cheias são reescritas byte a byte idênticas.
### NÃO verificado / riscos
- **Não testado em emulador** (sem PCSX2 na máquina).
- Entrada maior que a original (ex.: e0005 +34 KB) e fonte com mais páginas podem estourar memória/VRAM da cena: o encoder avisa.
- O ISO cresce ~150 MB por .DIG modificado (o .DIG antigo fica como espaço morto): 744 MB no teste, acima de um CD de 700 MB. Ok para emulador.
- Quebra de linha/página é manual: o encoder não mede se a linha cabe na janela.
- A fonte do `{NOME}`/`{VAR2}` (2º fluxo de glifos da janela) não é reconstruída.
