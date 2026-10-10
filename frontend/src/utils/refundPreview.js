const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Item subtotal after item discount (qty * price - discount)
const itemNetSubtotal = (item) => {
  if (item.subtotal !== undefined && item.subtotal !== null) return Number(item.subtotal);
  return item.quantity * Number(item.price || 0) - (Number(item.discount) || 0);
};

/**
 * Refund preview, computed the same way as the backend (return.service.js):
 * the item's subtotal after item discount, scaled by (total - tax) / sum of item
 * subtotals to spread the header discount, prorated by the returned quantity with
 * cumulative rounding, and capped at what is left of the transaction total.
 *
 * @param {Object} transaction - transaction with items, total, tax
 * @param {Object} quantities - { [transactionItemId]: qty to return }
 * @param {Array} existingReturns - previous returns of this transaction
 * @returns {{ perItem: Object, total: number }}
 */
export function calcRefundPreview(transaction, quantities, existingReturns) {
  const items = transaction?.items || [];

  const returnedMap = {};
  let alreadyRefunded = 0;
  for (const ret of existingReturns || []) {
    alreadyRefunded += Number(ret.refundAmount) || 0;
    for (const ri of ret.items || []) {
      returnedMap[ri.transactionItemId] = (returnedMap[ri.transactionItemId] || 0) + ri.quantity;
    }
  }

  const itemsSubtotal = items.reduce((sum, item) => sum + itemNetSubtotal(item), 0);
  const transactionTotal = Number(transaction?.total) || 0;
  const discountRatio = itemsSubtotal > 0
    ? Math.max(transactionTotal - (Number(transaction?.tax) || 0), 0) / itemsSubtotal
    : 0;

  const perItem = {};
  let total = 0;
  for (const item of items) {
    const qty = Number(quantities[item.id]) || 0;
    if (qty <= 0 || !item.quantity) continue;
    const alreadyReturned = returnedMap[item.id] || 0;
    const itemNet = itemNetSubtotal(item) * discountRatio;
    const refundedBefore = round2(itemNet * (alreadyReturned / item.quantity));
    const refundedAfter = round2(itemNet * ((alreadyReturned + qty) / item.quantity));
    perItem[item.id] = round2(refundedAfter - refundedBefore);
    total = round2(total + perItem[item.id]);
  }

  total = round2(Math.min(total, Math.max(transactionTotal - alreadyRefunded, 0)));
  return { perItem, total };
}
