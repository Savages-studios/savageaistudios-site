import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../products/moneyengine-79/index.html',
                                  import.meta.url), 'utf8');

test('one-time $79 offer is clearly software, not a recovery service', () => {
  assert.match(page, /Money Engine Evidence Casework Toolkit/);
  assert.match(page, /\$79 one-time software license/);
  assert.match(page, /Private Business Software/);
  assert.doesNotMatch(page, /unclaimed-property filing service/i);
  assert.match(page, /not an unclaimed-property finder agreement/i);
  assert.match(page, /State Controller for free/i);
});

test('checkout is withheld until a working buyer entitlement and delivery exist', () => {
  assert.match(page, /purchases are not activated from this page until verified customer delivery/i);
  assert.match(page, /mailto:savagnic@gmail.com\?subject=Money%20Engine/);
  assert.doesNotMatch(page, /href="https:\/\/buy\.stripe\.com\//);
  assert.doesNotMatch(page, /Buy now/i);
});

test('existing site accessibility and legal navigation remain intact', () => {
  assert.match(page, /<html lang="en">/);
  assert.match(page, /class="skip-link" href="#main"/);
  assert.match(page, /id="main"/);
  assert.match(page, /<h1>Money Engine Evidence Casework Toolkit<\/h1>/);
  assert.match(page, /href="\.\.\/\.\.\/legal\.html"/);
  assert.match(page, /href="https:\/\/www\.sco\.ca\.gov\/upd_faq_claiming-property\.html"/);
});
