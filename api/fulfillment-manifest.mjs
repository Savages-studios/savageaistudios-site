/**
 * Declared automated-fulfillment manifest.
 *
 * This is the single SKU -> deliverable mapping used by the automated
 * fulfillment engine. The coloring-book hashes and byte counts below are
 * copied from sa6ag9/glitch-books-private/SHA256-MANIFEST.json, whose PDFs
 * are independently checked by that repo's tools/verify_fulfillment.py.
 * Paths are relative to the private goods directory configured at deploy
 * time; the PDFs are never copied into this public site repository.
 */

const pdf = (path, sha256, bytes) => Object.freeze({
  path,
  sha256,
  bytes,
  contentType: 'application/pdf',
  filename: path
});

export const COLORING_BOOK_FILES = Object.freeze({
  rain: pdf(
    'glitch-rain-book.pdf',
    '7e0467ab9817702dcdf5ce40ad5bc91d79261bf5c5eea13dedb6ffa4e437cf83',
    1613446
  ),
  honey: pdf(
    'glitch-honey-book.pdf',
    '388d18f7025c5c0c20c2d95a145b2febe4d7ecf7f7ea4083014eb7ed05eb1bd5',
    1823260
  ),
  moon: pdf(
    'glitch-moon-book.pdf',
    '6df5ef14507c050f7cbb2fc87efcea934bae631568a902f2cf981d8660d67bf4',
    1382248
  ),
  bridge: pdf(
    'glitch-bridge-book.pdf',
    '4fe03ca93211b6e32640cbe5a4f931a40ec4c129ed7723b1a6ce493b7eb7a5fb',
    1818279
  ),
  bird: pdf(
    'glitch-bird-book.pdf',
    '053912f9de346c7c50cde244ee29a3db332487c77ae87ea2fdebc91ab867a076',
    1475513
  )
});

/**
 * SKUs that must refuse automated delivery even if a signed event and a
 * trusted offer row somehow reach the fulfillment engine. Their absence
 * from the automated manifest is deliberate; this explicit set makes the
 * refusal testable rather than merely implicit.
 */
export const HELD_FULFILLMENT_SKUS = Object.freeze(new Set([
  'COMM-20260908-MARKETPLACE-FACTURFORGE-PRO-PACK-49',
  'SIAV6-EA-CEROS-COCKPIT-UI-PACK-49'
]));

export const AUTOMATED_FULFILLMENT_MANIFEST = Object.freeze([
  Object.freeze({
    sku: 'COMM-20260908-MARKETPLACE-GLITCH-AND-THE-RAINY-DAY-COLORING-BOOK-9',
    productName: 'Glitch and the Rainy Day — Coloring Book',
    deliverables: Object.freeze([COLORING_BOOK_FILES.rain])
  }),
  Object.freeze({
    sku: 'COMM-20260908-MARKETPLACE-BASSO-AND-THE-HONEY-BEES-COLORING-BOOK-9',
    productName: 'Basso and the Honey Bees — Coloring Book',
    deliverables: Object.freeze([COLORING_BOOK_FILES.honey])
  }),
  Object.freeze({
    sku: 'COMM-20260908-MARKETPLACE-STELLA-AND-THE-CHANGING-MOON-COLORING-BOOK-9',
    productName: 'Stella and the Changing Moon — Coloring Book',
    deliverables: Object.freeze([COLORING_BOOK_FILES.moon])
  }),
  Object.freeze({
    sku: 'COMM-20260908-MARKETPLACE-FIXIT-AND-THE-BIG-BRIDGE-COLORING-BOOK-9',
    productName: 'Fixit and the Big Bridge — Coloring Book',
    deliverables: Object.freeze([COLORING_BOOK_FILES.bridge])
  }),
  Object.freeze({
    sku: 'COMM-20260908-MARKETPLACE-PIPPA-TEACHES-GLITCH-TO-FLY-COLORING-BOOK-9',
    productName: 'Pippa Teaches Glitch to Fly — Coloring Book',
    deliverables: Object.freeze([COLORING_BOOK_FILES.bird])
  }),
  Object.freeze({
    sku: 'COLORING-BOOKS-BUNDLE-29',
    productName: 'Glitch Coloring Books — All Five Bundle',
    deliverables: Object.freeze([
      COLORING_BOOK_FILES.rain,
      COLORING_BOOK_FILES.honey,
      COLORING_BOOK_FILES.moon,
      COLORING_BOOK_FILES.bridge,
      COLORING_BOOK_FILES.bird
    ])
  })
]);

export const AUTOMATED_FULFILLMENT_SKUS = Object.freeze(
  AUTOMATED_FULFILLMENT_MANIFEST.map((entry) => entry.sku)
);
