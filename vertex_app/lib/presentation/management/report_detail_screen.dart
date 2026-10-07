import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/colors.dart';

class ManagementReportDetailScreen extends StatefulWidget {
  final String reportId;
  const ManagementReportDetailScreen({super.key, required this.reportId});

  @override
  State<ManagementReportDetailScreen> createState() =>
      _ManagementReportDetailScreenState();
}

class _ManagementReportDetailScreenState
    extends State<ManagementReportDetailScreen> {
  bool _loading = true;
  bool _saving = false;
  String _status = 'submitted';
  String? _returnReason;
  final _returnController = TextEditingController();

  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _loading = false);
    });
  }

  @override
  void dispose() {
    _returnController.dispose();
    super.dispose();
  }

  void _approve() {
    setState(() => _saving = true);
    Future.delayed(const Duration(milliseconds: 600), () {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _status = 'verified';
      });
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Report approved.')));
    });
  }

  void _returnReport() {
    if (_returnController.text.trim().length < 5) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Please provide a reason (min 5 characters).')));
      return;
    }
    setState(() => _saving = true);
    Future.delayed(const Duration(milliseconds: 600), () {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _status = 'returned';
        _returnReason = _returnController.text.trim();
      });
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Report returned.')));
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
          body: Center(
              child: CircularProgressIndicator(color: VertexColors.midnight500)));
    }

    final isPending = _status == 'submitted';
    final statusColor = isPending
        ? VertexColors.gold600
        : (_status == 'verified' ? VertexColors.midnight500 : VertexColors.error);

    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        title: const Text(
          'Portfolio Report',
          style: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => context.pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 20, 18, 100),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'MONTHLY PORTFOLIO REPORT',
                style: TextStyle(
                  color: VertexColors.midnight900,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  _status.toUpperCase(),
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: statusColor,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'In-House Supervisor · 01/08/2026 - 31/08/2026',
            style: TextStyle(color: VertexColors.gray600, fontSize: 13),
          ),
          const SizedBox(height: 20),

          if (_status == 'returned' && _returnReason != null)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: const Color(0xFFFFEBEE),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: VertexColors.error.withValues(alpha: 0.3)),
              ),
              child: Text(
                'Returned: $_returnReason',
                style: const TextStyle(color: VertexColors.error, fontSize: 13),
              ),
            ),

          // Consolidated Reports Info
          Container(
            padding: const EdgeInsets.all(14),
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: VertexColors.ivory100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '3 country reports consolidated',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: VertexColors.midnight900,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  'Kenya → Nigeria → You',
                  style: TextStyle(fontSize: 12, color: VertexColors.gray600),
                ),
              ],
            ),
          ),

          // Report Content
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: VertexColors.ivory200),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Executive Summary',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                    color: VertexColors.midnight900,
                  ),
                ),
                SizedBox(height: 8),
                Text(
                  'The portfolio this month saw a 15% increase in candidate throughput. All targets were met, with strong performance from the Kenya and Nigeria teams.',
                  style: TextStyle(
                    color: VertexColors.gray600,
                    fontSize: 13,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      // Action Bar (only if pending)
      bottomNavigationBar: isPending
          ? Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.05),
                    blurRadius: 10,
                    offset: const Offset(0, -4),
                  ),
                ],
              ),
              child: SafeArea(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton.icon(
                        onPressed: _saving ? null : _approve,
                        icon: const Icon(Icons.check_circle_outline, size: 18),
                        label: const Text(
                          'APPROVE REPORT',
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: VertexColors.midnight800,
                          foregroundColor: Colors.white,
                          shape: const StadiumBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _returnController,
                            decoration: InputDecoration(
                              hintText: 'Reason for return...',
                              hintStyle: const TextStyle(fontSize: 12),
                              filled: true,
                              fillColor: VertexColors.ivory50,
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 14),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(11),
                                borderSide: const BorderSide(color: VertexColors.ivory200),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: _saving ? null : _returnReport,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: VertexColors.error,
                            foregroundColor: Colors.white,
                            shape: const StadiumBorder(),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 20, vertical: 14),
                          ),
                          child: const Text(
                            'RETURN',
                            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            )
          : null,
    );
  }
}
