// Unit tests for sources.js. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigrams, buildIndex, copiesOf, dice, normSource, parseCategories, pickSuggestions, similarTo } from '../sources.js';

test('normSource drops codes, line breaks and extra spaces', () => {
  assert.equal(normSource('{CONTORNO}{COR:verde}△{COR}{CONTORNO:off}ボタンで\\n　セーブ'), '△ ボタンで セーブ');
  assert.equal(normSource('{PAG}\\n'), '');
  assert.equal(normSource(null), '');
});

test('bigrams and dice', () => {
  assert.deepEqual([...bigrams('あいう')], ['あい', 'いう']);
  assert.deepEqual([...bigrams('あ')], ['あ']);
  assert.equal(bigrams('').size, 0);
  assert.equal(dice(bigrams('セーブ'), bigrams('セーブ')), 1);
  assert.equal(dice(bigrams('セーブ'), bigrams('ダミー')), 0);
  assert.equal(dice(new Set(), bigrams('ダミー')), 0);
  assert.equal(dice(bigrams('abcd'), bigrams('abce')), 2 * 2 / 6);
});

const rows = [
  { id: 1, block_id: 10, source: 'レッドピース' },
  { id: 2, block_id: 11, source: 'レッドピース' },
  { id: 3, block_id: 12, source: 'レッドピース' },
  { id: 4, block_id: 10, source: 'ブルーピース' },
  { id: 5, block_id: 10, source: '{PAG}' },
  { id: 6, block_id: 13, source: '{PAG}' },
  { id: 7, block_id: 13, source: 'こちらでは【コーヒーカップ】が楽しめます！' },
  { id: 8, block_id: 14, source: 'こちらでは【フライトタワー】が楽しめます！' },
  { id: 9, block_id: 14, source: 'まったく関係ない文章です' },
];
const idx = buildIndex(rows);

test('copiesOf finds exact repeats only, never blank or code-only sources', () => {
  assert.deepEqual(copiesOf(idx, 1), [2, 3]);
  assert.deepEqual(copiesOf(idx, 3), [1, 2]);
  assert.deepEqual(copiesOf(idx, 4), []);
  assert.deepEqual(copiesOf(idx, 5), []);
  assert.deepEqual(copiesOf(idx, 999), []);
});

test('similarTo ranks identical first, then close ones, and skips unrelated text', () => {
  const r = similarTo(idx, 1);
  assert.deepEqual(r.slice(0, 2).map((m) => [m.id, m.score]), [[2, 1], [3, 1]]);
  assert.ok(r.some((m) => m.id === 4 && m.score >= 0.4 && m.score < 1));
  assert.ok(!r.some((m) => m.id === 9));
  const park = similarTo(idx, 7);
  assert.equal(park[0].id, 8); assert.equal(park[0].block_id, 14);
  assert.deepEqual(similarTo(idx, 5), []);
  assert.deepEqual(similarTo(idx, 999), []);
  assert.equal(similarTo(idx, 1, { limit: 1 }).length, 1);
  assert.deepEqual(similarTo(idx, 7, { min: 0.99 }), []);
});

test('pickSuggestions keeps one entry per translation and counts its uses', () => {
  const matches = [{ id: 2, score: 1 }, { id: 3, score: 1 }, { id: 4, score: 0.666 }, { id: 9, score: 0.5 }];
  const tr = new Map([[2, { text: 'Red Piece', status: 'revisada' }], [3, { text: 'Red Piece', status: 'traduzida' }], [4, { text: 'Blue Piece', status: 'traduzida' }]]);
  const out = pickSuggestions(matches, tr);
  assert.deepEqual(out.map((x) => [x.text, x.uses, x.score, x.status]), [['Red Piece', 2, 1, 'revisada'], ['Blue Piece', 1, 0.67, 'traduzida']]);
  assert.equal(pickSuggestions(matches, tr, 1).length, 1);
  assert.deepEqual(pickSuggestions(matches, new Map()), []);
});

test('parseCategories reads archive + entry, keeps file order, last line wins', () => {
  const r = parseCategories('﻿archive\tentry\tcategoria\r\nCDDATA0\te0000\tMenus\nCDDATA\te0002\tParque\n\nCDDATA\te0099\t\nCDDATA0\te0000\tMenus e sistema\n');
  assert.deepEqual(r, [{ scene: 'CDDATA0/e0000', category: 'Menus e sistema', position: 3 }, { scene: 'CDDATA/e0002', category: 'Parque', position: 1 }]);
});

test('parseCategories accepts a scene column and the English header', () => {
  assert.deepEqual(parseCategories('Scene\tCategory\nCDDATA/e0008\tItems'), [{ scene: 'CDDATA/e0008', category: 'Items', position: 0 }]);
  assert.equal(parseCategories('archive\tentry\tcategoria\nCDDATA\t\tX').length, 0);
  assert.equal(parseCategories('a\tb\tcategoria\n')?.length ?? null, null);
  assert.equal(parseCategories('archive\tentry\nCDDATA\te0002'), null);
  assert.equal(parseCategories(''), null);
  assert.equal(parseCategories(undefined), null);
  assert.equal(parseCategories(`scene\tcategoria\nX\t${'a'.repeat(200)}`)[0].category.length, 80);
});
