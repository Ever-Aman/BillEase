import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'ui/common.dart';
import 'ui/auth_screen.dart';
import 'ui/workspace.dart';

class BillEaseApp extends StatefulWidget {
  final AppController controller;
  const BillEaseApp({super.key, required this.controller});
  @override
  State<BillEaseApp> createState() => _BillEaseAppState();
}

class _BillEaseAppState extends State<BillEaseApp> with WidgetsBindingObserver {
  final navigator = GlobalKey<NavigatorState>();
  String _identity = '';
  void _changed() {
    final app = widget.controller;
    final next = '${app.userId}/${app.business?.id}/${app.business?.role}';
    if (next == _identity) return;
    _identity = next;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) navigator.currentState?.popUntil((route) => route.isFirst);
    });
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _identity =
        '${widget.controller.userId}/${widget.controller.business?.id}/${widget.controller.business?.role}';
    widget.controller.addListener(_changed);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      widget.controller.resume();
    }
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      widget.controller.lock();
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'BillEase',
    navigatorKey: navigator,
    debugShowCheckedModeBanner: false,
    theme: appTheme(),
    builder: (context, child) => ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) => Listener(
        onPointerDown: (_) => widget.controller.touch(),
        child: Stack(
          children: [
            child!,
            if (widget.controller.signedIn && !widget.controller.unlocked)
              const Positioned.fill(child: ColoredBox(color: ground)),
            if (widget.controller.signedIn && !widget.controller.unlocked)
              Positioned.fill(child: AuthScreen(app: widget.controller)),
          ],
        ),
      ),
    ),
    home: ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final app = widget.controller;
        if (app.booting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (!app.signedIn) return AuthScreen(app: app);
        if (!app.unlocked) return const Scaffold();
        if (app.business == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('BillEase')),
            body: PageBody(
              children: [
                const EmptyState(
                  'No business assigned',
                  'Ask your administrator to give this account owner or staff access.',
                ),
                const SizedBox(height: 20),
                AsyncButton(
                  label: 'Check access',
                  onPressed: () async {
                    await app.session.ensureOnline();
                    await app.session.loadMemberships();
                    await app.openAccount();
                  },
                ),
                TextButton(
                  onPressed: () => app.signOut(),
                  child: const Text('Sign out'),
                ),
              ],
            ),
          );
        }
        return Workspace(
          key: ValueKey(
            '${app.userId}/${app.business!.id}/${app.business!.role}',
          ),
          app: app,
        );
      },
    ),
  );
}
