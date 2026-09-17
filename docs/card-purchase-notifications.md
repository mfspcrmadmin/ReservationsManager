# Card purchase email notifications

Card purchase registration no longer needs an accounting notification email.

The local implementation at `_local/crm/crm_functions/cardPurchases_sendNotification.dg` keeps the existing `standalone.cardPurch_sendAccNotification(string cardPurchaseId)` signature but returns a successful no-op with `notification_sent: false`. It performs no reads, writes or email sends.

To apply this in CRM, publish that implementation to the existing `cardPurch_sendAccNotification` function. The existing `wf_cardPurch_sendAccountingNotification.dg` workflow wrapper can continue calling it. Alternatively, remove only the accounting email notification action from the Card Purchases workflow.

Do not disable all workflow triggers on widget record creation or attachment updates: other business automations may depend on them. No widget payload change or ZIP update is required.

The local function has been updated; the live CRM function has not been published from this environment. `_local/` is ignored by Git, so deploying the widget or committing this document alone does not disable the live email notification.
