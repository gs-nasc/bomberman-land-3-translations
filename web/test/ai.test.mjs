// Unit tests for ai.js. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiError, batches, buildRequest, codeProblem, languageName, normalizeText, parseResponse } from '../ai.js';

test('codeProblem accepts the same codes in any order, plus or minus {PAG}', () => {
  const src = '{CONTORNO}{COR:vermelho}ボム{COR}{CONTORNO:off}を\\n{NOME}に{PAG}あげる';
  assert.equal(codeProblem(src, '{NOME} ganhou a {CONTORNO}{COR:vermelho}bomba{COR}{CONTORNO:off}!'), null);
  assert.equal(codeProblem(src, 'Dê a {CONTORNO}{COR:vermelho}bomba{COR}{CONTORNO:off}\\na {NOME}.{PAG}Pronto!{PAG}Ok'), null);
});

test('codeProblem rejects missing, extra, renamed codes and empty text', () => {
  assert.match(codeProblem('{NOME}さん', 'Olá!'), /faltando \{NOME\}/);
  assert.match(codeProblem('こんにちは', 'Olá, {NOME}!'), /sobrando \{NOME\}/);
  assert.match(codeProblem('{COR:vermelho}赤{COR}', '{COR:red}vermelho{COR}'), /faltando \{COR:vermelho\}.*sobrando \{COR:red\}/);
  assert.match(codeProblem('{VAR}個', '{VAR}{VAR} itens'), /sobrando/);
  assert.equal(codeProblem('あ', '  '), 'vazia');
});

test('normalizeText keeps line breaks as a literal \\n', () => {
  assert.equal(normalizeText('Olá\nmundo\r\nfim '), 'Olá\\nmundo\\nfim');
  assert.equal(normalizeText('já\\nliteral'), 'já\\nliteral');
});

test('batches keep game order and respect both limits', () => {
  const items = Array.from({ length: 95 }, (_, i) => ({ id: i, source: 'x'.repeat(i === 50 ? 4990 : 10) }));
  const b = batches(items, 40, 5000);
  assert.deepEqual(b.flat().map((x) => x.id), items.map((x) => x.id));
  assert.ok(b.every((x) => x.length <= 40));
  assert.ok(b.every((x) => x.length === 1 || x.reduce((a, y) => a + y.source.length, 0) <= 5000));
  assert.deepEqual(batches([]), []);
});

test('buildRequest numbers the batch from 1 and carries rules, language and team prompt', () => {
  const r = buildRequest('Use tom infantil.', 'pt', [{ id: 77, source: 'はい' }, { id: 9, source: '{NOME}!' }]);
  assert.deepEqual(JSON.parse(r.contents[0].parts[0].text), [{ id: 1, text: 'はい' }, { id: 2, text: '{NOME}!' }]);
  const sys = r.systemInstruction.parts[0].text;
  assert.match(sys, /into Portuguese/);
  assert.match(sys, /Use tom infantil\./);
  assert.match(sys, /\{PAG\}/);
  assert.equal(r.generationConfig.responseMimeType, 'application/json');
  assert.equal(languageName('es'), 'Spanish');
});

test('parseResponse maps ids back, skips thoughts, junk and unknown ids', () => {
  const data = { candidates: [{ content: { parts: [{ thought: true, text: 'pensando' }, { text: '[{"id":2,"text":"Oi\\n{NOME}"},{"id":1,"text":"Sim"},{"id":9,"text":"x"},{"id":1,"text":"dup"}]' }] } }] };
  const m = parseResponse(data, 2);
  assert.equal(m.get(0), 'Sim');
  assert.equal(m.get(1), 'Oi\\n{NOME}');
  assert.equal(m.size, 2);
  assert.equal(parseResponse({ candidates: [{ content: { parts: [{ text: '```json\n[{"id":1,"text":"ok"}]\n```' }] } }] }, 1).get(0), 'ok');
});

test('parseResponse throws AiError on empty or non-JSON answers', () => {
  assert.throws(() => parseResponse({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }, 1), (e) => e instanceof AiError && /SAFETY/.test(e.message));
  assert.throws(() => parseResponse({ candidates: [{ content: { parts: [{ text: 'desculpe' }] } }] }, 1), AiError);
  assert.throws(() => parseResponse({ candidates: [{ content: { parts: [{ text: '{"id":1}' }] } }] }, 1), /lista/);
});
