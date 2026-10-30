import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/config.dart';
import 'common.dart';

class AuthScreen extends StatefulWidget {
  final AppController app;
  const AuthScreen({super.key, required this.app});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final email = TextEditingController(),
      password = TextEditingController(),
      mfa = TextEditingController(),
      recovery = TextEditingController(),
      pin = TextEditingController(),
      confirmPin = TextEditingController();
  bool showMfa = false, reauthenticate = false;
  @override
  void dispose() {
    for (final c in [email, password, mfa, recovery, pin, confirmPin]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = widget.app, locked = app.signedIn && !reauthenticate;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: ink,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(
                          Icons.receipt_long_outlined,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        'BillEase',
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const Spacer(),
                      if (!AppConfig.production) const StatusTag('DEVELOPMENT'),
                    ],
                  ),
                  const SizedBox(height: 48),
                  Text(
                    locked
                        ? app.pinSetup
                              ? 'Set your phone PIN'
                              : 'Welcome back'
                        : 'Your business,\nin good order.',
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    locked ? app.session.data!.email : 'Bills, deliveries and customer accounts.\nReady when the connection isn’t.',
                    style: const TextStyle(color: muted),
                  ),
                  const SizedBox(height: 32),
                  if (app.error != null) ...[
                    Text(app.error!, style: const TextStyle(color: Colors.red)),
                    const SizedBox(height: 12),
                  ],
                  if (!locked) ...[
                    TextField(
                      controller: email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      decoration: const InputDecoration(
                        labelText: 'Email address',
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      decoration: const InputDecoration(labelText: 'Password'),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: () => setState(() => showMfa = !showMfa),
                      child: const Text('Use authenticator or recovery code'),
                    ),
                    if (showMfa) ...[
                      TextField(
                        controller: mfa,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Authenticator code',
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: recovery,
                        obscureText: true,
                        decoration: const InputDecoration(
                          labelText: 'Or one-time recovery code',
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    AsyncButton(
                      label: 'Sign in',
                      onPressed: () async {
                        if (email.text.trim().isEmpty ||
                            password.text.isEmpty) {
                          throw StateError('Enter your email and password');
                        }
                        await app.signIn(
                          email.text,
                          password.text,
                          mfa: mfa.text,
                          recovery: recovery.text,
                        );
                        password.clear();
                        mfa.clear();
                        recovery.clear();
                        if (mounted) setState(() => reauthenticate = false);
                      },
                    ),
                  ] else ...[
                    if (!app.session.data!.owner || app.pinSetup) ...[
                      TextField(
                        controller: pin,
                        obscureText: true,
                        maxLength: 6,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: '6-digit phone PIN',
                        ),
                      ),
                      if (app.pinSetup)
                        TextField(
                          controller: confirmPin,
                          obscureText: true,
                          maxLength: 6,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Confirm PIN',
                          ),
                        ),
                      const SizedBox(height: 16),
                    ],
                    AsyncButton(
                      label: app.pinSetup
                          ? 'Save PIN'
                          : app.session.data!.owner
                          ? 'Unlock with phone security'
                          : 'Unlock',
                      onPressed: () async {
                        if (app.pinSetup) {
                          if (pin.text != confirmPin.text) {
                            throw StateError('PINs do not match');
                          }
                          await app.setPin(pin.text);
                        } else {
                          await app.unlock(pin: pin.text);
                        }
                        pin.clear();
                        confirmPin.clear();
                      },
                    ),
                    TextButton(
                      onPressed: () {
                        email.text = app.session.data!.email;
                        setState(() => reauthenticate = true);
                      },
                      child: const Text('Sign in again with password'),
                    ),
                    TextButton(
                      onPressed: () => app.signOut(),
                      child: const Text('Sign out'),
                    ),
                  ],
                  FutureBuilder<String?>(
                    future: app.vault.read('recovery'),
                    builder: (context, snapshot) => snapshot.data == null
                        ? const SizedBox()
                        : Padding(
                            padding: const EdgeInsets.only(top: 24),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                AsyncButton(
                                  label: 'Send saved work for owner review',
                                  onPressed: () async {
                                    final count = await app.recover();
                                    if (context.mounted) {
                                      ScaffoldMessenger.of(
                                        context,
                                      ).showSnackBar(
                                        SnackBar(
                                          content: Text(
                                            '$count saved operations sent for review.',
                                          ),
                                        ),
                                      );
                                    }
                                  },
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'Work from revoked access needs owner review before it affects business records.',
                                  style: TextStyle(fontSize: 12, color: muted),
                                ),
                              ],
                            ),
                          ),
                  ),
                  const SizedBox(height: 32),
                  const Text(
                    'Encrypted on this phone. Access is checked again when you connect.',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
