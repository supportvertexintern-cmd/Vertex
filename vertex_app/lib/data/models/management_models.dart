// ============ Report Metrics ============
class ReportMetricsRow {
  final String id;
  final String fullName;
  final String role; // regional_recruiter, country_supervisor
  final String? countryName;
  final int submittedCount;
  final int verifiedCount;
  final int returnedCount;
  final DateTime? lastReportAt;

  ReportMetricsRow({
    required this.id,
    required this.fullName,
    required this.role,
    this.countryName,
    required this.submittedCount,
    required this.verifiedCount,
    required this.returnedCount,
    this.lastReportAt,
  });
}

// ============ Portfolio Reports ============
class PortfolioReportRow {
  final String id;
  final String type; // daily, weekly, monthly
  final String status; // submitted, verified, returned, etc.
  final DateTime periodStart;
  final DateTime periodEnd;
  final String submitterName;
  final String? returnReason;

  PortfolioReportRow({
    required this.id,
    required this.type,
    required this.status,
    required this.periodStart,
    required this.periodEnd,
    required this.submitterName,
    this.returnReason,
  });
}

class PortfolioReportDetail {
  final String id;
  final String type;
  final String status;
  final DateTime periodStart;
  final DateTime periodEnd;
  final String? returnReason;
  final String submitterName;
  final String content;
  final List<String> childReports;

  PortfolioReportDetail({
    required this.id,
    required this.type,
    required this.status,
    required this.periodStart,
    required this.periodEnd,
    this.returnReason,
    required this.submitterName,
    required this.content,
    required this.childReports,
  });
}

// ============ Staff Scorecards ============
class StaffScorecardRow {
  final String id;
  final String fullName;
  final List<String> assignedCountries;

  StaffScorecardRow({
    required this.id,
    required this.fullName,
    required this.assignedCountries,
  });
}
