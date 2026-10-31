# Bomberman Land 3 (SLPM-62643) — ferramentas de tradução PT-BR

Engenharia reversa e pipeline de tradução do Bomberman Land 3 (PS2, Japão).
O jogo não está incluído: é preciso ter a própria cópia do disco.

Detalhes de formatos, endereços no executável e decisões em [NOTAS.md](NOTAS.md).

## Preparação

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
python3 tools/bin2iso.py "Bomberman Land 3 (Japan).bin" game.iso
7z x game.iso -oiso
for d in CDDATA CDDATA0 CDDATA1 CDDATA2 CDDATA4 CDDATA5; do python3 tools/dig_extract.py iso/$d.DIG dig/$d; done
```

## Fluxo

| Passo | Ferramenta |
|---|---|
| Extrair o texto para TSV | `tools/textscan.py dig iso/SLPM_626.43 iso/MSG.MGC dialogos_jp.tsv` |
| Traduzir | preencher a coluna `pt` (tags em `textscan.CONTROL`) |
| Gerar o ISO traduzido | `tools/encode.py dig iso game.iso traduzido.tsv saida/` |
| Conferir | `tools/verify.py dig game.iso "saida/Bomberman Land 3 (PT-BR).iso" traduzido.tsv` |

## Ferramentas

| Arquivo | Função |
|---|---|
| `tools/digcomp.py` | compressão LZ dos `.DIG` (descompressor e compressor) |
| `tools/dig_extract.py` | extrai entradas e subarquivos dos `.DIG` |
| `tools/textscan.py` | decodifica tabelas de strings e fontes por cena |
| `tools/fontbind.py` | liga cada tabela de strings à sua fonte |
| `tools/fonttex.py`, `tools/gsswizzle.py` | texturas de fonte (PSMT4/PSMT8, swizzle do GS) e glifos novos |
| `tools/encode.py` | reinsere a tradução e gera o ISO |
| `tools/verify.py` | confere o ISO gerado contra o TSV |
| `tools/elfdis.py`, `tools/idsearch.py`, `tools/sjisscan.py` | apoio à engenharia reversa |
