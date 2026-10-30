import 'dart:io';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';

void main() {
  test(
    'native SQLite is encrypted, reopens with its key and refuses another key',
    () async {
      final directory = Directory.systemTemp.createTempSync('billease-cipher-');
      final path = '${directory.path}/cache.db';
      const key =
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      try {
        final db = sqlite3.open(path);
        expect(
          db.select('PRAGMA cipher'),
          isNotEmpty,
          reason: 'Plain SQLite must never be used for business storage',
        );
        db.execute("PRAGMA key = '$key'");
        db.execute('CREATE TABLE proof(value TEXT NOT NULL)');
        db.execute('INSERT INTO proof VALUES (?)', [
          'private customer balance',
        ]);
        db.close();
        final bytes = File(path).readAsBytesSync();
        expect(
          utf8.decode(bytes.take(16).toList(), allowMalformed: true),
          isNot(startsWith('SQLite format')),
        );
        final wrong = sqlite3.open(path);
        wrong.execute("PRAGMA key = 'wrong-key'");
        expect(
          () => wrong.select('SELECT * FROM proof'),
          throwsA(isA<SqliteException>()),
        );
        wrong.close();
        final reopened = sqlite3.open(path);
        reopened.execute("PRAGMA key = '$key'");
        expect(
          reopened.select('SELECT value FROM proof').single['value'],
          'private customer balance',
        );
        reopened.close();
      } finally {
        directory.deleteSync(recursive: true);
      }
    },
  );
}
