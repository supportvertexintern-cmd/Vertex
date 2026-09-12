import 'package:flutter/foundation.dart';

enum ReportType { daily, weekly, monthly }

enum ReportStatus { draft, submitted, approved, rejected }

class KpiEntry {
  KpiEntry({required this.name, this.target, this.actual, this.comment = ''});

  final String name;
  int? target;
  int? actual;
  String comment;

  int? get variance => (target != null && actual != null) ? (actual! - target!) : null;
}

class RecruiterReport {
  const RecruiterReport({
    required this.id,
    required this.type,
    required this.date,
    this.campaignId,
    required this.overallStatus,
    required this.executiveSummary,
    required this.kpiEntries,
    this.status = ReportStatus.draft,
    required this.createdAt,
  });

  final String id;
  final ReportType type;
  final DateTime date;
  final String? campaignId;
  final String overallStatus;
  final String executiveSummary;
  final List<KpiEntry> kpiEntries;
  final ReportStatus status;
  final DateTime createdAt;
}

class ReportStore extends ChangeNotifier {
  final List<RecruiterReport> _reports = [];

  List<RecruiterReport> get reports => List.unmodifiable(_reports);

  void add(RecruiterReport report) {
    _reports.insert(0, report);
    notifyListeners();
  }
}
