import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../app/theme/colors.dart';
import '../../app/theme/typography.dart';
import '../../core/landing/landing_store.dart';

typedef _Body = Map<String, dynamic>;

/// The block icons' names (vertex_be ICONS), as this app draws them.
const _icons = <String, IconData>{
  'users': Icons.groups,
  'shield': Icons.verified_user,
  'building': Icons.business,
  'handshake': Icons.handshake,
  'clipboard': Icons.assignment,
  'document': Icons.description,
  'coins': Icons.payments,
  'globe': Icons.public,
  'seal': Icons.verified,
  'check': Icons.check_circle,
  'phone': Icons.phone,
  'graduation': Icons.school,
  'certificate': Icons.workspace_premium,
  'share': Icons.share,
  'qr': Icons.qr_code,
  'chat': Icons.chat_bubble_outline,
  'network': Icons.account_tree,
  'chart': Icons.insights,
  'open': Icons.open_in_new,
  'payments': Icons.payments,
};

IconData _icon(Object? name, IconData fallback) => _icons[name] ?? fallback;
String _s(_Body? body, String key) => body?[key] is String ? body![key] as String : '';
List<_Body> _items(_Body? body, String key) =>
    (body?[key] is List ? body![key] as List : const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
List<String> _strings(_Body? body, String key) => (body?[key] is List ? body![key] as List : const []).whereType<String>().toList();

/// The home screen before sign-in. Its text is marketing's (the landing
/// CMS; lib/core/landing/landing_store.dart), or the built-in text: the
/// same words the screen had before. A block marketing hid isn't shown.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int activeService = 0;

  static final _builtIn = LandingStore.builtIn();

  @override
  Widget build(BuildContext context) {
    // Without a store (a test, or before main provides one): the built-in text.
    final blocks = context.watch<LandingStore?>()?.blocks ?? _builtIn;
    _Body? block(String key) => blocks[key];

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 72,
        titleSpacing: 20,
        title: Row(children: [
          Image.asset('assets/images/vertex-logo.png', width: 29, height: 30, color: Colors.white, colorBlendMode: BlendMode.srcIn),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('VERTEX', style: VertexTypography.label.copyWith(color: Colors.white, fontSize: 15, letterSpacing: 2.2)),
            Text('INTERNATIONAL', style: VertexTypography.eyebrow.copyWith(fontSize: 8, letterSpacing: 1)),
          ]),
        ]),
        actions: [
          TextButton(onPressed: () => context.push('/login'), child: const Text('LOG IN', style: TextStyle(color: Colors.white, fontSize: 11, letterSpacing: 1.4, fontWeight: FontWeight.w700))),
          const SizedBox(width: 10),
        ],
      ),
      body: ListView(children: [
        if (block('mobile.hero') case final hero?) _hero(context, hero),
        if (block('mobile.sectors') case final sectors?) _sectorStrip(sectors),
        if (block('mobile.process') case final process?) _lightSection(process),
        if (block('mobile.audiences') case final audiences?) _audienceSection(audiences),
        if (block('mobile.workspace') case final workspace?) _lightSection(workspace),
        if (block('shared.why_vertex') case final why?) _whySection(why),
        if (block('mobile.operations') case final operations?) _lightSection(operations),
        if (block('mobile.faq') case final faq?) _faqSection(faq),
        if (block('shared.contact') case final contact?) _contactSection(contact),
        if (block('mobile.ending') case final ending?) _finalCta(context, ending),
        if (block('mobile.footer') case final footer?) _footer(footer),
      ]),
    );
  }

  Widget _hero(BuildContext context, _Body hero) {
    final services = _items(hero, 'services');
    final active = services.isEmpty ? null : services[activeService.clamp(0, services.length - 1)];
    final stats = _items(hero, 'stats');
    return Container(
      color: VertexColors.midnight950,
      padding: const EdgeInsets.fromLTRB(22, 38, 22, 32),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(_s(hero, 'eyebrow'), style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300, fontSize: 9, letterSpacing: 1.1)),
        const SizedBox(height: 20),
        Text(_s(hero, 'headline'), style: VertexTypography.display.copyWith(fontSize: 40, color: Colors.white)),
        const SizedBox(height: 16),
        Text(_s(hero, 'intro'), style: VertexTypography.body.copyWith(color: Colors.white70)),
        const SizedBox(height: 24),
        Row(children: [
          Expanded(child: ElevatedButton(onPressed: () => context.push('/login'), style: ElevatedButton.styleFrom(backgroundColor: VertexColors.gold400, foregroundColor: VertexColors.midnight950), child: Text(_s(hero, 'primary_label'), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8)))),
          const SizedBox(width: 10),
          Expanded(child: OutlinedButton(onPressed: () {}, style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white38)), child: Text(_s(hero, 'secondary_label'), style: const TextStyle(fontSize: 11, letterSpacing: 0.5)))),
        ]),
        if (active != null) ...[
          const SizedBox(height: 30),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), border: Border.all(color: Colors.white24), borderRadius: BorderRadius.circular(16)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_s(hero, 'services_title'), style: const TextStyle(color: Colors.white60, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.7)),
              const SizedBox(height: 14),
              Wrap(spacing: 7, runSpacing: 7, children: List.generate(services.length, (index) => ChoiceChip(label: Text(_s(services[index], 'label'), style: TextStyle(color: index == activeService ? VertexColors.midnight950 : Colors.white70, fontSize: 10)), selected: index == activeService, selectedColor: VertexColors.gold400, backgroundColor: Colors.white10, side: const BorderSide(color: Colors.white24), onSelected: (_) => setState(() => activeService = index)))),
              const SizedBox(height: 18),
              Row(children: [Icon(_icon(active['icon'], Icons.groups), color: VertexColors.gold300, size: 18), const SizedBox(width: 8), Flexible(child: Text(_s(active, 'label').toUpperCase(), style: const TextStyle(color: VertexColors.gold300, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.1)))]),
              const SizedBox(height: 8),
              Text(_s(active, 'headline'), style: VertexTypography.h2.copyWith(fontSize: 21, color: Colors.white)),
              const SizedBox(height: 10),
              Text(_strings(active, 'points').join('\n'), style: const TextStyle(color: Colors.white70, height: 1.7, fontSize: 12)),
              const SizedBox(height: 10),
              Text(_s(active, 'text'), style: const TextStyle(color: Colors.white60, height: 1.5, fontSize: 12)),
            ]),
          ),
        ],
        if (stats.isNotEmpty) ...[
          const SizedBox(height: 28),
          Row(children: [for (final stat in stats) _Stat(value: _s(stat, 'value'), label: _s(stat, 'label'))]),
        ],
      ]),
    );
  }

  Widget _sectorStrip(_Body sectors) {
    final items = _strings(sectors, 'items');
    return Container(
      color: VertexColors.midnight900,
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 12),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (var i = 0; i < items.length; i++) ...[if (i > 0) const _Diamond(), Text(items[i], style: const _StripStyle())],
        ]),
      ),
    );
  }

  Widget _audienceSection(_Body section) => Container(color: VertexColors.ivory100, padding: const EdgeInsets.all(22), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _eyebrow(_s(section, 'eyebrow')), Text(_s(section, 'title'), style: VertexTypography.h1.copyWith(color: VertexColors.midnight900)), const SizedBox(height: 18),
        ..._items(section, 'cards').map((card) => _infoCard(_icon(card['icon'], Icons.business), _s(card, 'title'), _s(card, 'text'))),
      ]));

  // Shared with the website (written in its capitals): this screen's eyebrows are upper case.
  Widget _whySection(_Body section) => Container(color: VertexColors.midnight950, padding: const EdgeInsets.all(22), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(_s(section, 'eyebrow').toUpperCase(), style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300)), Text(_s(section, 'title'), style: VertexTypography.h1.copyWith(color: Colors.white)), const SizedBox(height: 18),
        ..._items(section, 'cards').map((card) => Container(margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(17), decoration: BoxDecoration(border: Border.all(color: Colors.white12), borderRadius: BorderRadius.circular(14)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(_icon(card['icon'], Icons.verified_user), color: VertexColors.gold300, size: 22), const SizedBox(height: 10), Text(_s(card, 'title'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14)), const SizedBox(height: 5), Text(_s(card, 'text'), style: const TextStyle(color: Colors.white60, height: 1.5, fontSize: 12))]))),
      ]));

  // Material, not a coloured Container: the tiles' ink needs a Material to paint on.
  Widget _faqSection(_Body section) => Material(color: VertexColors.ivory100, child: Padding(padding: const EdgeInsets.all(22), child: Column(children: [
        _eyebrow(_s(section, 'eyebrow')), Text(_s(section, 'title'), style: VertexTypography.h1.copyWith(color: VertexColors.midnight900)), const SizedBox(height: 14),
        ..._items(section, 'items').map((faq) => ExpansionTile(title: Text(_s(faq, 'q'), style: const TextStyle(color: VertexColors.midnight900, fontWeight: FontWeight.w700, fontSize: 14)), iconColor: VertexColors.gold500, collapsedIconColor: VertexColors.gold500, children: [Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), child: Text(_s(faq, 'a'), style: const TextStyle(color: VertexColors.gray600, height: 1.5, fontSize: 13)))])),
      ])));

  Widget _contactSection(_Body contact) => Container(
        color: VertexColors.midnight900,
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_s(contact, 'eyebrow').toUpperCase(), style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300)),
            Text(_s(contact, 'title'), style: VertexTypography.h1.copyWith(color: Colors.white)),
            const SizedBox(height: 16),
            _contactTile(Icons.chat_bubble_outline, 'WHATSAPP', _s(contact, 'whatsapp')),
            _contactTile(Icons.phone_outlined, 'OFFICE', _s(contact, 'office')),
            _contactTile(Icons.email_outlined, 'EMAIL', _s(contact, 'email')),
          ],
        ),
      );

  Widget _finalCta(BuildContext context, _Body ending) => Container(color: VertexColors.midnight950, padding: const EdgeInsets.fromLTRB(22, 55, 22, 60), child: Column(children: [Text(_s(ending, 'eyebrow'), style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300)), const SizedBox(height: 18), Text(_s(ending, 'title'), textAlign: TextAlign.center, style: VertexTypography.display.copyWith(color: Colors.white, fontSize: 32)), const SizedBox(height: 16), Text(_s(ending, 'text'), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white60, height: 1.5, fontSize: 13)), const SizedBox(height: 25), SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => context.push('/login'), style: ElevatedButton.styleFrom(backgroundColor: VertexColors.gold400, foregroundColor: VertexColors.midnight950), child: Text(_s(ending, 'button_label'))))]));

  Widget _footer(_Body footer) => Container(color: VertexColors.midnight950, padding: const EdgeInsets.fromLTRB(22, 0, 22, 28), child: Text(_s(footer, 'text'), style: const TextStyle(color: Colors.white38, height: 1.7, fontSize: 11)));

  // A section of numbered (or marked) cards: the delivery framework, the workspace, the operational domains.
  Widget _lightSection(_Body section) {
    final subtitle = _s(section, 'subtitle');
    return Container(color: VertexColors.ivory50, padding: const EdgeInsets.all(22), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _eyebrow(_s(section, 'eyebrow')),
      Text(_s(section, 'title'), style: VertexTypography.h1.copyWith(color: VertexColors.midnight900)),
      if (subtitle.isNotEmpty) ...[const SizedBox(height: 8), Text(subtitle, style: const TextStyle(color: VertexColors.gray600, height: 1.5, fontSize: 13))],
      const SizedBox(height: 18),
      ..._items(section, 'cards').map((card) => _infoCard(_icon(card['icon'], Icons.check_circle), _s(card, 'title'), _s(card, 'text'), number: card['marker'] is String ? card['marker'] as String : null)),
    ]));
  }

  Widget _infoCard(IconData icon, String title, String text, {String? number}) => Container(margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(17), decoration: BoxDecoration(color: Colors.white, border: Border.all(color: VertexColors.ivory200), borderRadius: BorderRadius.circular(15)), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [if (number != null) Padding(padding: const EdgeInsets.only(right: 12, top: 2), child: Text(number, style: const TextStyle(color: VertexColors.gold500, fontSize: 12, fontWeight: FontWeight.w800))), Container(width: 38, height: 38, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: VertexColors.ivory200)), child: Icon(icon, size: 18, color: VertexColors.midnight800)), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(color: VertexColors.midnight900, fontWeight: FontWeight.w700, fontSize: 14)), const SizedBox(height: 5), Text(text, style: const TextStyle(color: VertexColors.gray600, height: 1.45, fontSize: 12))]))]));

  Widget _eyebrow(String text) => Padding(padding: const EdgeInsets.only(bottom: 9), child: Text(text, style: VertexTypography.eyebrow.copyWith(fontSize: 10, letterSpacing: 1.4)));
  Widget _contactTile(IconData icon, String label, String value) => Container(margin: const EdgeInsets.only(top: 9), padding: const EdgeInsets.all(16), decoration: BoxDecoration(border: Border.all(color: Colors.white12), borderRadius: BorderRadius.circular(13)), child: Row(children: [Icon(icon, color: VertexColors.gold300, size: 23), const SizedBox(width: 13), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(color: Colors.white38, fontSize: 10, letterSpacing: 1.5, fontWeight: FontWeight.w700)), const SizedBox(height: 4), Text(value, style: const TextStyle(color: Colors.white70, fontSize: 13))]))]));
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});
  final String value;
  final String label;
  @override
  Widget build(BuildContext context) => Expanded(child: Padding(padding: const EdgeInsets.only(right: 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(value, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700)), const SizedBox(height: 5), Text(label, style: const TextStyle(color: Colors.white54, fontSize: 8, height: 1.3, letterSpacing: 0.7))])));
}

class _Diamond extends StatelessWidget {
  const _Diamond();
  @override
  Widget build(BuildContext context) => const Padding(padding: EdgeInsets.symmetric(horizontal: 18), child: Text('◆', style: TextStyle(color: VertexColors.gold500, fontSize: 8)));
}

class _StripStyle extends TextStyle {
  const _StripStyle() : super(color: Colors.white54, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.7);
}
