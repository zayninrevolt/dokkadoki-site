# Interrupted newsletter delivery

A nonzero runner exit is not a successful delivery. An unresolved `sending` claim keeps the edition approved and blocks automatic completion/retry for that recipient. Never delete all claims or force an edition to sent.

With operator approval, reconcile the exact edition and recipient against the provider's delivery history. If acceptance is confirmed, record the provider message ID and mark only that claim sent. If the provider definitively confirms non-acceptance, release only that claim before an approved retry. If the outcome remains uncertain, keep it unresolved. Do not assume provider idempotency lasts indefinitely or that a new encrypted unsubscribe link produces an identical retry payload.

No reconciliation command is exposed publicly. Database changes and email sends require their own explicit approval. Completed recipients are skipped on retry; unresolved claims are never silently counted as delivered.
