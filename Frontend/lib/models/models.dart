import '../core/amount.dart';

typedef Json = Map<String, dynamic>;
Json object(Object? value) => Map<String, dynamic>.from(value as Map? ?? {});
List<Json> objects(Object? value) =>
    (value as List? ?? []).map(object).toList();
int integer(Object? value) => int.tryParse('$value') ?? 0;

class Business {
  final String id, name, role;
  final String? documentMode, stateCode;
  const Business(
    this.id,
    this.name,
    this.role, {
    this.documentMode,
    this.stateCode,
  });
  bool get owner => role == 'owner';
  String scope(String userId) => '$userId/$id/$role';
  Json toJson() => {
    'id': id,
    'name': name,
    'role': role,
    if (documentMode != null) 'documentMode': documentMode,
    if (stateCode != null) 'stateCode': stateCode,
  };
  factory Business.fromJson(Json value) => Business(
    '${value['id'] ?? value['business_id']}',
    '${value['name'] ?? 'Business'}',
    '${value['role']}',
    documentMode:
        value['documentMode'] as String? ?? value['document_mode'] as String?,
    stateCode: value['stateCode'] as String? ?? value['state_code'] as String?,
  );
}

class Unit {
  final String id, label, factor;
  final int price;
  final bool active;
  const Unit({
    required this.id,
    required this.label,
    required this.factor,
    required this.price,
    this.active = true,
  });
  factory Unit.fromJson(Json value) => Unit(
    id: '${value['id']}',
    label: '${value['label']}',
    factor: '${value['factor']}',
    price: integer(value['priceMinor']),
    active: value['active'] != false,
  );
  Json toJson() => {
    'id': id,
    'label': label,
    'factor': factor,
    'priceMinor': '$price',
    'active': active,
  };
}

class Item {
  final String id, name, canonicalUnit;
  final String? hsn, taxCategory;
  final int? gstRateBps;
  final int version;
  final bool active;
  final List<Unit> units;
  const Item({
    required this.id,
    required this.name,
    required this.canonicalUnit,
    required this.version,
    required this.units,
    this.hsn,
    this.gstRateBps,
    this.taxCategory,
    this.active = true,
  });
  factory Item.fromJson(Json value) => Item(
    id: '${value['id']}',
    name: '${value['name']}',
    canonicalUnit: '${value['canonicalUnit']}',
    hsn: value['hsn'] as String?,
    gstRateBps: value['gstRateBps'] == null
        ? null
        : integer(value['gstRateBps']),
    taxCategory: value['taxCategory'] as String?,
    version: integer(value['version']),
    active: value['active'] != false,
    units: objects(value['units']).map(Unit.fromJson).toList(),
  );
  Json toJson() => {
    'id': id,
    'name': name,
    'canonicalUnit': canonicalUnit,
    if (hsn != null) 'hsn': hsn,
    if (gstRateBps != null) 'gstRateBps': gstRateBps,
    if (taxCategory != null) 'taxCategory': taxCategory,
    'version': version,
    'active': active,
    'units': units.map((x) => x.toJson()).toList(),
  };
}

class DraftLine {
  final String id;
  final Item item;
  final Unit unit;
  int quantityMilli, priceMinor;
  DraftLine({
    required this.id,
    required this.item,
    required this.unit,
    required this.quantityMilli,
    int? priceMinor,
  }) : priceMinor = priceMinor ?? unit.price;
  int get total => lineAmount(priceMinor, quantityMilli);
  Json toJson() => {
    'id': id,
    'item': item.toJson(),
    'unit': unit.toJson(),
    'quantityMilli': quantityMilli,
    'priceMinor': priceMinor,
  };
  factory DraftLine.fromJson(Json j) => DraftLine(
    id: '${j['id']}',
    item: Item.fromJson(object(j['item'])),
    unit: Unit.fromJson(object(j['unit'])),
    quantityMilli: integer(j['quantityMilli']),
    priceMinor: integer(j['priceMinor']),
  );
  Json payload({required bool owner}) => {
    'id': id,
    'itemId': item.id,
    'unitId': unit.id,
    'catalogueVersion': item.version,
    'quantityMilli': quantityMilli,
    if (owner && priceMinor != unit.price) 'overridePriceMinor': priceMinor,
  };
}

class OutboxJob {
  final String id, scope, method, path, kind;
  final Json payload;
  final List<String> dependencies;
  final int attempts;
  final String status;
  final String? error;
  final DateTime created, retryAt;
  OutboxJob({
    required this.id,
    required this.scope,
    required this.method,
    required this.path,
    required this.kind,
    required this.payload,
    this.dependencies = const [],
    this.attempts = 0,
    this.status = 'pending',
    this.error,
    DateTime? created,
    DateTime? retryAt,
  }) : created = created ?? DateTime.now().toUtc(),
       retryAt = retryAt ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
  OutboxJob copy({
    String? status,
    int? attempts,
    String? error,
    DateTime? retryAt,
  }) => OutboxJob(
    id: id,
    scope: scope,
    method: method,
    path: path,
    kind: kind,
    payload: payload,
    dependencies: dependencies,
    attempts: attempts ?? this.attempts,
    status: status ?? this.status,
    error: error,
    created: created,
    retryAt: retryAt ?? this.retryAt,
  );
  Json toJson() => {
    'id': id,
    'scope': scope,
    'method': method,
    'path': path,
    'kind': kind,
    'payload': payload,
    'dependencies': dependencies,
    'attempts': attempts,
    'status': status,
    'error': error,
    'created': created.toIso8601String(),
    'retryAt': retryAt.toIso8601String(),
  };
  factory OutboxJob.fromJson(Json j) => OutboxJob(
    id: '${j['id']}',
    scope: '${j['scope']}',
    method: '${j['method']}',
    path: '${j['path']}',
    kind: '${j['kind']}',
    payload: object(j['payload']),
    dependencies: List<String>.from(j['dependencies'] ?? []),
    attempts: integer(j['attempts']),
    status: '${j['status']}',
    error: j['error'] as String?,
    created: DateTime.parse(j['created']),
    retryAt: DateTime.parse(j['retryAt']),
  );
}

Json billHeader(Json value) => object(value['bill']);
String billId(Json value) => '${billHeader(value)['id']}';
String billCustomer(Json value) {
  final b = billHeader(value), snapshot = object(b['customer_snapshot']);
  return '${snapshot['name'] ?? b['customer_name'] ?? 'Walk-in customer'}';
}

String billReference(Json value) {
  final b = billHeader(value);
  return b['invoice_number'] == null
      ? 'Pending upload'
      : '${b['financial_year']}/${b['invoice_number']}';
}
