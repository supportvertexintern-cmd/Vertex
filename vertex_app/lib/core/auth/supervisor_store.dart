import 'package:flutter/foundation.dart';

enum KpiPeriod { daily, weekly, monthly }

class Recruiter {
  const Recruiter({
    required this.id,
    required this.name,
    required this.email,
    required this.totalCandidates,
    required this.conversionRate,
    this.lastReportAt,
  });

  final String id;
  final String name;
  final String email;
  final int totalCandidates;
  final double conversionRate;
  final DateTime? lastReportAt;
}

class SupervisorCandidate {
  const SupervisorCandidate({
    required this.id,
    required this.fullName,
    required this.nationality,
    required this.opportunity,
    required this.status,
    required this.registeredAt,
    this.gender,
    this.phone,
    this.email,
    this.passportNumber,
  });

  final String id;
  final String fullName;
  final String nationality;
  final String opportunity;
  final String status;
  final DateTime registeredAt;
  final String? gender;
  final String? phone;
  final String? email;
  final String? passportNumber;
}

class TargetProgress {
  const TargetProgress({
    required this.metric,
    required this.campaignName,
    required this.targetValue,
    required this.actualValue,
  });

  final String metric;
  final String campaignName;
  final num targetValue;
  final num actualValue;
}

class CampaignTargetRow {
  CampaignTargetRow({
    required this.id,
    required this.metric,
    required this.campaignName,
    required this.targetValue,
  });

  final String id;
  final String metric;
  final String campaignName;
  int targetValue;
}

class ReportRow {
  ReportRow({
    required this.id,
    required this.type,
    required this.periodStart,
    required this.periodEnd,
    this.status = 'submitted',
    this.notes,
    this.returnReason,
    this.submitterName = '',
    this.scopeLevel = 'recruiter',
    this.childReports = const [],
  });

  final String id;
  final String type;
  final DateTime periodStart;
  final DateTime periodEnd;
  String status;
  final String? notes;
  String? returnReason;
  final String submitterName;
  final String scopeLevel;
  final List<ChildReport> childReports;
}

class ChildReport {
  const ChildReport({
    required this.id,
    required this.submitterName,
    required this.status,
  });

  final String id;
  final String submitterName;
  final String status;
}

class RosterEntry {
  RosterEntry({
    required this.id,
    required this.fullName,
    this.reportId,
    this.status,
  });

  final String id;
  final String fullName;
  final String? reportId;
  final String? status;
}

class ConsolidationPreview {
  ConsolidationPreview({
    required this.roster,
    required this.verifiedReportIds,
    required this.alreadyConsolidated,
  });

  final List<RosterEntry> roster;
  final List<String> verifiedReportIds;
  final bool alreadyConsolidated;
}

class NoteRow {
  NoteRow({
    required this.id,
    required this.message,
    required this.createdAt,
    required this.authorName,
  });

  final String id;
  final String message;
  final DateTime createdAt;
  final String authorName;
}

class KpiTarget {
  KpiTarget(this.metric);

  final String metric;
  int? daily;
  int? weekly;
  int? monthly;

  int? valueFor(KpiPeriod period) => switch (period) {
        KpiPeriod.daily => daily,
        KpiPeriod.weekly => weekly,
        KpiPeriod.monthly => monthly,
      };
}

class RecruiterScorecard {
  RecruiterScorecard({
    required this.id,
    required this.title,
    required this.createdAt,
  });

  final String id;
  final String title;
  final DateTime createdAt;
}

class RecruiterDetail {
  RecruiterDetail({
    required this.candidatesThisMonth,
    required this.conversionRateThisMonth,
    required this.targetProgress,
    required this.campaignTargets,
    required this.reports,
    required this.kpiTargets,
    required this.scorecards,
    required this.notes,
  });

  final int candidatesThisMonth;
  final double conversionRateThisMonth;
  final List<TargetProgress> targetProgress;
  final List<CampaignTargetRow> campaignTargets;
  final List<ReportRow> reports;
  final List<KpiTarget> kpiTargets;
  final List<RecruiterScorecard> scorecards;
  final List<NoteRow> notes;
}

enum TimelineStatus { completed, current, upcoming }

class TimelineEvent {
  TimelineEvent({
    required this.stage,
    required this.status,
    this.date,
    this.notes,
  });

