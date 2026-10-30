import 'package:flutter_test/flutter_test.dart';
import 'package:billease_mobile/models/models.dart';
import 'package:billease_mobile/services/recovery_payload.dart';

void main() {
  test('recovery preserves uncertain original operation and maps only known routes', () {
    final payload = <String, dynamic>{
      'operationId': 'original',
      'id': 'return',
    };
    final job = OutboxJob(
      id: 'original',
      scope: 'user/business/owner',
      method: 'POST',
      path: '/returns',
      kind: 'online_action',
      payload: payload,
      status: 'uncertain',
    );
    final message = recoveryPayload(job);
    expect(message['operationType'], 'return.record');
    expect(message['payload'], same(payload));
    expect(message['path'], '/returns');
    expect(
      recoveryPayload(
        OutboxJob(
          id: 'original',
          scope: job.scope,
          method: 'DELETE',
          path: '/returns',
          kind: 'online_action',
          payload: payload,
        ),
      )['operationType'],
      'unsupported',
    );
    expect(
      recoveryPayload(
        OutboxJob(
          id: 'original',
          scope: job.scope,
          method: 'POST',
          path: '/admin/mutate',
          kind: 'online_action',
          payload: payload,
        ),
      )['operationType'],
      'unsupported',
    );
  });
}
