enum ReportType { daily, weekly, monthly }

enum ReportStatus { pending, submitted, returned, approved }

class Report {
  const Report({
    required this.id,
    required this.type,
    required this.status,
    required this.dueAt,
    this.submittedAt,
    this.notes,
  });

  final String id;
  final ReportType type;
  final ReportStatus status;
  final DateTime dueAt;
  final DateTime? submittedAt;
  final String? notes;

  factory Report.fromJson(Map<String, dynamic> json) => Report(
        id: json['id'] as String,
        type: ReportType.values.byName(json['type'] as String),
        status: ReportStatus.values.byName(json['status'] as String),
        dueAt: DateTime.parse(json['dueAt'] as String),
        submittedAt: json['submittedAt'] == null
            ? null
            : DateTime.parse(json['submittedAt'] as String),
        notes: json['notes'] as String?,
      );
}
