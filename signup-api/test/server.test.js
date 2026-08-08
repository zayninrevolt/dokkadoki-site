'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTitle,
  levenshtein,
  sameSeries,
  containsBlocked,
  isJsonObject,
  stringField,
} = require('../server');

test('normalizes case, accents, punctuation and volume suffixes', () => {
  assert.equal(normalizeTitle('  Thé One Piece Manga — Vol. 3  '), 'one piece');
});

test('matches common spelling mistakes and missing noise words', () => {
  assert.equal(sameSeries('one peice', 'one piece'), true);
  assert.equal(sameSeries('hero academia', 'my hero academia'), true);
  assert.equal(sameSeries('naruto', 'berserk'), false);
  assert.equal(levenshtein('one peice', 'one piece'), 1);
});

test('blocks explicit and masked abusive submissions without substring false positives', () => {
  assert.equal(containsBlocked('f*ck this', normalizeTitle('f*ck this')), true);
  assert.equal(containsBlocked('Assassination Classroom', normalizeTitle('Assassination Classroom')), false);
  assert.equal(containsBlocked('One Punch Man', normalizeTitle('One Punch Man')), false);
});

test('caps normalized titles to the database column width', () => {
  assert.equal(normalizeTitle('x'.repeat(500)).length, 160);
});

test('rejects JSON bodies that are not plain objects', () => {
  assert.equal(isJsonObject(null), false);
  assert.equal(isJsonObject([]), false);
  assert.equal(isJsonObject('title'), false);
  assert.equal(isJsonObject({ title: 'Yotsuba&!' }), true);
});

test('accepts only string fields from request bodies', () => {
  assert.equal(stringField({ title: 'Yotsuba&!' }, 'title'), 'Yotsuba&!');
  assert.equal(stringField({}, 'title'), '');
  assert.equal(stringField({ title: 123 }, 'title'), null);
  assert.equal(stringField({ title: {} }, 'title'), null);
});