  final String stage;
  final TimelineStatus status;
  final DateTime? date;
  final String? notes;
}

class SupervisorCase {
  SupervisorCase({
    required this.id,
    required this.candidateName,
    required this.recruiterName,
    required this.country,
    required this.currentStage,
    required this.status,
    required this.lastUpdated,
    required this.timeline,
    required this.documents,
    required this.paymentStatus,
  });

  final String id;
  final String candidateName;
  final String recruiterName;
  final String country;
  final String currentStage;
  final String status;
  final DateTime lastUpdated;
  final List<TimelineEvent> timeline;
  final List<String> documents;
  final String paymentStatus;
}

const List<String> _kpiMetrics = [
  'Candidate identification',
  'Screening completion',
  'Screening pass rate',
  'Application submission',
  'CRM completeness / accuracy',
  'On-time follow-up',
];

List<KpiTarget> _defaultKpis() => [for (final metric in _kpiMetrics) KpiTarget(metric)];

Map<String, RecruiterDetail> _seedDetails() {
  final now = DateTime.now();
  final nairobiKpis = _defaultKpis()..[3].monthly = 12;
  return {
    // Kenya Regional Recruiter — mirrors the current front-end seed state.
    '1': RecruiterDetail(
      candidatesThisMonth: 0,
      conversionRateThisMonth: 0,
      targetProgress: const [],
      campaignTargets: const [],
      reports: const [],
      kpiTargets: _defaultKpis(),
      scorecards: const [],
      notes: const [],
    ),
    '2': RecruiterDetail(
      candidatesThisMonth: 2,
      conversionRateThisMonth: 50,
      targetProgress: const [
        TargetProgress(metric: 'Agent sign-ups', campaignName: 'Q3 Expansion', targetValue: 4, actualValue: 2),
        TargetProgress(metric: 'Applicant flow', campaignName: 'Q3 Expansion', targetValue: 8, actualValue: 3),
      ],
      campaignTargets: [
        CampaignTargetRow(id: 'ct1', metric: 'Agent sign-ups', campaignName: 'Q3 Expansion', targetValue: 5),
        CampaignTargetRow(id: 'ct2', metric: 'Applicant flow', campaignName: 'Q3 Expansion', targetValue: 10),
      ],
      reports: [
        ReportRow(
          id: 'r1',
          type: 'Weekly activity',
          periodStart: now.subtract(const Duration(days: 7)),
          periodEnd: now,
          status: 'submitted',
          notes: 'Sourced 2 new candidates this week.',
          submitterName: 'Nairobi City Lead',
        ),
        ReportRow(
          id: 'r2',
          type: 'Daily activity',
          periodStart: now.subtract(const Duration(days: 2)),
          periodEnd: now.subtract(const Duration(days: 2)),
          status: 'verified',
          notes: 'On schedule — embassy appointments confirmed.',
          submitterName: 'Nairobi City Lead',
        ),
      ],
      kpiTargets: nairobiKpis,
      scorecards: [
        RecruiterScorecard(id: 's1', title: 'Q3 2026 Review', createdAt: now.subtract(const Duration(days: 20))),
      ],
      notes: [
        NoteRow(
          id: 'n1',
          message: 'Great progress on the Q3 applicant flow. Keep it up.',
          createdAt: now.subtract(const Duration(days: 1)),
          authorName: 'Country Supervisor',
        ),
      ],
    ),
    '3': RecruiterDetail(
      candidatesThisMonth: 1,
      conversionRateThisMonth: 100,
      targetProgress: const [],
      campaignTargets: const [],
      reports: [
        ReportRow(
          id: 'r3',
          type: 'Weekly activity',
          periodStart: now.subtract(const Duration(days: 21)),
          periodEnd: now.subtract(const Duration(days: 14)),
          status: 'returned',
          returnReason: 'Missing KPI actuals for screening pass rate.',
          submitterName: 'Mombasa Coastal Agent',
        ),
      ],
      kpiTargets: _defaultKpis(),
      scorecards: const [],
      notes: const [],
    ),
  };
}

