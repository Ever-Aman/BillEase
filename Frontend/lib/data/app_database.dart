import 'package:drift/drift.dart';

class AppDatabase extends GeneratedDatabase {
  AppDatabase(super.executor);
  @override
  int get schemaVersion => 1;
  @override
  Iterable<TableInfo> get allTables => const [];
  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (_) async {
      await customStatement(
        'CREATE TABLE cache_entries(scope TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,kind,id))',
      );
      await customStatement(
        'CREATE TABLE catalogue_units(scope TEXT NOT NULL,id TEXT NOT NULL,item_id TEXT NOT NULL,label TEXT NOT NULL,factor TEXT NOT NULL,price_minor TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(scope,id))',
      );
      await customStatement(
        'CREATE INDEX units_item ON catalogue_units(scope,item_id)',
      );
      await customStatement(
        'CREATE TABLE outbox(scope TEXT NOT NULL,id TEXT NOT NULL,intent TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(scope,id))',
      );
    },
  );
}
