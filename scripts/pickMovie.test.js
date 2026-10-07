import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// These imports will fail until pickMovie.js exists (RED gate)
import { calculateScore, anniversaryBonus, pickWinner } from './pickMovie.js';

describe('anniversaryBonus', () => {
  it('gives +15 for 50/75/100 year anniversaries', () => {
    assert.equal(anniversaryBonus(1976, 2026), 15);
    assert.equal(anniversaryBonus(1951, 2026), 15);
    assert.equal(anniversaryBonus(1926, 2026), 15);
  });
  it('gives +10 for 25/30/40 year anniversaries', () => {
    assert.equal(anniversaryBonus(2001, 2026), 10);
    assert.equal(anniversaryBonus(1996, 2026), 10);
    assert.equal(anniversaryBonus(1986, 2026), 10);
  });
  it('gives +5 for 10/20 year anniversaries', () => {
    assert.equal(anniversaryBonus(2016, 2026), 5);
    assert.equal(anniversaryBonus(2006, 2026), 5);
  });
  it('gives +0 otherwise', () => {
    assert.equal(anniversaryBonus(2025, 2026), 0);
    assert.equal(anniversaryBonus(2019, 2026), 0);
  });
});

describe('calculateScore', () => {
  it('base = vote_average*10 + log10(vote_count)*2 + bonus', () => {
    const movie = { vote_average: 8.0, vote_count: 1000, release_date: '2001-10-07' };
    // 80 + log10(1000)*2=6 + bonus 10 (25yr) = 96
    assert.equal(calculateScore(movie, 2026), 80 + 6 + 10);
  });
});

describe('pickWinner', () => {
  it('filters vote_count<500, excludes sent ids, picks highest score', () => {
    const movies = [
      { id: 1, title: 'Obscure', release_date: '2000-10-07', vote_average: 9.5, vote_count: 100, overview: 'x' },
      { id: 2, title: 'Good', release_date: '2001-10-07', vote_average: 8.0, vote_count: 5000, overview: 'y' },
      { id: 3, title: 'Best but sent', release_date: '1976-10-07', vote_average: 9.0, vote_count: 20000, overview: 'z' },
    ];
    const winner = pickWinner(movies, [3], 2026);
    assert.equal(winner.id, 2);
  });
  it('returns null when no candidates remain', () => {
    assert.equal(pickWinner([], [], 2026), null);
    assert.equal(pickWinner([{ id: 1, title: 'x', release_date: '2000-01-01', vote_average: 5, vote_count: 10, overview: '' }], [], 2026), null);
  });
});
