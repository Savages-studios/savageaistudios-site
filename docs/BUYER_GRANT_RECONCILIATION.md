# Site → Marketplace buyer grant and invoice quota reconciliation

## Commercial integration

The site already has real signed-webhook sale ledger records and an
operator-run Marketplace provisioning bridge. A local provision marker is not
proof that the buyer received a credential or used an invoice. This new
**read-only cross-repository inspection** asks the Marketplace's own compiled
grant-status CLI for the actual persisted grant state, rather than reading
Marketplace's protected grant ledger directly.

This is a Phase 2 revenue integration. The separate AgentPay OEM enterprise
licensing design still requires Tights' explicit decision and ownership.

## Runbook

Build Marketplace from the review stack including its commercial grant status
CLI, and retain the existing private Marketplace prepaid grant directory.
Configure the existing site variables for the signed-webhook sale ledger,
provision markers, and independently authenticated offer catalog. Also supply:

- `SAVAGE_MARKETPLACE_GRANT_STATUS_CLI`: absolute path to the **compiled**
  Marketplace `inspect-commerce-grant.js` file from its review branch.
- `FACTURFORGE_PREPAID_DIR`: existing absolute private grant directory.

Run `npm run audit:buyer-grants`. This command does **not** execute a
provisioning worker or a payment provider. It first revalidates the actual
site sale ledger and provision markers using the existing reconciliation.
For each marked FacturForge purchase, it rechecks the immutable sale binding
and marker grant ID, then runs the Marketplace CLI in a bounded Node child
process with the exact original account, mode, Checkout and buyer email.
Only the necessary operator environment is passed; no Stripe secret is
required. The Marketplace CLI checks its own private grant and returns only
redacted status.

The site accepts exactly the documented v1 status keys, exact grant ID and
SKU, 100-document quota arithmetic, revocation and local evidence method.
It refuses extra fields, forged independent-verification flags, mismatched
identities, child process failures and a sale/marker set that changes during
inspection. Output contains event digest, purchase binding, grant ID,
revocation/acknowledgment classification and remaining quota, never buyer
email, credential, invoice contents or JWT.

The report distinguishes `awaiting_buyer_possession`,
`local_buyer_possession_acknowledged_unverified`, and `revoked`.
**Even an acknowledgment recorded in the Marketplace local ledger is not
independent proof that a real buyer held the credential.** Both independent
verification flags remain false. `test-fixture` evidence is visibly
identified as offline. Unknown SKUs and unprovisioned purchases remain
outside this inspection, not silently treated as delivered.

## Tests and acceptance

Site tests execute actual local private sale and marker creation and the
real refusal CLI path. Pure status-contract tests use explicitly labeled
offline local records, not a simulated Stripe response. Marketplace's own
tests exercise its compiled CLI against actual private grant files, local
possession acknowledgment, quota debit and revocation, all using offline
fixtures. A successful cross-repository execution against the genuine
seller account and independently observed buyer receipt is **not** claimed.

Before commercial acceptance: independently authenticate the seller account
and actual `acct_/plink_/price_` objects for the 43 site links; verify an
existing paid Checkout, real buyer-controlled TLS credential receipt,
independent possession proof, actual invoice and 100→99 quota debit,
restart/idempotency and refund/dispute revocation. Run both compiled
components together on real authorized infrastructure and obtain independent
customer acceptance. No merge, deployment, payment creation, spending,
fund movement, Stripe reconnection, customer contact or Genesis edit.