class SupervisorStore extends ChangeNotifier {
  final List<Recruiter> recruiters = [
    Recruiter(
      id: '1',
      name: 'Kenya Regional Recruiter',
      email: 'recruiter.ke@vertex.local',
      totalCandidates: 0,
      conversionRate: 0,
    ),
    Recruiter(
      id: '2',
      name: 'Nairobi City Lead',
      email: 'city.lead@vertex.local',
      totalCandidates: 2,
      conversionRate: 50,
      lastReportAt: DateTime(2026, 9, 12),
    ),
    Recruiter(
      id: '3',
      name: 'Mombasa Coastal Agent',
      email: 'agent.mombasa@vertex.local',
      totalCandidates: 1,
      conversionRate: 100,
      lastReportAt: DateTime(2026, 9, 1),
    ),
  ];

  final List<SupervisorCandidate> candidates = [
    SupervisorCandidate(
      id: '1',
      fullName: 'Brook Teferi',
      nationality: 'Ethiopia',
      opportunity: 'Poland · Production',
      status: 'Pending Verification',
      gender: 'Male',
      phone: '+251 911 234 567',
      email: 'brook.teferi@example.com',
      passportNumber: 'ET1234567',
      registeredAt: DateTime.now().subtract(const Duration(days: 3)),
    ),
    SupervisorCandidate(
      id: '2',
      fullName: 'Amina Hassan',
      nationality: 'Kenya',
      opportunity: 'Germany · Engineering',
      status: 'In Process',
      gender: 'Female',
      phone: '+254 712 345 678',
      email: 'amina.hassan@example.com',
      passportNumber: 'KE7654321',
      registeredAt: DateTime.now().subtract(const Duration(days: 9)),
    ),
    SupervisorCandidate(
      id: '3',
      fullName: 'John Mutua',
      nationality: 'Kenya',
      opportunity: 'Italy · Hospitality',
      status: 'Visa Processing',
      gender: 'Male',
      phone: '+254 722 111 222',
      email: 'john.mutua@example.com',
      passportNumber: 'KE5566778',
      registeredAt: DateTime.now().subtract(const Duration(days: 15)),
    ),
    SupervisorCandidate(
      id: '4',
      fullName: 'Selam Gebre',
      nationality: 'Ethiopia',
      opportunity: 'Poland · Production',
      status: 'Pending Verification',
      gender: 'Female',
      phone: '+251 922 888 999',
      email: 'selam.gebre@example.com',
      passportNumber: 'ET9988776',
      registeredAt: DateTime.now().subtract(const Duration(days: 2)),
    ),
    SupervisorCandidate(
      id: '5',
      fullName: 'Grace Wanjiru',
      nationality: 'Kenya',
      opportunity: 'Germany · Engineering',
      status: 'Ready to Depart',
      gender: 'Female',
      phone: '+254 733 555 444',
      email: 'grace.wanjiru@example.com',
      passportNumber: 'KE4433221',
      registeredAt: DateTime.now().subtract(const Duration(days: 28)),
    ),
  ];

  final Map<String, RecruiterDetail> _details = _seedDetails();

