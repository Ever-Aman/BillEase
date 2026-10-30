import 'app_controller.dart';
import 'data/cache_store.dart';
import 'models/models.dart';
import 'services/secure_vault.dart';
import 'services/session_service.dart';

Future<AppController> previewController() async {
  final app = AppController(preview: true, vault: MemoryVault());
  const business = Business('preview-business', 'Shree Traders', 'owner');
  final now = DateTime.now().toUtc();
  app.session.data = SessionData(
    userId: 'preview-owner',
    email: 'owner@example.test',
    access: '',
    refresh: '',
    expires: now.add(const Duration(days: 1)),
    offlineExpires: now.add(const Duration(days: 7)),
    businesses: [business],
  );
  app.store = MemoryStore();
  app.business = business;
  app.booting = false;
  app.unlocked = true;
  app.lease = true;
  final items = [
    const Item(
      id: 'cement',
      name: 'White cement',
      canonicalUnit: 'kg',
      version: 1,
      units: [
        Unit(id: 'cement-bag', label: '25 kg bag', factor: '25', price: 78000),
        Unit(id: 'cement-kg', label: 'kg', factor: '1', price: 3400),
      ],
    ),
    const Item(
      id: 'tile',
      name: 'Ivory floor tile · 600 mm',
      canonicalUnit: 'piece',
      version: 1,
      units: [
        Unit(id: 'tile-box', label: '4 piece box', factor: '4', price: 124000),
        Unit(id: 'tile-piece', label: 'piece', factor: '1', price: 32000),
      ],
    ),
    const Item(
      id: 'paint',
      name: 'Interior emulsion · white',
      canonicalUnit: 'litre',
      version: 1,
      units: [
        Unit(
          id: 'paint-tin',
          label: '10 litre tin',
          factor: '10',
          price: 245000,
        ),
      ],
    ),
  ];
  for (final item in items) {
    await app.store!.put(app.scope, 'catalogue', item.id, item.toJson());
  }
  for (final c in [
    {
      'id': 'ravi',
      'name': 'Ravi Sharma',
      'phone': '9876543210',
      'locality': 'Civil Lines',
      'active': true,
    },
    {
      'id': 'neha',
      'name': 'Neha Verma',
      'phone': '9876543211',
      'locality': 'Station Road',
      'active': true,
    },
  ]) {
    await app.store!.put(app.scope, 'customer', '${c['id']}', c);
  }
  for (var i = 0; i < 3; i++) {
    final item = items[i], unit = items[i].units.first;
    final row = <String, dynamic>{
      'bill': {
        'id': 'sample-$i',
        'invoice_number': 1042 - i,
        'financial_year': '2026-27',
        'customer_snapshot': {'name': i == 1 ? 'Neha Verma' : 'Ravi Sharma'},
        'issued_at': now.subtract(Duration(hours: i + 1)).toIso8601String(),
        'total_minor': '${unit.price * 2}',
        'lifecycle': 'issued',
        'review_state': i == 2 ? 'credit_pending' : 'not_required',
      },
      'lines': [
        {
          'id': 'line-$i',
          'item_name': item.name,
          'unit_label': unit.label,
          'unit_id': unit.id,
          'factor': unit.factor,
          'quantity_milli': 2000,
          'unit_price_minor': '${unit.price}',
          'line_total_minor': '${unit.price * 2}',
          'units': item.units.map((u) => u.toJson()).toList(),
        },
      ],
      'payments': [],
      'delivery': {
        'lines': [
          {
            'id': 'line-$i',
            'billed_canonical': '${int.parse(unit.factor) * 2}',
            'delivered_canonical': i == 0 ? unit.factor : '0',
            'pending_canonical': i == 0
                ? unit.factor
                : '${int.parse(unit.factor) * 2}',
            'canonical_unit': item.canonicalUnit,
          },
        ],
        'events': [],
      },
    };
    await app.store!.put(app.scope, 'bill', 'sample-$i', row);
  }
  await app.reload();
  return app;
}
