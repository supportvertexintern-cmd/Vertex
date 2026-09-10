import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/colors.dart';
import '../../app/theme/typography.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int activeService = 0;

  static const services = [
    ('Recruitment', 'Talent, sourced and screened.', 'Unskilled to technical and engineering roles\nCredential and licence verification\nMatched to employer requirements', 'We source, screen, and coordinate candidates across regions.', Icons.groups),
    ('Work Visa & Permits', 'Compliance, handled end-to-end.', 'Work permit and employment visa processing\nLicensed partners and official channels\nDestination-side documentation support', 'Vertex coordinates compliant work permit and visa processing.', Icons.verified_user),
    ('Business Travel', 'Corporate mobility, coordinated.', 'Official business invitation processing\nConference and exhibition visa support\nStructured business mobility services', 'We coordinate business invitation processes and corporate travel.', Icons.business),
    ('Agency Partnerships', 'Expand, with institutional backing.', 'Sourcing and screening collaboration\nShared deployment workflows\nAccess to global opportunities', 'We help agencies expand into international recruitment.', Icons.handshake),
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
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
          _hero(context),
          _sectorStrip(),
          _processSection(),
          _audienceSection(),
          _opportunitiesSection(),
          _whySection(),
          _workforceSection(context),
          _faqSection(),
          _contactSection(),
          _finalCta(context),
          _footer(),
        ]),
      );

  Widget _hero(BuildContext context) => Container(
        color: VertexColors.midnight950,
        padding: const EdgeInsets.fromLTRB(22, 38, 22, 32),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('GLOBAL TALENT  ·  TRUSTED PARTNERSHIPS  ·  RELIABLE RESULTS', style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300, fontSize: 9, letterSpacing: 1.1)),
          const SizedBox(height: 20),
          Text('Your gateway to global careers.', style: VertexTypography.display.copyWith(fontSize: 40, color: Colors.white)),
          const SizedBox(height: 16),
          Text('Vertex connects talented professionals, employers, agencies and institutional partners through ethical recruitment, compliant mobility solutions, and dedicated end-to-end support.', style: VertexTypography.body.copyWith(color: Colors.white70)),
          const SizedBox(height: 24),
          Row(children: [
            Expanded(child: ElevatedButton(onPressed: () => context.push('/login'), style: ElevatedButton.styleFrom(backgroundColor: VertexColors.gold400, foregroundColor: VertexColors.midnight950), child: const Text('EXPLORE OPPORTUNITIES', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8)))),
            const SizedBox(width: 10),
            Expanded(child: OutlinedButton(onPressed: () {}, style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white38)), child: const Text('PARTNER WITH US', style: TextStyle(fontSize: 11, letterSpacing: 0.5)))),
          ]),
          const SizedBox(height: 30),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), border: Border.all(color: Colors.white24), borderRadius: BorderRadius.circular(16)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('WHAT CAN WE HELP WITH?', style: TextStyle(color: Colors.white60, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.7)),
              const SizedBox(height: 14),
              Wrap(spacing: 7, runSpacing: 7, children: List.generate(services.length, (index) => ChoiceChip(label: Text(services[index].$1, style: TextStyle(color: index == activeService ? VertexColors.midnight950 : Colors.white70, fontSize: 10)), selected: index == activeService, selectedColor: VertexColors.gold400, backgroundColor: Colors.white10, side: const BorderSide(color: Colors.white24), onSelected: (_) => setState(() => activeService = index)))),
              const SizedBox(height: 18),
              Row(children: [Icon(services[activeService].$5, color: VertexColors.gold300, size: 18), const SizedBox(width: 8), Text(services[activeService].$1.toUpperCase(), style: TextStyle(color: VertexColors.gold300, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.1))]),
              const SizedBox(height: 8),
              Text(services[activeService].$2, style: VertexTypography.h2.copyWith(fontSize: 21, color: Colors.white)),
              const SizedBox(height: 10),
              Text(services[activeService].$3, style: const TextStyle(color: Colors.white70, height: 1.7, fontSize: 12)),
              const SizedBox(height: 10),
              Text(services[activeService].$4, style: const TextStyle(color: Colors.white60, height: 1.5, fontSize: 12)),
            ]),
          ),
          const SizedBox(height: 28),
          Row(children: const [
            _Stat(value: '3', label: 'GLOBAL REGIONAL HUBS'),
            _Stat(value: 'UK', label: 'INCORPORATED & GOVERNED'),
            _Stat(value: '24/7', label: 'MULTI-HUB SUPPORT'),
          ]),
        ]),
      );

  Widget _sectorStrip() => Container(color: VertexColors.midnight900, padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 12), child: const SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [Text('MANUFACTURING', style: _StripStyle()), _Diamond(), Text('CONSTRUCTION', style: _StripStyle()), _Diamond(), Text('ENGINEERING', style: _StripStyle()), _Diamond(), Text('LOGISTICS', style: _StripStyle()), _Diamond(), Text('HOSPITALITY', style: _StripStyle())])));

  Widget _processSection() => _lightSection('THE VERTEX DELIVERY FRAMEWORK', 'From first enquiry to settlement.', 'An operating model built to institutionalize quality control across the cross-border placement cycle.', [
        ('01', Icons.assignment, 'Sourcing & Screening', 'Candidates are sourced through secure channels and screened for alignment with employer requirements.'),
        ('02', Icons.description, 'Documentation & Verification', 'Dossiers are prepared and reviewed through authentication and reference verification.'),
        ('03', Icons.payments, 'Offer & Permit Processing', 'Formal offers and contracts are coordinated alongside work permit and visa processes.'),
        ('04', Icons.public, 'Travel & Settlement', 'Flights, reception, accommodation, and a structured 90-day support loop are arranged.'),
      ]);

  Widget _audienceSection() => Container(color: VertexColors.ivory100, padding: const EdgeInsets.all(22), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _eyebrow('WHO WE SERVE'), Text('One institution, five stakeholders.', style: VertexTypography.h1.copyWith(color: VertexColors.midnight900)), const SizedBox(height: 18),
        ...[
          ('Employers & Corporate Clients', 'Verified, deployment-ready international talent across workforce categories.'),
          ('Sovereign & Institutional Stakeholders', 'Structured workforce mobility within compliant, ethical frameworks.'),
          ('Recruitment Agencies & Manpower Suppliers', 'Collaboration on sourcing, screening, and shared deployment workflows.'),
          ('Travel & Visa Partners', 'Cooperation on travel, documentation checklists, and compliance updates.'),
          ('Candidates & Professionals', 'Support through registration, documentation, visa guidance, and settlement.'),
        ].map((item) => _infoCard(Icons.business, item.$1, item.$2)),
      ]));

  Widget _opportunitiesSection() => _lightSection('OPEN POSITIONS', 'Live opportunities.', 'Explore international programmes and roles matched to your ambitions.', [('→', Icons.open_in_new, 'Browse Jobs', 'Current opportunities are published in the Vertex jobs catalogue.')]);

  Widget _whySection() => Container(color: VertexColors.midnight950, padding: const EdgeInsets.all(22), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('WHY CHOOSE VERTEX', style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300)), Text('End-to-end accountability, by design.', style: VertexTypography.h1.copyWith(color: Colors.white)), const SizedBox(height: 18),
        ...[
          ('Strategic Institutional Partnership', 'A long-term partner coordinating recruitment, mobility, compliance, travel and settlement.'),
          ('Compliance by Design', 'UK corporate governance, anti-trafficking protocols, and ethical recruitment principles.'),
          ('Transparent Processes', 'No hidden fees, opaque processes, or unverified documentation.'),
          ('24/7 Multi-Hub Support', 'Operational support across Europe, the Middle East and Africa.'),
        ].map((item) => Container(margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(17), decoration: BoxDecoration(border: Border.all(color: Colors.white12), borderRadius: BorderRadius.circular(14)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.verified_user, color: VertexColors.gold300, size: 22), const SizedBox(height: 10), Text(item.$1, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14)), const SizedBox(height: 5), Text(item.$2, style: const TextStyle(color: Colors.white60, height: 1.5, fontSize: 12))]))),
      ]));

  Widget _workforceSection(BuildContext context) => _lightSection('WORKFORCE CATEGORIES', 'Matched to the right tier.', 'A clear path for every kind of international professional.', [
        ('01', Icons.school, 'Unskilled & General Workforce', 'Agriculture, logistics, facilities, manufacturing, food processing, and construction support.'),
        ('02', Icons.workspace_premium, 'Semi-Skilled & Vocational Trades', 'Plumbers, electricians, welders, machinery operators, and hospitality professionals.'),
        ('03', Icons.business, 'Technical & Engineering', 'Civil, mechanical, electrical, petroleum, project supervision, and EPC talent.'),
        ('✓', Icons.check_circle, 'Before you apply', 'Valid passport, CV, education records, credentials, police clearance, and medical checks.'),
      ]);

  Widget _faqSection() => Container(color: VertexColors.ivory100, padding: const EdgeInsets.all(22), child: Column(children: [
        _eyebrow('COMMON QUESTIONS'), Text('Answers, upfront.', style: VertexTypography.h1.copyWith(color: VertexColors.midnight900)), const SizedBox(height: 14),
        ...[
          ('Who can Vertex place internationally?', 'We support unskilled, semi-skilled, and technical workforce categories matched to employer requirements.'),
          ('What documents do I need?', 'A valid passport, CV, educational records, professional credentials, police clearance, and medical checks.'),
          ('Where does Vertex operate?', 'We are headquartered in London, with regional hubs in the UAE and across Africa.'),
          ('How does Vertex work with agencies?', 'We collaborate on sourcing, screening, documentation, and shared deployment workflows.'),
          ('What compliance standards does Vertex follow?', 'Our approach follows UK governance, anti-bribery, modern slavery, and ethical recruitment safeguards.'),
        ].map((faq) => ExpansionTile(title: Text(faq.$1, style: const TextStyle(color: VertexColors.midnight900, fontWeight: FontWeight.w700, fontSize: 14)), iconColor: VertexColors.gold500, collapsedIconColor: VertexColors.gold500, children: [Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), child: Text(faq.$2, style: const TextStyle(color: VertexColors.gray600, height: 1.5, fontSize: 13)))])),
      ]));

  Widget _contactSection() => Container(
        color: VertexColors.midnight900,
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('REACH US DIRECTLY', style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300)),
            Text('One message away, always.', style: VertexTypography.h1.copyWith(color: Colors.white)),
            const SizedBox(height: 16),
            _contactTile(Icons.chat_bubble_outline, 'WHATSAPP', '+44 7438 613251'),
            _contactTile(Icons.phone_outlined, 'OFFICE', '+44 20 3026 3403'),
            _contactTile(Icons.email_outlined, 'EMAIL', 'vertex@vertexintern.com'),
          ],
        ),
      );

  Widget _finalCta(BuildContext context) => Container(color: VertexColors.midnight950, padding: const EdgeInsets.fromLTRB(22, 55, 22, 60), child: Column(children: [Text('BEGIN TODAY', style: VertexTypography.eyebrow.copyWith(color: VertexColors.gold300)), const SizedBox(height: 18), Text('Build across borders.\nMove with confidence.', textAlign: TextAlign.center, style: VertexTypography.display.copyWith(color: Colors.white, fontSize: 32)), const SizedBox(height: 16), const Text('Whether you are an employer, agency, partner, or candidate ready to pursue opportunities abroad, Vertex provides the platform to move forward.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white60, height: 1.5, fontSize: 13)), const SizedBox(height: 25), SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => context.push('/login'), style: ElevatedButton.styleFrom(backgroundColor: VertexColors.gold400, foregroundColor: VertexColors.midnight950), child: const Text('APPLY NOW')))]));

  Widget _footer() => Container(color: VertexColors.midnight950, padding: const EdgeInsets.fromLTRB(22, 0, 22, 28), child: const Text('© 2026 Vertex International Recruitment Ltd.\nCompany No. 16943308  ·  vertex@vertexintern.com', style: TextStyle(color: Colors.white38, height: 1.7, fontSize: 11)));

  Widget _lightSection(String eyebrow, String title, String subtitle, List<(String, IconData, String, String)> items) => Container(color: VertexColors.ivory50, padding: const EdgeInsets.all(22), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [_eyebrow(eyebrow), Text(title, style: VertexTypography.h1.copyWith(color: VertexColors.midnight900)), const SizedBox(height: 8), Text(subtitle, style: const TextStyle(color: VertexColors.gray600, height: 1.5, fontSize: 13)), const SizedBox(height: 18), ...items.map((item) => _infoCard(item.$2, item.$3, item.$4, number: item.$1))]));

  Widget _infoCard(IconData icon, String title, String text, {String? number}) => Container(margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(17), decoration: BoxDecoration(color: Colors.white, border: Border.all(color: VertexColors.ivory200), borderRadius: BorderRadius.circular(15)), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [if (number != null) Padding(padding: const EdgeInsets.only(right: 12, top: 2), child: Text(number, style: const TextStyle(color: VertexColors.gold500, fontSize: 12, fontWeight: FontWeight.w800))), Container(width: 38, height: 38, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: VertexColors.ivory200)), child: Icon(icon, size: 18, color: VertexColors.midnight800)), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(color: VertexColors.midnight900, fontWeight: FontWeight.w700, fontSize: 14)), const SizedBox(height: 5), Text(text, style: const TextStyle(color: VertexColors.gray600, height: 1.45, fontSize: 12))]))]));

  Widget _eyebrow(String text) => Padding(padding: const EdgeInsets.only(bottom: 9), child: Text(text, style: VertexTypography.eyebrow.copyWith(fontSize: 10, letterSpacing: 1.4)));
  Widget _contactTile(IconData icon, String label, String value) => Container(margin: const EdgeInsets.only(top: 9), padding: const EdgeInsets.all(16), decoration: BoxDecoration(border: Border.all(color: Colors.white12), borderRadius: BorderRadius.circular(13)), child: Row(children: [Icon(icon, color: VertexColors.gold300, size: 23), const SizedBox(width: 13), Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(color: Colors.white38, fontSize: 10, letterSpacing: 1.5, fontWeight: FontWeight.w700)), const SizedBox(height: 4), Text(value, style: const TextStyle(color: Colors.white70, fontSize: 13))])]));
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