  final List<SupervisorCase> cases = () {
    final now = DateTime.now();
    return [
      SupervisorCase(
        id: '1',
        candidateName: 'Brook Teferi',
        recruiterName: 'Kenya Regional Recruiter',
        country: 'Kenya',
        currentStage: 'Visa',
        status: 'On Track',
        lastUpdated: now.subtract(const Duration(days: 2)),
        timeline: [
          TimelineEvent(stage: 'Offer', status: TimelineStatus.completed, date: now.subtract(const Duration(days: 30))),
          TimelineEvent(stage: 'Permit', status: TimelineStatus.completed, date: now.subtract(const Duration(days: 15))),
          TimelineEvent(stage: 'Visa', status: TimelineStatus.current, date: now.subtract(const Duration(days: 2)), notes: 'Embassy appointment scheduled.'),
          TimelineEvent(stage: 'Travel', status: TimelineStatus.upcoming),
        ],
        documents: const ['Passport', 'Offer Letter', 'Work Permit'],
        paymentStatus: 'Stage 2 Paid · Stage 3 Pending',
      ),
      SupervisorCase(
        id: '2',
        candidateName: 'Amina Yusuf',
        recruiterName: 'Kenya Regional Recruiter',
        country: 'Kenya',
        currentStage: 'Permit',
        status: 'Delayed',
        lastUpdated: now.subtract(const Duration(days: 5)),
        timeline: [
          TimelineEvent(stage: 'Offer', status: TimelineStatus.completed, date: now.subtract(const Duration(days: 20))),
          TimelineEvent(stage: 'Permit', status: TimelineStatus.current, date: now.subtract(const Duration(days: 4)), notes: 'Work permit under embassy review — expected delay.'),
          TimelineEvent(stage: 'Visa', status: TimelineStatus.upcoming),
          TimelineEvent(stage: 'Travel', status: TimelineStatus.upcoming),
        ],
        documents: const ['Passport', 'Offer Letter'],
        paymentStatus: 'Stage 1 Paid · Stage 2 Pending',
      ),
      SupervisorCase(
        id: '3',
        candidateName: 'Selam Gebre',
        recruiterName: 'Kenya Regional Recruiter',
        country: 'Ethiopia',
        currentStage: 'Offer',
        status: 'On Track',
        lastUpdated: now.subtract(const Duration(days: 1)),
        timeline: [
          TimelineEvent(stage: 'Offer', status: TimelineStatus.current, date: now.subtract(const Duration(days: 1)), notes: 'Offer letter issued — awaiting candidate signature.'),
          TimelineEvent(stage: 'Permit', status: TimelineStatus.upcoming),
          TimelineEvent(stage: 'Visa', status: TimelineStatus.upcoming),
          TimelineEvent(stage: 'Travel', status: TimelineStatus.upcoming),
        ],
        documents: const ['Passport'],
        paymentStatus: 'Stage 1 Paid · Stage 2 Pending',
      ),
    ];
  }();

  final List<ReportRow> countryReports = () {
    final now = DateTime.now();
    return [
      ReportRow(
        id: 'c2',
        type: 'Weekly consolidated',
        periodStart: now.subtract(const Duration(days: 14)),
        periodEnd: now.subtract(const Duration(days: 7)),
        status: 'returned',
        returnReason: 'Please include applicant flow KPIs against campaign targets.',
        notes: 'Weekly consolidation for Nairobi and Mombasa forward-deployment pipelines.',
        submitterName: 'Country Supervisor',
        scopeLevel: 'country',
      ),
      ReportRow(
        id: 'c1',
        type: 'Monthly country performance',
        periodStart: now.subtract(const Duration(days: 30)),
        periodEnd: now.subtract(const Duration(days: 1)),
        status: 'verified',
        notes: 'Strong quarter for engineering placements; embassy processing times stable.',
        submitterName: 'Country Supervisor',
        scopeLevel: 'country',
        childReports: const [
          ChildReport(id: 'r2', submitterName: 'Nairobi City Lead', status: 'verified'),
        ],
      ),
    ];
  }();

  List<SupervisorCandidate> get pendingCandidates =>
      candidates.where((c) => c.status == 'Pending Verification').toList();

  Recruiter? recruiterById(String id) {
    for (final recruiter in recruiters) {
      if (recruiter.id == id) return recruiter;
    }
    return null;
  }

  SupervisorCandidate? candidateById(String id) {
    for (final candidate in candidates) {
      if (candidate.id == id) return candidate;
    }
    return null;
  }

  SupervisorCase? caseById(String id) {
    for (final caseRecord in cases) {
      if (caseRecord.id == id) return caseRecord;
    }
    return null;
  }

  RecruiterDetail? detailFor(String recruiterId) => _details[recruiterId];

  List<ReportRow> get recruiterSubmissions {
    final out = <ReportRow>[];
    for (final detail in _details.values) {
      for (final report in detail.reports) {
        out.add(ReportRow(
          id: report.id,
          type: report.type,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          status: report.status,
          notes: report.notes,
          returnReason: report.returnReason,
          submitterName: report.submitterName,
          scopeLevel: 'recruiter',
        ));
      }
    }
    out.sort((a, b) => b.periodStart.compareTo(a.periodStart));
    return out;
  }

  ReportRow? reportById(String id) {
    for (final report in countryReports) {
      if (report.id == id) return report;
    }
    for (final detail in _details.values) {
      for (final report in detail.reports) {
        if (report.id == id) return report;
      }
    }
    return null;
  }

