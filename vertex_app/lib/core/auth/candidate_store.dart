import 'package:flutter/foundation.dart';

class CandidateRecord {
  const CandidateRecord({
    required this.id,
    required this.fullName,
    required this.nationality,
    required this.opportunity,
    required this.gender,
    required this.phone,
    required this.email,
    required this.registeredAt,
  });

  final String id;
  final String fullName;
  final String nationality;
  final String opportunity;
  final String gender;
  final String phone;
  final String email;
  final DateTime registeredAt;
}

class CandidateStore extends ChangeNotifier {
  final List<CandidateRecord> _records = [];

  List<CandidateRecord> get records => List.unmodifiable(_records);

  void add(CandidateRecord record) {
    _records.insert(0, record);
    notifyListeners();
  }
}
