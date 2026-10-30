import 'dart:math';

import '../data/cache_store.dart';
import '../models/models.dart';
import 'api_client.dart';

class SyncService {
  final CacheStore store;
  final ApiClient api;
  final DateTime Function() now;
  Future<void>? _running;
  SyncService(this.store, this.api, {DateTime Function()? now})
    : now = now ?? (() => DateTime.now().toUtc());
  Future<void> sync(String scope, Business business) async {
    if (_running != null) return _running;
    final future = _sync(scope, business);
    _running = future;
    try {
      await future;
    } finally {
      _running = null;
    }
  }

  Future<void> _sync(String scope, Business business) async {
    final jobs = await store.jobs(scope);
    for (final job in jobs.where((j) => j.status == 'sending')) {
      await store.updateJob(job.copy(status: 'pending'));
    }
    var sent = 0;
    for (var job in await store.jobs(scope)) {
      if (sent >= 30 || job.status != 'pending' || job.retryAt.isAfter(now())) {
        continue;
      }
      final current = await store.jobs(scope);
      if (job.dependencies.any(
        (id) => !current.any((j) => j.id == id && j.status == 'done'),
      )) {
        continue;
      }
      job = job.copy(status: 'sending', attempts: job.attempts + 1);
      await store.updateJob(job);
      try {
        final result = await api.request(
          job.method,
          '/businesses/${business.id}${job.path}',
          body: job.payload,
        );
        await store.atomic(() async {
          await store.updateJob(job.copy(status: 'done'));
          if (job.kind == 'bill') {
            final id = '${job.payload['id']}';
            final local = await store.get(scope, 'owned_bill', id);
            if (local != null) {
              local['bill'] = {
                ...object(local['bill']),
                'lifecycle': 'issued',
                'invoice_number': result['invoiceNumber'],
                'financial_year': result['financialYear'],
                'review_state': result['reviewState'],
              };
              await store.put(scope, 'owned_bill', id, local);
            }
          }
        });
        sent++;
      } on ApiFailure catch (error) {
        if (error.status == 401 || error.status == 403) {
          await store.updateJob(
            job.copy(status: 'pending', error: error.message),
          );
          rethrow;
        }
        final status = error.status == 409
            ? 'review_required'
            : error.status >= 400 && error.status < 500 && error.status != 429
            ? 'rejected'
            : 'pending';
        final delay = error.status == 429
            ? error.retryAfter
            : min(900, 5 * (1 << job.attempts.clamp(0, 8)));
        await store.updateJob(
          job.copy(
            status: status,
            error: error.message,
            retryAt: now().add(Duration(seconds: delay)),
          ),
        );
      } catch (_) {
        await store.updateJob(
          job.copy(
            status: 'pending',
            error: 'Connection interrupted. This operation is saved for retry.',
            retryAt: now().add(
              Duration(seconds: min(900, 5 * (1 << job.attempts.clamp(0, 8)))),
            ),
          ),
        );
        rethrow;
      }
    }
    var count = 0;
    while (true) {
      final cursor = await store.cursor(scope);
      final page = await api.request(
        'GET',
        '/businesses/${business.id}/sync?cursor=$cursor',
      );
      await store.applyPage(scope, business.role, page);
      if (page['hasMore'] != true) break;
      if ('${page['nextCursor']}' == cursor || ++count > 10000) {
        throw StateError('Sync cursor did not advance');
      }
    }
    final requests = await api.request(
      'GET',
      '/businesses/${business.id}/requests',
    );
    final previousRequests = objects(
      (await store.get(scope, '_meta', 'requests'))?['rows'],
    );
    final decisions = objects(requests['requests']).where(
      (row) => previousRequests.any(
        (old) => old['id'] == row['id'] && old['state'] != row['state'],
      ),
    );
    if (!business.owner && decisions.isNotEmpty) {
      await store.put(scope, '_meta', 'notice', {
        'value': decisions
            .map(
              (row) => 'Owner decision: ${row['type']} ${row['state']}'
                  .replaceAll('_', ' '),
            )
            .join('. '),
      });
    }
    if (business.owner) {
      final previous = objects(
        (await store.get(scope, '_meta', 'access_notices'))?['rows'],
      );
      final notices = objects(requests['accessNotices']);
      await store.put(scope, '_meta', 'access_notices', {'rows': notices});
      if (notices.any((n) => !previous.any((p) => p['id'] == n['id']))) {
        await store.put(scope, '_meta', 'notice', {
          'value':
              'Business access notices are available in your approval inbox.',
        });
      }
    }
    await store.put(scope, '_meta', 'requests', {
      'rows': requests['requests'] ?? [],
    });
  }
}
