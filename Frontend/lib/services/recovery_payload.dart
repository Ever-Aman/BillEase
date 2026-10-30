import '../models/models.dart';

/// Typed recovery metadata wraps the unchanged original request. It never
/// generates a new operation ID or permits the server to dispatch a route.
Json recoveryPayload(OutboxJob job) {
  if (job.kind != 'online_action') return job.payload;
  var type = 'unsupported';
  if (job.method == 'POST') {
    type =
        {
          '/returns': 'return.record',
          '/repayments': 'repayment.cash',
          '/opening-balances': 'balance.opening',
          '/advance-applications': 'advance.apply',
          '/ledger-corrections': 'ledger.correct',
          '/payment-corrections': 'payment.correct',
          '/delivery-corrections': 'delivery.correct',
          '/quotations': 'quotation.create',
        }[job.path] ??
        'unsupported';
    for (final entry in <String, String>{
      r'^/bills/[0-9a-f-]+/cancel$': 'bill.cancel',
      r'^/bills/[0-9a-f-]+/credit-decision$': 'credit.review',
      r'^/payments/[0-9a-f-]+/decision$': 'payment.verify',
      r'^/delivery/[0-9a-f-]+/review$': 'delivery.review',
      r'^/requests/[0-9a-f-]+/decision$': 'request.decide',
    }.entries) {
      if (RegExp(entry.key).hasMatch(job.path)) type = entry.value;
    }
  }
  return {
    'operationType': type,
    'method': job.method,
    'path': job.path,
    'payload': job.payload,
  };
}
