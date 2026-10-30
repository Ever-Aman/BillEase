import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

Future<void> sharePdf(Uint8List bytes, String id) async {
  final directory = await getTemporaryDirectory();
  final safe = id.replaceAll(RegExp(r'[^a-zA-Z0-9-]'), '');
  final file = File('${directory.path}/BillEase-$safe.pdf');
  await file.writeAsBytes(bytes, flush: true);
  // Keep a shared PDF long enough for the receiving Android activity to read it.
  // Remove previous exports after 24 hours; app storage is excluded from backups.
  await for (final entry in directory.list()) {
    if (entry is File &&
        entry.path.contains('/BillEase-') &&
        entry.path.endsWith('.pdf') &&
        entry.path != file.path) {
      if ((await entry.stat()).modified.isBefore(
        DateTime.now().subtract(const Duration(hours: 24)),
      )) {
        await entry.delete();
      }
    }
  }
  await SharePlus.instance.share(
    ShareParams(files: [XFile(file.path)], title: 'BillEase document'),
  );
}
