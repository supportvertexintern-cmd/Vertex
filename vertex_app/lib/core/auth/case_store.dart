import 'package:flutter/foundation.dart';

enum CaseStatus { active, pending, closed }

class CaseRecord {
  const CaseRecord({
    required this.id,
    required this.candidateName,
    required this.nationality,
    required this.destination,
    required this.jobTitle,
    required this.employer,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String candidateName;
  final String nationality;
  final String destination;
  final String jobTitle;
  final String employer;
  final CaseStatus status;
  final DateTime createdAt;
}

class CaseStore extends ChangeNotifier {
  final List<CaseRecord> _records = [];

  List<CaseRecord> get records => List.unmodifiable(_records);

  void add(CaseRecord record) {
    _records.insert(0, record);
    notifyListeners();
  }
}