  ConsolidationPreview previewForPeriod(DateTime start, DateTime end) {
    final roster = <RosterEntry>[];
    final verifiedIds = <String>[];
    for (final recruiter in recruiters) {
      var matched = false;
      final detail = _details[recruiter.id];
      if (detail != null) {
        for (final report in detail.reports) {
          if (_reportsOverlap(report.periodStart, report.periodEnd, start, end)) {
            matched = true;
            roster.add(RosterEntry(
              id: recruiter.id,
              fullName: recruiter.name,
              reportId: report.id,
              status: report.status,
            ));
            if (report.status == 'verified') verifiedIds.add(report.id);
            break;
          }
        }
      }
      if (!matched) {
        roster.add(RosterEntry(id: recruiter.id, fullName: recruiter.name));
      }
    }
    final alreadyConsolidated = countryReports.any(
      (r) =>
          (r.status == 'submitted' || r.status == 'verified') &&
          _reportsOverlap(r.periodStart, r.periodEnd, start, end),
    );
    return ConsolidationPreview(
      roster: roster,
      verifiedReportIds: verifiedIds,
      alreadyConsolidated: alreadyConsolidated,
    );
  }

  void updateCampaignTarget(String recruiterId, String targetId, int value) {
    final detail = _details[recruiterId];
    if (detail == null) return;
    for (final target in detail.campaignTargets) {
      if (target.id == targetId) target.targetValue = value;
    }
    notifyListeners();
  }

  void updateKpiTarget(String recruiterId, String metric, KpiPeriod period, int? value) {
    final detail = _details[recruiterId];
    if (detail == null) return;
    for (final kpi in detail.kpiTargets) {
      if (kpi.metric == metric) {
        switch (period) {
          case KpiPeriod.daily:
            kpi.daily = value;
          case KpiPeriod.weekly:
            kpi.weekly = value;
          case KpiPeriod.monthly:
            kpi.monthly = value;
        }
      }
    }
    notifyListeners();
  }

  void verifyReport(String reportId) {
    for (final detail in _details.values) {
      for (final report in detail.reports) {
        if (report.id == reportId) {
          report.status = 'verified';
          notifyListeners();
          return;
        }
      }
    }
  }

  void returnReport(String reportId, String reason) {
    for (final detail in _details.values) {
      for (final report in detail.reports) {
        if (report.id == reportId) {
          report.status = 'returned';
          report.returnReason = reason;
          notifyListeners();
          return;
        }
      }
    }
  }

  void resubmitCountryReport(String reportId, String newNotes) {
    final index = countryReports.indexWhere((r) => r.id == reportId);
    if (index < 0) return;
    final report = countryReports[index];
    countryReports[index] = ReportRow(
      id: report.id,
      type: report.type,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      status: 'submitted',
      notes: newNotes,
      submitterName: report.submitterName,
      scopeLevel: report.scopeLevel,
      childReports: report.childReports,
    );
    notifyListeners();
  }

  void submitCountryReport({
    required String type,
    required DateTime periodStart,
    required DateTime periodEnd,
    required String notes,
    required List<ChildReport> childReports,
  }) {
    countryReports.insert(
      0,
      ReportRow(
        id: 'cr${DateTime.now().millisecondsSinceEpoch}',
        type: type,
        periodStart: periodStart,
        periodEnd: periodEnd,
        status: 'submitted',
        notes: notes,
        submitterName: 'Country Supervisor',
        scopeLevel: 'country',
        childReports: childReports,
      ),
    );
    notifyListeners();
  }

  void addNote(String recruiterId, String message, String authorName) {
    final detail = _details[recruiterId];
    if (detail == null) return;
    detail.notes.insert(
      0,
      NoteRow(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        message: message,
        createdAt: DateTime.now(),
        authorName: authorName,
      ),
    );
    notifyListeners();
  }

  void addScorecard(String recruiterId, String title) {
    final detail = _details[recruiterId];
    if (detail == null) return;
    detail.scorecards.insert(
      0,
      RecruiterScorecard(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        title: title,
        createdAt: DateTime.now(),
      ),
    );
    notifyListeners();
  }

  bool _reportsOverlap(DateTime aStart, DateTime aEnd, DateTime bStart, DateTime bEnd) =>
      !(aEnd.isBefore(bStart) || aStart.isAfter(bEnd));
}