import 'dart:convert';

Object? sortedJson(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((x) => x.toString()).toList()..sort();
    return {for (final key in keys) key: sortedJson(value[key])};
  }
  if (value is List) return value.map(sortedJson).toList();
  return value;
}

String canonicalJson(Object? value) => jsonEncode(sortedJson(value));
