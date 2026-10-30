import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/models.dart';
import 'common.dart';

class SecurityScreen extends StatefulWidget {
  final AppController app;
  const SecurityScreen({super.key, required this.app});
  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  List<Json> devices = [];
  Json? mfa;
  String? error;
  AppController get app => widget.app;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<Json> request(String method, String path, {Json? body}) async {
    if (app.preview) {
      throw StateError('Security settings require a signed-in Android app');
    }
    await app.session.ensureOnline();
    return app.api.request(method, path, body: body);
  }

  Future<void> load() async {
    try {
      final a = await request('GET', '/me/devices'),
          b = await request('GET', '/me/mfa');
      if (mounted) {
        setState(() {
          devices = objects(a['devices']);
          mfa = b;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    }
  }

  Future<String?> secretPrompt(
    String title, {
    String label = 'Password',
  }) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          obscureText: true,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
    controller.dispose();
    return result;
  }

  Future<void> showCodes(Json result) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Save your recovery codes'),
        content: SizedBox(
          width: 400,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Shown once. Store them safely away from this phone. Each code works once. Email recovery is inactive.',
                ),
                const SizedBox(height: 16),
                SelectableText(
                  (result['recoveryCodes'] as List? ?? []).join('\n'),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
                ),
              ],
            ),
          ),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('I saved these codes'),
          ),
        ],
      ),
    );
  }

  Future<void> setup() async {
    final password = await secretPrompt('Set up authenticator');
    if (password == null || !mounted) return;
    await perform(context, () async {
      final result = await request(
        'POST',
        '/me/mfa/setup',
        body: {'password': password},
      );
      if (!mounted) return;
      final code = await showDialog<String>(
        context: context,
        builder: (_) => _MfaConfirm(secret: '${result['secret']}'),
      );
      if (code == null) return;
      final confirmed = await request(
        'POST',
        '/me/mfa/confirm',
        body: {'code': code},
      );
      await showCodes(confirmed);
      await load();
    });
  }

  Future<void> rotate() async {
    final password = await secretPrompt('Replace recovery codes');
    if (password == null || !mounted) return;
    final code = await fieldsDialog(
      context,
      title: 'Verify authenticator',
      fields: {'6-digit code': ''},
    );
    if (code == null || !mounted) return;
    await perform(context, () async {
      final result = await request(
        'POST',
        '/me/mfa/recovery-codes',
        body: {'password': password, 'mfaCode': code['6-digit code']},
      );
      await showCodes(result);
      await load();
    });
  }

  Future<void> changePin() async {
    final old = await secretPrompt('Verify current PIN', label: '6-digit PIN');
    if (old == null) return;
    if (!await app.localLock.verifyPin(app.userId, old)) {
      if (mounted) showError(context, 'Incorrect PIN');
      return;
    }
    if (!mounted) return;
    final next = await secretPrompt(
      'Choose new phone PIN',
      label: '6-digit PIN',
    );
    if (next == null || !mounted) return;
    final confirm = await secretPrompt(
      'Confirm new phone PIN',
      label: '6-digit PIN',
    );
    if (confirm != next) throw StateError('PINs do not match');
    await app.localLock.setPin(app.userId, next);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Security & devices')),
    body: PageBody(
      children: [
        Text('Phone security', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                app.session.data!.owner
                    ? 'Owner records use your phone’s secure unlock.'
                    : 'Staff records use a six-digit local PIN with attempt limits.',
              ),
              const SizedBox(height: 8),
              const Text(
                'The app locks after five minutes without activity and when sent to the background.',
                style: TextStyle(color: muted, fontSize: 12),
              ),
              if (!app.session.data!.owner)
                TextButton(
                  onPressed: () => perform(context, changePin),
                  child: const Text('Change phone PIN'),
                ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        if (app.session.data!.owner) ...[
          Text('Authenticator', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          if (error != null) Text(error!),
          if (mfa != null)
            StatusTag(
              mfa!['active'] == true ? 'ENABLED' : 'NOT ENABLED',
              attention: mfa!['active'] != true,
            ),
          const SizedBox(height: 12),
          if (mfa != null && mfa!['active'] == true)
            OutlinedButton(
              onPressed: rotate,
              child: const Text('Replace recovery codes'),
            )
          else
            OutlinedButton(
              onPressed: setup,
              child: const Text('Set up authenticator'),
            ),
          const SizedBox(height: 24),
        ],
        Text('Signed-in phones', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        for (final d in devices)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              '${d['name']}${d['current'] == true ? ' · this phone' : ''}',
            ),
            subtitle: Text(
              '${d['active'] == true ? 'Active' : 'Revoked'} · ${d['last_seen_at']}',
            ),
            trailing: d['active'] == true
                ? TextButton(
                    onPressed: () => perform(context, () async {
                      final confirm = await fieldsDialog(
                        context,
                        title: 'Revoke phone access',
                        fields: {'Type REVOKE': ''},
                        detail: 'The phone will need to sign in again. Unsent work is retained for owner review.',
                      );
                      if (confirm?['Type REVOKE'] != 'REVOKE') return;
                      await request('DELETE', '/me/devices/${d['id']}');
                      if (d['current'] == true) {
                        await app.signOut();
                      } else {
                        await load();
                      }
                    }),
                    child: const Text('Revoke'),
                  )
                : null,
          ),
        const SizedBox(height: 20),
        OutlinedButton(
          onPressed: load,
          child: const Text('Refresh security status'),
        ),
      ],
    ),
  );
}

class _MfaConfirm extends StatefulWidget {
  final String secret;
  const _MfaConfirm({required this.secret});
  @override
  State<_MfaConfirm> createState() => _MfaConfirmState();
}

class _MfaConfirmState extends State<_MfaConfirm> {
  final code = TextEditingController();
  @override
  void dispose() {
    code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Add to your authenticator'),
    content: SizedBox(
      width: 380,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Enter this setup key in your authenticator app, then enter the generated code. The setup expires in ten minutes.',
          ),
          const SizedBox(height: 16),
          SelectableText(
            widget.secret,
            style: const TextStyle(fontFamily: 'monospace'),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: code,
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: const InputDecoration(labelText: '6-digit code'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () {
          if (!RegExp(r'^\d{6}$').hasMatch(code.text)) {
            showError(context, 'Enter a six-digit code');
            return;
          }
          Navigator.pop(context, code.text);
        },
        child: const Text('Enable authenticator'),
      ),
    ],
  );
}
